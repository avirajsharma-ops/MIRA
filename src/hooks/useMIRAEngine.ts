import { useState, useCallback, useRef } from 'react';
import { useRealtime } from './useRealtime';

export type AIProvider = 'gemini' | 'openai' | 'perplexity';

interface EngineConfig {
  onTranscript?: (text: string) => void;
  onResponse?: (text: string) => void;
  onError?: (error: string) => void;
  onIdleDisconnect?: () => void; // COST OPTIMIZATION: Callback when auto-disconnected
  voice?: 'mira' | 'aks';
}

// Simplified engine - uses OpenAI Realtime directly
// COST OPTIMIZATION: Auto-disconnects after 3 minutes of idle
export function useMIRAEngine(config: EngineConfig = {}) {
  const [activeProvider] = useState<AIProvider>('openai'); // OpenAI is primary for now
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'connecting' | 'error'>('disconnected');

  // OpenAI Realtime Hook - primary engine
  const openAI = useRealtime({
    voice: config.voice || 'mira',
    onTranscript: config.onTranscript,
    onResponse: config.onResponse,
    onStateChange: (state) => {
      console.log('[MIRAEngine] OpenAI state:', state);
      if (state === 'connected' || state === 'listening' || state === 'speaking') {
        setStatus('connected');
      } else if (state === 'disconnected') {
        setStatus('disconnected');
      } else if (state === 'connecting') {
        setStatus('connecting');
      }
    },
    onError: (err) => {
      console.error('[MIRAEngine] OpenAI Error:', err);
      config.onError?.(err);
    },
    // COST OPTIMIZATION: Handle idle disconnect
    onIdleDisconnect: () => {
      console.log('[MIRAEngine] Auto-disconnected due to inactivity to save costs');
      setStatus('disconnected');
      config.onIdleDisconnect?.();
    },
  });

  const connect = useCallback(async () => {
    console.log('[MIRAEngine] Connecting...');
    setStatus('connecting');
    await openAI.connect();
  }, [openAI]);

  const disconnect = useCallback(() => {
    console.log('[MIRAEngine] Disconnecting...');
    openAI.disconnect();
    setStatus('disconnected');
  }, [openAI]);

  // COST OPTIMIZATION: Reset idle timer on user activity
  const resetIdleTimer = useCallback(() => {
    openAI.resetIdleTimer();
  }, [openAI]);

  return {
    connect,
    disconnect,
    resetIdleTimer, // COST OPTIMIZATION: Call this on user interaction
    activeProvider,
    status,
    isConnected: openAI.isConnected,
    isListening: openAI.isListening,
    isSpeaking: openAI.isSpeaking,
    transcript: openAI.transcript,
    lastResponse: openAI.lastResponse,
    audioLevel: openAI.inputAudioLevel,
    outputAudioLevel: openAI.outputAudioLevel, // MIRA's voice level for sphere reactivity
  };
}
