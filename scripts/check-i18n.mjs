#!/usr/bin/env node
/**
 * i18n validation for AgentBoard:
 *
 * 1) Locale integrity: en.json ↔ zh-CN.json (keys, {{vars}}, non-empty, balanced "{{")
 * 2) Source keys: static t('…') / i18n.t('…') and template t(`prefix.${…}`) must resolve in en.json
 * 3) Forbidden patterns: bare t(variable) / string concat keys — first arg must be '…', "…", `…`, or a supported indirect key prop access (*.labelKey, *.titleKey, *.descriptionKey, *.messageKey); multiline calls are scanned too (exempt: // i18n-exempt on call line(s); run logs exempt counts)
 * 4) Indirect keys: labelKey | titleKey | descriptionKey | messageKey string props must exist in en.json
 * 5) Unused keys in en.json vs source (set I18N_SKIP_UNUSED=1 to skip this step)
 *
 * Run: node scripts/check-i18n.mjs | npm run i18n:check
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SRC = join(REPO_ROOT, 'frontend/src');
const EN = join(REPO_ROOT, 'frontend/src/locales/en.json');
const ZH = join(REPO_ROOT, 'frontend/src/locales/zh-CN.json');

const PLURAL_SUFFIXES = ['_one', '_other', '_zero', '_few', '_many', '_two'];

/** Static key: t('a.b') or i18n.t("a.b") */
const STATIC_KEY_RE = /\b(?:t|i18n\.t)\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
/** Static key in backticks without interpolation: t(`a.b`) */
const STATIC_BT_RE = /\b(?:t|i18n\.t)\(\s*`([a-zA-Z0-9_.]+)`\s*[,)]/g;
/** Dynamic: t(`prefix.${…}`) — capture literal prefix before ${ */
const DYNAMIC_TMPL_RE = /\b(?:t|i18n\.t)\(\s*`([^`]*?)\$\{/g;
const INDIRECT_KEY_PROPS = ['labelKey', 'titleKey', 'descriptionKey', 'messageKey'];
const INDIRECT_KEY_PROP_SET = new Set(INDIRECT_KEY_PROPS);

/** Indirect i18n key props (config objects, dialogs, etc.) */
const INDIRECT_KEY_PROP_RE =
  /\b(?:labelKey|titleKey|descriptionKey|messageKey):\s*['"]([a-zA-Z0-9_.]+)['"]/g;

const I18N_CALL_RE = /\b(?:t|i18n\.t)\s*\(/g;

function flattenStrings(obj, prefix, out) {
  if (typeof obj === 'string') {
    out[prefix] = obj;
    return;
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(
      `Invalid value at "${prefix || '(root)'}": expected object or string, got ${obj === null ? 'null' : Array.isArray(obj) ? 'array' : typeof obj}`,
    );
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    throw new Error(`Empty object at "${prefix || '(root)'}" — remove or add string leaves`);
  }
  for (const k of keys) {
    const path = prefix ? `${prefix}.${k}` : k;
    flattenStrings(obj[k], path, out);
  }
}

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

function interpolationMultiset(s) {
  const names = [];
  let m;
  const re = new RegExp(VAR_RE.source, 'g');
  while ((m = re.exec(s)) !== null) {
    names.push(m[1]);
  }
  return names.sort().join('\n');
}

function braceIssue(s) {
  const open = (s.match(/\{\{/g) || []).length;
  const close = (s.match(/\}\}/g) || []).length;
  if (open !== close) {
    return `unbalanced "{{" (${open}) vs "}}" (${close})`;
  }
  return null;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function checkLocaleIntegrity(enFlat, zhFlat) {
  const errors = [];
  const enKeys = Object.keys(enFlat).sort();
  const zhKeys = Object.keys(zhFlat).sort();

  for (const k of enKeys) {
    if (!(k in zhFlat)) errors.push(`Missing in zh-CN.json: "${k}"`);
  }
  for (const k of zhKeys) {
    if (!(k in enFlat)) errors.push(`Missing in en.json: "${k}"`);
  }

  for (const k of enKeys) {
    if (!(k in zhFlat)) continue;
    const ev = enFlat[k];
    const zv = zhFlat[k];

    if (ev.trim() === '') errors.push(`Empty string en.json: "${k}"`);
    if (zv.trim() === '') errors.push(`Empty string zh-CN.json: "${k}"`);

    const sigE = interpolationMultiset(ev);
    const sigZ = interpolationMultiset(zv);
    if (sigE !== sigZ) {
      errors.push(
        `Interpolation mismatch "${k}": en [${sigE.replace(/\n/g, ', ')}] vs zh [${sigZ.replace(/\n/g, ', ')}]`,
      );
    }

    const be = braceIssue(ev);
    const bz = braceIssue(zv);
    if (be) errors.push(`en.json "${k}": ${be}`);
    if (bz) errors.push(`zh-CN.json "${k}": ${bz}`);
  }
  return errors;
}

/** True if this key or its i18next plural siblings exist in flat catalog. */
function keyResolvedInFlat(flat, key) {
  if (key in flat) return true;
  for (const suf of PLURAL_SUFFIXES) {
    if (key + suf in flat) return true;
  }
  return false;
}

function listAppSourceFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'locales') continue;
      listAppSourceFiles(p, acc);
    } else if (/\.(jsx?)$/.test(name) && !/\.test\.(jsx?)$/.test(name)) {
      acc.push(p);
    }
  }
  return acc;
}

/** Count lines containing // i18n-exempt (same scan roots as source key check). */
function gatherI18nExemptAudit() {
  const files = listAppSourceFiles(SRC);
  const byFile = [];
  let total = 0;
  for (const abs of files) {
    const rel = relative(REPO_ROOT, abs);
    const content = readFileSync(abs, 'utf8');
    let count = 0;
    for (const line of content.split('\n')) {
      if (line.includes('// i18n-exempt')) count++;
    }
    if (count > 0) {
      byFile.push({ rel, count });
      total += count;
    }
  }
  byFile.sort((a, b) => b.count - a.count || a.rel.localeCompare(b.rel));
  return { total, byFile };
}

function extractKeysFromSource(content, fileRel, report) {
  const staticKeys = new Set();
  const dynamicPrefixes = new Set();

  let m;
  STATIC_KEY_RE.lastIndex = 0;
  while ((m = STATIC_KEY_RE.exec(content)) !== null) {
    staticKeys.add(m[1]);
  }
  STATIC_BT_RE.lastIndex = 0;
  while ((m = STATIC_BT_RE.exec(content)) !== null) {
    staticKeys.add(m[1]);
  }
  INDIRECT_KEY_PROP_RE.lastIndex = 0;
  while ((m = INDIRECT_KEY_PROP_RE.exec(content)) !== null) {
    staticKeys.add(m[1]);
  }

  DYNAMIC_TMPL_RE.lastIndex = 0;
  while ((m = DYNAMIC_TMPL_RE.exec(content)) !== null) {
    const pre = m[1];
    if (pre.includes('\n') || pre.includes('`')) {
      report.push(
        `${fileRel}: dynamic t(\`…\`) prefix contains newline or backtick — fix or add exemption`,
      );
      continue;
    }
    if (!pre.endsWith('.')) {
      report.push(
        `${fileRel}: dynamic template prefix must end with "." (got "${pre}") so subtree keys can be validated`,
      );
      continue;
    }
    dynamicPrefixes.add(pre);
  }

  return { staticKeys, dynamicPrefixes };
}

function buildLineStarts(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function getLineNumberAt(offset, lineStarts) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

function hasI18nExemptBetween(lines, startLine, endLine) {
  for (let i = startLine - 1; i < endLine; i++) {
    if (lines[i]?.includes('// i18n-exempt')) return true;
  }
  return false;
}

function skipQuotedRegion(source, start, quote) {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i++;
  }
  return source.length;
}

function skipLineComment(source, start) {
  let i = start + 2;
  while (i < source.length && source[i] !== '\n') i++;
  return i;
}

function skipBlockComment(source, start) {
  let i = start + 2;
  while (i < source.length - 1) {
    if (source[i] === '*' && source[i + 1] === '/') return i + 2;
    i++;
  }
  return source.length;
}

function findCallCloseIndex(source, openParenIndex) {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = openParenIndex + 1; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuotedRegion(source, i, ch) - 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      i = skipLineComment(source, i) - 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i = skipBlockComment(source, i) - 1;
      continue;
    }

    if (ch === '(') parenDepth++;
    else if (ch === '{') braceDepth++;
    else if (ch === '[') bracketDepth++;
    else if (ch === ')') {
      if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) return i;
      if (parenDepth > 0) parenDepth--;
    } else if (ch === '}') {
      if (braceDepth > 0) braceDepth--;
    } else if (ch === ']') {
      if (bracketDepth > 0) bracketDepth--;
    }
  }

  return source.length;
}

function getFirstArgSource(callContent) {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < callContent.length; i++) {
    const ch = callContent[i];
    const next = callContent[i + 1];

    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuotedRegion(callContent, i, ch) - 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      i = skipLineComment(callContent, i) - 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i = skipBlockComment(callContent, i) - 1;
      continue;
    }

    if (ch === '(') parenDepth++;
    else if (ch === '{') braceDepth++;
    else if (ch === '[') bracketDepth++;
    else if (ch === ')') {
      if (parenDepth > 0) parenDepth--;
    } else if (ch === '}') {
      if (braceDepth > 0) braceDepth--;
    } else if (ch === ']') {
      if (bracketDepth > 0) bracketDepth--;
    } else if (ch === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return callContent.slice(0, i);
    }
  }

  return callContent;
}

function hasUnquotedPlus(source) {
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuotedRegion(source, i, ch) - 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      i = skipLineComment(source, i) - 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i = skipBlockComment(source, i) - 1;
      continue;
    }
    if (ch === '+') return true;
  }
  return false;
}

function isAllowedIndirectKeyPropertyAccess(expr) {
  const compact = expr.replace(/\s+/g, '');
  if (!/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+$/.test(compact)) return false;
  const tail = compact.split(/(?:\?\.|\.)/).pop();
  return INDIRECT_KEY_PROP_SET.has(tail);
}

/** Ban t(nonLiteral) and t('a.' + …) across single- or multi-line calls (use // i18n-exempt to override). */
function collectForbiddenI18nIssues(content, fileRel) {
  const issues = [];
  const lines = content.split('\n');
  const lineStarts = buildLineStarts(content);
  I18N_CALL_RE.lastIndex = 0;

  let match;
  while ((match = I18N_CALL_RE.exec(content)) !== null) {
    const openParenIndex = match.index + match[0].lastIndexOf('(');
    const closeParenIndex = findCallCloseIndex(content, openParenIndex);
    const startLine = getLineNumberAt(match.index, lineStarts);
    const endLine = getLineNumberAt(
      Math.max(match.index, Math.min(closeParenIndex, Math.max(content.length - 1, 0))),
      lineStarts,
    );

    if (hasI18nExemptBetween(lines, startLine, endLine)) continue;

    const callContent = content.slice(
      openParenIndex + 1,
      closeParenIndex === content.length ? content.length : closeParenIndex,
    );
    const firstArg = getFirstArgSource(callContent).trim();
    if (!firstArg) continue;

    if (hasUnquotedPlus(firstArg)) {
      issues.push(
        `${fileRel}:${startLine}: do not build i18n keys with + inside t() — use one literal/template or // i18n-exempt on this call`,
      );
      continue;
    }

    const firstChar = firstArg[0];
    if (firstChar === "'" || firstChar === '"' || firstChar === '`' || firstChar === ')') continue;
    if (isAllowedIndirectKeyPropertyAccess(firstArg)) continue;

    issues.push(
      `${fileRel}:${startLine}: t()/i18n.t() first argument must be a string/template literal or supported indirect key property access (*.labelKey, *.titleKey, *.descriptionKey, *.messageKey), not "${firstArg.replace(/\s+/g, ' ').trim()}" — or // i18n-exempt on this call`,
    );
  }
  return issues;
}

function checkSourceAgainstEn(enFlat) {
  const missing = [];
  const files = listAppSourceFiles(SRC);
  const allStatic = new Set();
  const allPrefixes = new Set();
  const parseErrors = [];

  for (const abs of files) {
    const rel = relative(REPO_ROOT, abs);
    const content = readFileSync(abs, 'utf8');
    const { staticKeys, dynamicPrefixes } = extractKeysFromSource(content, rel, parseErrors);
    for (const issue of collectForbiddenI18nIssues(content, rel)) {
      missing.push(issue);
    }
    for (const k of staticKeys) allStatic.add(k);
    for (const p of dynamicPrefixes) allPrefixes.add(p);
  }

  for (const err of parseErrors) {
    missing.push(err);
  }

  for (const key of allStatic) {
    if (!keyResolvedInFlat(enFlat, key)) {
      missing.push(`Missing key in en.json (referenced in source): "${key}"`);
    }
  }

  for (const prefix of allPrefixes) {
    const hits = Object.keys(enFlat).filter((k) => k.startsWith(prefix));
    if (hits.length === 0) {
      missing.push(
        `Dynamic prefix "${prefix}" has no matching keys in en.json (t(\`${prefix}\${…}\`))`,
      );
    }
  }

  return { missing, allStatic, allPrefixes, files };
}

function computeUsedKeys(enFlat, allStatic, allPrefixes) {
  const used = new Set();
  for (const key of allStatic) {
    if (!keyResolvedInFlat(enFlat, key)) continue;
    if (key in enFlat) used.add(key);
    for (const suf of PLURAL_SUFFIXES) {
      const k = key + suf;
      if (k in enFlat) used.add(k);
    }
  }
  for (const prefix of allPrefixes) {
    for (const k of Object.keys(enFlat)) {
      if (k.startsWith(prefix)) used.add(k);
    }
  }
  return used;
}

function main() {
  let enObj;
  let zhObj;
  try {
    enObj = loadJson(EN);
    zhObj = loadJson(ZH);
  } catch (e) {
    console.error('[i18n:check] Failed to read/parse locale files:', e.message);
    process.exit(1);
  }

  const enFlat = {};
  const zhFlat = {};
  try {
    flattenStrings(enObj, '', enFlat);
    flattenStrings(zhObj, '', zhFlat);
  } catch (e) {
    console.error('[i18n:check] Structure error:', e.message);
    process.exit(1);
  }

  const integrityErrors = checkLocaleIntegrity(enFlat, zhFlat);
  if (integrityErrors.length > 0) {
    console.error('[i18n:check] Locale integrity failed:');
    for (const line of integrityErrors.slice(0, 50)) {
      console.error('  -', line);
    }
    if (integrityErrors.length > 50) console.error(`  … and ${integrityErrors.length - 50} more`);
    process.exit(1);
  }

  const enKeyCount = Object.keys(enFlat).length;
  console.log(
    `[i18n:check] Locales OK — ${enKeyCount} keys aligned (en ↔ zh-CN), placeholders valid.`,
  );

  const { missing, allStatic, allPrefixes } = checkSourceAgainstEn(enFlat);
  if (missing.length > 0) {
    console.error('[i18n:check] Source key check failed:');
    for (const line of missing.slice(0, 80)) {
      console.error('  -', line);
    }
    if (missing.length > 80) console.error(`  … and ${missing.length - 80} more`);
    process.exit(1);
  }

  console.log(
    `[i18n:check] Source OK — ${allStatic.size} static key refs, ${allPrefixes.size} dynamic prefix(es) validated against en.json.`,
  );

  const exempt = gatherI18nExemptAudit();
  if (exempt.total === 0) {
    console.log('[i18n:check] i18n-exempt audit: 0 lines.');
  } else {
    console.log(
      `[i18n:check] i18n-exempt audit: ${exempt.total} line(s) across ${exempt.byFile.length} file(s).`,
    );
    const maxList = 25;
    for (const { rel, count } of exempt.byFile.slice(0, maxList)) {
      console.log(`  - ${rel}: ${count}`);
    }
    if (exempt.byFile.length > maxList) {
      console.log(`  … and ${exempt.byFile.length - maxList} more file(s)`);
    }
  }

  const checkUnused = process.env.I18N_SKIP_UNUSED !== '1';
  if (checkUnused) {
    const used = computeUsedKeys(enFlat, allStatic, allPrefixes);
    const unused = Object.keys(enFlat)
      .filter((k) => !used.has(k))
      .sort();
    if (unused.length > 0) {
      console.error(`[i18n:check] Unused keys in en.json (${unused.length}):`);
      for (const k of unused.slice(0, 40)) {
        console.error('  -', k);
      }
      if (unused.length > 40) console.error(`  … and ${unused.length - 40} more`);
      process.exit(1);
    }
    console.log('[i18n:check] Unused-key scan OK.');
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  main();
}

export {
  INDIRECT_KEY_PROPS,
  checkSourceAgainstEn,
  collectForbiddenI18nIssues,
  extractKeysFromSource,
};
