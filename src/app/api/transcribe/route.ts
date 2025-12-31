import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/voice';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

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

    // Pass language hint if provided, otherwise let Whisper auto-detect
    const result = await transcribeAudio(buffer, preferredLanguage || undefined);

    return NextResponse.json({
      text: result.text,
      detectedLanguage: result.detectedLanguage,
    });
  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: 'Failed to transcribe audio' },
      { status: 500 }
    );
  }
}
