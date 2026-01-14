/**
 * Phone Call Detection Module
 * Detects phone ringing sounds and call-related audio patterns
 */

export interface PhoneCallEvent {
  type: 'ringing' | 'answered' | 'ended' | 'dropped';
  timestamp: Date;
  confidence: number;
  duration?: number;
}

export interface PhoneCallState {
  isRinging: boolean;
  isOnCall: boolean;
  callStartTime?: Date;
  lastRingTime?: Date;
  ringCount: number;
}

type PhoneCallCallback = (event: PhoneCallEvent) => void;

export class PhoneCallDetector {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private isRunning = false;
  private animationFrame: number | null = null;
  
  // Detection state
  private callState: PhoneCallState = {
    isRinging: false,
    isOnCall: false,
    ringCount: 0,
  };
  
  // Ring detection parameters
  private readonly RING_FREQUENCY_LOW = 400;  // Hz - typical phone ring lower bound
  private readonly RING_FREQUENCY_HIGH = 2000; // Hz - typical phone ring upper bound
  private readonly RING_THRESHOLD = 0.15;
  private readonly RING_PATTERN_DURATION = 500; // ms - typical ring burst duration
  private readonly RING_SILENCE_DURATION = 3000; // ms - silence between rings
  private readonly MIN_RINGS_TO_DETECT = 2; // Need at least 2 rings to confirm
  
  // Voice detection for call state
  private readonly VOICE_FREQUENCY_LOW = 85;   // Hz - human voice range
  private readonly VOICE_FREQUENCY_HIGH = 3000; // Hz
  private readonly VOICE_THRESHOLD = 0.08;
  
  // Timing
  private lastRingDetectedAt = 0;
  private ringStartTime = 0;
  private silenceStartTime = 0;
  private consecutiveRings = 0;
  private voiceDetectedDuration = 0;
  private lastVoiceTime = 0;
  
  // Callbacks
  private onCallEvent: PhoneCallCallback | null = null;
  
  constructor() {
    // Initialize state
  }
  
  /**
   * Start listening for phone calls
   */
  async start(stream: MediaStream, onEvent: PhoneCallCallback): Promise<boolean> {
    if (this.isRunning) return true;
    
    try {
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(this.analyser);
      
      this.mediaStream = stream;
      this.onCallEvent = onEvent;
      this.isRunning = true;
      
      this.startDetection();
      console.log('[PhoneDetector] Started listening for phone calls');
      return true;
    } catch (error) {
      console.error('[PhoneDetector] Failed to start:', error);
      return false;
    }
  }
  
  /**
   * Stop detection
   */
  stop(): void {
    this.isRunning = false;
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    this.mediaStream = null;
    this.resetState();
    
    console.log('[PhoneDetector] Stopped');
  }
  
  /**
   * Get current call state
   */
  getState(): PhoneCallState {
    return { ...this.callState };
  }
  
  private resetState(): void {
    this.callState = {
      isRinging: false,
      isOnCall: false,
      ringCount: 0,
    };
    this.consecutiveRings = 0;
    this.voiceDetectedDuration = 0;
  }
  
  private startDetection(): void {
    if (!this.isRunning || !this.analyser) return;
    
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const detect = () => {
      if (!this.isRunning || !this.analyser) return;
      
      this.analyser.getByteFrequencyData(dataArray);
      
      const now = Date.now();
      const sampleRate = this.audioContext?.sampleRate || 44100;
      
      // Calculate frequency bin indices
      const binSize = sampleRate / (bufferLength * 2);
      const ringLowBin = Math.floor(this.RING_FREQUENCY_LOW / binSize);
      const ringHighBin = Math.ceil(this.RING_FREQUENCY_HIGH / binSize);
      const voiceLowBin = Math.floor(this.VOICE_FREQUENCY_LOW / binSize);
      const voiceHighBin = Math.ceil(this.VOICE_FREQUENCY_HIGH / binSize);
      
      // Calculate ring frequency energy
      let ringEnergy = 0;
      for (let i = ringLowBin; i <= ringHighBin && i < bufferLength; i++) {
        ringEnergy += dataArray[i] / 255;
      }
      ringEnergy /= (ringHighBin - ringLowBin + 1);
      
      // Calculate voice frequency energy
      let voiceEnergy = 0;
      for (let i = voiceLowBin; i <= voiceHighBin && i < bufferLength; i++) {
        voiceEnergy += dataArray[i] / 255;
      }
      voiceEnergy /= (voiceHighBin - voiceLowBin + 1);
      
      // Detect ring pattern
      this.processRingDetection(ringEnergy, now);
      
      // Detect voice for call state
      this.processVoiceDetection(voiceEnergy, now);
      
      this.animationFrame = requestAnimationFrame(detect);
    };
    
    detect();
  }
  
  private processRingDetection(energy: number, now: number): void {
    const isRingLike = energy > this.RING_THRESHOLD;
    
    if (isRingLike) {
      if (this.ringStartTime === 0) {
        this.ringStartTime = now;
      }
      
      const ringDuration = now - this.ringStartTime;
      
      // Check if this looks like a phone ring burst (400-1000ms of sustained tone)
      if (ringDuration >= 300 && ringDuration <= 1500) {
        if (now - this.lastRingDetectedAt > this.RING_SILENCE_DURATION / 2) {
          // This is a new ring
          this.consecutiveRings++;
          this.lastRingDetectedAt = now;
          
          console.log(`[PhoneDetector] Ring detected (${this.consecutiveRings})`);
          
          if (this.consecutiveRings >= this.MIN_RINGS_TO_DETECT && !this.callState.isRinging) {
            this.callState.isRinging = true;
            this.callState.lastRingTime = new Date();
            this.callState.ringCount = this.consecutiveRings;
            
            this.emitEvent({
              type: 'ringing',
              timestamp: new Date(),
              confidence: Math.min(0.9, 0.5 + this.consecutiveRings * 0.1),
            });
          }
        }
      }
      
      this.silenceStartTime = 0;
    } else {
      // Silence
      if (this.ringStartTime !== 0) {
        this.silenceStartTime = now;
        this.ringStartTime = 0;
      }
      
      // If too much silence, reset ring detection
      if (this.silenceStartTime > 0 && now - this.silenceStartTime > 10000) {
        if (this.callState.isRinging && !this.callState.isOnCall) {
          // Phone stopped ringing without being answered - missed call
          this.emitEvent({
            type: 'dropped',
            timestamp: new Date(),
            confidence: 0.7,
          });
        }
        this.resetState();
      }
    }
  }
  
  private processVoiceDetection(energy: number, now: number): void {
    const hasVoice = energy > this.VOICE_THRESHOLD;
    
    if (hasVoice) {
      this.lastVoiceTime = now;
      
      // If ringing and we detect sustained voice, call was answered
      if (this.callState.isRinging && !this.callState.isOnCall) {
        this.voiceDetectedDuration += 16; // Approximate frame duration
        
        // Need 2+ seconds of voice to confirm call answered
        if (this.voiceDetectedDuration > 2000) {
          this.callState.isRinging = false;
          this.callState.isOnCall = true;
          this.callState.callStartTime = new Date();
          
          this.emitEvent({
            type: 'answered',
            timestamp: new Date(),
            confidence: 0.85,
          });
          
          this.voiceDetectedDuration = 0;
        }
      }
    } else {
      // Reset voice duration if silence
      if (now - this.lastVoiceTime > 1000) {
        this.voiceDetectedDuration = 0;
      }
      
      // If on call and extended silence, call might have ended
      if (this.callState.isOnCall && now - this.lastVoiceTime > 5000) {
        const callDuration = this.callState.callStartTime 
          ? Math.floor((now - this.callState.callStartTime.getTime()) / 1000)
          : 0;
        
        this.emitEvent({
          type: 'ended',
          timestamp: new Date(),
          confidence: 0.75,
          duration: callDuration,
        });
        
        this.resetState();
      }
    }
  }
  
  private emitEvent(event: PhoneCallEvent): void {
    console.log('[PhoneDetector] Event:', event);
    if (this.onCallEvent) {
      this.onCallEvent(event);
    }
  }
}

// Singleton instance
let detectorInstance: PhoneCallDetector | null = null;

export function getPhoneCallDetector(): PhoneCallDetector {
  if (!detectorInstance) {
    detectorInstance = new PhoneCallDetector();
  }
  return detectorInstance;
}

export function resetPhoneCallDetector(): void {
  if (detectorInstance) {
    detectorInstance.stop();
    detectorInstance = null;
  }
}
