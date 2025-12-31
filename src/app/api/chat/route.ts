import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { MIRAAgent, ContextEngine } from '@/lib/agents';
import { detectAgentMention } from '@/lib/voice';
import Conversation from '@/models/Conversation';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import mongoose from 'mongoose';
import { getRecentTranscriptEntries } from '@/lib/transcription/transcriptionService';

// Check if message is simple and doesn't need debate
function checkSimpleMessage(message: string): boolean {
  const lower = message.toLowerCase().trim();
  
  // Remove agent mentions for checking (including common transcription errors)
  const cleaned = lower.replace(/\b(hey |hi )?(mi|ra|mira|meera|mera|maya|myra)\b/gi, '').trim();
  
  const simplePatterns = [
    /^(hi|hey|hello|yo|sup|hola|howdy|hii+)[!?.,\s]*$/i,
    /^(good\s*(morning|afternoon|evening|night))[!?.,\s]*$/i,
    /^(how\s*are\s*you|what'?s\s*up|how'?s\s*it\s*going|how\s*do\s*you\s*do|kaise\s*ho)[!?.,\s]*$/i,
    /^(thanks?|thank\s*you|thx|ty|shukriya|dhanyawad)[!?.,\s]*$/i,
    /^(bye|goodbye|see\s*you|later|cya|bye\s*bye|alvida)[!?.,\s]*$/i,
    /^(ok|okay|sure|yes|no|yeah|nope|yep|nah|yup|haan|nahi)[!?.,\s]*$/i,
    /^(cool|nice|great|awesome|perfect|good|fine|alright|accha|theek)[!?.,\s]*$/i,
    /^\[gesture\]/i,
    /^nothing[!?.,\s]*$/i,
    /^(lol|haha|lmao|rofl)[!?.,\s]*$/i,
    /^(namaste|namaskar)[!?.,\s]*$/i,
  ];
  
  // Check patterns on cleaned message
  if (simplePatterns.some(p => p.test(cleaned) || p.test(lower))) {
    return true;
  }
  
  // Also check if original message is very short after cleaning (likely just wake word + greeting)
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
    const isSimpleMessage = checkSimpleMessage(message);

    // Get context (skip memory fetching for simple messages - they don't need it)
    const contextEngine = new ContextEngine(payload.userId);
    const memories = isSimpleMessage ? [] : await contextEngine.getRelevantMemories(message);

    // Get recent transcript entries for background conversation context
    // Skip for simple messages to reduce latency
    let recentTranscriptContext: string[] = [];
    if (sessionId && !isSimpleMessage) {
      try {
        const recentEntries = await getRecentTranscriptEntries(payload.userId, sessionId, 15);
        if (recentEntries.length > 0) {
          // Format transcript entries as context (include both directed and non-directed)
          recentTranscriptContext = recentEntries.map(entry => {
            const speakerLabel = entry.speaker.type === 'mira' 
              ? entry.speaker.name 
              : (entry.speaker.type === 'user' ? 'User' : entry.speaker.name);
            const directedMarker = entry.isDirectedAtMira ? '' : ' (background)';
            return `${speakerLabel}${directedMarker}: ${entry.content}`;
          });
        }
      } catch (err) {
        console.error('Error fetching transcript context:', err);
      }
    }

    // Build agent context with location and time awareness
    const agentContext = {
      memories,
      recentMessages: conversation.messages.slice(-10).map((m: { role: string; content: string }) => ({
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

    // Check for face save intent (skip for simple messages)
    if (!isSimpleMessage) {
      const faceSaveResult = await agent.handleFaceSaveIntent(
        message, 
        visualContext?.currentFrame // base64 image from camera
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

    if (mentionedAgent === 'mi') {
      // User specifically wants MI
      response = await agent.getAgentResponse('mi', message);
    } else if (mentionedAgent === 'ra') {
      // User specifically wants RA
      response = await agent.getAgentResponse('ra', message);
    } else if (mentionedAgent === 'mira' && !isSimpleMessage) {
      // User wants both to discuss - but ONLY for complex messages
      // Simple messages like "hey mira" should just get a single response
      const debateResult = await agent.conductDebate(message);
      debateMessages = debateResult.messages;
      response = {
        agent: debateResult.finalAgent,
        content: debateResult.finalResponse,
        consensus: debateResult.consensus,
      };
    } else if (isSimpleMessage || mentionedAgent === 'mira') {
      // Simple message OR mira greeting - just have MI respond warmly
      response = await agent.getAgentResponse('mi', message);
    } else {
      // Use intermediator to decide which agent should respond
      const routedAgent = await agent.routeToAgent(message);
      
      if (routedAgent === 'both') {
        // Complex topic needing both perspectives - dynamic debate
        const debateResult = await agent.conductDebate(message);
        debateMessages = debateResult.messages;
        response = {
          agent: debateResult.finalAgent,
          content: debateResult.finalResponse,
          consensus: debateResult.consensus,
        };
      } else {
        // Single agent response based on sentiment
        response = await agent.getAgentResponse(routedAgent, message);
        
        // Check if the response analysis suggests a debate is needed
        if (response.shouldDebate) {
          console.log('=== DEBATE TRIGGERED ===');
          console.log('Message:', message);
          console.log('Initial agent:', routedAgent);
          console.log('shouldDebate:', response.shouldDebate);
          
          const debateResult = await agent.conductDebate(message);
          console.log('Debate messages count:', debateResult.messages.length);
          console.log('Debate consensus:', debateResult.consensus);
          
          debateMessages = debateResult.messages;
          response = {
            agent: debateResult.finalAgent,
            content: debateResult.finalResponse,
            consensus: debateResult.consensus,
            shouldDebate: true,
          };
        }
      }
    }

    // Store user message
    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
      visualContext: visualContext
        ? {
            hasCamera: !!visualContext.cameraDescription,
            hasScreen: !!visualContext.screenDescription,
            detectedFaces: visualContext.detectedFaces || [],
            screenDescription: visualContext.screenDescription,
          }
        : undefined,
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

    // Extract and store any memories from this exchange
    const conversationText = `User: ${message}\nResponse: ${response.content}`;
    await contextEngine.extractAndStoreMemories(conversationText, conversation._id.toString());

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
