import OpenAI from "openai";
import PDFParser from "pdf2json";

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Safe URI decode that handles malformed URIs
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

// Extract text from PDF using pdf2json (Node.js compatible)
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
  pickupDate: string;
  deliveryDate: string;
  origin: string;
  destination: string;
  weight: number;
  miles?: number;
}

export const rateconParser = {
  async parsePdf(base64File: string): Promise<ParsedRateConData> {
    console.log("🧠 Extracting text from PDF...");
    
    // Convert base64 to buffer
    const pdfBuffer = Buffer.from(base64File, 'base64');

    try {
      // 1. Extract raw text from the PDF
      const pdfText = await extractPdfText(pdfBuffer);

      // Fail-safe: If PDF is empty or scanned image, return a generic object
      if (!pdfText || pdfText.length < 10) {
        console.warn("⚠️ PDF appears to be empty or image-only. Creating generic load.");
        return {
          loadNumber: "MANUAL-REVIEW",
          rate: 0,
          brokerName: "Unknown Broker",
          pickupDate: new Date().toISOString().split('T')[0],
          deliveryDate: new Date().toISOString().split('T')[0],
          origin: "Unknown, USA",
          destination: "Unknown, USA",
          weight: 0
        };
      }

      console.log(`📄 Extracted ${pdfText.length} characters from PDF`);
      console.log("🧠 Sending extracted text to OpenAI for parsing...");

      // 2. Send TEXT to OpenAI (Much more reliable than Image)
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a logistics data entry robot. Extract load details from the raw text below.
            Return JSON ONLY. No markdown.
            If a field is missing, use "Unknown" or 0.
            Fields needed: 
            - loadNumber (string)
            - rate (number, pure integer, no signs)
            - brokerName (string)
            - pickupDate (YYYY-MM-DD)
            - deliveryDate (YYYY-MM-DD)
            - origin (City, State)
            - destination (City, State)
            - weight (number)
            - miles (number, if available)`
          },
          {
            role: "user",
            content: pdfText.substring(0, 8000)
          }
        ],
        response_format: { type: "json_object" }
      });

      const content = response.choices[0].message.content;
      if (!content) throw new Error("OpenAI returned empty response");

      const parsed = JSON.parse(content);
      
      console.log(`✅ Parsed: Load ${parsed.loadNumber}, Rate $${parsed.rate}, ${parsed.origin} → ${parsed.destination}`);
      
      return {
        loadNumber: parsed.loadNumber || `RC-${Date.now()}`,
        rate: parseFloat(parsed.rate) || 0,
        brokerName: parsed.brokerName || "Unknown",
        pickupDate: parsed.pickupDate || "",
        deliveryDate: parsed.deliveryDate || "",
        origin: parsed.origin || "Unknown",
        destination: parsed.destination || "Unknown",
        weight: parseInt(parsed.weight) || 0,
        miles: parseInt(parsed.miles) || undefined
      };

    } catch (error) {
      console.error("❌ Parser Error:", error);
      // FAIL-SAFE: Return a placeholder so the DB insert doesn't fail
      return {
        loadNumber: "PARSER-ERROR",
        rate: 0,
        brokerName: "Manual Fix Needed",
        pickupDate: "",
        deliveryDate: "",
        origin: "Error",
        destination: "Error",
        weight: 0
      };
    }
  }
};
