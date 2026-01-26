# Vercel Environment Variables - COPY THESE NOW

Go to: https://vercel.com/your-team/inventory-management/settings/environment-variables

**Add these environment variables for Production:**

```bash
# ===== SUPABASE (CRITICAL) =====
NEXT_PUBLIC_SUPABASE_URL=https://cwmsvmywairkwdmvkdmw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3bXN2bXl3YWlya3dkbXZrZG13Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNzA5MzAsImV4cCI6MjA4Mjk0NjkzMH0.2VQ_rQpazlzGSkfjJbBov79omTGicZVePNv_c-m1pc0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3bXN2bXl3YWlya3dkbXZrZG13Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzM3MDkzMCwiZXhwIjoyMDgyOTQ2OTMwfQ.EZ7Sf7zGFxzp0Bfwx0X2LtIcKNczJ7-QWl-wlQeKOlM

# ===== DATABASE (Get password from Supabase Dashboard > Settings > Database) =====
DATABASE_URL=postgresql://postgres.cwmsvmywairkwdmvkdmw:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres.cwmsvmywairkwdmvkdmw:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres

# ===== CORE INTEGRATION =====
CORE_SSO_SECRET=gL5eMvCMU@9C9YpH
NEXT_PUBLIC_CORE_URL=https://dev.summit-one.app
WEBHOOK_SECRET=3dc7be0ae4094d47aa96164a56c59cd16b4379ef90064c99ab6cc0786e753437

# ===== APP SETTINGS =====
NODE_ENV=production
NEXT_PUBLIC_SERVICE_NAME=Inventory Management
NEXT_PUBLIC_SERVICE_SLUG=inventory
NEXT_PUBLIC_TENANT_ID=ba964c21-05a0-4a71-92ea-47ec7cfe0bbd
```

## STEPS TO FIX NOW:

1. **Get your Supabase database password:**
   - Go to: https://supabase.com/dashboard/project/cwmsvmywairkwdmvkdmw/settings/database
   - Copy the password (or reset it if you don't have it)

2. **Set in Vercel:**
   - Go to your Vercel project settings
   - Environment Variables section
   - Add ALL variables above
   - Replace `[YOUR-PASSWORD]` with your actual database password
   - Set for: Production (and Preview if needed)

3. **Redeploy:**
   - After saving env vars in Vercel
   - Go to Deployments tab
   - Click "..." on latest deployment
   - Click "Redeploy"

## VERIFY IT WORKED:

After redeployment, check the deployment logs for any errors with environment variables.

The API routes were failing because `process.env.NEXT_PUBLIC_SUPABASE_URL` was undefined or pointed to localhost.
