import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'inventory-management',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
}
