'use client';

import { useState, useCallback } from 'react';
import { useRealtime } from './useRealtime';

interface EngineConfig {
  onTranscript?: (text: string) => void;
  onResponse?: (text: string) => void;
  onError?: (error: string) => void;
  onIdleDisconnect?: () => void;
  voice?: 'mira' | 'aks';
}

// Using OpenAI Realtime API for voice AI
export function useMIRAEngine(config: EngineConfig = {}) {
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'connecting' | 'error'>('disconnected');

  // OpenAI Realtime Hook - primary and only engine for now
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
    onIdleDisconnect: () => {
      console.log('[MIRAEngine] Auto-disconnected due to inactivity to save costs');
      setStatus('disconnected');
      config.onIdleDisconnect?.();
    },
  });

  const connect = useCallback(async (quickReconnect: boolean = false) => {
    console.log('[MIRAEngine] Connecting to OpenAI Realtime...', quickReconnect ? '(QUICK MODE)' : '');
    setStatus('connecting');
    await openAI.connect(quickReconnect);
  }, [openAI]);

  const disconnect = useCallback(() => {
    console.log('[MIRAEngine] Disconnecting...');
    openAI.disconnect();
    setStatus('disconnected');
  }, [openAI]);

  const resetIdleTimer = useCallback(() => {
    openAI.resetIdleTimer();
  }, [openAI]);

  // Make MIRA speak out loud
  const speak = useCallback((text: string) => {
    openAI.speak(text);
  }, [openAI]);

  return {
    connect,
    disconnect,
    resetIdleTimer,
    speak,
    status,
    isConnected: openAI.isConnected,
    isListening: openAI.isListening,
    isSpeaking: openAI.isSpeaking,
    transcript: openAI.transcript,
    lastResponse: openAI.lastResponse,
    audioLevel: openAI.inputAudioLevel,
    outputAudioLevel: openAI.outputAudioLevel,
  };
}
