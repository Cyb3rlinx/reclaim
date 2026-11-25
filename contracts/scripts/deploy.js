// Deploys Reclaim to BSC testnet, seeds the pool, funds the demo wallets with gas,
// and writes addresses + ABIs for the web app (web/lib/deployment.json, web/.env.local).
const { ethers, artifacts, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "..", "web");

function upsertEnv(file, values) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  for (const [k, v] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(k + "="));
    if (i >= 0) {
      if (k === "TOURIST_DEMO_PRIVATE_KEY") continue; // keep the existing demo tourist
      lines[i] = `${k}=${v}`;
    } else lines.push(`${k}=${v}`);
  }
  fs.writeFileSync(file, lines.filter((l, i, a) => l !== "" || i < a.length - 1).join("\n") + "\n");
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const agent = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, ethers.provider);
  const envFile = path.join(WEB, ".env.local");
  const existing = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  const touristKey = (existing.match(/^TOURIST_DEMO_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m) || [])[1] || ethers.Wallet.createRandom().privateKey;
  const tourist = new ethers.Wallet(touristKey, ethers.provider);

  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`network=${network.name} deployer=${deployer.address} balance=${ethers.formatEther(bal)} BNB`);

  const stable = await (await ethers.getContractFactory("MockUSD")).deploy();
  await stable.waitForDeployment();
  console.log("MockUSD", stable.target);

  const vault = await (await ethers.getContractFactory("ReclaimVault")).deploy(stable.target, deployer.address);
  await vault.waitForDeployment();
  const receipt = await vault.receipt();
  console.log("ReclaimVault", vault.target, "receipt NFT", receipt);

  // THB/USD price: the live Atlas Oracle feed on BSC testnet; a mock feed on a local chain.
  let feedAddress = process.env.ATLAS_THB_USD_FEED || "0x9f9cb4f972edd5bd59ca045f10821d8a2588bf4e";
  if (network.name !== "bscTestnet") {
    const mock = await (await ethers.getContractFactory("MockAggregator")).deploy(18, ethers.parseUnits("0.0293", 18));
    await mock.waitForDeployment();
    feedAddress = mock.target;
  }
  await (await vault.setPriceFeed(feedAddress, 7 * 24 * 3600, 100)).wait();
  console.log("Price feed", feedAddress, network.name === "bscTestnet" ? "(Atlas THB/USD)" : "(mock)");

  await (await vault.grantRole(await vault.AGENT_ROLE(), agent.address)).wait();
  const oracle = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, ethers.provider);
  await (await vault.grantRole(await vault.ORACLE_ROLE(), oracle.address)).wait();

  // Seed the liquidity pool with 20,000 test USD from the deployer (acting as first LP).
  for (let i = 0; i < 2; i++) await (await stable.faucet(ethers.parseEther("10000"))).wait();
  await (await stable.approve(vault.target, ethers.parseEther("20000"))).wait();
  await (await vault.deposit(ethers.parseEther("20000"), deployer.address)).wait();
  console.log("Pool seeded with 20,000 rUSD");

  // Gas for the agent and the demo tourist.
  const gas = ethers.parseEther(process.env.GAS_TOPUP || "0.01");
  for (const w of [agent, tourist, oracle]) {
    if (w.address === deployer.address) continue;
    if ((await ethers.provider.getBalance(w.address)) < gas / 2n) {
      await (await deployer.sendTransaction({ to: w.address, value: gas })).wait();
    }
  }

  const out = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    vault: vault.target,
    stable: stable.target,
    receipt,
    priceFeed: feedAddress,
    deployedAt: new Date().toISOString(),
    vaultAbi: (await artifacts.readArtifact("ReclaimVault")).abi,
    stableAbi: (await artifacts.readArtifact("MockUSD")).abi,
  };
  fs.writeFileSync(path.join(WEB, "lib", "deployment.json"), JSON.stringify(out, null, 2));
  upsertEnv(envFile, {
    BSC_TESTNET_RPC: process.env.WEB_RPC || process.env.BSC_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com",
    AGENT_PRIVATE_KEY: process.env.AGENT_PRIVATE_KEY,
    ORACLE_PRIVATE_KEY: process.env.DEPLOYER_PRIVATE_KEY,
    TOURIST_DEMO_PRIVATE_KEY: touristKey,
  });
  console.log("agent", agent.address, "demo tourist", tourist.address);
  console.log("Wrote web/lib/deployment.json and web/.env.local");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
