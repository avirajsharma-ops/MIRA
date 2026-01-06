'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface RealtimeConfig {
  voice?: 'mi' | 'ra' | 'mira';
  instructions?: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAudioResponse?: (text: string) => void;
  onError?: (error: string) => void;
  onStateChange?: (state: RealtimeState) => void;
  // Hybrid mode: if true, won't auto-respond - waits for injectResponse()
  hybridMode?: boolean;
}

type RealtimeState = 'disconnected' | 'connecting' | 'connected' | 'speaking' | 'listening';

interface UseRealtimeReturn {
  state: RealtimeState;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendText: (text: string) => void;
  // Hybrid mode methods
  injectResponse: (text: string, agent?: 'mi' | 'ra' | 'mira') => void; // Make AI speak this text
  cancelResponse: () => void; // Stop current AI response
  updateInstructions: (instructions: string) => void; // Update session instructions
  isConnected: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  transcript: string;
  lastResponse: string;
  inputAudioLevel: number;  // 0-1 mic audio level for sphere reactivity
  outputAudioLevel: number; // 0-1 AI audio level for sphere reactivity
}

export function useRealtime(config: RealtimeConfig = {}): UseRealtimeReturn {
  const {
    voice = 'mi',
    instructions,
    onTranscript,
    onAudioResponse,
    onError,
    onStateChange,
    hybridMode = false, // Default: full AI mode
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

  // Refs to store current audio levels (avoid setState on every frame)
  const inputLevelRef = useRef(0);
  const outputLevelRef = useRef(0);
  const lastUpdateTimeRef = useRef(0);

  // Audio level monitoring function - throttled to prevent infinite loop
  const startAudioLevelMonitoring = useCallback(() => {
    const updateLevels = () => {
      const now = Date.now();
      
      // Update input (mic) level
      if (inputAnalyserRef.current) {
        const inputData = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
        inputAnalyserRef.current.getByteFrequencyData(inputData);
        const inputAvg = inputData.reduce((a, b) => a + b, 0) / inputData.length;
        inputLevelRef.current = Math.min(1, inputAvg / 128); // Store in ref
      }
      
      // Update output (AI) level
      if (outputAnalyserRef.current) {
        const outputData = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
        outputAnalyserRef.current.getByteFrequencyData(outputData);
        const outputAvg = outputData.reduce((a, b) => a + b, 0) / outputData.length;
        outputLevelRef.current = Math.min(1, outputAvg / 128); // Store in ref
      }
      
      // Only update React state every 50ms to prevent infinite loop
      if (now - lastUpdateTimeRef.current > 50) {
        setInputAudioLevel(inputLevelRef.current);
        setOutputAudioLevel(outputLevelRef.current);
        lastUpdateTimeRef.current = now;
      }
      
      animationFrameRef.current = requestAnimationFrame(updateLevels);
    };
    
    updateLevels();
  }, []);

  // Update state and notify
  const updateState = useCallback((newState: RealtimeState) => {
    setState(newState);
    onStateChange?.(newState);
  }, [onStateChange]);

  // Get auth token
  const getAuthToken = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('mira_token');
  }, []);

  // Connect to OpenAI Realtime API via WebRTC
  const connect = useCallback(async () => {
    if (state !== 'disconnected') {
      console.log('[Realtime] Already connected or connecting');
      return;
    }

    updateState('connecting');

    try {
      const authToken = getAuthToken();
      if (!authToken) {
        throw new Error('Not authenticated');
      }

      // Get ephemeral token from our backend
      const sessionResponse = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ voice, instructions }),
      });

      if (!sessionResponse.ok) {
        const error = await sessionResponse.json();
        throw new Error(error.error || 'Failed to create session');
      }

      const { client_secret } = await sessionResponse.json();

      // Create peer connection
      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;

      // Set up audio output
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioElementRef.current = audioEl;
      
      pc.ontrack = (e) => {
        console.log('[Realtime] Received audio track');
        audioEl.srcObject = e.streams[0];
        
        // Set up audio analysis for output (AI) audio level
        if (audioContextRef.current && e.streams[0]) {
          const outputSource = audioContextRef.current.createMediaStreamSource(e.streams[0]);
          const outputAnalyser = audioContextRef.current.createAnalyser();
          outputAnalyser.fftSize = 256;
          outputSource.connect(outputAnalyser);
          outputAnalyserRef.current = outputAnalyser;
          
          // Start audio level monitoring loop
          startAudioLevelMonitoring();
        }
        
        updateState('connected');
      };

      // Get microphone access
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 24000,
        },
      });
      mediaStreamRef.current = mediaStream;

      // Set up audio analysis for input (mic) audio level
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      
      const inputSource = audioContext.createMediaStreamSource(mediaStream);
      const inputAnalyser = audioContext.createAnalyser();
      inputAnalyser.fftSize = 256;
      inputSource.connect(inputAnalyser);
      inputAnalyserRef.current = inputAnalyser;

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

      // Connect to OpenAI Realtime API via WebRTC
      // The client_secret is used as Bearer token, model is specified in URL
      const baseUrl = 'https://api.openai.com/v1/realtime';
      const model = 'gpt-4o-realtime-preview-2024-12-17';
      
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${client_secret}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        console.error('[Realtime] WebRTC SDP error:', sdpResponse.status, errorText);
        throw new Error('Failed to establish WebRTC connection');
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      console.log('[Realtime] WebRTC connection established');

    } catch (error) {
      console.error('[Realtime] Connection error:', error);
      onError?.(error instanceof Error ? error.message : 'Connection failed');
      updateState('disconnected');
      cleanup();
    }
  }, [state, voice, instructions, getAuthToken, updateState, onError]);

  // Handle server events
  const handleServerEvent = useCallback((event: any) => {
    // Skip spammy delta events in logs
    if (!event.type.includes('delta')) {
      console.log('[Realtime] Server event:', event.type);
    }

    switch (event.type) {
      case 'session.created':
        console.log('[Realtime] Session created');
        // Session is configured at creation time via /api/realtime/session
        // No need to update here - hybrid mode is set via create_response: false in session config
        break;

      case 'session.updated':
        console.log('[Realtime] Session updated');
        break;

      case 'input_audio_buffer.speech_started':
        // Note: WebRTC handles echo cancellation automatically
        // Don't change state here - it can cause self-interruption issues
        // when MIRA's voice is picked up by the microphone
        console.log('[Realtime] VAD detected speech start');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('[Realtime] VAD detected speech stop');
        break;

      case 'conversation.item.input_audio_transcription.completed':
        // User's speech transcribed
        const userTranscript = event.transcript || '';
        console.log('[Realtime] Transcription complete:', userTranscript);
        setTranscript(userTranscript);
        onTranscript?.(userTranscript, true);
        // In hybrid mode, the caller handles what to do with the transcript
        break;

      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta':
      case 'response.audio.delta':
        // AI is speaking - streaming audio (only update state, don't log)
        updateState('speaking');
        break;

      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done':
        // AI finished transcribing this part (but audio may still be playing)
        const responseText = event.transcript || '';
        setLastResponse(responseText);
        onAudioResponse?.(responseText);
        break;

      case 'response.audio.done':
        // Audio finished - but keep speaking state briefly to let audio buffer flush
        console.log('[Realtime] Audio stream done, keeping speaking state for buffer flush');
        // Don't immediately go to listening - wait for response.done
        break;

      case 'response.done':
        console.log('[Realtime] Response complete');
        // Add a small delay to ensure audio buffer finishes playing
        setTimeout(() => {
          updateState('listening');
        }, 500);
        break;

      case 'error':
        // Log full error details for debugging
        console.error('[Realtime] Error:', JSON.stringify(event.error || event));
        const errorMsg = event.error?.message || event.message || 'Unknown error';
        // Don't report "cancelled" errors - those are intentional
        if (!errorMsg.toLowerCase().includes('cancel')) {
          onError?.(errorMsg);
        }
        break;

      default:
        // Log other unhandled events (except deltas)
        if (!event.type.includes('delta')) {
          console.log('[Realtime] Unhandled event:', event.type);
        }
    }
  }, [hybridMode, updateState, onTranscript, onAudioResponse, onError]);

  // Send text message (for hybrid text+voice)
  const sendText = useCallback((text: string) => {
    const dc = dataChannelRef.current;
    if (!dc || dc.readyState !== 'open') {
      console.warn('[Realtime] Data channel not ready');
      return;
    }

    // Create conversation item with text
    dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: text,
          },
        ],
      },
    }));

    // Request response
    dc.send(JSON.stringify({
      type: 'response.create',
    }));
  }, []);

  // HYBRID MODE: Inject a response for the AI to speak (bypasses AI thinking)
  const injectResponse = useCallback((text: string, agent?: 'mi' | 'ra' | 'mira') => {
    const dc = dataChannelRef.current;
    if (!dc || dc.readyState !== 'open') {
      console.warn('[Realtime] Data channel not ready for injectResponse');
      return;
    }

    // Voice mapping: MI/MIRA = coral (female), RA = ash (male)
    // Note: Voice is set at session creation. Dynamic switching requires reconnection.
    const voiceMap: Record<string, string> = {
      mi: 'coral',
      ra: 'ash',
      mira: 'coral',
    };
    const expectedVoice = agent ? voiceMap[agent] : 'coral';

    console.log('[Realtime] Injecting response as', agent, '(voice:', expectedVoice, '):', text.substring(0, 50) + '...');
    
    // IMPORTANT: Cancel any ongoing response first to avoid "active response in progress" error
    dc.send(JSON.stringify({
      type: 'response.cancel',
    }));
    
    // Small delay to ensure cancel is processed before creating new response
    setTimeout(() => {
      if (!dc || dc.readyState !== 'open') return;
      
      // Send as user message with instruction to speak - this triggers TTS properly
      // The OpenAI Realtime API will then speak the response
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `[SPEAK EXACTLY AS WRITTEN - DO NOT MODIFY OR ADD ANYTHING]: ${text}`,
            },
          ],
        },
      }));

      // Request response to generate audio
      dc.send(JSON.stringify({
        type: 'response.create',
      }));
      
      updateState('speaking');
    }, 50); // 50ms delay to ensure cancel is processed
  }, [updateState]);

  // Cancel ongoing AI response
  const cancelResponse = useCallback(() => {
    const dc = dataChannelRef.current;
    if (!dc || dc.readyState !== 'open') {
      console.warn('[Realtime] Data channel not ready for cancelResponse');
      return;
    }

    console.log('[Realtime] Cancelling response');
    dc.send(JSON.stringify({
      type: 'response.cancel',
    }));
    
    updateState('listening');
  }, [updateState]);

  // Update session instructions dynamically
  const updateInstructions = useCallback((_newInstructions: string) => {
    // Note: session.update requires specific parameters that may cause errors
    // Instructions are set at session creation time via /api/realtime/session
    // This function is kept for interface compatibility but is a no-op
    console.log('[Realtime] updateInstructions called (no-op - set at session creation)');
  }, []);

  // Cleanup resources
  const cleanup = useCallback(() => {
    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    // Clear analysers
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;
    
    // Reset audio levels
    setInputAudioLevel(0);
    setOutputAudioLevel(0);
    
    // Stop media tracks
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    // Close data channel
    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    // Close peer connection
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    // Clean up audio element
    if (audioElementRef.current) {
      audioElementRef.current.srcObject = null;
      audioElementRef.current = null;
    }
  }, []);

  // Disconnect from realtime API
  const disconnect = useCallback(() => {
    console.log('[Realtime] Disconnecting');
    cleanup();
    updateState('disconnected');
  }, [cleanup, updateState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    state,
    connect,
    disconnect,
    sendText,
    // Hybrid mode methods
    injectResponse,
    cancelResponse,
    updateInstructions,
    isConnected: state !== 'disconnected' && state !== 'connecting',
    isSpeaking: state === 'speaking',
    isListening: state === 'listening',
    transcript,
    lastResponse,
    inputAudioLevel,
    outputAudioLevel,
  };
}

export default useRealtime;
