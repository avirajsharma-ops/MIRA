import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

/**
 * ElevenLabs Speech-to-Text API
 * High-accuracy transcription for user speech
 * 
 * POST /api/transcribe/elevenlabs
 * Body: FormData with 'audio' file
 * 
 * ElevenLabs STT Features:
 * - Superior accuracy for natural speech
 * - Better handling of accents and dialects
 * - Low latency for real-time applications
 */

async function transcribeWithElevenLabs(audioBuffer: Buffer, mimeType: string = 'audio/webm'): Promise<{ text: string; language?: string }> {
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const formData = new FormData();
  
  // Convert Buffer to Blob
  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  formData.append('file', audioBlob, 'audio.webm');
  
  // ElevenLabs STT model - use 'eleven_turbo_v2' for faster results
  formData.append('model_id', 'eleven_turbo_v2');

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[ElevenLabs STT] API error:', response.status, errorText);
    throw new Error(`ElevenLabs transcription failed: ${response.status}`);
  }

  const result = await response.json();
  
  return {
    text: result.text || '',
    language: result.language_code,
  };
}

// Fallback to OpenAI Whisper if ElevenLabs fails
async function transcribeWithWhisper(audioBuffer: Buffer): Promise<{ text: string; language?: string }> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const formData = new FormData();
  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' });
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'json');
  formData.append('temperature', '0.0');
  formData.append('prompt', 'MIRA, Meera, Hey MIRA, Hi MIRA, Aviraj, Talio.');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Whisper transcription failed');
  }

  const result = await response.json();
  return {
    text: result.text,
    language: 'auto',
  };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const token = getTokenFromHeader(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'Audio file is required' },
        { status: 400 }
      );
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = audioFile.type || 'audio/webm';

    console.log(`[ElevenLabs STT] Processing audio: ${buffer.length} bytes, type: ${mimeType}`);

    let result: { text: string; language?: string };
    let usedEngine = 'elevenlabs';

    try {
      // Try ElevenLabs first for best accuracy
      result = await transcribeWithElevenLabs(buffer, mimeType);
      console.log(`[ElevenLabs STT] Success in ${Date.now() - startTime}ms`);
    } catch (elevenLabsError) {
      // Fallback to Whisper if ElevenLabs fails
      console.warn('[ElevenLabs STT] Failed, falling back to Whisper:', elevenLabsError);
      result = await transcribeWithWhisper(buffer);
      usedEngine = 'whisper';
      console.log(`[Whisper STT] Fallback success in ${Date.now() - startTime}ms`);
    }

    const duration = Date.now() - startTime;
    console.log(`[Transcribe] Completed with ${usedEngine} in ${duration}ms: "${result.text.substring(0, 50)}..."`);

    return NextResponse.json({
      text: result.text,
      language: result.language,
      engine: usedEngine,
      latencyMs: duration,
    });
  } catch (error) {
    console.error('[Transcribe] Error:', error);
    return NextResponse.json(
      { error: 'Transcription failed' },
      { status: 500 }
    );
  }
}
