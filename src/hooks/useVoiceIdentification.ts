// useVoiceIdentification - Hook for speaker identification throughout the app
import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  VoiceEmbeddingManager, 
  getVoiceEmbeddingManager, 
  SpeakerMatch,
  VoiceEmbedding,
  extractMFCCProfile,
  generateEmbedding,
  resampleAudio,
} from '@/lib/voice/voiceEmbedding';

export interface VoiceIdentificationState {
  isOwnerEnrolled: boolean;
  isEnrolling: boolean;
  enrollmentProgress: number; // 0-100
  currentSpeaker: SpeakerMatch | null;
  sessionSpeakers: string[];
  error: string | null;
}

export interface UseVoiceIdentificationReturn {
  state: VoiceIdentificationState;
  identifySpeaker: (audioData: Float32Array, sampleRate?: number) => SpeakerMatch;
  isOwnerSpeaking: (audioData: Float32Array, sampleRate?: number) => { isOwner: boolean; confidence: number };
  startOwnerEnrollment: () => void;
  addEnrollmentSample: (audioData: Float32Array, sampleRate?: number) => Promise<boolean>;
  completeOwnerEnrollment: (name: string) => Promise<boolean>;
  cancelEnrollment: () => void;
  loadEmbeddings: () => Promise<void>;
  resetSession: () => void;
  manager: VoiceEmbeddingManager;
}

const ENROLLMENT_SAMPLES_REQUIRED = 5;
const TARGET_SAMPLE_RATE = 16000;

export function useVoiceIdentification(): UseVoiceIdentificationReturn {
  const manager = useRef<VoiceEmbeddingManager>(getVoiceEmbeddingManager());
  const enrollmentSamples = useRef<Float32Array[]>([]);
  
  const [state, setState] = useState<VoiceIdentificationState>({
    isOwnerEnrolled: false,
    isEnrolling: false,
    enrollmentProgress: 0,
    currentSpeaker: null,
    sessionSpeakers: [],
    error: null,
  });

  // Load embeddings from API on mount
  const loadEmbeddings = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('mira_token') : null;
      const response = await fetch('/api/voice-embedding?includeEmbeddings=true', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        if (response.status === 401) {
          console.log('[VoiceID] Not authenticated, skipping embedding load');
          return;
        }
        throw new Error('Failed to load embeddings');
      }
      
      const data = await response.json();
      
      // Convert API response to VoiceEmbedding format
      const embeddings: VoiceEmbedding[] = data.embeddings.map((e: any) => ({
        id: e.speakerId,
        userId: '',
        speakerId: e.speakerId,
        speakerName: e.speakerName,
        embedding: e.embedding,
        mfccProfile: e.mfccProfile,
        createdAt: new Date(e.createdAt),
        updatedAt: new Date(e.updatedAt),
        sampleCount: e.sampleCount,
        isOwner: e.isOwner,
      }));
      
      await manager.current.loadEmbeddings(embeddings);
      
      setState(prev => ({
        ...prev,
        isOwnerEnrolled: data.hasOwner,
        error: null,
      }));
      
      console.log('[VoiceID] Loaded embeddings:', {
        total: embeddings.length,
        hasOwner: data.hasOwner,
      });
    } catch (error) {
      console.error('[VoiceID] Error loading embeddings:', error);
      setState(prev => ({
        ...prev,
        error: 'Failed to load voice profiles',
      }));
    }
  }, []);

  // Identify speaker from audio
  const identifySpeaker = useCallback((audioData: Float32Array, sampleRate: number = 48000): SpeakerMatch => {
    // Resample if needed
    const resampled = sampleRate !== TARGET_SAMPLE_RATE 
      ? resampleAudio(audioData, sampleRate, TARGET_SAMPLE_RATE)
      : audioData;
    
    const match = manager.current.identifySpeaker(resampled, TARGET_SAMPLE_RATE);
    
    setState(prev => ({
      ...prev,
      currentSpeaker: match,
      sessionSpeakers: manager.current.getSessionSpeakers(),
    }));
    
    return match;
  }, []);

  // Quick check if owner is speaking
  const isOwnerSpeaking = useCallback((audioData: Float32Array, sampleRate: number = 48000): { isOwner: boolean; confidence: number } => {
    const resampled = sampleRate !== TARGET_SAMPLE_RATE 
      ? resampleAudio(audioData, sampleRate, TARGET_SAMPLE_RATE)
      : audioData;
    
    const confidence = manager.current.getOwnerConfidence(resampled, TARGET_SAMPLE_RATE);
    
    return {
      isOwner: confidence >= 0.80,
      confidence,
    };
  }, []);

  // Start owner enrollment process
  const startOwnerEnrollment = useCallback(() => {
    enrollmentSamples.current = [];
    setState(prev => ({
      ...prev,
      isEnrolling: true,
      enrollmentProgress: 0,
      error: null,
    }));
    console.log('[VoiceID] Started owner enrollment');
  }, []);

  // Add a sample during enrollment
  const addEnrollmentSample = useCallback(async (audioData: Float32Array, sampleRate: number = 48000): Promise<boolean> => {
    if (!state.isEnrolling) {
      console.warn('[VoiceID] Not in enrollment mode');
      return false;
    }
    
    // Resample if needed
    const resampled = sampleRate !== TARGET_SAMPLE_RATE 
      ? resampleAudio(audioData, sampleRate, TARGET_SAMPLE_RATE)
      : audioData;
    
    // Validate sample has enough audio content
    const profile = extractMFCCProfile(resampled, TARGET_SAMPLE_RATE);
    if (profile.energyMean < 0.02) {
      console.log('[VoiceID] Sample too quiet, skipping');
      return false;
    }
    
    enrollmentSamples.current.push(resampled);
    
    const progress = Math.min(100, (enrollmentSamples.current.length / ENROLLMENT_SAMPLES_REQUIRED) * 100);
    
    setState(prev => ({
      ...prev,
      enrollmentProgress: progress,
    }));
    
    console.log(`[VoiceID] Enrollment sample added: ${enrollmentSamples.current.length}/${ENROLLMENT_SAMPLES_REQUIRED}`);
    
    return enrollmentSamples.current.length >= ENROLLMENT_SAMPLES_REQUIRED;
  }, [state.isEnrolling]);

  // Complete enrollment and save to database
  const completeOwnerEnrollment = useCallback(async (name: string): Promise<boolean> => {
    if (enrollmentSamples.current.length < ENROLLMENT_SAMPLES_REQUIRED) {
      setState(prev => ({
        ...prev,
        error: `Need ${ENROLLMENT_SAMPLES_REQUIRED} samples, have ${enrollmentSamples.current.length}`,
      }));
      return false;
    }
    
    try {
      // Create embedding from samples
      const voiceEmbedding = manager.current.createEnrollmentEmbedding(
        enrollmentSamples.current,
        TARGET_SAMPLE_RATE,
        '', // userId will be set by API
        'owner',
        name,
        true
      );
      
      // Save to database
      const token = typeof window !== 'undefined' ? localStorage.getItem('mira_token') : null;
      const response = await fetch('/api/voice-embedding', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          speakerId: 'owner',
          speakerName: name,
          embedding: voiceEmbedding.embedding,
          mfccProfile: voiceEmbedding.mfccProfile,
          isOwner: true,
          action: 'update',
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to save voice profile');
      }
      
      // Set locally
      manager.current.setOwnerEmbedding(voiceEmbedding);
      
      // Reset enrollment state
      enrollmentSamples.current = [];
      
      setState(prev => ({
        ...prev,
        isEnrolling: false,
        enrollmentProgress: 100,
        isOwnerEnrolled: true,
        error: null,
      }));
      
      console.log('[VoiceID] Owner enrollment completed for:', name);
      return true;
    } catch (error) {
      console.error('[VoiceID] Enrollment error:', error);
      setState(prev => ({
        ...prev,
        error: 'Failed to save voice profile',
      }));
      return false;
    }
  }, []);

  // Cancel enrollment
  const cancelEnrollment = useCallback(() => {
    enrollmentSamples.current = [];
    setState(prev => ({
      ...prev,
      isEnrolling: false,
      enrollmentProgress: 0,
      error: null,
    }));
    console.log('[VoiceID] Enrollment cancelled');
  }, []);

  // Reset session speakers
  const resetSession = useCallback(() => {
    manager.current.resetSession();
    setState(prev => ({
      ...prev,
      sessionSpeakers: [],
      currentSpeaker: null,
    }));
  }, []);

  return {
    state,
    identifySpeaker,
    isOwnerSpeaking,
    startOwnerEnrollment,
    addEnrollmentSample,
    completeOwnerEnrollment,
    cancelEnrollment,
    loadEmbeddings,
    resetSession,
    manager: manager.current,
  };
}

export default useVoiceIdentification;
