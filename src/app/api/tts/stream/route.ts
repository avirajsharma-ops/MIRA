import { NextRequest } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

// ElevenLabs streaming TTS
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// Voice IDs - configurable via env vars with defaults
const VOICE_MAP = {
  mi: process.env.ELEVENLABS_VOICE_MI || 'MF4J4IDTRo0AxOO4dpFR',  // MI voice
  ra: process.env.ELEVENLABS_VOICE_RA || 'wbOlq3nIga8HKqcDhASI',  // RA voice
};

// Fix phonetic pronunciation
function fixPronunciation(text: string): string {
  return text
    .replace(/\bMIRA\b/gi, 'Meera')
    .replace(/\bMI\b/g, 'Me')
    .replace(/\bMi\b/g, 'Me')
    .replace(/\bRA\b/g, 'Raa')
    .replace(/\bRa\b/g, 'Raa');
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

    if (voice !== 'mi' && voice !== 'ra') {
      return new Response(JSON.stringify({ error: 'Voice must be "mi" or "ra"' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!ELEVENLABS_API_KEY) {
      return new Response(JSON.stringify({ error: 'TTS not configured' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const voiceId = VOICE_MAP[voice as 'mi' | 'ra'];
    const correctedText = fixPronunciation(text);

    // Use ElevenLabs streaming endpoint
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: correctedText,
          model_id: 'eleven_turbo_v2_5', // Fastest model
          voice_settings: {
            stability: voice === 'mi' ? 0.5 : 0.7,
            similarity_boost: 0.75,
            style: voice === 'mi' ? 0.3 : 0.1,
            use_speaker_boost: true,
          },
          optimize_streaming_latency: 4, // Maximum optimization for low latency
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('ElevenLabs streaming error:', error);
      return new Response(JSON.stringify({ error: 'TTS failed' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Stream the response directly
    return new Response(response.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('TTS stream error:', error);
    return new Response(JSON.stringify({ error: 'Failed to stream speech' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
