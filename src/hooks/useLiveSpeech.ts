'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseLiveSpeechOptions {
  onTranscription?: (text: string, isFinal: boolean) => void;
  onInterimResult?: (text: string) => void;
  onWordDetected?: (word: string) => void; // NEW: Real-time word callback
  language?: string;
  continuous?: boolean;
}

// Deepgram configuration for ULTRA-LOW LATENCY word-by-word streaming
const DEEPGRAM_CONFIG = {
  model: 'nova-2-general', // Fastest model
  language: 'en-US',
  smart_format: false, // Disable for speed
  punctuate: true,
  interim_results: true,
  utterance_end_ms: 800, // Faster utterance detection
  vad_events: true, // Voice activity detection  
  endpointing: 200, // 200ms silence = end of speech (very fast!)
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1,
};

// Extend Window interface for SpeechRecognition
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

// Mobile detection helper
const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|MIRAAndroid/i.test(ua);
};

export function useLiveSpeech(options: UseLiveSpeechOptions = {}) {
  const {
    onTranscription,
    onInterimResult,
    onWordDetected,
    language = 'en-US',
    continuous = true,
  } = options;

  // Check for browser support - do this synchronously in initial state
  const checkSupport = () => {
    if (typeof window === 'undefined') return false;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    return !!SpeechRecognition;
  };

  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(checkSupport);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [useDeepgram, setUseDeepgram] = useState(false);
  const [deepgramReady, setDeepgramReady] = useState(false);
  const [isMobile] = useState(isMobileDevice);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptionRef = useRef(onTranscription);
  const onInterimResultRef = useRef(onInterimResult);
  const onWordDetectedRef = useRef(onWordDetected);
  const isListeningRef = useRef(false);
  const shouldBeListeningRef = useRef(false);
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const initRecognitionRef = useRef<(() => SpeechRecognition | null) | null>(null);
  
  // Real-time word tracking
  const lastWordsRef = useRef<string[]>([]);
  const finalTextRef = useRef<string>('');
  const utteranceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const UTTERANCE_COMPLETE_MS = 600; // 600ms silence = utterance complete
  
  // Deepgram refs
  const deepgramSocketRef = useRef<WebSocket | null>(null);
  const deepgramApiKeyRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);

  // Fetch Deepgram API key on mount
  useEffect(() => {
    const fetchDeepgramKey = async () => {
      try {
        const token = localStorage.getItem('mira_token');
        if (!token) return;
        
        const response = await fetch('/api/stt/token', {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        if (response.ok) {
          const { apiKey } = await response.json();
          if (apiKey) {
            deepgramApiKeyRef.current = apiKey;
            setUseDeepgram(true);
            setDeepgramReady(true);
            console.log('🎤 Deepgram STT ready - ultra-low latency enabled');
          }
        }
      } catch (error) {
        console.warn('Deepgram not available, using Web Speech API fallback');
      }
    };
    
    fetchDeepgramKey();
  }, []);

  // Re-check support on mount (for SSR hydration)
  useEffect(() => {
    setIsSupported(checkSupport());
  }, []);

  // Keep refs updated
  useEffect(() => {
    onTranscriptionRef.current = onTranscription;
  }, [onTranscription]);

  useEffect(() => {
    onInterimResultRef.current = onInterimResult;
  }, [onInterimResult]);

  useEffect(() => {
    onWordDetectedRef.current = onWordDetected;
  }, [onWordDetected]);

  // Audio level monitoring
  const startAudioMonitoring = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      const checkLevel = () => {
        if (!analyserRef.current || !isListeningRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.fftSize);
        analyserRef.current.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const amplitude = (dataArray[i] - 128) / 128;
          sum += amplitude * amplitude;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const level = Math.min(1, rms * 4);
        setAudioLevel(level);

        if (isListeningRef.current) {
          animationFrameRef.current = requestAnimationFrame(checkLevel);
        }
      };

      checkLevel();
    } catch (error) {
      console.error('Error starting audio monitoring:', error);
    }
  }, []);

  const stopAudioMonitoring = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  // Helper function to restart recognition - stored in ref to avoid dependency issues
  const restartRecognition = useCallback(() => {
    if (!isListeningRef.current) return;
    
    // Clear any existing restart timeout
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    
    // Try to restart existing recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        return;
      } catch {
        // Failed to start, will reinitialize below
      }
    }
    
    // Reinitialize if needed
    if (initRecognitionRef.current) {
      recognitionRef.current = initRecognitionRef.current();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch {
          // Ignore - will retry on next attempt
        }
      }
    }
  }, []);

  // Initialize speech recognition
  const initRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = language;

    recognition.onstart = () => {
      setIsListening(true);
      isListeningRef.current = true;
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        setInterimTranscript(finalTextRef.current + interim);
        if (onInterimResultRef.current) {
          onInterimResultRef.current(finalTextRef.current + interim);
        }
      }

      if (final) {
        // Accumulate final text
        finalTextRef.current += (finalTextRef.current ? ' ' : '') + final.trim();
        setInterimTranscript(finalTextRef.current);
        
        // Reset reconnect attempts on successful transcription
        reconnectAttemptsRef.current = 0;
        
        // Clear any existing timeout
        if (utteranceTimeoutRef.current) {
          clearTimeout(utteranceTimeoutRef.current);
        }
        
        // Check if sentence seems complete
        const text = finalTextRef.current.trim();
        const endsWithPunctuation = /[.!?]$/.test(text);
        
        // Shorter wait time for Web Speech API too
        const waitTime = endsWithPunctuation ? 500 : UTTERANCE_COMPLETE_MS;
        
        utteranceTimeoutRef.current = setTimeout(() => {
          if (finalTextRef.current.trim() && onTranscriptionRef.current) {
            onTranscriptionRef.current(finalTextRef.current.trim(), true);
            finalTextRef.current = '';
            setInterimTranscript('');
          }
        }, waitTime);
      }
    };

    recognition.onerror = (event) => {
      const error = event.error;
      
      // "no-speech" is very common - just means silence was detected
      // Silently restart without logging - IMMEDIATELY on mobile for seamless experience
      if (error === 'no-speech') {
        if (shouldBeListeningRef.current) {
          // IMMEDIATE restart on mobile to prevent any gaps in listening
          const delay = isMobile ? 10 : 50;
          restartTimeoutRef.current = setTimeout(() => {
            restartRecognition();
          }, delay);
        }
        return;
      }
      
      // "aborted" means intentional stop
      if (error === 'aborted') {
        // On mobile, ALWAYS restart after abort if we should be listening
        if (shouldBeListeningRef.current) {
          restartTimeoutRef.current = setTimeout(() => {
            restartRecognition();
          }, 100);
        }
        return;
      }

      // Log other errors
      console.warn('Speech recognition error:', error);

      // Restart on recoverable errors - be more aggressive on mobile
      if (shouldBeListeningRef.current && (error === 'network' || error === 'audio-capture' || error === 'not-allowed' || error === 'service-not-allowed')) {
        reconnectAttemptsRef.current++;
        
        if (reconnectAttemptsRef.current <= maxReconnectAttempts) {
          // On mobile, use shorter delays and more aggressive retry
          const baseDelay = isMobile ? 200 : 500;
          const delay = Math.min(baseDelay * Math.pow(1.5, reconnectAttemptsRef.current - 1), isMobile ? 5000 : 30000);
          console.log(`[Speech] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          
          restartTimeoutRef.current = setTimeout(() => {
            restartRecognition();
          }, delay);
        } else {
          console.error('[Speech] Max reconnect attempts reached, will retry on visibility change');
          // Reset attempts so visibility change can try again
          reconnectAttemptsRef.current = 0;
        }
      }
    };

    recognition.onend = () => {
      // Auto-restart IMMEDIATELY if still supposed to be listening
      // Critical for mobile - don't let any gaps occur
      if (shouldBeListeningRef.current) {
        // Minimal delay to allow clean restart
        const delay = isMobile ? 10 : 50;
        restartTimeoutRef.current = setTimeout(() => {
          restartRecognition();
        }, delay);
      } else {
        setIsListening(false);
      }
    };

    return recognition;
  }, [continuous, language, restartRecognition]);

  // Store initRecognition in ref so restartRecognition can access it
  useEffect(() => {
    initRecognitionRef.current = initRecognition;
  }, [initRecognition]);

  // Deepgram WebSocket connection and audio streaming
  const startDeepgramListening = useCallback(async () => {
    if (!deepgramApiKeyRef.current) return false;
    
    try {
      // Get microphone stream with optimal settings for STT
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: DEEPGRAM_CONFIG.sample_rate,
          channelCount: 1,
        }
      });
      streamRef.current = stream;

      // Build WebSocket URL with ultra-low latency config
      const params = new URLSearchParams({
        model: DEEPGRAM_CONFIG.model,
        language: language || DEEPGRAM_CONFIG.language,
        punctuate: String(DEEPGRAM_CONFIG.punctuate),
        interim_results: String(DEEPGRAM_CONFIG.interim_results),
        utterance_end_ms: String(DEEPGRAM_CONFIG.utterance_end_ms),
        vad_events: String(DEEPGRAM_CONFIG.vad_events),
        endpointing: String(DEEPGRAM_CONFIG.endpointing),
        encoding: DEEPGRAM_CONFIG.encoding,
        sample_rate: String(DEEPGRAM_CONFIG.sample_rate),
        channels: String(DEEPGRAM_CONFIG.channels),
      });

      // Deepgram WebSocket with token authentication
      const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
      
      // Use subprotocol auth (Deepgram's method for browsers)
      const socket = new WebSocket(wsUrl, ['token', deepgramApiKeyRef.current!]);
      deepgramSocketRef.current = socket;

      socket.onopen = () => {
        console.log('🎤 Deepgram WebSocket connected - streaming audio');
        setIsListening(true);
        isListeningRef.current = true;
        
        // Set up audio processing with AudioContext
        const audioContext = new AudioContext({ sampleRate: DEEPGRAM_CONFIG.sample_rate });
        audioContextRef.current = audioContext;
        
        const source = audioContext.createMediaStreamSource(stream);
        
        // Use ScriptProcessor for raw PCM data (required by Deepgram)
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        audioProcessorRef.current = processor;
        
        // Also set up analyser for audio level visualization
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        analyserRef.current = analyser;
        
        processor.onaudioprocess = (e) => {
          if (socket.readyState === WebSocket.OPEN && isListeningRef.current) {
            const inputData = e.inputBuffer.getChannelData(0);
            // Convert Float32 to Int16 PCM
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            socket.send(pcmData.buffer);
          }
        };
        
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        // Start audio level monitoring
        const checkLevel = () => {
          if (!analyserRef.current || !isListeningRef.current) return;
          const dataArray = new Uint8Array(analyserRef.current.fftSize);
          analyserRef.current.getByteTimeDomainData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const amplitude = (dataArray[i] - 128) / 128;
            sum += amplitude * amplitude;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          const level = Math.min(1, rms * 4);
          setAudioLevel(level);
          if (isListeningRef.current) {
            animationFrameRef.current = requestAnimationFrame(checkLevel);
          }
        };
        checkLevel();
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
            const transcript = data.channel.alternatives[0].transcript?.trim();
            const isFinal = data.is_final;
            const words = data.channel.alternatives[0].words || [];
            
            if (transcript) {
              // REAL-TIME: Detect new words and fire callback immediately
              if (words.length > 0 && onWordDetectedRef.current) {
                const currentWords = words.map((w: { word: string }) => w.word);
                // Find new words that weren't in the last result
                const newWords = currentWords.filter((w: string) => !lastWordsRef.current.includes(w));
                newWords.forEach((word: string) => {
                  onWordDetectedRef.current?.(word);
                });
                if (!isFinal) {
                  lastWordsRef.current = currentWords;
                }
              }
              
              if (isFinal) {
                // Final result - add to accumulated text
                finalTextRef.current += (finalTextRef.current ? ' ' : '') + transcript;
                lastWordsRef.current = []; // Reset word tracking
                
                // Update display immediately
                setInterimTranscript(finalTextRef.current);
                
                // Reset utterance timeout
                if (utteranceTimeoutRef.current) {
                  clearTimeout(utteranceTimeoutRef.current);
                }
                
                // Short timeout to send complete utterance
                utteranceTimeoutRef.current = setTimeout(() => {
                  if (finalTextRef.current.trim() && onTranscriptionRef.current) {
                    onTranscriptionRef.current(finalTextRef.current.trim(), true);
                    finalTextRef.current = '';
                    setInterimTranscript('');
                  }
                }, UTTERANCE_COMPLETE_MS);
              } else {
                // Interim result - show immediately for real-time feedback
                const displayText = finalTextRef.current + (finalTextRef.current ? ' ' : '') + transcript;
                setInterimTranscript(displayText);
                
                if (onInterimResultRef.current) {
                  onInterimResultRef.current(displayText);
                }
              }
            }
          } else if (data.type === 'UtteranceEnd') {
            // User stopped speaking - send accumulated text immediately
            if (utteranceTimeoutRef.current) {
              clearTimeout(utteranceTimeoutRef.current);
            }
            // Shorter delay for utterance end
            setTimeout(() => {
              if (finalTextRef.current.trim() && onTranscriptionRef.current) {
                onTranscriptionRef.current(finalTextRef.current.trim(), true);
                finalTextRef.current = '';
                lastWordsRef.current = [];
                setInterimTranscript('');
              }
            }, 300);
          }
        } catch (error) {
          console.error('Error parsing Deepgram response:', error);
        }
      };

      socket.onerror = (error) => {
        console.error('Deepgram WebSocket error:', error);
        // Fall back to Web Speech API
        setUseDeepgram(false);
      };

      socket.onclose = (event) => {
        console.log('Deepgram WebSocket closed:', event.code, event.reason);
        // Auto-reconnect if still supposed to be listening
        if (isListeningRef.current) {
          setTimeout(() => {
            if (isListeningRef.current) {
              startDeepgramListening();
            }
          }, 500);
        }
      };

      return true;
    } catch (error) {
      console.error('Error starting Deepgram:', error);
      return false;
    }
  }, [language]);

  const stopDeepgramListening = useCallback(() => {
    // Clear timeouts
    if (utteranceTimeoutRef.current) {
      clearTimeout(utteranceTimeoutRef.current);
      utteranceTimeoutRef.current = null;
    }
    
    // Reset text refs
    finalTextRef.current = '';
    lastWordsRef.current = [];
    
    // Close WebSocket
    if (deepgramSocketRef.current) {
      try {
        deepgramSocketRef.current.close();
      } catch {
        // Ignore
      }
      deepgramSocketRef.current = null;
    }
    
    // Stop audio processor
    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.disconnect();
      } catch {
        // Ignore
      }
      audioProcessorRef.current = null;
    }
    
    // Stop audio context
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {
        // Ignore
      }
      audioContextRef.current = null;
    }
    
    // Stop stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    setAudioLevel(0);
  }, []);

  // Start listening - use Deepgram if available, fallback to Web Speech API
  const startListening = useCallback(async () => {
    // Mark that we want to be listening (for reconnection logic)
    shouldBeListeningRef.current = true;
    reconnectAttemptsRef.current = 0;
    
    if (isListeningRef.current) {
      return;
    }

    console.log('[Speech] Starting listening...', { isMobile, useDeepgram });

    // Try Deepgram first (ultra-low latency)
    if (useDeepgram && deepgramApiKeyRef.current) {
      const success = await startDeepgramListening();
      if (success) {
        return;
      }
      console.warn('Deepgram failed, falling back to Web Speech API');
    }

    // Fallback to Web Speech API
    if (!isSupported) {
      console.warn('Web Speech API not supported in this browser. Voice input disabled.');
      return;
    }

    // Initialize recognition if needed
    if (!recognitionRef.current) {
      recognitionRef.current = initRecognition();
    }

    if (recognitionRef.current) {
      try {
        isListeningRef.current = true;
        recognitionRef.current.start();
        startAudioMonitoring();
        console.log('[Speech] Web Speech API started');
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        isListeningRef.current = false;
        
        // On mobile, retry after a delay
        if (isMobile && shouldBeListeningRef.current) {
          setTimeout(() => {
            if (shouldBeListeningRef.current) {
              startListening();
            }
          }, 1000);
        }
      }
    }
  }, [useDeepgram, startDeepgramListening, isSupported, initRecognition, startAudioMonitoring, isMobile]);

  // Stop listening
  const stopListening = useCallback(() => {
    console.log('[Speech] Stopping listening...');
    shouldBeListeningRef.current = false;
    isListeningRef.current = false;
    reconnectAttemptsRef.current = 0;
    setIsListening(false);
    setInterimTranscript('');
    
    // Clear utterance timeout
    if (utteranceTimeoutRef.current) {
      clearTimeout(utteranceTimeoutRef.current);
      utteranceTimeoutRef.current = null;
    }
    // Send any accumulated text before stopping
    if (finalTextRef.current.trim() && onTranscriptionRef.current) {
      onTranscriptionRef.current(finalTextRef.current.trim(), true);
    }
    finalTextRef.current = '';
    lastWordsRef.current = [];

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    // Stop Deepgram if active
    if (deepgramSocketRef.current) {
      stopDeepgramListening();
    }

    // Stop Web Speech API if active
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore errors when stopping
      }
    }

    stopAudioMonitoring();
  }, [stopDeepgramListening, stopAudioMonitoring]);

  // Handle visibility change - restart mic when app comes back to foreground
  // This is critical for mobile background support
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // App came back to foreground
        if (shouldBeListeningRef.current && !isListeningRef.current) {
          console.log('[Speech] App visible, restarting microphone...');
          // Small delay to let the app settle
          setTimeout(() => {
            if (shouldBeListeningRef.current && !isListeningRef.current) {
              // Re-initialize and start
              if (recognitionRef.current) {
                recognitionRef.current = null;
              }
              startListening();
            }
          }, 300);
        }
      } else {
        // App going to background - on mobile, try to keep listening
        if (isMobile && shouldBeListeningRef.current) {
          console.log('[Speech] App going to background, mic should stay active');
          // The WebView/native app should keep the audio session alive
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startListening, isMobile]);

  // Handle page focus/blur for additional mobile stability
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFocus = () => {
      if (shouldBeListeningRef.current && !isListeningRef.current) {
        console.log('[Speech] Window focused, checking mic...');
        setTimeout(() => {
          if (shouldBeListeningRef.current && !isListeningRef.current) {
            startListening();
          }
        }, 200);
      }
    };

    window.addEventListener('focus', handleFocus);
    
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [startListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldBeListeningRef.current = false;
      isListeningRef.current = false;
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore
        }
      }
      // Cleanup Deepgram
      if (deepgramSocketRef.current) {
        try {
          deepgramSocketRef.current.close();
        } catch {
          // Ignore
        }
      }
      if (audioProcessorRef.current) {
        try {
          audioProcessorRef.current.disconnect();
        } catch {
          // Ignore
        }
      }
      stopAudioMonitoring();
    };
  }, [stopAudioMonitoring]);

  return {
    isListening,
    isSupported: isSupported || useDeepgram, // Supported if either works
    interimTranscript,
    audioLevel,
    startListening,
    stopListening,
    // New: expose Deepgram status
    useDeepgram,
    deepgramReady,
  };
}

export default useLiveSpeech;
