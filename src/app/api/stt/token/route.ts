import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

// Generate a temporary Deepgram API key for client-side WebSocket connection
// This avoids exposing the main API key to the browser
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

    const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

    if (!DEEPGRAM_API_KEY) {
      // Fall back to returning null - client will use Web Speech API
      return NextResponse.json({ 
        apiKey: null, 
        message: 'Deepgram not configured - using browser STT' 
      });
    }

    // Return the API key directly for WebSocket connection
    // In production, you might want to create temporary keys via Deepgram's API
    return NextResponse.json({ 
      apiKey: DEEPGRAM_API_KEY,
      model: process.env.DEEPGRAM_MODEL || 'nova-2',
    });
  } catch (error) {
    console.error('STT token error:', error);
    return NextResponse.json(
      { error: 'Failed to get STT token' },
      { status: 500 }
    );
  }
}
