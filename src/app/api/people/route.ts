// People API - CRUD for known people/faces
import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import FaceData from '@/models/FaceData';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import {
  savePerson,
  getKnownPeople,
  deletePerson,
  updatePersonContext,
  addLearnedInfo,
} from '@/lib/face/faceRecognition';

// GET - List all known people for the user
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

    const people = await getKnownPeople(payload.userId);

    return NextResponse.json({
      people: people.map(p => ({
        id: p._id.toString(),
        name: p.personName,
        relationship: p.relationship,
        distinctiveFeatures: p.distinctiveFeatures,
        context: p.metadata.context,
        notes: p.metadata.notes,
        learnedInfo: p.metadata.learnedInfo,
        firstSeen: p.metadata.firstSeen,
        lastSeen: p.metadata.lastSeen,
        seenCount: p.metadata.seenCount,
        isOwner: p.isOwner,
      })),
    });
  } catch (error) {
    console.error('Get people error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Add a new person (supports both face-based and voice-based detection)
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
    const { name, imageBase64, relationship, context, conversationContext, source, firstMet } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    await connectToDatabase();

    // Check if person with this name already exists
    const existingPerson = await FaceData.findOne({
      userId: payload.userId,
      personName: { $regex: new RegExp(`^${name}$`, 'i') },
    });

    if (existingPerson) {
      // Update existing person with new context
      existingPerson.metadata.lastSeen = new Date();
      existingPerson.metadata.seenCount += 1;
      
      // Add conversation context to learned info
      if (conversationContext) {
        const contextSummary = `[${new Date().toLocaleDateString()}] Said: "${conversationContext.slice(0, 200)}${conversationContext.length > 200 ? '...' : ''}"`;
        existingPerson.metadata.learnedInfo.push(contextSummary);
        
        // Keep only last 20 learned items
        if (existingPerson.metadata.learnedInfo.length > 20) {
          existingPerson.metadata.learnedInfo = existingPerson.metadata.learnedInfo.slice(-20);
        }
      }
      
      await existingPerson.save();
      
      return NextResponse.json({
        success: true,
        isNew: false,
        person: {
          id: existingPerson._id.toString(),
          name: existingPerson.personName,
          relationship: existingPerson.relationship,
        },
      });
    }

    // If we have an image, use the face-based save function
    if (imageBase64) {
      const person = await savePerson(
        payload.userId,
        name,
        imageBase64,
        relationship || 'unknown',
        context || ''
      );

      if (!person) {
        return NextResponse.json(
          { error: 'Failed to save person' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        isNew: true,
        person: {
          id: person._id.toString(),
          name: person.personName,
          relationship: person.relationship,
          distinctiveFeatures: person.distinctiveFeatures,
          context: person.metadata.context,
        },
      });
    }
    
    // Voice-based detection (no image)
    const person = new FaceData({
      userId: payload.userId,
      personName: name,
      relationship: relationship || 'unknown',
      metadata: {
        firstSeen: firstMet || new Date(),
        lastSeen: new Date(),
        seenCount: 1,
        notes: source === 'voice_detection' ? 'Detected via voice in conversation' : '',
        context: context || '',
        learnedInfo: conversationContext 
          ? [`[${new Date().toLocaleDateString()}] Said: "${conversationContext.slice(0, 200)}${conversationContext.length > 200 ? '...' : ''}"`]
          : [],
      },
      isOwner: false,
    });

    await person.save();

    return NextResponse.json({
      success: true,
      isNew: true,
      person: {
        id: person._id.toString(),
        name: person.personName,
        relationship: person.relationship,
      },
    });
  } catch (error) {
    console.error('Add person error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH - Update a person
export async function PATCH(request: NextRequest) {
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
    const { personId, name, relationship, context, notes, learnedInfo } = body;

    if (!personId) {
      return NextResponse.json({ error: 'Person ID is required' }, { status: 400 });
    }

    await connectToDatabase();

    // Verify ownership
    const person = await FaceData.findOne({
      _id: personId,
      userId: payload.userId,
    });

    if (!person) {
      return NextResponse.json({ error: 'Person not found' }, { status: 404 });
    }

    // Update fields
    const updates: Record<string, unknown> = {};
    if (name) updates.personName = name;
    if (relationship) updates.relationship = relationship;
    if (context !== undefined) updates['metadata.context'] = context;
    if (notes !== undefined) updates['metadata.notes'] = notes;

    await FaceData.findByIdAndUpdate(personId, { $set: updates });

    // Add learned info if provided
    if (learnedInfo) {
      await addLearnedInfo(personId, learnedInfo);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update person error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Remove a person
export async function DELETE(request: NextRequest) {
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
    const personId = searchParams.get('personId');

    if (!personId) {
      return NextResponse.json({ error: 'Person ID is required' }, { status: 400 });
    }

    await connectToDatabase();

    const success = await deletePerson(personId, payload.userId);

    if (!success) {
      return NextResponse.json({ error: 'Person not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete person error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
