// People Check API - Check if a person exists by name
import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import FaceData from '@/models/FaceData';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

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
    const name = searchParams.get('name');

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    await connectToDatabase();

    // Check for exact match (case-insensitive)
    const exactMatch = await FaceData.findOne({
      userId: payload.userId,
      personName: { $regex: new RegExp(`^${name}$`, 'i') },
    });

    if (exactMatch) {
      return NextResponse.json({
        exists: true,
        isExactMatch: true,
        person: {
          id: exactMatch._id.toString(),
          name: exactMatch.personName,
          relationship: exactMatch.relationship,
          firstSeen: exactMatch.metadata.firstSeen,
          lastSeen: exactMatch.metadata.lastSeen,
          seenCount: exactMatch.metadata.seenCount,
        },
      });
    }

    // Check for similar names (fuzzy match)
    const similarPeople = await FaceData.find({
      userId: payload.userId,
      personName: { $regex: new RegExp(name.split(' ')[0], 'i') }, // Match first name
    }).limit(5);

    if (similarPeople.length > 0) {
      return NextResponse.json({
        exists: false,
        isExactMatch: false,
        similarPeople: similarPeople.map(p => ({
          id: p._id.toString(),
          name: p.personName,
          relationship: p.relationship,
        })),
      });
    }

    return NextResponse.json({ exists: false, isExactMatch: false });
  } catch (error) {
    console.error('Check person error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
