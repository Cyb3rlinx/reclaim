// Market data the tourist sees: their refund in their own currency, and which stablecoin
// is holding its $1 peg best. CoinMarketCap is the primary source (CMC_API_KEY, server-side);
// free public APIs are the labeled fallback so the app keeps working without a key.
const CMC = "https://pro-api.coinmarketcap.com";
const THB_ID = 2809; // CMC fiat id for Thai baht

export const CURRENCIES = [
  "USD", "EUR", "GBP", "CNY", "JPY", "KRW", "INR", "AUD", "SGD", "MYR",
  "RUB", "AED", "CAD", "CHF", "ARS", "BRL", "MXN", "CLP", "COP",
] as const;
export type Currency = (typeof CURRENCIES)[number];

export const STABLECOINS = ["USDT", "USDC", "FDUSD"] as const;
export type Stablecoin = (typeof STABLECOINS)[number];
const GECKO_IDS: Record<Stablecoin, string> = { USDT: "tether", USDC: "usd-coin", FDUSD: "first-digital-usd" };
export const PEG_BAND = 0.02; // a stablecoin must trade within $0.98–$1.02 to be offered

export type LocalRate = { currency: Currency; perThb: number; source: string };
export type Peg = { symbol: Stablecoin; price: number; deviationPct: number; ok: boolean };
export type Pegs = { coins: Peg[]; recommended: Stablecoin | null; source: string };

const hasCmc = () => !!process.env.CMC_API_KEY;

async function cmc(path: string) {
  const res = await fetch(`${CMC}${path}`, {
    headers: { "X-CMC_PRO_API_KEY": process.env.CMC_API_KEY!, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  const json = await res.json();
  if (!res.ok || json?.status?.error_code) throw new Error(json?.status?.error_message || `CMC HTTP ${res.status}`);
  return json;
}

export function isCurrency(c: unknown): c is Currency {
  return typeof c === "string" && (CURRENCIES as readonly string[]).includes(c);
}

// ---------- THB -> tourist's currency ----------
const rateCache = new Map<Currency, { at: number; rate: LocalRate }>();
let erCache: { at: number; rates: Record<string, number> } | null = null;

async function fromCmc(currency: Currency): Promise<LocalRate | null> {
  try {
    const j = await cmc(`/v2/tools/price-conversion?amount=1&id=${THB_ID}&convert=${currency}`);
    const d = Array.isArray(j.data) ? j.data[0] : j.data;
    const perThb = Number(d?.quote?.[currency]?.price);
    return perThb > 0 ? { currency, perThb, source: "CoinMarketCap" } : null;
  } catch {
    return null;
  }
}

async function fromErApi(currency: Currency): Promise<LocalRate | null> {
  try {
    if (!erCache || Date.now() - erCache.at > 10 * 60_000) {
      const res = await fetch("https://open.er-api.com/v6/latest/THB", { cache: "no-store", signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      if (data?.result !== "success") return null;
      erCache = { at: Date.now(), rates: data.rates };
    }
    const perThb = Number(erCache.rates[currency]);
    return perThb > 0 ? { currency, perThb, source: "open.er-api.com" } : null;
  } catch {
    return null;
  }
}

export async function localRate(currency: Currency): Promise<LocalRate | null> {
  const hit = rateCache.get(currency);
  if (hit && Date.now() - hit.at < 60_000) return hit.rate;
  const rate = (hasCmc() ? await fromCmc(currency) : null) ?? (await fromErApi(currency));
  if (rate) rateCache.set(currency, { at: Date.now(), rate });
  return rate;
}

// ---------- stablecoin pegs ----------
let pegCache: { at: number; pegs: Pegs } | null = null;

function buildPegs(prices: Partial<Record<Stablecoin, number>>, source: string): Pegs {
  const coins = STABLECOINS.filter((s) => (prices[s] ?? 0) > 0).map((symbol) => {
    const price = prices[symbol]!;
    const dev = Math.abs(price - 1);
    return { symbol, price, deviationPct: dev * 100, ok: dev <= PEG_BAND };
  });
  const best = coins.filter((c) => c.ok).sort((a, b) => a.deviationPct - b.deviationPct)[0];
  return { coins, recommended: best?.symbol ?? null, source };
}

async function pegsFromCmc(): Promise<Pegs | null> {
  try {
    const j = await cmc(`/v1/cryptocurrency/quotes/latest?symbol=${STABLECOINS.join(",")}&convert=USD`);
    const prices: Partial<Record<Stablecoin, number>> = {};
    for (const s of STABLECOINS) prices[s] = Number(j.data?.[s]?.quote?.USD?.price);
    const pegs = buildPegs(prices, "CoinMarketCap");
    return pegs.coins.length ? pegs : null;
  } catch {
    return null;
  }
}

async function pegsFromGecko(): Promise<Pegs | null> {
  try {
    const ids = STABLECOINS.map((s) => GECKO_IDS[s]).join(",");
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, {
      // CoinGecko answers 403 to requests without a User-Agent (Cloudflare Workers send none).
      headers: { "User-Agent": "reclaim-demo/1.0", Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    const j = await res.json();
    const prices: Partial<Record<Stablecoin, number>> = {};
    for (const s of STABLECOINS) prices[s] = Number(j?.[GECKO_IDS[s]]?.usd);
    const pegs = buildPegs(prices, "CoinGecko");
    return pegs.coins.length ? pegs : null;
  } catch {
    return null;
  }
}

// Last resort: Kraken's public ticker (USDT and USDC only; it does not list FDUSD).
async function pegsFromKraken(): Promise<Pegs | null> {
  try {
    const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=USDTUSD,USDCUSD", {
      headers: { "User-Agent": "reclaim-demo/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    const r = (await res.json())?.result ?? {};
    const pegs = buildPegs({ USDT: Number(r.USDTZUSD?.c?.[0]), USDC: Number(r.USDCUSD?.c?.[0]) }, "Kraken");
    return pegs.coins.length ? pegs : null;
  } catch {
    return null;
  }
}

export async function stablecoinPegs(): Promise<Pegs> {
  if (pegCache && Date.now() - pegCache.at < 60_000) return pegCache.pegs;
  const pegs = (hasCmc() ? await pegsFromCmc() : null) ?? (await pegsFromGecko()) ?? (await pegsFromKraken());
  if (pegs) {
    pegCache = { at: Date.now(), pegs };
    return pegs;
  }
  return { coins: [], recommended: null, source: "unavailable" };
}
