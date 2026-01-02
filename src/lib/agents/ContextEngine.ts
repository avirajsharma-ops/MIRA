import { connectToDatabase } from '@/lib/mongodb';
import Memory, { IMemory } from '@/models/Memory';
import Conversation from '@/models/Conversation';
import mongoose from 'mongoose';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface MemoryInput {
  userId: string;
  content: string;
  type: IMemory['type'];
  source: IMemory['source'];
  importance?: number;
  tags?: string[];
  conversationId?: string;
  visualContext?: string;
}

export class ContextEngine {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async addMemory(input: MemoryInput): Promise<IMemory> {
    await connectToDatabase();

    // Auto-generate tags and emotions if not provided
    const analysis = await this.analyzeMemory(input.content);

    const memory = await Memory.create({
      userId: new mongoose.Types.ObjectId(input.userId),
      type: input.type,
      content: input.content,
      importance: input.importance || analysis.importance,
      source: input.source,
      tags: input.tags || analysis.tags,
      emotions: {
        mi: analysis.miEmotion,
        ra: analysis.raEmotion,
      },
      context: {
        conversationId: input.conversationId 
          ? new mongoose.Types.ObjectId(input.conversationId) 
          : undefined,
        timestamp: new Date(),
        visualContext: input.visualContext,
      },
    });

    return memory;
  }

  private async analyzeMemory(content: string): Promise<{
    importance: number;
    tags: string[];
    miEmotion: string;
    raEmotion: string;
  }> {
    const prompt = `Analyze this memory/information for storage:
"${content}"

Respond in JSON format:
{
  "importance": <1-10 scale, 10 being extremely important>,
  "tags": ["tag1", "tag2", ...],
  "miEmotion": "<emotional interpretation>",
  "raEmotion": "<logical categorization>"
}`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 200,
      });

      const parsed = JSON.parse(
        response.choices[0]?.message?.content?.replace(/```json\n?|\n?```/g, '') || '{}'
      );

      return {
        importance: parsed.importance || 5,
        tags: parsed.tags || [],
        miEmotion: parsed.miEmotion || 'neutral',
        raEmotion: parsed.raEmotion || 'information',
      };
    } catch {
      return {
        importance: 5,
        tags: [],
        miEmotion: 'neutral',
        raEmotion: 'information',
      };
    }
  }

  async getRelevantMemories(
    query: string,
    limit: number = 10
  ): Promise<IMemory[]> {
    await connectToDatabase();

    // First, try text search
    const textSearchResults = await Memory.find(
      {
        userId: new mongoose.Types.ObjectId(this.userId),
        isArchived: false,
        $text: { $search: query },
      },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit);

    if (textSearchResults.length >= limit / 2) {
      // Skip access time update for speed - do it async
      Memory.updateMany(
        { _id: { $in: textSearchResults.map(m => m._id) } },
        { $set: { lastAccessed: new Date() }, $inc: { accessCount: 1 } }
      ).catch(() => {}); // Fire and forget
      return textSearchResults;
    }

    // Fallback: Get high-importance recent memories
    const recentImportant = await Memory.find({
      userId: new mongoose.Types.ObjectId(this.userId),
      isArchived: false,
    })
      .sort({ importance: -1, lastAccessed: -1 })
      .limit(limit);

    return recentImportant;
  }

  // FAST memory retrieval - no text search, just high-importance recent
  async getRelevantMemoriesFast(
    query: string,
    limit: number = 5
  ): Promise<IMemory[]> {
    await connectToDatabase();

    // Quick keyword extraction from query
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    // Build simple regex for keyword matching
    const keywordRegex = keywords.length > 0 
      ? new RegExp(keywords.slice(0, 3).join('|'), 'i') 
      : null;

    // Single fast query - combine text match with importance
    const memories = await Memory.find({
      userId: new mongoose.Types.ObjectId(this.userId),
      isArchived: false,
      ...(keywordRegex ? { content: { $regex: keywordRegex } } : {}),
    })
      .sort({ importance: -1 })
      .limit(limit);

    return memories;
  }

  async getMemoriesByType(type: IMemory['type'], limit: number = 20): Promise<IMemory[]> {
    await connectToDatabase();

    return Memory.find({
      userId: new mongoose.Types.ObjectId(this.userId),
      type,
      isArchived: false,
    })
      .sort({ importance: -1, createdAt: -1 })
      .limit(limit);
  }

  async getPersonMemories(personName: string): Promise<IMemory[]> {
    await connectToDatabase();

    return Memory.find({
      userId: new mongoose.Types.ObjectId(this.userId),
      type: 'person',
      isArchived: false,
      $or: [
        { content: { $regex: personName, $options: 'i' } },
        { tags: { $regex: personName, $options: 'i' } },
      ],
    }).sort({ importance: -1 });
  }

  async extractAndStoreMemories(
    conversation: string,
    conversationId: string
  ): Promise<IMemory[]> {
    const prompt = `Analyze this conversation and extract important memories to store:

${conversation}

Extract any:
1. Facts about the user (preferences, details about their life)
2. People mentioned
3. Events or tasks discussed
4. Emotional insights
5. User preferences

Respond in JSON format:
{
  "memories": [
    {
      "type": "fact|preference|event|person|emotion|task|insight",
      "content": "the memory content",
      "importance": 1-10,
      "tags": ["tag1", "tag2"]
    }
  ]
}

Only include truly important, persistent information worth remembering.`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      });

      const parsed = JSON.parse(
        response.choices[0]?.message?.content?.replace(/```json\n?|\n?```/g, '') || '{"memories":[]}'
      );

      const storedMemories: IMemory[] = [];

      for (const mem of parsed.memories || []) {
        const stored = await this.addMemory({
          userId: this.userId,
          content: mem.content,
          type: mem.type,
          source: 'inferred',
          importance: mem.importance,
          tags: mem.tags,
          conversationId,
        });
        storedMemories.push(stored);
      }

      return storedMemories;
    } catch (error) {
      console.error('Error extracting memories:', error);
      return [];
    }
  }

  async searchMemories(searchQuery: string): Promise<IMemory[]> {
    await connectToDatabase();

    // Use MongoDB text search
    return Memory.find(
      {
        userId: new mongoose.Types.ObjectId(this.userId),
        isArchived: false,
        $text: { $search: searchQuery },
      },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(20);
  }

  async archiveOldMemories(daysOld: number = 90): Promise<number> {
    await connectToDatabase();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await Memory.updateMany(
      {
        userId: new mongoose.Types.ObjectId(this.userId),
        lastAccessed: { $lt: cutoffDate },
        importance: { $lt: 7 }, // Don't archive very important memories
        isArchived: false,
      },
      { $set: { isArchived: true } }
    );

    return result.modifiedCount;
  }

  async getAllMemoriesForContext(): Promise<IMemory[]> {
    await connectToDatabase();

    // Get a balanced mix of memories for context
    const [important, recent, people, preferences] = await Promise.all([
      // Most important memories
      Memory.find({
        userId: new mongoose.Types.ObjectId(this.userId),
        isArchived: false,
        importance: { $gte: 8 },
      })
        .sort({ importance: -1 })
        .limit(5),

      // Recent memories
      Memory.find({
        userId: new mongoose.Types.ObjectId(this.userId),
        isArchived: false,
      })
        .sort({ createdAt: -1 })
        .limit(5),

      // People
      Memory.find({
        userId: new mongoose.Types.ObjectId(this.userId),
        type: 'person',
        isArchived: false,
      })
        .sort({ importance: -1 })
        .limit(5),

      // Preferences
      Memory.find({
        userId: new mongoose.Types.ObjectId(this.userId),
        type: 'preference',
        isArchived: false,
      })
        .sort({ importance: -1 })
        .limit(5),
    ]);

    // Combine and deduplicate
    const allMemories = [...important, ...recent, ...people, ...preferences];
    const uniqueMemories = allMemories.filter(
      (mem, index, self) =>
        index === self.findIndex(m => m._id.toString() === mem._id.toString())
    );

    return uniqueMemories.slice(0, 15);
  }

  // Get today's conversation summary for context
  async getTodaysConversationSummary(): Promise<{
    summary: string;
    topics: string[];
    messageCount: number;
    userPatterns: string[];
  }> {
    await connectToDatabase();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all conversations from today
    const todaysConversations = await Conversation.find({
      userId: new mongoose.Types.ObjectId(this.userId),
      startedAt: { $gte: today },
    }).sort({ startedAt: 1 });

    if (todaysConversations.length === 0) {
      return {
        summary: '',
        topics: [],
        messageCount: 0,
        userPatterns: [],
      };
    }

    // Collect all messages from today
    const allMessages: { role: string; content: string; timestamp: Date }[] = [];
    for (const conv of todaysConversations) {
      for (const msg of conv.messages || []) {
        allMessages.push({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
        });
      }
    }

    const userMessages = allMessages.filter(m => m.role === 'user');
    
    // Build a concise summary without AI call for speed
    const topics = this.extractTopics(allMessages);
    const patterns = this.analyzeUserPatterns(userMessages);
    
    // Create a brief summary
    const summaryParts: string[] = [];
    if (allMessages.length > 0) {
      summaryParts.push(`${userMessages.length} messages today`);
      if (topics.length > 0) {
        summaryParts.push(`Topics: ${topics.slice(0, 5).join(', ')}`);
      }
    }

    return {
      summary: summaryParts.join('. '),
      topics: topics.slice(0, 10),
      messageCount: userMessages.length,
      userPatterns: patterns,
    };
  }

  // Extract topics from messages (fast, no AI call)
  private extractTopics(messages: { role: string; content: string }[]): string[] {
    const topicKeywords: { [key: string]: string } = {
      'work|job|office|meeting|boss|project|deadline': 'work',
      'code|bug|error|function|programming|developer': 'coding',
      'health|exercise|gym|doctor|sick|medicine': 'health',
      'food|eat|restaurant|cook|dinner|lunch|breakfast': 'food',
      'family|mom|dad|brother|sister|wife|husband|kids': 'family',
      'friend|friends|hangout|party': 'friends',
      'movie|show|watch|netflix|youtube|game': 'entertainment',
      'buy|purchase|money|pay|cost|expensive': 'shopping/finance',
      'travel|trip|vacation|flight|hotel': 'travel',
      'learn|study|course|book|read': 'learning',
      'feel|sad|happy|angry|stressed|anxious|worried': 'emotions',
      'plan|schedule|tomorrow|today|weekend': 'planning',
    };

    const foundTopics = new Set<string>();
    const allText = messages.map(m => m.content).join(' ').toLowerCase();

    for (const [pattern, topic] of Object.entries(topicKeywords)) {
      if (new RegExp(pattern, 'i').test(allText)) {
        foundTopics.add(topic);
      }
    }

    return Array.from(foundTopics);
  }

  // Analyze user communication patterns (fast, no AI call)
  private analyzeUserPatterns(userMessages: { content: string }[]): string[] {
    const patterns: string[] = [];
    
    if (userMessages.length < 3) return patterns;

    const avgLength = userMessages.reduce((sum, m) => sum + m.content.length, 0) / userMessages.length;
    
    if (avgLength < 30) {
      patterns.push('prefers short messages');
    } else if (avgLength > 100) {
      patterns.push('writes detailed messages');
    }

    // Check for question patterns
    const questionCount = userMessages.filter(m => m.content.includes('?')).length;
    if (questionCount > userMessages.length * 0.5) {
      patterns.push('asks many questions');
    }

    // Check for Hinglish/Hindi usage
    const hindiPattern = /[\u0900-\u097F]|kya|hai|kaise|accha|theek/i;
    const hindiMsgs = userMessages.filter(m => hindiPattern.test(m.content)).length;
    if (hindiMsgs > userMessages.length * 0.3) {
      patterns.push('uses Hindi/Hinglish');
    }

    return patterns;
  }

  // Get recent conversation context (last N hours)
  async getRecentConversationContext(hoursBack: number = 6): Promise<{
    messages: { role: string; content: string; time: string }[];
    topicsDiscussed: string[];
  }> {
    await connectToDatabase();

    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hoursBack);

    const conversations = await Conversation.find({
      userId: new mongoose.Types.ObjectId(this.userId),
      startedAt: { $gte: cutoff },
    }).sort({ startedAt: -1 });

    const messages: { role: string; content: string; time: string }[] = [];
    
    for (const conv of conversations) {
      for (const msg of conv.messages || []) {
        messages.push({
          role: msg.role,
          content: msg.content,
          time: new Date(msg.timestamp).toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit' 
          }),
        });
      }
    }

    // Limit to most recent 50 messages
    const recentMessages = messages.slice(-50);
    const topics = this.extractTopics(recentMessages);

    return {
      messages: recentMessages,
      topicsDiscussed: topics,
    };
  }
}

export default ContextEngine;
