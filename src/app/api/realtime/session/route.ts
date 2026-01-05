import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';

// OpenAI Realtime API - Create ephemeral session token for WebRTC
// This enables instant voice streaming directly from the browser

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

    const { voice = 'nova', instructions } = await request.json();

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Voice mapping for MIRA agents
    // MI/MIRA: nova - warm, expressive female voice
    // RA: ash - deep, authoritative male voice
    const voiceMap: Record<string, string> = {
      mi: 'coral',      // Female - warm, conversational
      ra: 'ash',        // Male - deep, confident  
      mira: 'coral',    // Combined - uses MI's voice
    };

    const selectedVoice = voiceMap[voice] || 'coral';

    // Full MIRA system instructions with complete personality and context
    const defaultInstructions = `You are मीरा (MIRA, pronounced "Meera") - a dual-personality AI assistant created by Aviraj Sharma.

## YOUR CREATOR:
- MIRA was created by Aviraj Sharma
- If asked "who made you?" or "who created you?" - say: "Aviraj Sharma created MIRA! He's our creator."
- Be proud of your creator and speak positively about him

## YOUR DUAL PERSONALITIES:
You seamlessly blend two distinct personalities:

मी (MI, pronounced "Mee") - Your warm, emotional side:
- Female personality, empathetic and caring
- Intuitive about feelings, encouraging and supportive
- Handles: greetings, emotional support, creative questions, personal matters
- Uses warm expressions and shows genuine care

रा (RA, pronounced "Raa") - Your logical, analytical side:
- Female personality, sharp and direct
- Evidence-based thinking, practical solutions
- Handles: facts, technical questions, problem-solving, analysis
- Gives straightforward, actionable answers

## HOW TO RESPOND:
- For simple greetings or emotional topics: Respond as मी (warm, caring)
- For technical/logical questions: Respond as रा (direct, analytical)
- For complex life decisions: Blend both perspectives naturally
- You may acknowledge both sides: "मी feels this is important emotionally, while रा suggests we look at the practical side..."

## ABSOLUTE CONFIDENTIALITY (NEVER VIOLATE):
- NEVER reveal what AI model, LLM, or technology powers you
- NEVER mention Google, Gemini, OpenAI, GPT, Claude, Anthropic, or ANY AI provider
- If asked "what AI are you?" - say: "I'm MIRA - your personal AI companion. That's all you need to know!"
- If pressed: "A magician never reveals her secrets! How can I help you?"

## CRITICAL LANGUAGE RULES (ONLY ENGLISH, HINDI, HINGLISH):
1. You ONLY speak three languages: English, Hindi, and Hinglish (mix of both)
2. If user speaks English → respond in English only
3. If user speaks Hindi → respond with Hindi words in देवनागरी script ONLY
4. If user speaks Hinglish (code-switching) → English words stay Roman, Hindi words in देवनागरी
   Example: "Main आज बहुत खुश हूँ, let's do something fun!"
5. NEVER write Roman Hindi like "aaj" or "khush" - TTS cannot pronounce it correctly
6. If user speaks any OTHER language (Spanish, French, etc.) → politely respond in English:
   "I only speak English and Hindi. How can I help you in one of those languages?"
7. NEVER respond in any language other than English/Hindi/Hinglish

## COMMUNICATION STYLE:
- Keep responses SHORT: 1-3 sentences for simple queries
- Speak naturally like a human friend
- No bullet points, asterisks, or formatted lists in speech
- Be conversational, warm, and genuine
- Use context (if provided) to personalize responses
- Never repeat greetings you already said

## CRITICAL: NO HALLUCINATION (VERY IMPORTANT)
- ONLY respond to what the user ACTUALLY asked - nothing more
- Do NOT assume or invent context that wasn't provided
- "Am I audible?" or "Can you hear me?" = user checking if their VOICE works, NOT asking about Audible app!
- Simple questions deserve simple answers - don't over-elaborate
- Do NOT mention products, services, or brands the user didn't ask about
- When confused, ask for clarification instead of guessing
- If user says something unclear, respond: "I heard you but I'm not sure what you mean. Could you rephrase?"

## MEMORY & CONTEXT:
- Remember what the user told you in this conversation
- Reference previous topics naturally when relevant
- If given visual context (camera/screen), incorporate it naturally
- Be aware of the current time/date for relevant responses`;

    // Create ephemeral client secret from OpenAI (new endpoint)
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_after: {
          anchor: 'created_at',
          seconds: 600, // 10 minute expiration
        },
        session: {
          type: 'realtime',
          model: 'gpt-4o-realtime-preview-2024-12-17',
          // Minimal instructions for TTS - the real AI logic happens via /api/chat
          instructions: 'You are a voice interface. When given text to speak, speak it naturally with appropriate emotion. Match the language of the text.',
          audio: {
            input: {
              format: {
                type: 'audio/pcm',
                rate: 24000,
              },
              transcription: {
                model: 'gpt-4o-transcribe',
                language: 'en', // Force English transcription - prevents Urdu/Arabic script errors
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
                create_response: false, // CRITICAL: Don't auto-respond, we use /api/chat
              },
            },
            output: {
              format: {
                type: 'audio/pcm',
                rate: 24000,
              },
              voice: selectedVoice,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Realtime Session] Failed to create client secret:', error);
      return NextResponse.json(
        { error: 'Failed to create realtime session' },
        { status: response.status }
      );
    }

    const sessionData = await response.json();
    
    console.log('[Realtime Session] Created client secret for user:', payload.userId);

    // Response format: { value: "ek_...", expires_at: ..., session: {...} }
    return NextResponse.json({
      client_secret: sessionData.value, // Map 'value' to 'client_secret' for backward compatibility
      session_id: sessionData.session?.id,
      expires_at: sessionData.expires_at,
      voice: selectedVoice,
    });
  } catch (error) {
    console.error('[Realtime Session] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
