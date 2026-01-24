import OpenAI from "openai";
import PDFParser from "pdf2json";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function safeDecodeURI(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch (e) {
    try {
      return decodeURIComponent(str.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'));
    } catch {
      return str;
    }
  }
}

async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    
    pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
      try {
        let fullText = '';
        if (pdfData.Pages) {
          for (const page of pdfData.Pages) {
            if (page.Texts) {
              for (const textItem of page.Texts) {
                if (textItem.R) {
                  for (const run of textItem.R) {
                    if (run.T) {
                      fullText += safeDecodeURI(run.T) + ' ';
                    }
                  }
                }
              }
              fullText += '\n';
            }
          }
        }
        resolve(fullText);
      } catch (err: any) {
        reject(new Error(`PDF parsing error: ${err.message}`));
      }
    });
    
    pdfParser.on("pdfParser_dataError", (errData: any) => {
      reject(new Error(`PDF parsing failed: ${errData.parserError || errData}`));
    });
    
    pdfParser.parseBuffer(pdfBuffer);
  });
}

export interface ParsedRateConData {
  loadNumber: string;
  rate: number;
  brokerName: string;
  brokerPhone?: string;
  brokerEmail?: string;
  dispatcherName?: string;
  driverName?: string;
  pickupDate: string;
  pickupTime?: string;
  deliveryDate: string;
  deliveryTime?: string;
  origin: string;
  destination: string;
  weight: number;
  miles?: number;
  rpm?: number;
  notes?: string;
}

export const rateconParser = {
  async parsePdf(fileBuffer: Buffer): Promise<ParsedRateConData> {
    console.log("📄 Extracting text from RateCon PDF...");

    try {
      const pdfText = await extractPdfText(fileBuffer);

      if (!pdfText || pdfText.length < 10) {
        console.warn("⚠️ PDF text extraction failed or empty.");
        throw new Error("PDF text extraction failed");
      }

      console.log(`📄 Extracted ${pdfText.length} characters from PDF`);
      console.log("🧠 Sending text to OpenAI for precision extraction...");

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert logistics data entry specialist. Your job is to extract specific data points from a Freight Rate Confirmation (RateCon).

            EXTRACT THESE EXACT FIELDS:
            1. **loadNumber**: The load/order/reference number from the broker.
            2. **brokerName**: The company issuing the load (e.g., TQL, CH Robinson).
            3. **brokerPhone**: The phone number for the broker. Include extension if available (e.g., "555-0199 x123").
            4. **brokerEmail**: The email address for the broker/dispatcher.
            5. **dispatcherName**: The specific person/agent name at the brokerage.
            6. **driverName**: The driver or carrier name assigned to this load (look for "Driver:", "Carrier:", "Assigned To:", etc).
            7. **rate**: The total dollar amount (number only, no "$").
            8. **miles**: The total trip mileage.
            9. **rpm**: Rate Per Mile. (If not listed, calculate it: rate / miles).
            10. **pickupDate**: First pickup date (YYYY-MM-DD).
            11. **pickupTime**: Pickup time window (e.g., "08:00-12:00" or "FCFS").
            12. **deliveryDate**: Final delivery date (YYYY-MM-DD).
            13. **deliveryTime**: Delivery time window (e.g., "14:00-18:00" or "Appointment").
            14. **origin**: City, State (e.g., "Atlanta, GA").
            15. **destination**: City, State (e.g., "Miami, FL").
            16. **weight**: Cargo weight in lbs (number only).
            17. **notes**: Any special instructions, commodity details, or "comments" listed.
            
            RETURN JSON ONLY. Do not use Markdown formatting.`
          },
          {
            role: "user",
            content: pdfText.substring(0, 12000)
          }
        ],
        response_format: { type: "json_object" }
      });

      const content = response.choices[0].message.content;
      if (!content) throw new Error("OpenAI returned empty response");

      const extracted = JSON.parse(content);
      
      console.log(`✅ Parsed: Load ${extracted.loadNumber}, Rate $${extracted.rate}, ${extracted.origin} → ${extracted.destination}`);

      return {
        loadNumber: extracted.loadNumber || `RC-${Date.now()}`,
        rate: parseFloat(extracted.rate) || 0,
        brokerName: extracted.brokerName || "Unknown",
        brokerPhone: extracted.brokerPhone || undefined,
        brokerEmail: extracted.brokerEmail || undefined,
        dispatcherName: extracted.dispatcherName || undefined,
        driverName: extracted.driverName || undefined,
        pickupDate: extracted.pickupDate || "",
        pickupTime: extracted.pickupTime || undefined,
        deliveryDate: extracted.deliveryDate || "",
        deliveryTime: extracted.deliveryTime || undefined,
        origin: extracted.origin || "Unknown",
        destination: extracted.destination || "Unknown",
        weight: parseInt(extracted.weight) || 0,
        miles: parseInt(extracted.miles) || undefined,
        rpm: parseFloat(extracted.rpm) || undefined,
        notes: extracted.notes || undefined
      };

    } catch (error) {
      console.error("❌ Parser Error:", error);
      return {
        loadNumber: "MANUAL-REVIEW",
        brokerName: "Parse Error - Check PDF",
        rate: 0,
        pickupDate: "",
        deliveryDate: "",
        origin: "Unknown",
        destination: "Unknown",
        weight: 0,
        notes: "System could not read PDF text."
      };
    }
  }
};
