// Optional control panel for AstraStarField. Decoupled from the library: it reads
// the option metadata off the instance (hero.constructor.OPTIONS) and drives it
// through hero.setOption(). Usage:
//
//   import { AstraStarField } from './astra-star-field.js';
//   import { mountControlPanel } from './astra-star-field-panel.js';
//   mountControlPanel(new AstraStarField());
//
// A small button appears when the pointer moves over the page and opens a panel
// of live controls (shape, particle count, glyph size, trail, glow, and so on).

const STYLE_ID = 'astra-star-field-panel-styles';
const STYLE_TEXT = `
.aa-panel-root { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
  font: 500 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #e8e8ee; }
.aa-panel-btn { width: 40px; height: 40px; border-radius: 999px; display: grid; place-items: center;
  cursor: pointer; color: #e8e8ee; background: rgba(18, 18, 22, 0.62); border: 1px solid rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45);
  opacity: 0; transform: translateY(6px); transition: opacity 220ms ease, transform 220ms ease, background 160ms ease; }
.aa-panel-root.is-awake .aa-panel-btn,
.aa-panel-root.is-open .aa-panel-btn { opacity: 1; transform: translateY(0); }
.aa-panel-btn:hover { background: rgba(34, 34, 40, 0.8); }
.aa-panel-btn svg { width: 18px; height: 18px; display: block; }

.aa-panel { position: absolute; right: 0; bottom: 52px; width: 248px; padding: 12px;
  border-radius: 14px; background: rgba(12, 12, 16, 0.8); border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  opacity: 0; transform: translateY(8px) scale(0.98); transform-origin: bottom right; pointer-events: none;
  transition: opacity 200ms ease, transform 200ms ease;
  display: flex; flex-direction: column; max-height: calc(100vh - 88px);
  box-sizing: border-box; }
.aa-panel-root.is-open .aa-panel { opacity: 1; transform: none; pointer-events: auto; }

/* The head stays put and the controls scroll under it, so a long option list
   cannot push the title off the top of the screen. */
.aa-panel-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 2px 2px 10px; }
.aa-panel-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  padding-right: 6px; margin-right: -6px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.22) transparent; }
.aa-panel-body::-webkit-scrollbar { width: 6px; }
.aa-panel-body::-webkit-scrollbar-track { background: transparent; }
.aa-panel-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.22); border-radius: 3px; }
.aa-panel-body::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.36); }
.aa-panel-title { letter-spacing: 0.04em; color: #cfcfd8; }
.aa-panel-actions { display: flex; gap: 6px; }
.aa-panel-act { font: inherit; color: #b3b3c0; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 7px; cursor: pointer; padding: 3px 8px; transition: color 140ms ease, background 140ms ease; }
.aa-panel-act:hover { color: #fff; background: rgba(255,255,255,0.12); }
.aa-panel-act.is-done { color: #8be09b; border-color: rgba(139,224,155,0.4); }

.aa-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px 10px; padding: 6px 2px; }
.aa-row label { color: #b3b3c0; }
.aa-row .aa-val { color: #8a8a95; text-align: right; min-width: 40px; font-variant-numeric: tabular-nums; }
.aa-row input[type=range] { grid-column: 1 / -1; width: 100%; accent-color: #cbd8ff; height: 18px; }
.aa-row.aa-range .aa-slider { grid-column: 1 / -1; }
.aa-row select { font: inherit; color: #e8e8ee; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.16);
  border-radius: 7px; padding: 3px 6px; }
.aa-row input[type=color] { width: 30px; height: 22px; padding: 0; border: 1px solid rgba(255,255,255,0.2);
  border-radius: 6px; background: none; cursor: pointer; }
.aa-row input[type=checkbox] { width: 16px; height: 16px; accent-color: #cbd8ff; cursor: pointer; }
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_TEXT;
  document.head.appendChild(style);
}

const GEAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.4 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1H2a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 3.7 8.4a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H8a1.7 1.7 0 0 0 1-1.56V2a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V8a1.7 1.7 0 0 0 1.56 1H22a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/></svg>`;

export function mountControlPanel(hero, { container = document.body, awakeTimeout = 2600 } = {}) {
  injectStyles();
  const meta = hero.constructor.OPTIONS || [];
  const defaults = hero.constructor.DEFAULTS || {};
  const values = hero.getOptions();

  const root = document.createElement('div');
  root.className = 'aa-panel-root';

  const btn = document.createElement('button');
  btn.className = 'aa-panel-btn';
  btn.type = 'button';
  btn.title = 'Customize';
  btn.setAttribute('aria-label', 'Customize animation');
  btn.innerHTML = GEAR_SVG;

  const panel = document.createElement('div');
  panel.className = 'aa-panel';

  const head = document.createElement('div');
  head.className = 'aa-panel-head';
  const title = document.createElement('span');
  title.className = 'aa-panel-title';
  title.textContent = 'AstraStarField';
  const actions = document.createElement('div');
  actions.className = 'aa-panel-actions';
  const copy = document.createElement('button');
  copy.className = 'aa-panel-act';
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.title = 'Copy an AstraStarField(...) snippet with your changes';
  const reset = document.createElement('button');
  reset.className = 'aa-panel-act';
  reset.type = 'button';
  reset.textContent = 'Reset';
  actions.append(copy, reset);
  head.append(title, actions);
  panel.appendChild(head);

  const body = document.createElement('div');
  body.className = 'aa-panel-body';
  // The hero flips shapes on wheel. If the panel is mounted inside it, keep
  // scrolling the option list from doing that too.
  body.addEventListener('wheel', (e) => e.stopPropagation());
  panel.appendChild(body);

  const setters = [];
  const fmt = (v) => (Number.isInteger(v) ? String(v) : Number(v).toFixed(2));

  for (const opt of meta) {
    const row = document.createElement('div');
    row.className = 'aa-row' + (opt.type === 'range' ? ' aa-range' : '');
    const label = document.createElement('label');
    label.textContent = opt.label || opt.key;
    label.htmlFor = 'aa-' + opt.key;
    row.appendChild(label);

    let input;
    let sync = () => {};
    if (opt.type === 'range') {
      const valEl = document.createElement('span');
      valEl.className = 'aa-val';
      row.appendChild(valEl);
      input = document.createElement('input');
      input.type = 'range';
      input.className = 'aa-slider';
      input.min = opt.min;
      input.max = opt.max;
      input.step = opt.step;
      input.value = values[opt.key];
      valEl.textContent = fmt(Number(input.value));
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        valEl.textContent = fmt(v);
        hero.setOption(opt.key, v);
      });
      sync = (v) => {
        input.value = v;
        valEl.textContent = fmt(Number(v));
      };
      row.appendChild(input);
    } else if (opt.type === 'select') {
      input = document.createElement('select');
      for (const value of opt.values) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = value;
        input.appendChild(o);
      }
      input.value = values[opt.key];
      input.addEventListener('change', () => hero.setOption(opt.key, input.value));
      sync = (v) => {
        input.value = v;
      };
      row.appendChild(input);
    } else if (opt.type === 'color') {
      input = document.createElement('input');
      input.type = 'color';
      input.value = values[opt.key] || defaults[opt.key] || '#000000';
      input.addEventListener('input', () => hero.setOption(opt.key, input.value));
      sync = (v) => {
        if (v) input.value = v;
      };
      row.appendChild(input);
    } else if (opt.type === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!values[opt.key];
      input.addEventListener('change', () => hero.setOption(opt.key, input.checked));
      sync = (v) => {
        input.checked = !!v;
      };
      row.appendChild(input);
    }
    if (input) input.id = 'aa-' + opt.key;
    setters.push({ key: opt.key, sync });
    body.appendChild(row);
  }

  reset.addEventListener('click', () => {
    for (const { key, sync } of setters) {
      if (!(key in defaults)) continue;
      const v = defaults[key];
      if (v === null) continue;
      hero.setOption(key, v);
      sync(v);
    }
  });

  const serialize = (v) => {
    if (typeof v === 'number') return String(Number(v.toFixed(4)));
    if (typeof v === 'string') return JSON.stringify(v);
    return String(v);
  };
  const buildSnippet = () => {
    const current = hero.getOptions();
    const changed = meta
      .map((o) => o.key)
      .filter((k) => k in defaults && current[k] !== defaults[k] && current[k] != null);
    if (!changed.length) return 'new AstraStarField()';
    return `new AstraStarField({\n${changed.map((k) => `  ${k}: ${serialize(current[k])},`).join('\n')}\n})`;
  };
  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the legacy path */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  };
  copy.addEventListener('click', async () => {
    const ok = await copyText(buildSnippet());
    copy.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    copy.classList.toggle('is-done', ok);
    clearTimeout(copy._t);
    copy._t = setTimeout(() => {
      copy.textContent = 'Copy';
      copy.classList.remove('is-done');
    }, 1400);
  });

  root.append(btn, panel);
  container.appendChild(root);

  // Visibility: wake the button on pointer movement, sleep after inactivity.
  let open = false;
  let timer = null;
  const wake = () => {
    root.classList.add('is-awake');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!open) root.classList.remove('is-awake');
    }, awakeTimeout);
  };
  const onMove = () => wake();
  window.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerenter', wake);

  const toggle = () => {
    open = !open;
    root.classList.toggle('is-open', open);
    if (open) {
      root.classList.add('is-awake');
      if (timer) clearTimeout(timer);
    } else {
      wake();
    }
  };
  btn.addEventListener('click', toggle);
  document.addEventListener('pointerdown', (e) => {
    if (open && !root.contains(e.target)) toggle();
  });

  // Keep controls in sync when options change from keyboard or wheel input.
  const unsubscribe = hero.onOptionChange
    ? hero.onOptionChange((key, value) => {
        const s = setters.find((x) => x.key === key);
        if (s) s.sync(value);
      })
    : () => {};

  return {
    el: root,
    open: () => {
      if (!open) toggle();
    },
    close: () => {
      if (open) toggle();
    },
    destroy: () => {
      window.removeEventListener('pointermove', onMove);
      if (timer) clearTimeout(timer);
      unsubscribe();
      root.remove();
    },
  };
}

export default mountControlPanel;
