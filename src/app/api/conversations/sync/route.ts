// Conversation Sync API - Real-time conversation persistence
import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import Conversation from '@/models/Conversation';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import mongoose from 'mongoose';

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
