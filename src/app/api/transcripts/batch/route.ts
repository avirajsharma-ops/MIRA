// Batch Transcripts API - For sendBeacon on page close
// CRITICAL: Ensures all conversation data is saved before page unloads
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { saveTranscriptEntry, createUserSpeaker, createMiraSpeaker, getOrCreateOtherSpeaker, createSpeakerTracker } from '@/lib/transcription/transcriptionService';
import { ISpeaker } from '@/models/Transcript';

// POST - Save multiple transcript entries (batch save via sendBeacon)
export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    // Note: sendBeacon sends as text/plain, so we need to handle that
    const contentType = request.headers.get('content-type') || '';
    let body: any;
    
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      // sendBeacon sends as text/plain by default
      const text = await request.text();
      try {
        body = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
      }
    }
    
    // Token is in the body for sendBeacon (headers not supported)
    const token = body.token;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    
    const userId = payload.userId;
    const { batch, items } = body;
    
    if (!batch || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Invalid batch payload' }, { status: 400 });
    }
    
    console.log('[Batch Transcripts] 📥 Received', items.length, 'items from user', userId);
    
    // Create a speaker tracker for 'other' speakers
    const speakerTracker = createSpeakerTracker();
    
    // Process all items
    const results = [];
    let saved = 0;
    
    for (const item of items) {
      try {
        const { sessionId, content, speakerType, speakerName, timestamp } = item;
        
        if (!content || !sessionId) {
          results.push({ success: false, error: 'Missing content or sessionId' });
          continue;
        }
        
        // Create speaker based on type
        let speaker: ISpeaker;
        if (speakerType === 'mira') {
          speaker = createMiraSpeaker();
        } else if (speakerType === 'other') {
          speaker = getOrCreateOtherSpeaker(speakerTracker, undefined, speakerName);
        } else {
          speaker = createUserSpeaker(speakerName || 'User');
        }
        
        // Save the transcript entry
        await saveTranscriptEntry(
          userId,
          sessionId,
          {
            speaker,
            content,
            timestamp: timestamp ? new Date(timestamp) : new Date(),
            isDirectedAtMira: speakerType !== 'mira',
          }
        );
        
        results.push({ success: true });
        saved++;
      } catch (err) {
        console.error('[Batch Transcripts] Error saving item:', err);
        results.push({ success: false, error: String(err) });
      }
    }
    
    console.log('[Batch Transcripts] ✓ Saved', saved, '/', items.length, 'items');
    
    return NextResponse.json({
      success: true,
      saved,
      total: items.length,
      results,
    });
    
  } catch (error) {
    console.error('[Batch Transcripts] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
