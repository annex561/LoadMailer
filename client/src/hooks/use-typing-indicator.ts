import { useState, useEffect, useCallback, useRef } from 'react';

interface TypingState {
  participantId: string;
  participantType: 'driver' | 'dispatch';
  participantName: string;
  isTyping: boolean;
}

interface UseTypingIndicatorOptions {
  threadId: string;
  participantId: string;
  participantType: 'driver' | 'dispatch';
  participantName: string;
  enabled?: boolean;
}

export function useTypingIndicator({
  threadId,
  participantId,
  participantType,
  participantName,
  enabled = true
}: UseTypingIndicatorOptions) {
  const [othersTyping, setOthersTyping] = useState<TypingState[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  const connect = useCallback(() => {
    if (!enabled || !threadId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/typing`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        ws.send(JSON.stringify({
          type: 'register',
          threadId,
          participantId,
          participantType,
          participantName
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'typing_update') {
            setOthersTyping(prev => {
              const filtered = prev.filter(t => t.participantId !== message.participantId);
              if (message.isTyping) {
                return [...filtered, {
                  participantId: message.participantId,
                  participantType: message.participantType,
                  participantName: message.participantName,
                  isTyping: true
                }];
              }
              return filtered;
            });
          }
        } catch (error) {
          console.error('Error parsing typing message:', error);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        
        if (enabled) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }
  }, [enabled, threadId, participantId, participantType, participantName]);

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [connect]);

  const sendTypingStart = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    // Always send typing_start to refresh the lastUpdate timestamp on the server
    // This ensures the typing state stays active while user continues typing
    wsRef.current.send(JSON.stringify({
      type: 'typing_start',
      threadId,
      participantId,
      participantType,
      participantName
    }));
    isTypingRef.current = true;

    // Reset the inactivity timeout (5 seconds to match server-side cleanup)
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      sendTypingStop();
    }, 5000);
  }, [threadId, participantId, participantType, participantName]);

  const sendTypingStop = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    if (isTypingRef.current) {
      isTypingRef.current = false;
      wsRef.current.send(JSON.stringify({
        type: 'typing_stop',
        threadId,
        participantId,
        participantType,
        participantName
      }));
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, [threadId, participantId, participantType, participantName]);

  const handleInputChange = useCallback(() => {
    sendTypingStart();
  }, [sendTypingStart]);

  const handleInputBlur = useCallback(() => {
    sendTypingStop();
  }, [sendTypingStop]);

  const handleMessageSent = useCallback(() => {
    sendTypingStop();
  }, [sendTypingStop]);

  return {
    othersTyping,
    isConnected,
    handleInputChange,
    handleInputBlur,
    handleMessageSent,
    sendTypingStart,
    sendTypingStop
  };
}
