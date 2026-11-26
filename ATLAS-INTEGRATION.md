# Reclaim × Atlas + CoinMarketCap: integration write-up

**Track:** CoinMarketCap × Atlas · **Team:** Reclaim, Kevin Santa Cruz (team lead; contact details on the HackQuest submission) · **Repo:** https://github.com/Cyb3rlinx/reclaim · **Live app:** https://reclaim.interactive-archetype-journey.workers.dev

## The problem and who it is for

Reclaim advances tourists their Thai VAT refund **in US-dollar stablecoins**, but the refund is fixed **in Thai baht**, so every advance is a currency conversion. A wrong THB→USD rate either under-pays the tourist or lends more than the refund can repay, and the pool's lenders lose money: **the price decides how much money leaves the pool.** It is for international tourists shopping in Thailand who want their refund now, and for the stablecoin lenders who fund the advances.

## What we use and why

| Source | What | Why |
|---|---|---|
| **Atlas THB/USD** (BSC testnet) | Feed [`0x9f9cb4f972edd5bd59ca045f10821d8a2588bf4e`](https://testnet.bscscan.com/address/0x9f9cb4f972edd5bd59ca045f10821d8a2588bf4e), AggregatorV3, 18 decimals | Sizes every advance **and is enforced on-chain** by the vault, so the price is verifiable by anyone |
| **CoinMarketCap Pro API** | `/v2/tools/price-conversion` (THB→USD, THB→tourist currency) · `/v1/cryptocurrency/quotes/latest` (USDT, USDC, FDUSD) | An independent second source: cross-checks Atlas, shows the refund in 19 currencies, and checks the stablecoin's $1 peg |

The CMC key lives only on the server (a Cloudflare Worker secret, never in the browser or the repo). Every quote makes live CMC calls (cached 60 s), so usage is verifiable in our key's API logs.

## Where it sits in the core flow

```
receipt photo → AI agent (Claude Haiku 5.5) → Thai VAT-refund rule checks
  → refund in THB (85% of VAT, after operator fees) × Atlas THB/USD     ← Atlas
  → CMC cross-check: Atlas vs CMC within 1.5%  ·  chosen stablecoin within $0.98–$1.02   ← CoinMarketCap
  → advance = 80% of the refund · fee = 5% of the refund · amounts also shown in the tourist's currency (CMC)
  → ReclaimVault.issueAdvance(): re-reads Atlas on-chain, pays on BSC and mints the claim NFT
```

## Atlas is enforced on-chain (`contracts/ReclaimVault.sol`)

```solidity
(, int256 answer,, uint256 updatedAt,) = thbUsdFeed.latestRoundData();
if (answer <= 0) revert InvalidPrice(answer);
if (updatedAt + maxPriceAge < block.timestamp) revert StalePrice(updatedAt);           // 7 days
uint256 expectedUsd = Math.mulDiv(refundThb, usdPerThb, 1e18);
if (|expectedUsd - statedUsd| * 10_000 > expectedUsd * priceToleranceBps) revert PriceMismatch(expectedUsd, statedUsd); // 1%
```

Even a compromised agent server cannot over-advance. The Atlas price is stored in every claim (`usdPerThb`). If CMC is unreachable, the app falls back to public sources and **labels the source on screen**; Atlas is always enforced on-chain.

## Proof it works (live)

| | Result |
|---|---|
| Claim #1, full cycle | Atlas 0.02930205 · refund $206.93 · advance $165.54 · [advance](https://testnet.bscscan.com/tx/0x928d6340436f11b94f48399ce66bc4a75f997e2f231f8d539c7621ff230ad3fd) · [attest](https://testnet.bscscan.com/tx/0x491027061aadfee3e2cf49268a09d5cbb9a9fcd9f2759aa68944a8541d0ba700) · [repay](https://testnet.bscscan.com/tx/0x8ba0d3265d094d6718a5a0880c318d567abfe8fe8ae2f6f27e4bf48327d3e518) |
| Advance inflated by 30% | **rejected** `PriceMismatch(206.94, 269.02)` · [failed tx](https://testnet.bscscan.com/tx/0xb13b658871a646cd20dc365f273401537361a5e46fa278aa5d221846111b166f) |
| CMC cross-check (27 Nov) | CMC 0.02939 vs Atlas 0.02937 USD/THB: **0.04% apart** → passed · USDC $1.0000, USDT $0.9988, FDUSD $0.9948 |

**Run it yourself:** open the live app, tap **Sample P.P.10 photo** and read the checks ("Price sources agree (Atlas vs CoinMarketCap)", "USDC holds its $1 peg") and the price sources on the offer card.

## Next steps

Move to **BSC mainnet** feeds with real liquidity (Lista DAO lisUSD), use CMC data to pause advances automatically when markets move fast, and add more tax-free markets (EUR, JPY, KRW, SGD), each priced by its own Atlas feed and cross-checked with CoinMarketCap.
