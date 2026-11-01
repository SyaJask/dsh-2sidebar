/**
 * Dependency-free harness for the deployed client bundle.
 *
 * The bundle registers a lazy factory into `window.__ModuleLoader__`; the page
 * materializes it with React and the platform primitives from the shared module
 * table. These helpers emulate exactly that: a hook-returning React stub, the
 * primitives the bundle imports, and a fake Cordis context that records slots
 * and effects. No bundler, test framework, or network is involved.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUNDLE_ID = 'dsh-2sidebar';
export const SOURCE = fs.readFileSync(path.join(root, 'client.js'), 'utf8');

function createReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: Symbol('Fragment'),
    useCallback: (fn) => fn,
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  };
}

function createPrimitives() {
  const element = () => createReact().createElement('span', null);
  return {
    PathLabel: ({ path, className }) => ({ type: 'span', props: { className, title: path }, children: [] }),
    FileTypeIcon: element,
    classifyFileType: () => 'text',
    Tooltip: (props) => props.children,
    IconFolderOpenRegular: element,
    IconFolderCloseRegular: element,
    IconRefreshOutlineRegular: element,
    IconChevronLeftOutlineRegular: element,
    IconChevronRightOutlineRegular: element,
    IconCompareSplitOutlineRegular: element,
  };
}

/** Evaluate `client.js` like the shell and return its materialized module face. */
export function loadClient() {
  const React = createReact();
  const primitives = createPrimitives();
  const records = new Map();
  const localStorage = { getItem: () => null, setItem: () => {} };
  const window = {
    __ModuleLoader__: {
      load: (record) => {
        if (records.has(record.id)) throw new Error(`duplicate factory id ${record.id}`);
        records.set(record.id, record);
      },
    },
    localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: () => 0,
  };
  const document = {
    head: { appendChild: () => {} },
    createElement: () => ({ setAttribute: () => {}, remove: () => {}, textContent: '' }),
  };
  globalThis.window = window;
  globalThis.document = document;

  new Function('window', 'document', SOURCE)(window, document);

  const record = records.get(BUNDLE_ID);
  if (!record) throw new Error('the bundle did not register a factory');
  const module = record.factory((specifier) => {
    if (specifier === 'react') return React;
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    throw new Error(`unexpected require("${specifier}")`);
  });
  return { React, primitives, module };
}

/** A fake Cordis context that records registrations and open attempts. */
export function createContext() {
  const effects = [];
  const slots = [];
  const opened = [];
  const noop = () => {};
  let tabType;
  let target = { sessionId: 's1', paneId: 'p1', host: 'dock' };

  const ctx = {
    effect: (fn, label) => {
      const dispose = fn();
      effects.push({ label, dispose });
      return () => dispose && dispose();
    },
    locale: {
      bind: () => (key) => key,
      register: () => noop,
    },
    slots: {
      inject: (name, callback) => {
        const dispose = callback();
        effects.push({ label: `slot:${name}`, dispose });
        return dispose;
      },
      register: (options, component) => {
        slots.push({ options, component });
        return noop;
      },
    },
    sidebarRightTabs: {
      register: (definition) => {
        tabType = definition;
        return noop;
      },
    },
    sidebarRight: {
      commandTarget: () => target,
      openTabFromTarget: (kind, captured) => opened.push({ via: 'target', kind, target: captured }),
      openTab: (kind, options) => opened.push({ via: 'openTab', kind, options }),
      active: () => ({ id: 'guide-1', kind: 'guide' }),
    },
    remote: {
      workspaceFiles: {
        list: async () => ({ ok: true, value: { entries: [], truncated: false } }),
        read: async () => ({ ok: true, value: { text: '', lines: 0, eof: true } }),
        readBytes: async () => ({ ok: true, value: { data: new Uint8Array() } }),
      },
    },
  };

  return {
    ctx,
    effects,
    slots,
    opened,
    getTabType: () => tabType,
    setTarget: (next) => { target = next; },
  };
}

/** Depth-first walk over the element tree produced by the React stub. */
export function walk(node, visit) {
  if (node === null || node === undefined || typeof node === 'string') return;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  visit(node);
  if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, visit));
}
