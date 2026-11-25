// Thailand VAT Refund for Tourists — the rules the agent checks before advancing money.
// Sources: Thai Revenue Department (rd.go.th/english/28049.html) and airport guidance.

export type ReceiptData = {
  storeName: string;
  storeTaxId: string;
  receiptNumber: string;
  purchaseDate: string; // YYYY-MM-DD
  totalThb: number; // VAT-inclusive total
  vatThb: number; // VAT printed on the receipt (0 if not shown)
  hasVatRefundForm: boolean; // P.P.10 / e-P.P.10 issued by the store
  items: string[];
};

export type Check = { id: string; label: string; ok: boolean; detail: string };

export const VAT_RATE = 0.07;
export const MIN_PER_RECEIPT_THB = 2_000;
export const EXPORT_WINDOW_DAYS = 60;
// Tourists do not get the full 7% back: refund operators keep a tiered fee.
// We advance against a conservative estimate (85% of the VAT).
export const NET_REFUND_RATIO = 0.85;

export function vatFromTotal(totalThb: number) {
  return Math.round(((totalThb * VAT_RATE) / (1 + VAT_RATE)) * 100) / 100;
}

export function estimate(r: ReceiptData) {
  const vat = r.vatThb > 0 ? r.vatThb : vatFromTotal(r.totalThb);
  const refundThb = Math.floor(vat * NET_REFUND_RATIO * 100) / 100;
  const purchase = new Date(r.purchaseDate + "T00:00:00Z");
  const deadline = new Date(purchase.getTime() + EXPORT_WINDOW_DAYS * 86_400_000);
  return { vatThb: vat, refundThb, deadline };
}

export function checkReceipt(r: ReceiptData, now = new Date()): Check[] {
  const { vatThb, deadline } = estimate(r);
  const purchase = new Date(r.purchaseDate + "T00:00:00Z");
  const validDate = !Number.isNaN(purchase.getTime());
  const daysLeft = Math.floor((deadline.getTime() - now.getTime()) / 86_400_000);
  const vatExpected = vatFromTotal(r.totalThb);
  const vatConsistent = r.vatThb === 0 || Math.abs(r.vatThb - vatExpected) <= Math.max(2, vatExpected * 0.02);

  return [
    {
      id: "store",
      label: "VAT-registered store",
      ok: /^\d{13}$/.test(r.storeTaxId.replace(/\D/g, "")),
      detail: r.storeTaxId ? `Tax ID ${r.storeTaxId}` : "No 13-digit tax ID on receipt",
    },
    {
      id: "minimum",
      label: `At least ${MIN_PER_RECEIPT_THB.toLocaleString()} THB on this receipt`,
      ok: r.totalThb >= MIN_PER_RECEIPT_THB,
      detail: `${r.totalThb.toLocaleString()} THB`,
    },
    {
      id: "vat",
      label: "VAT amount matches 7% of total",
      ok: vatConsistent,
      detail: `printed ${r.vatThb || "n/a"} · expected ${vatExpected.toLocaleString()} THB`,
    },
    {
      id: "window",
      label: `Inside the ${EXPORT_WINDOW_DAYS}-day export window`,
      ok: validDate && daysLeft >= 1 && purchase.getTime() <= now.getTime(),
      detail: validDate ? `${daysLeft} days left (until ${deadline.toISOString().slice(0, 10)})` : "Unreadable date",
    },
    {
      id: "form",
      label: "Store issued the VAT refund form (P.P.10)",
      ok: r.hasVatRefundForm,
      detail: r.hasVatRefundForm ? "Form present" : "Ask the store for the P.P.10 / e-P.P.10",
    },
    {
      id: "amount",
      label: "Refund large enough to advance",
      ok: vatThb > 0,
      detail: `VAT ${vatThb.toLocaleString()} THB`,
    },
  ];
}

export function normalizedReceiptKey(r: ReceiptData) {
  return [r.storeTaxId.replace(/\D/g, ""), r.receiptNumber.trim().toUpperCase(), r.purchaseDate, r.totalThb.toFixed(2)].join("|");
}
