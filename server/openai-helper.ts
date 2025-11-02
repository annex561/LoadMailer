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
