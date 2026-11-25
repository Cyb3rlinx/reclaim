// THB -> USD rate. Live from a free public FX endpoint, with a clearly labeled fallback.
// TODO(Atlas): swap for an Atlas price feed if they expose THB/USD.
const FALLBACK_USD_PER_THB = 0.0286;

export type FxQuote = { usdPerThb: number; source: string; asOf: string };

let cache: { quote: FxQuote; at: number } | null = null;

export async function thbToUsdRate(): Promise<FxQuote> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.quote;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/THB", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    const rate = Number(data?.rates?.USD);
    if (data?.result === "success" && rate > 0) {
      const quote = { usdPerThb: rate, source: "open.er-api.com", asOf: data.time_last_update_utc ?? new Date().toISOString() };
      cache = { quote, at: Date.now() };
      return quote;
    }
  } catch {
    // fall through to fallback
  }
  return { usdPerThb: FALLBACK_USD_PER_THB, source: "fallback (offline)", asOf: new Date().toISOString() };
}
