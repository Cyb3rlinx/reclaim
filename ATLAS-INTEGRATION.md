# Reclaim × Atlas Oracle: integration write-up

**Track:** CoinMarketCap × Atlas · **Team:** Reclaim (BNB Bangkok 2026) · **Repo:** https://github.com/Cyb3rlinx/reclaim

## The problem the feed solves

Reclaim advances tourists their Thai VAT refund **in US-dollar stablecoins**, but the refund itself is fixed **in Thai baht**. Every advance is a currency conversion. If the THB→USD rate is wrong, the protocol either under-pays the tourist or lends out more than the refund can repay, and liquidity providers lose money. The exchange rate is therefore not decoration: **it decides how much money leaves the pool.**

## What we use

| | |
|---|---|
| Feed | Atlas Oracle **THB/USD** (`description()` = `SingleFeed THB/USD`) |
| Network | BNB Smart Chain **testnet** (chainId 97) |
| Address | [`0x9f9cb4f972edd5bd59ca045f10821d8a2588bf4e`](https://testnet.bscscan.com/address/0x9f9cb4f972edd5bd59ca045f10821d8a2588bf4e) |
| Read on-chain by | `ReclaimVault` [`0x90E1380c52b5F7DF86867Da6B0234256b16F59E6`](https://testnet.bscscan.com/address/0x90E1380c52b5F7DF86867Da6B0234256b16F59E6) (`setPriceFeed`, tolerance 1%, max age 7 days) |
| Interface | Chainlink-compatible `AggregatorV3` (`decimals()` = 18, `latestRoundData()`) |
| Observed updates | 25 Nov 2026: 08:56, 09:31 and 11:09 UTC (rate ≈ 0.0293 USD per THB) |

## Where it sits in the core flow

```
receipt photo → AI agent (Claude Haiku 5.5) reads it → 6 Thai VAT-refund rule checks
   → refund in THB (85% of VAT, after airport operator fees)
   → × Atlas THB/USD  ← here
   → refund in USD → advance = 80% · fee = 5%
   → ReclaimVault.issueAdvance() pays the tourist on BSC and mints the claim NFT
```

Atlas is used **twice**: the agent sizes the advance with it off-chain, and then **the vault contract re-reads the same feed on-chain** and rejects the advance if the numbers disagree. The price used is stored in every claim (`usdPerThb`).

## How it is read: 1) the agent (`web/lib/fx.ts`)

```ts
const feed = new ethers.Contract(ATLAS_THB_USD, [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
], provider);
const [decimals, round] = await Promise.all([feed.decimals(), feed.latestRoundData()]);
const usdPerThb = Number(ethers.formatUnits(round[1], decimals));
```

## 2) The vault enforces it on-chain (`contracts/ReclaimVault.sol`)

```solidity
(, int256 answer,, uint256 updatedAt,) = thbUsdFeed.latestRoundData();
if (answer <= 0) revert InvalidPrice(answer);
if (updatedAt + maxPriceAge < block.timestamp) revert StalePrice(updatedAt);
uint256 expectedUsd = Math.mulDiv(refundThb, usdPerThb, 1e18);   // price normalized to 18 decimals
if (|expectedUsd - statedUsd| * 10_000 > expectedUsd * priceToleranceBps) revert PriceMismatch(expectedUsd, statedUsd);
```

**Safety rules around the feed**

- **On-chain tolerance:** the vault allows a 1% difference (`priceToleranceBps = 100`), enough for cent rounding but nothing more.
- **Stale price:** if `updatedAt` is older than 7 days (configurable with `ATLAS_MAX_AGE_SEC`), the price is rejected.
- **Invalid price:** an answer ≤ 0 is rejected.
- **Fallback:** a public FX API is used if Atlas is unreachable, and then a fixed rate. **The UI always shows which source priced the advance**, so a fallback is never hidden.
- **Cache:** the price is cached for only 60 seconds, so quotes track the feed closely. If the server ever fell back to another FX source that disagrees with Atlas, the vault would reject the advance.
- **Config:** the feed address and RPC can be set with `ATLAS_THB_USD_FEED` / `ATLAS_RPC`, so they can move to mainnet without code changes.

## Proof it works (live on BSC testnet)

Demo receipt: 127,000 THB, VAT 8,308.41 THB, estimated refund 7,062.14 THB.

| | Atlas price | Refund | Advance (80%) | Fee (5%) | Transactions |
|---|---|---|---|---|---|
| Claim #1 | 0.02930205 | $206.93 | $165.54 | $10.35 | [advance](https://testnet.bscscan.com/tx/0x928d6340436f11b94f48399ce66bc4a75f997e2f231f8d539c7621ff230ad3fd) · [attest](https://testnet.bscscan.com/tx/0x491027061aadfee3e2cf49268a09d5cbb9a9fcd9f2759aa68944a8541d0ba700) · [repay](https://testnet.bscscan.com/tx/0x8ba0d3265d094d6718a5a0880c318d567abfe8fe8ae2f6f27e4bf48327d3e518) |
| Inflated by 30% | 0.02930205 | stated $269.02 | — | — | **rejected:** `PriceMismatch(206.94, 269.02)` · [failed tx](https://testnet.bscscan.com/tx/0xb13b658871a646cd20dc365f273401537361a5e46fa278aa5d221846111b166f) |

The vault stores the Atlas price inside the claim (`getClaim(1).usdPerThb = 0.02930205`), and an agent that overstates the refund is stopped by the contract, not by trust. The UI shows the price, for example `THB/USD 0.02930 · Atlas Oracle (BSC testnet)`, on the offer card before the tourist confirms.

**Run it yourself:** follow the README, open the app, tap **Use demo receipt** and read the price source on the offer card.

## Why Atlas and not an off-chain FX API

The advance is paid on-chain, so its price input should be **verifiable on-chain**. Anyone can re-read the same `latestRoundData()` on BscScan and check the advance math. A CoinMarketCap-backed oracle on BNB Chain gives the pool's lenders a public, auditable reason for every dollar that leaves the pool.

## Next steps

Move to **BSC mainnet** feeds when Reclaim launches with real liquidity (for example, Lista DAO lisUSD), and add more refund markets (EUR, JPY, KRW, SGD tax-free schemes), each priced by its own Atlas feed.
