import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import UnknownPerson from '@/models/UnknownPerson';
import Person from '@/models/Person';
import mongoose from 'mongoose';
import {
  getUnknownPeopleToAskAbout,
  markAskedAboutPerson,
  identifyUnknownPerson,
  generateQuestionAboutPerson,
} from '@/lib/people/nameDetection';

/**
 * API for managing unknown people
 * 
 * GET /api/unknown-people - Get list of unknown people
 * GET /api/unknown-people?action=ask - Get people to ask about with generated questions
 * POST /api/unknown-people - Identify an unknown person (provide description)
 * DELETE /api/unknown-people?id=xxx - Delete/dismiss an unknown person
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

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const status = searchParams.get('status') || 'unknown';

    // Get people to ask about
    if (action === 'ask') {
      const peopleToAsk = await getUnknownPeopleToAskAbout(payload.userId, 3);
      
      const questionsAndPeople = peopleToAsk.map(person => ({
        id: person._id.toString(),
        name: person.name,
        mentionCount: person.mentionCount,
        contexts: person.contexts.slice(-3),
        possibleRelationships: person.possibleRelationships,
        question: generateQuestionAboutPerson(person),
      }));

      return NextResponse.json({
        peopleToAsk: questionsAndPeople,
        count: questionsAndPeople.length,
      });
    }

    // Get all unknown people
    const unknownPeople = await UnknownPerson.find({
      userId: new mongoose.Types.ObjectId(payload.userId),
      status: status as 'unknown' | 'pending' | 'identified',
    })
      .sort({ mentionCount: -1, lastMentionedAt: -1 })
      .limit(50)
      .lean();

    return NextResponse.json({
      unknownPeople,
      count: unknownPeople.length,
    });
  } catch (error) {
    console.error('[UnknownPeople] GET error:', error);
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

    const { unknownPersonId, description, relationship, markAsked } = await request.json();

    // Just mark as asked (MIRA asked about them)
    if (markAsked && unknownPersonId) {
      await markAskedAboutPerson(unknownPersonId);
      return NextResponse.json({ success: true, message: 'Marked as asked' });
    }

    // Identify the person
    if (!unknownPersonId || !description) {
      return NextResponse.json(
        { error: 'unknownPersonId and description are required' },
        { status: 400 }
      );
    }

    const newPersonId = await identifyUnknownPerson(unknownPersonId, description, relationship);

    if (!newPersonId) {
      return NextResponse.json(
        { error: 'Unknown person not found' },
        { status: 404 }
      );
    }

    const newPerson = await Person.findById(newPersonId);

    return NextResponse.json({
      success: true,
      message: 'Person identified and added to people library',
      person: newPerson,
    });
  } catch (error) {
    console.error('[UnknownPeople] POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

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

    await connectToDatabase();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      );
    }

    const result = await UnknownPerson.deleteOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(payload.userId),
    });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'Unknown person not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, message: 'Unknown person dismissed' });
  } catch (error) {
    console.error('[UnknownPeople] DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
