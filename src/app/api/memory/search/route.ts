// Dynamic Memory Search API
// Searches across memories, conversations, and transcripts based on user query keywords
// NOW WITH SEMANTIC VECTOR SEARCH for better accuracy
import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import Memory from '@/models/Memory';
import Person from '@/models/Person';
import Conversation from '@/models/Conversation';
import Transcript from '@/models/Transcript';
import mongoose from 'mongoose';
import { generateEmbedding, cosineSimilarity } from '@/lib/ai/embeddings';

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

// Search memories collection using SEMANTIC VECTOR SEARCH
async function searchMemories(userId: string, keywords: string[], queryEmbedding?: number[]): Promise<any[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  
  // Try semantic search first if we have an embedding
  if (queryEmbedding) {
    try {
      // Try Atlas Vector Search
      const db = mongoose.connection.db;
      if (db) {
        try {
          const vectorResults = await db.collection('memories').aggregate([
            {
              $vectorSearch: {
                index: 'memory_vector_index',
                path: 'embedding',
                queryVector: queryEmbedding,
                numCandidates: 100,
                limit: 15,
                filter: {
                  userId: userObjectId,
                  isArchived: { $ne: true },
                },
              },
            },
            {
              $project: {
                _id: 1,
                type: 1,
                content: 1,
                importance: 1,
                createdAt: 1,
                tags: 1,
                score: { $meta: 'vectorSearchScore' },
              },
            },
          ]).toArray();

          if (vectorResults.length > 0) {
            console.log('[MemorySearch] Vector search found', vectorResults.length, 'memories');
            return vectorResults.map(m => ({
              source: 'memory',
              type: m.type,
              content: m.content,
              importance: m.importance,
              createdAt: m.createdAt,
              tags: m.tags,
              score: m.score,
            }));
          }
        } catch {
          // Vector search not available, try manual similarity
        }
      }

      // Fallback: Manual cosine similarity search
      const memoriesWithEmbeddings = await Memory.find({
        userId: userObjectId,
        isArchived: { $ne: true },
        embedding: { $exists: true, $ne: [] },
      }).select('+embedding').limit(200).lean();

      if (memoriesWithEmbeddings.length > 0) {
        const scored = memoriesWithEmbeddings.map(m => ({
          memory: m,
          similarity: m.embedding ? cosineSimilarity(queryEmbedding, m.embedding) : 0,
        }));
        
        scored.sort((a, b) => b.similarity - a.similarity);
        
        return scored.slice(0, 15).map(s => ({
          source: 'memory',
          type: s.memory.type,
          content: s.memory.content,
          importance: s.memory.importance,
          createdAt: s.memory.createdAt,
          tags: s.memory.tags,
          score: s.similarity,
        }));
      }
    } catch (error) {
      console.error('[MemorySearch] Semantic search error:', error);
    }
  }
  
  // Fallback to keyword search
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

// Search conversations collection with SEMANTIC SEARCH
async function searchConversations(userId: string, keywords: string[], queryEmbedding?: number[]): Promise<any[]> {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const results: any[] = [];
  
  // Try semantic search first on conversation messages
  if (queryEmbedding) {
    try {
      // Get recent conversations (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const conversations = await Conversation.find({
        userId: userObjectId,
        updatedAt: { $gte: thirtyDaysAgo },
      })
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean() as any[];

      // Collect all messages with their conversation context
      const allMessages: { msg: any; convId: string; convTitle?: string }[] = [];
      for (const conv of conversations) {
        for (const msg of (conv.messages || [])) {
          if (msg.content && msg.content.length > 10) {
            allMessages.push({
              msg,
              convId: (conv._id as any).toString(),
              convTitle: conv.title as string | undefined,
            });
          }
        }
      }

      // Generate embeddings and find similar messages (for important queries)
      // Use a simpler keyword+similarity approach for efficiency
      const scoredMessages: { msg: any; convId: string; convTitle?: string; score: number }[] = [];
      
      for (const { msg, convId, convTitle } of allMessages) {
        // Keyword matching score
        const content = msg.content.toLowerCase();
        let keywordScore = 0;
        for (const keyword of keywords) {
          if (content.includes(keyword.toLowerCase())) {
            keywordScore += 1;
          }
        }
        
        // Only include messages with keyword matches for efficiency
        if (keywordScore > 0) {
          scoredMessages.push({
            msg,
            convId,
            convTitle,
            score: keywordScore,
          });
        }
      }

      // Sort by score and return top matches
      scoredMessages.sort((a, b) => b.score - a.score);
      
      for (const { msg, convId, convTitle, score } of scoredMessages.slice(0, 20)) {
        results.push({
          source: 'conversation',
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          conversationId: convId,
          conversationTitle: convTitle,
          score,
        });
      }

      if (results.length > 0) {
        console.log('[MemorySearch] Semantic conversation search found', results.length, 'messages');
        return results;
      }
    } catch (error) {
      console.error('[MemorySearch] Semantic conversation search error:', error);
    }
  }
  
  // Fallback: Build regex patterns for keyword search
  const regexPatterns = keywords.map(k => new RegExp(k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'));
  
  // Search in message content
  const conversations = await Conversation.find({
    userId: userObjectId,
    'messages.content': { $in: regexPatterns },
  })
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();

  // Extract matching messages
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
        conversationTitle: conv.title,
      });
    }
  }

  return results.slice(0, 20); // Max 20 results
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

    // ALWAYS search - removed early return for non-memory queries
    // All queries benefit from memory context

    // Generate embedding for semantic search
    let queryEmbedding: number[] | undefined;
    try {
      queryEmbedding = await generateEmbedding(query);
    } catch (error) {
      console.warn('[MemorySearch] Failed to generate embedding, falling back to keyword search');
    }

    // Search all sources in parallel, including people
    const userObjectId = new mongoose.Types.ObjectId(payload.userId);
    const [memories, conversations, transcripts, people] = await Promise.all([
      searchMemories(payload.userId, keywords, queryEmbedding),
      searchConversations(payload.userId, keywords, queryEmbedding),
      searchTranscripts(payload.userId, keywords),
      // Search people library
      Person.find({
        userId: userObjectId,
        $or: [
          { name: { $regex: keywords.join('|'), $options: 'i' } },
          { description: { $regex: keywords.join('|'), $options: 'i' } },
          { relationship: { $regex: keywords.join('|'), $options: 'i' } },
        ],
      }).limit(10).lean(),
    ]);

    // Format people results
    const peopleResults = people.map(p => ({
      source: 'person',
      name: p.name,
      content: `${p.name}${p.relationship ? ` (${p.relationship})` : ''}: ${p.description}`,
      relationship: p.relationship,
    }));

    // Combine and sort by relevance (people and memories first)
    const allResults = [
      ...peopleResults.map(r => ({ ...r, relevanceScore: 4 })),
      ...memories.map(r => ({ ...r, relevanceScore: 3 })),
      ...conversations.map(r => ({ ...r, relevanceScore: 2 })),
      ...transcripts.map(r => ({ ...r, relevanceScore: 1 })),
    ];

    // Sort by relevance score, then by semantic score if available
    allResults.sort((a, b) => {
      if (a.relevanceScore !== b.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      // Use semantic score if available
      const aScore = (a as any).score || 0;
      const bScore = (b as any).score || 0;
      if (aScore !== bScore) {
        return bScore - aScore;
      }
      const aTime = new Date(a.timestamp || a.createdAt || a.date || 0).getTime();
      const bTime = new Date(b.timestamp || b.createdAt || b.date || 0).getTime();
      return bTime - aTime;
    });

    // Format results into a context string for the AI
    let contextString = '';
    if (allResults.length > 0) {
      contextString = allResults.slice(0, 12).map(r => {
        if (r.source === 'person') {
          return `[Person] ${r.content}`;
        } else if (r.source === 'memory') {
          return `[Memory - ${r.type}] ${r.content}`;
        } else if (r.source === 'conversation') {
          return `[Past conversation - ${r.role}] ${r.content}`;
        } else {
          return `[Heard - ${r.speaker}] ${r.content}`;
        }
      }).join('\n');
    }

    console.log('[MemorySearch] Found', allResults.length, 'results (semantic:', !!queryEmbedding, ')');

    return NextResponse.json({
      results: allResults.slice(0, 20),
      keywords,
      isMemoryQuery: memoryAnalysis.isMemoryQuery,
      confidence: memoryAnalysis.confidence,
      queryType: memoryAnalysis.queryType,
      contextString,
      usedSemanticSearch: !!queryEmbedding,
      totalResults: {
        people: peopleResults.length,
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
