#!/usr/bin/env node
/**
 * i18n validation for AgentBoard:
 *
 * 1) Locale integrity: en.json ↔ zh-CN.json (keys, {{vars}}, non-empty, balanced "{{")
 * 2) Source keys: static t('…') / i18n.t('…') and template t(`prefix.${…}`) must resolve in en.json
 * 3) Forbidden patterns: bare t(variable) / string concat keys — first arg must be '…', "…", `…`, or obj.prop (exempt: // i18n-exempt on line; run logs exempt counts)
 * 4) Indirect keys: labelKey | titleKey | descriptionKey | messageKey string props must exist in en.json
 * 5) Unused keys in en.json vs source (set I18N_SKIP_UNUSED=1 to skip this step)
 *
 * Run: node scripts/check-i18n.mjs | npm run i18n:check
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
/** Indirect i18n key props (config objects, dialogs, etc.) */
const INDIRECT_KEY_PROP_RE =
  /\b(?:labelKey|titleKey|descriptionKey|messageKey):\s*['"]([a-zA-Z0-9_.]+)['"]/g;

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

/** Ban t(nonLiteral) and t('a.' + …) on a line (use // i18n-exempt to override). */
function collectForbiddenI18nIssues(content, fileRel) {
  const issues = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.includes('// i18n-exempt')) continue;
    const lineNoTrailComment = raw.replace(/\/\/.*$/, '');
    const trimmed = lineNoTrailComment.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    if (/\b(?:t|i18n\.t)\s*\([^)]*\+/.test(lineNoTrailComment)) {
      issues.push(
        `${fileRel}:${i + 1}: do not build i18n keys with + inside t() — use one literal/template or // i18n-exempt`,
      );
    }

    const callRe = /\b(?:t|i18n\.t)\s*\(/g;
    let m;
    while ((m = callRe.exec(lineNoTrailComment)) !== null) {
      let j = m.index + m[0].length;
      while (j < lineNoTrailComment.length && /\s/.test(lineNoTrailComment[j])) j++;
      if (j >= lineNoTrailComment.length) continue;
      const ch = lineNoTrailComment[j];
      if (ch === "'" || ch === '"' || ch === '`' || ch === ')') continue;
      if (/[a-zA-Z_$]/.test(ch)) {
        const rest = lineNoTrailComment.slice(j);
        const id = rest.match(/^([a-zA-Z_$][\w$]*)/);
        if (!id) continue;
        let afterId = j + id[1].length;
        while (afterId < lineNoTrailComment.length && /\s/.test(lineNoTrailComment[afterId]))
          afterId++;
        const next = lineNoTrailComment[afterId];
        if (next === '.') continue; // e.g. t(row.labelKey) — key still from catalog via INDIRECT_KEY_PROP_RE
        issues.push(
          `${fileRel}:${i + 1}: t()/i18n.t() first argument must be a string/template literal or property access (e.g. row.labelKey), not bare "${id[1]}" — or // i18n-exempt on this line`,
        );
      }
    }
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

main();
