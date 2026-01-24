import OpenAI from "openai";

// Ensure you add OPENAI_API_KEY to your Replit Secrets!
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ParsedRateConData {
  loadNumber: string;
  rate: number;
  brokerName: string;
  pickupDate: string;
  deliveryDate: string;
  origin: string;
  destination: string;
  weight: number;
}

export const rateconParser = {
  async parsePdf(base64File: string): Promise<ParsedRateConData> {
    console.log("🧠 Sending PDF to OpenAI for extraction...");
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a logistics data entry expert. Extract the following fields from this Rate Confirmation PDF. 
          Return JSON ONLY. No markdown.
          Fields needed: 
          - loadNumber (string)
          - rate (number, total amount)
          - brokerName (string)
          - pickupDate (YYYY-MM-DD format if possible)
          - deliveryDate (YYYY-MM-DD format if possible)
          - origin (City, State)
          - destination (City, State)
          - weight (number)`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract data from this ratecon:" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64File}` } }
          ]
        }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("OpenAI returned empty response");

    const parsed = JSON.parse(content);
    
    return {
      loadNumber: parsed.loadNumber || `RC-${Date.now()}`,
      rate: parseFloat(parsed.rate) || 0,
      brokerName: parsed.brokerName || "Unknown",
      pickupDate: parsed.pickupDate || "",
      deliveryDate: parsed.deliveryDate || "",
      origin: parsed.origin || "Unknown",
      destination: parsed.destination || "Unknown",
      weight: parseInt(parsed.weight) || 0
    };
  }
};
