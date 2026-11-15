type Child = Node | string | number | null | undefined | false;
type Props = Record<string, any>;

/** Minimal hyperscript helper: h('div.card#id', {onclick}, ...children). */
export function h<K extends keyof HTMLElementTagNameMap>(sel: K | string, props?: Props | Child, ...kids: Child[]): HTMLElement {
  if (props instanceof Node || typeof props !== 'object' || props === null) { kids.unshift(props as Child); props = {}; }
  const [tag, ...rest] = sel.split(/(?=[.#])/);
  const el = document.createElement(tag || 'div');
  for (const r of rest) r[0] === '.' ? el.classList.add(r.slice(1)) : (el.id = r.slice(1));
  for (const [k, v] of Object.entries(props as Props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info') {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div#toasts'); document.body.append(host); }
  const t = h(`div.toast.${kind}`, message);
  host.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
