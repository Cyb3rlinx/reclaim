import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import type { ReceiptData } from "@/lib/rules";

export const runtime = "nodejs";

const SAMPLE: ReceiptData = {
  storeName: "Siam Paragon — Power Mall (DEMO SAMPLE)",
  storeTaxId: "0105536092641",
  receiptNumber: "DEMO-PM-000127",
  purchaseDate: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
  totalThb: 127_000,
  vatThb: 8_308.41,
  hasVatRefundForm: true,
  items: ["Laptop 16-inch"],
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["storeName", "storeTaxId", "receiptNumber", "purchaseDate", "totalThb", "vatThb", "hasVatRefundForm", "items", "isReceipt", "notes"],
  properties: {
    isReceipt: { type: "boolean", description: "false if the image is not a Thai sales receipt / tax invoice" },
    storeName: { type: "string" },
    storeTaxId: { type: "string", description: "13-digit Thai tax ID of the seller, digits only, empty if absent" },
    receiptNumber: { type: "string", description: "Tax invoice / receipt number" },
    purchaseDate: { type: "string", description: "YYYY-MM-DD, convert Buddhist Era years (e.g. 2569) to Gregorian" },
    totalThb: { type: "number", description: "VAT-inclusive grand total in THB" },
    vatThb: { type: "number", description: "VAT amount printed on the receipt, 0 if not printed" },
    hasVatRefundForm: { type: "boolean", description: "true if a P.P.10 / VAT Refund for Tourists form or e-VRT mark is visible" },
    items: { type: "array", items: { type: "string" }, description: "Short names of purchased goods" },
    notes: { type: "string", description: "Anything unreadable or suspicious, empty if none" },
  },
} as const;

const SYSTEM = `You read Thai retail receipts and tax invoices for a VAT-refund service.
Extract only what is printed. Never invent a tax ID, receipt number or amount: use "" or 0 when absent.
Thai receipts often use Buddhist Era years (add -543 to get Gregorian). Amounts are THB.
Do not extract passport numbers or other personal identifiers.`;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("receipt");
  const wantDemo = form.get("demo") === "1";

  if (wantDemo || !(file instanceof File)) {
    return NextResponse.json({ demo: true, receipt: SAMPLE, notes: "Demo sample — no image was read." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      demo: true,
      receipt: SAMPLE,
      notes: "ANTHROPIC_API_KEY is not set, so the agent returned the demo sample instead of reading your photo.",
    });
  }

  const mediaType = file.type as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType)) {
    return NextResponse.json({ error: `Unsupported file type ${file.type}. Use JPG, PNG or WEBP.` }, { status: 400 });
  }
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");

  // Explicit base URL so a machine-wide ANTHROPIC_BASE_URL (e.g. a local proxy) is not picked up by accident.
  const client = new Anthropic({ baseURL: process.env.RECLAIM_ANTHROPIC_BASE_URL || "https://api.anthropic.com" });

  try {
    // Claude Haiku 5.5: cheapest current model with vision (~$0.001 per receipt).
    const response = await client.messages.create({
      model: process.env.RECLAIM_MODEL || "claude-haiku-5-5",
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            { type: "text", text: "Extract the receipt fields." },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "The model declined to read this image." }, { status: 422 });
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("No text in model response");
    const parsed = JSON.parse(text.text) as ReceiptData & { isReceipt: boolean; notes: string };
    if (!parsed.isReceipt) {
      return NextResponse.json({ error: "That image does not look like a receipt." }, { status: 422 });
    }
    const { isReceipt: _ignored, notes, ...receipt } = parsed;
    return NextResponse.json({ demo: false, receipt, notes, model: response.model });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Invalid ANTHROPIC_API_KEY." }, { status: 500 });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited — try again in a moment." }, { status: 429 });
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Claude API error ${e.status}: ${e.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
