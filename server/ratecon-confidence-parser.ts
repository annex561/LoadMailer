import OpenAI from "openai";
import PDFParser from "pdf2json";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "not-configured" });

/**
 * Pull recent dispatcher corrections from the DB to inject as few-shot
 * examples in the parser prompt. Each correction is a real example of
 * (raw RateCon text → the JSON the dispatcher actually wanted), so over
 * time the parser learns the local patterns: how a specific broker formats
 * times, where the rate hides on their RateCons, etc.
 *
 * Best-effort — if the DB is unavailable or the table is empty, the parser
 * falls back to its zero-shot system prompt (the existing behavior).
 */
async function fetchLearningExamples(limit = 3): Promise<Array<{ rawText: string; correctedParse: any }>> {
  if (process.env.RATECON_DISABLE_FEW_SHOT === "true") return [];
  try {
    const { db } = await import("./db");
    const { rateconCorrections } = await import("@shared/schema");
    const { desc } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(rateconCorrections)
      .orderBy(desc(rateconCorrections.createdAt))
      .limit(limit);
    return rows
      .filter((r: any) => r.rawText && r.correctedParse)
      .map((r: any) => ({
        rawText: String(r.rawText),
        correctedParse: r.correctedParse,
      }));
  } catch {
    // Table may not exist yet on first deploy, or DB unavailable in tests
    return [];
  }
}

function safeDecodeURI(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    try {
      return decodeURIComponent(str.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
    } catch {
      return str;
    }
  }
}

/**
 * Extract text content from a PDF using pdf2json. Returns "" if extraction fails
 * (e.g. scanned-image PDFs with no text layer — OCR would be needed for those).
 */
async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  return new Promise((resolve) => {
    const pdfParser = new PDFParser();
    pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
      try {
        let fullText = "";
        if (pdfData.Pages) {
          for (const page of pdfData.Pages) {
            if (page.Texts) {
              for (const t of page.Texts) {
                if (t.R) {
                  for (const run of t.R) {
                    if (run.T) fullText += safeDecodeURI(run.T) + " ";
                  }
                }
                fullText += "\n";
              }
            }
            fullText += "\n--- PAGE BREAK ---\n";
          }
        }
        resolve(fullText.trim());
      } catch {
        resolve("");
      }
    });
    pdfParser.on("pdfParser_dataError", () => resolve(""));
    try {
      pdfParser.parseBuffer(pdfBuffer);
    } catch {
      resolve("");
    }
  });
}

export interface FieldWithConfidence<T> {
  value: T;
  confidence: number; // 0..1
}

export interface ParsedRateconV2 {
  broker: FieldWithConfidence<string>;
  loadNumber: FieldWithConfidence<string>;
  rate: FieldWithConfidence<number>;
  equipmentType: FieldWithConfidence<string>;
  weightLbs: FieldWithConfidence<number | null>;
  miles: FieldWithConfidence<number | null>;

  pickup: {
    city: string;
    state: string;
    address?: string;
    date: string;            // ISO YYYY-MM-DD
    time: string;            // HH:MM 24h
    confidence: number;      // overall confidence across pickup block
  };
  drop: {
    city: string;
    state: string;
    address?: string;
    date: string;
    time: string;
    confidence: number;
  };

  driverName: FieldWithConfidence<string | null>; // can be null if not on ratecon
  commodity: FieldWithConfidence<string | null>;
  specialInstructions: FieldWithConfidence<string | null>;

  rawText?: string;
  model: string;
}

const SYSTEM_PROMPT = `You are a freight logistics document expert. Parse this Rate Confirmation into strict JSON.

Return ONLY JSON matching this exact schema:
{
  "broker": { "value": "<broker name>", "confidence": 0.0-1.0 },
  "loadNumber": { "value": "<load/ref/order number>", "confidence": 0.0-1.0 },
  "rate": { "value": <number, no $ or commas>, "confidence": 0.0-1.0 },
  "equipmentType": { "value": "<dry van|reefer|flatbed|step deck|power only|other>", "confidence": 0.0-1.0 },
  "weightLbs": { "value": <number or null>, "confidence": 0.0-1.0 },
  "miles": { "value": <number or null>, "confidence": 0.0-1.0 },
  "pickup": {
    "city": "<city>",
    "state": "<2-letter state>",
    "address": "<full address if visible>",
    "date": "YYYY-MM-DD",
    "time": "HH:MM (24h)",
    "confidence": 0.0-1.0
  },
  "drop": { ...same shape as pickup },
  "driverName": { "value": "<driver name or null>", "confidence": 0.0-1.0 },
  "commodity": { "value": "<commodity or null>", "confidence": 0.0-1.0 },
  "specialInstructions": { "value": "<instructions or null>", "confidence": 0.0-1.0 }
}

Confidence rules — BE HONEST:
- 1.0 only if the field is unambiguous, clearly labeled, and you are certain.
- 0.85-0.95 if clearly visible but abbreviated or in unusual location.
- 0.6-0.84 if you had to infer or the document is ambiguous.
- <0.6 if the field is unclear, missing AM/PM, uses non-standard formatting, or required guessing.
- Set confidence to 0.5 or below if any required disambiguation was needed.
- When pickup/drop time lacks AM/PM or timezone, set that block's confidence below 0.85.
Return ONLY raw JSON. No prose, no markdown fences.`;

export async function parseRatecon(pdfBuffer: Buffer): Promise<ParsedRateconV2> {
  // Step 1: extract text from PDF (works for digital PDFs; returns "" for scanned-image PDFs)
  const pdfText = await extractPdfText(pdfBuffer);
  if (!pdfText || pdfText.length < 20) {
    throw new Error(
      "Could not extract text from PDF. This may be a scanned/image-only PDF — OCR not yet supported.",
    );
  }

  // Step 2: send extracted text to GPT-4o for structured extraction with
  // confidence scores. Pull recent dispatcher corrections from the DB and
  // include them as few-shot user→assistant pairs so the model learns the
  // specific fixes our dispatchers have made on previous RateCons.
  const examples = await fetchLearningExamples(3);
  const fewShotMessages = examples.flatMap((ex) => {
    // Trim each example raw text to keep prompt size in check. 6KB per
    // example × 3 examples ≈ 18KB extra prompt; well within the 128K
    // context window for gpt-4o.
    const trimmed = ex.rawText.slice(0, 6000);
    return [
      {
        role: "user" as const,
        content: `Extract the rate confirmation details from the following text. The text was extracted from a PDF, so layout cues like columns may be flattened — use surrounding context to disambiguate.\n\n--- BEGIN RATECON TEXT ---\n${trimmed}\n--- END RATECON TEXT ---`,
      },
      {
        role: "assistant" as const,
        content: JSON.stringify(ex.correctedParse),
      },
    ];
  });

  const model = "gpt-4o";
  const resp = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...fewShotMessages,
      {
        role: "user",
        content: `Extract the rate confirmation details from the following text. The text was extracted from a PDF, so layout cues like columns may be flattened — use surrounding context to disambiguate.\n\n--- BEGIN RATECON TEXT ---\n${pdfText}\n--- END RATECON TEXT ---`,
      },
    ],
    response_format: { type: "json_object" },
  });
  if (examples.length > 0) {
    console.log(`[ratecon-parser] injected ${examples.length} dispatcher correction(s) as few-shot examples`);
  }

  const content = resp.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");
  const parsed = JSON.parse(content) as Omit<ParsedRateconV2, "model" | "rawText">;
  return { ...parsed, model, rawText: pdfText };
}

/**
 * Deterministic fixture parser used in tests. Does NOT call OpenAI.
 */
export function parseRateconFixture(fixture: "tql-standard" | "missing-ampm"): ParsedRateconV2 {
  if (fixture === "tql-standard") {
    return {
      broker: { value: "TQL Logistics", confidence: 0.98 },
      loadNumber: { value: "A847291", confidence: 0.99 },
      rate: { value: 2850, confidence: 0.99 },
      equipmentType: { value: "dry van", confidence: 0.97 },
      weightLbs: { value: 42000, confidence: 0.95 },
      miles: { value: 780, confidence: 0.9 },
      pickup: { city: "Atlanta", state: "GA", date: "2026-05-01", time: "08:00", confidence: 0.94, address: "123 Shipper Way" },
      drop: { city: "Dallas", state: "TX", date: "2026-05-02", time: "17:00", confidence: 0.93, address: "456 Consignee Rd" },
      driverName: { value: "John Smith", confidence: 0.91 },
      commodity: { value: "General freight", confidence: 0.85 },
      specialInstructions: { value: null, confidence: 1.0 },
      model: "fixture",
    };
  }
  // missing-ampm
  return {
    broker: { value: "CH Robinson", confidence: 0.98 },
    loadNumber: { value: "B552104", confidence: 0.97 },
    rate: { value: 1950, confidence: 0.99 },
    equipmentType: { value: "reefer", confidence: 0.96 },
    weightLbs: { value: 38000, confidence: 0.9 },
    miles: { value: 500, confidence: 0.85 },
    pickup: { city: "Chicago", state: "IL", date: "2026-05-03", time: "08:00", confidence: 0.7, address: "789 Cold Storage" },
    drop: { city: "Memphis", state: "TN", date: "2026-05-04", time: "14:00", confidence: 0.75 },
    driverName: { value: null, confidence: 1.0 },
    commodity: { value: "Frozen produce", confidence: 0.9 },
    specialInstructions: { value: "Keep at 34F", confidence: 0.95 },
    model: "fixture",
  };
}
