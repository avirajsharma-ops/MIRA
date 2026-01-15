'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// === SIMPLE IDLE DETECTION CONFIG ===
const SPEECH_THRESHOLD = 0.68; // Audio level must exceed this to be considered speech
const CONSECUTIVE_SPEECH_SAMPLES_TO_RESET = 4; // Need 4 consecutive high samples to reset timer
const SPEECH_CHECK_INTERVAL_MS = 250; // Check audio level every 250ms (so 4 samples = 1 second)
const IDLE_TIMEOUT_SECONDS = 15; // 10 seconds of silence = idle

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
  connect: (quickReconnect?: boolean) => Promise<void>;
  disconnect: () => void;
  isConnected: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  transcript: string;
  lastResponse: string;
  inputAudioLevel: number;
  outputAudioLevel: number;
  resetIdleTimer: () => void; // Call this on any user activity
  speak: (text: string) => void; // Make MIRA speak this text
  injectContext: (context: string) => void; // Inject memory context before response
  sendUserMessage: (text: string) => void; // Send a text message as if user spoke it
  idleTimeRemaining: number; // Seconds until idle disconnect (for visual timer)
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
  const [idleTimeRemaining, setIdleTimeRemaining] = useState(IDLE_TIMEOUT_SECONDS);
  
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
  
  // Track if a response is in progress to avoid conflicts
  const isResponseInProgressRef = useRef(false);
  const pendingSpeakQueueRef = useRef<string[]>([]);
  
  // === SIMPLE IDLE DETECTION STATE ===
  const idleTimerRef = useRef<number>(IDLE_TIMEOUT_SECONDS); // Current countdown value
  const consecutiveSpeechSamplesRef = useRef<number>(0); // Count of consecutive high audio samples
  const lastSampleCheckTimeRef = useRef<number>(0); // Last time we checked audio sample
  
  // Store ALL callbacks in refs to avoid effect re-runs when callbacks change
  const onIdleDisconnectRef = useRef(onIdleDisconnect);
  const onStateChangeRef = useRef(onStateChange);
  const onTranscriptRef = useRef(onTranscript);
  const onResponseRef = useRef(onResponse);
  const onErrorRef = useRef(onError);
  
  // Store state in ref for idle timer interval
  const stateRef = useRef(state);
  
  // Keep refs in sync with latest values
  useEffect(() => {
    onIdleDisconnectRef.current = onIdleDisconnect;
    onStateChangeRef.current = onStateChange;
    onTranscriptRef.current = onTranscript;
    onResponseRef.current = onResponse;
    onErrorRef.current = onError;
    stateRef.current = state;
  }, [onIdleDisconnect, onStateChange, onTranscript, onResponse, onError, state]);

  const inputLevelRef = useRef(0);
  const outputLevelRef = useRef(0);
  const lastUpdateTimeRef = useRef(0);
  const audioMonitoringActiveRef = useRef(false);

  // === SIMPLE IDLE TIMER FUNCTIONS ===
  
  // Reset idle timer back to full duration
  const resetIdleTimer = useCallback(() => {
    idleTimerRef.current = IDLE_TIMEOUT_SECONDS;
    setIdleTimeRemaining(IDLE_TIMEOUT_SECONDS);
    consecutiveSpeechSamplesRef.current = 0;
    console.log('[Idle] ✓ Timer RESET to', IDLE_TIMEOUT_SECONDS, 'seconds');
  }, []);

  // Audio level monitoring - improved for better sphere reactivity
  // Uses RAF loop that stays active as long as we're connected
  const startAudioLevelMonitoring = useCallback(() => {
    // Prevent duplicate monitoring loops
    if (audioMonitoringActiveRef.current) {
      console.log('[Realtime] Audio monitoring already active');
      return;
    }
    
    audioMonitoringActiveRef.current = true;
    console.log('[Realtime] Starting audio level monitoring');
    
    let lastOutputLevel = 0;
    let lastInputLevel = 0;
    let debugCounter = 0;
    let lastStateUpdateTime = 0;
    const STATE_UPDATE_INTERVAL = 50; // Update React state at ~20fps, not 60fps
    
    const updateLevels = () => {
      // Stop if monitoring was deactivated
      if (!audioMonitoringActiveRef.current) {
        console.log('[Realtime] Audio monitoring stopped');
        return;
      }
      
      const now = Date.now();
      
      // Input (microphone) level - more aggressive smoothing for responsiveness
      if (inputAnalyserRef.current) {
        try {
          const inputData = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
          inputAnalyserRef.current.getByteFrequencyData(inputData);
          // Use RMS for smoother, more accurate level
          const sumSquares = inputData.reduce((sum, val) => sum + val * val, 0);
          const rms = Math.sqrt(sumSquares / inputData.length);
          // Normalize with higher sensitivity
          const normalized = Math.min(1, rms / 80);
          // Faster attack, slower decay for more responsive feel
          if (normalized > lastInputLevel) {
            lastInputLevel = lastInputLevel * 0.3 + normalized * 0.7; // Fast attack
          } else {
            lastInputLevel = lastInputLevel * 0.85 + normalized * 0.15; // Slower decay
          }
          inputLevelRef.current = lastInputLevel;
          
          // Debug logging every 2 seconds
          debugCounter++;
          if (debugCounter % 120 === 0 && lastInputLevel > 0.01) {
            console.log('[Idle] Audio level:', lastInputLevel.toFixed(3), 
              '| Speech threshold:', SPEECH_THRESHOLD,
              '| Consecutive high:', consecutiveSpeechSamplesRef.current);
          }
          
          // === SIMPLE SPEECH DETECTION ===
          // Check every SPEECH_CHECK_INTERVAL_MS (250ms)
          if (now - lastSampleCheckTimeRef.current >= SPEECH_CHECK_INTERVAL_MS) {
            lastSampleCheckTimeRef.current = now;
            
            if (lastInputLevel >= SPEECH_THRESHOLD) {
              // Audio is above speech threshold
              consecutiveSpeechSamplesRef.current++;
              
              if (consecutiveSpeechSamplesRef.current === CONSECUTIVE_SPEECH_SAMPLES_TO_RESET) {
                // Exactly 4 consecutive samples above 0.8 = confirmed speech, reset timer ONCE
                console.log('[Idle] ✓ SPEECH CONFIRMED - 4 consecutive samples ≥', SPEECH_THRESHOLD);
                idleTimerRef.current = IDLE_TIMEOUT_SECONDS;
                // Don't reset consecutiveSpeechSamplesRef here - let it keep counting
                // so we don't reset again until audio drops and rises again
              }
            } else {
              // Audio below threshold - reset consecutive counter
              consecutiveSpeechSamplesRef.current = 0;
            }
          }
        } catch (err) {
          // Analyser might be disconnected
          console.log('[Realtime] Input analyser error:', err);
        }
      } else {
        // Decay if no analyser
        lastInputLevel = lastInputLevel * 0.9;
        inputLevelRef.current = lastInputLevel;
      }
      
      // Output (MIRA's voice) level
      if (outputAnalyserRef.current) {
        try {
          const outputData = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
          outputAnalyserRef.current.getByteFrequencyData(outputData);
          // Use RMS for smoother, more accurate level
          const sumSquares = outputData.reduce((sum, val) => sum + val * val, 0);
          const rms = Math.sqrt(sumSquares / outputData.length);
          // Normalize with higher sensitivity
          const normalized = Math.min(1, rms / 80);
          // Faster response for output
          if (normalized > lastOutputLevel) {
            lastOutputLevel = lastOutputLevel * 0.2 + normalized * 0.8; // Very fast attack
          } else {
            lastOutputLevel = lastOutputLevel * 0.75 + normalized * 0.25; // Medium decay
          }
          outputLevelRef.current = lastOutputLevel;
          
          // Debug logging every 2 seconds when MIRA speaks
          if (debugCounter % 120 === 0 && lastOutputLevel > 0.01) {
            console.log('[Realtime] Output audio level:', lastOutputLevel.toFixed(3));
          }
          
          // NOTE: MIRA speaking is handled by the speak() function, NOT here
          // Don't reset timer on output audio - it causes constant resets
        } catch (err) {
          // Analyser might be disconnected
          console.log('[Realtime] Output analyser error:', err);
        }
      } else {
        // Decay output level if no analyser
        lastOutputLevel = lastOutputLevel * 0.9;
        outputLevelRef.current = lastOutputLevel;
      }
      
      // THROTTLE React state updates to prevent max update depth errors
      // Only update every 50ms (~20fps) instead of every frame (~60fps)
      if (now - lastStateUpdateTime >= STATE_UPDATE_INTERVAL) {
        lastStateUpdateTime = now;
        setInputAudioLevel(inputLevelRef.current);
        setOutputAudioLevel(outputLevelRef.current);
      }
      
      animationFrameRef.current = requestAnimationFrame(updateLevels);
    };
    
    updateLevels();
  }, []); // No dependencies - uses refs directly

  // Use ref for callback to ensure stable function reference
  const updateState = useCallback((newState: RealtimeState) => {
    // Update ref IMMEDIATELY so timer interval sees the new state right away
    stateRef.current = newState;
    setState(newState);
    onStateChangeRef.current?.(newState);
  }, []); // No dependencies - uses ref

  const getAuthToken = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('mira_token');
  }, []);

  // Connect to OpenAI Realtime API via WebRTC
  // quickReconnect: If true, uses faster session creation (skips heavy context loading)
  const connect = useCallback(async (quickReconnect: boolean = false) => {
    // Double-check with ref to prevent race conditions (state updates are async)
    if (state !== 'disconnected' || isConnectingRef.current) {
      console.log('[Realtime] Already connected or connecting, skipping');
      return;
    }
    
    isConnectingRef.current = true;
    updateState('connecting');
    
    const connectStart = Date.now();
    console.log('[Realtime] Starting connection...', quickReconnect ? '(QUICK RECONNECT MODE)' : '');

    try {
      const authToken = getAuthToken();
      if (!authToken) {
        isConnectingRef.current = false;
        throw new Error('Not authenticated');
      }

      // Get ephemeral token from backend
      // quickReconnect mode skips heavy context loading for faster wake-up
      const sessionResponse = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ voice, quickReconnect }),
      });
      
      console.log('[Realtime] Session token received in', Date.now() - connectStart, 'ms');

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
        console.log('[Realtime] Speech started (VAD)');
        updateState('listening');
        // NOTE: Do NOT reset idle timer here - let audio-based detection handle it
        // The VAD can trigger on ambient noise, our confidence-based detection is more accurate
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('[Realtime] Speech stopped (VAD)');
        // NOTE: Do NOT reset idle timer here either
        break;

      case 'response.created':
        // A response has started
        isResponseInProgressRef.current = true;
        break;

      case 'response.audio_transcript.delta':
      case 'response.audio.delta':
        updateState('speaking');
        isResponseInProgressRef.current = true;
        // NOTE: Don't reset timer here - these events fire continuously while MIRA speaks
        // The timer reset happens once at response.done
        break;

      case 'response.audio_transcript.done':
        const responseText = event.transcript || '';
        setLastResponse(responseText);
        onResponseRef.current?.(responseText);
        break;

      case 'response.done':
        console.log('[Realtime] Response complete');
        isResponseInProgressRef.current = false;
        // Reset idle timer ONCE when MIRA finishes speaking
        idleTimerRef.current = IDLE_TIMEOUT_SECONDS;
        setTimeout(() => {
          updateState('listening');
          // Process any queued speak requests
          if (pendingSpeakQueueRef.current.length > 0) {
            const nextMessage = pendingSpeakQueueRef.current.shift();
            if (nextMessage && dataChannelRef.current?.readyState === 'open') {
              console.log('[Realtime] Processing queued speak:', nextMessage);
              const responseEvent = {
                type: 'response.create',
                response: {
                  modalities: ['text', 'audio'],
                  instructions: `Say this reminder out loud to the user in a friendly, helpful tone: "${nextMessage}"`,
                },
              };
              dataChannelRef.current.send(JSON.stringify(responseEvent));
              isResponseInProgressRef.current = true;
            }
          }
        }, 300);
        break;

      case 'conversation.item.input_audio_transcription.completed':
        const userText = event.transcript || '';
        console.log('[Realtime] User said:', userText);
        setTranscript(userText);
        onTranscriptRef.current?.(userText);
        // Reset idle timer on confirmed transcription - this IS actual user speech
        idleTimerRef.current = IDLE_TIMEOUT_SECONDS;
        consecutiveSpeechSamplesRef.current = 0;
        console.log('[Idle] ✓ Timer RESET - User transcription completed');
        break;

      case 'error':
        console.error('[Realtime] Error:', JSON.stringify(event.error, null, 2));
        const errorMsg = event.error?.message || event.error?.code || 'Unknown error';
        // Ignore certain non-critical errors including response in progress
        if (!errorMsg.toLowerCase().includes('cancel') && 
            !errorMsg.toLowerCase().includes('conversation') &&
            !errorMsg.toLowerCase().includes('response in progress')) {
          onErrorRef.current?.(errorMsg);
        }
        // If error was about response in progress, mark it as such
        if (errorMsg.toLowerCase().includes('response in progress')) {
          isResponseInProgressRef.current = true;
        }
        break;
    }
  }, [updateState]); // Simplified dependencies - no callback deps needed

  // Cleanup resources - but keep audio monitoring active for sphere reactivity
  const cleanup = useCallback(() => {
    console.log('[Realtime] Cleaning up resources');
    
    // DON'T stop audio monitoring - it should always run for sphere reactivity
    // audioMonitoringActiveRef.current = false;
    
    // Reset idle detection state for next connection
    consecutiveSpeechSamplesRef.current = 0;
    lastSampleCheckTimeRef.current = 0;
    
    // Don't cancel animation frame - keep monitoring
    // if (animationFrameRef.current) {
    //   cancelAnimationFrame(animationFrameRef.current);
    //   animationFrameRef.current = null;
    // }
    
    // Don't close audio context - keep it for monitoring
    // if (audioContextRef.current) {
    //   try {
    //     audioContextRef.current.close();
    //   } catch (e) {
    //     // Ignore errors on close
    //   }
    //   audioContextRef.current = null;
    // }
    
    // Clear analysers but don't reset levels immediately
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;
    
    // DON'T reset levels to 0 - let them decay naturally
    // inputLevelRef.current = 0;
    // outputLevelRef.current = 0;
    // setInputAudioLevel(0);
    // setOutputAudioLevel(0);
    
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

  // Keep cleanup and updateState refs in sync for idle timer
  useEffect(() => {
    cleanupRef.current = cleanup;
    updateStateRef.current = updateState;
  }, [cleanup, updateState]);

  const disconnect = useCallback(() => {
    console.log('[Realtime] Disconnecting');
    cleanup();
    updateState('disconnected');
  }, [cleanup, updateState]);

  // Helper function to speak with female voice using browser TTS
  const speakWithFemaleVoice = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    
    const doSpeak = () => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.1;
      
      const voices = window.speechSynthesis.getVoices();
      const femaleVoiceNames = [
        'Samantha', 'Karen', 'Victoria', 'Moira', 'Fiona', 'Tessa',
        'Microsoft Zira', 'Microsoft Eva', 'Microsoft Jenny',
        'Google UK English Female', 'Google US English Female',
      ];
      
      let femaleVoice = voices.find(v => 
        femaleVoiceNames.some(name => v.name.includes(name))
      );
      
      if (!femaleVoice) {
        femaleVoice = voices.find(v => 
          v.lang.startsWith('en') && 
          !v.name.toLowerCase().includes('male') &&
          !v.name.includes('David') && !v.name.includes('James')
        );
      }
      
      if (femaleVoice) utterance.voice = femaleVoice;
      window.speechSynthesis.speak(utterance);
    };
    
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      doSpeak();
    } else {
      window.speechSynthesis.onvoiceschanged = doSpeak;
    }
  }, []);

  // Make MIRA speak a text message
  const speak = useCallback((text: string) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
      console.warn('[Realtime] Cannot speak - data channel not open, using TTS fallback');
      speakWithFemaleVoice(text);
      return;
    }

    // If a response is already in progress, queue this message
    if (isResponseInProgressRef.current) {
      console.log('[Realtime] Response in progress, queueing speak:', text);
      pendingSpeakQueueRef.current.push(text);
      return;
    }

    console.log('[Realtime] Making MIRA speak:', text);
    
    try {
      // Use response.create with instructions to speak the text
      // This is the correct way to make MIRA speak in OpenAI Realtime API
      const responseEvent = {
        type: 'response.create',
        response: {
          modalities: ['text', 'audio'],
          instructions: `Say this reminder out loud to the user in a friendly, helpful tone: "${text}"`,
        },
      };
      
      dataChannelRef.current.send(JSON.stringify(responseEvent));
      isResponseInProgressRef.current = true;
      
      // NOTE: Timer reset happens at response.done, not here
    } catch (err) {
      console.error('[Realtime] Error sending speak command:', err);
      // Fallback to browser TTS with female voice
      speakWithFemaleVoice(text);
    }
  }, [speakWithFemaleVoice]);

  // Inject memory context into the conversation
  // This adds a system message with retrieved memories before MIRA responds
  const injectContext = useCallback((context: string) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
      console.warn('[Realtime] Cannot inject context - data channel not open');
      return;
    }

    if (!context.trim()) {
      return;
    }

    console.log('[Realtime] Injecting memory context:', context.substring(0, 100) + '...');
    
    try {
      // Add a system message with the retrieved memory context
      // This will be included in the conversation for the AI to reference
      const contextEvent = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: `[RETRIEVED MEMORIES - Use this information to answer the user's question]\n${context}`,
            },
          ],
        },
      };
      
      dataChannelRef.current.send(JSON.stringify(contextEvent));
      console.log('[Realtime] Memory context injected successfully');
    } catch (err) {
      console.error('[Realtime] Error injecting context:', err);
    }
  }, []);

  // === SIMPLE IDLE TIMER COUNTDOWN ===
  // Timer counts down every 500ms for more responsive state detection.
  // Store cleanup and updateState in refs for use in interval
  const cleanupRef = useRef<() => void>(() => {});
  const updateStateRef = useRef<(s: RealtimeState) => void>(() => {});
  const lastTimerTickRef = useRef<number>(Date.now());
  
  useEffect(() => {
    // Start the countdown interval - runs every 500ms for responsive state detection
    const interval = setInterval(() => {
      // Only countdown if connected (use ref to avoid stale closure)
      const currentState = stateRef.current;
      
      // Check if MIRA is actively outputting audio (more reliable than state alone)
      const miraOutputLevel = outputLevelRef.current;
      const isMiraAudioPlaying = miraOutputLevel > 0.1; // MIRA audio threshold
      
      // PAUSE timer while MIRA is connecting (getting ready), speaking, OR response is in progress
      // Check state, isResponseInProgressRef, AND actual output audio level for maximum reliability
      if (currentState === 'connecting' || currentState === 'speaking' || isResponseInProgressRef.current || isMiraAudioPlaying) {
        // MIRA is getting ready, speaking, or generating response - don't countdown, keep timer paused
        // Reset last tick time so we don't count the paused time
        lastTimerTickRef.current = Date.now();
        // Also reset the idle timer to full duration while MIRA is speaking
        // This ensures timer starts fresh AFTER MIRA finishes
        idleTimerRef.current = IDLE_TIMEOUT_SECONDS;
        setIdleTimeRemaining(IDLE_TIMEOUT_SECONDS);
        console.log('[Idle] ⏸️ Timer PAUSED & RESET (state:', currentState, 'responseInProgress:', isResponseInProgressRef.current, 'miraAudio:', miraOutputLevel.toFixed(3), ')');
        return;
      }
      
      if (currentState === 'connected' || currentState === 'listening') {
        // Calculate actual elapsed time since last tick (more accurate than assuming fixed interval)
        const now = Date.now();
        const elapsed = (now - lastTimerTickRef.current) / 1000; // Convert to seconds
        lastTimerTickRef.current = now;
        
        // Decrement timer by actual elapsed time
        idleTimerRef.current = Math.max(0, idleTimerRef.current - elapsed);
        const remaining = Math.ceil(idleTimerRef.current); // Round up for display
        setIdleTimeRemaining(remaining);
        
        // Only log every second to reduce console spam
        if (Math.abs(idleTimerRef.current - Math.round(idleTimerRef.current)) < 0.3) {
          console.log('[Idle] ⏱️', remaining + 's remaining');
        }
        
        // Check if we've hit zero
        if (idleTimerRef.current <= 0) {
          console.log('[Idle] 💤 IDLE DETECTED - Going to rest');
          setIdleTimeRemaining(0);
          
          // Disconnect using refs
          cleanupRef.current();
          updateStateRef.current('disconnected');
          onIdleDisconnectRef.current?.();
        }
      }
    }, 500); // Check every 500ms for more responsive state detection
    
    console.log('[Idle] ⏱️ Idle timer interval started (500ms sampling)');
    
    return () => {
      clearInterval(interval);
      console.log('[Idle] ⏱️ Idle timer interval cleared');
    };
  }, []); // NO DEPENDENCIES - runs once on mount
  
  // Initialize timer when connection starts
  useEffect(() => {
    if (state === 'connected' || state === 'listening' || state === 'speaking') {
      // Only initialize if timer is at 0 (meaning we just connected)
      if (idleTimerRef.current <= 0) {
        idleTimerRef.current = IDLE_TIMEOUT_SECONDS;
        setIdleTimeRemaining(IDLE_TIMEOUT_SECONDS);
        consecutiveSpeechSamplesRef.current = 0;
        console.log('[Idle] Timer initialized to', IDLE_TIMEOUT_SECONDS, 'seconds');
      }
    } else if (state === 'disconnected') {
      // Reset timer when disconnected so next connection starts fresh
      idleTimerRef.current = IDLE_TIMEOUT_SECONDS;
      setIdleTimeRemaining(IDLE_TIMEOUT_SECONDS);
    }
  }, [state]);

  // Send a text message as if the user said it (for wake word queries)
  // This allows MIRA to respond to queries that came with the wake word
  const sendUserMessage = useCallback((text: string) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
      console.warn('[Realtime] Cannot send user message - data channel not open');
      return;
    }

    if (!text.trim()) {
      return;
    }

    console.log('[Realtime] Sending user message:', text);
    
    try {
      // Add the user's message to the conversation
      const messageEvent = {
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
      };
      
      dataChannelRef.current.send(JSON.stringify(messageEvent));
      
      // Trigger MIRA to respond
      const responseEvent = {
        type: 'response.create',
      };
      dataChannelRef.current.send(JSON.stringify(responseEvent));
      
      // Reset idle timer since user is interacting
      idleTimerRef.current = IDLE_TIMEOUT_SECONDS;
      
      console.log('[Realtime] User message sent, response triggered');
    } catch (err) {
      console.error('[Realtime] Error sending user message:', err);
    }
  }, []);

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
    speak,
    injectContext,
    sendUserMessage,
    idleTimeRemaining,
  };
}

export default useRealtime;
