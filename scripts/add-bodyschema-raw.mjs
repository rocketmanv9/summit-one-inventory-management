// One-shot codemod: add `bodySchema: 'raw'` to every createWriteRoute /
// createSessionWriteRoute options object that lacks it (chassis 2.0.0 requires
// it). 'raw' preserves exact current behavior — handlers keep calling req.json().
// Idempotent + string/comment-aware. Run: node scripts/add-bodyschema-raw.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('src/app/api');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name === 'route.ts') acc.push(p);
  }
  return acc;
}

function skipString(src, i) {
  const q = src[i];
  i++;
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

function findOptsBrace(src, from) {
  let i = from, paren = 0, brace = 0, bracket = 0, sawComma = false;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { i = skipString(src, i); continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) i = src.length; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (!sawComma) {
      if (c === '(') paren++;
      else if (c === ')') { if (paren === 0) return -1; paren--; }
      else if (c === '{') brace++;
      else if (c === '}') brace--;
      else if (c === '[') bracket++;
      else if (c === ']') bracket--;
      else if (c === ',' && paren === 0 && brace === 0 && bracket === 0) sawComma = true;
      i++;
    } else {
      if (/\s/.test(c)) { i++; continue; }
      return c === '{' ? i : -1;
    }
  }
  return -1;
}

function matchingClose(src, openBrace) {
  let j = openBrace + 1, bd = 1;
  while (j < src.length && bd > 0) {
    const c = src[j];
    if (c === "'" || c === '"' || c === '`') { j = skipString(src, j); continue; }
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j < 0) j = src.length; continue; }
    if (c === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j + 2); j = e < 0 ? src.length : e + 2; continue; }
    if (c === '{') bd++; else if (c === '}') bd--;
    j++;
  }
  return j;
}

let totalInserts = 0;
const changed = [];
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /create(?:Session)?WriteRoute\s*\(/g;
  const inserts = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const ob = findOptsBrace(src, m.index + m[0].length);
    if (ob < 0) continue;
    const close = matchingClose(src, ob);
    if (/\bbodySchema\b/.test(src.slice(ob, close))) continue; // already has it
    inserts.push(ob + 1);
  }
  if (!inserts.length) continue;
  inserts.sort((a, b) => b - a);
  let out = src;
  for (const pos of inserts) out = out.slice(0, pos) + " bodySchema: 'raw'," + out.slice(pos);
  fs.writeFileSync(file, out);
  totalInserts += inserts.length;
  changed.push(`${inserts.length}  ${path.relative('.', file)}`);
}
console.log(changed.join('\n'));
console.log(`\nFiles changed: ${changed.length}  |  Inserts: ${totalInserts}`);
