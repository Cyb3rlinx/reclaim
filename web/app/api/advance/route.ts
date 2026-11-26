import { NextResponse } from "next/server";
import { isAddress, keccak256, parseEther, toUtf8Bytes, formatEther } from "ethers";
import { checkReceipt, estimate, normalizedReceiptKey, type ReceiptData } from "@/lib/rules";
import { thbToUsdRate } from "@/lib/fx";
import { marketCheck, MAX_SOURCE_DEVIATION_PCT } from "@/lib/cmc";
import { STABLECOINS, stablecoinPegs, type Stablecoin } from "@/lib/market";
import { EXPLORER, chainError, isDeployed, vault, wallets } from "@/lib/chain";

export const runtime = "nodejs";

/** Quote: run the agent's checks and price the advance without touching the chain. */
async function quote(receipt: ReceiptData, payoutReq?: string) {
  const checks = checkReceipt(receipt);
  const { vatThb, refundThb, deadline } = estimate(receipt);
  const fx = await thbToUsdRate();
  // Second, independent source: CoinMarketCap. Atlas is still enforced on-chain by the vault;
  // if CMC is unreachable the advance continues on Atlas alone and the UI says so.
  const market = await marketCheck(fx.usdPerThb);
  if (market.configured && !market.error) {
    checks.push({
      id: "sources",
      label: "Price sources agree (Atlas vs CoinMarketCap)",
      ok: !!market.sourcesAgree,
      detail: `CMC ${market.cmcUsdPerThb!.toFixed(5)} vs Atlas ${fx.usdPerThb.toFixed(5)} USD/THB · ${market.deviationPct!.toFixed(2)}% apart (max ${MAX_SOURCE_DEVIATION_PCT}%)`,
    });
  }
  // The tourist picks the stablecoin; the agent refuses to pay in one that has lost its $1 peg.
  const pegs = await stablecoinPegs();
  const payout: Stablecoin =
    payoutReq && (STABLECOINS as readonly string[]).includes(payoutReq) ? (payoutReq as Stablecoin) : (pegs.recommended ?? "USDT");
  const peg = pegs.coins.find((c) => c.symbol === payout);
  if (peg) {
    checks.push({
      id: "peg",
      label: `${payout} holds its $1 peg`,
      ok: peg.ok,
      detail: `${payout} = $${peg.price.toFixed(4)} on ${pegs.source} · must stay within $0.98–$1.02`,
    });
  }
  const refundUsd = Math.floor(refundThb * fx.usdPerThb * 100) / 100;
  const terms = { advanceBps: 8000, feeBps: 500 };
  if (isDeployed()) {
    const v = vault();
    terms.advanceBps = Number(await v.advanceBps());
    terms.feeBps = Number(await v.feeBps());
  }
  return {
    checks,
    eligible: checks.every((c) => c.ok),
    vatThb,
    refundThb,
    refundUsd,
    advanceUsd: (refundUsd * terms.advanceBps) / 10_000,
    feeUsd: (refundUsd * terms.feeBps) / 10_000,
    deadline: deadline.toISOString(),
    fx,
    market,
    payout,
    pegs,
    receiptHash: keccak256(toUtf8Bytes(normalizedReceiptKey(receipt))),
  };
}

export async function POST(req: Request) {
  const body = (await req.json()) as { receipt: ReceiptData; tourist?: string; execute?: boolean; payout?: string };
  const q = await quote(body.receipt, body.payout);
  if (!body.execute) return NextResponse.json(q);

  if (!q.eligible) return NextResponse.json({ ...q, error: "Receipt failed the agent's checks." }, { status: 422 });
  if (!isDeployed()) return NextResponse.json({ ...q, error: "Contracts are not deployed yet." }, { status: 503 });

  const tourist = body.tourist && isAddress(body.tourist) ? body.tourist : wallets.tourist().address;
  try {
    const v = vault(wallets.agent());
    const existing = Number(await v.claimIdByReceipt(q.receiptHash));
    if (existing) {
      return NextResponse.json({ ...q, error: `This receipt was already advanced (claim #${existing}).`, claimId: existing }, { status: 409 });
    }
    // The vault re-prices this on-chain with Atlas THB/USD and rejects it if THB and USD disagree.
    const tx = await v.issueAdvance(
      tourist,
      parseEther(q.refundThb.toFixed(2)),
      parseEther(q.refundUsd.toFixed(2)),
      Math.floor(new Date(q.deadline).getTime() / 1000),
      q.receiptHash,
      body.receipt.storeName.slice(0, 80),
    );
    const rc = await tx.wait();
    const ev = rc.logs.map((l: { topics: string[]; data: string }) => {
      try {
        return v.interface.parseLog(l);
      } catch {
        return null;
      }
    }).find((p: { name?: string } | null) => p?.name === "AdvanceIssued");
    return NextResponse.json({
      ...q,
      tourist,
      claimId: Number(ev?.args.claimId),
      advancePaid: ev ? formatEther(ev.args.advanceAmount) : null,
      txHash: tx.hash,
      txUrl: `${EXPLORER}/tx/${tx.hash}`,
    });
  } catch (e) {
    return NextResponse.json({ ...q, error: chainError(e) }, { status: 500 });
  }
}
