import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

// Redirect to streaming endpoint for faster response
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

    if (voice !== 'mi' && voice !== 'ra') {
      return NextResponse.json(
        { error: 'Voice must be "mi" or "ra"' },
        { status: 400 }
      );
    }

    // Use ElevenLabs turbo model with optimized settings
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    // Voice IDs - must be configured via environment variables
    const VOICE_MAP = {
      mi: process.env.ELEVENLABS_VOICE_MI || '',
      ra: process.env.ELEVENLABS_VOICE_RA || '',
    };

    if (!ELEVENLABS_API_KEY) {
      return NextResponse.json({ error: 'TTS not configured' }, { status: 500 });
    }

    // Fix pronunciation
    const correctedText = text
      .replace(/\bMIRA\b/gi, 'Meera')
      .replace(/\bMI\b/g, 'Me')
      .replace(/\bMi\b/g, 'Me')
      .replace(/\bRA\b/g, 'Raa')
      .replace(/\bRa\b/g, 'Raa');

    const voiceId = VOICE_MAP[voice as 'mi' | 'ra'];

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
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
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('ElevenLabs error:', error);
      return NextResponse.json({ error: 'TTS failed' }, { status: 500 });
    }

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
