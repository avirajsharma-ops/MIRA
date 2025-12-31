import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { ContextEngine } from '@/lib/agents';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

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

    const { content, type, importance, tags, source } = await request.json();

    if (!content || !type) {
      return NextResponse.json(
        { error: 'Content and type are required' },
        { status: 400 }
      );
    }

    const contextEngine = new ContextEngine(payload.userId);
    const memory = await contextEngine.addMemory({
      userId: payload.userId,
      content,
      type,
      importance,
      tags,
      source: source || 'user',
    });

    return NextResponse.json({
      message: 'Memory stored successfully',
      memory,
    });
  } catch (error) {
    console.error('Memory store error:', error);
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

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const type = searchParams.get('type');

    const contextEngine = new ContextEngine(payload.userId);

    let memories;
    if (query) {
      memories = await contextEngine.searchMemories(query);
    } else if (type) {
      memories = await contextEngine.getMemoriesByType(type as any);
    } else {
      memories = await contextEngine.getAllMemoriesForContext();
    }

    return NextResponse.json({ memories });
  } catch (error) {
    console.error('Memory get error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
