import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Cache for embeddings to avoid redundant API calls
const embeddingCache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 500;

/**
 * Generate an embedding vector for the given text using OpenAI's text-embedding-3-small model
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Check cache first
  const cacheKey = text.slice(0, 200); // Use first 200 chars as key
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey)!;
  }

  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 1536, // Standard dimension
    });

    const embedding = response.data[0].embedding;

    // Add to cache (with LRU-like eviction)
    if (embeddingCache.size >= MAX_CACHE_SIZE) {
      const firstKey = embeddingCache.keys().next().value;
      if (firstKey) embeddingCache.delete(firstKey);
    }
    embeddingCache.set(cacheKey, embedding);

    return embedding;
  } catch (error) {
    console.error('[Embedding] Failed to generate embedding:', error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts in a single API call
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
      dimensions: 1536,
    });

    return response.data.map(d => d.embedding);
  } catch (error) {
    console.error('[Embedding] Failed to generate embeddings:', error);
    throw error;
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Check if MongoDB Atlas Vector Search is available
 */
export async function checkVectorSearchAvailable(): Promise<boolean> {
  // This would check if the vector search index exists
  // For now, we'll assume it's available if we're using MongoDB Atlas
  const mongoUri = process.env.MONGODB_URI || '';
  return mongoUri.includes('mongodb+srv://') || mongoUri.includes('mongodb.net');
}
