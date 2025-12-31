import { NextRequest } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

// ElevenLabs TTS Streaming - optimized for ultra-low latency
// Using eleven_flash_v2_5 (~75ms) with streaming for fastest response

// Preprocess text to replace MI/RA/MIRA with Hindi pronunciations for TTS
function preprocessTextForTTS(text: string): string {
  // Replace variations of MI, RA, MIRA with Hindi equivalents for proper pronunciation
  // Using word boundaries to avoid replacing parts of other words
  let processed = text;
  
  // Replace MIRA first (before MI/RA to avoid partial replacements)
  processed = processed.replace(/\bMIRA\b/gi, 'मीरा');
  
  // Replace MI (मी) - careful not to replace "mi" in middle of words
  processed = processed.replace(/\bMI\b/gi, 'मी');
  
  // Replace RA (रा)
  processed = processed.replace(/\bRA\b/gi, 'रा');
  
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

    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    const ELEVENLABS_VOICE_MI = process.env.ELEVENLABS_VOICE_MI;
    const ELEVENLABS_VOICE_RA = process.env.ELEVENLABS_VOICE_RA;
    // Use Flash v2.5 for ultra-low latency (~75ms), fallback to turbo_v2_5 (~250ms)
    const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';

    if (!ELEVENLABS_API_KEY) {
      return new Response(JSON.stringify({ error: 'TTS not configured - missing API key' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!ELEVENLABS_VOICE_MI || !ELEVENLABS_VOICE_RA) {
      return new Response(JSON.stringify({ error: 'TTS not configured - missing voice IDs' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ElevenLabs Voice IDs from environment variables
    const voiceMap: Record<string, string> = {
      mi: ELEVENLABS_VOICE_MI,
      ra: ELEVENLABS_VOICE_RA,
      mira: ELEVENLABS_VOICE_MI,
    };

    const selectedVoiceId = voiceMap[voice as 'mi' | 'ra' | 'mira'];

    // Preprocess text to use Hindi names for MI/RA/MIRA
    const processedText = preprocessTextForTTS(text);

    // Call ElevenLabs streaming API with low-latency optimizations
    // Using mp3_22050_32 for faster encoding
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}/stream?output_format=mp3_22050_32`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: processedText,
          model_id: ELEVENLABS_MODEL,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,  // Disable style for faster processing
            use_speaker_boost: false,  // Disable for lower latency
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('ElevenLabs stream error:', error);
      return new Response(JSON.stringify({ error: 'Failed to stream speech' }), { 
        status: response.status,
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
