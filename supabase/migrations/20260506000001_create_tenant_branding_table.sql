-- Local tenant branding table (mirrors Core's schema for compatibility)
-- Serves branding from our own DB; Core RPC is fallback
CREATE TABLE public.tenant_branding (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'Organization',
  logo_asset_id TEXT,
  primary_color TEXT NOT NULL DEFAULT '#1e40af',
  secondary_color TEXT NOT NULL DEFAULT '#475569',
  tertiary_color TEXT DEFAULT '#64748b',
  accent_color TEXT NOT NULL DEFAULT '#3b82f6',
  text_color TEXT NOT NULL DEFAULT '#111827',
  background_color TEXT NOT NULL DEFAULT '#f8fafc',
  button_color TEXT,
  button_text_color TEXT,
  button_hover_color TEXT,
  button_active_color TEXT,
  surface_color TEXT,
  surface_alt_color TEXT,
  border_color TEXT,
  border_subtle_color TEXT,
  border_focus_color TEXT,
  overlay_color TEXT,
  shadow_color_rgb TEXT,
  text_muted_color TEXT,
  text_disabled_color TEXT,
  text_on_primary_color TEXT,
  text_on_surface_color TEXT,
  primary_hover_color TEXT,
  primary_active_color TEXT,
  primary_disabled_color TEXT,
  primary_focus_color TEXT,
  secondary_hover_color TEXT,
  call_to_action_color TEXT,
  call_to_action_hover_color TEXT,
  disabled_color TEXT,
  disabled_text_color TEXT,
  info_color TEXT,
  info_hover_color TEXT,
  success_color TEXT,
  success_hover_color TEXT,
  warning_color TEXT,
  warning_hover_color TEXT,
  error_color TEXT,
  error_hover_color TEXT,
  font_family_title TEXT,
  font_weight_title TEXT,
  font_family_header TEXT,
  font_weight_header TEXT,
  font_family_subtitle TEXT,
  font_weight_subtitle TEXT,
  font_family_paragraph TEXT,
  font_weight_paragraph TEXT,
  gradient_hero JSONB,
  gradient_accent JSONB,
  gradient_button JSONB,
  gradient_primary JSONB,
  gradient_success JSONB,
  theme_config JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tenant_branding_tenant_id ON public.tenant_branding (tenant_id);
ALTER TABLE public.tenant_branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.tenant_branding
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "tenant_read_access" ON public.tenant_branding
  FOR SELECT TO authenticated
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
CREATE POLICY "public_read_access" ON public.tenant_branding
  FOR SELECT TO anon USING (true);

INSERT INTO public.tenant_branding (
  tenant_id, display_name, primary_color, secondary_color, accent_color,
  tertiary_color, text_color, background_color, surface_color, surface_alt_color,
  border_color, border_subtle_color, text_muted_color, text_on_primary_color,
  success_color, warning_color, error_color, info_color,
  button_color, button_text_color, button_hover_color
) VALUES (
  '052abee2-ffdc-470e-975a-b917dde72b8e',
  'Summit One',
  '#1e40af', '#475569', '#3b82f6', '#64748b', '#111827', '#f8fafc',
  '#ffffff', '#f1f5f9', '#e2e8f0', '#f1f5f9', '#64748b', '#ffffff',
  '#16a34a', '#d97706', '#dc2626', '#2563eb',
  '#1e40af', '#ffffff', '#1d4ed8'
);

CREATE OR REPLACE FUNCTION public.get_tenant_branding(target_tenant_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT to_jsonb(tb.*) FROM public.tenant_branding tb
  WHERE tb.tenant_id = target_tenant_id LIMIT 1;
$$;

GRANT SELECT ON public.tenant_branding TO authenticated;
GRANT SELECT ON public.tenant_branding TO anon;
GRANT ALL ON public.tenant_branding TO service_role;
GRANT EXECUTE ON FUNCTION public.get_tenant_branding(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_branding(UUID) TO anon;
