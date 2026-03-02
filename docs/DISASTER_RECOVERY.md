# Disaster Recovery Plan

This document outlines backup, restore, and disaster recovery procedures for Summit Inventory Management.

## Table of Contents

1. [Overview](#overview)
2. [Backup Strategy](#backup-strategy)
3. [Restoration Procedures](#restoration-procedures)
4. [Disaster Scenarios](#disaster-scenarios)
5. [Testing & Validation](#testing--validation)
6. [Contact Information](#contact-information)

---

## Overview

### Recovery Objectives

| Metric | Target | Notes |
|--------|--------|-------|
| **RPO** (Recovery Point Objective) | 1 hour | Maximum data loss acceptable |
| **RTO** (Recovery Time Objective) | 4 hours | Maximum downtime acceptable |
| **Data Retention** | 30 days | Point-in-time recovery window |

### Critical Systems

1. **Database** (Supabase Postgres) - Contains all inventory, transaction, and user data
2. **Application** (Vercel) - Next.js frontend and API routes
3. **Edge Functions** (Supabase) - Event processing, auth callbacks
4. **File Storage** (Supabase Storage) - Attachments, images (if used)

---

## Backup Strategy

### Database Backups (Supabase)

Supabase provides **automatic daily backups** on paid plans:

- **Daily backups**: Retained for 7 days (Pro plan) or 30 days (Team/Enterprise)
- **Point-in-time recovery** (PITR): Up to 30 days on Pro+ plans
- **Location**: Same region as database (with option for multi-region)

#### Enable Backups

1. Go to Supabase Dashboard > Project Settings > Database
2. Enable "Point in Time Recovery" (Pro plan required)
3. Backups run automatically at 00:00 UTC daily

#### Manual Backup

For critical operations (migrations, major releases):

```bash
# Backup entire database
pg_dump "postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres" > backup_$(date +%Y%m%d_%H%M%S).sql

# Backup specific schema
pg_dump -n inventory -n supply_chain "postgresql://..." > backup_schemas.sql

# Backup with compression
pg_dump "postgresql://..." | gzip > backup.sql.gz
```

### Application Code (GitHub)

- **Main branch**: Protected, requires PR reviews
- **Tags**: Created for each production release (`v1.0.0`, `v1.1.0`, etc.)
- **Backups**: GitHub automatically retains all commits indefinitely

### Environment Variables (Vercel)

- **Storage**: Vercel Dashboard > Project Settings > Environment Variables
- **Backup**: Export to `.env.backup` file monthly (store securely, NOT in git)

```bash
# Export current env vars (do this manually via Vercel Dashboard)
vercel env pull .env.backup
```

Store `.env.backup` in **secure location**:
- Password manager (1Password, LastPass)
- Encrypted cloud storage (AWS S3 with encryption)
- Internal secrets management (Vault, AWS Secrets Manager)

### Edge Functions

- **Source code**: Stored in `supabase/functions/` (backed up via Git)
- **Deployment**: Can be redeployed from git at any time
- **Environment vars**: Stored in Supabase Dashboard > Edge Functions > Settings

---

## Restoration Procedures

### Database Restoration

#### Option 1: Supabase Dashboard (Easiest)

1. Go to Supabase Dashboard > Database > Backups
2. Select backup date/time
3. Click "Restore"
4. Confirm restoration (existing data will be replaced)
5. Wait 5-30 minutes depending on database size

#### Option 2: Manual Restore from Backup File

```bash
# Restore from SQL dump
psql "postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres" < backup.sql

# Restore compressed backup
gunzip -c backup.sql.gz | psql "postgresql://..."

# Restore specific schema only
psql "postgresql://..." < backup_schemas.sql
```

**⚠️ WARNING**: This will **overwrite** existing data. Always test on staging first.

#### Option 3: Point-in-Time Recovery

For Pro+ plans with PITR enabled:

1. Supabase Dashboard > Database > Backups
2. Click "Point in Time Recovery"
3. Select exact timestamp to restore to
4. Confirm restoration

### Application Restoration

#### Vercel Deployment Rollback

```bash
# List recent deployments
vercel ls

# Promote a previous deployment to production
vercel promote [deployment-url]

# Or: Redeploy from git tag
git checkout v1.0.0
vercel --prod
```

#### From GitHub

```bash
# Clone repository
git clone https://github.com/your-org/summit-inventory.git
cd summit-inventory

# Checkout specific release
git checkout v1.0.0

# Deploy to Vercel
vercel --prod
```

### Edge Functions Restoration

```bash
# Redeploy all Edge Functions
cd supabase/functions
supabase functions deploy events-poller
supabase functions deploy auth-callback
supabase functions deploy sso-accept-exchange
supabase functions deploy device_announce
```

### Environment Variables Restoration

1. Vercel Dashboard > Project Settings > Environment Variables
2. Import from `.env.backup` file (manual entry)
3. Redeploy application to apply new vars

---

## Disaster Scenarios

### Scenario 1: Accidental Data Deletion

**Symptoms**: User accidentally deletes critical data (items, POs, etc.)

**Recovery**:
1. Identify when deletion occurred (check events_outbox or audit logs)
2. Use PITR to restore to time before deletion
3. Validate restored data
4. Notify users of restoration

**Prevention**:
- Implement soft deletes (status = 'deleted')
- Require confirmation for bulk deletes
- Add "Recently Deleted" recovery UI

### Scenario 2: Database Corruption

**Symptoms**: Database queries failing, data integrity errors

**Recovery**:
1. Immediately take database offline (maintenance mode)
2. Contact Supabase support
3. Restore from latest known-good backup
4. Re-run migrations if needed
5. Validate data integrity
6. Bring database back online

**Prevention**:
- Regular database health checks
- Monitor query performance
- Test migrations on staging first

### Scenario 3: Complete Supabase Outage

**Symptoms**: Supabase project is inaccessible, region-wide outage

**Recovery**:
1. Check Supabase status page: https://status.supabase.com
2. Wait for Supabase to restore service (SLA: 99.9% uptime)
3. If extended outage (>4 hours), consider migration:
   - Restore database backup to new Supabase project
   - Update environment variables in Vercel
   - Redeploy application

**Prevention**:
- Multi-region failover (Enterprise plan)
- Regular backup exports
- Documented migration procedure

### Scenario 4: Vercel Deployment Failure

**Symptoms**: New deployment breaks production, app is down

**Recovery**:
1. Rollback to previous deployment (see "Application Restoration")
2. Identify cause of failure (check build logs)
3. Fix issue in code
4. Redeploy after testing on staging

**Prevention**:
- Require CI tests to pass before merge
- Use staging environment for validation
- Implement canary deployments

### Scenario 5: Data Breach / Security Incident

**Symptoms**: Unauthorized access detected, suspicious activity

**Recovery**:
1. **Immediately**: Rotate all secrets (JWT_SECRET, API keys, etc.)
2. Force logout all users (invalidate sessions)
3. Review audit logs (events_outbox, auth.audit_log_entries)
4. Identify compromised accounts
5. Notify affected users
6. Document incident
7. Implement additional security measures

**Prevention**:
- Enable 2FA for admin accounts
- Monitor failed login attempts
- Regular security audits
- Rate limiting on auth endpoints

---

## Testing & Validation

### Quarterly Backup Tests

**Schedule**: First Monday of each quarter

**Procedure**:
1. Create new Supabase project (staging)
2. Restore latest production backup
3. Deploy latest application code to staging
4. Perform smoke tests:
   - Login
   - View inventory list
   - Create test item
   - Create test PO
   - Verify events are processing
5. Document results
6. Delete staging project after test

### Annual Disaster Recovery Drill

**Schedule**: Once per year (e.g., January)

**Procedure**:
1. Simulate total production failure
2. Follow full restoration procedure
3. Measure actual RTO vs target
4. Identify gaps in documentation
5. Update procedures as needed

---

## Contact Information

### Incident Response Team

| Role | Name | Contact | Backup |
|------|------|---------|--------|
| **Tech Lead** | TBD | email@domain.com | phone |
| **DevOps** | TBD | email@domain.com | phone |
| **Database Admin** | TBD | email@domain.com | phone |

### External Support

| Service | Support URL | SLA |
|---------|-------------|-----|
| **Supabase** | https://supabase.com/support | Pro: 24h response |
| **Vercel** | https://vercel.com/support | Pro: 8h response |
| **GitHub** | https://support.github.com | Best effort |

### Escalation Path

1. **Detection**: Monitoring alerts or user reports
2. **Initial Response** (< 15 min): Tech Lead assesses severity
3. **Escalation** (if critical): Notify all team members
4. **Vendor Support** (if needed): Open support ticket
5. **Resolution**: Implement fix, validate
6. **Post-Mortem**: Document incident, update procedures

---

## Appendix

### Important URLs

- Production: https://inventory.your-domain.com
- Staging: https://inventory-stage.your-domain.com
- Supabase Dashboard: https://app.supabase.com
- Vercel Dashboard: https://vercel.com
- GitHub Repo: https://github.com/your-org/summit-inventory

### Backup Checklist

- [ ] Daily database backups enabled (automatic)
- [ ] PITR enabled (Supabase Pro plan)
- [ ] GitHub protected branch rules configured
- [ ] Environment variables documented
- [ ] Quarterly backup tests scheduled
- [ ] Incident response team identified
- [ ] Support contact information current
- [ ] This document reviewed in last 6 months

---

**Last Updated**: 2026-03-02
**Next Review**: 2026-09-02
**Document Owner**: Engineering Team
