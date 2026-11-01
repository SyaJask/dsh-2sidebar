import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the package is an installable DSH bundle with a publishable client half', () => {
  assert.equal(pkg.name, 'dsh-2sidebar');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(pkg.dsh?.client?.platform, 'web');
  assert.ok(typeof pkg.engines?.dsh === 'string' && pkg.engines.dsh.length > 0);
  assert.ok(pkg.exports?.['.'] && pkg.exports['./client']);
  assert.ok(fs.existsSync(path.join(root, pkg.exports['./client'])));
  assert.equal(pkg.exports['./package.json'], './package.json');
  assert.equal(pkg.exports['./icon'], './icon.svg');
});

test('the bundle patch mounts the package by its bare name', () => {
  const patch = read('cordis.patch.yml');
  assert.match(patch, /- insert:/);
  assert.match(patch, /id:\s*dsh-2sidebar/);
  assert.match(patch, /name:\s*'dsh-2sidebar'/);
  assert.doesNotMatch(patch, /config:\s*\{\s*\}/, 'an empty config is not needed');
});

test('the loader id, package name and patch row name agree', () => {
  assert.equal(pkg.name, 'dsh-2sidebar');
  assert.match(read('client.js'), /id:\s*'dsh-2sidebar'/);
  assert.match(read('cordis.patch.yml'), /name:\s*'dsh-2sidebar'/);
});

test('display metadata and icon are exported and non-empty', () => {
  for (const lang of ['en', 'zh']) {
    const meta = JSON.parse(read(`locale/${lang}.json`)).meta;
    assert.equal(typeof meta?.title, 'string');
    assert.ok(meta.title.length > 0, `${lang} meta.title must not be empty`);
    assert.equal(typeof meta?.description, 'string');
    assert.ok(meta.description.length > 0, `${lang} meta.description must not be empty`);
  }
  assert.ok(fs.existsSync(path.join(root, 'icon.svg')));
  assert.ok(fs.statSync(path.join(root, 'icon.svg')).size > 0);
  assert.ok(pkg.exports?.['./locale/*.json']);
});

test('every published file entry exists and test files stay unpublished', () => {
  for (const entry of pkg.files ?? []) {
    if (entry.includes('*')) {
      const [directory, glob] = entry.split('/');
      const pattern = new RegExp(`^${glob.replace('*', '.*')}$`);
      assert.ok(
        fs.readdirSync(path.join(root, directory)).some((name) => pattern.test(name)),
        `no file matches ${entry}`,
      );
    } else {
      assert.ok(fs.existsSync(path.join(root, entry)), `missing ${entry}`);
    }
  }
  assert.ok(!(pkg.files ?? []).some((entry) => entry.startsWith('test')));
});

test('the version, CHANGELOG, and release note agree', () => {
  const changelog = read('CHANGELOG.md');
  const versions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((match) => match[1]);
  assert.equal(versions[0], pkg.version, 'the newest CHANGELOG entry must match package.json');
  assert.ok(fs.existsSync(path.join(root, 'docs', 'release-notes', `v${pkg.version}.md`)));
  const note = read(path.join('docs', 'release-notes', `v${pkg.version}.md`));
  assert.match(note, new RegExp(`^# dsh-2sidebar v${pkg.version.replaceAll('.', '\\.')}`));
});
