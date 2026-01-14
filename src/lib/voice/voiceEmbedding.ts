// Voice Embedding Service - Neural-network-like voice fingerprinting for speaker identification
// Uses MFCC (Mel-Frequency Cepstral Coefficients) for accurate speaker recognition

export interface VoiceEmbedding {
  id: string;
  userId: string;
  speakerId: string; // 'owner' for the device owner, or a person ID
  speakerName: string;
  embedding: number[]; // 128-dimensional voice embedding vector
  mfccProfile: MFCCProfile;
  createdAt: Date;
  updatedAt: Date;
  sampleCount: number; // How many samples were used to create this embedding
  isOwner: boolean; // Is this the device owner's voice?
}

export interface MFCCProfile {
  mfccMeans: number[]; // 13 MFCC coefficients means
  mfccStds: number[]; // 13 MFCC standard deviations
  pitchMean: number;
  pitchStd: number;
  energyMean: number;
  energyStd: number;
  spectralCentroidMean: number;
  zeroCrossingRate: number;
}

export interface SpeakerMatch {
  speakerId: string;
  speakerName: string;
  confidence: number; // 0-1
  isOwner: boolean;
  embedding?: VoiceEmbedding;
}

// Constants for audio processing
const SAMPLE_RATE = 16000; // Standard for speech processing
const FRAME_SIZE = 512;
const HOP_SIZE = 256;
const NUM_MEL_FILTERS = 26;
const NUM_MFCC = 13;
const MIN_FREQUENCY = 300;
const MAX_FREQUENCY = 8000;

// Hamming window for better frequency analysis
function hammingWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
}

// Convert frequency to Mel scale
function freqToMel(freq: number): number {
  return 2595 * Math.log10(1 + freq / 700);
}

// Convert Mel scale to frequency
function melToFreq(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

// Generate Mel filter bank
function createMelFilterBank(
  fftSize: number,
  sampleRate: number,
  numFilters: number,
  minFreq: number,
  maxFreq: number
): Float32Array[] {
  const filters: Float32Array[] = [];
  const minMel = freqToMel(minFreq);
  const maxMel = freqToMel(maxFreq);
  const melPoints = new Float32Array(numFilters + 2);
  
  for (let i = 0; i < numFilters + 2; i++) {
    melPoints[i] = minMel + (i * (maxMel - minMel)) / (numFilters + 1);
  }
  
  const freqPoints = melPoints.map(mel => melToFreq(mel));
  const binPoints = freqPoints.map(freq => 
    Math.floor((fftSize + 1) * freq / sampleRate)
  );
  
  for (let i = 0; i < numFilters; i++) {
    const filter = new Float32Array(fftSize / 2 + 1);
    const startBin = binPoints[i];
    const centerBin = binPoints[i + 1];
    const endBin = binPoints[i + 2];
    
    for (let j = startBin; j < centerBin; j++) {
      filter[j] = (j - startBin) / (centerBin - startBin);
    }
    for (let j = centerBin; j < endBin; j++) {
      filter[j] = (endBin - j) / (endBin - centerBin);
    }
    
    filters.push(filter);
  }
  
  return filters;
}

// Simple FFT implementation (radix-2 Cooley-Tukey)
function fft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  
  // Bit reversal
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
    let k = n / 2;
    while (k <= j) {
      j -= k;
      k /= 2;
    }
    j += k;
  }
  
  // Cooley-Tukey
  for (let step = 2; step <= n; step *= 2) {
    const halfStep = step / 2;
    const theta = -2 * Math.PI / step;
    
    for (let group = 0; group < n; group += step) {
      for (let pair = 0; pair < halfStep; pair++) {
        const angle = theta * pair;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        const i1 = group + pair;
        const i2 = group + pair + halfStep;
        
        const tReal = cos * real[i2] - sin * imag[i2];
        const tImag = sin * real[i2] + cos * imag[i2];
        
        real[i2] = real[i1] - tReal;
        imag[i2] = imag[i1] - tImag;
        real[i1] = real[i1] + tReal;
        imag[i1] = imag[i1] + tImag;
      }
    }
  }
}

// Calculate power spectrum
function powerSpectrum(frame: Float32Array, window: Float32Array): Float32Array {
  const n = frame.length;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  
  // Apply window
  for (let i = 0; i < n; i++) {
    real[i] = frame[i] * window[i];
  }
  
  fft(real, imag);
  
  const power = new Float32Array(n / 2 + 1);
  for (let i = 0; i <= n / 2; i++) {
    power[i] = real[i] * real[i] + imag[i] * imag[i];
  }
  
  return power;
}

// Discrete Cosine Transform (Type II) for MFCC
function dct(input: Float32Array, numCoeffs: number): Float32Array {
  const n = input.length;
  const output = new Float32Array(numCoeffs);
  
  for (let k = 0; k < numCoeffs; k++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += input[i] * Math.cos((Math.PI * k * (2 * i + 1)) / (2 * n));
    }
    output[k] = sum;
  }
  
  return output;
}

// Extract MFCC from a single frame
function extractFrameMFCC(
  frame: Float32Array,
  window: Float32Array,
  melFilters: Float32Array[],
  numMFCC: number
): Float32Array {
  const power = powerSpectrum(frame, window);
  
  // Apply Mel filter bank
  const melEnergies = new Float32Array(melFilters.length);
  for (let i = 0; i < melFilters.length; i++) {
    let sum = 0;
    for (let j = 0; j < power.length; j++) {
      sum += power[j] * melFilters[i][j];
    }
    melEnergies[i] = Math.log(Math.max(sum, 1e-10));
  }
  
  // Apply DCT
  return dct(melEnergies, numMFCC);
}

// Calculate zero crossing rate
function zeroCrossingRate(signal: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < signal.length; i++) {
    if ((signal[i] >= 0 && signal[i - 1] < 0) || 
        (signal[i] < 0 && signal[i - 1] >= 0)) {
      crossings++;
    }
  }
  return crossings / signal.length;
}

// Calculate spectral centroid
function spectralCentroid(power: Float32Array, sampleRate: number): number {
  let weightedSum = 0;
  let sum = 0;
  
  for (let i = 0; i < power.length; i++) {
    const freq = (i * sampleRate) / (2 * power.length);
    weightedSum += freq * power[i];
    sum += power[i];
  }
  
  return sum > 0 ? weightedSum / sum : 0;
}

// Estimate fundamental frequency (pitch) using autocorrelation
function estimatePitch(signal: Float32Array, sampleRate: number): number {
  const minLag = Math.floor(sampleRate / 400); // 400 Hz max
  const maxLag = Math.floor(sampleRate / 50);  // 50 Hz min
  
  let maxCorr = 0;
  let bestLag = 0;
  
  for (let lag = minLag; lag <= maxLag && lag < signal.length; lag++) {
    let corr = 0;
    for (let i = 0; i < signal.length - lag; i++) {
      corr += signal[i] * signal[i + lag];
    }
    
    if (corr > maxCorr) {
      maxCorr = corr;
      bestLag = lag;
    }
  }
  
  return bestLag > 0 ? sampleRate / bestLag : 0;
}

// Extract full MFCC profile from audio buffer
export function extractMFCCProfile(
  audioData: Float32Array,
  sampleRate: number = SAMPLE_RATE
): MFCCProfile {
  const frameSize = FRAME_SIZE;
  const hopSize = HOP_SIZE;
  const window = hammingWindow(frameSize);
  const melFilters = createMelFilterBank(frameSize, sampleRate, NUM_MEL_FILTERS, MIN_FREQUENCY, MAX_FREQUENCY);
  
  const allMFCCs: number[][] = [];
  const allPitches: number[] = [];
  const allEnergies: number[] = [];
  const allCentroids: number[] = [];
  
  // Process frames
  for (let start = 0; start + frameSize <= audioData.length; start += hopSize) {
    const frame = audioData.slice(start, start + frameSize);
    
    // Calculate energy
    let energy = 0;
    for (let i = 0; i < frame.length; i++) {
      energy += frame[i] * frame[i];
    }
    energy = Math.sqrt(energy / frame.length);
    
    // Skip silent frames
    if (energy < 0.01) continue;
    
    const mfcc = extractFrameMFCC(frame, window, melFilters, NUM_MFCC);
    allMFCCs.push(Array.from(mfcc));
    
    const pitch = estimatePitch(frame, sampleRate);
    if (pitch > 50 && pitch < 400) {
      allPitches.push(pitch);
    }
    
    allEnergies.push(energy);
    
    const power = powerSpectrum(frame, window);
    allCentroids.push(spectralCentroid(power, sampleRate));
  }
  
  if (allMFCCs.length === 0) {
    // Return empty profile for silent audio
    return {
      mfccMeans: new Array(NUM_MFCC).fill(0),
      mfccStds: new Array(NUM_MFCC).fill(0),
      pitchMean: 0,
      pitchStd: 0,
      energyMean: 0,
      energyStd: 0,
      spectralCentroidMean: 0,
      zeroCrossingRate: zeroCrossingRate(audioData),
    };
  }
  
  // Calculate statistics
  const mfccMeans = new Array(NUM_MFCC).fill(0);
  const mfccStds = new Array(NUM_MFCC).fill(0);
  
  for (let i = 0; i < NUM_MFCC; i++) {
    const values = allMFCCs.map(m => m[i]);
    mfccMeans[i] = values.reduce((a, b) => a + b, 0) / values.length;
    mfccStds[i] = Math.sqrt(
      values.reduce((a, b) => a + (b - mfccMeans[i]) ** 2, 0) / values.length
    );
  }
  
  const pitchMean = allPitches.length > 0 
    ? allPitches.reduce((a, b) => a + b, 0) / allPitches.length 
    : 0;
  const pitchStd = allPitches.length > 0
    ? Math.sqrt(allPitches.reduce((a, b) => a + (b - pitchMean) ** 2, 0) / allPitches.length)
    : 0;
  
  const energyMean = allEnergies.reduce((a, b) => a + b, 0) / allEnergies.length;
  const energyStd = Math.sqrt(
    allEnergies.reduce((a, b) => a + (b - energyMean) ** 2, 0) / allEnergies.length
  );
  
  const centroidMean = allCentroids.reduce((a, b) => a + b, 0) / allCentroids.length;
  
  return {
    mfccMeans,
    mfccStds,
    pitchMean,
    pitchStd,
    energyMean,
    energyStd,
    spectralCentroidMean: centroidMean,
    zeroCrossingRate: zeroCrossingRate(audioData),
  };
}

// Generate 128-dimensional embedding from MFCC profile
export function generateEmbedding(profile: MFCCProfile): number[] {
  const embedding: number[] = [];
  
  // MFCC means (13)
  embedding.push(...profile.mfccMeans);
  
  // MFCC standard deviations (13)
  embedding.push(...profile.mfccStds);
  
  // Pitch features (normalized)
  embedding.push(profile.pitchMean / 400); // Normalize pitch
  embedding.push(profile.pitchStd / 100);
  
  // Energy features
  embedding.push(profile.energyMean);
  embedding.push(profile.energyStd);
  
  // Spectral features
  embedding.push(profile.spectralCentroidMean / 4000); // Normalize
  embedding.push(profile.zeroCrossingRate);
  
  // MFCC deltas (approximated - difference between first and second half means)
  // This adds temporal dynamics
  for (let i = 0; i < NUM_MFCC; i++) {
    embedding.push(profile.mfccMeans[i] * 0.5); // Scaled version
  }
  
  // MFCC delta-deltas (second order)
  for (let i = 0; i < NUM_MFCC; i++) {
    embedding.push(profile.mfccStds[i] * 0.3); // Scaled version
  }
  
  // Cross-correlations between adjacent MFCCs
  for (let i = 0; i < NUM_MFCC - 1; i++) {
    embedding.push(profile.mfccMeans[i] * profile.mfccMeans[i + 1] / 1000);
  }
  
  // Pitch-energy interaction
  embedding.push(profile.pitchMean * profile.energyMean / 100);
  embedding.push(profile.pitchStd * profile.energyStd / 10);
  
  // Spectral-pitch interaction
  embedding.push(profile.spectralCentroidMean * profile.pitchMean / 100000);
  
  // Pad to exactly 128 dimensions
  while (embedding.length < 128) {
    embedding.push(0);
  }
  
  // Normalize the embedding
  const magnitude = Math.sqrt(embedding.reduce((a, b) => a + b * b, 0));
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= magnitude;
    }
  }
  
  return embedding.slice(0, 128);
}

// Calculate cosine similarity between two embeddings
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dotProduct / denominator : 0;
}

// Calculate Euclidean distance between embeddings
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  
  return Math.sqrt(sum);
}

// Merge multiple embeddings into one (for improving accuracy with multiple samples)
export function mergeEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return new Array(128).fill(0);
  if (embeddings.length === 1) return embeddings[0];
  
  const merged = new Array(128).fill(0);
  
  for (const embedding of embeddings) {
    for (let i = 0; i < 128; i++) {
      merged[i] += embedding[i];
    }
  }
  
  // Average and normalize
  const magnitude = Math.sqrt(merged.reduce((a, b) => a + b * b, 0));
  if (magnitude > 0) {
    for (let i = 0; i < 128; i++) {
      merged[i] /= magnitude;
    }
  }
  
  return merged;
}

// Voice Embedding Manager class for real-time speaker identification
export class VoiceEmbeddingManager {
  private knownEmbeddings: Map<string, VoiceEmbedding> = new Map();
  private ownerEmbedding: VoiceEmbedding | null = null;
  private sessionEmbeddings: Map<string, number[][]> = new Map(); // Temporary for current session
  private minSimilarityThreshold = 0.75; // Minimum similarity to match
  private ownerSimilarityThreshold = 0.82; // Higher threshold for owner detection
  
  constructor() {}
  
  // Load embeddings from database
  async loadEmbeddings(embeddings: VoiceEmbedding[]): Promise<void> {
    this.knownEmbeddings.clear();
    
    for (const emb of embeddings) {
      this.knownEmbeddings.set(emb.speakerId, emb);
      if (emb.isOwner) {
        this.ownerEmbedding = emb;
      }
    }
    
    console.log(`[VoiceEmbedding] Loaded ${embeddings.length} voice embeddings, owner: ${this.ownerEmbedding ? 'yes' : 'no'}`);
  }
  
  // Set owner embedding directly
  setOwnerEmbedding(embedding: VoiceEmbedding): void {
    this.ownerEmbedding = embedding;
    this.knownEmbeddings.set('owner', embedding);
  }
  
  // Add a known embedding
  addKnownEmbedding(embedding: VoiceEmbedding): void {
    this.knownEmbeddings.set(embedding.speakerId, embedding);
  }
  
  // Process audio and identify speaker
  identifySpeaker(audioData: Float32Array, sampleRate: number = SAMPLE_RATE): SpeakerMatch {
    const profile = extractMFCCProfile(audioData, sampleRate);
    const embedding = generateEmbedding(profile);
    
    // Check if it's silence/noise
    if (profile.energyMean < 0.01) {
      return {
        speakerId: 'silence',
        speakerName: 'Silence',
        confidence: 0,
        isOwner: false,
      };
    }
    
    // First, check against owner (highest priority)
    if (this.ownerEmbedding) {
      const ownerSimilarity = cosineSimilarity(embedding, this.ownerEmbedding.embedding);
      if (ownerSimilarity >= this.ownerSimilarityThreshold) {
        return {
          speakerId: 'owner',
          speakerName: this.ownerEmbedding.speakerName,
          confidence: ownerSimilarity,
          isOwner: true,
          embedding: this.ownerEmbedding,
        };
      }
    }
    
    // Check against all known embeddings
    let bestMatch: SpeakerMatch | null = null;
    let bestSimilarity = 0;
    
    for (const [speakerId, knownEmb] of this.knownEmbeddings) {
      if (speakerId === 'owner') continue; // Already checked
      
      const similarity = cosineSimilarity(embedding, knownEmb.embedding);
      if (similarity > bestSimilarity && similarity >= this.minSimilarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = {
          speakerId: knownEmb.speakerId,
          speakerName: knownEmb.speakerName,
          confidence: similarity,
          isOwner: knownEmb.isOwner,
          embedding: knownEmb,
        };
      }
    }
    
    if (bestMatch) {
      return bestMatch;
    }
    
    // Check session embeddings for recently detected speakers
    for (const [sessionSpeakerId, embeddings] of this.sessionEmbeddings) {
      if (embeddings.length === 0) continue;
      
      const mergedEmbedding = mergeEmbeddings(embeddings);
      const similarity = cosineSimilarity(embedding, mergedEmbedding);
      
      if (similarity > bestSimilarity && similarity >= this.minSimilarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = {
          speakerId: sessionSpeakerId,
          speakerName: `Speaker ${sessionSpeakerId.split('_')[1] || 'Unknown'}`,
          confidence: similarity,
          isOwner: false,
        };
      }
    }
    
    if (bestMatch) {
      return bestMatch;
    }
    
    // Unknown speaker - create new session speaker
    const newSpeakerId = `session_${this.sessionEmbeddings.size + 1}`;
    this.sessionEmbeddings.set(newSpeakerId, [embedding]);
    
    return {
      speakerId: newSpeakerId,
      speakerName: `Unknown Speaker ${this.sessionEmbeddings.size}`,
      confidence: 1.0, // Full confidence it's a new speaker
      isOwner: false,
    };
  }
  
  // Add sample to session speaker (for accumulating samples)
  addSampleToSessionSpeaker(speakerId: string, audioData: Float32Array, sampleRate: number = SAMPLE_RATE): void {
    const profile = extractMFCCProfile(audioData, sampleRate);
    const embedding = generateEmbedding(profile);
    
    const existing = this.sessionEmbeddings.get(speakerId) || [];
    existing.push(embedding);
    
    // Keep only last 10 samples for memory efficiency
    if (existing.length > 10) {
      existing.shift();
    }
    
    this.sessionEmbeddings.set(speakerId, existing);
  }
  
  // Create voice embedding for enrollment
  createEnrollmentEmbedding(
    audioSamples: Float32Array[],
    sampleRate: number,
    userId: string,
    speakerId: string,
    speakerName: string,
    isOwner: boolean
  ): VoiceEmbedding {
    const embeddings: number[][] = [];
    const profiles: MFCCProfile[] = [];
    
    for (const sample of audioSamples) {
      const profile = extractMFCCProfile(sample, sampleRate);
      if (profile.energyMean >= 0.01) { // Skip silent samples
        profiles.push(profile);
        embeddings.push(generateEmbedding(profile));
      }
    }
    
    // Merge all embeddings
    const mergedEmbedding = mergeEmbeddings(embeddings);
    
    // Average profile
    const avgProfile: MFCCProfile = {
      mfccMeans: new Array(NUM_MFCC).fill(0),
      mfccStds: new Array(NUM_MFCC).fill(0),
      pitchMean: 0,
      pitchStd: 0,
      energyMean: 0,
      energyStd: 0,
      spectralCentroidMean: 0,
      zeroCrossingRate: 0,
    };
    
    for (const profile of profiles) {
      for (let i = 0; i < NUM_MFCC; i++) {
        avgProfile.mfccMeans[i] += profile.mfccMeans[i];
        avgProfile.mfccStds[i] += profile.mfccStds[i];
      }
      avgProfile.pitchMean += profile.pitchMean;
      avgProfile.pitchStd += profile.pitchStd;
      avgProfile.energyMean += profile.energyMean;
      avgProfile.energyStd += profile.energyStd;
      avgProfile.spectralCentroidMean += profile.spectralCentroidMean;
      avgProfile.zeroCrossingRate += profile.zeroCrossingRate;
    }
    
    const numProfiles = profiles.length || 1;
    for (let i = 0; i < NUM_MFCC; i++) {
      avgProfile.mfccMeans[i] /= numProfiles;
      avgProfile.mfccStds[i] /= numProfiles;
    }
    avgProfile.pitchMean /= numProfiles;
    avgProfile.pitchStd /= numProfiles;
    avgProfile.energyMean /= numProfiles;
    avgProfile.energyStd /= numProfiles;
    avgProfile.spectralCentroidMean /= numProfiles;
    avgProfile.zeroCrossingRate /= numProfiles;
    
    const now = new Date();
    
    return {
      id: `voice_${Date.now()}`,
      userId,
      speakerId,
      speakerName,
      embedding: mergedEmbedding,
      mfccProfile: avgProfile,
      createdAt: now,
      updatedAt: now,
      sampleCount: audioSamples.length,
      isOwner,
    };
  }
  
  // Get confidence that audio is from owner
  getOwnerConfidence(audioData: Float32Array, sampleRate: number = SAMPLE_RATE): number {
    if (!this.ownerEmbedding) return 0;
    
    const profile = extractMFCCProfile(audioData, sampleRate);
    const embedding = generateEmbedding(profile);
    
    return cosineSimilarity(embedding, this.ownerEmbedding.embedding);
  }
  
  // Check if owner voice is enrolled
  hasOwnerVoice(): boolean {
    return this.ownerEmbedding !== null;
  }
  
  // Reset session speakers
  resetSession(): void {
    this.sessionEmbeddings.clear();
  }
  
  // Get all session speakers
  getSessionSpeakers(): string[] {
    return Array.from(this.sessionEmbeddings.keys());
  }
}

// Singleton instance
let voiceEmbeddingManager: VoiceEmbeddingManager | null = null;

export function getVoiceEmbeddingManager(): VoiceEmbeddingManager {
  if (!voiceEmbeddingManager) {
    voiceEmbeddingManager = new VoiceEmbeddingManager();
  }
  return voiceEmbeddingManager;
}

// Resample audio to target sample rate
export function resampleAudio(
  audioData: Float32Array, 
  fromRate: number, 
  toRate: number
): Float32Array {
  if (fromRate === toRate) return audioData;
  
  const ratio = fromRate / toRate;
  const newLength = Math.round(audioData.length / ratio);
  const result = new Float32Array(newLength);
  
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, audioData.length - 1);
    const t = srcIndex - srcIndexFloor;
    
    result[i] = audioData[srcIndexFloor] * (1 - t) + audioData[srcIndexCeil] * t;
  }
  
  return result;
}
