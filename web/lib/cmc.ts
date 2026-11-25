// CoinMarketCap Pro API: a second, independent market-data source.
// 1) THB->USD fiat conversion, cross-checked against the Atlas on-chain price.
// 2) USDT price, so advances pause if the stablecoin loses its $1 peg.
// The API key stays server-side (CMC_API_KEY); it is never sent to the browser.
const BASE = "https://pro-api.coinmarketcap.com";
const THB_ID = 2809; // CMC fiat id for Thai baht
const USD_ID = 2781; // CMC fiat id for US dollar
const USDT_ID = 825; // Tether
export const MAX_SOURCE_DEVIATION_PCT = 1.5;
export const PEG_BAND = 0.02; // stablecoin must trade within $0.98–$1.02

export type MarketCheck = {
  configured: boolean;
  cmcUsdPerThb?: number;
  deviationPct?: number;
  usdtUsd?: number;
  sourcesAgree?: boolean;
  pegOk?: boolean;
  asOf?: string;
  error?: string;
};

let cache: { at: number; thb: number; usdt: number; asOf: string } | null = null;

async function cmc(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-CMC_PRO_API_KEY": process.env.CMC_API_KEY!, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  const json = await res.json();
  if (!res.ok || json?.status?.error_code) throw new Error(json?.status?.error_message || `CMC HTTP ${res.status}`);
  return json;
}

export async function marketCheck(atlasUsdPerThb: number): Promise<MarketCheck> {
  if (!process.env.CMC_API_KEY) return { configured: false };
  try {
    if (!cache || Date.now() - cache.at > 60_000) {
      const [conv, usdt] = await Promise.all([
        cmc(`/v2/tools/price-conversion?amount=1&id=${THB_ID}&convert_id=${USD_ID}`),
        cmc(`/v2/cryptocurrency/quotes/latest?id=${USDT_ID}&convert_id=${USD_ID}`),
      ]);
      const convData = Array.isArray(conv.data) ? conv.data[0] : conv.data;
      const thb = Number(convData?.quote?.[USD_ID]?.price);
      const usdtQuote = usdt.data?.[USDT_ID] ?? usdt.data?.[String(USDT_ID)];
      const usdtPrice = Number(usdtQuote?.quote?.[USD_ID]?.price);
      if (!(thb > 0) || !(usdtPrice > 0)) throw new Error("Unexpected CMC response");
      cache = { at: Date.now(), thb, usdt: usdtPrice, asOf: convData?.last_updated ?? new Date().toISOString() };
    }
    const deviationPct = (Math.abs(cache.thb - atlasUsdPerThb) / atlasUsdPerThb) * 100;
    return {
      configured: true,
      cmcUsdPerThb: cache.thb,
      deviationPct,
      usdtUsd: cache.usdt,
      sourcesAgree: deviationPct <= MAX_SOURCE_DEVIATION_PCT,
      pegOk: Math.abs(cache.usdt - 1) <= PEG_BAND,
      asOf: cache.asOf,
    };
  } catch (e) {
    return { configured: true, error: (e as Error).message };
  }
}
