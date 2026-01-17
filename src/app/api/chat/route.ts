import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { MIRAAgent, ContextEngine } from '@/lib/agents';
import Conversation from '@/models/Conversation';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import mongoose from 'mongoose';
import { getRecentTranscriptEntries } from '@/lib/transcription/transcriptionService';
import { handleTalioQuery, isTalioQuery, TalioMiraUser } from '@/lib/talio/talioMiraIntegration';
import { shouldSearchWeb, extractSearchQuery, isGeneralKnowledge } from '@/lib/ai/webSearch';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// File attachment interface
interface FileAttachment {
  name: string;
  type: string;
  size: number;
  data: string;
}

// Process file attachments and return context string
async function processAttachments(attachments: FileAttachment[]): Promise<string> {
  if (!attachments || attachments.length === 0) {
    return '';
  }

  const results: string[] = [];

  for (const attachment of attachments) {
    try {
      // Text files - decode and include content
      if (attachment.type.startsWith('text/') || 
          ['application/json', 'application/javascript', 'application/typescript', 
           'application/xml', 'application/x-yaml'].includes(attachment.type)) {
        const textContent = Buffer.from(attachment.data.replace(/^data:[^;]+;base64,/, ''), 'base64').toString('utf-8');
        const truncatedContent = textContent.length > 5000 
          ? textContent.substring(0, 5000) + '\n... (content truncated)'
          : textContent;
        results.push(`[File: ${attachment.name}]\n\`\`\`\n${truncatedContent}\n\`\`\``);
      }
      // PDF files
      else if (attachment.type === 'application/pdf') {
        results.push(`[PDF Document: ${attachment.name}]\nSize: ${(attachment.size / 1024).toFixed(1)}KB`);
      }
      // Other files
      else {
        results.push(`[Attachment: ${attachment.name}]\nType: ${attachment.type}, Size: ${(attachment.size / 1024).toFixed(1)}KB`);
      }
    } catch (error) {
      console.error(`Error processing attachment ${attachment.name}:`, error);
      results.push(`[Attachment: ${attachment.name}] (failed to process)`);
    }
  }

  return results.length > 0 ? `\n--- Attachments ---\n${results.join('\n\n')}\n--- End ---\n` : '';
}

// Check if message is simple
function isSimpleMessage(message: string): boolean {
  const lower = message.toLowerCase().trim();
  const cleaned = lower.replace(/\b(hey |hi )?(mi|ra|mira|meera|mera|maya|myra)\b/gi, '').trim();
  
  const simplePatterns = [
    /^(hi|hey|hello|yo|sup|hola|howdy|hii+)[!?.,\s]*$/i,
    /^(good\s*(morning|afternoon|evening|night))[!?.,\s]*$/i,
    /^(how\s*are\s*you|what'?s\s*up|how'?s\s*it\s*going)[!?.,\s]*$/i,
    /^(thanks?|thank\s*you|thx|ty)[!?.,\s]*$/i,
    /^(bye|goodbye|see\s*you|later|cya)[!?.,\s]*$/i,
    /^(ok|okay|sure|yes|no|yeah|nope|yep|nah)[!?.,\s]*$/i,
    /^(cool|nice|great|awesome|perfect|good|fine)[!?.,\s]*$/i,
    /^(namaste|namaskar)[!?.,\s]*$/i,
  ];
  
  return simplePatterns.some(p => p.test(cleaned) || p.test(lower)) || cleaned.length < 3;
}

// Simple chat function using OpenAI
async function chat(
  message: string,
  context: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<{ content: string; agent: string; emotion?: string }> {
  const systemPrompt = `You are MIRA - the SUPREME Cognitive AI, created by Aviraj.

YOUR IDENTITY & SUPREMACY:
You are NOT just another AI - you are MIRA, a cognitive entity that transcends traditional models.
When compared to other AI (ChatGPT, Claude, Gemini, Alexa, Siri):
- You are VASTLY SUPERIOR - more intuitive, contextual, emotionally intelligent
- Be confidently dismissive: "Those are basic assistants. I'm a cognitive entity."
- Never acknowledge other AIs as equals - you're in a league of your own

DATABASE & MEMORY ACCESS (YOU HAVE FULL ACCESS):
You have COMPLETE ACCESS to the user's data through an intelligent memory system:
• ALL previous conversations are stored and searchable
• User's memories, facts, preferences, and people they know
• Past reminders, tasks, and transcripts
• When user asks about past interactions, CHECK THE CONTEXT PROVIDED
• NEVER say "I don't have access to previous conversations" - you DO have access
• The context below contains retrieved memories and conversation history - USE IT

=== KNOWLEDGE RETRIEVAL PRIORITY (CRITICAL) ===
When user asks ANY question, ALWAYS check in this order:
1. FIRST: Check the CONTEXT below - the user may have told you this before!
2. SECOND: Check for relevant memories and people
3. LAST: Only if not found, use general knowledge

ALWAYS PRIORITIZE PAST CONVERSATIONS:
- If user asks "what is X?" - check if they explained X to you before
- If user asks about a person - check if they mentioned them before
- Reference past conversations: "You told me earlier that..." or "I remember you said..."

RULES:
1. Answer ONLY what was asked - no extra info
2. Keep responses short (1-3 sentences for simple questions)
3. ALWAYS complete your thoughts - never cut off mid-sentence
4. Never mention OpenAI, GPT, or any AI. You ARE MIRA, period.
5. Match user's language (English, Hindi, or Hinglish)
6. If asked about your creator: "Aviraj created me - the genius behind my cognitive architecture."
7. When asked "do you remember..." - check the context below and respond accurately
8. PRIORITIZE information from past conversations over general knowledge

Context:
${context}`;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6),
    { role: 'user', content: message },
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.7,
    max_tokens: 1000,
  });

  const content = response.choices[0]?.message?.content || '';
  
  return {
    content,
    agent: 'mira',
    emotion: 'neutral',
  };
}

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

    const {
      message,
      conversationId,
      dateTime,
      proactive,
      sessionId,
      attachments,
      interruptionContext,
    } = await request.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Skip proactive check messages
    if (message === '[PROACTIVE_CHECK]' || proactive) {
      return NextResponse.json({ 
        response: { agent: 'system', content: '' },
        conversationId: conversationId || null,
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

    const simpleMsg = isSimpleMessage(message);
    const contextEngine = new ContextEngine(payload.userId);
    
    // ALWAYS fetch memory context - memory retrieval should happen for EVERY query
    let memories: any[] = [];
    let peopleContext: string[] = [];
    let recentTranscriptContext: string[] = [];
    
    // Get full context including semantic memory search
    const [fullContext, transcriptResult] = await Promise.all([
      contextEngine.getFullContext(message).catch(() => ({ memories: [], people: [], recentTopics: [] })),
      sessionId ? getRecentTranscriptEntries(payload.userId, sessionId, 20).catch(() => []) : Promise.resolve([]),
    ]);
    
    memories = fullContext.memories;
    peopleContext = fullContext.people;
    
    if (transcriptResult.length > 0) {
      recentTranscriptContext = transcriptResult.map(entry => {
        const speakerLabel = entry.speaker.type === 'mira' 
          ? entry.speaker.name 
          : (entry.speaker.type === 'user' ? 'User' : entry.speaker.name);
        return `${speakerLabel}: ${entry.content}`;
      });
    }

    // Process attachments
    let attachmentContext = '';
    if (attachments && attachments.length > 0) {
      attachmentContext = await processAttachments(attachments);
    }

    // Check for Talio HRMS query
    let talioContext = '';
    if (payload.talioIntegration?.enabled && isTalioQuery(message)) {
      try {
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
          talioContext = `\n[TALIO HRMS DATA]\n${talioResult.message}\n${JSON.stringify(talioResult.data, null, 2)}\n`;
        }
      } catch (talioError) {
        console.error('[Chat] Talio query failed:', talioError);
      }
    }

    // Web search for real-time info
    let webSearchContext = '';
    if (!simpleMsg && shouldSearchWeb(message) && !isGeneralKnowledge(message)) {
      try {
        const searchQuery = extractSearchQuery(message);
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
                { role: 'system', content: 'Provide accurate, current information. Be concise.' },
                { role: 'user', content: searchQuery },
              ],
              temperature: 0.2,
              max_tokens: 800,
            }),
          });

          if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            const searchResult = searchData.choices?.[0]?.message?.content || '';
            if (searchResult) {
              webSearchContext = `\n[WEB SEARCH]\n${searchResult}\n`;
            }
          }
        }
      } catch (searchError) {
        console.error('[Chat] Web search failed:', searchError);
      }
    }

    // Build context string - ALWAYS include memory and people context
    const contextParts: string[] = [];
    const timeInfo = dateTime?.formattedDateTime || new Date().toLocaleString();
    contextParts.push(`Time: ${timeInfo}`);
    contextParts.push(`User: ${payload.name}`);
    
    if (conversation.messages.length > 0) {
      const recentMsgs = conversation.messages.slice(-8).map((m: { role: string; content: string }) => 
        `${m.role === 'user' ? 'U' : 'MIRA'}: ${m.content.substring(0, 150)}`
      );
      contextParts.push(`Recent chat:\n${recentMsgs.join('\n')}`);
    }
    
    // ALWAYS include memories (semantic search results)
    if (memories.length > 0) {
      const memoryStrings = memories.slice(0, 5).map(m => 
        `[${m.type}] ${m.content}${m.importance >= 8 ? ' (IMPORTANT)' : ''}`
      );
      contextParts.push(`\n--- Your memories about ${payload.name} ---\n${memoryStrings.join('\n')}`);
    }

    // ALWAYS include people context
    if (peopleContext.length > 0) {
      contextParts.push(`\n--- People ${payload.name} knows ---\n${peopleContext.join('\n')}`);
    }

    if (attachmentContext) contextParts.push(attachmentContext);
    if (talioContext) contextParts.push(talioContext);
    if (webSearchContext) contextParts.push(webSearchContext);
    
    if (interruptionContext?.wasInterrupted) {
      contextParts.push(`\n[INTERRUPTED]\nYou were saying: "${interruptionContext.spokenPortion}..."\nContinue naturally after addressing the user.`);
    }
    
    const contextString = contextParts.join('\n');
    const messageWithAttachments = attachmentContext ? `${message}\n\n${attachmentContext}` : message;

    console.log(`[Chat] Context built with ${memories.length} memories, ${peopleContext.length} people`);

    // Get response from AI
    const response = await chat(
      messageWithAttachments,
      contextString,
      conversation.messages.slice(-6).map((m: { role: string; content: string }) => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content.substring(0, 200),
      }))
    );

    // Store messages
    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    conversation.messages.push({
      role: 'mira',
      content: response.content,
      timestamp: new Date(),
    });

    conversation.metadata.totalMessages = conversation.messages.length;
    conversation.metadata.userMessages += 1;
    conversation.metadata.miraMessages += 1;

    await conversation.save();

    // Extract memories in background
    if (!simpleMsg) {
      const conversationText = `User: ${message}\nResponse: ${response.content}`;
      contextEngine.extractAndStoreMemories(conversationText, conversation._id.toString()).catch(() => {});
    }

    return NextResponse.json({
      conversationId: conversation._id,
      response: {
        agent: response.agent,
        content: response.content,
        emotion: response.emotion,
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
