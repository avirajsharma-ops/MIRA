import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

// OpenAI Whisper transcription with improved settings
async function transcribeAudio(audioBuffer: Buffer, language?: string): Promise<{ text: string; detectedLanguage: string }> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const formData = new FormData();
  // Convert Buffer to Uint8Array for Blob compatibility
  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' });
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'whisper-1');
  
  // Add response format for faster processing
  formData.append('response_format', 'json');
  
  // Add prompt to help with accuracy for common phrases and names
  // This helps Whisper recognize specific words/names more accurately
  formData.append('prompt', 'MIRA, Meera, Hey MIRA, Hi MIRA, Aviraj, Talio. Common words: audible, hear, speaking, listening, help, please, thank you, okay, yes, no, what, why, how, when, where.');
  
  // Set language hint for better accuracy
  if (language) {
    formData.append('language', language);
  } else {
    // Default to English but Whisper will auto-detect Hindi/Hinglish
    formData.append('language', 'en');
  }

  // Temperature 0 for most deterministic/accurate results
  formData.append('temperature', '0.0');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[Transcribe] Whisper API error:', error);
    throw new Error('Transcription failed');
  }

  const result = await response.json();
  return {
    text: result.text,
    detectedLanguage: language || 'auto',
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
    const preferredLanguage = formData.get('language') as string | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'Audio file is required' },
        { status: 400 }
      );
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Log audio size for debugging
    console.log(`[Transcribe] Processing audio: ${buffer.length} bytes`);

    // Pass language hint if provided, otherwise let Whisper auto-detect
    const result = await transcribeAudio(buffer, preferredLanguage || undefined);
    
    const duration = Date.now() - startTime;
    console.log(`[Transcribe] Completed in ${duration}ms: "${result.text.substring(0, 50)}..."`);

    return NextResponse.json({
      text: result.text,
      detectedLanguage: result.detectedLanguage,
    });
  } catch (error) {
    console.error('[Transcribe] Error:', error);
    return NextResponse.json(
      { error: 'Failed to transcribe audio' },
      { status: 500 }
    );
  }
}
