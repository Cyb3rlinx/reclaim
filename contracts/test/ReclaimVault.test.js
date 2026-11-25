const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const usd = (n) => ethers.parseEther(String(n));
const hash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

describe("ReclaimVault", function () {
  async function setup() {
    const [admin, agent, oracle, lp, tourist, stranger] = await ethers.getSigners();
    const stable = await (await ethers.getContractFactory("MockUSD")).deploy();
    const vault = await (await ethers.getContractFactory("ReclaimVault")).deploy(stable.target, admin.address);
    await vault.grantRole(await vault.AGENT_ROLE(), agent.address);
    await vault.grantRole(await vault.ORACLE_ROLE(), oracle.address);
    const receipt = await ethers.getContractAt("ReclaimReceipt", await vault.receipt());

    // LP funds the pool with 5,000 rUSD
    await stable.connect(lp).faucet(usd(5000));
    await stable.connect(lp).approve(vault.target, usd(5000));
    await vault.connect(lp).deposit(usd(5000), lp.address);

    const deadline = (await time.latest()) + 60 * 24 * 3600; // 60 days
    return { admin, agent, oracle, lp, tourist, stranger, stable, vault, receipt, deadline };
  }

  it("pays the tourist 80% instantly and mints the receipt NFT", async () => {
    const { agent, tourist, stable, vault, receipt, deadline } = await setup();
    // 7,000 THB refund ≈ 200 USD
    await expect(vault.connect(agent).issueAdvance(tourist.address, usd(200), deadline, hash("rcpt-1"), "Siam Paragon"))
      .to.emit(vault, "AdvanceIssued");
    expect(await stable.balanceOf(tourist.address)).to.equal(usd(160));
    expect(await receipt.ownerOf(1)).to.equal(tourist.address);
    const c = await vault.getClaim(1);
    expect(c.status).to.equal(1n); // Advanced
    expect(c.feeAmount).to.equal(usd(10));
    expect(await vault.outstandingPrincipal()).to.equal(usd(160));
    expect(await vault.totalAssets()).to.equal(usd(5000)); // lent money still counts
  });

  it("rejects the same receipt twice (anti double-financing)", async () => {
    const { agent, tourist, vault, deadline } = await setup();
    await vault.connect(agent).issueAdvance(tourist.address, usd(200), deadline, hash("rcpt-1"), "Shop");
    await expect(vault.connect(agent).issueAdvance(tourist.address, usd(200), deadline, hash("rcpt-1"), "Shop"))
      .to.be.revertedWithCustomError(vault, "ReceiptAlreadyUsed");
  });

  it("only the agent can issue advances", async () => {
    const { stranger, tourist, vault, deadline } = await setup();
    await expect(vault.connect(stranger).issueAdvance(tourist.address, usd(200), deadline, hash("x"), "Shop"))
      .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
  });

  it("rejects expired deadlines, zero and oversized amounts", async () => {
    const { agent, tourist, vault, deadline } = await setup();
    const past = (await time.latest()) - 1;
    await expect(vault.connect(agent).issueAdvance(tourist.address, usd(200), past, hash("a"), "S"))
      .to.be.revertedWithCustomError(vault, "InvalidDeadline");
    await expect(vault.connect(agent).issueAdvance(tourist.address, 0, deadline, hash("b"), "S"))
      .to.be.revertedWithCustomError(vault, "InvalidAmount");
    await expect(vault.connect(agent).issueAdvance(tourist.address, usd(5001), deadline, hash("c"), "S"))
      .to.be.revertedWithCustomError(vault, "InvalidAmount");
  });

  it("fails cleanly when the pool has no liquidity", async () => {
    const { admin, agent, tourist, vault, deadline } = await setup();
    await vault.connect(admin).setTerms(8000, 500, 7 * 24 * 3600, usd(100000));
    await expect(vault.connect(agent).issueAdvance(tourist.address, usd(10000), deadline, hash("big"), "S"))
      .to.be.revertedWithCustomError(vault, "InsufficientLiquidity");
  });

  it("oracle attests, tourist repays advance + fee, LPs earn the fee", async () => {
    const { agent, oracle, lp, tourist, stable, vault, deadline } = await setup();
    await vault.connect(agent).issueAdvance(tourist.address, usd(200), deadline, hash("rcpt-1"), "Shop");
    await expect(vault.connect(oracle).attestRefund(1, "ipfs://proof")).to.emit(vault, "RefundAttested");
    expect((await vault.getClaim(1)).refundAttested).to.equal(true);

    // tourist got the full refund at the airport (simulated) and repays 170
    await stable.connect(tourist).faucet(usd(200));
    expect(await vault.amountOwed(1)).to.equal(usd(170));
    await stable.connect(tourist).approve(vault.target, usd(170));
    await expect(vault.connect(tourist).repay(1)).to.emit(vault, "Repaid");

    expect((await vault.getClaim(1)).status).to.equal(2n); // Settled
    expect(await vault.outstandingPrincipal()).to.equal(0);
    expect(await vault.totalAssets()).to.equal(usd(5010)); // +10 fee
    const lpShares = await vault.balanceOf(lp.address);
    expect(await vault.convertToAssets(lpShares)).to.be.closeTo(usd(5010), usd(0.001));
    await expect(vault.connect(tourist).repay(1)).to.be.revertedWithCustomError(vault, "WrongStatus");
  });

  it("only the oracle can attest", async () => {
    const { agent, stranger, tourist, vault, deadline } = await setup();
    await vault.connect(agent).issueAdvance(tourist.address, usd(200), deadline, hash("r"), "S");
    await expect(vault.connect(stranger).attestRefund(1, "x"))
      .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
  });

  it("unpaid claims default only after deadline + grace, and LPs absorb the loss", async () => {
    const { agent, stranger, tourist, vault, deadline } = await setup();
    await vault.connect(agent).issueAdvance(tourist.address, usd(200), deadline, hash("r"), "S");
    await expect(vault.connect(stranger).markDefault(1)).to.be.revertedWithCustomError(vault, "NotYetDefaultable");
    await time.increaseTo(deadline + 7 * 24 * 3600 + 1);
    await expect(vault.connect(stranger).markDefault(1)).to.emit(vault, "Defaulted");
    expect(await vault.totalAssets()).to.equal(usd(4840));
  });

  it("LPs cannot withdraw money that is lent out", async () => {
    const { agent, lp, tourist, vault, deadline } = await setup();
    await vault.connect(agent).issueAdvance(tourist.address, usd(200), deadline, hash("r"), "S");
    expect(await vault.maxWithdraw(lp.address)).to.equal(usd(4840));
    await expect(vault.connect(lp).withdraw(usd(5000), lp.address, lp.address)).to.be.reverted;
    await vault.connect(lp).withdraw(usd(4840), lp.address, lp.address);
  });
});
