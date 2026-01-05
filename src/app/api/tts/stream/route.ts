import { NextRequest } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

// OpenAI TTS - using multilingual voices
// MI: Female voice (nova - warm, expressive)
// RA: Male voice (onyx - deep, authoritative)

// Preprocess text to replace MI/RA/MIRA with Hindi pronunciations for TTS
function preprocessTextForTTS(text: string): string {
  // Replace variations of MI, RA, MIRA with Hindi equivalents for proper pronunciation
  // Using word boundaries to avoid replacing parts of other words
  let processed = text;
  
  // Replace MIRA first (before MI/RA to avoid partial replacements)
  processed = processed.replace(/\bMIRA\b/gi, 'Meera');
  
  // Replace MI (मी) - careful not to replace "mi" in middle of words
  processed = processed.replace(/\bMI\b/gi, 'Mee');
  
  // Replace RA (रा)
  processed = processed.replace(/\bRA\b/gi, 'Raa');
  
  return processed;
}

// Response cache for faster repeated phrases
const responseCache = new Map<string, ArrayBuffer>();
const MAX_CACHE_SIZE = 50;

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
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
      mi: 'nova',      // Female - warm, conversational
      ra: 'onyx',      // Male - deep, authoritative
      mira: 'nova',    // Same as MI
    };

    const selectedVoice = voiceMap[voice as 'mi' | 'ra' | 'mira'];

    // Preprocess text for better pronunciation
    const processedText = preprocessTextForTTS(text);
    
    // Check cache for common phrases
    const cacheKey = `${selectedVoice}:${processedText}`;
    if (responseCache.has(cacheKey)) {
      console.log(`[TTS] Cache HIT in ${Date.now() - startTime}ms`);
      const cachedBuffer = responseCache.get(cacheKey)!;
      return new Response(cachedBuffer, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=3600',
          'X-Cache': 'HIT',
        },
      });
    }

    console.log(`[TTS] Requesting OpenAI TTS for: "${processedText.substring(0, 50)}..."`);

    // Call OpenAI TTS API with optimized settings for SPEED
    // Using 'opus' format for faster encoding/decoding and smaller size
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',  // tts-1 is faster than tts-1-hd (lower quality but faster)
        input: processedText,
        voice: selectedVoice,
        response_format: 'opus',  // opus is smaller and faster than mp3
        speed: 1.1,  // Slightly faster speech for snappier response
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[TTS] OpenAI TTS error:', error);
      return new Response(JSON.stringify({ error: 'Failed to generate speech' }), { 
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`[TTS] OpenAI responded in ${Date.now() - startTime}ms`);

    // STREAM the response directly to client for faster playback start
    // Don't wait for full buffer - pipe directly
    if (response.body) {
      // For caching, we need to tee the stream
      const [streamForClient, streamForCache] = response.body.tee();
      
      // Cache in background (don't await)
      if (processedText.length < 300) {
        (async () => {
          try {
            const reader = streamForCache.getReader();
            const chunks: Uint8Array[] = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) chunks.push(value);
            }
            const audioBuffer = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
            let offset = 0;
            for (const chunk of chunks) {
              audioBuffer.set(chunk, offset);
              offset += chunk.length;
            }
            
            if (responseCache.size >= MAX_CACHE_SIZE) {
              const firstKey = responseCache.keys().next().value;
              if (firstKey) responseCache.delete(firstKey);
            }
            responseCache.set(cacheKey, audioBuffer.buffer);
            console.log(`[TTS] Cached response for: "${processedText.substring(0, 30)}..."`);
          } catch (e) {
            // Ignore cache errors
          }
        })();
      }

      console.log(`[TTS] Streaming response at ${Date.now() - startTime}ms`);
      
      // Return streaming response immediately
      return new Response(streamForClient, {
        headers: {
          'Content-Type': 'audio/ogg',
          'Cache-Control': 'no-cache',
          'X-Cache': 'MISS',
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    // Fallback: if no body, get as buffer
    const audioBuffer = await response.arrayBuffer();
    
    console.log(`[TTS] Total time: ${Date.now() - startTime}ms`);

    // Return the audio
    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/ogg',
        'Cache-Control': 'public, max-age=3600',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    console.error('[TTS] Stream error:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate speech' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
