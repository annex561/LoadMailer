import OpenAI from "openai";
import PDFParser from "pdf2json";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'not-configured' });

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
                fullText += '\n';
              }
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
    console.log("📄 Extracting text from RateCon...");

    try {
      const pdfText = await extractPdfText(fileBuffer);

      if (!pdfText || pdfText.length < 10) {
        throw new Error("PDF text extraction failed or empty.");
      }

      console.log(`📄 Extracted ${pdfText.length} characters`);
      console.log("🧠 Analyzing RateCon text...");

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Extract these exact fields from the Freight RateCon. Return JSON ONLY.
            
            Fields:
            - loadNumber (string)
            - brokerName (string, the brokerage company like "TQL", "CH Robinson")
            - brokerPhone (string, include ext, from TQL CONTACT INFO or BROKER section only)
            - brokerEmail (string, from TQL CONTACT INFO or BROKER section only)
            - dispatcherName (string, broker rep name from TQL CONTACT INFO section)
            - driverName (string, from CARRIER CONTACT section if present)
            - rate (number, no currency symbols)
            - miles (number)
            - rpm (number, calculate rate/miles if missing)
            - pickupDate (YYYY-MM-DD)
            - pickupTime (string, time window)
            - deliveryDate (YYYY-MM-DD)
            - deliveryTime (string, time window)
            - origin (City, State)
            - destination (City, State)
            - weight (number in lbs)
            - notes (string, capture special instructions)
            
            IMPORTANT: 
            - brokerPhone/brokerEmail come from TQL CONTACT INFO or BROKER section, NOT from shipper/consignee
            - driverName comes from CARRIER CONTACT section if present
            - Calculate rpm = rate/miles if not explicitly listed`
          },
          { role: "user", content: pdfText.substring(0, 12000) }
        ],
        response_format: { type: "json_object" }
      });

      const content = response.choices[0].message.content;
      if (!content) throw new Error("OpenAI returned empty response");

      const extracted = JSON.parse(content);
      
      const rpm = extracted.rpm || (extracted.rate && extracted.miles ? 
        Math.round((extracted.rate / extracted.miles) * 100) / 100 : undefined);

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
        rpm: rpm,
        notes: extracted.notes || undefined
      };

    } catch (error: any) {
      const errMsg = error?.message || String(error);
      console.error("❌ Parser Error:", errMsg, error?.stack);
      return {
        loadNumber: "MANUAL-REVIEW",
        brokerName: "Unknown",
        rate: 0,
        pickupDate: "",
        deliveryDate: "",
        origin: "Unknown",
        destination: "Unknown",
        weight: 0,
        miles: 0,
        rpm: 0,
        notes: `Error parsing PDF: ${errMsg}`
      };
    }
  }
};
