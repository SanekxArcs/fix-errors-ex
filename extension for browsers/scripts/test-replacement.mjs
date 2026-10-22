import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const content = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');
const context = vm.createContext({ setTimeout, NodeFilter: { SHOW_TEXT: 4 } });
vm.runInContext(`let savedSelectionInfo = null; ${content.slice(content.indexOf('  async function insertTextGuarded'), content.indexOf('  function showInlineReviewPanel'))}`, context);
context.getSelectionFor = () => ({ rangeCount: 0 });
context.document = { execCommand: () => true };
context.el = { isConnected: true, innerText: 'typo' };

// Editors can report a successful command but reject/revert the change.
await assert.rejects(vm.runInContext('insertTextGuarded(el, "fixed", "typo")', context), /did not keep/);
context.document.execCommand = () => {
  context.el.innerText = 'fixed';
  setTimeout(() => { context.el.innerText = 'typo'; }, 0);
  return true;
};
await assert.rejects(vm.runInContext('insertTextGuarded(el, "fixed", "typo")', context), /did not keep/);
context.document.execCommand = () => { context.el.innerText = 'fixed'; return true; };
await vm.runInContext('insertTextGuarded(el, "fixed", "typo")', context);
await assert.rejects(vm.runInContext('replaceSelectedText("typo", "fixed")', context), /selection is no longer/);
vm.runInContext('savedSelectionInfo = { text: "different request" }', context);
await assert.rejects(vm.runInContext('replaceSelectedText("typo", "fixed")', context), /Another selection/);

// Recover a range after Slack rebuilds unchanged text nodes, including a partial
// selection across two nodes. Refuse changed or ambiguous messages.
const nodes = [{ length: 4 }, { length: 4 }];
context.info = { element: { isConnected: true, textContent: 'say typo' }, value: 'say typo', text: 'typo' };
context.document.createTreeWalker = () => {
  let i = 0;
  return { nextNode: () => nodes[i++] || null };
};
context.document.createRange = () => ({
  setStart(node, offset) { this.start = [node, offset]; },
  setEnd(node, offset) { this.end = [node, offset]; }
});
let range = vm.runInContext('recoverEditableRange(info)', context);
assert.deepEqual(range.start, [nodes[1], 0]);
assert.deepEqual(range.end, [nodes[1], 4]);
context.info.text = 'y ty';
range = vm.runInContext('recoverEditableRange(info)', context);
assert.deepEqual(range.start, [nodes[0], 2]);
assert.deepEqual(range.end, [nodes[1], 2]);
context.info.element.textContent = 'changed';
assert.equal(vm.runInContext('recoverEditableRange(info)', context), null);
context.info = { element: { isConnected: true, textContent: 'typo typo' }, value: 'typo typo', text: 'typo' };
assert.equal(vm.runInContext('recoverEditableRange(info)', context), null);

// Never treat a missing acknowledgement or a lost connection as successful.
vm.runInContext(background.slice(background.indexOf('async function applyGeneratedText'), background.indexOf('// ─────', background.indexOf('async function applyGeneratedText'))), context);
context.chrome = { tabs: { sendMessage: async () => ({ replaced: false, error: 'Slack rejected it' }) } };
assert.equal((await vm.runInContext('applyGeneratedText(1, "typo", "fixed")', context)).replaced, false);
context.chrome.tabs.sendMessage = async () => undefined;
assert.equal((await vm.runInContext('applyGeneratedText(1, "typo", "fixed")', context)).replaced, false);
context.chrome.tabs.sendMessage = async () => { throw new Error('Tab closed'); };
assert.equal((await vm.runInContext('applyGeneratedText(1, "typo", "fixed")', context)).replaced, false);
context.chrome.tabs.sendMessage = async () => ({ replaced: true });
assert.equal((await vm.runInContext('applyGeneratedText(1, "typo", "fixed")', context)).replaced, true);
console.log('Replacement regression checks passed.');
