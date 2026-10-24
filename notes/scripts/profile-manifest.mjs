#!/usr/bin/env node
// profile-manifest.mjs - minimal, reviewable editor for a DSH profile's package.json.
//
// Only touches the two fields an install needs:
//   * dependencies[<name>]     (so the package is a profile dependency)
//   * dsh.profile.bundles[]    (so the bundle's patch layer is selected)
// It preserves every other field and writes with the profile's own formatting
// (2-space indent + trailing newline) through a temp file + rename.
//
// Usage:
//   node profile-manifest.mjs show <profileDir>
//   node profile-manifest.mjs add-bundle <profileDir> <name> <linkSpec>
//   node profile-manifest.mjs remove-bundle <profileDir> <name>
//
// <linkSpec> is what pnpm would save for a linked dependency, e.g.
//   link:D:/ai2all/projects/personal/dsh-2sider/plugin
// For a registry install pass the version range (e.g. ^1.0.0); the same
// value goes into dependencies and nothing is guessed.
//
// remove-bundle: drops the name from dsh.profile.bundles, and drops the
// dependency only when its recorded value is a link:/file: spec (a registry
// dependency is left alone, so un-selecting a bundle never uninstalls a
// published package).
//
// Read-only actions print JSON and change nothing. ASCII only.
import fs from 'node:fs';
import path from 'node:path';

const [action, profileDir, name, spec] = process.argv.slice(2);
const file = profileDir ? path.join(profileDir, 'package.json') : '';

function fail(message) {
  console.error('profile-manifest: ' + message);
  process.exit(1);
}

if (!action || !profileDir) {
  fail('usage: node profile-manifest.mjs <show|add-bundle|remove-bundle> <profileDir> [name] [linkSpec]');
}
if (!fs.existsSync(file)) fail('no package.json in ' + profileDir);

const raw = fs.readFileSync(file, 'utf8');
let manifest;
try {
  manifest = JSON.parse(raw);
} catch (error) {
  fail('package.json is not valid JSON: ' + String(error));
}

function bundlesOf(value) {
  const list = value?.dsh?.profile?.bundles;
  return Array.isArray(list) ? list : [];
}

function summarize(value) {
  return {
    file,
    dependencies: value.dependencies ?? {},
    bundles: bundlesOf(value)
  };
}

function save(value) {
  const next = JSON.stringify(value, null, 2) + '\n';
  if (next === raw) return false;
  const temp = file + '.tmp-' + process.pid;
  fs.writeFileSync(temp, next, { mode: 0o600 });
  fs.renameSync(temp, file);
  return true;
}

if (action === 'show') {
  console.log(JSON.stringify(summarize(manifest), null, 2));
  process.exit(0);
}

if (!name) fail('a package name is required for ' + action);

if (action === 'add-bundle') {
  if (!spec) fail('add-bundle needs a dependency spec (link:D:/... or a version range)');
  const dependencies = { ...(manifest.dependencies ?? {}), [name]: spec };
  const bundles = bundlesOf(manifest).filter((entry) => entry !== name);
  bundles.push(name);
  const next = {
    ...manifest,
    dependencies,
    dsh: {
      ...manifest.dsh,
      profile: { ...manifest.dsh?.profile, bundles }
    }
  };
  const changed = save(next);
  console.log(JSON.stringify({ changed, dependency: spec, bundleAdded: name, bundles }, null, 2));
  process.exit(0);
}

if (action === 'remove-bundle') {
  const bundles = bundlesOf(manifest).filter((entry) => entry !== name);
  const dependencies = { ...(manifest.dependencies ?? {}) };
  const value = dependencies[name];
  const linked = typeof value === 'string' && /^(?:link|file):/i.test(value);
  if (linked) delete dependencies[name];
  const next = {
    ...manifest,
    dependencies,
    dsh: {
      ...manifest.dsh,
      profile: { ...manifest.dsh?.profile, bundles }
    }
  };
  const changed = save(next);
  console.log(JSON.stringify({ changed, bundleRemoved: name, dependencyRemoved: linked ? value : null, bundles }, null, 2));
  process.exit(0);
}

fail('unknown action ' + action);
