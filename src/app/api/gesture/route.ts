import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import { getGesturePrompt, GestureType } from '@/lib/gesture/gestureService';
import { chatWithGemini } from '@/lib/ai/gemini-chat';

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

    const { gesture, personName, personContext } = await request.json();

    if (!gesture) {
      return NextResponse.json({ error: 'Gesture is required' }, { status: 400 });
    }

    // Get the prompt for this gesture
    const promptData = getGesturePrompt(gesture as GestureType, personName, personContext);
    
    if (!promptData) {
      return NextResponse.json({ 
        error: 'Unknown gesture',
        gesture 
      }, { status: 400 });
    }

    // Determine which agent should respond
    const agent = promptData.responseStyle === 'auto' 
      ? (Math.random() > 0.5 ? 'mi' : 'ra')
      : promptData.responseStyle;

    // Generate response using Gemini with chatWithGemini
    const systemPrompt = agent === 'mi'
      ? `You are MI (pronounced "Me"), the emotional and empathetic female AI assistant in the MIRA system. 
         You are warm, caring, intuitive, and emotionally intelligent. You use expressive language and connect on a personal level.
         Keep responses very brief (1-2 sentences) for gesture responses.`
      : `You are RA (pronounced "Raa"), the logical and analytical male AI assistant in the MIRA system.
         You are precise, factual, efficient, and methodical. You focus on logic and clear information.
         Keep responses very brief (1-2 sentences) for gesture responses.`;

    const response = await chatWithGemini(
      promptData.prompt,
      [],
      {
        systemPrompt,
        maxTokens: 100,
        temperature: 0.7,
      }
    );

    console.log(`[Gesture API] ${gesture} -> ${agent}: ${response.text}`);

    return NextResponse.json({
      success: true,
      gesture,
      agent,
      response: response.text || "Hey there!",
      personName,
    });
  } catch (error) {
    console.error('Gesture API error:', error);
    return NextResponse.json(
      { error: 'Failed to process gesture' },
      { status: 500 }
    );
  }
}
