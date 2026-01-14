/**
 * Web Search Integration for MIRA
 * Provides real-time internet access for answering questions
 */

export interface WebSearchResult {
  query: string;
  summary: string;
  sources: Array<{
    title: string;
    url: string;
    snippet?: string;
  }>;
  timestamp: Date;
}

/**
 * Patterns that indicate user wants current/real-time information
 */
const SEARCH_TRIGGER_PATTERNS = [
  // Current events / news
  /\b(what's happening|what happened|latest|recent|today's|current)\b.*\b(news|events|updates)\b/i,
  /\b(news about|update on|what's new with)\b/i,
  
  // Real-time information
  /\b(weather|temperature|forecast)\b.*\b(in|for|today|tomorrow|this week)\b/i,
  /\b(stock price|market|trading)\b/i,
  /\b(score|game|match|playing)\b.*\b(today|now|live|current)\b/i,
  
  // Factual lookups that might need current data
  /\b(who is the current|who is now|latest|newest)\b/i,
  /\b(how much does|what does.*cost|price of)\b/i,
  
  // Explicit search requests
  /\b(search|google|look up|find out|check online)\b/i,
  /\b(can you search|can you find|can you look)\b/i,
  
  // Questions about recent/current things
  /\b(what is|who is|where is)\b.*\b(now|today|currently|right now)\b/i,
  /\b(is.*open|is.*closed|hours of)\b/i,
  
  // Travel / locations
  /\b(flights to|hotels in|restaurants near|directions to)\b/i,
];

/**
 * Topics that generally need web search for accurate info
 */
const SEARCH_TOPICS = [
  'news', 'weather', 'stock', 'sports', 'score', 'election',
  'price', 'cost', 'release date', 'premiere', 'opening',
  'hours', 'schedule', 'event', 'concert', 'show',
  'restaurant', 'hotel', 'flight', 'movie', 'review',
];

/**
 * Check if a query should trigger a web search
 */
export function shouldSearchWeb(text: string): boolean {
  const lower = text.toLowerCase();
  
  // Check trigger patterns
  for (const pattern of SEARCH_TRIGGER_PATTERNS) {
    if (pattern.test(lower)) return true;
  }
  
  // Check for search topics
  for (const topic of SEARCH_TOPICS) {
    if (lower.includes(topic)) return true;
  }
  
  // Check for explicit "search" or "google" requests
  if (/\b(search for|look up|google)\b/i.test(lower)) return true;
  
  return false;
}

/**
 * Extract the search query from user's message
 */
export function extractSearchQuery(text: string): string {
  // Remove common prefixes
  let query = text
    .replace(/^(hey |hi |hello |ok |okay )?(mira|meera|myra)[,!?\s]*/i, '')
    .replace(/^(can you |could you |please |would you )?/i, '')
    .replace(/^(search for|look up|google|find|check)\s*/i, '')
    .replace(/^(what is|what's|who is|who's|where is|where's|how is|how's)\s*/i, '')
    .replace(/\?+$/, '')
    .trim();
  
  // If query is too short after stripping, use original
  if (query.length < 5) {
    query = text.replace(/^(hey |hi |hello )?(mira|meera|myra)[,!?\s]*/i, '').trim();
  }
  
  return query;
}

/**
 * Perform web search via API
 */
export async function performWebSearch(query: string, token: string): Promise<WebSearchResult | null> {
  try {
    console.log('[WebSearch] Searching for:', query);
    
    const response = await fetch('/api/web-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
    });
    
    if (!response.ok) {
      console.error('[WebSearch] API error:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    if (!data.success) {
      console.error('[WebSearch] Search failed:', data.error);
      return null;
    }
    
    return {
      query,
      summary: data.summary || '',
      sources: data.results || [],
      timestamp: new Date(),
    };
  } catch (error) {
    console.error('[WebSearch] Error:', error);
    return null;
  }
}

/**
 * Format search results for MIRA to use
 */
export function formatSearchResults(result: WebSearchResult): string {
  if (!result.summary) {
    return `I searched for "${result.query}" but couldn't find relevant information.`;
  }
  
  let response = result.summary;
  
  // Add sources if available
  if (result.sources && result.sources.length > 0) {
    const sourceList = result.sources
      .slice(0, 3)
      .map(s => s.url)
      .join(', ');
    response += `\n\n[Sources: ${sourceList}]`;
  }
  
  return response;
}

/**
 * Quick facts that don't need search (handled by AI)
 */
export function isGeneralKnowledge(text: string): boolean {
  const lower = text.toLowerCase();
  
  // Math, definitions, general knowledge
  if (/\b(what is \d|calculate|convert|define|meaning of)\b/i.test(lower)) return true;
  
  // Historical facts (not current events)
  if (/\b(when was.*born|when did.*die|history of|founded|invented)\b/i.test(lower)) {
    // Unless asking about something recent
    if (!/\b(2024|2025|2026|recently|latest)\b/i.test(lower)) return true;
  }
  
  return false;
}
