import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import FaceData from '@/models/FaceData';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import { compareForRecognition } from '@/lib/vision';
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

    const { action, imageBase64, personName, relationship, isOwner } = await request.json();

    if (action === 'register') {
      // Register a new face
      if (!imageBase64 || !personName) {
        return NextResponse.json(
          { error: 'Image and person name are required' },
          { status: 400 }
        );
      }

      // Check if person already exists
      const existing = await FaceData.findOne({
        userId: new mongoose.Types.ObjectId(payload.userId),
        personName: { $regex: new RegExp(`^${personName}$`, 'i') },
      });

      if (existing) {
        // Add new photo to existing record
        existing.photos.push({
          url: `data:image/jpeg;base64,${imageBase64}`,
          uploadedAt: new Date(),
          isPrimary: false,
        });
        existing.metadata.lastSeen = new Date();
        existing.metadata.seenCount += 1;
        await existing.save();

        return NextResponse.json({
          message: 'Photo added to existing face record',
          faceData: existing,
        });
      }

      // Create new face record
      const faceData = await FaceData.create({
        userId: new mongoose.Types.ObjectId(payload.userId),
        personName,
        relationship: relationship || 'unknown',
        faceDescriptor: [], // We'll use vision API for comparison instead
        photos: [
          {
            url: `data:image/jpeg;base64,${imageBase64}`,
            uploadedAt: new Date(),
            isPrimary: true,
          },
        ],
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

    if (action === 'recognize') {
      // Try to recognize a face
      if (!imageBase64) {
        return NextResponse.json(
          { error: 'Image is required' },
          { status: 400 }
        );
      }

      // Get all registered faces for this user
      const allFaces = await FaceData.find({
        userId: new mongoose.Types.ObjectId(payload.userId),
      });

      for (const face of allFaces) {
        const primaryPhoto = face.photos.find((p: { url: string; isPrimary: boolean }) => p.isPrimary) || face.photos[0];
        if (!primaryPhoto) continue;

        // Extract base64 from stored URL
        const storedBase64 = primaryPhoto.url.replace('data:image/jpeg;base64,', '');

        const result = await compareForRecognition(
          imageBase64,
          storedBase64,
          face.personName
        );

        if (result.isMatch && result.confidence >= 70) {
          // Update last seen
          face.metadata.lastSeen = new Date();
          face.metadata.seenCount += 1;
          await face.save();

          return NextResponse.json({
            recognized: true,
            person: {
              name: face.personName,
              relationship: face.relationship,
              isOwner: face.isOwner,
              seenCount: face.metadata.seenCount,
            },
            confidence: result.confidence,
          });
        }
      }

      return NextResponse.json({
        recognized: false,
        message: 'Face not recognized',
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

    const faces = await FaceData.find({
      userId: new mongoose.Types.ObjectId(payload.userId),
    }).select('personName relationship isOwner metadata');

    return NextResponse.json({ faces });
  } catch (error) {
    console.error('Get faces error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
