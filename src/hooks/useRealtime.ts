'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// COST OPTIMIZATION: Auto-disconnect after idle timeout
const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes of no activity = disconnect
const ACTIVITY_CHECK_INTERVAL = 30 * 1000; // Check every 30 seconds

interface RealtimeConfig {
  voice?: 'mira' | 'aks';
  onTranscript?: (text: string) => void;
  onResponse?: (text: string) => void;
  onError?: (error: string) => void;
  onStateChange?: (state: RealtimeState) => void;
  onIdleDisconnect?: () => void; // Callback when disconnected due to idle
}

type RealtimeState = 'disconnected' | 'connecting' | 'connected' | 'speaking' | 'listening';

interface UseRealtimeReturn {
  state: RealtimeState;
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnected: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  transcript: string;
  lastResponse: string;
  inputAudioLevel: number;
  outputAudioLevel: number;
  resetIdleTimer: () => void; // Call this on any user activity
}

export function useRealtime(config: RealtimeConfig = {}): UseRealtimeReturn {
  const {
    voice = 'mira',
    onTranscript,
    onResponse,
    onError,
    onStateChange,
    onIdleDisconnect,
  } = config;

  const [state, setState] = useState<RealtimeState>('disconnected');
  const [transcript, setTranscript] = useState('');
  const [lastResponse, setLastResponse] = useState('');
  const [inputAudioLevel, setInputAudioLevel] = useState(0);
  const [outputAudioLevel, setOutputAudioLevel] = useState(0);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Connection guard to prevent double connections (React state updates are async)
  const isConnectingRef = useRef(false);
  
  // COST OPTIMIZATION: Idle timeout tracking
  const lastActivityRef = useRef<number>(Date.now());
  const idleCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const inputLevelRef = useRef(0);
  const outputLevelRef = useRef(0);
  const lastUpdateTimeRef = useRef(0);

  // COST OPTIMIZATION: Reset idle timer on activity
  const resetIdleTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // Audio level monitoring - improved for better sphere reactivity
  const startAudioLevelMonitoring = useCallback(() => {
    let lastOutputLevel = 0;
    let lastInputLevel = 0;
    
    const updateLevels = () => {
      const now = Date.now();
      
      // Input (microphone) level
      if (inputAnalyserRef.current) {
        const inputData = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
        inputAnalyserRef.current.getByteFrequencyData(inputData);
        // Use RMS for smoother, more accurate level
        const sumSquares = inputData.reduce((sum, val) => sum + val * val, 0);
        const rms = Math.sqrt(sumSquares / inputData.length);
        const normalized = Math.min(1, rms / 100);
        // Smooth transition
        lastInputLevel = lastInputLevel * 0.7 + normalized * 0.3;
        inputLevelRef.current = lastInputLevel;
        
        // COST OPTIMIZATION: Significant audio input = activity
        if (normalized > 0.1) {
          lastActivityRef.current = Date.now();
        }
      }
      
      // Output (MIRA's voice) level
      if (outputAnalyserRef.current) {
        const outputData = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
        outputAnalyserRef.current.getByteFrequencyData(outputData);
        // Use RMS for smoother, more accurate level
        const sumSquares = outputData.reduce((sum, val) => sum + val * val, 0);
        const rms = Math.sqrt(sumSquares / outputData.length);
        const normalized = Math.min(1, rms / 100);
        // Smooth with slightly faster response for output
        lastOutputLevel = lastOutputLevel * 0.6 + normalized * 0.4;
        outputLevelRef.current = lastOutputLevel;
        
        // COST OPTIMIZATION: MIRA speaking = activity
        if (normalized > 0.1) {
          lastActivityRef.current = Date.now();
        }
      } else {
        // Decay output level if no analyser
        lastOutputLevel = lastOutputLevel * 0.95;
        outputLevelRef.current = lastOutputLevel;
      }
      
      // Update state every 30ms for smoother animation
      if (now - lastUpdateTimeRef.current > 30) {
        setInputAudioLevel(inputLevelRef.current);
        setOutputAudioLevel(outputLevelRef.current);
        lastUpdateTimeRef.current = now;
      }
      
      animationFrameRef.current = requestAnimationFrame(updateLevels);
    };
    
    updateLevels();
  }, []);

  const updateState = useCallback((newState: RealtimeState) => {
    setState(newState);
    onStateChange?.(newState);
  }, [onStateChange]);

  const getAuthToken = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('mira_token');
  }, []);

  // Connect to OpenAI Realtime API via WebRTC
  const connect = useCallback(async () => {
    // Double-check with ref to prevent race conditions (state updates are async)
    if (state !== 'disconnected' || isConnectingRef.current) {
      console.log('[Realtime] Already connected or connecting, skipping');
      return;
    }
    
    isConnectingRef.current = true;
    updateState('connecting');

    try {
      const authToken = getAuthToken();
      if (!authToken) {
        isConnectingRef.current = false;
        throw new Error('Not authenticated');
      }

      // Get ephemeral token from backend
      const sessionResponse = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ voice }),
      });

      if (!sessionResponse.ok) {
        const error = await sessionResponse.json();
        throw new Error(error.error || 'Failed to create session');
      }

      const { client_secret } = await sessionResponse.json();

      // Set up audio context FIRST for proper analysis
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Create peer connection
      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;

      // Set up audio output element
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioElementRef.current = audioEl;
      
      pc.ontrack = (e) => {
        console.log('[Realtime] Received audio track');
        audioEl.srcObject = e.streams[0];
        
        // Set up output audio analysis using the stream directly
        // NOTE: Only connect to analyser, NOT to audioContext.destination
        // The audio element handles playback - connecting to destination causes echo!
        if (audioContext && e.streams[0]) {
          try {
            const outputSource = audioContext.createMediaStreamSource(e.streams[0]);
            const outputAnalyser = audioContext.createAnalyser();
            outputAnalyser.fftSize = 256;
            outputAnalyser.smoothingTimeConstant = 0.3; // Faster response
            outputSource.connect(outputAnalyser);
            // DO NOT connect to destination - audioEl handles playback
            // outputSource.connect(audioContext.destination); // REMOVED - causes echo!
            outputAnalyserRef.current = outputAnalyser;
            console.log('[Realtime] Output audio analyser set up (no duplicate playback)');
          } catch (err) {
            console.error('[Realtime] Error setting up output analyser:', err);
          }
        }
        
        // Reset connection guard on successful connection
        isConnectingRef.current = false;
        updateState('connected');
      };

      // Get microphone access
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = mediaStream;

      // Set up input audio analysis
      const inputSource = audioContext.createMediaStreamSource(mediaStream);
      const inputAnalyser = audioContext.createAnalyser();
      inputAnalyser.fftSize = 256;
      inputAnalyser.smoothingTimeConstant = 0.3;
      inputSource.connect(inputAnalyser);
      inputAnalyserRef.current = inputAnalyser;
      
      // Start monitoring audio levels
      startAudioLevelMonitoring();

      // Add audio track to peer connection
      mediaStream.getTracks().forEach(track => {
        pc.addTrack(track, mediaStream);
      });

      // Create data channel for events
      const dc = pc.createDataChannel('oai-events');
      dataChannelRef.current = dc;

      dc.onopen = () => {
        console.log('[Realtime] Data channel opened');
        updateState('listening');
      };

      dc.onmessage = (e) => {
        handleServerEvent(JSON.parse(e.data));
      };

      dc.onerror = (e) => {
        console.error('[Realtime] Data channel error:', e);
        onError?.('Data channel error');
      };

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Connect via server proxy
      const sdpResponse = await fetch('/api/realtime/connect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sdp: offer.sdp,
          client_secret,
        }),
      });

      if (!sdpResponse.ok) {
        throw new Error('Failed to establish WebRTC connection');
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      console.log('[Realtime] WebRTC connection established');
      // Reset connecting flag on success (state will be updated via ontrack)

    } catch (error) {
      console.error('[Realtime] Connection error:', error);
      onError?.(error instanceof Error ? error.message : 'Connection failed');
      updateState('disconnected');
      isConnectingRef.current = false;
      cleanup();
    }
  }, [state, voice, getAuthToken, updateState, onError, startAudioLevelMonitoring]);

  // Handle server events - pure WebRTC streaming
  const handleServerEvent = useCallback((event: any) => {
    if (!event.type.includes('delta')) {
      console.log('[Realtime] Event:', event.type);
    }

    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        console.log('[Realtime] Session ready');
        break;

      case 'input_audio_buffer.speech_started':
        console.log('[Realtime] Speech started');
        updateState('listening');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('[Realtime] Speech stopped');
        break;

      case 'response.audio_transcript.delta':
      case 'response.audio.delta':
        updateState('speaking');
        break;

      case 'response.audio_transcript.done':
        const responseText = event.transcript || '';
        setLastResponse(responseText);
        onResponse?.(responseText);
        break;

      case 'response.done':
        console.log('[Realtime] Response complete');
        setTimeout(() => updateState('listening'), 300);
        break;

      case 'conversation.item.input_audio_transcription.completed':
        const userText = event.transcript || '';
        console.log('[Realtime] User said:', userText);
        setTranscript(userText);
        onTranscript?.(userText);
        break;

      case 'error':
        console.error('[Realtime] Error:', event.error);
        const errorMsg = event.error?.message || 'Unknown error';
        if (!errorMsg.toLowerCase().includes('cancel')) {
          onError?.(errorMsg);
        }
        break;
    }
  }, [updateState, onTranscript, onResponse, onError]);

  // Cleanup resources
  const cleanup = useCallback(() => {
    // COST OPTIMIZATION: Clear idle check interval
    if (idleCheckIntervalRef.current) {
      clearInterval(idleCheckIntervalRef.current);
      idleCheckIntervalRef.current = null;
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;
    
    setInputAudioLevel(0);
    setOutputAudioLevel(0);
    
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    if (audioElementRef.current) {
      audioElementRef.current.srcObject = null;
      audioElementRef.current = null;
    }
    
    // Reset connection guard
    isConnectingRef.current = false;
  }, []);

  const disconnect = useCallback(() => {
    console.log('[Realtime] Disconnecting');
    cleanup();
    updateState('disconnected');
  }, [cleanup, updateState]);

  // COST OPTIMIZATION: Start idle check when connected
  useEffect(() => {
    if (state === 'connected' || state === 'listening' || state === 'speaking') {
      // Reset activity timer when connected
      lastActivityRef.current = Date.now();
      
      // Start idle check interval
      if (!idleCheckIntervalRef.current) {
        console.log('[Realtime] Starting idle detection - will disconnect after', IDLE_TIMEOUT_MS / 1000, 'seconds of inactivity');
        
        idleCheckIntervalRef.current = setInterval(() => {
          const idleTime = Date.now() - lastActivityRef.current;
          
          if (idleTime >= IDLE_TIMEOUT_MS) {
            console.log('[Realtime] Idle timeout - disconnecting to save costs. Idle for', Math.round(idleTime / 1000), 'seconds');
            
            // Clear the interval first
            if (idleCheckIntervalRef.current) {
              clearInterval(idleCheckIntervalRef.current);
              idleCheckIntervalRef.current = null;
            }
            
            // Disconnect
            cleanup();
            updateState('disconnected');
            onIdleDisconnect?.();
          }
        }, ACTIVITY_CHECK_INTERVAL);
      }
    } else {
      // Clear interval when disconnected
      if (idleCheckIntervalRef.current) {
        clearInterval(idleCheckIntervalRef.current);
        idleCheckIntervalRef.current = null;
      }
    }
    
    return () => {
      if (idleCheckIntervalRef.current) {
        clearInterval(idleCheckIntervalRef.current);
        idleCheckIntervalRef.current = null;
      }
    };
  }, [state, cleanup, updateState, onIdleDisconnect]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return {
    state,
    connect,
    disconnect,
    isConnected: state !== 'disconnected' && state !== 'connecting',
    isSpeaking: state === 'speaking',
    isListening: state === 'listening',
    transcript,
    lastResponse,
    inputAudioLevel,
    outputAudioLevel,
    resetIdleTimer,
  };
}

export default useRealtime;
