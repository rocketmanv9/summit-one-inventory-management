-- Mark already-applied migrations as complete
INSERT INTO supabase_migrations.schema_migrations (version) VALUES
('20260106000012'),
('20260106000013'),
('20260106000014')
ON CONFLICT (version) DO NOTHING;
