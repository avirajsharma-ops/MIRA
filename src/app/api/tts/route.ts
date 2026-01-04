import { NextRequest } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

// OpenAI TTS - using multilingual voices (non-streaming fallback)
// MI: Female voice (nova - warm, expressive)
// RA: Male voice (onyx - deep, authoritative)

// Preprocess text to replace MI/RA/MIRA with phonetic pronunciations for TTS
function preprocessTextForTTS(text: string): string {
  let processed = text;
  
  // Replace MIRA first (before MI/RA to avoid partial replacements)
  processed = processed.replace(/\bMIRA\b/gi, 'Meera');
  
  // Replace MI
  processed = processed.replace(/\bMI\b/gi, 'Mee');
  
  // Replace RA
  processed = processed.replace(/\bRA\b/gi, 'Raa');
  
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

    if (!text || !voice) {
      return new Response(JSON.stringify({ error: 'Text and voice are required' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (voice !== 'mi' && voice !== 'ra' && voice !== 'mira') {
      return new Response(JSON.stringify({ error: 'Voice must be "mi", "ra", or "mira"' }), { 
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

    // OpenAI Voice mapping
    // MI/MIRA: nova - soft, warm female voice (multilingual)
    // RA: onyx - deep, smooth male voice (multilingual)
    const voiceMap: Record<string, string> = {
      mi: 'nova',
      ra: 'onyx',
      mira: 'nova',
    };

    const selectedVoice = voiceMap[voice as 'mi' | 'ra' | 'mira'];
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
