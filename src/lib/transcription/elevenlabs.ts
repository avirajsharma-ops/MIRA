/**
 * ElevenLabs Speech-to-Text Service
 * High-accuracy transcription using ElevenLabs API
 */

export interface TranscriptionResult {
  text: string;
  language?: string;
  confidence?: number;
  words?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
}

export interface ElevenLabsSTTOptions {
  modelId?: 'eleven_turbo_v2' | 'eleven_multilingual_v2';
  languageCode?: string;
}

/**
 * Transcribe audio using ElevenLabs Speech-to-Text API
 * @param audioBuffer - Audio data as Buffer
 * @param mimeType - MIME type of the audio (default: audio/webm)
 * @param options - Optional configuration
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string = 'audio/webm',
  options: ElevenLabsSTTOptions = {}
): Promise<TranscriptionResult> {
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY environment variable is not set');
  }

  const { modelId = 'eleven_turbo_v2', languageCode } = options;

  const formData = new FormData();
  
  // Convert Buffer to Blob for FormData
  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model_id', modelId);
  
  if (languageCode) {
    formData.append('language_code', languageCode);
  }

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[ElevenLabs STT] Error response:', response.status, errorBody);
    throw new Error(`ElevenLabs STT failed with status ${response.status}: ${errorBody}`);
  }

  const result = await response.json();

  return {
    text: result.text || '',
    language: result.language_code,
    confidence: result.confidence,
    words: result.words,
  };
}

/**
 * Transcribe audio from a URL
 * @param audioUrl - URL of the audio file
 * @param options - Optional configuration
 */
export async function transcribeFromUrl(
  audioUrl: string,
  options: ElevenLabsSTTOptions = {}
): Promise<TranscriptionResult> {
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY environment variable is not set');
  }

  const { modelId = 'eleven_turbo_v2', languageCode } = options;

  const body: Record<string, string> = {
    audio_url: audioUrl,
    model_id: modelId,
  };

  if (languageCode) {
    body.language_code = languageCode;
  }

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`ElevenLabs STT failed: ${errorBody}`);
  }

  const result = await response.json();

  return {
    text: result.text || '',
    language: result.language_code,
    confidence: result.confidence,
    words: result.words,
  };
}

/**
 * Check if ElevenLabs API is available and configured
 */
export function isElevenLabsConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

/**
 * Get available ElevenLabs models for STT
 */
export function getAvailableModels() {
  return [
    {
      id: 'eleven_turbo_v2',
      name: 'Turbo v2',
      description: 'Fastest model, optimized for real-time applications',
      languages: ['en', 'multi'],
    },
    {
      id: 'eleven_multilingual_v2',
      name: 'Multilingual v2',
      description: 'Best accuracy for multiple languages',
      languages: ['en', 'de', 'pl', 'es', 'it', 'fr', 'pt', 'hi', 'ar', 'ko', 'ja', 'zh'],
    },
  ];
}
