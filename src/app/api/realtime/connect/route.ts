import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

// Server-side proxy for WebRTC SDP exchange with OpenAI Realtime API
// This avoids CORS issues when connecting from the browser

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

    const { sdp, client_secret } = await request.json();

    if (!sdp || !client_secret) {
      return NextResponse.json({ error: 'SDP and client_secret required' }, { status: 400 });
    }

    // Proxy the SDP offer to OpenAI's Realtime API
    const baseUrl = 'https://api.openai.com/v1/realtime';
    const model = 'gpt-4o-realtime-preview-2024-12-17';

    const response = await fetch(`${baseUrl}?model=${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${client_secret}`,
        'Content-Type': 'application/sdp',
      },
      body: sdp,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Realtime Connect] SDP exchange failed:', response.status, errorText);
      return NextResponse.json(
        { error: 'SDP exchange failed', details: errorText },
        { status: response.status }
      );
    }

    const answerSdp = await response.text();
    
    console.log('[Realtime Connect] SDP exchange successful for user:', payload.userId);

    return new NextResponse(answerSdp, {
      status: 200,
      headers: {
        'Content-Type': 'application/sdp',
      },
    });
  } catch (error) {
    console.error('[Realtime Connect] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
