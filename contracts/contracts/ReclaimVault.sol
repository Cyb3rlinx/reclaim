// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReclaimReceipt} from "./ReclaimReceipt.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ReclaimVault
/// @notice Tourist VAT-refund advances on BNB Chain.
///
/// A tourist's right to a VAT refund is real-world value that is locked until they
/// leave the country. Reclaim lets an AI agent verify the receipt, mint it as an
/// on-chain "Reclaim Receipt" (ERC-721, the RWA) and pay the tourist an advance
/// from a liquidity pool right away. After the tourist claims the refund at the
/// airport, they repay the advance plus a fee and the receipt is marked settled.
///
/// - Liquidity providers deposit the stablecoin and receive vault shares (ERC-4626).
///   Fees raise the share price; defaults lower it.
/// - AGENT_ROLE: the off-chain agent that read and verified the receipt.
/// - ORACLE_ROLE: attests that the refund was actually claimed at departure
///   (designed for an AI resolution oracle such as Cournot).
contract ReclaimVault is ERC4626, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    uint256 public constant BPS = 10_000;

    enum Status {
        None,
        Advanced,
        Settled,
        Defaulted
    }

    struct Claim {
        address tourist;
        uint128 refundAmount; // expected VAT refund, in stablecoin units
        uint128 advanceAmount; // paid to the tourist up front
        uint128 feeAmount; // protocol fee, earned by the pool
        uint64 departureDeadline; // last day the refund can be claimed
        uint64 createdAt;
        Status status;
        bool refundAttested; // oracle confirmed the refund was claimed
        bytes32 receiptHash; // hash of the normalized receipt data
        string storeName;
        string proofURI; // oracle evidence (reasoning trace / customs record)
    }

    uint256 public advanceBps = 8_000; // 80% of the refund paid immediately
    uint256 public feeBps = 500; // 5% of the refund
    uint256 public gracePeriod = 7 days;
    uint256 public maxRefundPerClaim = 5_000 ether;

    ReclaimReceipt public immutable receipt;
    uint256 public outstandingPrincipal;
    uint256 public nextClaimId = 1;

    mapping(uint256 => Claim) private _claims;
    mapping(bytes32 => uint256) public claimIdByReceipt;

    event AdvanceIssued(
        uint256 indexed claimId,
        address indexed tourist,
        uint256 refundAmount,
        uint256 advanceAmount,
        uint256 feeAmount,
        uint64 departureDeadline,
        bytes32 receiptHash
    );
    event RefundAttested(uint256 indexed claimId, string proofURI);
    event Repaid(uint256 indexed claimId, address indexed payer, uint256 amount);
    event Defaulted(uint256 indexed claimId, uint256 lostPrincipal);
    event TermsUpdated(uint256 advanceBps, uint256 feeBps, uint256 gracePeriod, uint256 maxRefundPerClaim);

    error ReceiptAlreadyUsed(uint256 claimId);
    error InvalidAmount();
    error InvalidDeadline();
    error InsufficientLiquidity(uint256 available, uint256 needed);
    error WrongStatus(Status current);
    error NotYetDefaultable(uint256 defaultableAt);

    constructor(IERC20 stable, address admin)
        ERC20("Reclaim Pool Share", "rPOOL")
        ERC4626(stable)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        receipt = new ReclaimReceipt(address(this));
    }

    // ------------------------------------------------------------------
    // Tourist flow
    // ------------------------------------------------------------------

    /// @notice Called by the agent after it has read and verified a receipt.
    function issueAdvance(
        address tourist,
        uint128 refundAmount,
        uint64 departureDeadline,
        bytes32 receiptHash,
        string calldata storeName
    ) external onlyRole(AGENT_ROLE) nonReentrant returns (uint256 claimId) {
        if (tourist == address(0) || refundAmount == 0 || refundAmount > maxRefundPerClaim) {
            revert InvalidAmount();
        }
        if (departureDeadline <= block.timestamp) revert InvalidDeadline();
        uint256 existing = claimIdByReceipt[receiptHash];
        if (existing != 0) revert ReceiptAlreadyUsed(existing);

        uint128 advance = uint128((uint256(refundAmount) * advanceBps) / BPS);
        uint128 fee = uint128((uint256(refundAmount) * feeBps) / BPS);
        uint256 available = IERC20(asset()).balanceOf(address(this));
        if (available < advance) revert InsufficientLiquidity(available, advance);

        claimId = nextClaimId++;
        claimIdByReceipt[receiptHash] = claimId;
        _claims[claimId] = Claim({
            tourist: tourist,
            refundAmount: refundAmount,
            advanceAmount: advance,
            feeAmount: fee,
            departureDeadline: departureDeadline,
            createdAt: uint64(block.timestamp),
            status: Status.Advanced,
            refundAttested: false,
            receiptHash: receiptHash,
            storeName: storeName,
            proofURI: ""
        });
        outstandingPrincipal += advance;

        receipt.mint(tourist, claimId);
        IERC20(asset()).safeTransfer(tourist, advance);

        emit AdvanceIssued(claimId, tourist, refundAmount, advance, fee, departureDeadline, receiptHash);
    }

    /// @notice Oracle confirms the tourist claimed the refund at departure.
    function attestRefund(uint256 claimId, string calldata proofURI) external onlyRole(ORACLE_ROLE) {
        Claim storage c = _claims[claimId];
        if (c.status != Status.Advanced) revert WrongStatus(c.status);
        c.refundAttested = true;
        c.proofURI = proofURI;
        emit RefundAttested(claimId, proofURI);
    }

    /// @notice Repay advance + fee. Anyone may repay on the tourist's behalf.
    function repay(uint256 claimId) external nonReentrant {
        Claim storage c = _claims[claimId];
        if (c.status != Status.Advanced) revert WrongStatus(c.status);
        uint256 owed = uint256(c.advanceAmount) + c.feeAmount;
        c.status = Status.Settled;
        outstandingPrincipal -= c.advanceAmount;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), owed);
        emit Repaid(claimId, msg.sender, owed);
    }

    /// @notice After the deadline plus grace, an unpaid claim is written off.
    function markDefault(uint256 claimId) external {
        Claim storage c = _claims[claimId];
        if (c.status != Status.Advanced) revert WrongStatus(c.status);
        uint256 defaultableAt = uint256(c.departureDeadline) + gracePeriod;
        if (block.timestamp <= defaultableAt) revert NotYetDefaultable(defaultableAt);
        c.status = Status.Defaulted;
        outstandingPrincipal -= c.advanceAmount;
        emit Defaulted(claimId, c.advanceAmount);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return _claims[claimId];
    }

    function amountOwed(uint256 claimId) external view returns (uint256) {
        Claim storage c = _claims[claimId];
        if (c.status != Status.Advanced) return 0;
        return uint256(c.advanceAmount) + c.feeAmount;
    }

    /// @dev Pool value = idle cash + money currently lent out to tourists.
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + outstandingPrincipal;
    }

    /// @dev LPs can only withdraw idle cash, not money that is lent out.
    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 ownerAssets = super.maxWithdraw(owner);
        return ownerAssets < idle ? ownerAssets : idle;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        return _convertToShares(maxWithdraw(owner), _roundDown());
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function setTerms(uint256 advanceBps_, uint256 feeBps_, uint256 gracePeriod_, uint256 maxRefund_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(advanceBps_ + feeBps_ <= BPS, "terms: advance + fee > 100%");
        advanceBps = advanceBps_;
        feeBps = feeBps_;
        gracePeriod = gracePeriod_;
        maxRefundPerClaim = maxRefund_;
        emit TermsUpdated(advanceBps_, feeBps_, gracePeriod_, maxRefund_);
    }

    function _roundDown() private pure returns (Math.Rounding) {
        return Math.Rounding.Floor;
    }

    function decimals() public view override(ERC4626) returns (uint8) {
        return ERC4626.decimals();
    }
}
