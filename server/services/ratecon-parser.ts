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
            content: `You are an expert logistics data entry specialist. Extract data from a Freight Rate Confirmation (RateCon).

            EXTRACT THESE FIELDS:
            1. **loadNumber**: The load/order/reference number from the broker.
            2. **brokerName**: The brokerage company name (e.g., "TQL", "Total Quality Logistics", "CH Robinson", "Coyote").
            3. **brokerPhone**: SEE RULES BELOW
            4. **brokerEmail**: SEE RULES BELOW
            5. **dispatcherName**: SEE RULES BELOW
            6. **driverName**: SEE RULES BELOW
            7. **rate**: Total dollar amount for the load (number only).
            8. **miles**: Total trip mileage.
            9. **rpm**: Rate Per Mile (calculate rate/miles if not listed).
            10. **pickupDate**: First pickup date (YYYY-MM-DD).
            11. **pickupTime**: Pickup time window.
            12. **deliveryDate**: Final delivery date (YYYY-MM-DD).
            13. **deliveryTime**: Delivery time window.
            14. **origin**: City, State of pickup.
            15. **destination**: City, State of delivery.
            16. **weight**: Cargo weight in lbs (number only).
            17. **notes**: Special instructions or comments.
            
            === CRITICAL RULES FOR BROKER CONTACT INFO ===
            
            The document has MULTIPLE contact sections. You MUST distinguish between them:
            
            1. SHIPPER/PICKUP contact - This is the warehouse/facility contact. IGNORE this for broker fields.
            2. CONSIGNEE/DELIVERY contact - This is the receiver contact. IGNORE this for broker fields.
            3. BROKER/TQL CONTACT INFO - This is labeled "TQL CONTACT INFO", "BROKER CONTACT", "YOUR REP", "ACCOUNT REPRESENTATIVE", or similar. ONLY use this section for:
               - dispatcherName: The person's name (first and last) from the broker contact section
               - brokerPhone: The phone number from the broker contact section
               - brokerEmail: The email address from the broker contact section
            
            DO NOT extract shipper, consignee, or facility phone/email as broker contact.
            If you cannot find a dedicated broker contact section, leave brokerPhone, brokerEmail, and dispatcherName as null.
            
            === RULES FOR DRIVER NAME ===
            
            Look for the driver/carrier assigned to this load in these sections:
            - "CARRIER INFORMATION" or "CARRIER DETAILS" section
            - "Driver:" or "Driver Name:" field
            - "Carrier:" or "Carrier Name:" field (if it's a person name, not company)
            - "Assigned To:" field
            - "CARRIER CONTACT" section - look for the person's name
            - Any field showing who is hauling/transporting the load
            
            Extract the PERSON'S NAME (first and last name), not the trucking company name.
            If you only find a company name like "XYZ Trucking LLC", leave driverName as null.
            
            RETURN JSON ONLY. No markdown.`
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
