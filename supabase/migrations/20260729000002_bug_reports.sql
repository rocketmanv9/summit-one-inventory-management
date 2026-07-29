-- 00084: bug reporter (IDENTICAL table in ops/fleet/inventory) - the 🐛
-- button files who/where/what; the ops /bugs board federates all three and
-- AI-drafts Claude-ready prompts onto the rows.
CREATE TABLE IF NOT EXISTS bug_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  service TEXT NOT NULL,
  reporter_user_id UUID,
  reporter_name TEXT,
  page_url TEXT,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('annoying', 'normal', 'blocking')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'prompted', 'fixed', 'dismissed')),
  prompt TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_tenant ON bug_reports (tenant_id, created_at DESC);
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bug_reports_service_role ON bug_reports;
CREATE POLICY bug_reports_service_role ON bug_reports FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS bug_reports_tenant_read ON bug_reports;
CREATE POLICY bug_reports_tenant_read ON bug_reports FOR SELECT TO authenticated
  USING (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid);
DROP TRIGGER IF EXISTS bug_reports_updated_at ON bug_reports;
CREATE TRIGGER bug_reports_updated_at BEFORE UPDATE ON bug_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
