// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet-only stablecoin standing in for lisUSD / USDT in the demo.
/// Anyone can mint up to 10,000 per call so judges can try the flow themselves.
contract MockUSD is ERC20 {
    uint256 public constant FAUCET_LIMIT = 10_000 ether;

    constructor() ERC20("Reclaim Test USD", "rUSD") {}

    function faucet(uint256 amount) external {
        require(amount <= FAUCET_LIMIT, "MockUSD: over faucet limit");
        _mint(msg.sender, amount);
    }
}
