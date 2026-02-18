import { NextResponse } from 'next/server';

// This route is a placeholder. The chatbot now runs entirely client-side
// using the existing RPC layer. This route can be extended later to integrate
// with an LLM API (e.g. OpenAI, Claude) for smarter intent parsing.

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Chat API is available. The chatbot currently runs client-side.',
  });
}
