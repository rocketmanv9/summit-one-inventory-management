// One-shot: for write routes whose target table has an event-emitting DB
// trigger, make the trigger the single source of truth — set
// emissionOwner: 'trigger' and empty the route's events:[] so it no longer
// double-emits. Only touches the curated list (tables confirmed trigger-backed).
// Idempotent + string/comment-aware. Run: node scripts/set-emission-trigger.mjs
import fs from 'node:fs';

const FILES = [
  'src/app/api/inventory/abc-classification/calculate/route.ts',
  'src/app/api/inventory/alerts/refresh/route.ts',
  'src/app/api/inventory/alerts/[id]/acknowledge/route.ts',
  'src/app/api/inventory/alerts/[id]/dismiss/route.ts',
  'src/app/api/inventory/categories/route.ts',
  'src/app/api/inventory/cycle-counts/route.ts',
  'src/app/api/inventory/cycle-counts/[id]/approve/route.ts',
  'src/app/api/inventory/cycle-counts/[id]/start/route.ts',
  'src/app/api/inventory/cycle-counts/[id]/submit/route.ts',
  'src/app/api/inventory/items/route.ts',
  'src/app/api/inventory/items/[id]/route.ts',
  'src/app/api/inventory/movements/[id]/reverse/route.ts',
  'src/app/api/inventory/purchasing/route.ts',
  'src/app/api/inventory/vendor-items/route.ts',
];

function skipString(src, i) {
  const q = src[i]; i++;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
      let bd = 1; i += 2;
      while (i < src.length && bd > 0) { if (src[i] === '{') bd++; else if (src[i] === '}') bd--; i++; }
      continue;
    }
    if (src[i] === q) { i++; break; }
    i++;
  }
  return i;
}

// find matching close bracket for the '[' at openIdx (string/comment aware)
function matchBracket(src, openIdx) {
  let j = openIdx + 1, depth = 1;
  while (j < src.length && depth > 0) {
    const c = src[j];
    if (c === "'" || c === '"' || c === '`') { j = skipString(src, j); continue; }
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j < 0) j = src.length; continue; }
    if (c === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j + 2); j = e < 0 ? src.length : e + 2; continue; }
    if (c === '[') depth++; else if (c === ']') depth--;
    j++;
  }
  return j - 1; // index of matching ']'
}

let changed = 0;
for (const file of FILES) {
  let src = fs.readFileSync(file, 'utf8');
  const before = src;

  // 1) add emissionOwner: 'trigger' right after each bodySchema: 'raw', (idempotent)
  if (!src.includes("emissionOwner")) {
    src = src.replaceAll("bodySchema: 'raw',", "bodySchema: 'raw', emissionOwner: 'trigger',");
  }

  // 2) empty every non-empty events: [...] array (trigger now owns emission)
  const re = /events\s*:\s*\[/g;
  const empties = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const openIdx = src.indexOf('[', m.index);
    const closeIdx = matchBracket(src, openIdx);
    const inner = src.slice(openIdx + 1, closeIdx);
    if (inner.trim() !== '') empties.push([openIdx, closeIdx]);
  }
  // apply right-to-left
  empties.sort((a, b) => b[0] - a[0]);
  for (const [o, c] of empties) src = src.slice(0, o) + '[]' + src.slice(c + 1);

  if (src !== before) {
    fs.writeFileSync(file, src);
    changed++;
    console.log(`updated  ${file}  (events emptied: ${empties.length})`);
  } else {
    console.log(`no-op    ${file}`);
  }
}
console.log(`\nFiles changed: ${changed}/${FILES.length}`);
