// Dynamic Memory Search API
// Searches across memories, conversations, and transcripts based on user query keywords
import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import Memory from '@/models/Memory';
import Conversation from '@/models/Conversation';
import Transcript from '@/models/Transcript';
import mongoose from 'mongoose';

// Extract keywords from user query for searching
function extractKeywords(query: string): string[] {
  // Remove common stop words and extract meaningful keywords
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
    'you', 'your', 'yours', 'yourself', 'yourselves',
    'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
    'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while',
    'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',
    'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
    'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
    'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now',
    'mira', 'mirror', 'hey', 'hi', 'hello', 'please', 'thanks', 'thank',
    'remember', 'know', 'tell', 'said', 'say', 'asked', 'ask',
  ]);

  // Clean and tokenize
  const words = query
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  // Also extract phrases (2-3 word combinations)
  const phrases: string[] = [];
  const cleanedQuery = query.toLowerCase().replace(/[^\w\s'-]/g, ' ');
  const allWords = cleanedQuery.split(/\s+/).filter(w => w.length > 1);
  
  for (let i = 0; i < allWords.length - 1; i++) {
    if (!stopWords.has(allWords[i]) || !stopWords.has(allWords[i + 1])) {
      phrases.push(`${allWords[i]} ${allWords[i + 1]}`);
    }
  }

  // Deduplicate and return
  return [...new Set([...words, ...phrases])];
}

// Detect if the query is asking about past information
function isMemoryQuery(query: string): { isMemoryQuery: boolean; confidence: number; queryType: string } {
  const lower = query.toLowerCase();
  
  // High confidence patterns - explicitly asking about past
  const highConfidencePatterns = [
    /\b(do you |did you |can you )?(remember|recall|know)\b/i,
    /\b(what did i|what was|what were|when did i|where did i)\b/i,
    /\b(told you|mentioned|said) (about|that)\b/i,
    /\b(my|i have a?|i had a?|i got a?|i adopted)\s+\w+/i,
    /\b(last time|before|previously|earlier|yesterday|last week|last month)\b/i,
    /\bhave i (ever|told|mentioned|said)\b/i,
    /\bwhat('s| is| was) my\b/i,
    /\bwho('s| is| was) my\b/i,
  ];

  // Medium confidence - could be asking about something they mentioned
  const mediumConfidencePatterns = [
    /\babout (my|the)\b/i,
    /\b(pet|dog|cat|family|wife|husband|friend|car|house|job|work)\b/i,
    /\b(favorite|favourite|like|love|hate|prefer)\b/i,
    /\b(name|birthday|anniversary|schedule|meeting)\b/i,
  ];

  // Check high confidence first
  for (const pattern of highConfidencePatterns) {
    if (pattern.test(lower)) {
      return { isMemoryQuery: true, confidence: 0.9, queryType: 'explicit_memory' };
    }
  }

  // Check medium confidence
  for (const pattern of mediumConfidencePatterns) {
    if (pattern.test(lower)) {
      return { isMemoryQuery: true, confidence: 0.6, queryType: 'implicit_memory' };
    }
  }

  // Low confidence - general query
  return { isMemoryQuery: false, confidence: 0.3, queryType: 'general' };
}

// Search memories collection
async function searchMemories(userId: string, keywords: string[]): Promise<any[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  
  // Build regex patterns for each keyword
  const regexPatterns = keywords.map(k => new RegExp(k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'));
  
  // Search with OR logic across keywords
  const memories = await Memory.find({
    userId: userObjectId,
    isArchived: { $ne: true },
    $or: [
      { content: { $in: regexPatterns } },
      { tags: { $in: keywords } },
    ],
  })
    .sort({ importance: -1, lastAccessed: -1 })
    .limit(10)
    .lean();

  return memories.map(m => ({
    source: 'memory',
    type: m.type,
    content: m.content,
    importance: m.importance,
    createdAt: m.createdAt,
    tags: m.tags,
  }));
}

// Search conversations collection
async function searchConversations(userId: string, keywords: string[]): Promise<any[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  
  // Build regex patterns
  const regexPatterns = keywords.map(k => new RegExp(k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'));
  
  // Search in message content
  const conversations = await Conversation.find({
    userId: userObjectId,
    'messages.content': { $in: regexPatterns },
  })
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();

  // Extract matching messages
  const results: any[] = [];
  for (const conv of conversations) {
    const matchingMessages = (conv.messages || []).filter((m: any) =>
      keywords.some(k => m.content?.toLowerCase().includes(k.toLowerCase()))
    );
    
    for (const msg of matchingMessages.slice(-5)) { // Last 5 matching messages per conversation
      results.push({
        source: 'conversation',
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        conversationId: conv._id,
      });
    }
  }

  return results.slice(0, 15); // Max 15 results
}

// Search transcripts collection (ambient conversations)
async function searchTranscripts(userId: string, keywords: string[]): Promise<any[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  
  // Build regex patterns
  const regexPatterns = keywords.map(k => new RegExp(k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'));
  
  // Search in transcript entries
  const transcripts = await Transcript.find({
    userId: userObjectId,
    'entries.content': { $in: regexPatterns },
  })
    .sort({ date: -1 })
    .limit(10)
    .lean();

  // Extract matching entries
  const results: any[] = [];
  for (const transcript of transcripts) {
    const matchingEntries = (transcript.entries || []).filter((e: any) =>
      keywords.some(k => e.content?.toLowerCase().includes(k.toLowerCase()))
    );
    
    for (const entry of matchingEntries.slice(-5)) {
      results.push({
        source: 'transcript',
        speaker: entry.speaker?.name || entry.speaker?.type || 'Unknown',
        content: entry.content,
        timestamp: entry.timestamp,
        date: transcript.date,
      });
    }
  }

  return results.slice(0, 15);
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
    const query = searchParams.get('query') || '';
    const forceSearch = searchParams.get('force') === 'true';

    if (!query.trim()) {
      return NextResponse.json({ 
        results: [], 
        keywords: [],
        isMemoryQuery: false,
        message: 'No query provided' 
      });
    }

    // Analyze if this is a memory-related query
    const memoryAnalysis = isMemoryQuery(query);
    
    // Extract keywords for searching
    const keywords = extractKeywords(query);
    
    console.log('[MemorySearch] Query:', query);
    console.log('[MemorySearch] Keywords:', keywords);
    console.log('[MemorySearch] Is memory query:', memoryAnalysis);

    // If not a memory query and not forced, return early
    if (!memoryAnalysis.isMemoryQuery && !forceSearch && memoryAnalysis.confidence < 0.5) {
      return NextResponse.json({
        results: [],
        keywords,
        isMemoryQuery: false,
        confidence: memoryAnalysis.confidence,
        queryType: memoryAnalysis.queryType,
        message: 'Query does not appear to be asking about past information',
      });
    }

    // Search all sources in parallel
    const [memories, conversations, transcripts] = await Promise.all([
      searchMemories(payload.userId, keywords),
      searchConversations(payload.userId, keywords),
      searchTranscripts(payload.userId, keywords),
    ]);

    // Combine and sort by relevance (memories first, then conversations, then transcripts)
    const allResults = [
      ...memories.map(r => ({ ...r, relevanceScore: 3 })),
      ...conversations.map(r => ({ ...r, relevanceScore: 2 })),
      ...transcripts.map(r => ({ ...r, relevanceScore: 1 })),
    ];

    // Sort by relevance score, then by timestamp
    allResults.sort((a, b) => {
      if (a.relevanceScore !== b.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      const aTime = new Date(a.timestamp || a.createdAt || a.date || 0).getTime();
      const bTime = new Date(b.timestamp || b.createdAt || b.date || 0).getTime();
      return bTime - aTime;
    });

    // Format results into a context string for the AI
    let contextString = '';
    if (allResults.length > 0) {
      contextString = allResults.slice(0, 10).map(r => {
        if (r.source === 'memory') {
          return `[Memory - ${r.type}] ${r.content}`;
        } else if (r.source === 'conversation') {
          return `[Past conversation - ${r.role}] ${r.content}`;
        } else {
          return `[Heard - ${r.speaker}] ${r.content}`;
        }
      }).join('\n');
    }

    console.log('[MemorySearch] Found', allResults.length, 'results');

    return NextResponse.json({
      results: allResults.slice(0, 20),
      keywords,
      isMemoryQuery: memoryAnalysis.isMemoryQuery,
      confidence: memoryAnalysis.confidence,
      queryType: memoryAnalysis.queryType,
      contextString,
      totalResults: {
        memories: memories.length,
        conversations: conversations.length,
        transcripts: transcripts.length,
      },
    });
  } catch (error) {
    console.error('[MemorySearch] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
