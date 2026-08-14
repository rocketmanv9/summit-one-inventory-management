/**
 * Amazon product-link resolver (sprint 2026-08-14 item 05).
 *
 * One job: turn a pasted Amazon URL into an ASIN (+ whatever product details we
 * can honestly get) so a buyer never has to detour to a settings page to map an
 * item before ordering it.
 *
 * Order of operations is deliberate:
 *   1. Parse the ASIN out of the URL SHAPE. This is deterministic, offline, and
 *      by far the most reliable signal — /dp/<ASIN>, /gp/product/<ASIN>, etc.
 *   2. Short links (a.co, amzn.to, amzn.eu) carry no ASIN, so we follow the
 *      redirect server-side (manual redirects, bounded hops) and re-parse.
 *   3. ONLY THEN do we fetch the product page for title/image/price. Amazon
 *      blocks datacenter IPs and serves captchas constantly — so this step is
 *      best-effort garnish. An ASIN on its own is a SUCCESS.
 *
 * No SP-API. The Amazon dev account is intentionally lapsed (cXML punchout
 * only) — do not add signed-API calls here.
 *
 * SERVER-ONLY (does outbound fetches + admin DB reads). Imported by
 * /api/inventory/amazon/resolve-link, /api/inventory/amazon/map-item, and
 * anywhere else that wants "paste a link, get a mapping".
 */

import { AppError } from '@rocketmanv9/chassis/errors';

import { getAdminClient } from '@/utils/supabase/admin';

/** How the details on a resolution were obtained. */
export type AmazonResolveSource =
  /** ASIN came from the URL shape; the page fetch added nothing (blocked/skipped). */
  | 'parsed'
  /** ASIN known AND the product page gave us at least one real detail. */
  | 'fetched'
  /** Nothing usable — no ASIN. `message` explains what to do instead. */
  | 'degraded';

export interface AmazonLinkResolution {
  /** True whenever we have an ASIN — details are a bonus, never a requirement. */
  ok: boolean;
  asin: string | null;
  title: string | null;
  /** Parsed list price in dollars, when the page gave one up. */
  price: number | null;
  image_url: string | null;
  /** Canonical https://www.amazon.com/dp/<ASIN> — stable, shareable, no tracking. */
  source_url: string | null;
  /** The URL the buyer actually pasted (after short-link expansion). */
  input_url: string;
  source: AmazonResolveSource;
  /** Always human-readable; the UI shows it verbatim. */
  message: string;
}

/** ASINs are exactly 10 chars of upper-case alphanumerics. */
const ASIN_RE = /^[A-Z0-9]{10}$/;

const PAGE_FETCH_TIMEOUT_MS = 8_000;
const REDIRECT_TIMEOUT_MS = 6_000;
const MAX_REDIRECT_HOPS = 5;
/** Only read the head of the document — the meta tags we want are all up top. */
const MAX_HTML_BYTES = 600_000;

/** A real desktop UA. Amazon serves a stripped page (or a captcha) to obvious bots. */
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ── URL shape ────────────────────────────────────────────────────────────────

/** Add a scheme when the buyer pasted a bare host, and reject anything unparseable. */
function toUrl(raw: string): URL | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    // Only http(s) — never let a data:/file:/javascript: URL reach fetch().
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

const AMAZON_HOST_RE = /(^|\.)amazon\.[a-z.]{2,}$/i;
const SHORT_HOST_RE = /^(a\.co|amzn\.to|amzn\.eu|amzn\.com|www\.amzn\.to)$/i;

/** amazon.com / amazon.co.uk / smile.amazon.com / a.co / amzn.to — all true. */
export function isAmazonUrl(raw: string): boolean {
  const u = toUrl(raw);
  if (!u) return false;
  return AMAZON_HOST_RE.test(u.hostname) || SHORT_HOST_RE.test(u.hostname);
}

function isShortLink(raw: string): boolean {
  const u = toUrl(raw);
  return !!u && SHORT_HOST_RE.test(u.hostname);
}

/**
 * Pull the ASIN out of an Amazon URL's shape alone — no network.
 *
 * Handles the shapes buyers actually paste:
 *   /dp/B08N5WRWNW            /dp/B08N5WRWNW/ref=...
 *   /gp/product/B08N5WRWNW    /gp/aw/d/B08N5WRWNW
 *   /Some-Product-Name/dp/B08N5WRWNW
 *   /gp/offer-listing/B08N5WRWNW
 *   ?asin=B08N5WRWNW  /  #asin=B08N5WRWNW
 *
 * Returns null for short links (they genuinely carry no ASIN) and for anything
 * that isn't an Amazon URL — we never guess an ASIN out of a random 10-char
 * path segment on someone else's site.
 */
export function parseAsinFromUrl(raw: string): string | null {
  const u = toUrl(raw);
  if (!u) return null;
  if (!AMAZON_HOST_RE.test(u.hostname)) return null;

  // Explicit query/fragment params win — they're unambiguous.
  const paramAsin = u.searchParams.get('asin') ?? u.searchParams.get('ASIN');
  if (paramAsin && ASIN_RE.test(paramAsin.toUpperCase())) return paramAsin.toUpperCase();

  const segments = u.pathname.split('/').filter(Boolean);
  const KEYS = new Set(['dp', 'product', 'd', 'offer-listing', 'product-reviews', 'asin']);
  for (let i = 0; i < segments.length; i++) {
    if (!KEYS.has(segments[i].toLowerCase())) continue;
    const candidate = (segments[i + 1] || '').toUpperCase();
    if (ASIN_RE.test(candidate)) return candidate;
  }

  // Last resort: a lone 10-char token anywhere in the path of an amazon.* URL.
  // Guarded to tokens that look like ASINs (must contain a digit — real slugs
  // like "Sunglasses" are pure letters).
  for (const seg of segments) {
    const s = seg.toUpperCase();
    if (ASIN_RE.test(s) && /\d/.test(s)) return s;
  }
  return null;
}

/** The canonical, tracking-free product URL we persist and link out to. */
export function canonicalAmazonUrl(asin: string): string {
  return `https://www.amazon.com/dp/${asin}`;
}

/** /s?k=…, /b?node=…, /stores/… — a list of products, not a product. */
function isSearchOrBrowseUrl(u: URL): boolean {
  const path = u.pathname.toLowerCase();
  if (/^\/(s|b|gp\/search|gp\/browse\.html|stores|deal|gp\/bestsellers)(\/|$)/.test(path)) return true;
  return u.searchParams.has('k') || u.searchParams.has('keywords') || u.searchParams.has('node');
}

// ── Network ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(init?.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Expand a.co / amzn.to short links by following Location headers ourselves.
 * Bounded hops, and we stop the moment a hop yields an ASIN.
 */
async function expandShortLink(raw: string): Promise<string> {
  let current = toUrl(raw)?.toString() ?? raw;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetchWithTimeout(current, REDIRECT_TIMEOUT_MS, { redirect: 'manual' });
    } catch {
      return current; // network/timeout — caller degrades on the un-expanded URL
    }
    // Drain nothing: a manual-redirect response has no body worth reading.
    if (res.status < 300 || res.status >= 400) return current;
    const location = res.headers.get('location');
    if (!location) return current;
    try {
      current = new URL(location, current).toString();
    } catch {
      return current;
    }
    if (parseAsinFromUrl(current)) return current;
  }
  return current;
}

/** Read at most MAX_HTML_BYTES of the body so a huge page can't balloon memory. */
async function readCappedText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, MAX_HTML_BYTES);
  const decoder = new TextDecoder('utf-8');
  let out = '';
  try {
    while (out.length < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  return out.slice(0, MAX_HTML_BYTES);
}

// ── HTML parsing (best-effort) ───────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/**
 * <meta property="og:title" content="..."> in either attribute order.
 *
 * The capture uses a BACKREFERENCE to the opening quote, not `[^"']+` — Amazon
 * titles are full of apostrophes ("Scotch Painter's Tape"), and a naive class
 * truncates them at the first one.
 */
function metaContent(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=(["'])([\\s\\S]*?)\\1`, 'i'),
    new RegExp(`<meta[^>]+content=(["'])([\\s\\S]*?)\\1[^>]*(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[2]) return decodeEntities(m[2]).trim() || null;
  }
  return null;
}

/**
 * The product hero image. og:image is the happy path; Amazon product pages very
 * often omit it, so fall back to the image JSON they embed inline.
 */
function findImageUrl(html: string): string | null {
  const og = metaContent(html, 'og:image');
  if (og && /^https?:\/\//i.test(og)) return og;

  const patterns = [
    /data-old-hires=["'](https:\/\/[^"']+)["']/i,
    /"hiRes"\s*:\s*"(https:\/\/[^"]+)"/i,
    /"large"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/i,
    /id=["']landingImage["'][^>]*\ssrc=["'](https:\/\/[^"']+)["']/i,
    /(https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9._-]+\.jpg)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].replace(/\\u002F/gi, '/');
  }
  return null;
}

function parsePriceString(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100;
  if (typeof v !== 'string') return null;
  const m = v.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Walk JSON-LD blocks looking for an offers.price. Amazon sometimes ships one. */
function priceFromJsonLd(html: string): number | null {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      const offers = node?.offers;
      const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
      for (const offer of offerList) {
        const p = parsePriceString(offer?.price ?? offer?.lowPrice);
        if (p != null) return p;
      }
    }
  }
  return null;
}

/**
 * Amazon's own price markup, in descending order of trust. `a-offscreen` is the
 * screen-reader price span and is the most durable of a bad bunch.
 */
function priceFromAmazonMarkup(html: string): number | null {
  const patterns = [
    /id=["']priceblock_ourprice["'][^>]*>\s*([^<]+)</i,
    /id=["']priceblock_dealprice["'][^>]*>\s*([^<]+)</i,
    /class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*\$?([\d,]+\.\d{2})\s*</i,
    /"priceAmount"\s*:\s*([\d.]+)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    const p = parsePriceString(m?.[1]);
    if (p != null) return p;
  }
  return null;
}

/** Cheap captcha/robot-check detector so we can say WHY we degraded. */
function looksBlocked(html: string): boolean {
  const head = html.slice(0, 8_000).toLowerCase();
  return (
    head.includes('captcha') ||
    head.includes('/errors/validatecaptcha') ||
    head.includes('robot check') ||
    head.includes('enter the characters you see below')
  );
}

interface PageDetails {
  title: string | null;
  price: number | null;
  image_url: string | null;
  asin: string | null;
  blocked: boolean;
}

function parseProductHtml(html: string): PageDetails {
  const blocked = looksBlocked(html);

  // og:title is the cleanest when present — but Amazon product pages routinely
  // ship WITHOUT it, so the <title> tag is the real workhorse. Whatever the
  // source, strip Amazon's own chrome ("Amazon.com : <product> : Industrial…").
  const rawTitle =
    metaContent(html, 'og:title') ||
    metaContent(html, 'title') ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    null;
  let title = rawTitle
    ? decodeEntities(rawTitle)
        .replace(/\s+/g, ' ')
        .replace(/^Amazon(?:\.com|\.[a-z.]{2,})?\s*[:|-]\s*/i, '')
        .replace(/\s*[:|-]\s*Amazon(?:\.com|\.[a-z.]{2,})?\s*$/i, '')
        .trim()
    : null;
  // Amazon's robot-check / storefront pages have titles too; don't pass one of
  // those off as a product name.
  if (title && (/robot check/i.test(title) || /^amazon(\.[a-z.]+)?$/i.test(title))) title = null;

  const image_url = findImageUrl(html);

  // The page usually restates its own ASIN — useful when a short link expanded
  // into a URL shape we couldn't parse.
  //
  // DELIBERATELY NOT `data-asin`: every card in a SEARCH RESULTS grid carries
  // one, so trusting it would silently map a pasted search URL to whatever
  // sponsored product happened to be first. Both patterns below only exist on a
  // real product-detail page.
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
  const asinInPage =
    (canonical ? parseAsinFromUrl(decodeEntities(canonical)) : null) ||
    html.match(/<input[^>]+(?:id|name)=["']ASIN["'][^>]*value=["']([A-Z0-9]{10})["']/i)?.[1] ||
    null;

  return {
    title: title ? title.slice(0, 300) : null,
    price: priceFromJsonLd(html) ?? priceFromAmazonMarkup(html),
    image_url,
    asin: asinInPage ? asinInPage.toUpperCase() : null,
    blocked,
  };
}

// ── The resolver ─────────────────────────────────────────────────────────────

function degraded(input_url: string, message: string): AmazonLinkResolution {
  return {
    ok: false,
    asin: null,
    title: null,
    price: null,
    image_url: null,
    source_url: null,
    input_url,
    source: 'degraded',
    message,
  };
}

/**
 * Paste an Amazon URL → get an ASIN (and, if Amazon lets us, the product's
 * title/price/image). Never throws for a bad URL — it degrades with a message
 * the buyer can act on.
 *
 * @param rawUrl what the buyer pasted
 * @param opts.skipFetch resolve from the URL shape only (unit tests / offline)
 */
export async function resolveAmazonLink(
  rawUrl: string,
  opts: { skipFetch?: boolean } = {},
): Promise<AmazonLinkResolution> {
  const input = (rawUrl || '').trim();
  if (!input) return degraded(input, 'Paste an Amazon product link to continue.');

  const parsedUrl = toUrl(input);
  if (!parsedUrl) {
    return degraded(input, 'That doesn’t look like a web address — paste the full Amazon product link.');
  }
  if (!isAmazonUrl(input)) {
    return degraded(
      input,
      `That link points at ${parsedUrl.hostname}, not Amazon. Paste an amazon.com product link (or an a.co/amzn.to short link).`,
    );
  }

  // A search/browse URL is not a product. Say so plainly rather than picking a
  // result off the grid — mapping an item to "whatever was sponsored today" is
  // exactly the kind of silent wrong answer this feature must never give.
  if (!parseAsinFromUrl(parsedUrl.toString()) && isSearchOrBrowseUrl(parsedUrl)) {
    return degraded(
      parsedUrl.toString(),
      'That’s an Amazon search/browse page, not a product. Open the exact product you want and paste ITS link (the one with /dp/ in it).',
    );
  }

  // Short links carry no ASIN — expand before parsing.
  let workingUrl = parsedUrl.toString();
  if (isShortLink(workingUrl) && !opts.skipFetch) {
    workingUrl = await expandShortLink(workingUrl);
  }

  let asin = parseAsinFromUrl(workingUrl);

  if (opts.skipFetch) {
    return asin
      ? {
          ok: true,
          asin,
          title: null,
          price: null,
          image_url: null,
          source_url: canonicalAmazonUrl(asin),
          input_url: workingUrl,
          source: 'parsed',
          message: `ASIN ${asin} read from the link.`,
        }
      : degraded(
          workingUrl,
          'No ASIN found in that link. Open the product on Amazon and copy the URL from the address bar (it contains /dp/<ASIN>).',
        );
  }

  // Fetch the page for details (and, if the URL shape hid it, the ASIN itself).
  let details: PageDetails | null = null;
  let fetchNote = '';
  try {
    const res = await fetchWithTimeout(workingUrl, PAGE_FETCH_TIMEOUT_MS);
    if (res.ok) {
      details = parseProductHtml(await readCappedText(res));
    } else {
      // Drain so the connection can be reused; body is a block page anyway.
      try { await res.arrayBuffer(); } catch { /* ignore */ }
      fetchNote = `Amazon returned ${res.status} for that page`;
    }
  } catch (err: any) {
    fetchNote = err?.name === 'AbortError' ? 'Amazon didn’t answer in time' : 'Amazon couldn’t be reached';
  }

  if (!asin && details?.asin) asin = details.asin;

  if (!asin) {
    return degraded(
      workingUrl,
      fetchNote
        ? `${fetchNote}, and the link itself has no ASIN in it. Open the product on Amazon and copy the URL from the address bar (it contains /dp/<ASIN>).`
        : 'No ASIN found in that link. Open the product on Amazon and copy the URL from the address bar (it contains /dp/<ASIN>).',
    );
  }

  const gotDetails = !!(details && (details.title || details.price || details.image_url));
  const blocked = !!details?.blocked;

  let message: string;
  if (gotDetails) {
    // Amazon titles run to hundreds of characters — keep the sentence readable;
    // the full title is still returned (and saved) verbatim.
    const short = details!.title
      ? details!.title.length > 70 ? `${details!.title.slice(0, 70).trimEnd()}…` : details!.title
      : 'this product';
    message = details!.price != null
      ? `Found ${short} at $${details!.price.toFixed(2)}.`
      : `Found ${short} — Amazon didn’t show a price, so enter the cost yourself.`;
  } else if (blocked) {
    message = `ASIN ${asin} read from the link. Amazon blocked the product-page read (robot check), so the title and price are blank — fill them in yourself.`;
  } else if (fetchNote) {
    message = `ASIN ${asin} read from the link. ${fetchNote}, so the title and price are blank — fill them in yourself.`;
  } else {
    message = `ASIN ${asin} read from the link. Amazon’s page didn’t give up a title or price — fill them in yourself.`;
  }

  return {
    ok: true,
    asin,
    title: details?.title ?? null,
    price: details?.price ?? null,
    image_url: details?.image_url ?? null,
    source_url: canonicalAmazonUrl(asin),
    input_url: workingUrl,
    source: gotDetails ? 'fetched' : 'parsed',
    message,
  };
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * The tenant's Amazon Business provider row (provisioning layer — where an ASIN
 * belongs). Matches the lookup /settings/integrations/amazon-business/mappings
 * already uses, so both surfaces write the same provider.
 */
export async function findAmazonProviderId(tenantId: string): Promise<string | null> {
  const prov = (getAdminClient() as any).schema('provisioning');
  const { data } = await prov
    .from('providers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * The tenant's Amazon Business vendor row (supply-chain layer — where PO lines
 * and price surfaces look). Identified by ordering_mode 'amazon_punchout',
 * falling back to the name, since that's the flag the PO composer itself uses
 * to decide a vendor is Amazon.
 */
export async function findAmazonVendorId(tenantId: string): Promise<string | null> {
  const sc = (getAdminClient() as any).schema('supply_chain');
  const { data } = await sc
    .from('vendors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('ordering_mode', 'amazon_punchout')
    .limit(1)
    .maybeSingle();
  if (data?.id) return data.id;

  const { data: byName } = await sc
    .from('vendors')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('name', '%amazon%')
    .limit(1)
    .maybeSingle();
  return byName?.id ?? null;
}

export interface SaveAmazonMappingInput {
  tenantId: string;
  catalogItemId: string;
  asin: string;
  title?: string | null;
  price?: number | null;
  imageUrl?: string | null;
  sourceUrl?: string | null;
  /** Written to last_event_id on both rows — the chassis idempotency key. */
  eventId: string;
}

export interface SaveAmazonMappingResult {
  provider_mapping_id: string;
  vendor_item_id: string | null;
  provider_id: string;
  vendor_id: string | null;
  /** True when a row for this (provider, item) already existed and we updated it. */
  reused: boolean;
  /** Set when the vendor_items half couldn't be written (mapping still saved). */
  vendor_item_note: string | null;
}

/**
 * Write BOTH mapping layers for one catalog item ↔ ASIN:
 *
 *   provisioning.provider_item_mappings — the integration layer (punchout/cXML
 *     reads this to know what to put in a cart)
 *   supply_chain.vendor_items           — the ordinary vendor-price layer, so
 *     the PO composer, price hints, and reorder surfaces see Amazon as a source
 *
 * Both are upserts on their natural keys, so pasting the same product twice
 * updates in place instead of creating a duplicate. We MERGE rather than
 * overwrite: a resolve that came back without a price must never blank a price
 * someone already recorded.
 *
 * The provider mapping is the contract; the vendor_items half is best-effort —
 * if the tenant has no Amazon vendor row, we still save the mapping and say so.
 */
export async function saveAmazonMapping(
  input: SaveAmazonMappingInput,
): Promise<SaveAmazonMappingResult> {
  const { tenantId, catalogItemId, asin, eventId } = input;
  const admin = getAdminClient() as any;

  const providerId = await findAmazonProviderId(tenantId);
  if (!providerId) {
    throw AppError.badRequest(
      'Amazon Business isn’t connected for this tenant. Connect it in Settings → Integrations, then paste the link again.',
    );
  }

  const prov = admin.schema('provisioning');

  const { data: existing } = await prov
    .from('provider_item_mappings')
    .select('id, unit_cost, metadata')
    .eq('tenant_id', tenantId)
    .eq('provider_id', providerId)
    .eq('catalog_item_id', catalogItemId)
    .maybeSingle();

  const priorMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
  const metadata: Record<string, unknown> = {
    ...priorMeta,
    ...(input.title ? { title: input.title } : {}),
    ...(input.imageUrl ? { image_url: input.imageUrl } : {}),
    ...(input.price != null ? { last_price: input.price, last_price_at: new Date().toISOString() } : {}),
    source_url: input.sourceUrl ?? canonicalAmazonUrl(asin),
    mapped_via: 'paste_link',
  };

  const { data: mapping, error: mappingError } = await prov
    .from('provider_item_mappings')
    .upsert(
      {
        tenant_id: tenantId,
        provider_id: providerId,
        catalog_item_id: catalogItemId,
        external_product_id: asin,
        // ASIN is both product and variant for Amazon — same as the settings UI.
        external_variant_id: asin,
        unit_cost: input.price ?? existing?.unit_cost ?? null,
        metadata,
        last_event_id: eventId,
      },
      { onConflict: 'tenant_id,provider_id,catalog_item_id' },
    )
    .select('id')
    .single();

  if (mappingError) throw AppError.internal(mappingError.message);

  // ── vendor_items half (best-effort) ──
  let vendorItemId: string | null = null;
  let vendorItemNote: string | null = null;
  const vendorId = await findAmazonVendorId(tenantId);

  if (!vendorId) {
    vendorItemNote =
      'Saved the Amazon mapping, but this tenant has no Amazon Business vendor row — add one to see Amazon pricing on POs.';
  } else {
    const sc = admin.schema('supply_chain');
    const { data: existingVi } = await sc
      .from('vendor_items')
      .select('id, unit_cost, last_known_price')
      .eq('tenant_id', tenantId)
      .eq('vendor_id', vendorId)
      .eq('catalog_item_id', catalogItemId)
      .is('vendor_address_id', null)
      .maybeSingle();

    const { data: vi, error: viError } = await sc
      .from('vendor_items')
      .upsert(
        {
          tenant_id: tenantId,
          vendor_id: vendorId,
          catalog_item_id: catalogItemId,
          vendor_address_id: null, // company-wide price, same as auto-link on PO save
          vendor_sku: asin,
          unit_cost: input.price ?? existingVi?.unit_cost ?? null,
          ...(input.price != null
            ? { last_known_price: input.price, price_checked_at: new Date().toISOString() }
            : {}),
          active: true,
          last_event_id: eventId,
        },
        { onConflict: 'tenant_id,vendor_id,catalog_item_id,vendor_address_id' },
      )
      .select('id')
      .single();

    if (viError) {
      // The provider mapping is already durable — don't fail the buyer's flow.
      vendorItemNote = `Saved the Amazon mapping, but the vendor price row failed: ${viError.message}`;
    } else {
      vendorItemId = vi?.id ?? null;
    }
  }

  return {
    provider_mapping_id: mapping.id,
    vendor_item_id: vendorItemId,
    provider_id: providerId,
    vendor_id: vendorId,
    reused: !!existing,
    vendor_item_note: vendorItemNote,
  };
}
