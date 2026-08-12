/**
 * AI Memory System
 *
 * Retrieves relevant memories for context injection into the system prompt,
 * and extracts new memories from completed conversations.
 */

import { generateEmbedding } from './embeddings';
import OpenAI from 'openai';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

// ─── Memory Retrieval ──────────────────────────────────────────────────

interface RetrievedMemory {
  id: string;
  memory_type: string;
  content: string;
  relevance: number;
  similarity: number;
}

/**
 * Retrieve relevant memories for the current conversation context.
 * Uses vector similarity to find memories related to the user's message.
 */
export async function getRelevantMemories(
  supabase: SupabaseClientLike,
  tenantId: string,
  userId: string,
  userMessage: string,
  limit: number = 5
): Promise<RetrievedMemory[]> {
  try {
    const embedding = await generateEmbedding(userMessage);
    if (!embedding || embedding.length === 0) return [];

    const { data, error } = await supabase.schema('inventory').rpc('rpc_get_relevant_memories', {
      query_embedding: embedding,
      match_tenant_id: tenantId,
      match_user_id: userId,
      match_count: limit,
      min_similarity: 0.7,
    });

    if (error || !data) return [];

    // Update last_accessed for retrieved memories
    const memoryIds = (data as RetrievedMemory[]).map((m) => m.id);
    if (memoryIds.length > 0) {
      await supabase.schema('inventory')
        .from('ai_memory')
        .update({ last_accessed: new Date().toISOString() })
        .in('id', memoryIds);
    }

    return data as RetrievedMemory[];
  } catch {
    // Memory retrieval is non-critical — fail silently
    return [];
  }
}

/**
 * Format retrieved memories as a system prompt section.
 */
export function formatMemoriesForPrompt(memories: RetrievedMemory[]): string {
  if (memories.length === 0) return '';

  const lines = [
    '\n\nRELEVANT MEMORIES (from previous conversations with this user):',
  ];

  for (const mem of memories) {
    const typeLabel = mem.memory_type === 'preference' ? 'Preference'
      : mem.memory_type === 'correction' ? 'Correction'
      : mem.memory_type === 'fact' ? 'Known fact'
      : 'Pattern';
    lines.push(`- [${typeLabel}] ${mem.content}`);
  }

  lines.push('Use these memories to personalize your response. If a correction was made, follow the corrected approach.');

  return lines.join('\n');
}

// ─── Memory Extraction ─────────────────────────────────────────────────

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface ExtractedMemory {
  memory_type: 'preference' | 'fact' | 'pattern' | 'correction';
  content: string;
}

/**
 * Extract memorable facts from a conversation turn using gpt-4.1-nano.
 * Runs as a low-cost background process after each conversation.
 */
export async function extractMemories(
  turns: ConversationTurn[]
): Promise<ExtractedMemory[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  // Only process if there's meaningful conversation (at least 2 turns)
  if (turns.length < 2) return [];

  const conversation = turns
    .map((t) => `${t.role}: ${t.content}`)
    .join('\n');

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-nano',
      messages: [
        {
          role: 'system',
          content: `You analyze conversations to extract memorable information about the user.
Extract ONLY significant, reusable information. Skip trivial or one-time queries.

Categories:
- preference: User's stated preferences (units, display format, default locations, etc.)
- fact: Facts about the user's business (company size, industry, key products, etc.)
- pattern: Recurring behaviors or common queries
- correction: When the user corrects the AI's response or approach

Respond with a JSON array of objects: [{"memory_type": "...", "content": "..."}]
If nothing is worth remembering, respond with: []
Keep each content under 200 characters. Be specific and actionable.`,
        },
        {
          role: 'user',
          content: `Extract memorable information from this conversation:\n\n${conversation}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return [];

    // Parse JSON response
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (m: any) =>
        m.memory_type &&
        m.content &&
        ['preference', 'fact', 'pattern', 'correction'].includes(m.memory_type)
    ) as ExtractedMemory[];
  } catch {
    // Memory extraction is non-critical — fail silently
    return [];
  }
}

/**
 * Store extracted memories in the database with embeddings.
 */
export async function storeMemories(
  supabase: SupabaseClientLike,
  tenantId: string,
  userId: string,
  conversationId: string | null,
  memories: ExtractedMemory[]
): Promise<void> {
  if (memories.length === 0) return;

  try {
    const inv = supabase.schema('inventory');

    for (const mem of memories) {
      // Check for duplicate content
      const { data: existing } = await inv
        .from('ai_memory')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .eq('content', mem.content)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Generate embedding for the memory
      const embedding = await generateEmbedding(mem.content);

      await inv.from('ai_memory').insert({
        tenant_id: tenantId,
        user_id: userId,
        memory_type: mem.memory_type,
        content: mem.content,
        embedding: embedding.length > 0 ? embedding : null,
        source_conversation_id: conversationId,
      });
    }
  } catch {
    // Memory storage is non-critical — fail silently
  }
}
