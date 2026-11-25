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

Every advance is sized with the Atlas price: the advance quote, the on-chain `refundAmount` and the fee all depend on it.

## How it is read (`web/lib/fx.ts`)

```ts
const feed = new ethers.Contract(ATLAS_THB_USD, [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
], provider);
const [decimals, round] = await Promise.all([feed.decimals(), feed.latestRoundData()]);
const usdPerThb = Number(ethers.formatUnits(round[1], decimals));
```

**Safety rules around the feed**

- **Stale price:** if `updatedAt` is older than 7 days (configurable with `ATLAS_MAX_AGE_SEC`), the price is rejected.
- **Invalid price:** an answer ≤ 0 is rejected.
- **Fallback:** a public FX API is used if Atlas is unreachable, and then a fixed rate. **The UI always shows which source priced the advance**, so a fallback is never hidden.
- **Cache:** the price is cached for only 60 seconds, so quotes track the feed closely.
- **Config:** the feed address and RPC can be set with `ATLAS_THB_USD_FEED` / `ATLAS_RPC`, so they can move to mainnet without code changes.

## Proof it works (live on BSC testnet)

Demo receipt: 127,000 THB, VAT 8,308.41 THB, estimated refund 7,062.14 THB.

| | Atlas price | Refund | Advance (80%) | Fee (5%) | Transactions |
|---|---|---|---|---|---|
| Claim #1 | 0.029304 | $206.94 | $165.55 | $10.35 | [advance](https://testnet.bscscan.com/tx/0x9943b5550a7494f9a71ad7fe51b440f3af63a7528a4949eea586c87a8ab70730) · [attest](https://testnet.bscscan.com/tx/0x9f66b923724e714eed172f45ed2d039ec249c01c7b88dff6632e2d5d5b160ec9) · [repay](https://testnet.bscscan.com/tx/0xe04e3099af256da714c2dadb0b9f7b9f2ae1433c8027a7c489dc5e9e47053cca) |
| Claim #2 | 0.029300 | $206.92 | $165.54 | $10.35 | settled through the app UI |

The price moved between the two claims, and the advance moved with it. The UI shows the price, for example `THB/USD 0.02930 · Atlas Oracle (BSC testnet)`, on the offer card before the tourist confirms.

**Run it yourself:** follow the README, open the app, tap **Use demo receipt** and read the price source on the offer card.

## Why Atlas and not an off-chain FX API

The advance is paid on-chain, so its price input should be **verifiable on-chain**. Anyone can re-read the same `latestRoundData()` on BscScan and check the advance math. A CoinMarketCap-backed oracle on BNB Chain gives the pool's lenders a public, auditable reason for every dollar that leaves the pool.

## Next steps

1. **Enforce the price inside the contract.** `ReclaimVault.issueAdvance` would read the Atlas feed itself and reject any advance whose USD amount differs from `refundTHB × price` by more than a small tolerance. The agent then can't over-advance, even if its server is compromised.
2. Move to **BSC mainnet** feeds when Reclaim launches with real liquidity (for example, Lista DAO lisUSD).
3. Add more refund markets (EUR, JPY, KRW, SGD tax-free schemes), each priced by its own Atlas feed.
