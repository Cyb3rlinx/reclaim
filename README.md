# Reclaim — your VAT refund, today

> Built at **BNB Bangkok 2026** (Developer Track · CoinMarketCap × Atlas Challenge).

Tourists in Thailand pay 7% VAT and can claim it back, but only **at the airport, on the day they leave**: up to 60 days later, after a queue, holding a paper form they cannot lose. Until then their own money is locked.

**Reclaim** is an AI agent on BNB Chain that reads a shopping receipt, checks it against the Thai VAT-refund rules, mints the refund right as an on-chain claim (an RWA), and **advances 80% of the refund in stablecoins instantly**. When the tourist collects the real refund at the airport, they repay the advance plus a fee of 5% of the refund, and the liquidity pool earns that fee.

```
receipt photo ──► AI agent reads it ──► rule + price checks ──► Reclaim Receipt NFT minted
                                                              │
tourist gets 80% now ◄── ReclaimVault (ERC-4626 pool) ◄───────┘
        │
   airport refund ──► oracle attests ──► tourist repays advance + fee ──► LPs earn the fee
```

## What is on-chain (BNB Smart Chain)

| Contract | What it does |
|---|---|
| `ReclaimVault` | ERC-4626 liquidity pool. Lenders deposit stablecoins and receive pool shares. `issueAdvance` (agent only) pays the tourist and records the claim; `attestRefund` (oracle only) stores the evidence; `repay` closes the claim; `markDefault` writes off unpaid claims after the deadline + 7 days. |
| `ReclaimReceipt` | ERC-721. One token per verified receipt: the tokenized refund right. Only the vault can mint. |
| `MockUSD` | Testnet stablecoin standing in for lisUSD / USDT. |
| Atlas Oracle feed (external) | THB/USD price used to size every advance (`web/lib/fx.ts`). |

**Safety rules in the contract**
- The same receipt can never be financed twice (`claimIdByReceipt`, keyed by a hash of tax ID + receipt number + date + total).
- Only the agent can issue advances and only the oracle can attest (OpenZeppelin `AccessControl`).
- Lenders can only withdraw idle cash, never money that is currently lent out.
- Per-claim cap and configurable advance/fee terms (`advance + fee ≤ 100%`).
- **On-chain price check:** every advance is re-priced with the Atlas Oracle THB/USD feed. The agent states the refund in THB and in USD; the vault rejects it if they differ by more than 1% (`PriceMismatch`), if the feed is older than 7 days (`StalePrice`) or if the price is invalid. A compromised agent server cannot over-advance.

**Live app (Cloudflare Workers, BSC testnet):** https://reclaim.interactive-archetype-journey.workers.dev
- Event QR poster: https://reclaim.interactive-archetype-journey.workers.dev/poster · UI board: https://reclaim.interactive-archetype-journey.workers.dev/mockup.html

**Demo video (2:02, real AI read + Atlas + CoinMarketCap + live BSC testnet transactions):** [launch/reclaim-demo.mp4](launch/reclaim-demo.mp4)

**Sponsor integration:** every advance is priced with the Atlas Oracle THB/USD feed on BSC (enforced on-chain) and cross-checked live with the **CoinMarketCap Pro API** (`/v2/tools/price-conversion` for THB→USD and the tourist's currency, `/v1/cryptocurrency/quotes/latest` for the USDT/USDC/FDUSD peg check) — see [ATLAS-INTEGRATION.md](ATLAS-INTEGRATION.md) ([PDF](ATLAS-INTEGRATION.pdf)). The CMC key is a server-side Cloudflare secret (`CMC_API_KEY`); without it the app falls back to public sources and labels them in the UI.

## Live on BNB Smart Chain testnet (chainId 97)

| Contract | Address |
|---|---|
| ReclaimVault (ERC-4626 pool) | [`0x90E1380c52b5F7DF86867Da6B0234256b16F59E6`](https://testnet.bscscan.com/address/0x90E1380c52b5F7DF86867Da6B0234256b16F59E6) |
| ReclaimReceipt (ERC-721) | [`0x0aB31E6fCFE3cBbAab3794cd7bFF24C679588B96`](https://testnet.bscscan.com/address/0x0aB31E6fCFE3cBbAab3794cd7bFF24C679588B96) |
| MockUSD (test stablecoin) | [`0x1ec05faE5e22055a8351fCD9A7404BbcDd51070C`](https://testnet.bscscan.com/address/0x1ec05faE5e22055a8351fCD9A7404BbcDd51070C) |
| Atlas Oracle THB/USD feed | [`0x9f9cb4f972edd5bd59ca045f10821d8a2588bf4e`](https://testnet.bscscan.com/address/0x9f9cb4f972edd5bd59ca045f10821d8a2588bf4e) |

Full cycle on the current vault (claim #1, priced on-chain by Atlas at 0.02930205 USD/THB): [advance](https://testnet.bscscan.com/tx/0x928d6340436f11b94f48399ce66bc4a75f997e2f231f8d539c7621ff230ad3fd) → [refund attested](https://testnet.bscscan.com/tx/0x491027061aadfee3e2cf49268a09d5cbb9a9fcd9f2759aa68944a8541d0ba700) → [repaid](https://testnet.bscscan.com/tx/0x8ba0d3265d094d6718a5a0880c318d567abfe8fe8ae2f6f27e4bf48327d3e518). The pool went from 20,000 to 20,010.35 after the fee.

**Price guard, proven on testnet:** the agent tried to advance against a refund overstated by 30% ($269.02 instead of the Atlas-priced $206.94). The vault reverted with `PriceMismatch(206.94, 269.02)`: [failed tx](https://testnet.bscscan.com/tx/0xb13b658871a646cd20dc365f273401537361a5e46fa278aa5d221846111b166f). Reproduce: `npx hardhat run scripts/prove-price-guard.js --network bscTestnet`.

An earlier version of the vault (without the on-chain price check) ran the first cycles at `0x3AA2275CFDdED1e638C77edC3B480926f1b569f3`.

## What the agent checks

Rules come from the Thai Revenue Department's VAT Refund for Tourists scheme:

1. The seller is VAT-registered (13-digit tax ID).
2. At least 2,000 THB on the receipt.
3. The VAT printed matches 7% of the total.
4. The purchase is inside the 60-day export window.
5. The store issued the refund form (P.P.10 / e-P.P.10).
6. The refund is large enough to advance.

The expected refund is estimated conservatively at 85% of the VAT, because airport operators keep a tiered fee. The receipt is read by Claude Haiku 5.5 (vision + structured JSON output). Personal identifiers such as passport numbers are not extracted.

## Run it locally (about 5 minutes)

Requirements: Node.js 20+.

```bash
# 1. Contracts: install, test, start a local chain
cd contracts
npm install
npx hardhat test                 # 17 tests
cp .env.example .env             # add test-only private keys (see file)
npx hardhat node                 # leave running in its own terminal

# 2. Deploy to the local chain (writes web/lib/deployment.json and web/.env.local)
WEB_RPC=http://127.0.0.1:8545 npx hardhat run scripts/deploy.js --network localhost

# 3. Web app
cd ../web
npm install
npm run dev -- -p 3210           # open http://localhost:3210
```

Click **Sample P.P.10 photo** (the AI agent reads a bundled demo P.P.10 form; needs `ANTHROPIC_API_KEY`) or **Use demo receipt** (no key needed) → **Get $… now** → **Simulate airport refund** → **Repay**.
To read real receipt photos, add `ANTHROPIC_API_KEY=...` to `web/.env.local`.

### Deploy the web app to Cloudflare Workers

```bash
cd web
npx wrangler login
npm run cf:deploy     # builds without local .env files, so no secret is baked in
npm run cf:secrets    # copies server keys from .env.local into Worker secrets
```

### Deploy to BSC testnet

```bash
cd contracts
npx hardhat run scripts/deploy.js --network bscTestnet
```

The deployer wallet needs a little tBNB for gas. The script seeds the pool and funds the agent and the demo tourist wallets.

## Business model

- **Revenue:** a 5% fee on each advance, paid when the tourist repays. It goes to liquidity providers, and a protocol share can be added later.
- **Market:** tens of millions of foreign visitors a year shop in Thailand, and the same tax-free scheme exists across the EU, Japan, Korea and Singapore.
- **Path:** partner with VAT-refund operators and stores (point-of-sale integration), use real stablecoin liquidity (e.g. Lista DAO lisUSD lending), and add an AI resolution oracle that reads the airport refund record.
- **Risk controls:** advance only 80% of a conservative estimate, cap each claim, block duplicate receipts, and hold a card pre-authorization for the **full amount owed (advance + the 5% lender fee)** as collateral in production, as downtown refund services already do, so a defaulting tourist is charged the lenders’ fee too, not just the principal.

## Status and honest limits

- Testnet prototype. The oracle attestation and the airport refund are **simulated** in the demo.
- The THB→USD rate is read on-chain from the **Atlas Oracle THB/USD feed on BSC testnet** (`0x9f9cb4f972edd5bd59ca045f10821d8a2588bf4e`, 18 decimals, AggregatorV3 interface). If the feed is unreachable or older than 7 days, the app falls back to a public FX API and labels the source in the UI.
- Not financial advice. No token is issued by this project.

## Repo layout

```
contracts/   Solidity + Hardhat (ReclaimVault, ReclaimReceipt, MockUSD, tests, deploy script)
web/         Next.js app: agent API routes (parse, advance, settle, state) + demo UI
```
