import { createReadRoute } from '@rocketmanv9/chassis/nextjs';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createReadRoute(async ({ req }) => {
  return Response.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: process.env.INTERNAL_JWT_ISSUER || 'unknown',
  });
}, { serviceName: SERVICE_NAME, auth: 'public' });
