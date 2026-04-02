import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'not-configured' });

export interface ExtractedRateCon {
  loadNumber: string;
  totalRate: number;
  equipmentType: string;
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
  pickupDate: string;
  deliveryDate: string;
  weight: number;
}

export interface ParsedRateCon {
  loadId: string;
  rate: number;
  equipment: string;
  pickupLocation?: string;
  pickupDate?: string;
  deliveryLocation?: string;
  deliveryDate?: string;
  customerName?: string;
  weight?: number;
  miles?: number;
  notes?: string;
}

export const rateConParser = {
  /**
   * Parses a Rate Confirmation PDF/Image using OpenAI GPT-4o Vision
   * @param pdfBuffer The raw buffer of the PDF/Image file
   */
  async parse(pdfBuffer: Buffer): Promise<ParsedRateCon> {
    const base64Image = pdfBuffer.toString("base64");

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a logistics document expert. Extract data from this Trucking Rate Confirmation into a precise JSON format. 
            Fields: loadNumber, totalRate (number only), equipmentType, originCity, originState, destCity, destState, pickupDate, deliveryDate, weight (lbs). 
            If a field is missing, return null. Return ONLY raw JSON.`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract the load details from this rate confirmation:"
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        response_format: { type: "json_object" }
      });

      const content = response.choices[0].message.content;
      if (!content) throw new Error("OpenAI failed to parse the document.");

      const parsedData = JSON.parse(content);

      return {
        loadId: String(parsedData.loadNumber || `RC-${Date.now()}`),
        rate: parseFloat(parsedData.totalRate) || 0,
        equipment: parsedData.equipmentType || "Dry Van",
        pickupLocation: parsedData.originCity && parsedData.originState 
          ? `${parsedData.originCity}, ${parsedData.originState}` 
          : undefined,
        pickupDate: parsedData.pickupDate || undefined,
        deliveryLocation: parsedData.destCity && parsedData.destState 
          ? `${parsedData.destCity}, ${parsedData.destState}` 
          : undefined,
        deliveryDate: parsedData.deliveryDate || undefined,
        weight: parseInt(parsedData.weight) || undefined,
      };
    } catch (err: any) {
      console.error("[RateConParser] OpenAI parsing failed:", err.message);
      return {
        loadId: `RC-${Date.now()}`,
        rate: 0,
        equipment: "Dry Van",
        notes: `Parsing failed: ${err.message}`
      };
    }
  },

  /**
   * Parse text content (for emails without PDF attachments)
   */
  async parseText(textContent: string): Promise<Partial<ParsedRateCon>> {
    const patterns = {
      loadId: /(?:load|reference|order)\s*(?:#|number|id)?[:\s]*([A-Z0-9-]+)/i,
      rate: /\$[\d,]+(?:\.\d{2})?/,
      equipment: /(?:dry\s*van|reefer|flatbed|step\s*deck|van)/i,
    };

    const loadIdMatch = textContent.match(patterns.loadId);
    const rateMatch = textContent.match(patterns.rate);
    const equipmentMatch = textContent.match(patterns.equipment);

    return {
      loadId: loadIdMatch?.[1],
      rate: rateMatch ? parseFloat(rateMatch[0].replace(/[$,]/g, '')) : undefined,
      equipment: equipmentMatch?.[0],
    };
  },

  /**
   * Raw extraction returning ExtractedRateCon format
   */
  async parseRaw(pdfBuffer: Buffer): Promise<ExtractedRateCon> {
    const base64Image = pdfBuffer.toString("base64");

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a logistics document expert. Extract data from this Trucking Rate Confirmation into a precise JSON format. 
          Fields: loadNumber, totalRate (number only), equipmentType, originCity, originState, destCity, destState, pickupDate, deliveryDate, weight (lbs). 
          If a field is missing, return null. Return ONLY raw JSON.`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the load details from this rate confirmation:"
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("OpenAI failed to parse the document.");

    const parsedData = JSON.parse(content);

    return {
      loadNumber: String(parsedData.loadNumber || ""),
      totalRate: parseFloat(parsedData.totalRate) || 0,
      equipmentType: parsedData.equipmentType || "unknown",
      originCity: parsedData.originCity || "",
      originState: parsedData.originState || "",
      destCity: parsedData.destCity || "",
      destState: parsedData.destState || "",
      pickupDate: parsedData.pickupDate || "",
      deliveryDate: parsedData.deliveryDate || "",
      weight: parseInt(parsedData.weight) || 0
    };
  }
};
