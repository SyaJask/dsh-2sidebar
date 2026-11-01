import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient, createContext, walk } from './harness.mjs';

function setup() {
  const loaded = loadClient();
  const handle = createContext();
  loaded.module.apply(handle.ctx);
  return { ...loaded, ...handle };
}

function stringsOf(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((child) => stringsOf(child, out));
  else if (node && Array.isArray(node.children)) node.children.forEach((child) => stringsOf(child, out));
  return out;
}

test('bundle identity and required client services', () => {
  const { module } = setup();
  assert.deepEqual(module.inject, [
    'slots',
    'locale',
    'sidebarRightTabs',
    'sidebarRight',
    'remote',
    'remote.workspaceFiles',
  ]);
  assert.ok(!module.inject.includes('sessions'), 'the removed sessions service must stay out of inject');
});

test('tab type keeps the stable identity and keepMounted contract', () => {
  const { getTabType } = setup();
  const type = getTabType();
  assert.equal(type.id, 'dsh-2sidebar');
  assert.equal(type.kind, 'split-files');
  assert.equal(type.keepMounted, true);
  assert.equal(typeof type.title, 'function');
  assert.ok(Array.isArray(type.guide) && type.guide.length > 0);
});

test('body inject face exposes Remote readers but no session subscription', () => {
  const { slots } = setup();
  const body = slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab');
  assert.ok(body, 'body slot must be registered');
  const injected = body.options.inject('s1');
  assert.equal(injected.sessionId, 's1');
  for (const field of ['list', 'read', 'readBytes']) {
    assert.equal(typeof injected[field], 'function', `${field} must be injected`);
  }
  assert.ok(!('getCwd' in injected));
  assert.ok(!('subscribeSessions' in injected));
});

test('body reads the workspace root through the useSessions standard prop', () => {
  const { slots } = setup();
  const body = slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab');
  const injected = body.options.inject('s1');
  let calls = 0;
  const tree = body.component({
    ...injected,
    t: (key) => key,
    useSessions: (selector) => {
      calls += 1;
      return selector({ byId: { s1: { cwd: 'C:/ws' } } });
    },
  });
  assert.equal(calls, 1, 'useSessions must be the single source of the workspace root');
  const paths = [];
  walk(tree, (element) => {
    if (element.props && typeof element.props.path === 'string') paths.push(element.props.path);
  });
  assert.ok(paths.includes('C:/ws'), `rendered paths: ${paths.join(', ')}`);
});

test('header button receives its open callback through the inject face', () => {
  const { slots, opened, setTarget } = setup();
  const header = slots.find((entry) => entry.options.name === 'conversation.session.header.utilities');
  assert.ok(header, 'header button slot must be registered');
  assert.equal(typeof header.options.inject, 'function');
  const face = header.options.inject();
  assert.equal(typeof face.open, 'function');
  assert.ok(!String(header.component).includes('ctx.'), 'the component must not close over ctx');

  const button = header.component(face);
  assert.equal(button.type, 'button');
  assert.equal(button.props.onClick, face.open);

  button.props.onClick();
  assert.equal(opened.length, 1);
  assert.equal(opened[0].via, 'target');
  assert.equal(opened[0].kind, 'split-files');

  setTarget(undefined);
  button.props.onClick();
  assert.equal(opened.length, 2);
  assert.equal(opened[1].via, 'openTab');
  assert.equal(opened[1].kind, 'split-files');
  assert.equal(opened[1].options.replaceTab, 'guide-1');
});

test('title slot renders the captured tab title', () => {
  const { slots } = setup();
  const title = slots.find((entry) => entry.options.name === 'sidebar.right.pane.tab.title');
  assert.ok(title, 'title slot must be registered');
  const element = title.component({ useTabInfo: () => ({ tab: { title: '目录分栏' } }) });
  assert.ok(stringsOf(element).includes('目录分栏'));
});
