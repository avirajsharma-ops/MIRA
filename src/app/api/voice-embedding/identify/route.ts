// Voice Identification API - Identify speaker from audio embedding
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import { VoiceEmbedding } from '@/models';
import mongoose from 'mongoose';

// Cosine similarity between two embeddings
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude > 0 ? dotProduct / magnitude : 0;
}

// Thresholds for matching
const OWNER_THRESHOLD = 0.78; // Higher threshold for owner match
const KNOWN_SPEAKER_THRESHOLD = 0.72;
const POSSIBLE_MATCH_THRESHOLD = 0.60;

export interface IdentificationResult {
  isOwner: boolean;
  ownerConfidence: number;
  matchedSpeaker: {
    speakerId: string;
    speakerName: string;
    confidence: number;
  } | null;
  isNewSpeaker: boolean;
  suggestions: Array<{
    speakerId: string;
    speakerName: string;
    confidence: number;
  }>;
}

// POST - Identify speaker from embedding
export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromHeader(request.headers.get('Authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await connectToDatabase();

    const body = await request.json();
    const { embedding } = body;

    if (!embedding || embedding.length !== 128) {
      return NextResponse.json({ 
        error: 'Invalid embedding: must be 128-dimensional' 
      }, { status: 400 });
    }

    const userId = new mongoose.Types.ObjectId(payload.userId);

    // Get all embeddings for this user
    const allEmbeddings = await VoiceEmbedding.find({ userId }).lean();

    if (allEmbeddings.length === 0) {
      return NextResponse.json({
        isOwner: false,
        ownerConfidence: 0,
        matchedSpeaker: null,
        isNewSpeaker: true,
        suggestions: [],
        needsOwnerEnrollment: true,
      } as IdentificationResult & { needsOwnerEnrollment: boolean });
    }

    // Calculate similarities with all known embeddings
    const similarities: Array<{
      speakerId: string;
      speakerName: string;
      isOwner: boolean;
      similarity: number;
    }> = [];

    for (const stored of allEmbeddings) {
      const similarity = cosineSimilarity(embedding, stored.embedding);
      similarities.push({
        speakerId: stored.speakerId,
        speakerName: stored.speakerName,
        isOwner: stored.isOwner,
        similarity,
      });
    }

    // Sort by similarity descending
    similarities.sort((a, b) => b.similarity - a.similarity);

    // Check owner match first
    const ownerMatch = similarities.find(s => s.isOwner);
    const isOwner = ownerMatch ? ownerMatch.similarity >= OWNER_THRESHOLD : false;
    const ownerConfidence = ownerMatch ? ownerMatch.similarity : 0;

    // Find best match
    const bestMatch = similarities[0];
    let matchedSpeaker = null;
    let isNewSpeaker = true;

    if (bestMatch && bestMatch.similarity >= KNOWN_SPEAKER_THRESHOLD) {
      matchedSpeaker = {
        speakerId: bestMatch.speakerId,
        speakerName: bestMatch.speakerName,
        confidence: bestMatch.similarity,
      };
      isNewSpeaker = false;
    }

    // Get possible matches for UI suggestions
    const suggestions = similarities
      .filter(s => s.similarity >= POSSIBLE_MATCH_THRESHOLD && s.similarity < KNOWN_SPEAKER_THRESHOLD)
      .slice(0, 3)
      .map(s => ({
        speakerId: s.speakerId,
        speakerName: s.speakerName,
        confidence: s.similarity,
      }));

    const result: IdentificationResult = {
      isOwner,
      ownerConfidence,
      matchedSpeaker,
      isNewSpeaker,
      suggestions,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error identifying speaker:', error);
    return NextResponse.json({ error: 'Failed to identify speaker' }, { status: 500 });
  }
}
