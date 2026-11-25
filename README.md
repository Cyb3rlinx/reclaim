# Reclaim — your VAT refund, today

> Built at **BNB Bangkok 2026** (Developer Track).

Tourists in Thailand pay 7% VAT and can claim it back, but only **at the airport, on the day they leave**: up to 60 days later, after a queue, holding a paper form they cannot lose. Until then their own money is locked.

**Reclaim** is an AI agent on BNB Chain that reads a shopping receipt, checks it against the Thai VAT-refund rules, mints the refund right as an on-chain claim (an RWA), and **advances 80% of the refund in stablecoins instantly**. When the tourist collects the real refund at the airport, they repay the advance plus a 5% fee, and the liquidity pool earns that fee.

```
receipt photo ──► AI agent reads it ──► 6 rule checks ──► Reclaim Receipt NFT minted
                                                              │
tourist gets 80% now ◄── ReclaimVault (ERC-4626 pool) ◄───────┘
        │
   airport refund ──► oracle attests ──► tourist repays advance + 5% ──► LPs earn the fee
```

## What is on-chain (BNB Smart Chain)

| Contract | What it does |
|---|---|
| `ReclaimVault` | ERC-4626 liquidity pool. Lenders deposit stablecoins and receive pool shares. `issueAdvance` (agent only) pays the tourist and records the claim; `attestRefund` (oracle only) stores the evidence; `repay` closes the claim; `markDefault` writes off unpaid claims after the deadline + 7 days. |
| `ReclaimReceipt` | ERC-721. One token per verified receipt: the tokenized refund right. Only the vault can mint. |
| `MockUSD` | Testnet stablecoin standing in for lisUSD / USDT. |

**Safety rules in the contract**
- The same receipt can never be financed twice (`claimIdByReceipt`, keyed by a hash of tax ID + receipt number + date + total).
- Only the agent can issue advances and only the oracle can attest (OpenZeppelin `AccessControl`).
- Lenders can only withdraw idle cash, never money that is currently lent out.
- Per-claim cap and configurable advance/fee terms (`advance + fee ≤ 100%`).

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
npx hardhat test                 # 9 tests
cp .env.example .env             # add test-only private keys (see file)
npx hardhat node                 # leave running in its own terminal

# 2. Deploy to the local chain (writes web/lib/deployment.json and web/.env.local)
WEB_RPC=http://127.0.0.1:8545 npx hardhat run scripts/deploy.js --network localhost

# 3. Web app
cd ../web
npm install
npm run dev -- -p 3210           # open http://localhost:3210
```

Click **Use demo receipt** → **Get $… now** → **Simulate airport refund** → **Repay**.
To read real receipt photos, add `ANTHROPIC_API_KEY=...` to `web/.env.local`.

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
- **Risk controls:** advance only 80% of a conservative estimate, cap each claim, block duplicate receipts, and hold a card pre-authorization as collateral in production (as downtown refund services already do).

## Status and honest limits

- Testnet prototype. The oracle attestation and the airport refund are **simulated** in the demo.
- The THB→USD rate comes from a public FX API; an Atlas price feed is being integrated.
- Not financial advice. No token is issued by this project.

## Repo layout

```
contracts/   Solidity + Hardhat (ReclaimVault, ReclaimReceipt, MockUSD, tests, deploy script)
web/         Next.js app: agent API routes (parse, advance, settle, state) + demo UI
```
