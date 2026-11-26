import { NextResponse } from "next/server";
import { thbToUsdRate } from "@/lib/fx";
import { isCurrency, localRate, stablecoinPegs } from "@/lib/market";

export const runtime = "nodejs";

/** Prices for the home screen: Atlas THB/USD, THB in the tourist's currency, stablecoin pegs. */
export async function GET(req: Request) {
  const c = new URL(req.url).searchParams.get("currency");
  const currency = isCurrency(c) ? c : "USD";
  const [fx, local, pegs] = await Promise.all([thbToUsdRate(), localRate(currency), stablecoinPegs()]);
  return NextResponse.json({ fx, local, pegs });
}
