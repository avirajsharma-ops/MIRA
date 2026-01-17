// Database Sync API - Comprehensive sync of all MIRA data
// Ensures conversations, transcripts, memories are properly stored and have embeddings
import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import Memory from '@/models/Memory';
import Conversation from '@/models/Conversation';
import Transcript from '@/models/Transcript';
import Person from '@/models/Person';
import User from '@/models/User';
import Reminder from '@/models/Reminder';
import VoiceEmbedding from '@/models/VoiceEmbedding';
import mongoose from 'mongoose';
import { generateEmbeddings } from '@/lib/ai/embeddings';

interface SyncStats {
  users: number;
  conversations: { total: number; messages: number };
  transcripts: { total: number; entries: number };
  memories: { total: number; withEmbeddings: number; withoutEmbeddings: number };
  people: number;
  reminders: number;
  voiceEmbeddings: number;
}

interface SyncResult {
  success: boolean;
  stats: SyncStats;
  userStats?: {
    conversations: number;
    messages: number;
    transcripts: number;
    transcriptEntries: number;
    memories: number;
    memoriesWithEmbeddings: number;
    memoriesNeedingEmbeddings: number;
    people: number;
    reminders: number;
  };
  embeddingsGenerated?: number;
  errors: string[];
}

// GET - Get database stats and check sync status
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
    const userId = new mongoose.Types.ObjectId(payload.userId);

    // Get comprehensive stats
    const [
      totalUsers,
      totalConversations,
      totalTranscripts,
      totalMemories,
      memoriesWithEmbeddings,
      totalPeople,
      totalReminders,
      totalVoiceEmbeddings,
      userConversations,
      userTranscripts,
      userMemories,
      userMemoriesWithEmbeddings,
      userPeople,
      userReminders,
    ] = await Promise.all([
      User.countDocuments(),
      Conversation.countDocuments(),
      Transcript.countDocuments(),
      Memory.countDocuments(),
      Memory.countDocuments({ embedding: { $exists: true, $ne: [] } }),
      Person.countDocuments(),
      Reminder.countDocuments(),
      VoiceEmbedding.countDocuments(),
      // User-specific
      Conversation.countDocuments({ userId }),
      Transcript.countDocuments({ userId }),
      Memory.countDocuments({ userId }),
      Memory.countDocuments({ userId, embedding: { $exists: true, $ne: [] } }),
      Person.countDocuments({ userId }),
      Reminder.countDocuments({ userId }),
    ]);

    // Get message and entry counts
    const conversationAgg = await Conversation.aggregate([
      { $group: { _id: null, totalMessages: { $sum: { $size: '$messages' } } } }
    ]);
    const transcriptAgg = await Transcript.aggregate([
      { $group: { _id: null, totalEntries: { $sum: { $size: '$entries' } } } }
    ]);

    const userConversationAgg = await Conversation.aggregate([
      { $match: { userId } },
      { $group: { _id: null, totalMessages: { $sum: { $size: '$messages' } } } }
    ]);
    const userTranscriptAgg = await Transcript.aggregate([
      { $match: { userId } },
      { $group: { _id: null, totalEntries: { $sum: { $size: '$entries' } } } }
    ]);

    const stats: SyncStats = {
      users: totalUsers,
      conversations: {
        total: totalConversations,
        messages: conversationAgg[0]?.totalMessages || 0,
      },
      transcripts: {
        total: totalTranscripts,
        entries: transcriptAgg[0]?.totalEntries || 0,
      },
      memories: {
        total: totalMemories,
        withEmbeddings: memoriesWithEmbeddings,
        withoutEmbeddings: totalMemories - memoriesWithEmbeddings,
      },
      people: totalPeople,
      reminders: totalReminders,
      voiceEmbeddings: totalVoiceEmbeddings,
    };

    return NextResponse.json({
      success: true,
      global: stats,
      user: {
        userId: payload.userId,
        email: payload.email,
        conversations: userConversations,
        messages: userConversationAgg[0]?.totalMessages || 0,
        transcripts: userTranscripts,
        transcriptEntries: userTranscriptAgg[0]?.totalEntries || 0,
        memories: userMemories,
        memoriesWithEmbeddings: userMemoriesWithEmbeddings,
        memoriesNeedingEmbeddings: userMemories - userMemoriesWithEmbeddings,
        people: userPeople,
        reminders: userReminders,
      },
      vectorSearchReady: memoriesWithEmbeddings > 0,
      embeddingCoverage: totalMemories > 0 
        ? Math.round((memoriesWithEmbeddings / totalMemories) * 100) 
        : 100,
    });
  } catch (error) {
    console.error('[DB Sync] Stats error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Run sync and generate embeddings
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
    const userId = new mongoose.Types.ObjectId(payload.userId);

    const { 
      generateEmbeddings: shouldGenerateEmbeddings = true,
      extractMemoriesFromConversations = true,
      extractMemoriesFromTranscripts = true,
      batchSize = 50,
    } = await request.json().catch(() => ({}));

    const errors: string[] = [];
    let embeddingsGenerated = 0;
    let memoriesExtracted = 0;

    // 1. Extract memories from conversations that might have been missed
    if (extractMemoriesFromConversations) {
      try {
        const recentConversations = await Conversation.find({
          userId,
          startedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
        }).lean();

        for (const conv of recentConversations) {
          for (const msg of conv.messages || []) {
            if (msg.role === 'user' && msg.content && msg.content.length > 20) {
              // Check if similar memory already exists
              const existingMemory = await Memory.findOne({
                userId,
                content: { $regex: msg.content.substring(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
              });

              if (!existingMemory && shouldExtractMemory(msg.content)) {
                await Memory.create({
                  userId,
                  type: detectMemoryType(msg.content),
                  content: msg.content,
                  importance: 5,
                  source: 'inferred',
                  tags: extractTags(msg.content),
                  context: {
                    conversationId: conv._id,
                    timestamp: msg.timestamp,
                  },
                });
                memoriesExtracted++;
              }
            }
          }
        }
        console.log(`[DB Sync] Extracted ${memoriesExtracted} memories from conversations`);
      } catch (err) {
        errors.push(`Error extracting from conversations: ${err}`);
      }
    }

    // 2. Extract memories from transcripts
    if (extractMemoriesFromTranscripts) {
      try {
        const recentTranscripts = await Transcript.find({
          userId,
          date: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        }).lean();

        let transcriptMemories = 0;
        for (const transcript of recentTranscripts) {
          for (const entry of transcript.entries || []) {
            if (entry.speaker?.type === 'user' && entry.content && entry.content.length > 20) {
              const existingMemory = await Memory.findOne({
                userId,
                content: { $regex: entry.content.substring(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
              });

              if (!existingMemory && shouldExtractMemory(entry.content)) {
                await Memory.create({
                  userId,
                  type: detectMemoryType(entry.content),
                  content: entry.content,
                  importance: 4,
                  source: 'inferred',
                  tags: extractTags(entry.content),
                  context: {
                    timestamp: entry.timestamp,
                  },
                });
                transcriptMemories++;
              }
            }
          }
        }
        memoriesExtracted += transcriptMemories;
        console.log(`[DB Sync] Extracted ${transcriptMemories} memories from transcripts`);
      } catch (err) {
        errors.push(`Error extracting from transcripts: ${err}`);
      }
    }

    // 3. Generate embeddings for memories that don't have them
    if (shouldGenerateEmbeddings) {
      try {
        const memoriesWithoutEmbeddings = await Memory.find({
          userId,
          $or: [{ embedding: { $exists: false } }, { embedding: [] }],
        }).limit(batchSize).lean();

        if (memoriesWithoutEmbeddings.length > 0) {
          const texts = memoriesWithoutEmbeddings.map(m => m.content);
          const embeddings = await generateEmbeddings(texts);

          const bulkOps = memoriesWithoutEmbeddings.map((mem, index) => ({
            updateOne: {
              filter: { _id: mem._id },
              update: { $set: { embedding: embeddings[index] } },
            },
          }));

          const result = await Memory.bulkWrite(bulkOps);
          embeddingsGenerated = result.modifiedCount;
          console.log(`[DB Sync] Generated ${embeddingsGenerated} embeddings`);
        }
      } catch (err) {
        errors.push(`Error generating embeddings: ${err}`);
      }
    }

    // Get final stats
    const [
      userConversations,
      userTranscripts,
      userMemories,
      userMemoriesWithEmbeddings,
      userPeople,
      userReminders,
    ] = await Promise.all([
      Conversation.countDocuments({ userId }),
      Transcript.countDocuments({ userId }),
      Memory.countDocuments({ userId }),
      Memory.countDocuments({ userId, embedding: { $exists: true, $ne: [] } }),
      Person.countDocuments({ userId }),
      Reminder.countDocuments({ userId }),
    ]);

    const userConversationAgg = await Conversation.aggregate([
      { $match: { userId } },
      { $group: { _id: null, totalMessages: { $sum: { $size: '$messages' } } } }
    ]);
    const userTranscriptAgg = await Transcript.aggregate([
      { $match: { userId } },
      { $group: { _id: null, totalEntries: { $sum: { $size: '$entries' } } } }
    ]);

    return NextResponse.json({
      success: true,
      message: 'Sync completed',
      memoriesExtracted,
      embeddingsGenerated,
      remainingWithoutEmbeddings: userMemories - userMemoriesWithEmbeddings,
      userStats: {
        conversations: userConversations,
        messages: userConversationAgg[0]?.totalMessages || 0,
        transcripts: userTranscripts,
        transcriptEntries: userTranscriptAgg[0]?.totalEntries || 0,
        memories: userMemories,
        memoriesWithEmbeddings: userMemoriesWithEmbeddings,
        memoriesNeedingEmbeddings: userMemories - userMemoriesWithEmbeddings,
        people: userPeople,
        reminders: userReminders,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('[DB Sync] Sync error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper: Check if content should be extracted as memory
function shouldExtractMemory(content: string): boolean {
  if (!content || content.length < 15) return false;
  
  const patterns = [
    /\b(my name is|i am|i'm)\s+\w+/i,
    /\b(my|i have a?)\s+(wife|husband|son|daughter|brother|sister|mom|dad|friend|colleague|pet|dog|cat)\b/i,
    /\b(i like|i love|i hate|i prefer|my favorite)\b/i,
    /\b(i work at|i'm a|my job is)\b/i,
    /\b(remember|don't forget|important)\b/i,
    /\b(birthday|anniversary|meeting|appointment)\b.*\b(is on|on|at)\b/i,
    /\b(i adopted|i got|i bought|i have|my)\s+(a |an )?\s*(pet|dog|cat|bird)\b/i,
    /\b(i own|i bought|i got|my new)\s/i,
    /\b(i moved|i live|i'm from)\b/i,
    /\b(i started|i'm starting|i joined|i quit)\b/i,
    /\b(i play|i enjoy|my hobby)\b/i,
  ];
  
  return patterns.some(p => p.test(content));
}

// Helper: Detect memory type
function detectMemoryType(content: string): 'person' | 'preference' | 'fact' | 'event' | 'task' {
  const lower = content.toLowerCase();
  
  if (/\b(name is|friend|colleague|wife|husband|brother|sister|mom|dad)\b/.test(lower)) return 'person';
  if (/\b(like|love|hate|prefer|favorite|enjoy)\b/.test(lower)) return 'preference';
  if (/\b(meeting|appointment|birthday|anniversary|deadline)\b/.test(lower)) return 'event';
  if (/\b(todo|task|remind|don't forget)\b/.test(lower)) return 'task';
  return 'fact';
}

// Helper: Extract tags from content
function extractTags(content: string): string[] {
  const tags: string[] = [];
  const lower = content.toLowerCase();
  
  const tagPatterns: [RegExp, string][] = [
    [/\b(work|job|office|career)\b/, 'work'],
    [/\b(family|mom|dad|brother|sister|wife|husband|son|daughter)\b/, 'family'],
    [/\b(friend|friends)\b/, 'friends'],
    [/\b(pet|dog|cat|animal)\b/, 'pets'],
    [/\b(health|doctor|medicine|gym|exercise)\b/, 'health'],
    [/\b(food|eat|restaurant|cook)\b/, 'food'],
    [/\b(travel|trip|vacation|flight)\b/, 'travel'],
    [/\b(hobby|hobbies|play|game|music|movie)\b/, 'hobbies'],
    [/\b(learn|study|course|school|university)\b/, 'education'],
  ];
  
  for (const [pattern, tag] of tagPatterns) {
    if (pattern.test(lower)) {
      tags.push(tag);
    }
  }
  
  return tags;
}
