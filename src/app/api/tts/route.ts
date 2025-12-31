import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

// ElevenLabs TTS - optimized for ultra-low latency
// Using eleven_flash_v2_5 (~75ms) with streaming optimizations
export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromHeader(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { text, voice } = await request.json();

    if (!text || !voice) {
      return NextResponse.json(
        { error: 'Text and voice are required' },
        { status: 400 }
      );
    }

    if (voice !== 'mi' && voice !== 'ra' && voice !== 'mira') {
      return NextResponse.json(
        { error: 'Voice must be "mi", "ra", or "mira"' },
        { status: 400 }
      );
    }

    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    const ELEVENLABS_VOICE_MI = process.env.ELEVENLABS_VOICE_MI;
    const ELEVENLABS_VOICE_RA = process.env.ELEVENLABS_VOICE_RA;
    // Use Flash v2.5 for ultra-low latency (~75ms), fallback to turbo_v2_5 (~250ms)
    const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';

    if (!ELEVENLABS_API_KEY) {
      return NextResponse.json({ error: 'TTS not configured - missing API key' }, { status: 500 });
    }

    if (!ELEVENLABS_VOICE_MI || !ELEVENLABS_VOICE_RA) {
      return NextResponse.json({ error: 'TTS not configured - missing voice IDs' }, { status: 500 });
    }

    // ElevenLabs Voice IDs from environment variables
    const voiceMap: Record<string, string> = {
      mi: ELEVENLABS_VOICE_MI,
      ra: ELEVENLABS_VOICE_RA,
      mira: ELEVENLABS_VOICE_MI,
    };

    const selectedVoiceId = voiceMap[voice as 'mi' | 'ra' | 'mira'];

    // Call ElevenLabs API with low-latency optimizations
    // Using mp3_22050_32 for faster encoding (lower bitrate = faster)
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}?output_format=mp3_22050_32`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: text,
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
      console.error('ElevenLabs error:', error);
      return NextResponse.json(
        { error: 'Failed to generate speech' },
        { status: response.status }
      );
    }

    // Get the audio as array buffer
    const audioBuffer = await response.arrayBuffer();

    return new NextResponse(new Uint8Array(audioBuffer), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('TTS error:', error);
    return NextResponse.json(
      { error: 'Failed to generate speech' },
      { status: 500 }
    );
  }
}
