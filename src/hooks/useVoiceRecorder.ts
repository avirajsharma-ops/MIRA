'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseVoiceRecorderOptions {
  onTranscription?: (text: string) => void;
  silenceThreshold?: number;
  silenceDuration?: number;
  minRecordingTime?: number;
  speechStartThreshold?: number;
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}) {
  const { 
    onTranscription, 
    silenceThreshold = 0.02,      // Threshold to detect end of speech
    silenceDuration = 1200,       // Wait 1.2s of silence before processing
    minRecordingTime = 500,       // Minimum 500ms of audio
    speechStartThreshold = 0.03,  // Threshold to detect start of speech
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
  const animationFrameRef = useRef<number | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const isListeningRef = useRef(false);
  const onTranscriptionRef = useRef(onTranscription);
  const hasDetectedSpeechRef = useRef(false);
  const consecutiveSilenceFramesRef = useRef(0);
  const consecutiveSpeechFramesRef = useRef(0);

  // Keep onTranscription ref updated
  useEffect(() => {
    onTranscriptionRef.current = onTranscription;
  }, [onTranscription]);

  const processAudio = useCallback(async (audioBlob: Blob) => {
    // Don't process very short recordings (less than 2KB usually means no real audio)
    if (audioBlob.size < 2000) {
      console.log('Audio too short, skipping transcription');
      return;
    }

    setIsProcessing(true);
    
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob);

      const token = localStorage.getItem('mira_token');
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (response.ok) {
        const { text } = await response.json();
        if (text && text.trim() && onTranscriptionRef.current) {
          console.log('Transcription received:', text);
          onTranscriptionRef.current(text);
        }
      } else {
        console.error('Transcription API error:', response.status);
      }
    } catch (error) {
      console.error('Transcription error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    
    // Check minimum recording time
    const recordingDuration = Date.now() - recordingStartTimeRef.current;
    
    if (recordingDuration < minRecordingTime) {
      console.log('Recording too short, waiting...');
      return;
    }

    console.log('Stopping recording after', recordingDuration, 'ms');
    isRecordingRef.current = false;
    setIsRecording(false);
    hasDetectedSpeechRef.current = false;
    consecutiveSilenceFramesRef.current = 0;
    consecutiveSpeechFramesRef.current = 0;
    
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
  }, []);

  const checkAudioLevel = useCallback(() => {
    if (!analyserRef.current || !isListeningRef.current) return;

    // Use time domain data for more accurate voice detection
    const bufferLength = analyserRef.current.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteTimeDomainData(dataArray);
    
    // Calculate RMS (root mean square) for better voice detection
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const amplitude = (dataArray[i] - 128) / 128; // Normalize to -1 to 1
      sum += amplitude * amplitude;
    }
    const rms = Math.sqrt(sum / bufferLength);
    const normalizedLevel = Math.min(1, rms * 4); // Amplify for visualization
    
    setAudioLevel(normalizedLevel);

    // Voice activity detection with hysteresis
    const isSpeaking = normalizedLevel > speechStartThreshold;
    const isSilent = normalizedLevel < silenceThreshold;
    
    if (isSpeaking) {
      consecutiveSpeechFramesRef.current++;
      consecutiveSilenceFramesRef.current = 0;
      
      // Start recording when speech is detected for a few frames
      if (!isRecordingRef.current && consecutiveSpeechFramesRef.current > 3) {
        console.log('Speech detected, starting recording. Level:', normalizedLevel);
        hasDetectedSpeechRef.current = true;
        
        // Start a new recording
        if (streamRef.current && mediaRecorderRef.current?.state !== 'recording') {
          audioChunksRef.current = [];
          mediaRecorderRef.current?.start(100);
          recordingStartTimeRef.current = Date.now();
          isRecordingRef.current = true;
          setIsRecording(true);
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
      
      if (recordingDuration > minRecordingTime && consecutiveSilenceFramesRef.current > 5) {
        if (!silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            console.log('Silence detected, stopping recording');
            stopRecording();
          }, silenceDuration);
        }
      }
    }

    if (isListeningRef.current) {
      animationFrameRef.current = requestAnimationFrame(checkAudioLevel);
    }
  }, [silenceThreshold, silenceDuration, minRecordingTime, speechStartThreshold, stopRecording]);

  const startRecording = useCallback(async () => {
    if (isListeningRef.current) {
      console.log('Already listening');
      return;
    }
    
    try {
      console.log('Starting voice listener...');
      
      // Request microphone with optimal settings for speech
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000, // Optimal for speech
        }
      });
      
      streamRef.current = stream;
      isListeningRef.current = true;
      setIsListening(true);

      // Setup audio analysis with higher sensitivity
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      
      // Resume audio context if suspended (browser autoplay policy)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3; // Less smoothing for faster response
      analyser.minDecibels = -85; // More sensitive to quiet sounds
      analyser.maxDecibels = -10;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Setup recording with best available codec
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';
      
      console.log('Using audio format:', mimeType);
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('MediaRecorder stopped, processing audio...');
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
      console.log('Voice activity detection active');
      checkAudioLevel();
      
    } catch (error) {
      console.error('Error starting voice listener:', error);
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
