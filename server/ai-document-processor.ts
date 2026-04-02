import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// Check for required OpenAI credentials
export function checkOpenAIConfig(): { configured: boolean; error?: string } {
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return {
      configured: false,
      error: 'AI_INTEGRATIONS_OPENAI_API_KEY is not configured. Please set up Replit AI Integrations.'
    };
  }
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
    return {
      configured: false,
      error: 'AI_INTEGRATIONS_OPENAI_BASE_URL is not configured. Please set up Replit AI Integrations.'
    };
  }
  return { configured: true };
}

// Initialize OpenAI client with Replit AI Integrations
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || 'not-configured',
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Type definitions
export type DocumentType = 'bol' | 'recon' | 'driver_sheet' | 'unknown';

export interface BOLData {
  loadNumber: string | null;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  weight: string | null;
  pieces: string | null;
  commodity: string | null;
  rate: string | null;
  freightCharges: string | null;
  fuelSurcharge: string | null;
  totalAmount: string | null;
}

export interface ReconData {
  loadNumber: string | null;
  totalRevenue: string | null;
  expenses: Array<{ description: string; amount: string }>;
  netProfit: string | null;
  date: string | null;
}

export interface DriverSheetData {
  driverName: string | null;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  appointmentTime: string | null;
  specialInstructions: string | null;
}

// JSON schemas for structured outputs
const classificationSchema = {
  type: 'object',
  properties: {
    documentType: {
      type: 'string',
      enum: ['bol', 'recon', 'driver_sheet', 'unknown'],
      description: 'The type of freight/logistics document'
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Confidence score between 0 and 1'
    },
    reasoning: {
      type: 'string',
      description: 'Brief explanation for the classification'
    }
  },
  required: ['documentType', 'confidence', 'reasoning'],
  additionalProperties: false
};

const bolSchema = {
  type: 'object',
  properties: {
    loadNumber: { type: ['string', 'null'], description: 'Load or shipment number' },
    pickupAddress: { type: ['string', 'null'], description: 'Pickup location address' },
    deliveryAddress: { type: ['string', 'null'], description: 'Delivery destination address' },
    weight: { type: ['string', 'null'], description: 'Total weight of shipment' },
    pieces: { type: ['string', 'null'], description: 'Number of pieces or pallets' },
    commodity: { type: ['string', 'null'], description: 'Type of commodity being shipped' },
    rate: { type: ['string', 'null'], description: 'Rate per mile or total rate' },
    freightCharges: { type: ['string', 'null'], description: 'Base freight charges' },
    fuelSurcharge: { type: ['string', 'null'], description: 'Fuel surcharge amount' },
    totalAmount: { type: ['string', 'null'], description: 'Total amount due or paid' }
  },
  required: ['loadNumber', 'pickupAddress', 'deliveryAddress', 'weight', 'pieces', 'commodity', 'rate', 'freightCharges', 'fuelSurcharge', 'totalAmount'],
  additionalProperties: false
};

const reconSchema = {
  type: 'object',
  properties: {
    loadNumber: { type: ['string', 'null'], description: 'Load or reference number' },
    totalRevenue: { type: ['string', 'null'], description: 'Total revenue amount' },
    expenses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Expense description' },
          amount: { type: 'string', description: 'Expense amount' }
        },
        required: ['description', 'amount'],
        additionalProperties: false
      },
      description: 'List of expenses'
    },
    netProfit: { type: ['string', 'null'], description: 'Net profit after expenses' },
    date: { type: ['string', 'null'], description: 'Date of reconciliation' }
  },
  required: ['loadNumber', 'totalRevenue', 'expenses', 'netProfit', 'date'],
  additionalProperties: false
};

const driverSheetSchema = {
  type: 'object',
  properties: {
    driverName: { type: ['string', 'null'], description: 'Name of the driver' },
    pickupAddress: { type: ['string', 'null'], description: 'Pickup location address' },
    deliveryAddress: { type: ['string', 'null'], description: 'Delivery destination address' },
    appointmentTime: { type: ['string', 'null'], description: 'Scheduled appointment time' },
    specialInstructions: { type: ['string', 'null'], description: 'Special delivery or handling instructions' }
  },
  required: ['driverName', 'pickupAddress', 'deliveryAddress', 'appointmentTime', 'specialInstructions'],
  additionalProperties: false
};

/**
 * Classifies a freight/logistics document using GPT-4 Vision
 * @param imageUrl - URL of the document image
 * @returns Document type: 'bol' | 'recon' | 'driver_sheet' | 'unknown'
 */
export async function classifyDocument(imageUrl: string): Promise<DocumentType> {
  try {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze this freight/logistics document image and classify it into one of these categories:
- 'bol': Bill of Lading - a shipping document with pickup/delivery addresses, commodities, weights
- 'recon': Reconciliation Sheet - financial document showing revenue, expenses, and profit
- 'driver_sheet': Driver Assignment Sheet - document with driver details and delivery instructions

Provide your classification with confidence level and reasoning.`
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl }
          }
        ]
      }
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'document_classification',
          strict: true,
          schema: classificationSchema
        }
      },
      max_tokens: 500
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const result = JSON.parse(content);
    return result.documentType as DocumentType;
  } catch (error) {
    console.error('Error classifying document:', error);
    throw new Error(`Failed to classify document: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extracts data from a Bill of Lading document
 * @param imageUrl - URL of the BOL image
 * @returns Extracted BOL data
 */
export async function extractBOLData(imageUrl: string): Promise<BOLData> {
  try {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Extract all relevant information from this Bill of Lading (BOL) document. 
Look for and extract:
- Load number or shipment ID
- Pickup address (origin)
- Delivery address (destination)
- Weight (in lbs or tons)
- Number of pieces or pallets
- Commodity or cargo description
- Rate (per mile or total)
- Freight charges
- Fuel surcharge
- Total amount

If any field is not visible or unclear, return null for that field.`
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl }
          }
        ]
      }
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'bol_extraction',
          strict: true,
          schema: bolSchema
        }
      },
      max_tokens: 1000
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    return JSON.parse(content) as BOLData;
  } catch (error) {
    console.error('Error extracting BOL data:', error);
    throw new Error(`Failed to extract BOL data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extracts data from a Reconciliation document
 * @param imageUrl - URL of the Recon image
 * @returns Extracted Recon data
 */
export async function extractReconData(imageUrl: string): Promise<ReconData> {
  try {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Extract financial information from this Reconciliation Sheet. 
Look for and extract:
- Load number or reference ID
- Total revenue amount
- All expenses (as a list with description and amount for each)
- Net profit (revenue minus expenses)
- Date of reconciliation

If any field is not visible or unclear, return null for that field. For expenses, extract all line items you can find.`
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl }
          }
        ]
      }
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'recon_extraction',
          strict: true,
          schema: reconSchema
        }
      },
      max_tokens: 1000
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    return JSON.parse(content) as ReconData;
  } catch (error) {
    console.error('Error extracting Recon data:', error);
    throw new Error(`Failed to extract Recon data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extracts data from a Driver Assignment Sheet
 * @param imageUrl - URL of the Driver Sheet image
 * @returns Extracted Driver Sheet data
 */
export async function extractDriverSheetData(imageUrl: string): Promise<DriverSheetData> {
  try {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Extract driver assignment information from this Driver Sheet. 
Look for and extract:
- Driver name
- Pickup address (origin location)
- Delivery address (destination location)
- Appointment time (scheduled delivery time)
- Special instructions (any notes, requirements, or special handling instructions)

If any field is not visible or unclear, return null for that field.`
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl }
          }
        ]
      }
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'driver_sheet_extraction',
          strict: true,
          schema: driverSheetSchema
        }
      },
      max_tokens: 1000
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    return JSON.parse(content) as DriverSheetData;
  } catch (error) {
    console.error('Error extracting Driver Sheet data:', error);
    throw new Error(`Failed to extract Driver Sheet data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Main function to process a document: classify and extract data
 * @param imageUrl - URL of the document image
 * @returns Object containing document type and extracted data
 */
export async function processDocument(imageUrl: string): Promise<{
  documentType: DocumentType;
  data: BOLData | ReconData | DriverSheetData | null;
}> {
  const documentType = await classifyDocument(imageUrl);
  
  let data: BOLData | ReconData | DriverSheetData | null = null;
  
  switch (documentType) {
    case 'bol':
      data = await extractBOLData(imageUrl);
      break;
    case 'recon':
      data = await extractReconData(imageUrl);
      break;
    case 'driver_sheet':
      data = await extractDriverSheetData(imageUrl);
      break;
    case 'unknown':
      // No extraction for unknown documents
      break;
  }
  
  return { documentType, data };
}
