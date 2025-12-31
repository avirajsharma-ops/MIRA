import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import FaceData from '@/models/FaceData';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import mongoose from 'mongoose';

// Check if owner face is registered
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

    // Check if owner face exists
    const ownerFace = await FaceData.findOne({
      userId: new mongoose.Types.ObjectId(payload.userId),
      isOwner: true,
    });

    return NextResponse.json({
      hasOwnerFace: !!ownerFace,
      ownerName: ownerFace?.personName || null,
    });
  } catch (error) {
    console.error('Check owner face error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
