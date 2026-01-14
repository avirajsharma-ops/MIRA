// Voice Embedding API - Enroll and identify speakers by voice
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import connectToDatabase from '@/lib/mongodb';
import { VoiceEmbedding } from '@/models';
import mongoose from 'mongoose';

// POST - Enroll a new voice embedding or update existing
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
    const { 
      speakerId, 
      speakerName, 
      embedding, 
      mfccProfile, 
      isOwner = false,
      action = 'enroll' // 'enroll' | 'update' | 'merge'
    } = body;

    if (!speakerId || !embedding || embedding.length !== 128) {
      return NextResponse.json({ 
        error: 'Invalid data: speakerId and 128-dim embedding required' 
      }, { status: 400 });
    }

    const userId = new mongoose.Types.ObjectId(payload.userId);

    // Check if this is owner enrollment and one already exists
    if (isOwner) {
      const existingOwner = await VoiceEmbedding.findOne({ userId, isOwner: true });
      if (existingOwner && existingOwner.speakerId !== speakerId) {
        return NextResponse.json({ 
          error: 'Owner voice already enrolled. Use update action to modify.' 
        }, { status: 400 });
      }
    }

    let voiceEmbedding;

    if (action === 'merge') {
      // Merge with existing embedding (weighted average)
      const existing = await VoiceEmbedding.findOne({ userId, speakerId });
      if (existing) {
        const weight = existing.sampleCount / (existing.sampleCount + 1);
        const newWeight = 1 / (existing.sampleCount + 1);
        
        const mergedEmbedding = existing.embedding.map(
          (val: number, i: number) => val * weight + embedding[i] * newWeight
        );

        // Normalize the merged embedding
        const magnitude = Math.sqrt(mergedEmbedding.reduce((sum: number, v: number) => sum + v * v, 0));
        const normalizedEmbedding = mergedEmbedding.map((v: number) => v / magnitude);

        voiceEmbedding = await VoiceEmbedding.findOneAndUpdate(
          { userId, speakerId },
          { 
            embedding: normalizedEmbedding,
            mfccProfile: mfccProfile || existing.mfccProfile,
            speakerName: speakerName || existing.speakerName,
            sampleCount: existing.sampleCount + 1,
          },
          { new: true }
        );
      } else {
        // No existing, create new
        voiceEmbedding = await VoiceEmbedding.create({
          userId,
          speakerId,
          speakerName: speakerName || 'Unknown Speaker',
          embedding,
          mfccProfile: mfccProfile || getDefaultMFCCProfile(),
          isOwner,
          sampleCount: 1,
        });
      }
    } else if (action === 'update') {
      // Full replacement
      voiceEmbedding = await VoiceEmbedding.findOneAndUpdate(
        { userId, speakerId },
        { 
          embedding,
          mfccProfile: mfccProfile || getDefaultMFCCProfile(),
          speakerName: speakerName || 'Unknown Speaker',
          isOwner,
        },
        { new: true, upsert: true }
      );
    } else {
      // Standard enroll - create or update
      voiceEmbedding = await VoiceEmbedding.findOneAndUpdate(
        { userId, speakerId },
        { 
          embedding,
          mfccProfile: mfccProfile || getDefaultMFCCProfile(),
          speakerName: speakerName || 'Unknown Speaker',
          isOwner,
          $inc: { sampleCount: 1 },
        },
        { new: true, upsert: true }
      );
    }

    return NextResponse.json({
      success: true,
      voiceEmbedding: {
        speakerId: voiceEmbedding.speakerId,
        speakerName: voiceEmbedding.speakerName,
        isOwner: voiceEmbedding.isOwner,
        sampleCount: voiceEmbedding.sampleCount,
        createdAt: voiceEmbedding.createdAt,
        updatedAt: voiceEmbedding.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error enrolling voice embedding:', error);
    return NextResponse.json({ error: 'Failed to enroll voice' }, { status: 500 });
  }
}

// GET - Get all voice embeddings for the user
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const includeEmbeddings = searchParams.get('includeEmbeddings') === 'true';
    const ownerOnly = searchParams.get('ownerOnly') === 'true';

    const userId = new mongoose.Types.ObjectId(payload.userId);

    const query = ownerOnly 
      ? { userId, isOwner: true }
      : { userId };

    const projection = includeEmbeddings 
      ? {}
      : { embedding: 0 }; // Exclude large embedding arrays by default

    const embeddings = await VoiceEmbedding.find(query, projection)
      .sort({ isOwner: -1, createdAt: -1 })
      .lean();

    return NextResponse.json({
      embeddings: embeddings.map(e => ({
        speakerId: e.speakerId,
        speakerName: e.speakerName,
        isOwner: e.isOwner,
        sampleCount: e.sampleCount,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        ...(includeEmbeddings && { 
          embedding: e.embedding,
          mfccProfile: e.mfccProfile,
        }),
      })),
      hasOwner: embeddings.some(e => e.isOwner),
    });
  } catch (error) {
    console.error('Error getting voice embeddings:', error);
    return NextResponse.json({ error: 'Failed to get embeddings' }, { status: 500 });
  }
}

// DELETE - Remove a voice embedding
export async function DELETE(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const speakerId = searchParams.get('speakerId');

    if (!speakerId) {
      return NextResponse.json({ error: 'speakerId required' }, { status: 400 });
    }

    const userId = new mongoose.Types.ObjectId(payload.userId);

    const result = await VoiceEmbedding.deleteOne({ userId, speakerId });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Voice embedding not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting voice embedding:', error);
    return NextResponse.json({ error: 'Failed to delete embedding' }, { status: 500 });
  }
}

function getDefaultMFCCProfile() {
  return {
    mfccMeans: new Array(13).fill(0),
    mfccStds: new Array(13).fill(1),
    pitchMean: 150,
    pitchStd: 30,
    energyMean: 0.1,
    energyStd: 0.05,
    spectralCentroidMean: 2000,
    zeroCrossingRate: 0.1,
  };
}
