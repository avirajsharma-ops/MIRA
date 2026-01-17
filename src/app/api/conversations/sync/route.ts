// Conversation Sync API - Real-time conversation persistence
// CRITICAL: Every conversation is saved and indexed for semantic search
import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import Conversation from '@/models/Conversation';
import Memory from '@/models/Memory';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import mongoose from 'mongoose';
import { generateEmbedding } from '@/lib/ai/embeddings';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Extract important information from conversation for memory storage
async function extractMemoriesFromConversation(
  userId: string,
  userMessage: string,
  miraResponse?: string
): Promise<void> {
  // Skip very short or simple messages
  if (userMessage.length < 20) return;
  
  // Skip greetings and simple acknowledgments
  const skipPatterns = [
    /^(hi|hey|hello|bye|goodbye|thanks|thank you|ok|okay|yes|no|yeah|nope)/i,
    /^(good morning|good night|good evening)/i,
  ];
  if (skipPatterns.some(p => p.test(userMessage.trim()))) return;
  
  try {
    // Use AI to detect if this contains memorable information
    const analysisPrompt = `Analyze this user message and determine if it contains information worth remembering:
"${userMessage}"
${miraResponse ? `MIRA's response: "${miraResponse.substring(0, 200)}"` : ''}

Extract ONLY genuinely important/memorable information like:
- Personal facts (name, job, family, pets, preferences)
- Events or plans
- People mentioned
- Preferences or opinions
- Tasks or goals

Respond in JSON:
{
  "shouldSave": boolean,
  "memories": [
    {
      "type": "fact|preference|event|person|task|insight",
      "content": "concise memory statement",
      "importance": 1-10
    }
  ]
}

If nothing memorable, return: {"shouldSave": false, "memories": []}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: analysisPrompt }],
      temperature: 0.3,
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());

    if (parsed.shouldSave && parsed.memories?.length > 0) {
      const userObjectId = new mongoose.Types.ObjectId(userId);
      
      for (const mem of parsed.memories) {
        // Generate embedding for semantic search
        let embedding: number[] | undefined;
        try {
          embedding = await generateEmbedding(mem.content);
        } catch {
          console.warn('[MemoryExtract] Failed to generate embedding');
        }
        
        // Check for duplicate content
        const existing = await Memory.findOne({
          userId: userObjectId,
          content: { $regex: mem.content.substring(0, 50), $options: 'i' },
          isArchived: false,
        });
        
        if (!existing) {
          await Memory.create({
            userId: userObjectId,
            type: mem.type || 'fact',
            content: mem.content,
            importance: mem.importance || 5,
            source: 'inferred',
            tags: [],
            embedding,
            context: {
              timestamp: new Date(),
            },
          });
          console.log('[MemoryExtract] Saved new memory:', mem.content.substring(0, 50));
        }
      }
    }
  } catch (error) {
    console.error('[MemoryExtract] Error:', error);
  }
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

    const body = await request.json();
    const { sessionId, conversationId, message } = body;

    if (!sessionId || !message) {
      return NextResponse.json({ error: 'sessionId and message are required' }, { status: 400 });
    }

    await connectToDatabase();

    const userObjectId = new mongoose.Types.ObjectId(payload.userId);
    const timestamp = message.timestamp ? new Date(message.timestamp) : new Date();

    // Find or create conversation
    let conversation;
    
    if (conversationId) {
      // Try to find existing conversation
      conversation = await Conversation.findOne({
        _id: conversationId,
        userId: userObjectId,
      });
    }
    
    if (!conversation) {
      // Find today's conversation for this session, or create new one
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      conversation = await Conversation.findOne({
        userId: userObjectId,
        startedAt: { $gte: today },
        isActive: true,
      });
      
      if (!conversation) {
        // Create new conversation
        const title = message.content 
          ? message.content.substring(0, 50) + (message.content.length > 50 ? '...' : '')
          : 'Voice Conversation';
          
        conversation = new Conversation({
          userId: userObjectId,
          title,
          messages: [],
          isActive: true,
          startedAt: timestamp,
          metadata: {
            totalMessages: 0,
            miraMessages: 0,
            userMessages: 0,
          },
        });
      }
    }

    // Add message to conversation
    const newMessage = {
      role: message.role || 'user',
      content: message.content,
      timestamp,
      emotion: message.emotion,
    };

    conversation.messages.push(newMessage);
    
    // Update metadata
    conversation.metadata.totalMessages = conversation.messages.length;
    if (message.role === 'user') {
      conversation.metadata.userMessages += 1;
    } else if (message.role === 'mira') {
      conversation.metadata.miraMessages += 1;
    }

    // Save with retry logic
    let saved = false;
    let retries = 3;
    
    while (!saved && retries > 0) {
      try {
        await conversation.save();
        saved = true;
      } catch (saveError: any) {
        if (saveError.code === 11000) {
          // Duplicate key - conversation already exists, try to update
          await Conversation.findByIdAndUpdate(conversation._id, {
            $push: { messages: newMessage },
            $inc: {
              'metadata.totalMessages': 1,
              [`metadata.${message.role === 'mira' ? 'miraMessages' : 'userMessages'}`]: 1,
            },
          });
          saved = true;
        } else {
          retries--;
          if (retries > 0) {
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
    }

    if (!saved) {
      console.error('[Conversation Sync] Failed to save after retries');
      return NextResponse.json({ error: 'Failed to save conversation' }, { status: 500 });
    }

    console.log('[Conversation Sync] Saved message to conversation:', conversation._id.toString());

    // Extract memories from user messages in the background
    // This ensures important information is indexed for semantic search
    if (message.role === 'user' && message.content) {
      // Get MIRA's last response for context
      const miraResponse = conversation.messages
        .filter((m: { role: string }) => m.role === 'mira')
        .slice(-1)[0]?.content;
      
      // Extract memories asynchronously (don't block response)
      extractMemoriesFromConversation(payload.userId, message.content, miraResponse)
        .catch(err => console.error('[Conversation Sync] Memory extraction failed:', err));
    }

    return NextResponse.json({
      success: true,
      conversationId: conversation._id.toString(),
      messageCount: conversation.messages.length,
      timestamp: timestamp.toISOString(),
    });
  } catch (error) {
    console.error('Conversation sync error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET - Get current active conversation
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const conversation = await Conversation.findOne({
      userId: new mongoose.Types.ObjectId(payload.userId),
      startedAt: { $gte: today },
      isActive: true,
    }).sort({ startedAt: -1 });

    if (!conversation) {
      return NextResponse.json({ conversation: null });
    }

    return NextResponse.json({
      conversation: {
        id: conversation._id.toString(),
        title: conversation.title,
        messageCount: conversation.messages.length,
        startedAt: conversation.startedAt,
        metadata: conversation.metadata,
      },
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
