import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import mongoose from 'mongoose';

/**
 * API to create vector search index for MongoDB Atlas
 * 
 * POST /api/memory/vector-index - Create the vector search index
 * GET /api/memory/vector-index - Check if index exists
 * 
 * Note: This requires MongoDB Atlas M10 or higher tier
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
    const db = mongoose.connection.db;

    if (!db) {
      return NextResponse.json({ 
        error: 'Database not connected',
        vectorSearchAvailable: false,
      });
    }

    // Check if we're on MongoDB Atlas
    const mongoUri = process.env.MONGODB_URI || '';
    const isAtlas = mongoUri.includes('mongodb+srv://') || mongoUri.includes('mongodb.net');

    // Try to list indexes
    try {
      const indexes = await db.collection('memories').listSearchIndexes().toArray();
      const vectorIndex = indexes.find((idx: { name?: string }) => idx.name === 'memory_vector_index');

      return NextResponse.json({
        isAtlas,
        vectorSearchAvailable: !!vectorIndex,
        indexes: indexes.map((idx: { name?: string; type?: string }) => ({ name: idx.name, type: idx.type })),
        message: vectorIndex 
          ? 'Vector search index is ready' 
          : 'Vector search index not found. Create it in MongoDB Atlas console.',
      });
    } catch {
      return NextResponse.json({
        isAtlas,
        vectorSearchAvailable: false,
        message: 'Could not check indexes. You may need MongoDB Atlas M10+ for vector search.',
      });
    }
  } catch (error) {
    console.error('[Vector Index] Check error:', error);
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
    const db = mongoose.connection.db;

    if (!db) {
      return NextResponse.json({ 
        error: 'Database not connected' 
      }, { status: 500 });
    }

    // Try to create the vector search index
    // Note: This may fail if not on Atlas M10+ or if index already exists
    try {
      await db.collection('memories').createSearchIndex({
        name: 'memory_vector_index',
        definition: {
          mappings: {
            dynamic: true,
            fields: {
              embedding: {
                dimensions: 1536,
                similarity: 'cosine',
                type: 'knnVector',
              },
              userId: {
                type: 'objectId',
              },
              isArchived: {
                type: 'boolean',
              },
            },
          },
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Vector search index created successfully',
      });
    } catch (createError: unknown) {
      const errorMessage = createError instanceof Error ? createError.message : 'Unknown error';
      
      // Check if index already exists
      if (errorMessage.includes('already exists')) {
        return NextResponse.json({
          success: true,
          message: 'Vector search index already exists',
        });
      }

      // Likely not on Atlas M10+
      return NextResponse.json({
        success: false,
        error: 'Failed to create vector search index',
        details: errorMessage,
        instructions: `
To enable vector search, you need MongoDB Atlas M10 or higher tier.
You can create the index manually in Atlas:

1. Go to MongoDB Atlas console
2. Navigate to your cluster > Search > Create Search Index
3. Use this JSON configuration:

{
  "name": "memory_vector_index",
  "mappings": {
    "dynamic": true,
    "fields": {
      "embedding": {
        "dimensions": 1536,
        "similarity": "cosine",
        "type": "knnVector"
      },
      "userId": {
        "type": "objectId"
      },
      "isArchived": {
        "type": "boolean"
      }
    }
  }
}
        `.trim(),
      }, { status: 400 });
    }
  } catch (error) {
    console.error('[Vector Index] Create error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
