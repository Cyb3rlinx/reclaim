require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("dotenv").config();

const pk = process.env.DEPLOYER_PRIVATE_KEY;

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" },
  },
  networks: {
    localhost: { url: "http://127.0.0.1:8545" },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com",
      chainId: 97,
      accounts: pk ? [pk] : [],
    },
  },
};
