// Chrome draws the right-click menu natively, so screenshots and screencasts never contain it.
// This module recreates it as HTML for the store images and the promo video:
//   menuTree()   reads the real "AI Text Tools" items by running createContextMenus() from
//                background.js against a stub chrome.contextMenus, so titles and order always
//                match the shipped extension.
//   menuScript   a browser script (inject with page.addScriptTag({ content: menuScript })) that
//                defines window.__contextMenu.show({...}) / .hide(), styled after Chrome's
//                light Windows 11 menu.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ext = path.resolve(import.meta.dirname, '../..');

export function menuTree() {
  const src = readFileSync(path.join(ext, 'background.js'), 'utf8');
  const start = src.indexOf('function createContextMenus()');
  const close = /\r?\n\}\r?\n/g;
  close.lastIndex = start;
  const end = close.exec(src).index + 3;
  const items = [];
  const ctx = {
    chrome: { contextMenus: { removeAll: (cb) => cb(), create: (item) => items.push(item) } },
  };
  vm.createContext(ctx);
  vm.runInContext(`${src.slice(start, end)}\ncreateContextMenus();`, ctx);
  const byId = new Map(items.map((i) => [i.id, { id: i.id, title: i.title, separator: i.type === 'separator', children: [] }]));
  const roots = [];
  for (const i of items) (i.parentId ? byId.get(i.parentId).children : roots).push(byId.get(i.id));
  if (roots.length !== 1 || roots[0].title !== 'AI Text Tools') throw new Error('Unexpected context menu layout in background.js');
  return roots[0];
}

function browserMenu() {
  const css = `
  .xm{position:fixed;z-index:2147483646;background:#fff;border-radius:8px;padding:4px 0;min-width:220px;
    font:13px/1 "Segoe UI",system-ui,sans-serif;color:#1f1f1f;
    box-shadow:0 0 0 1px rgba(0,0,0,.09),0 8px 16px rgba(0,0,0,.14),0 2px 4px rgba(0,0,0,.08)}
  .xm .it{height:30px;display:flex;align-items:center;padding:0 14px 0 12px;gap:10px;white-space:nowrap}
  .xm .it.on{background:#e3e3e3}
  .xm .ic{width:16px;height:16px;flex:none;display:block}
  .xm .tx{flex:1}
  .xm .kb{color:#6b6b6b;margin-left:28px}
  .xm .ar{width:16px;text-align:right;color:#444;font-size:15px;margin-left:16px}
  .xm .sep{height:1px;background:#e5e5e5;margin:4px 0}
  .xm .dim{color:#9a9a9a}`;
  function row(item, opts) {
    if (item.separator) return '<div class="sep"></div>';
    const icon = item.icon ? `<img class="ic" src="${item.icon}">` : '<span class="ic"></span>';
    return `<div class="it${item.on ? ' on' : ''}${item.dim ? ' dim' : ''}" data-id="${item.id || ''}">${icon}<span class="tx">${item.title}</span>${item.kb ? `<span class="kb">${item.kb}</span>` : ''}${item.sub ? '<span class="ar">&#8250;</span>' : ''}</div>`;
  }
  function panel(items, x, y) {
    const el = document.createElement('div');
    el.className = 'xm';
    el.innerHTML = items.map((i) => row(i)).join('');
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);
    return el;
  }
  const state = { els: [] };
  window.__contextMenu = {
    /**
     * tree: menuTree() result. path: ids to open, e.g. ['fixGrammar'] or ['translateSubmenu', 'translateUkrainian'].
     * The last id is highlighted; each earlier id opens its submenu.
     */
    show({ x, y, tree, icon, path = [], openRoot = true }) {
      this.hide();
      if (!document.getElementById('xm-style')) {
        const s = document.createElement('style');
        s.id = 'xm-style';
        s.textContent = css;
        document.head.appendChild(s);
      }
      const main = [
        { title: 'Cut', kb: 'Ctrl+X' }, { title: 'Copy', kb: 'Ctrl+C' }, { title: 'Paste', kb: 'Ctrl+V' },
        { title: 'Paste as plain text', kb: 'Ctrl+Shift+V' }, { title: 'Select all', kb: 'Ctrl+A' },
        { separator: true }, { title: 'Spell check', sub: true }, { title: 'Writing Direction', sub: true },
        { separator: true }, { id: tree.id, title: tree.title, icon, sub: true, on: openRoot },
        { separator: true }, { title: 'Inspect' },
      ];
      const vw = innerWidth, vh = innerHeight;
      let el = panel(main, x, y);
      const fit = (el, px, py, fromLeft) => {
        const r = el.getBoundingClientRect();
        let nx = px, ny = py;
        if (nx + r.width > vw - 4) nx = fromLeft != null ? fromLeft - r.width + 4 : vw - r.width - 4;
        if (ny + r.height > vh - 4) ny = vh - r.height - 4;
        el.style.left = `${Math.max(4, nx)}px`;
        el.style.top = `${Math.max(4, ny)}px`;
      };
      fit(el, x, y);
      state.els = [el];
      if (!openRoot) return el.getBoundingClientRect();
      let items = tree.children, anchor = el.querySelector(`[data-id="${tree.id}"]`);
      for (let depth = 0; depth <= path.length; depth++) {
        const id = path[depth];
        const rows = items.map((c) => ({ id: c.id, title: c.title, separator: c.separator, sub: c.children.length > 0, on: c.id === id }));
        const a = anchor.getBoundingClientRect();
        const sub = panel(rows, a.right - 2, a.top - 4);
        fit(sub, a.right - 2, a.top - 4, a.left);
        state.els.push(sub);
        const next = items.find((c) => c.id === id);
        if (!next || !next.children.length) break;
        items = next.children;
        anchor = sub.querySelector(`[data-id="${id}"]`);
      }
      return state.els.at(-1).getBoundingClientRect();
    },
    /** Centre of a visible menu row, for a cursor to travel to. */
    point(id) {
      for (const el of [...state.els].reverse()) {
        const row = el.querySelector(`[data-id="${id}"]`);
        if (row) { const r = row.getBoundingClientRect(); return { x: r.left + Math.min(70, r.width / 3), y: r.top + r.height / 2 }; }
      }
      return null;
    },
    hide() { for (const el of state.els) el.remove(); state.els = []; },
  };
}

export const menuScript = `(${browserMenu.toString()})();`;
