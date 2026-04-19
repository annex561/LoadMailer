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

/**
 * Regex-based RateCon extractor. Runs as fallback when OpenAI is unavailable.
 * Covers common broker templates: TQL, CH Robinson, Landstar, Coyote, generic.
 * Best-effort — fills what it can; missing fields stay empty.
 */
function regexExtract(pdfText: string): ParsedRateConData {
  const text = pdfText.replace(/\s+/g, ' '); // normalize whitespace

  const loadNumberPatterns = [
    /(?:PO|Load|Confirmation|Order|Reference|Ref|BOL)\s*(?:Number|No\.?|#)?\s*:?\s*([A-Z0-9][A-Z0-9-]{3,20})/i,
    /#\s*([A-Z0-9]{6,15})/,
  ];
  let loadNumber = '';
  for (const pat of loadNumberPatterns) {
    const m = text.match(pat);
    if (m && m[1] && !/^(date|time|phone|fax)$/i.test(m[1])) { loadNumber = m[1].trim(); break; }
  }

  const rateMatch = text.match(/(?:Rate|Total|Amount|Pay|Line\s*Haul)\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)
    || text.match(/\$\s*([\d,]+\.\d{2})/);
  const rate = rateMatch ? parseFloat(rateMatch[1].replace(/,/g, '')) : 0;

  const milesMatch = text.match(/(?:Miles|Distance|Total\s*Miles)\s*:?\s*([\d,]+)/i);
  const miles = milesMatch ? parseInt(milesMatch[1].replace(/,/g, ''), 10) : undefined;

  const weightMatch = text.match(/(?:Weight|Wt)\s*:?\s*([\d,]+)\s*(?:lbs?|pounds)?/i);
  const weight = weightMatch ? parseInt(weightMatch[1].replace(/,/g, ''), 10) : 0;

  // Title-case city (one or more Title-case words) + 2-letter US state code.
  // Whitelist of real state codes prevents matches like "DEATH, OR" where "OR" happens
  // to look like a state abbreviation but the prior word is an all-caps commodity/label.
  // Require Title Case (initial cap + at least one lowercase) so ALL-CAPS tokens don't match.
  const US_STATE = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
  const cityStateRe = new RegExp(
    `\\b([A-Z][a-z]+(?:[\\s\\.]+(?:[A-Z][a-z]+|of|the)){0,4}),\\s*(${US_STATE})\\b`,
    'g'
  );
  const locations: string[] = [];
  let cm: RegExpExecArray | null;
  while ((cm = cityStateRe.exec(text)) !== null) {
    const city = cm[1].trim().replace(/\s+/g, ' ');
    locations.push(`${city}, ${cm[2]}`);
  }
  const origin = locations[0] || '';
  const destination = locations[locations.length - 1] !== origin ? (locations[locations.length - 1] || '') : (locations[1] || '');

  const dateRe = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{4}-\d{2}-\d{2})/g;
  const dates: string[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(text)) !== null) dates.push(dm[0]);
  const toIso = (d: string): string => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const parts = d.split(/[\/\-]/);
    if (parts.length === 3) {
      let [mo, day, yr] = parts;
      if (yr.length === 2) yr = '20' + yr;
      return `${yr}-${mo.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return '';
  };
  const pickupDate = dates[0] ? toIso(dates[0]) : '';
  const deliveryDate = dates[1] ? toIso(dates[1]) : pickupDate;

  const brokerMatch = text.match(/(TQL|CH\s*Robinson|Landstar|Coyote|Echo|XPO|JB\s*Hunt|Total\s*Quality\s*Logistics)/i);
  const brokerName = brokerMatch ? brokerMatch[1].replace(/\s+/g, ' ').trim() : '';

  const phoneMatch = text.match(/\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/);
  const brokerPhone = phoneMatch ? `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}` : undefined;

  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  const brokerEmail = emailMatch ? emailMatch[0] : undefined;

  const rpm = (rate && miles && miles > 0) ? Math.round((rate / miles) * 100) / 100 : undefined;

  console.log(`🔍 Regex fallback parsed: load=${loadNumber || 'none'}, rate=$${rate}, ${origin} → ${destination}`);

  return {
    loadNumber: loadNumber || `RC-${Date.now()}`,
    rate,
    brokerName: brokerName || 'Unknown',
    brokerPhone,
    brokerEmail,
    pickupDate,
    deliveryDate,
    origin: origin || 'Unknown',
    destination: destination || 'Unknown',
    weight,
    miles,
    rpm,
    notes: '[Parsed by regex fallback — verify fields]',
  };
}

export const rateconParser = {
  regexExtract,
  async parsePdf(fileBuffer: Buffer): Promise<ParsedRateConData> {
    console.log("📄 Extracting text from RateCon...");

    let pdfText = '';
    try {
      pdfText = await extractPdfText(fileBuffer);
      if (!pdfText || pdfText.length < 10) {
        throw new Error("PDF text extraction failed or empty.");
      }
      console.log(`📄 Extracted ${pdfText.length} characters`);
    } catch (extractErr: any) {
      console.error("❌ PDF extraction failed:", extractErr?.message);
      return {
        loadNumber: "MANUAL-REVIEW",
        brokerName: "Unknown",
        rate: 0, pickupDate: "", deliveryDate: "",
        origin: "Unknown", destination: "Unknown",
        weight: 0, miles: 0, rpm: 0,
        notes: `PDF extraction failed: ${extractErr?.message || 'unknown'}`,
      };
    }

    try {
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

      try {
        const { opsMonitor } = await import('../ops-monitor-service');
        opsMonitor.noteParserRun(true);
      } catch {}

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
      const status = error?.status || error?.response?.status;
      console.error(`❌ OpenAI parser failed (${status || 'no status'}):`, errMsg);

      try {
        const { opsMonitor } = await import('../ops-monitor-service');
        opsMonitor.noteParserRun(false);
      } catch {}

      // Fallback to regex extraction for any OpenAI failure
      // (429 quota, 5xx, timeout, JSON parse error, etc.)
      try {
        console.log("⤵️  Falling back to regex extraction...");
        const fallback = regexExtract(pdfText);
        fallback.notes = `${fallback.notes || ''} | OpenAI error: ${errMsg.substring(0, 120)}`;
        return fallback;
      } catch (regexErr: any) {
        console.error("❌ Regex fallback also failed:", regexErr?.message);
        return {
          loadNumber: "MANUAL-REVIEW",
          brokerName: "Unknown",
          rate: 0, pickupDate: "", deliveryDate: "",
          origin: "Unknown", destination: "Unknown",
          weight: 0, miles: 0, rpm: 0,
          notes: `All parsers failed. OpenAI: ${errMsg}. Regex: ${regexErr?.message}`,
        };
      }
    }
  }
};
