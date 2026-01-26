import OpenAI from "openai";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
// This is using Replit's AI Integrations service, which provides OpenAI-compatible API access without requiring your own OpenAI API key.
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
});

export async function generateMessageSuggestions(input: string, context?: string): Promise<string[]> {
  try {
    const systemPrompt = `You are an AI assistant helping truck drivers compose quick, professional messages to dispatch. 
The drivers are on the road and need short, clear messages. Generate 3 different message suggestions that are:
- Short and concise (1-2 sentences max)
- Professional but friendly
- Clear and actionable
- Relevant to trucking/logistics

${context ? `Context: ${context}` : ''}`;

    const userPrompt = input.trim() 
      ? `Generate 3 message variations for: "${input}"`
      : `Generate 3 common quick messages a driver might need to send to dispatch (e.g., arrival updates, delays, questions about load details)`;

    const response = await openai.chat.completions.create({
      model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    const content = response.choices[0]?.message?.content || "";
    
    // Parse the response into individual suggestions
    const suggestions = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => !line.match(/^\d+\.$/) && !line.match(/^[-*•]$/)) // Remove numbering/bullets
      .map(line => line.replace(/^\d+[.)]\s*/, '').replace(/^[-*•]\s*/, '')) // Clean up formatting
      .filter(line => line.length > 10) // Remove very short lines
      .slice(0, 3); // Take first 3

    return suggestions.length > 0 ? suggestions : [
      "Arrived at pickup location and ready to load.",
      "Running about 15 minutes behind schedule due to traffic.",
      "Load secured and heading to delivery location now."
    ];
  } catch (error) {
    console.error('Error generating AI suggestions:', error);
    // Return fallback suggestions
    return [
      "Arrived at pickup location and ready to load.",
      "Running about 15 minutes behind schedule due to traffic.",
      "Load secured and heading to delivery location now."
    ];
  }
}

export interface RelayLoadData {
  loadPay: number | null;
  loadMiles: number | null;
  origin: string | null;
  destination: string | null;
  pickupTime: string | null;
  deliveryTime: string | null;
  rawText: string;
}

export async function extractLoadFromScreenshot(base64Image: string): Promise<RelayLoadData> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert at extracting trucking load information from Amazon Relay app screenshots.
Extract the following information and return it as JSON:
- loadPay: the total payment amount in dollars (number only, no $ sign)
- loadMiles: the total miles for the load (number only)
- origin: the pickup city and state (e.g., "Maryville, TN")
- destination: the delivery city and state (e.g., "Cookeville, TN")
- pickupTime: the pickup time/date if visible
- deliveryTime: the delivery time/date if visible

Return ONLY valid JSON in this exact format:
{"loadPay": 288, "loadMiles": 95, "origin": "Maryville, TN", "destination": "Cookeville, TN", "pickupTime": null, "deliveryTime": null}

If you cannot find a value, use null. Be precise with numbers - don't include commas or dollar signs in numeric values.`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the load information from this Amazon Relay screenshot:"
            },
            {
              type: "image_url",
              image_url: {
                url: base64Image.startsWith('data:') ? base64Image : `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 500,
      temperature: 0.1
    });

    const content = response.choices[0]?.message?.content || "{}";
    console.log("AI extracted content:", content);
    
    // Try to parse JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        loadPay: typeof parsed.loadPay === 'number' ? parsed.loadPay : null,
        loadMiles: typeof parsed.loadMiles === 'number' ? parsed.loadMiles : null,
        origin: parsed.origin || null,
        destination: parsed.destination || null,
        pickupTime: parsed.pickupTime || null,
        deliveryTime: parsed.deliveryTime || null,
        rawText: content
      };
    }

    return {
      loadPay: null,
      loadMiles: null,
      origin: null,
      destination: null,
      pickupTime: null,
      deliveryTime: null,
      rawText: content
    };
  } catch (error) {
    console.error('Error extracting load from screenshot:', error);
    throw error;
  }
}

export async function improveMessage(message: string, context?: string): Promise<string> {
  try {
    const systemPrompt = `You are an AI assistant helping truck drivers improve their messages to dispatch.
Make the message more professional and clear while keeping it concise and friendly.
${context ? `Context: ${context}` : ''}`;

    const response = await openai.chat.completions.create({
      model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Improve this message: "${message}"` }
      ],
      max_tokens: 200,
      temperature: 0.5
    });

    return response.choices[0]?.message?.content?.trim() || message;
  } catch (error) {
    console.error('Error improving message:', error);
    return message;
  }
}
