import { createReadRoute } from '@rocketmanv9/chassis/nextjs';

export const GET = createReadRoute(async ({ session }) => {
  return Response.json({
    userId: session!.userId,
    email: session!.email,
    tenantId: session!.tenantId,
    name: session!.name,
    role: session!.role,
  });
}, {
  serviceName: process.env.INTERNAL_JWT_ISSUER || 'my-service',
  auth: 'session',
});
