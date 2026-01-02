import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { MIRAAgent, ContextEngine } from '@/lib/agents';
import { detectAgentMention } from '@/lib/voice';
import Conversation from '@/models/Conversation';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import mongoose from 'mongoose';
import { getRecentTranscriptEntries } from '@/lib/transcription/transcriptionService';
import { unifiedSmartChat } from '@/lib/ai/gemini-chat';

// Check if message is simple and doesn't need heavy processing
function isSimpleMessage(message: string): boolean {
  const lower = message.toLowerCase().trim();
  
  // Remove agent mentions for checking
  const cleaned = lower.replace(/\b(hey |hi )?(mi|ra|mira|meera|mera|maya|myra)\b/gi, '').trim();
  
  const simplePatterns = [
    /^(hi|hey|hello|yo|sup|hola|howdy|hii+)[!?.,\s]*$/i,
    /^(good\s*(morning|afternoon|evening|night))[!?.,\s]*$/i,
    /^(how\s*are\s*you|what'?s\s*up|how'?s\s*it\s*going)[!?.,\s]*$/i,
    /^(thanks?|thank\s*you|thx|ty)[!?.,\s]*$/i,
    /^(bye|goodbye|see\s*you|later|cya)[!?.,\s]*$/i,
    /^(ok|okay|sure|yes|no|yeah|nope|yep|nah)[!?.,\s]*$/i,
    /^(cool|nice|great|awesome|perfect|good|fine)[!?.,\s]*$/i,
    /^(lol|haha|lmao|rofl)[!?.,\s]*$/i,
    /^(namaste|namaskar)[!?.,\s]*$/i,
  ];
  
  if (simplePatterns.some(p => p.test(cleaned) || p.test(lower))) {
    return true;
  }
  
  if (cleaned.length < 3) {
    return true;
  }
  
  return false;
}

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const token = getTokenFromHeader(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await connectToDatabase();

    const {
      message,
      conversationId,
      visualContext,
      location,
      dateTime,
      forceAgent, // Optional: force a specific agent
      proactive, // Flag for proactive checks
      sessionId, // Session ID for transcript context
    } = await request.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Skip proactive check messages - these are internal
    if (message === '[PROACTIVE_CHECK]' || proactive) {
      return NextResponse.json({ 
        response: { agent: 'system', content: '' },
        debate: [],
        conversationId: conversationId || null,
      });
    }

    // Handle unknown face introduction prompt (system message)
    const isUnknownFacePrompt = message.startsWith('[SYSTEM:') && message.includes('unknown person');
    if (isUnknownFacePrompt) {
      // Extract the context from the system message
      const contextMatch = message.match(/\[SYSTEM: ([^\]]+)\]/);
      const faceContext = contextMatch ? contextMatch[1] : 'An unknown person is visible';
      
      // Generate a friendly introduction from मी
      const contextEngine = new ContextEngine(payload.userId);
      const agentContext = {
        memories: [],
        recentMessages: [],
        currentTime: new Date(),
        userName: payload.name,
        userId: payload.userId,
      };
      
      const agent = new MIRAAgent(agentContext);
      const introResponse = await agent.getAgentResponse('mi', 
        `You notice someone new. ${faceContext} Introduce yourself warmly as मीरा and ask them their name. Be friendly and natural - don't mention cameras or images. Just greet them like you're meeting for the first time and ask who they are.`
      );
      
      return NextResponse.json({
        conversationId: conversationId || null,
        response: {
          agent: 'mi',
          content: introResponse.content,
          emotion: 'friendly',
        },
        debate: [],
        isIntroduction: true,
      });
    }

    // Get or create conversation
    let conversation;
    if (conversationId) {
      conversation = await Conversation.findOne({
        _id: conversationId,
        userId: payload.userId,
      });
    }

    if (!conversation) {
      conversation = await Conversation.create({
        userId: new mongoose.Types.ObjectId(payload.userId),
        title: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
        messages: [],
        isActive: true,
      });
    }

    // Check if this is a simple message - skip heavy context for fast response
    const simpleMsg = isSimpleMessage(message);

    // FAST PATH: For simple messages, skip all context fetching
    const contextEngine = new ContextEngine(payload.userId);
    
    // Run context fetching in PARALLEL for speed (only for non-simple messages)
    let memories: any[] = [];
    let recentTranscriptContext: string[] = [];
    
    if (!simpleMsg && sessionId) {
      // Parallel fetch - much faster than sequential
      const [memoriesResult, transcriptResult] = await Promise.all([
        contextEngine.getRelevantMemoriesFast(message, 5).catch(() => []),
        getRecentTranscriptEntries(payload.userId, sessionId, 20).catch(() => []),
      ]);
      
      memories = memoriesResult;
      if (transcriptResult.length > 0) {
        recentTranscriptContext = transcriptResult.map(entry => {
          const speakerLabel = entry.speaker.type === 'mira' 
            ? entry.speaker.name 
            : (entry.speaker.type === 'user' ? 'User' : entry.speaker.name);
          return `${speakerLabel}: ${entry.content}`;
        });
      }
    }

    // Build agent context with location and time awareness
    const agentContext = {
      memories,
      recentMessages: conversation.messages.slice(-15).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      // Include recent transcript as ambient context
      recentTranscript: recentTranscriptContext,
      visualContext: visualContext || undefined,
      // Location context
      location: location || undefined,
      // DateTime context - use provided or generate fresh
      dateTime: dateTime || {
        date: new Date().toISOString().split('T')[0],
        time: new Date().toTimeString().split(' ')[0],
        dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()],
        formattedDateTime: new Date().toLocaleString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }),
      },
      currentTime: new Date(),
      userName: payload.name,
      userId: payload.userId, // For face recognition
    };

    const agent = new MIRAAgent(agentContext);

    // Detect if user is addressing a specific agent
    const mentionedAgent = forceAgent || detectAgentMention(message);

    // Check for face save intent ONLY if message contains face-related keywords
    const faceSaveKeywords = /\b(save|remember|this is|meet|name is|called)\b.*\b(face|person|him|her|them|photo)\b|\b(face|person|him|her|them)\b.*\b(save|remember|name)\b/i;
    if (!simpleMsg && visualContext?.currentFrame && faceSaveKeywords.test(message)) {
      const faceSaveResult = await agent.handleFaceSaveIntent(
        message, 
        visualContext.currentFrame
      );
      
      if (faceSaveResult.saved || faceSaveResult.message) {
        // Face save was attempted - return the result
        const responseContent = faceSaveResult.message || `I've saved ${faceSaveResult.personName} to my memory!`;
        
        conversation.messages.push({
          role: 'user',
          content: message,
          timestamp: new Date(),
        });
        
        conversation.messages.push({
          role: 'mi',
          content: responseContent,
          timestamp: new Date(),
      });
      
      conversation.metadata.totalMessages = conversation.messages.length;
      conversation.metadata.userMessages += 1;
      conversation.metadata.miMessages += 1;
      
      await conversation.save();
      
      return NextResponse.json({
        conversationId: conversation._id,
        response: {
          agent: 'mi',
          content: responseContent,
        },
        faceSaved: faceSaveResult.saved,
        personName: faceSaveResult.personName,
      });
      }
    }

    let response;
    let debateMessages: { agent: string; content: string; emotion?: string }[] = [];

    // Build context string for unified chat
    const contextParts: string[] = [];
    
    // Add time/location
    const timeInfo = dateTime?.formattedDateTime || new Date().toLocaleString();
    contextParts.push(`Time: ${timeInfo}`);
    contextParts.push(`User: ${payload.name}`);
    
    if (location?.city) {
      contextParts.push(`Location: ${location.city}`);
    }
    
    // Add recent conversation (last 8 messages for speed + context)
    if (conversation.messages.length > 0) {
      const recentMsgs = conversation.messages.slice(-8).map((m: { role: string; content: string }) => 
        `${m.role === 'user' ? 'U' : m.role.toUpperCase()}: ${m.content.substring(0, 150)}`
      );
      contextParts.push(`Recent:\n${recentMsgs.join('\n')}`);
    }
    
    // Add memories if available (already limited to 5)
    if (memories.length > 0) {
      contextParts.push(`Memories: ${memories.slice(0, 3).map(m => m.content.substring(0, 100)).join('; ')}`);
    }
    
    const contextString = contextParts.join('\n');

    // Check if user explicitly mentioned an agent
    if (mentionedAgent === 'mi') {
      // User specifically wants MI - use direct call for speed
      response = await agent.getAgentResponse('mi', message);
    } else if (mentionedAgent === 'ra') {
      // User specifically wants RA
      response = await agent.getAgentResponse('ra', message);
    } else {
      // === UNIFIED SMART CHAT - Single AI call handles routing + response ===
      const unifiedResult = await unifiedSmartChat(
        message,
        contextString,
        conversation.messages.slice(-6).map((m: { role: string; content: string }) => ({
          role: m.role === 'user' ? 'user' as const : 'assistant' as const,
          content: m.content.substring(0, 200),
        }))
      );
      
      // Check if debate is needed (AI detected a dilemma/decision question)
      if (unifiedResult.needsDebate && unifiedResult.debateTopic) {
        console.log('[Chat] Debate triggered for:', unifiedResult.debateTopic);
        
        // Conduct debate between MI and RA
        const debateResult = await agent.conductDebate(unifiedResult.debateTopic);
        
        console.log('[Chat] Debate completed:', {
          messageCount: debateResult.messages.length,
          consensus: debateResult.consensus,
          finalAgent: debateResult.finalAgent,
          finalResponsePreview: debateResult.finalResponse?.substring(0, 50)
        });
        
        // Add debate messages (MI and RA discussing)
        debateMessages = debateResult.messages.map(msg => ({
          agent: msg.agent,
          content: msg.content,
          emotion: msg.emotion,
        }));
        
        // Final response from the debate (synthesized answer)
        response = {
          agent: debateResult.finalAgent || 'mira',
          content: debateResult.finalResponse || 'Based on our discussion, I think we can help you with this.',
          emotion: 'thoughtful',
          consensus: debateResult.consensus,
        };
      } else {
        // Direct response - no debate needed
        response = {
          agent: unifiedResult.agent,
          content: unifiedResult.content,
          emotion: unifiedResult.emotion,
        };
      }
    }

    // Store user message
    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    // Store debate messages if any
    for (const debateMsg of debateMessages) {
      conversation.messages.push({
        role: debateMsg.agent as 'mi' | 'ra',
        content: debateMsg.content,
        timestamp: new Date(),
        isDebate: true,
        emotion: debateMsg.emotion,
      });
    }

    // Store final response
    conversation.messages.push({
      role: response.agent as 'mi' | 'ra' | 'mira',
      content: response.content,
      timestamp: new Date(),
      emotion: 'emotion' in response ? response.emotion : undefined,
    });

    // Update metadata
    conversation.metadata.totalMessages = conversation.messages.length;
    conversation.metadata.userMessages += 1;
    if (response.agent === 'mi') conversation.metadata.miMessages += 1;
    if (response.agent === 'ra') conversation.metadata.raMessages += 1;
    if (debateMessages.length > 0) conversation.metadata.debateCount += 1;
    if ('consensus' in response && response.consensus) {
      conversation.metadata.consensusReached += 1;
    }

    await conversation.save();

    // Extract memories in background (fire and forget - don't block response)
    if (!simpleMsg) {
      const conversationText = `User: ${message}\nResponse: ${response.content}`;
      contextEngine.extractAndStoreMemories(conversationText, conversation._id.toString()).catch(() => {});
    }

    return NextResponse.json({
      conversationId: conversation._id,
      response: {
        agent: response.agent,
        content: response.content,
        emotion: 'emotion' in response ? response.emotion : undefined,
      },
      debate: debateMessages.length > 0 ? debateMessages : undefined,
      consensus: 'consensus' in response ? response.consensus : undefined,
    });
  } catch (error) {
    console.error('Chat error:', error);
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
    const conversationId = searchParams.get('conversationId');

    if (conversationId) {
      const conversation = await Conversation.findOne({
        _id: conversationId,
        userId: payload.userId,
      });

      if (!conversation) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }

      return NextResponse.json({ conversation });
    }

    // Return list of conversations
    const conversations = await Conversation.find({
      userId: payload.userId,
    })
      .select('title startedAt metadata isActive')
      .sort({ startedAt: -1 })
      .limit(50);

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
