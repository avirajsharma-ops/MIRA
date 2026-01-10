import { NextRequest } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

// OpenAI TTS - MIRA voice (non-streaming fallback)
// MIRA: coral voice via Realtime API, nova for TTS fallback

// Preprocess text to replace MIRA with phonetic pronunciation for TTS
function preprocessTextForTTS(text: string): string {
  let processed = text;
  
  // Replace MIRA with phonetic pronunciation
  processed = processed.replace(/\bMIRA\b/gi, 'Meera');
  
  return processed;
}

export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromHeader(request.headers.get('authorization'));
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { text, voice } = await request.json();

    if (!text) {
      return new Response(JSON.stringify({ error: 'Text is required' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: 'TTS not configured - missing API key' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // MIRA always uses nova voice for TTS fallback
    const selectedVoice = 'nova';
    const processedText = preprocessTextForTTS(text);

    // Call OpenAI TTS API
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: processedText,
        voice: selectedVoice,
        response_format: 'mp3',
        speed: 1.0,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI TTS error:', error);
      return new Response(JSON.stringify({ error: 'Failed to generate speech' }), { 
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Return the audio
    const audioBuffer = await response.arrayBuffer();
    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('TTS error:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate speech' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
