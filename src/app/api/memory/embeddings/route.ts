import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import Memory from '@/models/Memory';
import mongoose from 'mongoose';
import { generateEmbeddings } from '@/lib/ai/embeddings';

/**
 * API to generate embeddings for existing memories that don't have them
 * This is used to backfill embeddings for older memories
 * 
 * POST /api/memory/embeddings - Generate embeddings for memories without them
 * GET /api/memory/embeddings - Get stats on embedding coverage
 */

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

    await connectToDatabase();

    // Get stats
    const userId = new mongoose.Types.ObjectId(payload.userId);
    
    const [total, withEmbedding, withoutEmbedding] = await Promise.all([
      Memory.countDocuments({ userId }),
      Memory.countDocuments({ userId, embedding: { $exists: true, $ne: [] } }),
      Memory.countDocuments({ userId, $or: [{ embedding: { $exists: false } }, { embedding: [] }] }),
    ]);

    return NextResponse.json({
      total,
      withEmbedding,
      withoutEmbedding,
      coveragePercent: total > 0 ? Math.round((withEmbedding / total) * 100) : 0,
    });
  } catch (error) {
    console.error('[Memory Embeddings] Stats error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

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

    await connectToDatabase();

    const { batchSize = 50 } = await request.json().catch(() => ({}));
    const userId = new mongoose.Types.ObjectId(payload.userId);

    // Find memories without embeddings
    const memoriesWithoutEmbeddings = await Memory.find({
      userId,
      $or: [{ embedding: { $exists: false } }, { embedding: [] }],
    })
      .limit(Math.min(batchSize, 100))
      .lean();

    if (memoriesWithoutEmbeddings.length === 0) {
      return NextResponse.json({
        message: 'All memories have embeddings',
        processed: 0,
      });
    }

    // Generate embeddings in batch
    const texts = memoriesWithoutEmbeddings.map(m => m.content);
    const embeddings = await generateEmbeddings(texts);

    // Update memories with embeddings
    const bulkOps = memoriesWithoutEmbeddings.map((mem, index) => ({
      updateOne: {
        filter: { _id: mem._id },
        update: { $set: { embedding: embeddings[index] } },
      },
    }));

    const result = await Memory.bulkWrite(bulkOps);

    console.log(`[Memory Embeddings] Generated ${embeddings.length} embeddings for user ${payload.userId}`);

    return NextResponse.json({
      message: 'Embeddings generated',
      processed: result.modifiedCount,
      remaining: await Memory.countDocuments({
        userId,
        $or: [{ embedding: { $exists: false } }, { embedding: [] }],
      }),
    });
  } catch (error) {
    console.error('[Memory Embeddings] Generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
