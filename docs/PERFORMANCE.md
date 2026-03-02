# Performance Monitoring & Optimization

This document outlines performance monitoring practices and optimization strategies for Summit Inventory Management.

## Performance Budgets

We enforce the following performance budgets in CI via Lighthouse:

### Core Web Vitals

| Metric | Target | Budget | Description |
|--------|--------|--------|-------------|
| **FCP** | < 1.8s | 2.0s | First Contentful Paint |
| **LCP** | < 2.5s | 3.0s | Largest Contentful Paint |
| **CLS** | < 0.1 | 0.1 | Cumulative Layout Shift |
| **TBT** | < 200ms | 300ms | Total Blocking Time |
| **SI** | < 3.4s | 3.5s | Speed Index |

### Resource Budgets

| Resource | Target | Budget |
|----------|--------|--------|
| JavaScript | < 400KB | 500KB |
| CSS | < 80KB | 100KB |
| HTML | < 40KB | 50KB |
| Fonts | < 150KB | 200KB |
| Images | < 800KB | 1MB |

### Lighthouse Scores

| Category | Minimum Score |
|----------|---------------|
| Performance | 80/100 |
| Accessibility | 90/100 |
| Best Practices | 90/100 |
| SEO | 90/100 |

## Monitoring Tools

### 1. Bundle Analyzer

Analyze JavaScript bundle size and composition:

```bash
# Generate bundle analysis
npm run analyze

# Opens interactive visualization in browser
```

**What to look for:**
- Duplicate dependencies
- Large third-party libraries
- Unused code

**Actions:**
- Tree-shake unused code
- Code-split large routes
- Lazy-load heavy components

### 2. Lighthouse CI

Automated performance audits in CI/CD:

```bash
# Run locally
npm run lighthouse

# View report
open lighthouse-report.html
```

**CI Integration:**
- Runs on all PRs to `main`
- Posts comment with scores
- Fails build if budgets exceeded

### 3. Vercel Analytics

Real user monitoring (RUM) in production:

- Enable in Vercel Dashboard > Analytics
- Track Core Web Vitals from real users
- Monitor performance by route

### 4. Sentry Performance Monitoring

Transaction-level performance tracking:

- Automatic instrumentation for Next.js
- Database query timing
- API route performance
- Error correlation with performance

## Optimization Techniques

### Code Splitting

**Route-based splitting** (automatic in Next.js):
```typescript
// app/dashboard/page.tsx loads only when navigating to /dashboard
```

**Component-based splitting**:
```typescript
import dynamic from 'next/dynamic';

const HeavyChart = dynamic(() => import('@/components/HeavyChart'), {
  loading: () => <Spinner />,
  ssr: false, // Skip server-side rendering if not needed
});
```

### Image Optimization

Use Next.js Image component:
```typescript
import Image from 'next/image';

<Image
  src="/hero.jpg"
  alt="Hero"
  width={800}
  height={600}
  priority // For above-the-fold images
  placeholder="blur" // Blur-up effect
/>
```

### Font Optimization

Use `next/font` for automatic font optimization:
```typescript
import { Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap', // Prevent FOIT (Flash of Invisible Text)
  variable: '--font-inter',
});
```

### Database Query Optimization

**Use indexes**:
```sql
CREATE INDEX idx_stock_balances_lookup
ON inventory.stock_balances (tenant_id, catalog_item_id, location_id);
```

**Limit result sets**:
```typescript
// Bad: Load all items
const items = await supabase.from('catalog_items').select('*');

// Good: Paginate
const items = await supabase
  .from('catalog_items')
  .select('*')
  .range(0, 49)
  .limit(50);
```

**Use RPC for complex queries**:
```typescript
// Bad: Multiple round-trips
const items = await supabase.from('catalog_items').select('*');
const stock = await supabase.from('stock_balances').select('*');
// ... merge in JavaScript

// Good: Single RPC call
const data = await supabase.rpc('get_items_with_stock');
```

### Caching Strategies

**Static Generation** (for pages that don't change often):
```typescript
export const revalidate = 3600; // Revalidate every hour
```

**Client-side caching** (for API calls):
```typescript
import { useSWR } from 'swr';

const { data, error } = useSWR('/api/items', fetcher, {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 60000, // 1 minute
});
```

**Redis caching** (for expensive operations):
```typescript
// Use Upstash Redis (same instance as rate limiting)
const cached = await redis.get(`report:${id}`);
if (cached) return cached;

const result = await generateExpensiveReport(id);
await redis.set(`report:${id}`, result, { ex: 3600 }); // 1 hour TTL
```

## Performance Checklist

### Before Every Deploy

- [ ] Run `npm run analyze` - Check bundle size
- [ ] Run `npm run lighthouse` - Check performance scores
- [ ] Review Sentry performance data
- [ ] Check for console errors/warnings
- [ ] Test on slow 3G network (Chrome DevTools)

### Monthly Review

- [ ] Review Vercel Analytics - Identify slow routes
- [ ] Check Sentry - Find slow database queries
- [ ] Review bundle analyzer - Remove unused dependencies
- [ ] Update dependencies - Get performance improvements
- [ ] Audit images - Compress/optimize large assets

### Quarterly Goals

- [ ] Lighthouse score > 90 for all categories
- [ ] LCP < 2.5s for 75th percentile (Vercel Analytics)
- [ ] Bundle size < 400KB (compressed)
- [ ] Zero layout shifts (CLS = 0)

## Common Performance Issues

### Issue: Large JavaScript Bundle

**Symptoms**: Slow initial page load, high TBT

**Solutions**:
1. Dynamic imports for heavy components
2. Remove unused dependencies
3. Tree-shake libraries (use named imports)
4. Code-split by route

### Issue: Slow Database Queries

**Symptoms**: Long TTFB, slow API routes

**Solutions**:
1. Add database indexes
2. Use RPC functions for complex queries
3. Paginate results
4. Cache frequent queries

### Issue: Images Not Optimized

**Symptoms**: Large LCP, high image sizes

**Solutions**:
1. Use Next.js Image component
2. Serve WebP/AVIF formats
3. Lazy-load below-the-fold images
4. Use responsive images

### Issue: Blocking Scripts

**Symptoms**: High TBT, delayed interactivity

**Solutions**:
1. Defer non-critical scripts
2. Use Web Workers for heavy computation
3. Debounce/throttle event handlers
4. Lazy-load analytics/chat widgets

## Resources

- [Next.js Performance Best Practices](https://nextjs.org/docs/app/building-your-application/optimizing)
- [Web Vitals](https://web.dev/vitals/)
- [Lighthouse Documentation](https://developer.chrome.com/docs/lighthouse/overview/)
- [Vercel Analytics](https://vercel.com/docs/analytics)
- [Sentry Performance Monitoring](https://docs.sentry.io/product/performance/)

---

**Last Updated**: 2026-03-02
**Next Review**: 2026-04-02
**Document Owner**: Performance Team
