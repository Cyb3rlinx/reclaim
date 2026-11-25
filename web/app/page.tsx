"use client";

import { useCallback, useEffect, useState } from "react";
import type { Check, ReceiptData } from "@/lib/rules";

type Quote = {
  checks: Check[];
  eligible: boolean;
  vatThb: number;
  refundThb: number;
  refundUsd: number;
  advanceUsd: number;
  feeUsd: number;
  deadline: string;
  fx: { usdPerThb: number; source: string };
  receiptHash: string;
  claimId?: number;
  txUrl?: string;
  tourist?: string;
  error?: string;
};

type Claim = {
  id: number;
  tourist: string;
  status: "None" | "Advanced" | "Settled" | "Defaulted";
  refundAttested: boolean;
  proofURI: string;
  storeName: string;
};

type ChainState = {
  deployed: boolean;
  explorer?: string;
  addresses?: { vault: string; stable: string; receipt: string; demoTourist: string | null };
  pool?: { totalAssets: string; outstanding: string; idle: string; claims: number };
  claim?: Claim | null;
  error?: string;
};

const thb = (n: number) => `฿${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const usd = (n: number | string) => `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [parseNote, setParseNote] = useState<string>("");
  const [isDemo, setIsDemo] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [tourist, setTourist] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainState | null>(null);
  const [claimId, setClaimId] = useState<number | null>(null);
  const [txs, setTxs] = useState<{ label: string; url: string }[]>([]);

  const refresh = useCallback(async (id = claimId) => {
    const r = await fetch(`/api/state${id ? `?claim=${id}` : ""}`, { cache: "no-store" });
    setChain(await r.json());
  }, [claimId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Each step is its own "screen" on a phone: jump back to the top when the stage changes.
  const stage = chain?.claim ? 3 : quote ? 2 : 1;
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [stage]);

  async function scan(demo: boolean) {
    setBusy("scan");
    setError(null);
    setQuote(null);
    setClaimId(null);
    setTxs([]);
    try {
      const fd = new FormData();
      if (demo) fd.set("demo", "1");
      else if (file) fd.set("receipt", file);
      const r = await fetch("/api/parse", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setReceipt(j.receipt);
      setIsDemo(j.demo);
      setParseNote(j.notes || "");
      await runQuote(j.receipt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runQuote(r: ReceiptData) {
    const res = await fetch("/api/advance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt: r }) });
    setQuote(await res.json());
  }

  async function advance() {
    if (!receipt) return;
    setBusy("advance");
    setError(null);
    try {
      const r = await fetch("/api/advance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receipt, tourist: tourist.trim() || undefined, execute: true }),
      });
      const j: Quote = await r.json();
      setQuote(j);
      if (j.claimId) {
        setClaimId(j.claimId);
        await refresh(j.claimId);
      }
      if (j.txUrl) setTxs((t) => [...t, { label: "Advance paid + receipt NFT minted", url: j.txUrl! }]);
      if (!r.ok) throw new Error(j.error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function settle(step: "attest" | "repay") {
    if (!claimId) return;
    setBusy(step);
    setError(null);
    try {
      const r = await fetch("/api/settle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimId, step }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setTxs((t) => [...t, { label: step === "attest" ? "Oracle attested airport refund" : "Advance + fee repaid", url: j.txUrl }]);
      await refresh(claimId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function edit<K extends keyof ReceiptData>(k: K, v: ReceiptData[K]) {
    if (!receipt) return;
    const next = { ...receipt, [k]: v };
    setReceipt(next);
    setQuote(null);
    runQuote(next);
  }

  const claim = chain?.claim;
  const settled = claim?.status === "Settled";
  const attested = !!claim?.refundAttested || settled;
  const owed = quote ? quote.advanceUsd + quote.feeUsd : 0;
  const failed = quote?.checks.filter((c) => !c.ok).length ?? 0;
  const explorer = chain?.explorer;
  const txAttest = txs.find((t) => t.label.startsWith("Oracle"));
  const txRepay = txs.find((t) => t.label.startsWith("Advance +"));

  function reset() {
    setQuote(null);
    setReceipt(null);
    setClaimId(null);
    setTxs([]);
    setFile(null);
    setPreview(null);
    setError(null);
    refresh(0);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[440px] flex-col gap-4 px-5 pb-12 pt-6">
      {/* Brand bar */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-[13px] font-extrabold tracking-[0.24em]">
          <div className="mark">R</div>RECLAIM
        </div>
        <span className="chip">{explorer?.includes("testnet") ? "BSC TESTNET" : "BNB CHAIN"}</span>
      </header>

      {error && (
        <div className="card text-sm" style={{ borderColor: "rgba(255,107,107,.45)", color: "var(--bad)" }}>
          {error}
        </div>
      )}

      {/* ========== STEP 1 · SCAN ========== */}
      {!quote && (
        <>
          <h1 className="mt-1 text-[32px] font-extrabold leading-[1.08] tracking-tight">
            Your VAT refund,
            <br />
            <span className="g">today.</span>
          </h1>
          <p className="muted text-[13.5px] leading-relaxed">
            Shopping in Thailand? Your 7% VAT refund is locked until the airport. Scan your tax invoice: our AI agent checks it
            and pays you up to 80% of your refund in seconds.
          </p>

          <label className="scan">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Receipt preview" className="max-h-64 rounded-lg shadow-2xl" />
            ) : (
              <div className="px-10 text-center">
                <svg className="mx-auto mb-3" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f7d774" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
                  <circle cx="12" cy="12" r="3.2" />
                </svg>
                <div className="text-sm font-semibold">Tap to scan your receipt</div>
                <div className="muted mt-1 text-xs">Tax invoice with the &ldquo;VAT Refund for Tourists&rdquo; sign · JPG / PNG</div>
              </div>
            )}
            <i className="corner c1" />
            <i className="corner c2" />
            <i className="corner c3" />
            <i className="corner c4" />
            {busy === "scan" && <div className="beam" />}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>
          <p className="muted -mt-1 text-center text-[11px]">Cover your passport number. The agent ignores personal IDs.</p>

          <button className="btn btn-primary" disabled={!file || !!busy} onClick={() => scan(false)}>
            {busy === "scan" ? "Agent reading your receipt…" : "Read with AI agent"}
          </button>
          <button className="btn btn-ghost" disabled={!!busy} onClick={() => scan(true)}>
            Use demo receipt
          </button>

          <div className="grid grid-cols-3 gap-2">
            <Pill label="Advance" value="80%" gold />
            <Pill label="Fee" value="5%" />
            <Pill label="Payout" value="~10s" />
          </div>
          <PoolCard chain={chain} />
        </>
      )}

      {/* ========== STEP 2 · VERIFY + OFFER ========== */}
      {quote && receipt && !claim && (
        <>
          <div className="flex items-center justify-between">
            <button className="text-[15px] font-bold" disabled={!!busy} onClick={reset}>
              ‹&nbsp; Agent check
            </button>
            <span className="chip" style={failed ? { color: "var(--bad)", borderColor: "rgba(255,107,107,.4)" } : undefined}>
              {quote.checks.length - failed} / {quote.checks.length} PASSED
            </span>
          </div>

          {isDemo && <div className="chip self-start">DEMO RECEIPT · SAMPLE DATA</div>}
          {!isDemo && parseNote && <p className="muted text-xs">Agent note: {parseNote}</p>}

          <div className="card flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold">{receipt.storeName || "Unknown store"}</div>
              <div className="muted mt-0.5 text-[11.5px]">
                {receipt.receiptNumber || "no receipt no."} · {receipt.purchaseDate}
              </div>
            </div>
            <div className="text-right">
              <div className="mono text-lg font-extrabold">{thb(receipt.totalThb)}</div>
              <div className="muted text-[11.5px]">VAT {thb(quote.vatThb)}</div>
            </div>
          </div>

          <ul className="card grid gap-2.5 text-[13px]">
            {quote.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2.5">
                <span className={`ck ${c.ok ? "ck-ok" : "ck-bad"}`}>{c.ok ? "✓" : "✕"}</span>
                <span className="min-w-0 flex-1">
                  {c.label}
                  <span className="muted block text-[11px]">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="offer">
            <div className="label" style={{ color: "#e8c766" }}>
              {quote.eligible ? "Available now" : "Not eligible"}
            </div>
            <div className="big g mono mt-2">{usd(quote.advanceUsd)}</div>
            <div className="muted mt-3 flex justify-between gap-2 text-[11.5px]">
              <span>
                Est. refund <b className="mono" style={{ color: "var(--ink)" }}>{usd(quote.refundUsd)}</b>
              </span>
              <span>
                Fee <b className="mono" style={{ color: "var(--ink)" }}>{usd(quote.feeUsd)}</b>
              </span>
              <span>
                Due <b style={{ color: "var(--ink)" }}>{fmtDate(quote.deadline)}</b>
              </span>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5 text-[11px]" style={{ color: "#e8c766" }}>
              <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }} />
              THB/USD {quote.fx.usdPerThb.toFixed(5)} · {quote.fx.source}
            </div>
          </div>

          <details className="card text-sm">
            <summary className="cursor-pointer font-semibold" style={{ color: "#e8c766" }}>
              Edit receipt details &amp; wallet
            </summary>
            <div className="mt-3 space-y-2">
              <Field label="Store" value={receipt.storeName} onChange={(v) => edit("storeName", v)} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Tax ID" value={receipt.storeTaxId} onChange={(v) => edit("storeTaxId", v)} />
                <Field label="Receipt no." value={receipt.receiptNumber} onChange={(v) => edit("receiptNumber", v)} />
                <Field label="Date" type="date" value={receipt.purchaseDate} onChange={(v) => edit("purchaseDate", v)} />
                <Field label="Total (THB)" type="number" value={String(receipt.totalThb)} onChange={(v) => edit("totalThb", Number(v))} />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={receipt.hasVatRefundForm} onChange={(e) => edit("hasVatRefundForm", e.target.checked)} />
                Store gave me the VAT refund form (P.P.10)
              </label>
              <Field
                label="Your BNB Chain wallet (blank = demo wallet)"
                value={tourist}
                placeholder={chain?.addresses?.demoTourist ?? "0x…"}
                onChange={setTourist}
              />
            </div>
          </details>

          <button className="btn btn-primary" disabled={!quote.eligible || !!busy || !chain?.deployed} onClick={advance}>
            {busy === "advance" ? "Minting claim & paying…" : `Get ${usd(quote.advanceUsd)} now`}
          </button>
          {!chain?.deployed && <p className="muted text-center text-xs">Contracts not deployed yet — advance is disabled.</p>}
        </>
      )}

      {/* ========== STEP 3 · PAID + LIFECYCLE ========== */}
      {claim && quote && (
        <>
          <div className="mt-2 flex flex-col items-center gap-2 text-center">
            <div className="ring">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#140e00" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5 10 17 19 7.5" />
              </svg>
            </div>
            <div className="label mt-2">{settled ? "Claim settled" : "Sent to your wallet"}</div>
            <div className="big g mono">{usd(quote.advanceUsd)}</div>
            <div className="muted text-[12.5px]">
              {settled ? "The pool earned the fee. You never waited for the airport." : `Paid on BNB Chain to ${short(claim.tourist)}`}
            </div>
          </div>

          <div className="nft">
            <div className="flex items-center justify-between">
              <span className="label" style={{ color: "#e8c766" }}>
                Reclaim Receipt NFT
              </span>
              <span className="chip">{claim.status.toUpperCase()}</span>
            </div>
            <div className="g mt-2 text-2xl font-extrabold">Claim #{claim.id}</div>
            <div className="muted mt-2 flex justify-between text-[12px]">
              <span>
                Refund right <b className="mono" style={{ color: "var(--ink)" }}>{usd(quote.refundUsd)}</b>
              </span>
              <span>
                Repay <b className="mono" style={{ color: "var(--ink)" }}>{usd(owed)}</b>
              </span>
            </div>
          </div>

          <div className="card">
            <Step state="done" title="Receipt verified by AI agent" />
            <Step state="done" title="Claim tokenized & paid" desc={txs[0] ? <TxLink t={txs[0]} /> : undefined} />
            <Step
              state={attested ? "done" : "next"}
              title={attested ? "Refund collected at the airport" : "Collect refund at the airport"}
              desc={attested ? (txAttest ? <TxLink t={txAttest} /> : "Attested by oracle") : `Before ${fmtDate(quote.deadline)}`}
            />
            <Step
              state={settled ? "done" : attested ? "next" : "todo"}
              title={settled ? `Repaid ${usd(owed)} · settled` : `Repay ${usd(owed)} · claim settled`}
              desc={settled && txRepay ? <TxLink t={txRepay} /> : undefined}
            />
          </div>

          {!settled && (
            <>
              <button className="btn btn-ghost" disabled={!!busy || attested} onClick={() => settle("attest")}>
                {busy === "attest" ? "Oracle checking…" : "✈  Simulate airport refund (oracle)"}
              </button>
              <button className="btn btn-primary" disabled={!!busy || claim.status !== "Advanced"} onClick={() => settle("repay")}>
                {busy === "repay" ? "Repaying…" : `Repay ${usd(owed)}`}
              </button>
            </>
          )}
          {settled && (
            <button className="btn btn-ghost" onClick={reset}>
              Scan another receipt
            </button>
          )}
          <PoolCard chain={chain} />
        </>
      )}

      <footer className="muted mt-auto pt-6 text-center text-[11px] leading-relaxed">
        Testnet prototype · BNB Bangkok 2026 · A testnet stablecoin stands in for lisUSD/USDT · No token is issued · Not financial advice
        {chain?.addresses && explorer && (
          <>
            {" · "}
            <a className="underline" href={`${explorer}/address/${chain.addresses.vault}`} target="_blank" rel="noreferrer">
              Vault {short(chain.addresses.vault)}
            </a>
          </>
        )}
      </footer>
    </main>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function TxLink({ t }: { t: { label: string; url: string } }) {
  const hash = t.url.split("/").pop() ?? "";
  return (
    <a className="underline" href={t.url} target="_blank" rel="noreferrer">
      {short(hash)} · BscScan ↗
    </a>
  );
}

function Step({ state, title, desc }: { state: "done" | "next" | "todo"; title: string; desc?: React.ReactNode }) {
  return (
    <div className={`st ${state}`}>
      <div className="b">{state === "done" ? "✓" : ""}</div>
      <div>
        <div className="tt text-[13px] font-semibold">{title}</div>
        {desc && <div className="muted mt-0.5 text-[11.5px]">{desc}</div>}
      </div>
    </div>
  );
}

function Pill({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="rounded-[14px] border px-3 py-2.5" style={{ borderColor: "var(--line)", background: "rgba(255,255,255,.02)" }}>
      <div className="label">{label}</div>
      <div className={`mt-0.5 text-[15px] font-bold ${gold ? "g" : ""}`}>{value}</div>
    </div>
  );
}

function PoolCard({ chain }: { chain: ChainState | null }) {
  if (!chain) return <div className="card muted text-xs">Loading liquidity pool…</div>;
  if (!chain.deployed) return <div className="card muted text-xs">Liquidity pool: not deployed yet</div>;
  if (!chain.pool) return <div className="card text-xs" style={{ color: "var(--bad)" }}>Liquidity pool unreachable</div>;
  return (
    <div className="card">
      <div className="label mb-2">Liquidity pool · ERC-4626</div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Value" value={usd(chain.pool.totalAssets)} />
        <Stat label="Advanced" value={usd(chain.pool.outstanding)} />
        <Stat label="Claims" value={String(chain.pool.claims)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted text-[11px]">{label}</div>
      <div className="mono text-sm font-bold">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="muted text-xs">{label}</span>
      <input className="field mt-1" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
