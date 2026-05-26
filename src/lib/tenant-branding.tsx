'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getAuthToken, getTenantIdFromToken } from '@/lib/auth-token';

// ---------------------------------------------------------------------------
// Types — matches Core's get_tenant_branding RPC response
// ---------------------------------------------------------------------------

type TenantGradient = {
  start: string;
  end: string;
  angle_degrees: number;
};

export interface TenantBranding {
  tenant_id: string;
  display_name: string;
  logo_asset_id: string | null;
  logo_url: string | null;

  // Core palette
  primary_color: string;
  secondary_color: string;
  tertiary_color: string;
  accent_color: string;
  text_color: string;
  background_color: string;

  // Extended palette
  button_color?: string;
  button_text_color?: string;
  button_hover_color?: string;
  button_active_color?: string;
  surface_color?: string;
  surface_alt_color?: string;
  border_color?: string;
  border_subtle_color?: string;
  border_focus_color?: string;
  overlay_color?: string;
  shadow_color_rgb?: string;
  text_muted_color?: string;
  text_disabled_color?: string;
  text_on_primary_color?: string;
  text_on_surface_color?: string;
  primary_hover_color?: string;
  primary_active_color?: string;
  primary_disabled_color?: string;
  primary_focus_color?: string;
  secondary_hover_color?: string;
  call_to_action_color?: string;
  call_to_action_hover_color?: string;
  disabled_color?: string;
  disabled_text_color?: string;

  // Status colors
  info_color?: string;
  info_hover_color?: string;
  success_color?: string;
  success_hover_color?: string;
  warning_color?: string;
  warning_hover_color?: string;
  error_color?: string;
  error_hover_color?: string;

  // Fonts
  font_family_title?: string;
  font_weight_title?: string;
  font_family_header?: string;
  font_weight_header?: string;
  font_family_subtitle?: string;
  font_weight_subtitle?: string;
  font_family_paragraph?: string;
  font_weight_paragraph?: string;

  // Gradients
  gradient_hero?: TenantGradient;
  gradient_accent?: TenantGradient;
  gradient_button?: TenantGradient;
  gradient_primary?: TenantGradient;
  gradient_success?: TenantGradient;

  // Raw theme_config passthrough
  theme_config?: Record<string, unknown>;

  updated_at?: string;
}

// ---------------------------------------------------------------------------
// Fallback branding
// ---------------------------------------------------------------------------

export const fallbackBranding: TenantBranding = {
  tenant_id: '',
  display_name: 'Summit One',
  logo_asset_id: null,
  logo_url: null,
  primary_color: '#1e40af',
  secondary_color: '#475569',
  accent_color: '#3b82f6',
  tertiary_color: '#64748b',
  text_color: '#111827',
  background_color: '#f8fafc',
};

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function hexToHsl(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '0 0% 0%';

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return `0 0% ${Math.round(l * 100)}%`;
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function isValidHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Darken a hex color by the given factor (0–1). */
function darkenHex(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.round(rgb.r * (1 - factor));
  const g = Math.round(rgb.g * (1 - factor));
  const b = Math.round(rgb.b * (1 - factor));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Compute contrast foreground (white or dark) for a given hex background. */
function contrastForeground(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness > 128 ? '#111827' : '#ffffff';
}

/** Convert hex to {h, s, l} where h is 0-360, s/l are 0-1. */
function hexToHslRaw(hex: string): { h: number; s: number; l: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s, l };
}

/**
 * Generate a full Tailwind-style color scale (50–950) from a single hex
 * seed color. Returns an object keyed by shade number → HSL string
 * (space-separated, no hsl() wrapper) suitable for CSS custom properties.
 *
 * The lightness ramp mirrors Tailwind's default scale shape:
 *   50=97%  100=93%  200=87%  300=78%  400=68%  500=60%
 *   600=53% 700=48%  800=40%  900=33%  950=21%
 *
 * Saturation tapers slightly at the extremes so very light and very dark
 * shades don't look neon.
 */
function generateColorScale(hex: string): Record<string, string> {
  const hsl = hexToHslRaw(hex);
  if (!hsl) return {};

  const h = Math.round(hsl.h);
  const baseSat = hsl.s;

  // Lightness targets for each shade (percentage, 0-100)
  const shades: [string, number, number][] = [
    // [shade, lightness%, saturation multiplier]
    ['50',  97, 1.0],
    ['100', 93, 0.95],
    ['200', 87, 0.93],
    ['300', 78, 0.90],
    ['400', 68, 0.90],
    ['500', 60, 1.0],
    ['600', 53, 1.0],
    ['700', 48, 0.95],
    ['800', 40, 0.90],
    ['900', 33, 0.85],
    ['950', 21, 0.80],
  ];

  const result: Record<string, string> = {};
  for (const [shade, lightness, satMul] of shades) {
    const s = Math.round(Math.min(100, baseSat * satMul * 100));
    result[shade] = `${h} ${s}% ${lightness}%`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Response parsing — mirrors Portal's parseBrandingPayload
// ---------------------------------------------------------------------------

function str(source: Record<string, unknown>, key: string): string | undefined {
  const v = source[key];
  return typeof v === 'string' ? v : undefined;
}

function strAny(
  source: Record<string, unknown> | null | undefined,
  keys: string[],
): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = str(source, key);
    if (value) return value;
  }
  return undefined;
}

function parseGradient(
  source: Record<string, unknown>,
  key: string,
): TenantGradient | undefined {
  const g = source[key];
  if (!g || typeof g !== 'object') return undefined;
  const obj = g as Record<string, unknown>;
  if (typeof obj.start !== 'string' || typeof obj.end !== 'string') return undefined;
  return {
    start: obj.start,
    end: obj.end,
    angle_degrees: typeof obj.angle_degrees === 'number' ? obj.angle_degrees : 180,
  };
}

function parseBrandingPayload(data: unknown): TenantBranding | null {
  if (Array.isArray(data) && data.length > 0) {
    return parseBrandingPayload(data[0]);
  }

  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;

  // Handle nested RPC response shapes
  const rpcPayload =
    record.get_public_branding && typeof record.get_public_branding === 'object'
      ? (record.get_public_branding as Record<string, unknown>)
      : null;
  const nestedBranding =
    record.branding && typeof record.branding === 'object'
      ? (record.branding as Record<string, unknown>)
      : null;
  const source = rpcPayload ?? nestedBranding ?? record;

  const tenantId =
    (typeof record.tenant_id === 'string' ? record.tenant_id : null) ??
    (typeof source.tenant_id === 'string' ? source.tenant_id : null);

  if (!tenantId) return null;

  // Nested theme_config provides structured overrides
  const tc =
    source.theme_config && typeof source.theme_config === 'object'
      ? (source.theme_config as Record<string, unknown>)
      : null;
  const tcColors =
    tc?.colors && typeof tc.colors === 'object'
      ? (tc.colors as Record<string, unknown>)
      : null;
  const tcFonts =
    tc?.fonts && typeof tc.fonts === 'object'
      ? (tc.fonts as Record<string, unknown>)
      : null;
  const tcGradients =
    tc?.gradients && typeof tc.gradients === 'object'
      ? (tc.gradients as Record<string, unknown>)
      : null;

  const color = (key: string) =>
    strAny(source, [key]) ?? strAny(tcColors, [key]);
  const font = (key: string, aliases: string[] = []) =>
    strAny(source, [key, ...aliases]) ?? strAny(tcFonts, [key, ...aliases]);
  const gradient = (key: string) =>
    tcGradients ? parseGradient(tcGradients, key) : undefined;

  return {
    tenant_id: tenantId,
    display_name:
      typeof source.display_name === 'string'
        ? source.display_name
        : typeof source.name === 'string'
          ? (source.name as string)
          : 'Organization',
    logo_asset_id:
      typeof source.logo_asset_id === 'string' ? source.logo_asset_id : null,
    logo_url:
      typeof source.logo_url === 'string' ? source.logo_url : null,

    // Core palette
    primary_color: color('primary_color') ?? '#1e40af',
    secondary_color: color('secondary_color') ?? '#475569',
    accent_color: color('accent_color') ?? '#3b82f6',
    tertiary_color: color('tertiary_color') ?? '#64748b',
    text_color: color('text_color') ?? '#111827',
    background_color: color('background_color') ?? '#f8fafc',

    // Extended palette
    button_color: color('button_color'),
    button_text_color: color('button_text_color'),
    button_hover_color: color('button_hover_color'),
    button_active_color: color('button_active_color'),
    surface_color: color('surface_color'),
    surface_alt_color: color('surface_alt_color'),
    border_color: color('border_color'),
    border_subtle_color: color('border_subtle_color'),
    border_focus_color: color('border_focus_color'),
    overlay_color: color('overlay_color'),
    shadow_color_rgb: color('shadow_color_rgb'),
    text_muted_color: color('text_muted_color'),
    text_disabled_color: color('text_disabled_color'),
    text_on_primary_color: color('text_on_primary_color'),
    text_on_surface_color: color('text_on_surface_color'),
    primary_hover_color: color('primary_hover_color'),
    primary_active_color: color('primary_active_color'),
    primary_disabled_color: color('primary_disabled_color'),
    primary_focus_color: color('primary_focus_color'),
    secondary_hover_color: color('secondary_hover_color'),
    call_to_action_color: color('call_to_action_color'),
    call_to_action_hover_color: color('call_to_action_hover_color'),
    disabled_color: color('disabled_color'),
    disabled_text_color: color('disabled_text_color'),

    // Status colors
    info_color: color('info_color'),
    info_hover_color: color('info_hover_color'),
    success_color: color('success_color'),
    success_hover_color: color('success_hover_color'),
    warning_color: color('warning_color'),
    warning_hover_color: color('warning_hover_color'),
    error_color: color('error_color'),
    error_hover_color: color('error_hover_color'),

    // Fonts
    font_family_title: font('font_family_title', ['title_font_family']),
    font_weight_title: font('font_weight_title', ['title_font_weight']),
    font_family_header: font('font_family_header', ['header_font_family']),
    font_weight_header: font('font_weight_header', ['header_font_weight']),
    font_family_subtitle: font('font_family_subtitle', ['subtitle_font_family']),
    font_weight_subtitle: font('font_weight_subtitle', ['subtitle_font_weight']),
    font_family_paragraph: font('font_family_paragraph', [
      'paragraph_font_family', 'body_font_family',
    ]),
    font_weight_paragraph: font('font_weight_paragraph', [
      'paragraph_font_weight', 'body_font_weight',
    ]),

    // Gradients
    gradient_hero: gradient('hero_gradient'),
    gradient_accent: gradient('accent_gradient'),
    gradient_button: gradient('button_gradient'),
    gradient_primary: gradient('primary_gradient'),
    gradient_success: gradient('success_gradient'),

    theme_config: tc ? (tc as Record<string, unknown>) : undefined,
    updated_at:
      typeof source.updated_at === 'string' ? source.updated_at : undefined,
  };
}

// ---------------------------------------------------------------------------
// CSS variable application — maps Core branding → shadcn HSL vars
// ---------------------------------------------------------------------------

export function applyCssVariables(b: TenantBranding) {
  const root = document.documentElement;

  const setHsl = (prop: string, hex: string | undefined) => {
    if (isValidHex(hex)) {
      root.style.setProperty(prop, hexToHsl(hex));
      root.style.setProperty(`${prop}-hex`, hex);
    }
  };

  // --- Primary (from branding primary_color) ---
  setHsl('--primary', b.primary_color);
  setHsl('--primary-foreground', b.text_on_primary_color ?? contrastForeground(b.primary_color));
  setHsl('--ring', b.primary_focus_color ?? b.accent_color);

  // --- Secondary (from branding secondary_color) ---
  setHsl('--secondary', b.surface_alt_color ?? b.secondary_color);
  setHsl('--secondary-foreground', b.text_on_surface_color ?? b.text_color);

  // --- Accent (from branding accent_color) ---
  setHsl('--accent', b.accent_color);
  setHsl('--accent-foreground', contrastForeground(b.accent_color));

  // --- Muted ---
  setHsl('--muted', b.surface_alt_color ?? b.background_color);
  setHsl('--muted-foreground', b.text_muted_color ?? b.tertiary_color);

  // --- Background / foreground ---
  setHsl('--background', b.background_color);
  setHsl('--foreground', b.text_color);

  // --- Card / popover (use surface_color or background) ---
  setHsl('--card', b.surface_color ?? b.background_color);
  setHsl('--card-foreground', b.text_on_surface_color ?? b.text_color);
  setHsl('--popover', b.surface_color ?? b.background_color);
  setHsl('--popover-foreground', b.text_on_surface_color ?? b.text_color);

  // --- Borders & inputs ---
  setHsl('--border', b.border_color ?? b.border_subtle_color);
  setHsl('--input', b.border_color ?? b.border_subtle_color);

  // --- Button overrides (fall back to primary when not set) ---
  if (isValidHex(b.button_color)) {
    setHsl('--btn-bg', b.button_color);
    setHsl('--btn-fg', b.button_text_color ?? contrastForeground(b.button_color));
  }
  if (isValidHex(b.button_hover_color)) setHsl('--btn-hover', b.button_hover_color);
  if (isValidHex(b.button_active_color)) setHsl('--btn-active', b.button_active_color);
  if (isValidHex(b.call_to_action_color)) setHsl('--cta', b.call_to_action_color);
  if (isValidHex(b.call_to_action_hover_color)) setHsl('--cta-hover', b.call_to_action_hover_color);
  if (isValidHex(b.disabled_color)) setHsl('--disabled', b.disabled_color);
  if (isValidHex(b.disabled_text_color)) setHsl('--disabled-fg', b.disabled_text_color);

  // --- Primary variant overrides ---
  if (isValidHex(b.primary_hover_color)) setHsl('--primary-hover', b.primary_hover_color);
  if (isValidHex(b.primary_active_color)) setHsl('--primary-active', b.primary_active_color);
  if (isValidHex(b.primary_disabled_color)) setHsl('--primary-disabled', b.primary_disabled_color);
  if (isValidHex(b.secondary_hover_color)) setHsl('--secondary-hover', b.secondary_hover_color);

  // --- Overlay ---
  if (isValidHex(b.overlay_color)) setHsl('--overlay', b.overlay_color);

  // --- Status colors ---
  if (isValidHex(b.error_color)) {
    setHsl('--destructive', b.error_color);
    setHsl('--destructive-foreground', contrastForeground(b.error_color));
  }
  if (isValidHex(b.error_hover_color)) setHsl('--destructive-hover', b.error_hover_color);
  if (isValidHex(b.success_color)) {
    setHsl('--success', b.success_color);
    setHsl('--success-foreground', contrastForeground(b.success_color));
  }
  if (isValidHex(b.success_hover_color)) setHsl('--success-hover', b.success_hover_color);
  if (isValidHex(b.warning_color)) {
    setHsl('--warning', b.warning_color);
    setHsl('--warning-foreground', contrastForeground(b.warning_color));
  }
  if (isValidHex(b.warning_hover_color)) setHsl('--warning-hover', b.warning_hover_color);
  if (isValidHex(b.info_color)) {
    setHsl('--info', b.info_color);
    setHsl('--info-foreground', contrastForeground(b.info_color));
  }
  if (isValidHex(b.info_hover_color)) setHsl('--info-hover', b.info_hover_color);

  // --- Sidebar — derived from primary color ---
  if (isValidHex(b.primary_color)) {
    const sidebarBg = darkenHex(b.primary_color, 0.85);
    const sidebarBorder = darkenHex(b.primary_color, 0.75);
    const sidebarAccent = darkenHex(b.primary_color, 0.70);

    setHsl('--sidebar-background', sidebarBg);
    setHsl('--sidebar-foreground', '#f1f5f9');
    setHsl('--sidebar-border', sidebarBorder);
    setHsl('--sidebar-accent', sidebarAccent);
    setHsl('--sidebar-accent-foreground', '#f1f5f9');
  }

  // --- Charts — derive from palette ---
  setHsl('--chart-1', b.primary_color);
  setHsl('--chart-2', b.accent_color);
  if (isValidHex(b.success_color)) setHsl('--chart-3', b.success_color);
  if (isValidHex(b.warning_color)) setHsl('--chart-4', b.warning_color);
  if (isValidHex(b.error_color)) setHsl('--chart-5', b.error_color);

  // --- Brandable blue & teal scales ---
  // Generate a full 50–950 color ramp from the primary color and apply it
  // to both the --blue-* and --teal-* CSS variables. This means every
  // existing `bg-blue-600`, `text-blue-700`, `border-teal-400`, etc. class
  // automatically reflects the tenant's branding without any class renames.
  if (isValidHex(b.primary_color)) {
    const scale = generateColorScale(b.primary_color);
    for (const [shade, hsl] of Object.entries(scale)) {
      root.style.setProperty(`--blue-${shade}`, hsl);
      root.style.setProperty(`--teal-${shade}`, hsl);
    }
  }

  // --- Fonts ---
  const setFont = (prop: string, value: string | undefined) => {
    if (value) root.style.setProperty(prop, value);
  };
  setFont('--font-title', b.font_family_title);
  setFont('--font-title-weight', b.font_weight_title);
  setFont('--font-header', b.font_family_header);
  setFont('--font-header-weight', b.font_weight_header);
  setFont('--font-paragraph', b.font_family_paragraph);
  setFont('--font-paragraph-weight', b.font_weight_paragraph);

  // Load Google Fonts dynamically
  const googleFamilies = new Set<string>();
  const systemFonts = ['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Inter', 'sans-serif', 'serif', 'monospace'];
  const addFont = (family: string | undefined, weight: string | undefined) => {
    if (family && !systemFonts.includes(family)) {
      googleFamilies.add(`${family.replace(/ /g, '+')}:wght@${weight || '400;700'}`);
    }
  };
  addFont(b.font_family_title, b.font_weight_title);
  addFont(b.font_family_header, b.font_weight_header);
  addFont(b.font_family_paragraph, b.font_weight_paragraph);

  if (googleFamilies.size > 0) {
    const id = 'tenant-google-fonts';
    let link = document.getElementById(id) as HTMLLinkElement | null;
    const href = `https://fonts.googleapis.com/css2?${[...googleFamilies].map((f) => `family=${f}`).join('&')}&display=swap`;
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = href;
  }

  // --- Gradients ---
  const gradientCSS = (g: TenantGradient) =>
    `linear-gradient(${g.angle_degrees}deg, ${g.start}, ${g.end})`;
  if (b.gradient_hero) root.style.setProperty('--gradient-hero', gradientCSS(b.gradient_hero));
  if (b.gradient_accent) root.style.setProperty('--gradient-accent', gradientCSS(b.gradient_accent));
  if (b.gradient_primary) root.style.setProperty('--gradient-primary', gradientCSS(b.gradient_primary));
}

// ---------------------------------------------------------------------------
// Branding fetch — Core first (production data), local DB fallback (dev)
// ---------------------------------------------------------------------------

// Core Supabase — configured instance (may be dev, stage, or prod)
const CORE_SUPABASE_URL =
  process.env.NEXT_PUBLIC_CORE_SUPABASE_URL || '';
const CORE_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_CORE_SUPABASE_ANON_KEY || '';

// Core Supabase stage — branding data lives here; used as fallback
const CORE_STAGE_URL = 'https://ycszguaqawbxjwehhhqx.supabase.co';
const CORE_STAGE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljc3pndWFxYXdieGp3ZWhoaHF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NjUzMDksImV4cCI6MjA5MTI0MTMwOX0.gwTth23_dGqrnnhnfdZ4KB9KRBxmwBZSemwewBzopMg';

async function resolveLogoUrl(
  coreUrl: string,
  coreKey: string,
  tenantId: string,
  logoAssetId: string,
): Promise<string | null> {
  try {
    const prefix = `tenants/${tenantId}/tenant_logo/${logoAssetId}/`;
    const res = await fetch(`${coreUrl}/storage/v1/object/list/brand-assets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: coreKey,
        Authorization: `Bearer ${coreKey}`,
      },
      body: JSON.stringify({ prefix, limit: 1 }),
    });
    if (!res.ok) return null;

    const files = await res.json();
    if (!Array.isArray(files) || files.length === 0) return null;

    const fileName = files[0].name;
    if (typeof fileName !== 'string') return null;

    return `${coreUrl}/storage/v1/object/public/brand-assets/${prefix}${fileName}`;
  } catch {
    return null;
  }
}

async function fetchBrandingFromCoreInstance(
  url: string,
  key: string,
  tenantId: string,
): Promise<TenantBranding | null> {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_public_branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ target_tenant_id: tenantId }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const branding = parseBrandingPayload(data);
    if (!branding) return null;

    // Resolve the logo storage path into a full public URL
    if (branding.logo_asset_id && !branding.logo_url) {
      branding.logo_url = await resolveLogoUrl(
        url, key, branding.tenant_id, branding.logo_asset_id,
      );
    }

    return branding;
  } catch {
    return null;
  }
}

async function fetchBrandingFromCore(tenantId: string): Promise<TenantBranding | null> {
  // Try the configured Core instance first (env-based)
  if (CORE_SUPABASE_URL && CORE_SUPABASE_ANON_KEY) {
    const result = await fetchBrandingFromCoreInstance(
      CORE_SUPABASE_URL,
      CORE_SUPABASE_ANON_KEY,
      tenantId,
    );
    if (result) return result;
  }

  // Fall back to Core stage (where branding data lives)
  if (CORE_SUPABASE_URL !== CORE_STAGE_URL) {
    const result = await fetchBrandingFromCoreInstance(
      CORE_STAGE_URL,
      CORE_STAGE_KEY,
      tenantId,
    );
    if (result) return result;
  }

  return null;
}

async function fetchBrandingFromLocal(tenantId: string): Promise<TenantBranding | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  try {
    const res = await fetch(
      `${url}/rest/v1/tenant_branding?tenant_id=eq.${tenantId}&select=*&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return parseBrandingPayload(data[0]);
  } catch {
    return null;
  }
}

async function fetchBranding(tenantId: string): Promise<TenantBranding | null> {
  // Try local DB first (admin-saved overrides take precedence)
  const local = await fetchBrandingFromLocal(tenantId);
  if (local) return local;

  // Fall back to Core (production branding data)
  return fetchBrandingFromCore(tenantId);
}

// ---------------------------------------------------------------------------
// localStorage cache helpers
// ---------------------------------------------------------------------------

function getCachedBranding(tenantId: string): TenantBranding | null {
  try {
    const raw = localStorage.getItem(`branding_${tenantId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed._cachedAt && Date.now() - parsed._cachedAt > 5 * 60 * 1000) {
      return null;
    }
    return parseBrandingPayload(parsed);
  } catch {
    return null;
  }
}

function setCachedBranding(tenantId: string, branding: TenantBranding) {
  try {
    localStorage.setItem(
      `branding_${tenantId}`,
      JSON.stringify({ ...branding, _cachedAt: Date.now() })
    );
  } catch {
    // localStorage full or unavailable — non-critical
  }
}

// ---------------------------------------------------------------------------
// React Context
// ---------------------------------------------------------------------------

interface TenantBrandingContextValue {
  branding: TenantBranding;
  isLoaded: boolean;
  tenantId: string | null;
}

const TenantBrandingContext = createContext<TenantBrandingContextValue>({
  branding: fallbackBranding,
  isLoaded: false,
  tenantId: null,
});

export function useTenantBranding() {
  return useContext(TenantBrandingContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 60_000; // 60 seconds

export function TenantBrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<TenantBranding>(fallbackBranding);
  const [isLoaded, setIsLoaded] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;

    const apply = (b: TenantBranding) => {
      if (disposed) return;
      setBranding(b);
      setIsLoaded(true);
      applyCssVariables(b);
    };

    async function loadBranding() {
      const token = await getAuthToken();
      if (!token || disposed) return;

      const tid = getTenantIdFromToken(token);
      if (!tid || disposed) return;

      setTenantId(tid);

      // Apply cached branding first for instant paint
      const cached = getCachedBranding(tid);
      if (cached) {
        apply(cached);
        console.log(`[Branding] Applied cached branding for tenant=${tid}`);
      }

      // Fetch fresh (local DB first, then Core fallback)
      const fresh = await fetchBranding(tid);
      if (fresh && !disposed) {
        apply(fresh);
        setCachedBranding(tid, fresh);
        console.log(`[Branding] Applied tenant=${tid} branding (updated_at=${fresh.updated_at ?? 'n/a'})`);
      } else if (!cached && !disposed) {
        setIsLoaded(true);
      }
    }

    loadBranding();

    // Poll every 60s for branding updates
    pollRef.current = setInterval(async () => {
      if (document.hidden || disposed) return;
      const token = await getAuthToken();
      if (!token) return;
      const tid = getTenantIdFromToken(token);
      if (!tid) return;

      const fresh = await fetchBranding(tid);
      if (fresh && !disposed) {
        apply(fresh);
        setCachedBranding(tid, fresh);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      mountedRef.current = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // Pause polling when tab is hidden, resume when visible
  useEffect(() => {
    function handleVisibility() {
      if (document.hidden && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      } else if (!document.hidden && !pollRef.current) {
        (async () => {
          const token = await getAuthToken();
          if (!token) return;
          const tid = getTenantIdFromToken(token);
          if (!tid) return;
          const fresh = await fetchBranding(tid);
          if (fresh && mountedRef.current) {
            setBranding(fresh);
            applyCssVariables(fresh);
            setCachedBranding(tid, fresh);
          }
        })();

        pollRef.current = setInterval(async () => {
          if (document.hidden) return;
          const token = await getAuthToken();
          if (!token) return;
          const tid = getTenantIdFromToken(token);
          if (!tid) return;
          const fresh = await fetchBranding(tid);
          if (fresh && mountedRef.current) {
            setBranding(fresh);
            applyCssVariables(fresh);
            setCachedBranding(tid, fresh);
          }
        }, POLL_INTERVAL_MS);
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return (
    <TenantBrandingContext.Provider value={{ branding, isLoaded, tenantId }}>
      {children}
    </TenantBrandingContext.Provider>
  );
}
