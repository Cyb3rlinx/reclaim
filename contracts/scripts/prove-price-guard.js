// Proof on BSC testnet: the agent overstates the USD refund by 30% and the vault,
// re-pricing with the Atlas THB/USD feed, reverts with PriceMismatch.
const { ethers } = require("hardhat");
const dep = require("../../web/lib/deployment.json");

async function main() {
  const agent = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, ethers.provider);
  const vault = new ethers.Contract(dep.vault, dep.vaultAbi, agent);
  const feed = new ethers.Contract(dep.priceFeed, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], ethers.provider);
  const price = (await feed.latestRoundData())[1];
  const refundThb = ethers.parseEther("7062.14");
  const fairUsd = (refundThb * price) / 10n ** 18n;
  const inflated = (fairUsd * 130n) / 100n;
  const deadline = Math.floor(Date.now() / 1000) + 50 * 86400;
  const receiptHash = ethers.keccak256(ethers.toUtf8Bytes("price-guard-proof-" + Date.now()));
  console.log("Atlas price", ethers.formatUnits(price, 18), "fair USD", ethers.formatEther(fairUsd), "inflated USD", ethers.formatEther(inflated));

  try {
    await vault.issueAdvance.staticCall(agent.address, refundThb, inflated, deadline, receiptHash, "price guard proof");
    console.log("UNEXPECTED: static call succeeded");
  } catch (e) {
    const data = e.data || e.info?.error?.data || e.error?.data;
    let decoded = null;
    try { decoded = vault.interface.parseError(data); } catch {}
    console.log("static call reverted:", decoded ? `${decoded.name}(${decoded.args.map(String).join(", ")})` : (data || e.shortMessage));
  }
  if (process.env.SEND !== "1") return;
  // Send it for real (fixed gas limit, so it is mined and visible on BscScan as failed).
  const tx = await vault.issueAdvance(agent.address, refundThb, inflated, deadline, receiptHash, "price guard proof", { gasLimit: 400000 });
  const rc = await tx.wait().catch((e) => e.receipt);
  console.log("tx", tx.hash, "status", rc && rc.status);
}
main().catch((e) => { console.error(e); process.exit(1); });
