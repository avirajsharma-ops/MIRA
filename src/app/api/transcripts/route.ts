// Transcripts API - Background conversation storage
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import {
  saveTranscriptEntry,
  getTranscripts,
  getTranscriptById,
  generateTranscriptSummary,
  isDirectedAtMira,
  createUserSpeaker,
  createMiraSpeaker,
} from '@/lib/transcription/transcriptionService';
import { ITranscriptEntry, ISpeaker } from '@/models/Transcript';

// POST - Save a transcript entry (background save)
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

    const body = await request.json();
    const { sessionId, content, speakerType, speakerName, confidence, language, visualContext } = body;

    if (!sessionId || !content) {
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    // Determine speaker
    let speaker: ISpeaker;
    if (speakerType === 'user') {
      speaker = createUserSpeaker(payload.name || 'User');
    } else if (speakerType === 'mira') {
      // Normalize speakerName to lowercase for createMiraSpeaker
      // Handle both 'MI'/'RA'/'MIRA' (uppercase) and 'mi'/'ra'/'mira' (lowercase)
      const normalizedAgent = (speakerName || 'mira').toLowerCase() as 'mi' | 'ra' | 'mira';
      speaker = createMiraSpeaker(normalizedAgent);
    } else {
      // Other person
      speaker = {
        id: speakerName || `person_${Date.now()}`,
        name: speakerName || 'Unknown',
        type: 'other',
        isKnown: false,
      };
    }

    // Check if directed at MIRA
    const directedAtMira = isDirectedAtMira(content);

    // Create entry
    const entry: ITranscriptEntry = {
      timestamp: new Date(),
      speaker,
      content,
      isDirectedAtMira: directedAtMira,
      confidence,
      detectedLanguage: language,
      visualContext,
    };

    // Save to database
    await saveTranscriptEntry(payload.userId, sessionId, entry);

    return NextResponse.json({
      success: true,
      isDirectedAtMira: directedAtMira,
    });
  } catch (error) {
    console.error('Transcript save error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET - Retrieve transcripts
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromHeader(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const transcriptId = searchParams.get('id');
    const sessionId = searchParams.get('sessionId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = parseInt(searchParams.get('skip') || '0');
    const generateSummary = searchParams.get('summary') === 'true';

    // Get single transcript by ID
    if (transcriptId) {
      const transcript = await getTranscriptById(payload.userId, transcriptId);
      if (!transcript) {
        return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });
      }

      // Generate summary if requested
      let summary = transcript.metadata.summary;
      if (generateSummary && !summary) {
        summary = await generateTranscriptSummary(transcriptId, payload.userId);
      }

      return NextResponse.json({ transcript, summary });
    }

    // Get list of transcripts
    const options: any = { limit, skip };
    if (sessionId) options.sessionId = sessionId;
    if (startDate) options.startDate = new Date(startDate);
    if (endDate) options.endDate = new Date(endDate);

    const { transcripts, total } = await getTranscripts(payload.userId, options);

    return NextResponse.json({
      transcripts,
      total,
      limit,
      skip,
      hasMore: skip + transcripts.length < total,
    });
  } catch (error) {
    console.error('Transcript fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
