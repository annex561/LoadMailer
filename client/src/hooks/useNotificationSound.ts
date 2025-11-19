import { useEffect, useRef } from 'react';

export function useNotificationSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    audioRef.current = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGGm98OScTgwOUKXh8bllHAU2jdXyzn0vBSB1xe/glEILElyx6OyrWBUIRp3e8sFuJAUrgc7y2Yk2Bhdo+vDqnVAMDlCl4fK6ZRwFNo3V8s59LwUgdcXv4pVDCxJcsejtq1gUCEad3vLBbiQFK4HO8tmJNgYXaPrw6p1QDA5QpeHyumUcBTaN1fLOfS8FIHXF7+KVQwsSXLHo7atYFAdGnd7ywW4kBSuBzvLZiTYGF2j68OqdUAwOUKXh8rplHAU2jdXyzn0vBSB1xe/ilUMLElyx6O2rWBQHRp3e8sFuJAUrgc7y2Yk2Bhdo+vDqnVAMDlCl4fK6ZRwFNo3V8s59LwUgdcXv4pVDCxJcsejtq1gUB0ad3vLBbiQFK4HO8tmJNgYXaPrw6p1QDA5QpeHyumUcBTaN1fLOfS8FIHXF7+KVQwsSXLHo7atYFAdGnd7ywW4kBSuBzvLZiTYGF2j68OqdUAwOUKXh8rplHAU2jdXyzn0vBSB1xe/ilUMLElyx6O2rWBQHRp3e8sFuJAUrgc7y2Yk2Bhdo+vDqnVAMDlCl4fK6ZRwFNo3V8s59LwUgdcXv4pVDCxJcsejtq1gUB0ad3vLBbiQFK4HO8tmJNgYXaPrw6p1QDA5QpeHyumUcBTaN1fLOfS8FIHXF7+KVQwsSXLHo7atYFAdGnd7ywW4kBSuBzvLZiTYGF2j68OqdUAwOUKXh8rplHAU2jdXyzn0vBSB1xe/ilUMLElyx6O2rWBQHRp3e8sFuJAUrgc7y2Yk2Bhdo+vDqnVAMDlCl4fK6ZRwFNo3V8s59LwUgdcXv4pVDCxJcsejtq1gUB0ad3vLBbiQFK4HO8tmJNgYXaPrw6p1QDA5QpeHyumUcBTaN1fLOfS8FIHXF7+KVQwsSXLHo7atYFAdGnd7ywW4kBSuBzvLZiTYGF2j68OqdUAwOUKXh8rplHAU2jdXyzn0vBSB1xe/ilUMLElyx6O2rWBQHRp3e8sFuJAU=');
    audioRef.current.volume = 0.5;
  }, []);

  const playSound = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(err => {
        console.log('Audio play failed:', err);
      });
    }
  };

  return { playSound };
}

export function useMessageNotification(
  messages: any[], 
  enabled: boolean = true,
  watchSenderRole: 'driver' | 'dispatch' = 'driver'
) {
  const previousCountRef = useRef<number>(0);
  const { playSound } = useNotificationSound();
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    if (!enabled || !messages) return;

    if (isInitialLoadRef.current) {
      previousCountRef.current = messages.length;
      isInitialLoadRef.current = false;
      return;
    }

    if (messages.length > previousCountRef.current) {
      const newMessages = messages.slice(previousCountRef.current);
      const hasIncomingMessage = newMessages.some((msg: any) => {
        // Check both senderRole and sender fields for compatibility
        const messageSender = msg.senderRole || msg.sender;
        return messageSender === watchSenderRole;
      });

      if (hasIncomingMessage) {
        playSound();
      }
    }

    previousCountRef.current = messages.length;
  }, [messages, enabled, playSound, watchSenderRole]);

  return { playSound };
}
