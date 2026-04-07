#!/usr/bin/env node

/**
 * COBRA v5.2 — Build Script
 * Creates a production-ready build in dist/ directory.
 * - Copies all extension files
 * - Excludes development files (tests, dev keys, docs, configs)
 * - Validates manifest.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Files/dirs to exclude from production build
const EXCLUDE = new Set([
  'node_modules',
  'dist',
  'coverage',
  'tests',
  'scripts',
  'docs',
  '.git',
  '.gitignore',
  '.prettierrc',
  '.prettierignore',
  'eslint.config.js',
  'jest.config.js',
  'package.json',
  'package-lock.json',
  'cobra-dev-keys.js',
  'ARCHITECTURE.md',
  'ARCHITECTURE-v52.md',
  'DELIVERABLES.txt',
  'README_TEAM_AUTH.md',
  'TEAM_AUTH_SETUP.md',
  'TEAM_AUTH_QUICK_START.md',
]);

function cleanDist() {
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  fs.mkdirSync(DIST, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    const name = path.basename(src);
    if (EXCLUDE.has(name)) return;

    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    const name = path.basename(src);
    if (EXCLUDE.has(name)) return;

    fs.copyFileSync(src, dest);
  }
}

function validateManifest() {
  const manifestPath = path.join(DIST, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const required = ['manifest_version', 'name', 'version', 'permissions', 'background'];
  const missing = required.filter(k => !manifest[k]);

  if (missing.length > 0) {
    console.error(`[BUILD] manifest.json missing required fields: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(`[BUILD] manifest.json valid - ${manifest.name} v${manifest.version}`);
}

function checkForHardcodedKeys() {
  const jsFiles = [];
  function findJS(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        findJS(full);
      } else if (entry.endsWith('.js')) {
        jsFiles.push(full);
      }
    }
  }
  findJS(DIST);

  const patterns = [
    /sk-proj-[A-Za-z0-9_-]{20,}/,
    /sk-ant-api[A-Za-z0-9_-]{20,}/,
    /sk_[a-f0-9]{40,}/,
    /gsk_[A-Za-z0-9]{30,}/,
  ];

  let found = false;
  for (const file of jsFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        const rel = path.relative(DIST, file);
        console.error(`[BUILD] WARNING: Possible API key found in ${rel}`);
        found = true;
      }
    }
  }

  if (found) {
    console.error('[BUILD] API keys detected in build output! Review before publishing.');
    process.exit(1);
  }

  console.log(`[BUILD] Security check passed - no hardcoded API keys found in ${jsFiles.length} files`);
}

// Run
console.log('[BUILD] Starting COBRA production build...');
cleanDist();
copyRecursive(ROOT, DIST);
validateManifest();
checkForHardcodedKeys();

const fileCount = (function count(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir)) {
    const f = path.join(dir, e);
    n += fs.statSync(f).isDirectory() ? count(f) : 1;
  }
  return n;
})(DIST);

console.log(`[BUILD] Done! ${fileCount} files written to dist/`);
