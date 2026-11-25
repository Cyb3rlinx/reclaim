// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice The tokenized VAT-refund right (the RWA). One token per verified receipt.
/// Only the vault (owner) can mint. Claim data lives in the vault (`getClaim`).
contract ReclaimReceipt is ERC721, Ownable {
    constructor(address vault) ERC721("Reclaim Receipt", "RECLAIM") Ownable(vault) {}

    function mint(address to, uint256 tokenId) external onlyOwner {
        _safeMint(to, tokenId);
    }
}
