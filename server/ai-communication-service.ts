import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import { storage } from './storage';
import type { LoadMessage, LoadCommunicationThread, Load, Driver } from '@shared/schema';

export interface AiMessageRequest {
  threadId: string;
  context?: string;
  messageType?: 'update' | 'question' | 'response' | 'status';
  tone?: 'professional' | 'friendly' | 'urgent' | 'casual';
}

export interface AiMessageSuggestion {
  id: string;
  threadId: string;
  suggestedText: string;
  confidence: number;
  reasoning: string;
  messageType: string;
  estimatedTone: string;
  shouldAutoSend: boolean;
  aiData: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    toolsUsed?: string[];
  };
}

export class AiCommunicationService {
  private openai: OpenAI | null = null;
  private isInitialized = false;
  
  constructor() {
    // Lazy initialization to prevent server crashes
    this.initializeOpenAI();
  }

  private initializeOpenAI() {
    try {
      if (!process.env.OPENAI_API_KEY) {
        console.warn('⚠️ OPENAI_API_KEY not provided - AI assistant features disabled');
        return;
      }
      
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      this.isInitialized = true;
      console.log('✅ AI Communication Service initialized with OpenAI');
    } catch (error) {
      console.error('❌ Failed to initialize OpenAI:', error);
      this.openai = null;
      this.isInitialized = false;
    }
  }

  private checkInitialized(): boolean {
    if (!this.isInitialized || !this.openai) {
      console.warn('AI Communication Service not initialized - OpenAI unavailable');
      return false;
    }
    return true;
  }

  /**
   * Generate contextual message suggestions for a communication thread
   */
  async generateMessageSuggestion(request: AiMessageRequest): Promise<AiMessageSuggestion | null> {
    if (!this.checkInitialized()) {
      return null;
    }

    const startTime = Date.now();
    
    try {
      // Get thread and related data
      const thread = await storage.getLoadCommunicationThread(request.threadId);
      if (!thread) {
        throw new Error(`Thread ${request.threadId} not found`);
      }

      // Skip if AI is disabled for this thread
      if (!thread.assistantEnabled || thread.assistantMode === 'off') {
        return null;
      }

      const load = await storage.getLoad(thread.loadId);
      const driver = await storage.getDriver(thread.driverId);
      const recentMessages = await storage.getMessagesForContext(request.threadId, 10);

      if (!load || !driver) {
        throw new Error('Unable to load thread context');
      }

      // Build context for AI
      const context = this.buildConversationContext(load, driver, thread, recentMessages, request.context);
      
      // Generate AI response
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: thread.systemPrompt || this.getDefaultSystemPrompt(request.messageType, request.tone)
          },
          {
            role: 'user',
            content: context
          }
        ],
        temperature: 0.7,
        max_tokens: 200,
        functions: [
          {
            name: 'suggest_message',
            description: 'Suggest a contextual message for the trucking communication',
            parameters: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: 'The suggested message text'
                },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 100,
                  description: 'Confidence level in the suggestion (0-100)'
                },
                reasoning: {
                  type: 'string',
                  description: 'Brief explanation of why this message is appropriate'
                },
                messageType: {
                  type: 'string',
                  enum: ['update', 'question', 'response', 'status', 'greeting'],
                  description: 'Type of message being suggested'
                },
                tone: {
                  type: 'string',
                  enum: ['professional', 'friendly', 'urgent', 'casual'],
                  description: 'Detected tone of the suggested message'
                }
              },
              required: ['message', 'confidence', 'reasoning', 'messageType', 'tone']
            }
          }
        ],
        function_call: { name: 'suggest_message' }
      });

      const latencyMs = Date.now() - startTime;
      const choice = completion.choices[0];
      
      if (!choice.message.function_call) {
        throw new Error('No function call in AI response');
      }

      const suggestion = JSON.parse(choice.message.function_call.arguments);
      const shouldAutoSend = thread.assistantMode === 'autosend' && 
                           suggestion.confidence >= (thread.autoSendConfidence || 80);

      return {
        id: randomUUID(),
        threadId: request.threadId,
        suggestedText: suggestion.message,
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning,
        messageType: suggestion.messageType,
        estimatedTone: suggestion.tone,
        shouldAutoSend,
        aiData: {
          model: completion.model,
          promptTokens: completion.usage?.prompt_tokens || 0,
          completionTokens: completion.usage?.completion_tokens || 0,
          latencyMs,
          toolsUsed: ['suggest_message']
        }
      };

    } catch (error) {
      console.error('Error generating AI message suggestion:', error);
      return null;
    }
  }

  /**
   * Process and store an AI message suggestion
   */
  async createMessageSuggestion(suggestion: AiMessageSuggestion): Promise<LoadMessage | null> {
    try {
      const thread = await storage.getLoadCommunicationThread(suggestion.threadId);
      if (!thread) return null;

      const messageData = {
        threadId: suggestion.threadId,
        loadId: thread.loadId,
        senderId: null, // AI assistant
        senderRole: 'assistant' as const,
        senderName: 'TRAQ IQ AI',
        textContent: suggestion.suggestedText,
        isSuggested: true,
        isSent: false,
        visibility: 'internal' as const,
        aiData: suggestion.aiData,
        metadata: {
          confidence: suggestion.confidence,
          reasoning: suggestion.reasoning,
          messageType: suggestion.messageType,
          estimatedTone: suggestion.estimatedTone,
          shouldAutoSend: suggestion.shouldAutoSend
        }
      };

      const message = await storage.createLoadMessage(messageData);

      // Log the AI suggestion
      await storage.createCommunicationLog({
        loadId: thread.loadId,
        threadId: suggestion.threadId,
        action: 'ai_suggestion',
        actorId: null,
        actorRole: 'assistant',
        details: {
          messageId: message.id,
          confidence: suggestion.confidence,
          latencyMs: suggestion.aiData.latencyMs,
          shouldAutoSend: suggestion.shouldAutoSend
        }
      });

      // Auto-send if conditions are met
      if (suggestion.shouldAutoSend) {
        await this.autoSendMessage(message.id);
      }

      return message;
    } catch (error) {
      console.error('Error creating message suggestion:', error);
      return null;
    }
  }

  /**
   * Auto-send a suggested message if confidence threshold is met
   */
  private async autoSendMessage(messageId: string): Promise<void> {
    try {
      // Mark message as approved and sent
      await storage.approveSuggestedMessage(messageId, 'ai-auto');
      
      // TODO: Integration with Telegram service to actually send the message
      // This would require coordination with telegram-communication-service.ts
      
      console.log(`AI auto-sent message ${messageId}`);
    } catch (error) {
      console.error('Error auto-sending message:', error);
    }
  }

  /**
   * Build conversation context for AI analysis
   */
  private buildConversationContext(
    load: Load, 
    driver: Driver, 
    thread: LoadCommunicationThread, 
    recentMessages: LoadMessage[],
    additionalContext?: string
  ): string {
    const loadInfo = `Load: ${load.loadNumber} from ${load.pickupCity}, ${load.pickupState} to ${load.deliveryCity}, ${load.deliveryState}`;
    const driverInfo = `Driver: ${driver.name} (${driver.status})`;
    const threadInfo = `Thread status: ${thread.status}, Messages: ${thread.messageCount}`;
    
    let messageHistory = '';
    if (recentMessages.length > 0) {
      messageHistory = '\\n\\nRecent conversation:\\n' + recentMessages
        .map(msg => `${msg.senderRole}: ${msg.textContent}`)
        .join('\\n');
    }

    let contextBlock = '';
    if (additionalContext) {
      contextBlock = `\\n\\nAdditional context: ${additionalContext}`;
    }

    return `You are TRAQ IQ AI, helping with trucking communication between dispatch and drivers.

${loadInfo}
${driverInfo}
${threadInfo}${messageHistory}${contextBlock}

Please suggest an appropriate message for this context. Consider:
- The load status and any issues
- Driver communication style and current mood
- Professional trucking industry standards
- Urgency and clarity of communication
- Maintaining positive driver relationships`;
  }

  /**
   * Get default system prompt based on message type and tone
   */
  private getDefaultSystemPrompt(messageType?: string, tone?: string): string {
    const basePrompt = `You are TRAQ IQ AI, an assistant for trucking logistics communication. You help dispatch teams communicate effectively with drivers about load assignments, updates, and logistics coordination.

Communication Guidelines:
- Be clear, concise, and professional
- Use trucking industry terminology appropriately
- Respect driver's time and expertise
- Provide specific details when relevant
- Maintain a helpful and supportive tone
- Always include relevant load numbers, locations, and times`;

    if (messageType === 'urgent') {
      return basePrompt + `\\n\\nThis is an urgent communication. Be direct and clear about the urgency while remaining professional.`;
    }

    if (tone === 'friendly') {
      return basePrompt + `\\n\\nUse a warm, friendly tone while maintaining professionalism. Show appreciation for the driver's work.`;
    }

    return basePrompt;
  }

  /**
   * Approve a suggested message and prepare it for sending
   */
  async approveMessage(messageId: string, approverId: string): Promise<LoadMessage | null> {
    try {
      const message = await storage.approveSuggestedMessage(messageId, approverId);
      
      if (message) {
        // Log the approval
        await storage.createCommunicationLog({
          loadId: message.loadId,
          threadId: message.threadId,
          action: 'ai_message_sent',
          actorId: approverId,
          actorRole: 'dispatch',
          details: {
            messageId: message.id,
            aiApproved: true
          }
        });
      }
      
      return message;
    } catch (error) {
      console.error('Error approving message:', error);
      return null;
    }
  }

  /**
   * Reject a suggested message
   */
  async rejectMessage(messageId: string, rejectedBy: string): Promise<boolean> {
    try {
      const success = await storage.rejectSuggestedMessage(messageId);
      
      if (success) {
        // Log the rejection
        await storage.createCommunicationLog({
          loadId: '', // We don't have loadId here, would need to fetch message first
          threadId: '', // Same issue
          action: 'ai_message_rejected',
          actorId: rejectedBy,
          actorRole: 'dispatch',
          details: {
            messageId,
            reason: 'Manual rejection'
          }
        });
      }
      
      return success;
    } catch (error) {
      console.error('Error rejecting message:', error);
      return false;
    }
  }

  /**
   * Update AI configuration for a thread
   */
  async updateThreadAiSettings(threadId: string, settings: {
    assistantEnabled?: boolean;
    assistantMode?: 'suggest' | 'autosend' | 'off';
    autoSendConfidence?: number;
    systemPrompt?: string;
  }): Promise<LoadCommunicationThread | null> {
    try {
      return await storage.updateThreadAiConfig(threadId, settings);
    } catch (error) {
      console.error('Error updating thread AI settings:', error);
      return null;
    }
  }

  /**
   * Generate contextual suggestions based on incoming driver messages
   */
  async analyzeIncomingMessage(messageId: string): Promise<AiMessageSuggestion | null> {
    try {
      const message = await storage.getLoadMessage(messageId);
      if (!message || message.senderRole !== 'driver') return null;

      const thread = await storage.getLoadCommunicationThread(message.threadId);
      if (!thread || !thread.assistantEnabled) return null;

      // Analyze the driver's message and suggest a response
      return await this.generateMessageSuggestion({
        threadId: message.threadId,
        context: `Driver just sent: "${message.textContent}". Suggest an appropriate response.`,
        messageType: 'response',
        tone: 'professional'
      });

    } catch (error) {
      console.error('Error analyzing incoming message:', error);
      return null;
    }
  }
}

export const aiCommunicationService = new AiCommunicationService();