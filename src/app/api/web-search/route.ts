import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

// Web search API - supports multiple providers
// Perplexity is recommended for AI-optimized search results

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

interface WebSearchResponse {
  query: string;
  results: SearchResult[];
  summary?: string;
  citations?: string[];
  provider: string;
}

// Perplexity Search - AI-powered, real-time web access
async function searchWithPerplexity(query: string): Promise<WebSearchResponse> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error('Perplexity API key not configured');
  }

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-sonar-small-128k-online', // Online model with web access
      messages: [
        {
          role: 'system',
          content: 'You are a helpful search assistant. Provide accurate, up-to-date information with sources. Be concise but thorough. Always cite your sources.',
        },
        {
          role: 'user',
          content: query,
        },
      ],
      temperature: 0.2,
      max_tokens: 1024,
      return_citations: true,
      return_images: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[WebSearch] Perplexity error:', error);
    throw new Error(`Perplexity search failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const citations = data.citations || [];

  // Extract URLs from citations
  const results: SearchResult[] = citations.map((url: string, i: number) => ({
    title: `Source ${i + 1}`,
    url,
    snippet: '',
    source: new URL(url).hostname,
  }));

  return {
    query,
    results,
    summary: content,
    citations,
    provider: 'perplexity',
  };
}

// Tavily Search - Built for AI agents (alternative option)
async function searchWithTavily(query: string): Promise<WebSearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('Tavily API key not configured');
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      include_answer: true,
      include_raw_content: false,
      max_results: 5,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status}`);
  }

  const data = await response.json();

  return {
    query,
    results: data.results?.map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      source: new URL(r.url).hostname,
    })) || [],
    summary: data.answer,
    provider: 'tavily',
  };
}

// Simple fetch for specific URLs
async function fetchUrl(url: string): Promise<{ content: string; title?: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'MIRA-Bot/1.0 (+https://mira.ai)',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim();

    // Basic HTML to text conversion
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000); // Limit content length

    return { content: textContent, title };
  } catch (error) {
    console.error('[WebSearch] Fetch URL error:', error);
    throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const body = await req.json();
    const { query, url, provider = 'perplexity' } = body;

    // If URL provided, fetch specific page
    if (url) {
      const result = await fetchUrl(url);
      return NextResponse.json({
        success: true,
        type: 'url_fetch',
        url,
        ...result,
      });
    }

    // Otherwise, perform web search
    if (!query) {
      return NextResponse.json({ error: 'Query or URL required' }, { status: 400 });
    }

    let searchResult: WebSearchResponse;

    // Try preferred provider, fall back to alternatives
    if (provider === 'tavily' && process.env.TAVILY_API_KEY) {
      searchResult = await searchWithTavily(query);
    } else if (process.env.PERPLEXITY_API_KEY) {
      searchResult = await searchWithPerplexity(query);
    } else if (process.env.TAVILY_API_KEY) {
      searchResult = await searchWithTavily(query);
    } else {
      return NextResponse.json({ 
        error: 'No search API configured. Add PERPLEXITY_API_KEY or TAVILY_API_KEY to .env' 
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      type: 'search',
      ...searchResult,
    });

  } catch (error) {
    console.error('[WebSearch] Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Search failed' 
    }, { status: 500 });
  }
}

// GET - Simple search via query params
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q');
  
  if (!query) {
    return NextResponse.json({ error: 'Query parameter "q" required' }, { status: 400 });
  }

  // For GET requests, use Perplexity by default
  try {
    if (!process.env.PERPLEXITY_API_KEY) {
      return NextResponse.json({ error: 'Search not configured' }, { status: 500 });
    }

    const result = await searchWithPerplexity(query);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Search failed' 
    }, { status: 500 });
  }
}
