/**
 * Debug endpoint to inspect JWT tokens
 * Used for troubleshooting authentication issues
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { error: 'No token provided' },
        { status: 400 }
      );
    }

    // Decode without verification (just to inspect payload)
    const parts = token.split('.');
    
    if (parts.length !== 3) {
      return NextResponse.json(
        { error: 'Invalid JWT format (not 3 parts)' },
        { status: 400 }
      );
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    try {
      const header = JSON.parse(
        Buffer.from(headerB64, 'base64').toString('utf-8')
      );
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64').toString('utf-8')
      );

      // Verify with Supabase secret
      const jwt = require('jsonwebtoken');
      const secret = process.env.SUPABASE_JWT_SECRET;

      let verificationResult = null;
      let verificationError = null;

      if (secret) {
        try {
          verificationResult = jwt.verify(token, secret, {
            algorithms: ['HS256']
          });
          console.log('[Debug JWT] Verification succeeded');
        } catch (err) {
          verificationError = (err as Error).message;
          console.log('[Debug JWT] Verification failed:', err);
        }
      }

      return NextResponse.json({
        success: true,
        header,
        payload,
        signature: signatureB64.substring(0, 20) + '...',
        verification: {
          attempted: !!secret,
          status: verificationResult ? 'valid' : 'invalid',
          error: verificationError,
          secretLength: secret?.length
        },
        expiresAt: new Date((payload.exp || 0) * 1000).toISOString(),
        isExpired: payload.exp ? payload.exp < Math.floor(Date.now() / 1000) : null
      });
    } catch (decodeErr) {
      return NextResponse.json(
        { 
          error: 'Failed to decode token',
          details: (decodeErr as Error).message
        },
        { status: 400 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal error', details: (error as Error).message },
      { status: 500 }
    );
  }
}
