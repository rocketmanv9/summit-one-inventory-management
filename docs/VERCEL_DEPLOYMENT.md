# Vercel Deployment Guide

This document provides comprehensive instructions for successfully deploying the Summit One Inventory Management application to Vercel and avoiding common deployment failures.

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Environment Variables Configuration](#environment-variables-configuration)
3. [Build Configuration](#build-configuration)
4. [Common Deployment Failures & Solutions](#common-deployment-failures--solutions)
5. [Deployment Process](#deployment-process)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Troubleshooting](#troubleshooting)

---

## Pre-Deployment Checklist

Before deploying to Vercel, ensure all of the following steps are completed:

### 1. **Test Local Build**

Always test the production build locally before deploying:

```bash
npm run build
npm run start
```

If the local build fails, Vercel deployment will also fail. Fix all build errors locally first.

### 2. **Run ESLint**

Ensure there are no ESLint errors (warnings are acceptable):

```bash
npm run lint
```

**Expected output:** `✖ X problems (0 errors, X warnings)`

If you see errors, they must be fixed before deployment.

### 3. **Check TypeScript Compilation**

The Next.js build will fail if TypeScript has errors:

```bash
npx tsc --noEmit
```

### 4. **Verify Git Status**

Ensure all changes are committed:

```bash
git status
git add .
git commit -m "Fix: Prepare for Vercel deployment"
```

---

## Environment Variables Configuration

### Required Environment Variables

Configure these in your Vercel project settings (Settings > Environment Variables):

#### **Supabase Configuration**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_JWT_SECRET=your-jwt-secret-32-chars-minimum
```

#### **Database Configuration**
```bash
# Use Supabase pooler connection string for DATABASE_URL
DATABASE_URL=postgresql://postgres.xxx:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
# Use direct connection for DIRECT_URL
DIRECT_URL=postgresql://postgres.xxx:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

#### **Core SSO Integration**
```bash
CORE_EXCHANGE_URL=https://core.your-domain.com/api/auth/exchange
CORE_ANON_KEY=your-core-anon-key
NEXT_PUBLIC_CORE_APP_URL=https://core.your-domain.com
INTERNAL_JWT_SECRET=your-chassis-jwt-secret
```

#### **Webhook Configuration**
```bash
# Used to verify webhook signatures from Core
WEBHOOK_SECRET=your-webhook-secret-here
```

#### **Application Configuration**
```bash
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
NODE_ENV=production
NEXT_PUBLIC_SERVICE_NAME=Inventory Management
NEXT_PUBLIC_SERVICE_SLUG=inventory
NEXT_PUBLIC_TENANT_ID=your-production-tenant-uuid
```

### Environment Variable Best Practices

1. **Never commit secrets to Git** - Always use Vercel's environment variables
2. **Use different values per environment** - Development, Preview, and Production should have separate configurations
3. **Prefix client-side variables with `NEXT_PUBLIC_`** - Only these are exposed to the browser
4. **Validate required variables** - The app will fail at runtime if required env vars are missing

---

## Build Configuration

### Next.js Configuration (`next.config.ts`)

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // React Compiler is disabled to prevent ESLint errors during build
  reactCompiler: false,
};

export default nextConfig;
```

**Important:** The React Compiler is currently disabled because it causes ESLint errors that fail the Vercel build. Only re-enable after updating code patterns to comply with the compiler's requirements.

### ESLint Configuration (`eslint.config.mjs`)

The ESLint configuration ignores:
- Test files (`__tests__/**`, `*.test.ts`, `*.spec.ts`)
- Development scripts (`scripts/**`)
- Supabase functions (`supabase/**`)
- Components with React Compiler issues (`src/components/widgets/**`)

These directories contain development code that shouldn't block production builds.

---

## Common Deployment Failures & Solutions

### 1. **ESLint Errors**

**Symptoms:**
```
✖ 5 problems (5 errors, 0 warnings)
Build failed
```

**Solutions:**
- Run `npm run lint` locally to identify errors
- Fix all errors (warnings won't block deployment)
- Common fixes:
  - Remove `@ts-nocheck` comments
  - Replace `require()` with ES6 `import` statements
  - Fix forward references (define functions before using them)
  - Move setState calls outside of synchronous useEffect bodies

### 2. **TypeScript Compilation Errors**

**Symptoms:**
```
Type error: Cannot find module 'X'
Type error: Property 'Y' does not exist on type 'Z'
```

**Solutions:**
- Run `npm run build` locally to catch type errors
- Ensure all imports have proper type definitions
- Check `types/supabase.ts` for database type accuracy
- Avoid using `any` types (ESLint will warn but won't block)

### 3. **Missing Environment Variables**

**Symptoms:**
```
Error: NEXT_PUBLIC_SUPABASE_URL is not defined
Runtime error: Cannot read property 'X' of undefined
```

**Solutions:**
- Verify all required environment variables are set in Vercel
- Check variable names match exactly (case-sensitive)
- Ensure `NEXT_PUBLIC_` prefix for client-side variables
- Redeploy after adding new environment variables

### 4. **Build Timeout**

**Symptoms:**
```
Error: Build exceeded maximum duration of 45 minutes
```

**Solutions:**
- Optimize build by reducing dependencies
- Check for infinite loops in build-time code
- Consider upgrading Vercel plan for longer build times
- Use `output: 'standalone'` in next.config.ts for smaller builds

### 5. **Module Not Found Errors**

**Symptoms:**
```
Module not found: Can't resolve 'X'
```

**Solutions:**
- Run `npm install` to ensure all dependencies are installed
- Check `package.json` and `package-lock.json` are committed
- Verify import paths use correct casing (case-sensitive in production)
- Use path aliases defined in `tsconfig.json` (`@/components`, etc.)

### 6. **Middleware or API Route Errors**

**Symptoms:**
```
Error in middleware
API route handler failed
```

**Solutions:**
- Test middleware locally with `npm run dev`
- Check that environment variables are available in middleware
- Ensure API routes return proper Response objects
- Review `middleware.ts` for blocking issues

---

## Deployment Process

### Initial Setup

1. **Connect Repository to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New Project"
   - Import your Git repository
   - Select framework preset: **Next.js**

2. **Configure Build Settings**
   - Framework: Next.js
   - Root Directory: `./` (default)
   - Build Command: `npm run build` (default)
   - Output Directory: `.next` (default)
   - Install Command: `npm install` (default)

3. **Add Environment Variables**
   - Copy all variables from `.env.production`
   - Paste into Vercel's Environment Variables section
   - Set environment scope (Production, Preview, Development)

4. **Deploy**
   - Click "Deploy"
   - Wait for build to complete (~3-5 minutes)
   - Verify deployment at the provided URL

### Subsequent Deployments

Vercel deploys on pushes to dev, stage, and prod branches. CI runs migrations before deploying.

1. **Push changes to Git:**
   ```bash
   git add .
   git commit -m "Your commit message"
   git push origin dev
   ```

2. **Vercel auto-deploys:**
   - Deployment starts automatically
   - Monitor progress in Vercel dashboard
   - Production deployment completes in ~3-5 minutes

### Manual Deployment

To manually trigger a deployment:

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

---

## Post-Deployment Verification

After deployment completes, verify the following:

### 1. **Health Check**
```bash
curl https://your-app.vercel.app/api/health
# Expected: {"status":"ok","timestamp":"..."}
```

### 2. **Debug Check**
```bash
curl https://your-app.vercel.app/api/system/debug
# Returns system diagnostic information
```

### 3. **Authentication Flow**
- Visit the app URL
- Attempt to log in via SSO
- Verify JWT is issued correctly
- Check that authenticated routes work

### 4. **Database Connectivity**
- Test a database-dependent page (e.g., /inventory/items)
- Verify data loads correctly
- Check Supabase logs for connection errors

### 5. **Error Monitoring**
- Check Vercel Logs for runtime errors
- Monitor Vercel Analytics for performance issues
- Review Supabase logs for database errors

---

## Troubleshooting

### Vercel Build Logs

Access detailed build logs:
1. Go to Vercel Dashboard
2. Select your project
3. Click on the failed deployment
4. View "Build Logs" tab
5. Search for `Error:` or `Failed` to find the issue

### Common Debug Commands

```bash
# Check build locally
npm run build

# Check for type errors
npx tsc --noEmit

# Check for lint errors
npm run lint

# Test production build locally
npm run build && npm run start

# Check environment variables
cat .env.production  # Never commit this file!
```

### Rollback Failed Deployment

If a deployment fails or introduces bugs:

1. Go to Vercel Dashboard > Deployments
2. Find the last working deployment
3. Click "⋮" menu > "Promote to Production"
4. Fix issues locally, then redeploy

### Getting Help

If deployment continues to fail:

1. **Check Vercel Status:** https://www.vercel-status.com/
2. **Review Vercel Docs:** https://vercel.com/docs
3. **Check GitHub Issues:** Look for similar deployment errors
4. **Contact Support:** support@vercel.com (for paid plans)

---

## Deployment Checklist Summary

Use this checklist before every deployment:

- [ ] Run `npm run build` locally - build succeeds
- [ ] Run `npm run lint` - 0 errors
- [ ] Run `npx tsc --noEmit` - no type errors
- [ ] All changes committed to Git
- [ ] Environment variables configured in Vercel
- [ ] Database migrations applied (if any)
- [ ] `.env.production` values match Vercel settings
- [ ] No secrets hardcoded in source code
- [ ] All tests passing (if applicable)
- [ ] Dependencies up to date (`npm audit` clean)

---

## Key Takeaways

1. **Always test locally first** - If it fails locally, it will fail on Vercel
2. **ESLint errors block deployment** - Fix all errors, warnings are acceptable
3. **Environment variables must be set in Vercel** - Don't rely on `.env` files
4. **React Compiler is disabled** - Re-enable only after fixing code patterns
5. **Monitor deployments** - Check logs and verify functionality after each deploy

By following this guide, you should be able to deploy to Vercel successfully without failures.
