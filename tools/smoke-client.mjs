// Static smoke test for plugin/client.js: emulate the DSH Client module loader
// and a Cordis-ish context, then assert the registrations the plugin performs.
// usage: node tools/smoke-client.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.resolve(here, '..', 'plugin', 'client.js');
const source = fs.readFileSync(clientPath, 'utf8');

// --- minimal React stub: registration code only calls createElement -----------
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: Symbol('Fragment'),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useSyncExternalStore: (_sub, get) => get(),
};

const requireMock = (spec) => {
  if (spec === 'react') return React;
  throw new Error(`smoke: unexpected require("${spec}")`);
};

// --- emulate window.__ModuleLoader__.load ------------------------------------
const registrations = new Map();
globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => {} },
  __ModuleLoader__: {
    load: (record) => {
      if (registrations.has(record.id)) throw new Error(`duplicate factory id ${record.id}`);
      registrations.set(record.id, record);
    },
  },
};
// Minimal DOM so the plugin's global stylesheet effect can mount.
const appendedStyles = [];
globalThis.document = {
  head: { appendChild: (node) => appendedStyles.push(node) },
  createElement: (tag) => ({ tag, attributes: {}, textContent: '', remove() {}, setAttribute(k, v) { this.attributes[k] = v; } }),
};

const loaded = [];
class FakeUrl extends URL {}
globalThis.URL = FakeUrl;

// Evaluate the bundle exactly like the page does: it only registers a factory.
new Function('window', source)(globalThis.window);

if (registrations.size !== 1) throw new Error(`expected 1 factory, got ${registrations.size}`);
const [record] = [...registrations.values()];
console.log(`factory id: ${record.id}`);
if (record.id !== 'dsh-2sidebar') throw new Error('unexpected package id');

const exportsObject = record.factory(requireMock);
if (typeof exportsObject.apply !== 'function') throw new Error('apply missing');
if (!Array.isArray(exportsObject.inject)) throw new Error('inject missing');
console.log('inject:', exportsObject.inject.join(', '));

// --- emulate the Cordis context the plugin touches ---------------------------
const effects = [];
const registrationsMade = { locale: [], tabTypes: [], slots: [] };

const ctx = {
  effect: (fn, label) => {
    const cleanup = fn();
    effects.push({ label, cleanup });
    return () => { if (typeof cleanup === 'function') cleanup(); };
  },
  locale: {
    bind: (ns) => (key) => `[${ns}]${key}`,
    register: (ns, dicts) => {
      registrationsMade.locale.push({ ns, lang: Object.keys(dicts) });
      return () => {};
    },
  },
  sidebarRightTabs: {
    register: (definition) => {
      registrationsMade.tabTypes.push(definition);
      return () => {};
    },
  },
  slots: {
    // `slug` is the slot name; if it matches our keys we behave like a seat.
    inject: (name, callback) => {
      const dispose = callback();
      effects.push({ label: `slot:${name}`, cleanup: dispose });
      return dispose;
    },
    register: (options, component) => {
      registrationsMade.slots.push({ options, component });
      return () => {};
    },
  },
  sessions: {
    list: {
      getSnapshot: () => ({ byId: { s1: { cwd: 'C:/work/demo' } } }),
      subscribe: () => () => {},
    },
  },
  sidebarRight: {
    openTab: () => {},
  },
  remote: {
    workspaceFiles: {
      list: async () => ({ ok: true, value: { entries: [], truncated: false } }),
      read: async () => ({ ok: true, value: { text: 'hi', lines: 1, eof: true, offset: 1, bytes: 2 } }),
      readBytes: async () => ({ ok: true, value: { data: new Uint8Array([1, 2]), bytes: 2 } }),
    },
  },
};

exportsObject.apply(ctx);

// --- assertions --------------------------------------------------------------
const problems = [];
if (registrationsMade.locale.length !== 1) problems.push('locale.register not called once');
if (registrationsMade.tabTypes.length !== 1) problems.push('sidebarRightTabs.register not called once');
const type = registrationsMade.tabTypes[0];
if (!type) problems.push('no tab type definition');
else {
  if (type.id !== 'dsh-2sidebar') problems.push(`tab type id is ${type.id}`);
  if (type.kind !== 'split-files') problems.push(`tab kind is ${type.kind}`);
  if (!Array.isArray(type.guide) || type.guide.length === 0) problems.push('guide entry missing');
  else {
    const entry = type.guide[0];
    for (const field of ['id', 'title', 'description', 'icon']) {
      if (entry[field] === undefined) problems.push(`guide.${field} missing`);
    }
    if (typeof entry.icon !== 'function') problems.push('guide.icon must be a component');
  }
}
const slotNames = registrationsMade.slots.map((s) => s.options.name);
if (!slotNames.includes('sidebar.right.pane.tab')) problems.push('body slot not registered');
if (!slotNames.includes('sidebar.right.pane.tab.title')) problems.push('title slot not registered');
if (!slotNames.includes('conversation.session.header.utilities')) problems.push('header button slot not registered');
const headerSlot = registrationsMade.slots.find((s) => s.options.name === 'conversation.session.header.utilities');
if (headerSlot !== undefined) {
  if (headerSlot.options.id !== 'split-files:header-button') problems.push('header button id is wrong');
  if (typeof headerSlot.component !== 'function') problems.push('header button component missing');
  try {
    headerSlot.component({});
  } catch (error) {
    problems.push('header button render threw: ' + error.message);
  }
}
if (appendedStyles.length !== 1) problems.push(`expected 1 global style element, got ${appendedStyles.length}`);
for (const slot of registrationsMade.slots) {
  const options = slot.options;
  if (options.name.startsWith('sidebar.right.') && options.key !== type?.id) {
    problems.push(`slot ${options.name} key ${options.key} != type id`);
  }
  if (typeof slot.component !== 'function') problems.push(`slot ${options.name} component missing`);
  if (options.name === 'sidebar.right.pane.tab') {
    if (typeof options.inject !== 'function') problems.push('body slot inject missing');
    else {
      const injected = options.inject('s1');
      for (const field of ['getCwd', 'subscribeSessions', 'list', 'read']) {
        if (typeof injected[field] !== 'function') problems.push(`body inject.${field} missing`);
      }
      if (injected.getCwd() !== 'C:/work/demo') problems.push('getCwd did not read the session cwd');
      const listing = await injected.list('C:/work/demo');
      if (!listing.ok) problems.push('list injection broken');
      const page = await injected.read('C:/work/demo/a.txt', { offset: 1, limit: 10 });
      if (!page.ok) problems.push('read injection broken');
    }
  }
}

console.log(`\nregistrations: locale=${registrationsMade.locale.length}, tab types=${registrationsMade.tabTypes.length}, slots=${registrationsMade.slots.length}`);
console.log(`effects: ${effects.map((e) => e.label).join(' | ')}`);

// --- render the two components once with stub hooks --------------------------
const bodySlot = registrationsMade.slots.find((s) => s.options.name === 'sidebar.right.pane.tab');
const titleSlot = registrationsMade.slots.find((s) => s.options.name === 'sidebar.right.pane.tab.title');
function walkElements(node, visit) {
  if (node === null || node === undefined || typeof node === 'string' || typeof node === 'number') return;
  if (Array.isArray(node)) { node.forEach((child) => walkElements(child, visit)); return; }
  visit(node);
  if (Array.isArray(node.children)) node.children.forEach((child) => walkElements(child, visit));
}
let bodyTree;
try {
  bodyTree = bodySlot.component({
    ...bodySlot.options.inject('s1'),
    t: (key) => `[t]${key}`,
    useTabInfo: () => ({ tab: { id: 'x', title: 'tab', path: 'C:/work/demo/a.txt', actions: {} } }),
  });
  const tags = [];
  walkElements(bodyTree, (element) => { if (typeof element.type === 'string') tags.push(element.type); });
  console.log(`body render: ${tags.length} host elements (${[...new Set(tags)].slice(0, 8).join(', ')}...)`);
  if (tags.length === 0) problems.push('body rendered no host elements');
  if (!tags.includes('div')) problems.push('body render has no layout container');
} catch (error) {
  problems.push('body render threw: ' + error.message);
}
try {
  const titleTree = titleSlot.component({ useTabInfo: () => ({ tab: { id: 'x', title: '目录分栏' } }) });
  walkElements(titleTree, () => {});
} catch (error) {
  problems.push('title render threw: ' + error.message);
}

if (problems.length > 0) {
  console.error('\nFAIL');
  for (const problem of problems) console.error(' - ' + problem);
  process.exit(1);
}
console.log('\nOK: bundle contract and registrations are consistent.');
