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
  const steps = [
    { label: "Receipt read", done: !!receipt },
    { label: "Verified", done: !!quote?.eligible },
    { label: "Tokenized", done: !!claim },
    { label: "Paid", done: !!claim },
    { label: "Refund at airport", done: !!claim?.refundAttested || claim?.status === "Settled" },
    { label: "Settled", done: claim?.status === "Settled" },
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono text-xs tracking-widest" style={{ color: "var(--accent)" }}>
            RECLAIM · BNB CHAIN
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Your VAT refund, today.</h1>
          <p className="muted mt-2 max-w-xl">
            Shopping in Thailand? Your 7% VAT refund is locked until the airport. Scan your receipt — our agent verifies it,
            mints it as an on-chain claim and advances you the money in stablecoins right now.
          </p>
        </div>
        <PoolCard chain={chain} />
      </header>

      <ol className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {steps.map((s, i) => (
          <li key={s.label} className="panel px-3 py-2 text-xs" style={{ borderColor: s.done ? "var(--accent)" : undefined }}>
            <span className="mono" style={{ color: s.done ? "var(--accent)" : "var(--muted)" }}>
              {s.done ? "✓" : i + 1}
            </span>{" "}
            {s.label}
          </li>
        ))}
      </ol>

      {error && (
        <div className="panel mb-6 px-4 py-3 text-sm" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 1. Scan */}
        <section className="panel p-5">
          <h2 className="font-semibold">1 · Scan your receipt</h2>
          <p className="muted mt-1 text-sm">Photo of the tax invoice from a store with the “VAT Refund for Tourists” sign.</p>
          <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm" style={{ borderColor: "var(--line)" }}>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Receipt preview" className="max-h-56 rounded-lg" />
            ) : (
              <span className="muted">Tap to choose a photo (JPG / PNG)</span>
            )}
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
          <p className="muted mt-2 text-xs">Cover your passport number before uploading. The agent ignores personal IDs.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={!file || !!busy} onClick={() => scan(false)}>
              {busy === "scan" ? "Agent reading…" : "Read with AI agent"}
            </button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => scan(true)}>
              Use demo receipt
            </button>
          </div>

          {receipt && (
            <div className="mt-5 space-y-2 text-sm">
              {isDemo && (
                <p className="rounded-lg px-3 py-2 text-xs" style={{ background: "#3a2f0b", color: "var(--accent)" }}>
                  DEMO DATA — {parseNote || "sample receipt"}
                </p>
              )}
              {!isDemo && parseNote && <p className="muted text-xs">Agent note: {parseNote}</p>}
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
            </div>
          )}
        </section>

        {/* 2. Verify + advance */}
        <section className="panel p-5">
          <h2 className="font-semibold">2 · Agent verification & advance</h2>
          {!quote && <p className="muted mt-2 text-sm">Scan a receipt to see what the agent checks.</p>}
          {quote && (
            <>
              <ul className="mt-3 space-y-1.5 text-sm">
                {quote.checks.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <span style={{ color: c.ok ? "var(--ok)" : "var(--bad)" }}>{c.ok ? "✓" : "✗"}</span>
                    <span>
                      {c.label} <span className="muted text-xs">· {c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Stat label="VAT on receipt" value={thb(quote.vatThb)} />
                <Stat label="Est. refund at airport" value={`${thb(quote.refundThb)} ≈ ${usd(quote.refundUsd)}`} />
                <Stat label="You get now (80%)" value={usd(quote.advanceUsd)} big />
                <Stat label="Fee (5%) · due by" value={`${usd(quote.feeUsd)} · ${quote.deadline.slice(0, 10)}`} />
              </div>
              <p className="muted mt-2 text-xs">
                FX 1 THB = {quote.fx.usdPerThb.toFixed(5)} USD ({quote.fx.source}). Refund estimated at 85% of VAT after operator fees.
              </p>

              <div className="mt-4">
                <Field
                  label="Your BNB Chain wallet (optional — blank uses the demo wallet)"
                  value={tourist}
                  placeholder={chain?.addresses?.demoTourist ?? "0x…"}
                  onChange={setTourist}
                />
              </div>
              <button className="btn btn-primary mt-3 w-full" disabled={!quote.eligible || !!busy || !!claimId || !chain?.deployed} onClick={advance}>
                {busy === "advance" ? "Minting claim & paying…" : `Get ${usd(quote.advanceUsd)} now`}
              </button>
              {!chain?.deployed && <p className="muted mt-2 text-xs">Contracts not deployed yet — advance is disabled.</p>}
            </>
          )}
        </section>
      </div>

      {/* 3. Claim lifecycle */}
      {claim && (
        <section className="panel mt-6 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">3 · Your on-chain claim #{claim.id}</h2>
            <span className="mono rounded-full px-3 py-1 text-xs" style={{ background: "#3a2f0b", color: "var(--accent)" }}>
              {claim.status}
              {claim.refundAttested && claim.status === "Advanced" ? " · refund attested" : ""}
            </span>
          </div>
          <p className="muted mt-1 text-sm">
            Reclaim Receipt NFT held by {short(claim.tourist)} · {claim.storeName}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-ghost" disabled={!!busy || claim.refundAttested || claim.status !== "Advanced"} onClick={() => settle("attest")}>
              {busy === "attest" ? "Oracle checking…" : "✈ Simulate airport refund (oracle)"}
            </button>
            <button className="btn btn-primary" disabled={!!busy || claim.status !== "Advanced"} onClick={() => settle("repay")}>
              {busy === "repay" ? "Repaying…" : "Repay advance + fee"}
            </button>
          </div>
          {claim.status === "Settled" && (
            <p className="mt-3 text-sm" style={{ color: "var(--ok)" }}>
              Settled. The pool earned the fee and the tourist never waited for the airport.
            </p>
          )}
        </section>
      )}

      {txs.length > 0 && (
        <section className="panel mt-6 p-5 text-sm">
          <h2 className="font-semibold">On-chain proof (BSC testnet)</h2>
          <ul className="mt-2 space-y-1">
            {txs.map((t) => (
              <li key={t.url}>
                <a className="underline" style={{ color: "var(--accent)" }} href={t.url} target="_blank" rel="noreferrer">
                  {t.label} ↗
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="muted mt-10 text-xs">
        Testnet prototype built at BNB Bangkok 2026. A testnet stablecoin stands in for lisUSD/USDT. No token is issued. Not financial advice.
        {chain?.addresses && chain.explorer && (
          <>
            {" "}Vault{" "}
            <a className="underline" href={`${chain.explorer}/address/${chain.addresses.vault}`} target="_blank" rel="noreferrer">
              {short(chain.addresses.vault)}
            </a>
          </>
        )}
      </footer>
    </main>
  );
}

function PoolCard({ chain }: { chain: ChainState | null }) {
  if (!chain) return <div className="panel px-4 py-3 text-xs muted">Loading pool…</div>;
  if (!chain.deployed) return <div className="panel px-4 py-3 text-xs muted">Pool: not deployed yet</div>;
  if (!chain.pool) return <div className="panel px-4 py-3 text-xs" style={{ color: "var(--bad)" }}>Pool unreachable</div>;
  return (
    <div className="panel grid grid-cols-3 gap-4 px-4 py-3 text-xs">
      <Stat label="Pool value" value={usd(chain.pool.totalAssets)} />
      <Stat label="Advanced" value={usd(chain.pool.outstanding)} />
      <Stat label="Claims" value={String(chain.pool.claims)} />
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div className="muted text-xs">{label}</div>
      <div className={`mono ${big ? "text-xl font-bold" : "font-semibold"}`} style={big ? { color: "var(--accent)" } : undefined}>
        {value}
      </div>
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
