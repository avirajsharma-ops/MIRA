// Transcripts API - Background conversation storage
// CRITICAL: All resting state conversations are saved and indexed
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
import { ContextEngine } from '@/lib/agents';
import { generateEmbedding } from '@/lib/ai/embeddings';
import Memory from '@/models/Memory';
import mongoose from 'mongoose';

// Check if content contains information worth remembering - EXPANDED patterns
function shouldExtractMemory(content: string, speakerType: string): boolean {
  if (!content || content.length < 10) return false;
  
  // Skip simple acknowledgements
  const simplePatterns = /^(ok|okay|yes|no|yeah|sure|thanks|bye|hi|hello|hmm|um|uh)\s*[.!?]*$/i;
  if (simplePatterns.test(content.trim())) return false;
  
  // ALWAYS extract from meaningful user speech (longer than 20 chars)
  if (speakerType === 'user' && content.length > 20) {
    return true; // Save everything substantial the user says
  }
  
  // Extract memories from user-spoken content - specific patterns
  if (speakerType === 'user') {
    // Personal info patterns - EXPANDED to catch more valuable info
    const personalPatterns = [
      /\b(my name is|i am|i'm)\s+\w+/i,
      /\b(my|i have a?)\s+(wife|husband|son|daughter|brother|sister|mom|dad|friend|colleague)\b/i,
      /\b(i like|i love|i hate|i prefer|my favorite)\b/i,
      /\b(i work at|i'm a|my job is)\b/i,
      /\b(remember|don't forget|important)\b/i,
      /\b(birthday|anniversary|meeting|appointment)\b.*\b(is on|on|at)\b/i,
      // Pets and ownership
      /\b(i adopted|i got|i bought|i have|my)\s+(a |an )?\s*(pet|dog|cat|bird|fish|hamster|rabbit|turtle|parrot|dinosaur)\b/i,
      /\b(adopted|got|bought|have)\s+(a |an )?\s*(new |baby )?\s*(pet|dog|cat|bird|fish|puppy|kitten)\b/i,
      // Possessions and things
      /\b(i own|i bought|i got|my new|i purchased)\s/i,
      // Life events
      /\b(i moved|i'm moving|i live|i'm from|i grew up)\b/i,
      /\b(i started|i'm starting|i joined|i quit|i left)\b/i,
      // Interests and hobbies
      /\b(i play|i enjoy|i'm interested in|my hobby)\b/i,
      /\b(i'm learning|i want to learn|i study|i'm studying)\b/i,
      // Plans and intentions
      /\b(i'm going to|i will|i plan to|i want to|i need to)\b/i,
      // Any mention of names
      /\b(called|named|name is|meet|this is)\s+[A-Z][a-z]+/,
    ];
    return personalPatterns.some(p => p.test(content));
  }
  
  // Extract from conversations about people
  if (speakerType === 'other') {
    // Someone else is mentioned - save their speech
    return content.length > 15;
  }
  
  return false;
}

// Extract memory type from content
function detectMemoryType(content: string): 'person' | 'preference' | 'fact' | 'event' | 'task' {
  const lower = content.toLowerCase();
  
  if (/\b(name is|this is|meet|friend|colleague|wife|husband|brother|sister|mom|dad)\b/.test(lower)) {
    return 'person';
  }
  if (/\b(like|love|hate|prefer|favorite|enjoy)\b/.test(lower)) {
    return 'preference';
  }
  if (/\b(meeting|appointment|birthday|anniversary|deadline|schedule)\b/.test(lower)) {
    return 'event';
  }
  if (/\b(todo|task|remind|don't forget|remember to)\b/.test(lower)) {
    return 'task';
  }
  return 'fact';
}

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
    const { sessionId, content, speakerType, speakerName, confidence, language, visualContext, timestamp } = body;

    if (!sessionId || !content) {
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    // Use provided timestamp or current time
    const entryTimestamp = timestamp ? new Date(timestamp) : new Date();

    // Determine speaker
    let speaker: ISpeaker;
    if (speakerType === 'user') {
      speaker = createUserSpeaker(payload.name || 'User');
    } else if (speakerType === 'mira') {
      // MIRA is a unified entity
      speaker = createMiraSpeaker();
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

    // Create entry with proper timestamp
    const entry: ITranscriptEntry = {
      timestamp: entryTimestamp,
      speaker,
      content,
      isDirectedAtMira: directedAtMira,
      confidence,
      detectedLanguage: language,
      visualContext,
    };

    // Save to database with retry logic
    let saved = false;
    let retries = 3;
    
    while (!saved && retries > 0) {
      try {
        await saveTranscriptEntry(payload.userId, sessionId, entry);
        saved = true;
      } catch (saveError) {
        retries--;
        console.error('[Transcript] Save attempt failed, retries left:', retries, saveError);
        if (retries > 0) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
    
    if (!saved) {
      console.error('[Transcript] Failed to save after all retries');
      return NextResponse.json({ error: 'Failed to save transcript' }, { status: 500 });
    }

    // Extract and save memory if content is significant
    // CRITICAL: Save synchronously with embedding for semantic search
    if (shouldExtractMemory(content, speakerType)) {
      try {
        const memoryType = detectMemoryType(content);
        
        // Add context about who said it if it's not the user
        const memoryContent = speakerType === 'other' && speakerName
          ? `${speakerName} said: "${content}"`
          : content;
        
        // Generate embedding for semantic search
        let embedding: number[] | undefined;
        try {
          embedding = await generateEmbedding(memoryContent);
        } catch (embErr) {
          console.warn('[Transcript] Failed to generate embedding:', embErr);
        }
        
        // Check for duplicate content
        const userObjectId = new mongoose.Types.ObjectId(payload.userId);
        const existing = await Memory.findOne({
          userId: userObjectId,
          content: { $regex: memoryContent.substring(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
          isArchived: false,
        });
        
        if (!existing) {
          // Save memory with embedding
          await Memory.create({
            userId: userObjectId,
            type: memoryType,
            content: memoryContent,
            importance: memoryType === 'person' ? 8 : 6,
            source: speakerType === 'user' ? 'user' : 'inferred',
            tags: speakerType === 'other' && speakerName ? [speakerName.toLowerCase()] : [],
            embedding,
            context: {
              timestamp: entryTimestamp,
            },
          });
          
          console.log('[Transcript] ✅ Memory saved with embedding:', memoryType, '-', memoryContent.substring(0, 50));
        } else {
          console.log('[Transcript] ⏭️ Duplicate memory skipped:', memoryContent.substring(0, 30));
        }
      } catch (memErr) {
        console.error('[Transcript] ❌ Memory save failed:', memErr);
        // Don't fail the request, but log the error
      }
    }

    console.log('[Transcript] ✅ Saved entry:', speakerType, '-', content.substring(0, 50), 'at', entryTimestamp.toISOString());

    return NextResponse.json({
      success: true,
      isDirectedAtMira: directedAtMira,
      timestamp: entryTimestamp.toISOString(),
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
