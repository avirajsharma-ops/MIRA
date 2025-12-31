import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import FaceData from '@/models/FaceData';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import mongoose from 'mongoose';

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

    // Parse request body ONCE - it can only be read once
    const body = await request.json();
    const { action, imageBase64, personName, relationship, isOwner, faceDescriptor, personId, embedding } = body;

    if (action === 'register') {
      // Register a new face with embedding from face-api.js
      if (!personName) {
        return NextResponse.json(
          { error: 'Person name is required' },
          { status: 400 }
        );
      }

      // Check if person already exists
      const existing = await FaceData.findOne({
        userId: new mongoose.Types.ObjectId(payload.userId),
        personName: { $regex: new RegExp(`^${personName}$`, 'i') },
      });

      if (existing) {
        // Update existing record with new embedding if provided
        if (faceDescriptor && Array.isArray(faceDescriptor) && faceDescriptor.length === 128) {
          existing.faceDescriptor = faceDescriptor;
        }
        if (imageBase64) {
          existing.photos.push({
            url: `data:image/jpeg;base64,${imageBase64}`,
            uploadedAt: new Date(),
            isPrimary: false,
          });
        }
        existing.metadata.lastSeen = new Date();
        existing.metadata.seenCount += 1;
        await existing.save();

        return NextResponse.json({
          message: 'Face record updated',
          faceData: existing,
        });
      }

      // Create new face record with embedding
      const faceData = await FaceData.create({
        userId: new mongoose.Types.ObjectId(payload.userId),
        personName,
        relationship: relationship || 'unknown',
        faceDescriptor: faceDescriptor || [], // 128-dim embedding from face-api.js
        photos: imageBase64 ? [
          {
            url: `data:image/jpeg;base64,${imageBase64}`,
            uploadedAt: new Date(),
            isPrimary: true,
          },
        ] : [],
        metadata: {
          firstSeen: new Date(),
          lastSeen: new Date(),
          seenCount: 1,
          notes: '',
        },
        isOwner: isOwner || false,
      });

      return NextResponse.json({
        message: 'Face registered successfully',
        faceData,
      });
    }

    if (action === 'update-embedding') {
      // Update face embedding for an existing person
      if (!personId || !embedding || !Array.isArray(embedding)) {
        return NextResponse.json(
          { error: 'Person ID and embedding array required' },
          { status: 400 }
        );
      }

      const face = await FaceData.findOne({
        _id: new mongoose.Types.ObjectId(personId),
        userId: new mongoose.Types.ObjectId(payload.userId),
      });

      if (!face) {
        return NextResponse.json({ error: 'Face not found' }, { status: 404 });
      }

      face.faceDescriptor = embedding;
      face.metadata.lastSeen = new Date();
      await face.save();

      return NextResponse.json({
        message: 'Embedding updated',
        faceData: face,
      });
    }

    if (action === 'update-last-seen') {
      // Update last seen timestamp for a person
      if (!personId) {
        return NextResponse.json({ error: 'Person ID required' }, { status: 400 });
      }

      const face = await FaceData.findOne({
        _id: new mongoose.Types.ObjectId(personId),
        userId: new mongoose.Types.ObjectId(payload.userId),
      });

      if (!face) {
        return NextResponse.json({ error: 'Face not found' }, { status: 404 });
      }

      face.metadata.lastSeen = new Date();
      face.metadata.seenCount += 1;
      await face.save();

      return NextResponse.json({
        message: 'Last seen updated',
        faceData: face,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Face API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

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

    // Get embeddings flag from query params
    const { searchParams } = new URL(request.url);
    const includeEmbeddings = searchParams.get('embeddings') === 'true';

    const faces = await FaceData.find({
      userId: new mongoose.Types.ObjectId(payload.userId),
    }).select(includeEmbeddings 
      ? 'personName relationship isOwner metadata faceDescriptor' 
      : 'personName relationship isOwner metadata'
    );

    // Format response with embeddings if requested
    const formattedFaces = faces.map(face => ({
      personId: face._id.toString(),
      personName: face.personName,
      relationship: face.relationship,
      isOwner: face.isOwner,
      metadata: face.metadata,
      ...(includeEmbeddings && face.faceDescriptor?.length > 0 && {
        embedding: face.faceDescriptor,
      }),
    }));

    return NextResponse.json({ faces: formattedFaces });
  } catch (error) {
    console.error('Get faces error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
