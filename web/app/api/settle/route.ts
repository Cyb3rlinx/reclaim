import { NextResponse } from "next/server";
import { EXPLORER, chainError, readClaim, stable, vault, wallets } from "@/lib/chain";

export const runtime = "nodejs";

/**
 * Demo of the exit leg.
 *  step "attest": the resolution oracle records evidence that the refund was claimed at the airport.
 *  step "repay":  the (demo) tourist repays advance + fee from the refund they received.
 */
export async function POST(req: Request) {
  const { claimId, step } = (await req.json()) as { claimId: number; step: "attest" | "repay" };
  try {
    if (step === "attest") {
      const claim = await readClaim(claimId);
      const proof = {
        type: "reclaim/refund-attestation@1",
        claimId,
        receiptHash: claim.receiptHash,
        evidence: "Customs-stamped P.P.10 + airport VAT refund counter record (simulated for the demo)",
        reasoning:
          "Departure deadline not passed; receipt hash matches the advanced claim; refund counter record shows payment to the same traveller.",
        attestedAt: new Date().toISOString(),
      };
      const uri = "data:application/json," + encodeURIComponent(JSON.stringify(proof));
      const tx = await vault(wallets.oracle()).attestRefund(claimId, uri);
      await tx.wait();
      return NextResponse.json({ ok: true, txHash: tx.hash, txUrl: `${EXPLORER}/tx/${tx.hash}`, proof });
    }

    if (step === "repay") {
      const tourist = wallets.tourist();
      const v = vault(tourist);
      const owed: bigint = await v.amountOwed(claimId);
      if (owed === BigInt(0)) return NextResponse.json({ error: "Nothing owed on this claim." }, { status: 409 });
      const s = stable(tourist);
      // The demo tourist "receives" the refund at the airport: top up from the test faucet if needed.
      const bal: bigint = await s.balanceOf(tourist.address);
      if (bal < owed) await (await s.faucet(owed - bal)).wait();
      await (await s.approve(await v.getAddress(), owed)).wait();
      const tx = await v.repay(claimId);
      await tx.wait();
      return NextResponse.json({ ok: true, txHash: tx.hash, txUrl: `${EXPLORER}/tx/${tx.hash}` });
    }

    return NextResponse.json({ error: "Unknown step" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: chainError(e) }, { status: 500 });
  }
}
