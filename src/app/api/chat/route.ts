import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { MIRAAgent, ContextEngine } from '@/lib/agents';
import Conversation from '@/models/Conversation';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import mongoose from 'mongoose';
import { getRecentTranscriptEntries } from '@/lib/transcription/transcriptionService';
import { unifiedSmartChat } from '@/lib/ai/gemini-chat';
import { analyzeImageWithGemini } from '@/lib/vision';
import { handleTalioQuery, isTalioQuery, TalioMiraUser } from '@/lib/talio/talioMiraIntegration';
import { shouldSearchWeb, extractSearchQuery, isGeneralKnowledge } from '@/lib/ai/webSearch';

// File attachment interface
interface FileAttachment {
  name: string;
  type: string;
  size: number;
  data: string; // base64 encoded data
}

// Process file attachments and return context string
async function processAttachments(attachments: FileAttachment[]): Promise<string> {
  if (!attachments || attachments.length === 0) {
    return '';
  }

  const results: string[] = [];

  for (const attachment of attachments) {
    try {
      // Image files - analyze with Gemini Vision
      if (attachment.type.startsWith('image/')) {
        const analysis = await analyzeImageWithGemini(
          attachment.data,
          `This is an image file named "${attachment.name}" that the user uploaded for analysis.`
        );
        results.push(`[Image: ${attachment.name}]\n${analysis.description}\nObjects: ${analysis.objects?.join(', ') || 'none'}\nContext: ${analysis.context || ''}`);
      }
      // PDF files - extract text (simplified - just note it was attached)
      else if (attachment.type === 'application/pdf') {
        // For now, we note the PDF was attached. Full PDF parsing would require a library like pdf-parse
        results.push(`[PDF Document: ${attachment.name}]\nThe user has attached a PDF file. Size: ${(attachment.size / 1024).toFixed(1)}KB`);
      }
      // Text files - decode and include content
      else if (attachment.type.startsWith('text/') || 
               ['application/json', 'application/javascript', 'application/typescript', 
                'application/xml', 'application/x-yaml'].includes(attachment.type)) {
        // Decode base64 text content
        const textContent = Buffer.from(attachment.data.replace(/^data:[^;]+;base64,/, ''), 'base64').toString('utf-8');
        // Limit text content to prevent token overflow
        const truncatedContent = textContent.length > 5000 
          ? textContent.substring(0, 5000) + '\n... (content truncated)'
          : textContent;
        results.push(`[File: ${attachment.name}]\n\`\`\`\n${truncatedContent}\n\`\`\``);
      }
      // Other files - just note they were attached
      else {
        results.push(`[Attachment: ${attachment.name}]\nFile type: ${attachment.type}, Size: ${(attachment.size / 1024).toFixed(1)}KB`);
      }
    } catch (error) {
      console.error(`Error processing attachment ${attachment.name}:`, error);
      results.push(`[Attachment: ${attachment.name}] (failed to process)`);
    }
  }

  return results.length > 0 ? `\n--- User Attachments ---\n${results.join('\n\n')}\n--- End Attachments ---\n` : '';
}

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
      dateTime,
      proactive, // Flag for proactive checks
      sessionId, // Session ID for transcript context
      attachments, // File attachments (images, PDFs, text, etc.)
      interruptionContext, // Context from when user interrupted MIRA
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
      const introResponse = await agent.getAgentResponse('mira', 
        `You notice someone new. ${faceContext} Introduce yourself warmly as मीरा and ask them their name. Be friendly and natural - don't mention cameras or images. Just greet them like you're meeting for the first time and ask who they are.`
      );
      
      return NextResponse.json({
        conversationId: conversationId || null,
        response: {
          agent: 'mira',
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

    // Build agent context with time awareness
    const agentContext = {
      memories,
      recentMessages: conversation.messages.slice(-15).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      // Include recent transcript as ambient context
      recentTranscript: recentTranscriptContext,
      visualContext: visualContext || undefined,
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
      conversation.metadata.miraMessages += 1;
      
      await conversation.save();
      
      return NextResponse.json({
        conversationId: conversation._id,
        response: {
          agent: 'mira',
          content: responseContent,
        },
        faceSaved: faceSaveResult.saved,
        personName: faceSaveResult.personName,
      });
      }
    }

    let response;

    // Process file attachments (images, PDFs, text files)
    let attachmentContext = '';
    if (attachments && attachments.length > 0) {
      console.log('[Chat] Processing', attachments.length, 'attachment(s)');
      attachmentContext = await processAttachments(attachments);
    }

    // =================
    // TALIO HRMS QUERY DETECTION
    // =================
    // Check if user has Talio integration and this is a Talio-related query
    let talioContext = '';
    if (payload.talioIntegration?.enabled && isTalioQuery(message)) {
      try {
        console.log('[Chat] Detected Talio HRMS query');
        const talioUser: TalioMiraUser = {
          email: payload.email,
          talioUserId: payload.talioIntegration.userId,
          tenantDatabase: payload.talioIntegration.tenantId,
          role: payload.talioIntegration.role,
          employeeId: payload.talioIntegration.employeeId,
          department: payload.talioIntegration.department,
        };
        
        const talioResult = await handleTalioQuery(message, talioUser);
        
        if (talioResult.success && talioResult.data) {
          // Add Talio data to context for the AI to use
          talioContext = `\n[TALIO HRMS DATA]\n${talioResult.message}\n${JSON.stringify(talioResult.data, null, 2)}\n[END TALIO DATA]\n`;
          console.log('[Chat] Talio query successful, adding context');
        }
      } catch (talioError) {
        console.error('[Chat] Talio query failed:', talioError);
        // Continue without Talio data
      }
    }

    // =================
    // WEB SEARCH FOR REAL-TIME INFORMATION
    // =================
    let webSearchContext = '';
    if (!simpleMsg && shouldSearchWeb(message) && !isGeneralKnowledge(message)) {
      try {
        console.log('[Chat] Detected web search need');
        const searchQuery = extractSearchQuery(message);
        
        // Perform web search via Perplexity
        const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
        if (PERPLEXITY_API_KEY) {
          const searchResponse = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'llama-3.1-sonar-small-128k-online',
              messages: [
                { role: 'system', content: 'Provide accurate, current information. Be concise. Include sources when relevant.' },
                { role: 'user', content: searchQuery },
              ],
              temperature: 0.2,
              max_tokens: 800,
            }),
          });

          if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            const searchResult = searchData.choices?.[0]?.message?.content || '';
            const citations = searchData.citations || [];
            
            if (searchResult) {
              webSearchContext = `\n[WEB SEARCH RESULTS]\nQuery: ${searchQuery}\nFindings: ${searchResult}${citations.length > 0 ? `\nSources: ${citations.slice(0, 3).join(', ')}` : ''}\n[END WEB SEARCH]\n`;
              console.log('[Chat] Web search successful');
            }
          }
        }
      } catch (searchError) {
        console.error('[Chat] Web search failed:', searchError);
        // Continue without web search data
      }
    }

    // Build context string for unified chat
    const contextParts: string[] = [];
    
    // Add time info
    const timeInfo = dateTime?.formattedDateTime || new Date().toLocaleString();
    contextParts.push(`Time: ${timeInfo}`);
    contextParts.push(`User: ${payload.name}`);
    
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

    // Add attachment context if any
    if (attachmentContext) {
      contextParts.push(attachmentContext);
    }
    
    // Add Talio HRMS data context if available
    if (talioContext) {
      contextParts.push(talioContext);
    }
    
    // Add web search results if available
    if (webSearchContext) {
      contextParts.push(webSearchContext);
    }
    
    // Add interruption context if user interrupted MIRA mid-response
    if (interruptionContext?.wasInterrupted) {
      contextParts.push(`\n[INTERRUPTION CONTEXT]\nYou were interrupted while saying: "${interruptionContext.spokenPortion}..."\nYour full intended response was: "${interruptionContext.previousResponse}"\nAfter addressing the user's interruption/question, naturally continue or summarize what you were saying. Don't explicitly say "as I was saying" - just smoothly continue.`);
    }
    
    const contextString = contextParts.join('\n');

    // Build message with attachment context for direct calls
    const messageWithAttachments = attachmentContext 
      ? `${message}\n\n${attachmentContext}` 
      : message;

    // Always use unified MIRA - no more agent routing
    // === UNIFIED SMART CHAT - Single AI call handles response ===
    const unifiedResult = await unifiedSmartChat(
      messageWithAttachments,
      contextString,
      conversation.messages.slice(-6).map((m: { role: string; content: string }) => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content.substring(0, 200),
      }))
    );
    
    // Direct response from unified MIRA agent
    response = {
      agent: unifiedResult.agent,
      content: unifiedResult.content,
      emotion: unifiedResult.emotion,
    };

    // Store user message
    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    // Store final response
    conversation.messages.push({
      role: 'mira',
      content: response.content,
      timestamp: new Date(),
      emotion: 'emotion' in response ? response.emotion : undefined,
    });

    // Update metadata
    conversation.metadata.totalMessages = conversation.messages.length;
    conversation.metadata.userMessages += 1;
    conversation.metadata.miraMessages += 1;

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
