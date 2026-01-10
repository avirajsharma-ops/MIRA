// Speaker Detection Service - Detect different speakers in conversation
// Uses audio characteristics to identify when a different person is speaking

export interface DetectedSpeaker {
  id: string;
  isUser: boolean;
  isKnown: boolean;
  name?: string;
  speechSegments: SpeechSegment[];
  audioCharacteristics?: AudioCharacteristics;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
}

export interface SpeechSegment {
  text: string;
  timestamp: Date;
  duration?: number;
  confidence?: number;
}

export interface AudioCharacteristics {
  pitchRange: { min: number; max: number };
  avgPitch: number;
  avgEnergy: number;
  voicePattern: string; // simplified voice signature
}

export interface ConversationContext {
  sessionId: string;
  userId: string;
  speakers: Map<string, DetectedSpeaker>;
  userSpeakerId: string;
  currentSpeakerId: string | null;
  unknownSpeakers: DetectedSpeaker[];
  conversationText: string[];
  lastSpeakerChangeTime: Date | null;
}

// Simple pitch estimation using autocorrelation
function estimatePitch(audioData: Float32Array, sampleRate: number): number {
  const minFreq = 50; // Hz
  const maxFreq = 400; // Hz
  const minPeriod = Math.floor(sampleRate / maxFreq);
  const maxPeriod = Math.floor(sampleRate / minFreq);
  
  let bestPeriod = 0;
  let bestCorrelation = -1;
  
  for (let period = minPeriod; period <= maxPeriod; period++) {
    let correlation = 0;
    for (let i = 0; i < audioData.length - period; i++) {
      correlation += audioData[i] * audioData[i + period];
    }
    
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestPeriod = period;
    }
  }
  
  return bestPeriod > 0 ? sampleRate / bestPeriod : 0;
}

// Calculate RMS energy
function calculateEnergy(audioData: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  return Math.sqrt(sum / audioData.length);
}

// Generate a simple voice pattern hash
function generateVoicePattern(characteristics: { pitch: number; energy: number }): string {
  const pitchBucket = Math.floor(characteristics.pitch / 20); // 20 Hz buckets
  const energyBucket = Math.floor(characteristics.energy * 100);
  return `p${pitchBucket}-e${energyBucket}`;
}

// Speaker Detection Manager
export class SpeakerDetectionManager {
  private context: ConversationContext;
  private pitchHistory: number[] = [];
  private lastPitchAvg: number = 0;
  private speakerChangeThreshold = 30; // Hz difference to detect new speaker
  private silenceThreshold = 0.01;
  private onSpeakerChange?: (newSpeaker: DetectedSpeaker, isNew: boolean) => void;
  private onUnknownSpeakerDetected?: (speaker: DetectedSpeaker) => void;
  
  constructor(
    sessionId: string, 
    userId: string,
    callbacks?: {
      onSpeakerChange?: (newSpeaker: DetectedSpeaker, isNew: boolean) => void;
      onUnknownSpeakerDetected?: (speaker: DetectedSpeaker) => void;
    }
  ) {
    // Create user speaker
    const userSpeaker: DetectedSpeaker = {
      id: 'user',
      isUser: true,
      isKnown: true,
      name: 'User',
      speechSegments: [],
      firstDetectedAt: new Date(),
      lastDetectedAt: new Date(),
    };
    
    this.context = {
      sessionId,
      userId,
      speakers: new Map([['user', userSpeaker]]),
      userSpeakerId: 'user',
      currentSpeakerId: null,
      unknownSpeakers: [],
      conversationText: [],
      lastSpeakerChangeTime: null,
    };
    
    this.onSpeakerChange = callbacks?.onSpeakerChange;
    this.onUnknownSpeakerDetected = callbacks?.onUnknownSpeakerDetected;
  }
  
  // Analyze audio buffer for speaker characteristics
  analyzeAudio(audioData: Float32Array, sampleRate: number = 48000): AudioCharacteristics | null {
    const energy = calculateEnergy(audioData);
    
    // Skip silence
    if (energy < this.silenceThreshold) {
      return null;
    }
    
    const pitch = estimatePitch(audioData, sampleRate);
    
    // Track pitch history
    if (pitch > 0) {
      this.pitchHistory.push(pitch);
      if (this.pitchHistory.length > 20) {
        this.pitchHistory.shift();
      }
    }
    
    const avgPitch = this.pitchHistory.length > 0 
      ? this.pitchHistory.reduce((a, b) => a + b, 0) / this.pitchHistory.length 
      : pitch;
    
    return {
      pitchRange: {
        min: Math.min(...this.pitchHistory, pitch),
        max: Math.max(...this.pitchHistory, pitch),
      },
      avgPitch,
      avgEnergy: energy,
      voicePattern: generateVoicePattern({ pitch: avgPitch, energy }),
    };
  }
  
  // Check if this is a different speaker based on audio characteristics
  detectSpeakerChange(characteristics: AudioCharacteristics): boolean {
    const pitchDiff = Math.abs(characteristics.avgPitch - this.lastPitchAvg);
    
    // If pitch changed significantly, likely a different speaker
    if (this.lastPitchAvg > 0 && pitchDiff > this.speakerChangeThreshold) {
      return true;
    }
    
    this.lastPitchAvg = characteristics.avgPitch;
    return false;
  }
  
  // Process a speech segment with optional speaker hints
  processSpeech(
    text: string, 
    audioCharacteristics?: AudioCharacteristics,
    isDefinitelyUser: boolean = false
  ): DetectedSpeaker {
    const now = new Date();
    
    // If marked as definitely user, use user speaker
    if (isDefinitelyUser) {
      return this.addSpeechToUser(text, now);
    }
    
    // If we have audio characteristics, try to detect speaker change
    if (audioCharacteristics) {
      const speakerChanged = this.detectSpeakerChange(audioCharacteristics);
      
      if (speakerChanged && this.context.currentSpeakerId === 'user') {
        // Switched from user to someone else
        const unknownSpeaker = this.createUnknownSpeaker(text, audioCharacteristics, now);
        return unknownSpeaker;
      } else if (speakerChanged && this.context.currentSpeakerId !== 'user') {
        // Might be switching back to user or to another unknown
        // For now, assume it's back to user
        return this.addSpeechToUser(text, now);
      }
    }
    
    // Default: attribute to current speaker or user
    if (this.context.currentSpeakerId && this.context.currentSpeakerId !== 'user') {
      const currentSpeaker = this.context.speakers.get(this.context.currentSpeakerId);
      if (currentSpeaker) {
        currentSpeaker.speechSegments.push({ text, timestamp: now });
        currentSpeaker.lastDetectedAt = now;
        return currentSpeaker;
      }
    }
    
    return this.addSpeechToUser(text, now);
  }
  
  private addSpeechToUser(text: string, timestamp: Date): DetectedSpeaker {
    const userSpeaker = this.context.speakers.get('user')!;
    userSpeaker.speechSegments.push({ text, timestamp });
    userSpeaker.lastDetectedAt = timestamp;
    this.context.currentSpeakerId = 'user';
    this.context.conversationText.push(`User: ${text}`);
    return userSpeaker;
  }
  
  private createUnknownSpeaker(
    text: string, 
    characteristics: AudioCharacteristics,
    timestamp: Date
  ): DetectedSpeaker {
    const speakerId = `unknown_${this.context.unknownSpeakers.length + 1}`;
    
    const newSpeaker: DetectedSpeaker = {
      id: speakerId,
      isUser: false,
      isKnown: false,
      speechSegments: [{ text, timestamp }],
      audioCharacteristics: characteristics,
      firstDetectedAt: timestamp,
      lastDetectedAt: timestamp,
    };
    
    this.context.speakers.set(speakerId, newSpeaker);
    this.context.unknownSpeakers.push(newSpeaker);
    this.context.currentSpeakerId = speakerId;
    this.context.lastSpeakerChangeTime = timestamp;
    this.context.conversationText.push(`Unknown Person: ${text}`);
    
    // Notify about new unknown speaker
    this.onUnknownSpeakerDetected?.(newSpeaker);
    this.onSpeakerChange?.(newSpeaker, true);
    
    return newSpeaker;
  }
  
  // Mark current unknown speaker as identified
  identifySpeaker(speakerId: string, name: string, relationship?: string): void {
    const speaker = this.context.speakers.get(speakerId);
    if (speaker && !speaker.isUser) {
      speaker.name = name;
      speaker.isKnown = true;
      
      // Update conversation text
      this.context.conversationText = this.context.conversationText.map(line => 
        line.startsWith('Unknown Person:') ? line.replace('Unknown Person:', `${name}:`) : line
      );
    }
  }
  
  // Get all unknown speakers that haven't been identified
  getUnknownSpeakers(): DetectedSpeaker[] {
    return this.context.unknownSpeakers.filter(s => !s.isKnown);
  }
  
  // Get the full conversation text
  getConversationText(): string {
    return this.context.conversationText.join('\n');
  }
  
  // Get all speech from a specific speaker
  getSpeakerText(speakerId: string): string {
    const speaker = this.context.speakers.get(speakerId);
    if (!speaker) return '';
    return speaker.speechSegments.map(s => s.text).join(' ');
  }
  
  // Check if there was another person in the conversation
  hasOtherSpeakers(): boolean {
    return this.context.unknownSpeakers.length > 0;
  }
  
  // Get conversation summary for MIRA to process
  getConversationSummary(): {
    hasOtherPeople: boolean;
    unknownPeopleCount: number;
    conversationText: string;
    unknownSpeakers: Array<{
      id: string;
      speechText: string;
      firstSeen: Date;
    }>;
  } {
    const unknownSpeakers = this.getUnknownSpeakers().map(s => ({
      id: s.id,
      speechText: s.speechSegments.map(seg => seg.text).join(' '),
      firstSeen: s.firstDetectedAt,
    }));
    
    return {
      hasOtherPeople: unknownSpeakers.length > 0,
      unknownPeopleCount: unknownSpeakers.length,
      conversationText: this.getConversationText(),
      unknownSpeakers,
    };
  }
  
  // Reset for new conversation
  reset(): void {
    const userSpeaker = this.context.speakers.get('user')!;
    userSpeaker.speechSegments = [];
    
    this.context.speakers = new Map([['user', userSpeaker]]);
    this.context.unknownSpeakers = [];
    this.context.conversationText = [];
    this.context.currentSpeakerId = null;
    this.context.lastSpeakerChangeTime = null;
    this.pitchHistory = [];
    this.lastPitchAvg = 0;
  }
}

// Singleton for easy access
let speakerManager: SpeakerDetectionManager | null = null;

export function getSpeakerManager(
  sessionId?: string, 
  userId?: string,
  callbacks?: {
    onSpeakerChange?: (newSpeaker: DetectedSpeaker, isNew: boolean) => void;
    onUnknownSpeakerDetected?: (speaker: DetectedSpeaker) => void;
  }
): SpeakerDetectionManager {
  if (!speakerManager && sessionId && userId) {
    speakerManager = new SpeakerDetectionManager(sessionId, userId, callbacks);
  }
  return speakerManager!;
}

export function resetSpeakerManager(): void {
  speakerManager?.reset();
  speakerManager = null;
}
