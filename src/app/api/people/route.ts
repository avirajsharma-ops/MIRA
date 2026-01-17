import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import Person from '@/models/Person';
import mongoose from 'mongoose';

// GET - List all people for the user
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
    const search = searchParams.get('search');

    let query: any = { userId: new mongoose.Types.ObjectId(payload.userId) };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { relationship: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
      ];
    }

    const people = await Person.find(query)
      .sort({ name: 1 })
      .limit(100)
      .lean();

    return NextResponse.json({ people });
  } catch (error) {
    console.error('Get people error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create a new person
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

    const { name, description, relationship, tags } = await request.json();

    if (!name || !description) {
      return NextResponse.json(
        { error: 'Name and description are required' },
        { status: 400 }
      );
    }

    // Check if person with same name already exists
    const existing = await Person.findOne({
      userId: new mongoose.Types.ObjectId(payload.userId),
      name: { $regex: `^${name}$`, $options: 'i' },
    });

    if (existing) {
      // Update existing person
      existing.description = description;
      if (relationship) existing.relationship = relationship;
      if (tags) existing.tags = tags;
      await existing.save();
      
      return NextResponse.json({
        message: 'Person updated',
        person: existing,
        updated: true,
      });
    }

    // Create new person
    const person = await Person.create({
      userId: new mongoose.Types.ObjectId(payload.userId),
      name: name.trim(),
      description: description.trim(),
      relationship: relationship?.trim(),
      tags: tags || [],
    });

    return NextResponse.json({
      message: 'Person created',
      person,
      updated: false,
    });
  } catch (error) {
    console.error('Create person error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
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

    await connectToDatabase();

    const { searchParams } = new URL(request.url);
    const personId = searchParams.get('id');

    if (!personId) {
      return NextResponse.json(
        { error: 'Person ID is required' },
        { status: 400 }
      );
    }

    const result = await Person.deleteOne({
      _id: new mongoose.Types.ObjectId(personId),
      userId: new mongoose.Types.ObjectId(payload.userId),
    });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'Person not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: 'Person deleted' });
  } catch (error) {
    console.error('Delete person error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
