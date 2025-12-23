import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

interface TypingState {
  threadId: string;
  participantId: string;
  participantType: 'driver' | 'dispatch';
  participantName: string;
  isTyping: boolean;
  lastUpdate: number;
}

interface ConnectedClient {
  ws: WebSocket;
  threadId: string;
  participantId: string;
  participantType: 'driver' | 'dispatch';
  participantName: string;
}

class TypingIndicatorService {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ConnectedClient> = new Map();
  private typingStates: Map<string, TypingState> = new Map();
  private cleanupInterval: NodeJS.Timer | null = null;
  private isInitialized = false;

  initialize(server: Server): void {
    if (this.isInitialized) {
      console.log('⚠️ Typing indicator service already initialized');
      return;
    }

    console.log('🔌 Initializing WebSocket server for typing indicators...');
    
    this.wss = new WebSocketServer({ 
      server, 
      path: '/ws/typing'
    });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('👋 New WebSocket connection for typing indicators');
      
      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        const client = this.clients.get(ws);
        if (client) {
          this.handleTypingStop(client.threadId, client.participantId);
          this.clients.delete(ws);
          console.log(`👋 WebSocket disconnected: ${client.participantName}`);
        }
      });

      ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
      });
    });

    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleTypingStates();
    }, 5000);

    this.isInitialized = true;
    console.log('✅ WebSocket server for typing indicators initialized on /ws/typing');
  }

  private handleMessage(ws: WebSocket, message: any): void {
    const { type, threadId, participantId, participantType, participantName } = message;

    switch (type) {
      case 'register':
        this.clients.set(ws, {
          ws,
          threadId,
          participantId,
          participantType,
          participantName: participantName || 'Unknown'
        });
        console.log(`📝 Registered client: ${participantName} (${participantType}) for thread ${threadId}`);
        break;

      case 'typing_start':
        this.handleTypingStart(threadId, participantId, participantType, participantName || 'Someone');
        break;

      case 'typing_stop':
        this.handleTypingStop(threadId, participantId);
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  }

  private handleTypingStart(
    threadId: string, 
    participantId: string, 
    participantType: 'driver' | 'dispatch',
    participantName: string
  ): void {
    const key = `${threadId}:${participantId}`;
    
    this.typingStates.set(key, {
      threadId,
      participantId,
      participantType,
      participantName,
      isTyping: true,
      lastUpdate: Date.now()
    });

    this.broadcastTypingState(threadId, participantId, participantType, participantName, true);
  }

  private handleTypingStop(threadId: string, participantId: string): void {
    const key = `${threadId}:${participantId}`;
    const state = this.typingStates.get(key);
    
    if (state) {
      this.typingStates.delete(key);
      this.broadcastTypingState(
        threadId, 
        participantId, 
        state.participantType, 
        state.participantName, 
        false
      );
    }
  }

  private broadcastTypingState(
    threadId: string,
    participantId: string,
    participantType: 'driver' | 'dispatch',
    participantName: string,
    isTyping: boolean
  ): void {
    const message = JSON.stringify({
      type: 'typing_update',
      threadId,
      participantId,
      participantType,
      participantName,
      isTyping,
      timestamp: Date.now()
    });

    this.clients.forEach((client, ws) => {
      if (client.threadId === threadId && client.participantId !== participantId) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    });
  }

  private cleanupStaleTypingStates(): void {
    const now = Date.now();
    const staleThreshold = 5000;

    this.typingStates.forEach((state, key) => {
      if (now - state.lastUpdate > staleThreshold) {
        this.typingStates.delete(key);
        this.broadcastTypingState(
          state.threadId,
          state.participantId,
          state.participantType,
          state.participantName,
          false
        );
      }
    });
  }

  getTypingStatus(threadId: string): TypingState[] {
    const result: TypingState[] = [];
    this.typingStates.forEach((state) => {
      if (state.threadId === threadId && state.isTyping) {
        result.push(state);
      }
    });
    return result;
  }

  setTypingStatus(
    threadId: string,
    participantId: string,
    participantType: 'driver' | 'dispatch',
    participantName: string,
    isTyping: boolean
  ): void {
    if (isTyping) {
      this.handleTypingStart(threadId, participantId, participantType, participantName);
    } else {
      this.handleTypingStop(threadId, participantId);
    }
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.wss) {
      this.wss.close();
    }
    this.clients.clear();
    this.typingStates.clear();
    this.isInitialized = false;
    console.log('🔌 Typing indicator service shut down');
  }
}

export const typingIndicatorService = new TypingIndicatorService();
