import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase, dropCollections } from '@/lib/mongodb';

export async function POST(request: NextRequest) {
  try {
    const { confirm } = await request.json();

    if (confirm !== 'DROP_ALL_COLLECTIONS') {
      return NextResponse.json(
        { error: 'Confirmation required. Send { "confirm": "DROP_ALL_COLLECTIONS" }' },
        { status: 400 }
      );
    }

    await connectToDatabase();
    await dropCollections();

    return NextResponse.json({
      message: 'All collections dropped successfully. Database is now fresh.',
    });
  } catch (error) {
    console.error('Database init error:', error);
    return NextResponse.json(
      { error: 'Failed to initialize database' },
      { status: 500 }
    );
  }
}
