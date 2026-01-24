import OpenAI from "openai";
import PDFParser from "pdf2json";

// Ensure you add OPENAI_API_KEY to your Replit Secrets!
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Safe URI decode that handles malformed URIs
function safeDecodeURI(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch (e) {
    // If decode fails, try to clean up the string and decode, or return as-is
    try {
      return decodeURIComponent(str.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'));
    } catch {
      return str;
    }
  }
}

// Extract text from PDF using pdf2json
async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    
    pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
      try {
        // Extract text from all pages
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
    
    // Parse the buffer
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
    
    // Extract text from PDF
    let pdfText = '';
    try {
      pdfText = await extractPdfText(pdfBuffer);
      console.log(`📄 Extracted ${pdfText.length} characters from PDF`);
    } catch (err: any) {
      console.error("❌ PDF text extraction failed:", err.message);
      throw new Error("Failed to extract text from PDF");
    }
    
    if (!pdfText || pdfText.trim().length < 50) {
      throw new Error("PDF contains no extractable text");
    }
    
    console.log("🧠 Sending extracted text to OpenAI for parsing...");
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a logistics data entry expert. Extract the following fields from this Rate Confirmation document text. 
          Return JSON ONLY. No markdown.
          Fields needed: 
          - loadNumber (string - the load/order/reference number)
          - rate (number, total amount in dollars without $ sign)
          - brokerName (string - the broker/shipper company name)
          - pickupDate (YYYY-MM-DD format if possible)
          - deliveryDate (YYYY-MM-DD format if possible)
          - origin (City, State format)
          - destination (City, State format)
          - weight (number in lbs, without units)
          - miles (number, if available)`
        },
        {
          role: "user",
          content: `Extract rate confirmation data from this document:\n\n${pdfText.substring(0, 8000)}`
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
  }
};
