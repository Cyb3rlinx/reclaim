import { NextResponse } from "next/server";
import { formatEther } from "ethers";
import deployment from "@/lib/deployment.json";
import { EXPLORER, chainError, isDeployed, readClaim, stable, vault, wallets } from "@/lib/chain";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isDeployed()) return NextResponse.json({ deployed: false });
  const claimId = Number(new URL(req.url).searchParams.get("claim") || 0);
  try {
    const v = vault();
    const [totalAssets, outstanding, idle, nextId] = await Promise.all([
      v.totalAssets(),
      v.outstandingPrincipal(),
      stable().balanceOf(deployment.vault),
      v.nextClaimId(),
    ]);
    let touristAddress: string | null = null;
    try {
      touristAddress = wallets.tourist().address;
    } catch {}
    return NextResponse.json({
      deployed: true,
      explorer: EXPLORER,
      addresses: { vault: deployment.vault, stable: deployment.stable, receipt: deployment.receipt, demoTourist: touristAddress },
      pool: {
        totalAssets: formatEther(totalAssets),
        outstanding: formatEther(outstanding),
        idle: formatEther(idle),
        claims: Number(nextId) - 1,
      },
      claim: claimId ? await readClaim(claimId) : null,
    });
  } catch (e) {
    return NextResponse.json({ deployed: true, error: chainError(e) }, { status: 500 });
  }
}
