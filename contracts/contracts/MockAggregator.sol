// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAggregatorV3} from "./IAggregatorV3.sol";

/// @notice Test-only stand-in for the Atlas THB/USD feed (local chain and unit tests).
contract MockAggregator is IAggregatorV3 {
    uint8 public immutable override decimals;
    int256 private _answer;
    uint256 private _updatedAt;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        setAnswer(answer_);
    }

    function setAnswer(int256 answer_) public {
        _answer = answer_;
        _updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        _updatedAt = updatedAt_;
    }

    function description() external pure override returns (string memory) {
        return "Mock THB/USD";
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return (1, _answer, _updatedAt, _updatedAt, 1);
    }
}
