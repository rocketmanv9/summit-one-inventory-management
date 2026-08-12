/**
 * Document Chunker — Fixed-size chunking with overlap.
 *
 * Splits documents into chunks of ~512 tokens with configurable overlap
 * for embedding generation and RAG retrieval.
 */

export interface Chunk {
  content: string;
  index: number;
  tokenCount: number;
}

const DEFAULT_CHUNK_SIZE = 512; // tokens (approximate by words / 0.75)
const DEFAULT_OVERLAP = 64; // token overlap between chunks
const AVG_CHARS_PER_TOKEN = 4; // rough approximation for English text

/**
 * Estimate token count from text length.
 * Uses the rough approximation of 4 chars per token for English.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / AVG_CHARS_PER_TOKEN);
}

/**
 * Split text into fixed-size chunks with overlap.
 *
 * @param text - The full document text
 * @param chunkSize - Target chunk size in tokens (default 512)
 * @param overlap - Overlap size in tokens (default 64)
 */
export function chunkText(
  text: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP
): Chunk[] {
  if (!text.trim()) return [];

  const chunkChars = chunkSize * AVG_CHARS_PER_TOKEN;
  const overlapChars = overlap * AVG_CHARS_PER_TOKEN;

  // If text fits in a single chunk, return it as-is
  if (text.length <= chunkChars) {
    return [{
      content: text.trim(),
      index: 0,
      tokenCount: estimateTokenCount(text),
    }];
  }

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = start + chunkChars;

    // Try to break at a sentence or paragraph boundary
    if (end < text.length) {
      const segment = text.slice(start, end + 200); // look ahead 200 chars
      const breakPoints = [
        segment.lastIndexOf('\n\n'), // paragraph break
        segment.lastIndexOf('. '),   // sentence break
        segment.lastIndexOf('.\n'),  // sentence + newline
        segment.lastIndexOf('! '),   // exclamation
        segment.lastIndexOf('? '),   // question
      ];

      // Find the best break point that's at least halfway through the chunk
      const minBreak = chunkChars * 0.5;
      for (const bp of breakPoints) {
        if (bp >= minBreak) {
          end = start + bp + 1;
          break;
        }
      }
    } else {
      end = text.length;
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push({
        content: chunk,
        index,
        tokenCount: estimateTokenCount(chunk),
      });
      index++;
    }

    // Move start forward by (chunk size - overlap)
    start = end - overlapChars;
    if (start >= text.length) break;
    // Prevent infinite loop
    if (start <= chunks[chunks.length - 1]?.content.length ? 0 : start) {
      start = end;
    }
  }

  return chunks;
}
