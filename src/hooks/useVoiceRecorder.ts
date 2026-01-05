'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseVoiceRecorderOptions {
  onTranscription?: (text: string) => void;
  silenceThreshold?: number;
  silenceDuration?: number;
  minRecordingTime?: number;
  speechStartThreshold?: number;
  maxRecordingTime?: number;
  adaptiveThreshold?: boolean;
}

// Constants for improved voice activity detection
const VAD_FRAME_SIZE = 512;
const VAD_HISTORY_SIZE = 30; // ~500ms of history at 60fps
const NOISE_FLOOR_ADAPTATION_RATE = 0.05;
const SPEECH_ENERGY_MULTIPLIER = 2.5;

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}) {
  const { 
    onTranscription, 
    silenceThreshold = 0.015,      // Lower threshold for better sensitivity
    silenceDuration = 1800,        // Wait 1.8s of silence (more natural pause)
    minRecordingTime = 400,        // Minimum 400ms of audio
    speechStartThreshold = 0.025,  // Threshold to detect start of speech
    maxRecordingTime = 60000,      // Max 60 seconds recording
    adaptiveThreshold = true,      // Enable adaptive noise floor
  } = options;
  
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isListening, setIsListening] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const maxRecordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const isListeningRef = useRef(false);
  const onTranscriptionRef = useRef(onTranscription);
  const hasDetectedSpeechRef = useRef(false);
  
  // Improved VAD state
  const noiseFloorRef = useRef(0.02);
  const energyHistoryRef = useRef<number[]>([]);
  const consecutiveSilenceFramesRef = useRef(0);
  const consecutiveSpeechFramesRef = useRef(0);
  const speechStartedRef = useRef(false);
  const lastProcessedRef = useRef<number>(0);

  // Keep onTranscription ref updated
  useEffect(() => {
    onTranscriptionRef.current = onTranscription;
  }, [onTranscription]);

  // Calculate adaptive noise floor from energy history
  const updateNoiseFloor = useCallback((energy: number) => {
    if (!adaptiveThreshold) return;
    
    // Only update noise floor during quiet periods
    if (energy < noiseFloorRef.current * 2) {
      noiseFloorRef.current = noiseFloorRef.current * (1 - NOISE_FLOOR_ADAPTATION_RATE) + 
                              energy * NOISE_FLOOR_ADAPTATION_RATE;
      // Clamp noise floor to reasonable range
      noiseFloorRef.current = Math.max(0.005, Math.min(0.05, noiseFloorRef.current));
    }
  }, [adaptiveThreshold]);

  // Process audio with transcription API (using faster Whisper endpoint)
  const processAudio = useCallback(async (audioBlob: Blob) => {
    // Debounce - don't process if we just processed
    const now = Date.now();
    if (now - lastProcessedRef.current < 500) {
      console.log('[VoiceRecorder] Debouncing audio processing');
      return;
    }
    lastProcessedRef.current = now;
    
    // Don't process very short recordings (less than 2KB usually means no real audio)
    if (audioBlob.size < 2000) {
      console.log('[VoiceRecorder] Audio too short, skipping transcription');
      return;
    }

    setIsProcessing(true);
    
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob);

      const token = localStorage.getItem('mira_token');
      
      // Use AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        const { text } = await response.json();
        if (text && text.trim() && onTranscriptionRef.current) {
          console.log('[VoiceRecorder] Transcription received:', text);
          onTranscriptionRef.current(text);
        }
      } else {
        console.error('[VoiceRecorder] Transcription API error:', response.status);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[VoiceRecorder] Transcription timed out');
      } else {
        console.error('[VoiceRecorder] Transcription error:', error);
      }
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    
    // Check minimum recording time
    const recordingDuration = Date.now() - recordingStartTimeRef.current;
    
    if (recordingDuration < minRecordingTime) {
      console.log('[VoiceRecorder] Recording too short, waiting...');
      return;
    }

    console.log('[VoiceRecorder] Stopping recording after', recordingDuration, 'ms');
    isRecordingRef.current = false;
    setIsRecording(false);
    hasDetectedSpeechRef.current = false;
    speechStartedRef.current = false;
    consecutiveSilenceFramesRef.current = 0;
    consecutiveSpeechFramesRef.current = 0;
    
    // Clear max recording timer
    if (maxRecordingTimerRef.current) {
      clearTimeout(maxRecordingTimerRef.current);
      maxRecordingTimerRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, [minRecordingTime]);

  // Stop listening entirely (cleanup stream)
  const stopListening = useCallback(() => {
    console.log('[VoiceRecorder] Stopping listener...');
    isListeningRef.current = false;
    setIsListening(false);
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    
    if (maxRecordingTimerRef.current) {
      clearTimeout(maxRecordingTimerRef.current);
      maxRecordingTimerRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    isRecordingRef.current = false;
    setIsRecording(false);
    energyHistoryRef.current = [];
  }, []);

  // Advanced VAD with energy-based detection and adaptive thresholds
  const checkAudioLevel = useCallback(() => {
    if (!analyserRef.current || !isListeningRef.current) return;

    // Get time domain data for voice detection
    const bufferLength = analyserRef.current.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteTimeDomainData(dataArray);
    
    // Calculate RMS energy for better voice detection
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const amplitude = (dataArray[i] - 128) / 128;
      sum += amplitude * amplitude;
    }
    const rms = Math.sqrt(sum / bufferLength);
    
    // Update energy history for smoothing
    energyHistoryRef.current.push(rms);
    if (energyHistoryRef.current.length > VAD_HISTORY_SIZE) {
      energyHistoryRef.current.shift();
    }
    
    // Calculate smoothed energy (average of recent frames)
    const smoothedEnergy = energyHistoryRef.current.length > 0
      ? energyHistoryRef.current.reduce((a, b) => a + b, 0) / energyHistoryRef.current.length
      : rms;
    
    // Update noise floor during quiet periods
    updateNoiseFloor(rms);
    
    // Calculate adaptive thresholds based on noise floor
    const adaptiveSpeechThreshold = adaptiveThreshold 
      ? Math.max(speechStartThreshold, noiseFloorRef.current * SPEECH_ENERGY_MULTIPLIER)
      : speechStartThreshold;
    const adaptiveSilenceThreshold = adaptiveThreshold
      ? Math.max(silenceThreshold, noiseFloorRef.current * 1.5)
      : silenceThreshold;
    
    // Normalize for UI visualization
    const normalizedLevel = Math.min(1, smoothedEnergy * 5);
    setAudioLevel(normalizedLevel);

    // Voice activity detection with hysteresis
    const isSpeaking = smoothedEnergy > adaptiveSpeechThreshold;
    const isSilent = smoothedEnergy < adaptiveSilenceThreshold;
    
    if (isSpeaking) {
      consecutiveSpeechFramesRef.current++;
      consecutiveSilenceFramesRef.current = 0;
      
      // Start recording when speech is detected for several frames (debounce)
      if (!isRecordingRef.current && consecutiveSpeechFramesRef.current > 4) {
        console.log('[VoiceRecorder] Speech detected, starting recording. Energy:', smoothedEnergy.toFixed(4), 
                    'Threshold:', adaptiveSpeechThreshold.toFixed(4));
        hasDetectedSpeechRef.current = true;
        speechStartedRef.current = true;
        
        // Start a new recording
        if (streamRef.current && mediaRecorderRef.current?.state !== 'recording') {
          audioChunksRef.current = [];
          try {
            mediaRecorderRef.current?.start(100); // Collect data every 100ms
            recordingStartTimeRef.current = Date.now();
            isRecordingRef.current = true;
            setIsRecording(true);
            
            // Set max recording time limit
            maxRecordingTimerRef.current = setTimeout(() => {
              console.log('[VoiceRecorder] Max recording time reached');
              stopRecording();
            }, maxRecordingTime);
          } catch (err) {
            console.error('[VoiceRecorder] Failed to start recording:', err);
          }
        }
      }
      
      // Clear silence timer if speaking
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    } else if (isSilent && isRecordingRef.current && hasDetectedSpeechRef.current) {
      consecutiveSilenceFramesRef.current++;
      consecutiveSpeechFramesRef.current = 0;
      
      // Check for silence after minimum recording time
      const recordingDuration = Date.now() - recordingStartTimeRef.current;
      
      // Require more silence frames before stopping (reduces false endings)
      if (recordingDuration > minRecordingTime && consecutiveSilenceFramesRef.current > 8) {
        if (!silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            console.log('[VoiceRecorder] Silence detected, stopping recording');
            stopRecording();
          }, silenceDuration);
        }
      }
    } else {
      // In-between state - gradual decay of speech frames
      if (consecutiveSpeechFramesRef.current > 0) {
        consecutiveSpeechFramesRef.current = Math.max(0, consecutiveSpeechFramesRef.current - 0.5);
      }
    }

    if (isListeningRef.current) {
      animationFrameRef.current = requestAnimationFrame(checkAudioLevel);
    }
  }, [silenceThreshold, silenceDuration, minRecordingTime, speechStartThreshold, 
      stopRecording, adaptiveThreshold, updateNoiseFloor, maxRecordingTime]);

  const startRecording = useCallback(async () => {
    if (isListeningRef.current) {
      console.log('[VoiceRecorder] Already listening');
      return;
    }
    
    try {
      console.log('[VoiceRecorder] Starting voice listener...');
      
      // Reset state
      energyHistoryRef.current = [];
      noiseFloorRef.current = 0.02;
      consecutiveSilenceFramesRef.current = 0;
      consecutiveSpeechFramesRef.current = 0;
      speechStartedRef.current = false;
      
      // Request microphone with optimal settings for speech recognition
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: { ideal: 16000 }, // Optimal for speech recognition
        }
      });
      
      streamRef.current = stream;
      isListeningRef.current = true;
      setIsListening(true);

      // Setup audio analysis
      const audioContext = new AudioContext({ 
        sampleRate: 16000,
        latencyHint: 'interactive' // Lower latency
      });
      audioContextRef.current = audioContext;
      
      // Resume audio context if suspended (browser autoplay policy)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = VAD_FRAME_SIZE;
      analyser.smoothingTimeConstant = 0.2; // Less smoothing for faster response
      analyser.minDecibels = -90; // More sensitive to quiet sounds
      analyser.maxDecibels = -10;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Setup recording with best available codec
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      }
      
      console.log('[VoiceRecorder] Using audio format:', mimeType);
      const mediaRecorder = new MediaRecorder(stream, { 
        mimeType,
        audioBitsPerSecond: 32000 // Good quality for speech
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('[VoiceRecorder] MediaRecorder stopped, processing audio...');
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];
        
        await processAudio(audioBlob);
        
        // Restart listening if still active
        if (isListeningRef.current && streamRef.current) {
          // Reset for next recording
          hasDetectedSpeechRef.current = false;
          consecutiveSilenceFramesRef.current = 0;
          consecutiveSpeechFramesRef.current = 0;
        }
      };

      // Start level monitoring (this will auto-start recording when speech is detected)
      console.log('[VoiceRecorder] Voice activity detection active');
      checkAudioLevel();
      
    } catch (error) {
      console.error('[VoiceRecorder] Error starting voice listener:', error);
      isListeningRef.current = false;
      setIsListening(false);
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  }, [checkAudioLevel, processAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isListeningRef.current = false;
      isRecordingRef.current = false;
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      if (maxRecordingTimerRef.current) {
        clearTimeout(maxRecordingTimerRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return {
    isRecording,
    isProcessing,
    isListening,
    audioLevel,
    startRecording,
    stopRecording: stopListening, // Stop listening entirely
  };
}

export default useVoiceRecorder;
