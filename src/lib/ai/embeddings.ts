/**
 * Embedding Generation Utilities
 *
 * Generates vector embeddings using OpenAI's text-embedding-3-small model (1536 dimensions).
 * Used for semantic search over catalog items, vendors, and locations.
 */

import OpenAI from 'openai';

let _openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

/**
 * Generate a 1536-dimension embedding vector for the given text.
 *
 * Uses OpenAI text-embedding-3-small for cost-effective, high-quality embeddings.
 * Returns an empty array if the API call fails (caller should handle gracefully).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text.trim()) return [];

  try {
    const openai = getOpenAIClient();
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.trim(),
      dimensions: 1536,
    });

    return response.data[0]?.embedding ?? [];
  } catch (err) {
    console.error('[embeddings] Failed to generate embedding:', err);
    return [];
  }
}

/**
 * Build a search-friendly text string from entity fields.
 *
 * Concatenates available fields into a single string optimized for embedding generation.
 * The resulting text captures the semantic meaning of the entity for vector search.
 */
export function buildEmbeddingText(entity: {
  name?: string;
  description?: string;
  sku?: string;
  category?: string;
}): string {
  const parts: string[] = [];

  if (entity.name) parts.push(entity.name);
  if (entity.sku) parts.push(`SKU: ${entity.sku}`);
  if (entity.category) parts.push(`Category: ${entity.category}`);
  if (entity.description) parts.push(entity.description);

  return parts.join(' | ');
}
