// Conversations API - List and retrieve conversation history
import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import Conversation from '@/models/Conversation';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import mongoose from 'mongoose';

// GET - List conversations with optional messages
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

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('id');
    const includeMessages = searchParams.get('includeMessages') === 'true';
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = parseInt(searchParams.get('skip') || '0');
    const forContext = searchParams.get('forContext') === 'true'; // Get recent messages for AI context

    await connectToDatabase();

    const userObjectId = new mongoose.Types.ObjectId(payload.userId);

    // Get single conversation by ID with full messages
    if (conversationId) {
      const conversation = await Conversation.findOne({
        _id: conversationId,
        userId: userObjectId,
      });

      if (!conversation) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }

      return NextResponse.json({
        conversation: {
          id: conversation._id.toString(),
          title: conversation.title,
          messages: conversation.messages,
          startedAt: conversation.startedAt,
          metadata: conversation.metadata,
        },
      });
    }

    // Get recent context for AI (last N messages across recent conversations)
    if (forContext) {
      const messageLimit = parseInt(searchParams.get('messageLimit') || '50');
      
      // Get recent conversations (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const recentConversations = await Conversation.find({
        userId: userObjectId,
        startedAt: { $gte: sevenDaysAgo },
      })
        .sort({ startedAt: -1 })
        .limit(10); // Get up to 10 recent conversations

      // Flatten messages from all conversations, most recent first
      const allMessages: Array<{
        role: string;
        content: string;
        timestamp: Date;
        conversationDate: Date;
      }> = [];

      for (const conv of recentConversations) {
        for (const msg of conv.messages) {
          allMessages.push({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            conversationDate: conv.startedAt,
          });
        }
      }

      // Sort by timestamp descending and take most recent
      allMessages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const contextMessages = allMessages.slice(0, messageLimit);

      // Reverse to get chronological order for context
      contextMessages.reverse();

      return NextResponse.json({
        contextMessages,
        totalConversations: recentConversations.length,
        messageCount: contextMessages.length,
      });
    }

    // List conversations
    const conversations = await Conversation.find({
      userId: userObjectId,
    })
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(includeMessages ? {} : { messages: { $slice: 3 } }); // Only include first 3 messages in list view

    const total = await Conversation.countDocuments({ userId: userObjectId });

    return NextResponse.json({
      conversations: conversations.map(conv => ({
        id: conv._id.toString(),
        title: conv.title,
        messages: includeMessages ? conv.messages : conv.messages.slice(0, 3),
        messageCount: conv.metadata?.totalMessages || conv.messages.length,
        startedAt: conv.startedAt,
        metadata: conv.metadata,
      })),
      total,
      limit,
      skip,
      hasMore: skip + conversations.length < total,
    });
  } catch (error) {
    console.error('Conversations list error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
