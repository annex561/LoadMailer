import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "not-configured" });

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
  const base64 = pdfBuffer.toString("base64");
  const model = "gpt-4o";
  const resp = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract the rate confirmation details:" },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = resp.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");
  const parsed = JSON.parse(content) as Omit<ParsedRateconV2, "model">;
  return { ...parsed, model };
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
