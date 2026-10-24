// Scan installed Client plugins for registrations that could collide with the
// split-files bundle: tab kinds, right-Sidebar slot keys, header utility ids,
// locale namespaces and bundle row ids.
// usage: node tools/scan-conflicts.mjs <node_modules-dir> [--json]
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/scan-conflicts.mjs <node_modules-dir>');
  process.exit(2);
}

const findings = {
  tabKinds: new Map(),
  tabIds: new Map(),
  slotKeys: new Map(),
  headerUtilityIds: new Map(),
  localeNamespaces: new Map(),
  bundleRows: new Map(),
};

function add(map, key, file) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(file);
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === '.pnpm') continue;
      walk(full, out);
    } else if (/\.(js|mjs|cjs|ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scanPackage(pkgRoot, label) {
  const files = walk(pkgRoot, []);
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const match of text.matchAll(/sidebarRightTabs\s*\.\s*register\s*\(\s*\{([\s\S]{0,600}?)\}\s*\)/g)) {
      const body = match[1];
      const kind = /kind\s*:\s*["']([^"']+)["']/.exec(body);
      if (kind) add(findings.tabKinds, kind[1], label);
      const id = /\bid\s*:\s*["']([^"']+)["']/.exec(body);
      if (id) add(findings.tabIds, id[1], label);
    }

    for (const match of text.matchAll(/name\s*:\s*["']sidebar\.right\.pane\.tab["']([\s\S]{0,200}?)key\s*:\s*["']([^"']+)["']/g)) {
      add(findings.slotKeys, match[2], label);
    }

    for (const match of text.matchAll(/conversation\.session\.header\.utilities[\s\S]{0,400}?\bid\s*:\s*["']([^"']+)["']/g)) {
      add(findings.headerUtilityIds, match[1], label);
    }

    for (const match of text.matchAll(/locale\s*\.\s*register\s*\(\s*["']([^"']+)["']/g)) {
      add(findings.localeNamespaces, match[1], label);
    }
  }

  // Bundle row ids declared by this package's patch.
  const patch = ['cordis.patch.yml', 'cordis.patch.yaml'].map((name) => path.join(pkgRoot, name)).find((file) => fs.existsSync(file));
  if (patch) {
    const text = fs.readFileSync(patch, 'utf8');
    for (const match of text.matchAll(/^\s*-\s*id\s*:\s*([^\s#]+)/gm)) add(findings.bundleRows, match[1], label);
  }
}

// Walk one level of scopes (@scope/name) and plain packages.
const entries = fs.readdirSync(root, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  if (entry.name.startsWith('@')) {
    const scopeDir = path.join(root, entry.name);
    for (const scoped of fs.readdirSync(scopeDir, { withFileTypes: true })) {
      if (!scoped.isDirectory()) continue;
      const label = `${entry.name}/${scoped.name}`;
      // Only inspect packages that carry a bundle patch (installed plugins).
      const pkgRoot = path.join(scopeDir, scoped.name);
      if (['cordis.patch.yml', 'cordis.patch.yaml'].some((name) => fs.existsSync(path.join(pkgRoot, name)))) scanPackage(pkgRoot, label);
    }
  } else if (['cordis.patch.yml', 'cordis.patch.yaml'].some((name) => fs.existsSync(path.join(root, entry.name, name)))) {
    scanPackage(path.join(root, entry.name), entry.name);
  }
}

const show = (title, map) => {
  console.log(`\n=== ${title} (${map.size}) ===`);
  for (const key of [...map.keys()].sort()) console.log(`  ${key}  <- ${[...map.get(key)].join(', ')}`);
};
show('tab kinds', findings.tabKinds);
show('tab implementation ids', findings.tabIds);
show('right-Sidebar body slot keys', findings.slotKeys);
show('header utility ids', findings.headerUtilityIds);
show('locale namespaces', findings.localeNamespaces);
show('bundle row ids', findings.bundleRows);
