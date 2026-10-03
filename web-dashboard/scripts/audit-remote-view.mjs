#!/usr/bin/env node
/**
 * audit-remote-view.mjs
 * ---------------------
 * Static analysis: detects bare fetch('/api/...) calls in UI components
 * that should use gFetch() for correct remote-peer routing.
 *
 * Run: node scripts/audit-remote-view.mjs
 * Exit 0 = clean, Exit 1 = violations found.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC_DIR = new URL('../src', import.meta.url).pathname;

// ──────────────────────────────────────────────────────────────
// Files where bare fetch('/api/...) is intentionally LOCAL-only
// (these routes are DC1-only by design and must NOT be proxied).
// ──────────────────────────────────────────────────────────────
const INTENTIONALLY_LOCAL_FILES = new Set([
  'Login.tsx',           // auth is always local
  'Copilot.tsx',         // AI copilot config always on local node
  'Speedtest.tsx',       // speedtest blocked for remote view in UI
  'Fleet.tsx',           // fleet management is a DC1-only concept
  'PeerContext.tsx',     // PeerContext itself sets up gFetch
  'useFavicon.ts',       // favicon fetch
  'ApiPlayground.tsx',   // API studio playground is DC1-only by design
]);

// Lines containing these strings are excluded even if they match bare fetch.
// Use for: the apiFetch gateway helper body, or guarded local reads.
const EXCLUDED_LINE_PATTERNS = [
  'api/gateway/',                    // the apiFetch helper itself calling the gateway
  'isRemoteViewRef.current',         // guard checks — these lines are safe
  '// local',                        // developer-annotated intentional local fetch
];

// API routes that are intentionally local regardless of component
const INTENTIONALLY_LOCAL_ROUTES = [
  '/api/auth/',
  '/api/copilot/',
  '/api/registry/',      // leader status is DC1-local
  '/api/version',        // local version display
  '/api/config/ui',      // UI config is DC1-local
  '/api/features',       // feature flags are DC1-local
  '/api/siteinfo',       // site info is DC1-local
  '/api/admin/maintenance/',
  '/api/connectivity/speedtest',
  '/api/connectivity/iperf',
  '/api/connectivity/public-ip',
  '/api/system/gateway-ip',
  '/api/connectivity/test',      // DC1 local connectivity probe (not remote)
  '/api/config/apps',            // app distribution config is DC1-local
  '/api/connectivity/docker-stats',
  '/api/admin/system/dashboard-data',  // DC1-local: logs, dockerStats, registry (stats/status guarded internally)
  '/api/logs',           // debug logs are DC1-local
];

// ──────────────────────────────────────────────────────────────
// Walk src/ and collect all .tsx / .ts files
// ──────────────────────────────────────────────────────────────
function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) results.push(...walk(full));
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) results.push(full);
  }
  return results;
}

// ──────────────────────────────────────────────────────────────
// Detection regex: bare fetch( with a /api/ string/template
// ──────────────────────────────────────────────────────────────
const BARE_FETCH_RE = /(?<![a-zA-Z])fetch\([`'"]\/api\//g;

function isLocalRoute(line) {
  return INTENTIONALLY_LOCAL_ROUTES.some(r => line.includes(r));
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────
const files = walk(SRC_DIR);
const violations = [];

for (const file of files) {
  const name = file.split('/').pop();
  if (INTENTIONALLY_LOCAL_FILES.has(name)) continue;

  const lines = readFileSync(file, 'utf-8').split('\n');
  lines.forEach((line, i) => {
    const stripped = line.trim();
    if (stripped.startsWith('//') || stripped.startsWith('*')) return; // skip comments
    if (!BARE_FETCH_RE.test(line)) { BARE_FETCH_RE.lastIndex = 0; return; }
    BARE_FETCH_RE.lastIndex = 0;
    if (isLocalRoute(line)) return;
    if (EXCLUDED_LINE_PATTERNS.some(p => line.includes(p))) return;

    // Context-aware guard check: scan the 8 lines above for a remote-view guard.
    // Catches patterns like:
    //   if (!token || isRemoteViewRef.current) return;
    //   if (data.stats && !isRemoteViewRef.current) processStats(…);
    const contextWindow = lines.slice(Math.max(0, i - 8), i).join('\n');
    if (contextWindow.includes('isRemoteViewRef')) return;

    violations.push({ file: relative(SRC_DIR, file), line: i + 1, code: stripped });
  });
}

// ──────────────────────────────────────────────────────────────
// Report
// ──────────────────────────────────────────────────────────────
const RED   = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW= '\x1b[33m';
const BOLD  = '\x1b[1m';
const RESET = '\x1b[0m';

console.log(`\n${BOLD}═══ Remote-View gFetch Audit ═══${RESET}`);
console.log(`Scanned ${files.length} files in src/\n`);

if (violations.length === 0) {
  console.log(`${GREEN}${BOLD}✓ CLEAN — no bare fetch('/api/...) violations found.${RESET}`);
  console.log(`${GREEN}All write-actions are correctly routed via gFetch/apiFetch.${RESET}\n`);
  process.exit(0);
} else {
  console.log(`${RED}${BOLD}✗ ${violations.length} VIOLATION(S) FOUND:${RESET}\n`);
  let lastFile = null;
  for (const v of violations) {
    if (v.file !== lastFile) {
      console.log(`${YELLOW}${BOLD}  ${v.file}${RESET}`);
      lastFile = v.file;
    }
    console.log(`    ${RED}L${v.line}${RESET}  ${v.code.slice(0, 100)}`);
  }
  console.log(`\n${RED}${BOLD}Fix: replace fetch('/api/...) with gFetch('/api/...) and ensure usePeerContext() is called.${RESET}\n`);
  process.exit(1);
}
