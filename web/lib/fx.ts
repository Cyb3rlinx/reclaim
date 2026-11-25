import { ethers } from "ethers";

// THB -> USD rate.
// 1st choice: Atlas Oracle THB/USD feed on BSC testnet (Chainlink-style AggregatorV3 interface).
// 2nd choice: free public FX API. Last resort: a clearly labeled fixed fallback.
const ATLAS_THB_USD = process.env.ATLAS_THB_USD_FEED || "0x9f9cb4f972edd5bd59ca045f10821d8a2588bf4e";
const ATLAS_RPC = process.env.ATLAS_RPC || "https://bsc-testnet-rpc.publicnode.com";
const MAX_AGE_SEC = Number(process.env.ATLAS_MAX_AGE_SEC || 7 * 86_400);
const FALLBACK_USD_PER_THB = 0.0286;

const FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

export type FxQuote = { usdPerThb: number; source: string; asOf: string };

let cache: { quote: FxQuote; at: number } | null = null;

async function fromAtlas(): Promise<FxQuote | null> {
  try {
    const provider = new ethers.JsonRpcProvider(ATLAS_RPC, 97, { staticNetwork: true });
    const feed = new ethers.Contract(ATLAS_THB_USD, FEED_ABI, provider);
    const [decimals, round] = await Promise.all([feed.decimals(), feed.latestRoundData()]);
    const answer = round[1] as bigint;
    const updatedAt = Number(round[3]);
    if (answer <= BigInt(0)) return null;
    if (Date.now() / 1000 - updatedAt > MAX_AGE_SEC) return null; // stale feed -> fall back
    const usdPerThb = Number(ethers.formatUnits(answer, decimals));
    return { usdPerThb, source: "Atlas Oracle (BSC testnet)", asOf: new Date(updatedAt * 1000).toISOString() };
  } catch {
    return null;
  }
}

async function fromPublicApi(): Promise<FxQuote | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/THB", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    const rate = Number(data?.rates?.USD);
    if (data?.result === "success" && rate > 0) {
      return { usdPerThb: rate, source: "open.er-api.com", asOf: data.time_last_update_utc ?? new Date().toISOString() };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function thbToUsdRate(): Promise<FxQuote> {
  if (cache && Date.now() - cache.at < 60_000) return cache.quote;
  const quote = (await fromAtlas()) ?? (await fromPublicApi());
  if (quote) {
    cache = { quote, at: Date.now() };
    return quote;
  }
  return { usdPerThb: FALLBACK_USD_PER_THB, source: "fallback (offline)", asOf: new Date().toISOString() };
}
