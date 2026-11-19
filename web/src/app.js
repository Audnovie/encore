
(() => {
'use strict';
const FORCE_DEMO = false;
/* ---------- small helpers ---------- */
/* shown at the bottom of Settings, so you can tell which version a phone is running; raised with every update */
const APP_VERSION = '1.5';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const tpl = document.createElement('template');
function htmlEl(html) { tpl.innerHTML = html.trim(); return tpl.content.firstElementChild; }

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function plural(n, word) { return `${Number(n).toLocaleString()} ${word}${n === 1 ? '' : 's'}`; }
function fmtTotal(sec) {
  const mins = Math.max(1, Math.round(sec / 60));
  if (mins < 60) return plural(mins, 'minute');
  const h = Math.floor(mins / 60), m = mins % 60;
  return plural(h, 'hour') + (m ? ', ' + plural(m, 'minute') : '');
}
function initials(name) {
  const parts = String(name || '?').trim().split(/[\s._-]+/).filter(Boolean);
  const s = (parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '');
  return s.toUpperCase();
}
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* localStorage that never throws */
const store = {
  get(k, d) { try { const v = localStorage.getItem('encore.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('encore.' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem('encore.' + k); } catch (e) { /* ignore */ } },
};

/* MD5 (for Subsonic token auth: md5(password + salt)) */
function md5(str) {
  const bytes = new TextEncoder().encode(str);
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  const R = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const len = bytes.length, nBlocks = ((len + 8) >>> 6) + 1, w = new Uint32Array(nBlocks * 16);
  for (let i = 0; i < len; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
  w[len >> 2] |= 0x80 << ((len % 4) * 8);
  w[nBlocks * 16 - 2] = (len * 8) >>> 0;
  w[nBlocks * 16 - 1] = Math.floor(len / 0x20000000);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let b = 0; b < nBlocks; b++) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + w[b * 16 + g]) >>> 0;
      A = D; D = C; C = B;
      const s = R[(i >> 4) * 4 + (i % 4)];
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map((x) => [0, 8, 16, 24].map((sh) => ((x >>> sh) & 255).toString(16).padStart(2, '0')).join('')).join('');
}
function randomSalt(n = 12) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}

/* Physical spring → CSS linear() easing (falls back to a cubic-bezier where linear() isn't supported) */
const SUPPORTS_LINEAR = (() => { try { return CSS.supports('transition-timing-function', 'linear(0, 0.5, 1)'); } catch (e) { return false; } })();
function spring(stiffness, damping, fallback) {
  let pos = 0, vel = 0, t = 0;
  const dt = 1 / 240, samples = [0];
  while (t < 2.5) {
    const a = -stiffness * (pos - 1) - damping * vel;
    vel += a * dt; pos += vel * dt; t += dt;
    samples.push(pos);
    if (Math.abs(pos - 1) < 0.0015 && Math.abs(vel) < 0.015) break;
  }
  const duration = Math.round(t * 1000);
  if (!SUPPORTS_LINEAR) return { easing: fallback || 'cubic-bezier(.32,.72,0,1)', duration };
  const n = 44, pts = [];
  for (let i = 0; i <= n; i++) {
    const v = samples[Math.round((i / n) * (samples.length - 1))];
    pts.push(+v.toFixed(4));
  }
  pts[pts.length - 1] = 1;
  return { easing: `linear(${pts.join(', ')})`, duration };
}
const SP = {
  ui: spring(240, 29, 'cubic-bezier(.32,.72,0,1)'),
  snap: spring(380, 33, 'cubic-bezier(.25,.9,.3,1.05)'),
  nav: spring(310, 35, 'cubic-bezier(.2,.85,.25,1)'),
  sheet: spring(250, 30, 'cubic-bezier(.32,.72,0,1)'),
};

/* event emitter */
function emitter(obj) {
  const map = new Map();
  obj.on = (ev, fn) => { if (!map.has(ev)) map.set(ev, new Set()); map.get(ev).add(fn); return () => map.get(ev).delete(fn); };
  obj.emit = (ev, ...args) => { const s = map.get(ev); if (s) s.forEach((fn) => { try { fn(...args); } catch (e) { console.error(e); } }); };
  return obj;
}

/* sort helpers */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
function sortKey(s) { return String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim(); }
function letterOf(k) {
  const c = (k || '').charAt(0).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}
function keyed(list, field) {
  for (const x of list) { const k = sortKey(x[field]); x._k = k; x._L = letterOf(k); }
  return list;
}
function cmpKeyed(a, b) {
  const ha = a._L === '#', hb = b._L === '#';
  if (ha !== hb) return ha ? 1 : -1;
  return collator.compare(a._k, b._k);
}
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');

/* colour helpers */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
function relLum(rgb) {
  const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}
function contrastRatio(a, b) {
  const la = relLum(a), lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/* text colour that stays readable on a given fill */
function inkFor(hex) {
  const c = hexToRgb(hex);
  if (!c) return '#fff';
  /* white reads best on mid-tone colours (like iOS buttons); dark text only on light ones */
  const onWhite = contrastRatio(c, { r: 255, g: 255, b: 255 });
  if (onWhite >= 3) return '#fff';
  return onWhite >= contrastRatio(c, { r: 17, g: 17, b: 17 }) ? '#fff' : '#111';
}
function cssColorToRgb(str) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(String(str || ''));
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : hexToRgb(str);
}

/* time & number formatting for stats */
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtListen(sec, { short = false } = {}) {
  const mins = Math.round((sec || 0) / 60);
  if (mins < 1) return sec > 0 ? (short ? '<1 min' : 'under a minute') : (short ? '0 min' : '0 minutes');
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return short ? `${m} min` : plural(m, 'minute');
  if (short) return m && h < 100 ? `${h} hr ${m} min` : `${h.toLocaleString()} hr`;
  return plural(h, 'hour') + (m ? ` ${plural(m, 'minute')}` : '');
}
function fmtCompact(n) {
  n = Math.round(n || 0);
  if (n < 10000) return n.toLocaleString();
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e5 ? 1 : 0).replace(/\.0$/, '') + 'K';
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}
function fmtAgo(iso) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return '';
  const d = new Date(t), now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/* ---------- icons (drawn for this app) ---------- */
const svg = (vb, body, attrs = '') => `<svg viewBox="${vb}" aria-hidden="true" ${attrs}>${body}</svg>`;
const NOTE_PATH = 'M11.8 4H13.5L18.5 5.4V8.7L13.5 7.4V17.5A3.5 3.5 0 1 1 11.8 14.5Z';
const I = {
  note: svg('0 0 24 24', `<path fill="currentColor" d="${NOTE_PATH}"/>`),
  playlists: svg('0 0 24 24', `<path d="M2.5 6.5h9M2.5 11h9M2.5 15.5h6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path fill="currentColor" d="M15.8 4.2H17.5L21.5 5.4V8.3L17.5 7.2V17.6A3.2 3.2 0 1 1 15.8 14.9Z"/>`),
  mic: svg('0 0 24 24', `<circle cx="15.4" cy="8.6" r="5.3" fill="currentColor"/><path d="M11.4 11.3l1.3 1.3-7.7 8.4c-.5.5-1.2.5-1.7 0l-.3-.3c-.5-.5-.5-1.2 0-1.7z" fill="currentColor"/><path d="M12.3 4.9l6.8 6.8" style="stroke:rgba(0,0,0,.35)" stroke-width="1.3"/><path d="M5.4 20.4c.9 1.1 2.3 1.4 3.4.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`),
  chart: svg('0 0 24 24', `<rect x="2.5" y="12" width="3.5" height="9.5" rx="1.5" fill="currentColor"/><rect x="7.7" y="7" width="3.5" height="14.5" rx="1.5" fill="currentColor"/><rect x="12.9" y="2.5" width="3.5" height="19" rx="1.5" fill="currentColor"/><rect x="18.1" y="9.5" width="3.5" height="12" rx="1.5" fill="currentColor"/>`),
  album: svg('0 0 24 24', `<rect x="4.4" y="8.2" width="15.2" height="13.6" rx="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.8 5.1h10.4M9.1 2.2h5.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  libraryTab: svg('0 0 24 30', `<path d="M5.5 5.3h13M8 2h8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path fill="currentColor" fill-rule="evenodd" d="M7.5 9H16.5A4.5 4.5 0 0 1 21 13.5V22.5A4.5 4.5 0 0 1 16.5 27H7.5A4.5 4.5 0 0 1 3 22.5V13.5A4.5 4.5 0 0 1 7.5 9ZM11.55 12.48H12.65L15.9 13.39V15.53L12.65 14.69V21.25A2.28 2.28 0 1 1 11.55 19.3Z"/>`),
  radio: svg('0 0 30 24', `<circle cx="15" cy="12" r="2.5" fill="currentColor"/><path d="M10.3 7.3a6.7 6.7 0 0 0 0 9.4M19.7 7.3a6.7 6.7 0 0 1 0 9.4M6.4 3.4a12.2 12.2 0 0 0 0 17.2M23.6 3.4a12.2 12.2 0 0 1 0 17.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),
  search: svg('0 0 24 24', `<circle cx="10.3" cy="10.3" r="7" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5 21 21" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`),
  play: svg('0 0 24 24', `<path fill="currentColor" d="M6.5 4.9c0-1 1-1.5 1.9-1l11.3 7c.8.5.8 1.7 0 2.2l-11.3 7c-.9.5-1.9 0-1.9-1.1z"/>`),
  pause: svg('0 0 24 24', `<rect x="5.3" y="3.7" width="4.7" height="16.6" rx="1.3" fill="currentColor"/><rect x="14" y="3.7" width="4.7" height="16.6" rx="1.3" fill="currentColor"/>`),
  next: svg('0 0 24 24', `<path fill="currentColor" d="M2 6.3c0-1 1-1.5 1.8-1l7.4 5.4c.7.5.7 1.5 0 2l-7.4 5.4C3 18.6 2 18.1 2 17.1zM12.4 6.3c0-1 1-1.5 1.8-1l7.4 5.4c.7.5.7 1.5 0 2l-7.4 5.4c-.8.5-1.8 0-1.8-1z"/>`),
  prev: svg('0 0 24 24', `<g transform="matrix(-1 0 0 1 24 0)"><path fill="currentColor" d="M2 6.3c0-1 1-1.5 1.8-1l7.4 5.4c.7.5.7 1.5 0 2l-7.4 5.4C3 18.6 2 18.1 2 17.1zM12.4 6.3c0-1 1-1.5 1.8-1l7.4 5.4c.7.5.7 1.5 0 2l-7.4 5.4c-.8.5-1.8 0-1.8-1z"/></g>`),
  ellipsis: svg('0 0 24 24', `<circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/>`),
  chevR: svg('0 0 9 15', `<path d="M1.5 1.5 7.5 7.5 1.5 13.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`, 'class="chev"'),
  chevL: svg('0 0 24 24', `<path d="M15.5 3.5 7 12l8.5 8.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`),
  chevD: svg('0 0 24 24', `<path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`),
  plus: svg('0 0 24 24', `<path d="M12 4.5v15M4.5 12h15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>`),
  sort: svg('0 0 24 24', `<path d="M3.5 6.5h17M6.5 12h11M9.5 17.5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),
  listPlus: svg('0 0 24 24', `<circle cx="7.5" cy="7.5" r="5.2" fill="currentColor"/><path d="M7.5 5v5M5 7.5h5" style="stroke:var(--bg)" stroke-width="1.9" stroke-linecap="round"/><path d="M15 5h6.5M15 10h6.5M3 15.5h18.5M3 20h18.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  shuffle: svg('0 0 24 24', `<path d="M2.5 7h3.3c2.4 0 3.8 1.1 5 3.2l1.9 3.4c1.2 2.1 2.6 3.2 5 3.2H21M2.5 17h3.3c2.4 0 3.8-1.1 5-3.2M13.3 10.2c1.2-2.1 2.6-3.2 5-3.2H21M18.2 4.2 21 7l-2.8 2.8M18.2 14.2 21 17l-2.8 2.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  repeat: svg('0 0 24 24', `<path d="M3.5 11.5V9.8A3.5 3.5 0 0 1 7 6.3h13.5M17.7 3.5l2.8 2.8-2.8 2.8M20.5 12.5v1.7a3.5 3.5 0 0 1-3.5 3.5H3.5M6.3 20.5l-2.8-2.8 2.8-2.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  repeat1: svg('0 0 24 24', `<path d="M3.5 11.5V9.8A3.5 3.5 0 0 1 7 6.3h13.5M17.7 3.5l2.8 2.8-2.8 2.8M20.5 12.5v1.7a3.5 3.5 0 0 1-3.5 3.5H3.5M6.3 20.5l-2.8-2.8 2.8-2.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.2 10.4l1.5-1v5.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  playNext: svg('0 0 24 24', `<path fill="currentColor" d="M2.8 3.7c0-.7.8-1.1 1.4-.7l3.6 2.4c.5.4.5 1.1 0 1.5L4.2 9.3c-.6.4-1.4 0-1.4-.7z"/><path d="M11 6.2h10.3M5 12h16.3M5 17.8h16.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),
  playLast: svg('0 0 24 24', `<path fill="currentColor" d="M2.8 15.3c0-.7.8-1.1 1.4-.7l3.6 2.4c.5.4.5 1.1 0 1.5l-3.6 2.4c-.6.4-1.4 0-1.4-.7z"/><path d="M5 6.2h16.3M5 12h16.3M11 17.8h10.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),
  star: svg('0 0 24 24', `<path d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.5l-5.3 2.8 1.1-5.8-4.3-4.1 5.9-.8z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>`),
  starFill: svg('0 0 24 24', `<path d="M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.5l-5.3 2.8 1.1-5.8-4.3-4.1 5.9-.8z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`),
  airplay: svg('0 0 24 24', `<path d="M6.1 16.4a8.4 8.4 0 1 1 11.8 0M8.9 13.7a4.6 4.6 0 1 1 6.2 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path fill="currentColor" d="M12 14.4l4.7 6.1H7.3z"/>`),
  lyrics: svg('0 0 24 24', `<path d="M6.8 3.6h10.4a3.3 3.3 0 0 1 3.3 3.3v6.4a3.3 3.3 0 0 1-3.3 3.3h-5.3l-4.4 3.6c-.6.5-1.4.1-1.4-.7v-2.9a3.3 3.3 0 0 1-2.6-3.3V6.9a3.3 3.3 0 0 1 3.3-3.3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9.9 7.4c-1.4.4-2.2 1.4-2.2 2.9M15.1 7.4c-1.4.4-2.2 1.4-2.2 2.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8.9" cy="10.9" r="1.45" fill="currentColor"/><circle cx="14.1" cy="10.9" r="1.45" fill="currentColor"/>`),
  queue: svg('0 0 24 24', `<circle cx="4.3" cy="6" r="1.5" fill="currentColor"/><circle cx="4.3" cy="12" r="1.5" fill="currentColor"/><circle cx="4.3" cy="18" r="1.5" fill="currentColor"/><path d="M9 6h11.5M9 12h11.5M9 18h11.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>`),
  xmark: svg('0 0 24 24', `<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`),
  xfill: svg('0 0 24 24', `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" style="stroke:var(--bg)" stroke-width="2.1" stroke-linecap="round"/>`),
  minus: svg('0 0 24 24', `<circle cx="12" cy="12" r="9.3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7.7 12h8.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),
  trash: svg('0 0 24 24', `<path d="M4 6.5h16M9.5 6.5V4.3c0-.5.4-.8.8-.8h3.4c.5 0 .8.4.8.8v2.2M6.3 6.5l.9 12.8c.1 1 .9 1.7 1.9 1.7h5.8c1 0 1.8-.7 1.9-1.7l.9-12.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  grip: svg('0 0 24 24', `<path d="M4 8h16M4 12h16M4 16h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`),
  check: svg('0 0 24 24', `<path d="M4.5 12.5 9.5 17.5 19.5 6.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`),
  refresh: svg('0 0 24 24', `<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.7 3.5v4.2h-4.2" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`),
  gear: svg('0 0 24 24', `<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.8v2.5M12 18.7v2.5M21.2 12h-2.5M5.3 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  person: svg('0 0 24 24', `<circle cx="12" cy="8.2" r="4.3" fill="currentColor"/><path fill="currentColor" d="M3.8 20.3c.7-4 4-6.3 8.2-6.3s7.5 2.3 8.2 6.3c.1.6-.4 1.2-1 1.2H4.8c-.6 0-1.1-.6-1-1.2z"/>`),
  spinner: svg('0 0 24 24', Array.from({ length: 8 }, (_, i) => `<rect x="11" y="1.5" width="2.2" height="6.3" rx="1.1" fill="currentColor" opacity="${(0.25 + (i / 8) * 0.75).toFixed(2)}" transform="rotate(${i * 45} 12 12)"/>`).join('')),
  shuffleAll: svg('0 0 24 24', `<path d="M2.5 7h3.3c2.4 0 3.8 1.1 5 3.2l1.9 3.4c1.2 2.1 2.6 3.2 5 3.2H21M2.5 17h3.3c2.4 0 3.8-1.1 5-3.2M13.3 10.2c1.2-2.1 2.6-3.2 5-3.2H21M18.2 4.2 21 7l-2.8 2.8M18.2 14.2 21 17l-2.8 2.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`),
};
const SPIN = `<div class="spin">${I.spinner}</div>`;

/* ---------- Subsonic API client (works with Navidrome, Gonic, Airsonic, Ampache…) ---------- */
let api = null;
class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}
const CLIENT_NAME = 'Encore';

class Subsonic {
  constructor(cfg) {
    this.server = String(cfg.server || '').trim().replace(/\/+$/, '');
    this.user = cfg.user; this.token = cfg.token; this.salt = cfg.salt;
    this.demo = false;
  }
  base() { return (this.server || location.origin) + '/rest/'; }
  params(extra) {
    const p = new URLSearchParams({ u: this.user, t: this.token, s: this.salt, v: '1.16.1', c: CLIENT_NAME, f: 'json' });
    for (const [k, v] of Object.entries(extra || {})) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x)); else p.set(k, v);
    }
    return p;
  }
  url(endpoint, extra) { return this.base() + endpoint + '?' + this.params(extra).toString(); }
  async get(endpoint, extra, { timeout = 25000 } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    let res;
    try {
      res = await fetch(this.url(endpoint, extra), { signal: ctl.signal, credentials: 'omit', cache: 'no-store' });
    } catch (e) {
      throw new ApiError(e && e.name === 'AbortError' ? 'The music server took too long to answer.' : 'Couldn’t reach the music server.', 'network');
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      throw new ApiError(res.status === 404 ? 'No music server answered at that address.' : `The music server answered with error ${res.status}.`, 'http');
    }
    let json;
    try { json = await res.json(); } catch (e) { throw new ApiError('That address didn’t answer like a Subsonic music server.', 'format'); }
    const r = json && json['subsonic-response'];
    if (!r) throw new ApiError('That address didn’t answer like a Subsonic music server.', 'format');
    if (r.status !== 'ok') {
      const code = r.error && r.error.code;
      let msg = (r.error && r.error.message) || 'The music server refused the request.';
      if (code === 40) msg = 'Wrong username or password.';
      if (code === 41) msg = 'This account can’t use token sign-in (LDAP accounts aren’t supported).';
      throw new ApiError(msg, code);
    }
    return r;
  }
  cover(id, size) { return id ? this.url('getCoverArt', { id, size }) : ''; }
  stream(id, quality) {
    const o = { id };
    if (quality && quality !== 'raw') { o.format = 'mp3'; o.maxBitRate = quality; o.estimateContentLength = 'true'; }
    return this.url('stream', o);
  }
  scrobble(id, submission) { return this.get('scrobble', { id, submission: submission ? 'true' : 'false', time: Date.now() }); }
}

/* ---------- normalizers ---------- */
function nSong(s) {
  const artists = Array.isArray(s.artists) ? s.artists : [];
  return {
    id: String(s.id),
    title: s.title || s.name || 'Untitled',
    artist: s.displayArtist || s.artist || artists.map((a) => a.name).join(', ') || 'Unknown Artist',
    artistId: s.artistId || (artists[0] && artists[0].id) || '',
    album: s.album || '',
    albumId: s.albumId || s.parent || '',
    coverArt: s.coverArt || s.albumId || '',
    duration: +s.duration || 0,
    track: +s.track || 0,
    disc: +s.discNumber || 0,
    year: +s.year || 0,
    starred: !!s.starred,
    created: s.created || '',
    playCount: +s.playCount || 0,
    played: s.played || '',
    primaryArtist: (artists[0] && artists[0].name) || '',
    albumArtist: s.displayAlbumArtist || (Array.isArray(s.albumArtists) ? s.albumArtists.map((a) => a.name).join(', ') : '') || '',
  };
}
function nAlbum(a) {
  return {
    id: String(a.id),
    name: a.name || a.title || a.album || 'Untitled',
    artist: a.displayArtist || a.artist || '',
    artistId: a.artistId || '',
    coverArt: a.coverArt || a.id,
    songCount: +a.songCount || 0,
    duration: +a.duration || 0,
    year: +a.year || 0,
    genre: a.genre || (Array.isArray(a.genres) && a.genres[0] && a.genres[0].name) || '',
    created: a.created || '',
    starred: !!a.starred,
    playCount: +a.playCount || 0,
    played: a.played || '',
  };
}
function nArtist(a) {
  return { id: String(a.id), name: a.name || 'Unknown Artist', coverArt: a.coverArt || '', albumCount: +a.albumCount || 0, starred: !!a.starred, image: a.artistImageUrl || '' };
}
function nPlaylist(p) {
  return {
    id: String(p.id), name: p.name || 'Untitled Playlist', songCount: +p.songCount || 0, duration: +p.duration || 0,
    coverArt: p.coverArt || '', owner: p.owner || '', comment: p.comment || '', changed: p.changed || '', created: p.created || '',
    readonly: !!p.readonly,
  };
}
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);

/* ---------- demo library (used by "Try the demo" and the preview) ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DEMO = (() => {
  const rnd = mulberry32(20251011);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const artistsSrc = [
    ['Aster Lane', 'Indie Pop'], ['Bluebird Static', 'Shoegaze'], ['Cinder & Sage', 'Folk'], ['Dune Theory', 'Electronic'],
    ['Halcyon Drive', 'Synthwave'], ['Juniper Kites', 'Indie Rock'], ['Lumen Avenue', 'R&B'], ['Marigold Radio', 'Dream Pop'],
    ['Neon Orchard', 'Electropop'], ['Quiet Harbor', 'Ambient'], ['Saffron Skies', 'Soul'], ['Tidal Postcards', 'Lo-fi'],
    ['Velvet Comet', 'Alt Pop'], ['Wren & the Weather', 'Americana'], ['夜明けの街', 'J-Pop'],
  ];
  const A = ['Golden', 'Paper', 'Neon', 'Quiet', 'Silver', 'Velvet', 'Electric', 'Hollow', 'Northern', 'Midnight', 'Crystal', 'Distant', 'Lucky', 'Static', 'Sugar', 'Glass', 'Summer', 'Winter', 'Ivory', 'Crimson', 'Slow', 'Bright', 'Little', 'Endless', 'Secret', 'Borrowed', 'Restless', 'Gentle'];
  const N = ['Lights', 'Satellites', 'Rivers', 'Echoes', 'Hearts', 'Highways', 'Signals', 'Gardens', 'Comets', 'Letters', 'Mirrors', 'Horizons', 'Weather', 'Shadows', 'Fireworks', 'Daydreams', 'Oceans', 'Postcards', 'Avenues', 'Lanterns', 'Afternoons', 'Stations'];
  const pats = [
    () => `${pick(A)} ${pick(N)}`, () => `${pick(N)} in the ${pick(N)}`, () => `Call It ${pick(A)}`, () => `${pick(A)} Again`,
    () => `Under ${pick(A)} ${pick(N)}`, () => `When the ${pick(N)} Go`, () => `Hold the ${pick(N)}`, () => `Back to the ${pick(N)}`,
    () => `${pick(A)} Hour`, () => `『${pick(A)} ${pick(N)}』 Acoustic`, () => `${2 + Math.floor(rnd() * 40)} ${pick(N)}`,
  ];
  const jp = ['星の手紙', '夏の終わり', '雨上がり', '青い時計', '帰り道', '朝焼け', '風の音', '花火'];
  const now = Date.now();
  const artists = [], albums = [], songs = [];
  artistsSrc.forEach(([name, genre], ai) => {
    const ar = { id: `ar-${ai + 1}`, name, coverArt: `ar-${ai + 1}`, albumCount: 0, genre };
    if (rnd() < 0.2) ar.starred = '2025-01-01T00:00:00Z';
    artists.push(ar);
    const nAlb = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < nAlb; k++) {
      const id = `al-${albums.length + 1}`;
      const isJp = ai === artistsSrc.length - 1;
      const al = {
        id, name: isJp ? pick(jp) : (rnd() < 0.5 ? `${pick(A)} ${pick(N)}` : pick(pats)()), artist: name, artistId: ar.id, coverArt: id,
        year: 2008 + Math.floor(rnd() * 18), genre, songCount: 0, duration: 0,
        created: new Date(now - Math.floor(rnd() * 400) * 86400000).toISOString(),
      };
      if (rnd() < 0.15) al.starred = '2025-01-01T00:00:00Z';
      const nTr = 7 + Math.floor(rnd() * 7);
      for (let t = 0; t < nTr; t++) {
        const dur = 140 + Math.floor(rnd() * 190);
        const s = {
          id: `so-${songs.length + 1}`, parent: id, albumId: id, album: al.name, title: isJp ? pick(jp) + (rnd() < 0.3 ? ' (Remix)' : '') : pick(pats)(),
          artist: name, artistId: ar.id, track: t + 1, discNumber: 1, year: al.year, genre, coverArt: id, duration: dur,
          suffix: 'mp3', created: al.created, type: 'music',
        };
        if (rnd() < 0.1) s.starred = '2025-01-01T00:00:00Z';
        const r = rnd();
        if (r < 0.62) {
          s.playCount = r < 0.07 ? 25 + Math.floor(rnd() * 60) : 1 + Math.floor(rnd() * 14);
          s.played = new Date(now - Math.floor(rnd() * 40 * 86400000)).toISOString();
        }
        songs.push(s); al.songCount++; al.duration += dur;
      }
      albums.push(al); ar.albumCount++;
    }
  });
  const take = (n) => shuffledSeeded(songs, rnd).slice(0, n).map((s) => s.id);
  function shuffledSeeded(list, r) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const playlists = [
    { id: 'pl-1', name: 'Night Drive', entry: take(25), comment: 'Windows down, city lights.' },
    { id: 'pl-2', name: 'Focus Flow', entry: take(30), comment: '' },
    { id: 'pl-3', name: 'Sunday Morning', entry: take(18), comment: '' },
    { id: 'pl-4', name: 'Gym Rotation', entry: take(22), comment: '' },
  ];
  playlists.forEach((p, i) => { p.owner = 'demo'; p.coverArt = p.id; p.created = new Date(now - i * 9e8).toISOString(); p.changed = new Date(now - i * 3e8).toISOString(); });
  const stations = [
    { id: 'r1', name: 'Harbor Lo-fi Radio', streamUrl: 'demo:radio-1', homePageUrl: 'https://example.com' },
    { id: 'r2', name: 'Late Night Jazz FM', streamUrl: 'demo:radio-2', homePageUrl: 'https://example.org' },
  ];
  return { artists, albums, songs, playlists, stations, byId: new Map([...songs, ...albums, ...artists].map((x) => [x.id, x])) };
})();

const DemoArt = (() => {
  const cache = new Map(), canv = new Map();
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function drawAlbum(id) {
    if (canv.has(id)) return canv.get(id);
    const c = document.createElement('canvas'); c.width = c.height = 300;
    const g = c.getContext('2d'); const r = mulberry32(hash(id));
    const h1 = Math.floor(r() * 360), h2 = (h1 + 40 + Math.floor(r() * 140)) % 360;
    const lg = g.createLinearGradient(0, 0, 300, 300);
    lg.addColorStop(0, `hsl(${h1} 65% ${35 + r() * 25}%)`); lg.addColorStop(1, `hsl(${h2} 70% ${15 + r() * 25}%)`);
    g.fillStyle = lg; g.fillRect(0, 0, 300, 300);
    const style = Math.floor(r() * 4);
    g.globalAlpha = 0.55;
    if (style === 0) { g.fillStyle = `hsl(${(h2 + 180) % 360} 80% 65%)`; g.beginPath(); g.arc(80 + r() * 140, 80 + r() * 140, 55 + r() * 70, 0, Math.PI * 2); g.fill(); }
    else if (style === 1) { g.fillStyle = `hsl(${(h1 + 30) % 360} 85% 70%)`; for (let i = 0; i < 7; i++) g.fillRect(0, 25 + i * 40, 300, 12 + r() * 15); }
    else if (style === 2) { g.strokeStyle = `hsl(${(h2 + 60) % 360} 90% 75%)`; g.lineWidth = 7; for (let i = 1; i < 8; i++) { g.beginPath(); g.arc(150, 150, i * 22, 0, Math.PI * 2); g.stroke(); } }
    else { g.fillStyle = '#fff'; for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) if (r() < 0.45) { g.beginPath(); g.arc(20 + x * 33, 20 + y * 33, 5 + r() * 7, 0, Math.PI * 2); g.fill(); } }
    g.globalAlpha = 1;
    const al = DEMO.byId.get(id);
    if (al) {
      g.fillStyle = 'rgba(255,255,255,.92)'; g.font = '700 21px -apple-system, system-ui, sans-serif';
      g.fillText(al.name.slice(0, 22), 18, 270);
      g.font = '500 14px -apple-system, system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.75)';
      g.fillText(al.artist.toUpperCase().slice(0, 28), 18, 32);
    }
    canv.set(id, c); return c;
  }
  function drawArtist(id) {
    const c = document.createElement('canvas'); c.width = c.height = 300;
    const g = c.getContext('2d'); const r = mulberry32(hash(id));
    const hue = Math.floor(r() * 360);
    const rg = g.createRadialGradient(110, 90, 20, 150, 150, 230);
    rg.addColorStop(0, `hsl(${hue} 70% 62%)`); rg.addColorStop(1, `hsl(${(hue + 60) % 360} 55% 20%)`);
    g.fillStyle = rg; g.fillRect(0, 0, 300, 300);
    const ar = DEMO.byId.get(id);
    g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '700 105px -apple-system, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(initials(ar ? ar.name : '?'), 150, 158);
    return c;
  }
  function drawPlaylist(id) {
    const c = document.createElement('canvas'); c.width = c.height = 300;
    const g = c.getContext('2d');
    const pl = DEMO.playlists.find((p) => p.id === id);
    const albs = [];
    for (const sid of (pl ? pl.entry : [])) { const s = DEMO.byId.get(sid); if (s && !albs.includes(s.albumId)) albs.push(s.albumId); if (albs.length === 4) break; }
    while (albs.length < 4) albs.push(albs[0] || 'al-1');
    albs.forEach((aid, i) => g.drawImage(drawAlbum(aid), (i % 2) * 150, Math.floor(i / 2) * 150, 150, 150));
    return c;
  }
  return {
    url(id) {
      if (!id) return '';
      if (cache.has(id)) return cache.get(id);
      let c;
      if (id.startsWith('ar-')) c = drawArtist(id);
      else if (id.startsWith('pl-')) c = drawPlaylist(id);
      else c = drawAlbum(id);
      const u = c.toDataURL('image/jpeg', 0.85);
      cache.set(id, u); return u;
    },
  };
})();

class DemoApi {
  constructor() { this.demo = true; this.user = 'demo'; this.server = 'Demo library'; }
  async get(ep, p = {}) {
    await sleep(90 + Math.random() * 160);
    const fn = this['_' + ep];
    if (!fn) throw new ApiError('That isn’t available in the demo.');
    return Object.assign({ status: 'ok' }, fn.call(this, p) || {});
  }
  cover(id) { return DemoArt.url(id); }
  stream(id) { return 'demo:' + id; }
  scrobble(id, submission) { return this.get('scrobble', { id, submission: submission ? 'true' : 'false' }); }
  _song(id) { return DEMO.byId.get(id); }
  _ping() { return {}; }
  _getScanStatus() { return { scanStatus: { scanning: false, count: DEMO.songs.length } }; }
  _getPlaylists() {
    return { playlists: { playlist: DEMO.playlists.map((p) => ({ id: p.id, name: p.name, owner: p.owner, comment: p.comment, coverArt: p.coverArt, created: p.created, changed: p.changed, songCount: p.entry.length, duration: p.entry.reduce((t, id) => t + this._song(id).duration, 0) })) } };
  }
  _getPlaylist({ id }) {
    const p = DEMO.playlists.find((x) => x.id === id);
    if (!p) throw new ApiError('Playlist not found', 70);
    const base = this._getPlaylists().playlists.playlist.find((x) => x.id === id);
    return { playlist: Object.assign({}, base, { entry: p.entry.map((sid) => this._song(sid)) }) };
  }
  _createPlaylist({ name, songId }) {
    const p = { id: `pl-${Date.now()}`, name: name || 'New Playlist', entry: arr(songId), owner: 'demo', comment: '', created: new Date().toISOString(), changed: new Date().toISOString() };
    p.coverArt = p.id;
    DEMO.playlists.unshift(p);
    return this._getPlaylist({ id: p.id });
  }
  _updatePlaylist({ playlistId, songIdToAdd, songIndexToRemove, name }) {
    const p = DEMO.playlists.find((x) => x.id === playlistId);
    if (!p) throw new ApiError('Playlist not found', 70);
    if (name) p.name = name;
    arr(songIndexToRemove).map(Number).sort((a, b) => b - a).forEach((i) => p.entry.splice(i, 1));
    arr(songIdToAdd).forEach((id) => p.entry.push(id));
    p.changed = new Date().toISOString();
    return {};
  }
  _deletePlaylist({ id }) { const i = DEMO.playlists.findIndex((x) => x.id === id); if (i >= 0) DEMO.playlists.splice(i, 1); return {}; }
  _getArtists() {
    const groups = new Map();
    keyed(DEMO.artists.slice(), 'name').sort(cmpKeyed).forEach((a) => { if (!groups.has(a._L)) groups.set(a._L, []); groups.get(a._L).push(a); });
    return { artists: { ignoredArticles: 'The', index: [...groups].map(([name, artist]) => ({ name, artist })) } };
  }
  _getArtist({ id }) {
    const a = DEMO.byId.get(id);
    if (!a) throw new ApiError('Artist not found', 70);
    return { artist: Object.assign({}, a, { album: DEMO.albums.filter((x) => x.artistId === id) }) };
  }
  _getArtistInfo2() { return { artistInfo2: {} }; }
  _getAlbumList2({ type = 'alphabeticalByName', size = 10, offset = 0 }) {
    let list = DEMO.albums.slice();
    if (type === 'newest') list.sort((a, b) => b.created.localeCompare(a.created));
    else if (type === 'alphabeticalByArtist') list.sort((a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.name, b.name));
    else if (type === 'byYear') list.sort((a, b) => a.year - b.year);
    else if (type === 'starred') list = list.filter((a) => a.starred);
    else if (type === 'recent' || type === 'frequent') {
      const stat = (a) => {
        const ss = DEMO.songs.filter((s) => s.albumId === a.id && s.playCount);
        return type === 'recent' ? Math.max(0, ...ss.map((s) => Date.parse(s.played) || 0)) : ss.reduce((t, s) => t + s.playCount, 0);
      };
      list = list.map((a) => [a, stat(a)]).filter((x) => x[1] > 0).sort((x, y) => y[1] - x[1]).map((x) => x[0]);
    } else if (type === 'random') list = shuffled(list);
    else list.sort((a, b) => collator.compare(sortKey(a.name), sortKey(b.name)));
    return { albumList2: { album: list.slice(+offset, +offset + +size) } };
  }
  _getAlbum({ id }) {
    const a = DEMO.byId.get(id);
    if (!a) throw new ApiError('Album not found', 70);
    return { album: Object.assign({}, a, { song: DEMO.songs.filter((s) => s.albumId === id) }) };
  }
  _search3({ query = '', artistCount = 20, albumCount = 20, songCount = 20, songOffset = 0, artistOffset = 0, albumOffset = 0 }) {
    const q = String(query).replace(/^"|"$/g, '').toLowerCase().trim();
    const m = (s) => !q || String(s).toLowerCase().includes(q);
    return {
      searchResult3: {
        artist: DEMO.artists.filter((a) => m(a.name)).slice(+artistOffset, +artistOffset + +artistCount),
        album: DEMO.albums.filter((a) => m(a.name) || m(a.artist)).slice(+albumOffset, +albumOffset + +albumCount),
        song: DEMO.songs.filter((s) => m(s.title) || m(s.artist) || m(s.album)).slice(+songOffset, +songOffset + +songCount),
      },
    };
  }
  _getStarred2() {
    return { starred2: { artist: DEMO.artists.filter((a) => a.starred), album: DEMO.albums.filter((a) => a.starred), song: DEMO.songs.filter((s) => s.starred) } };
  }
  _getRandomSongs({ size = 10 }) { return { randomSongs: { song: shuffled(DEMO.songs).slice(0, +size) } }; }
  _getInternetRadioStations() { return { internetRadioStations: { internetRadioStation: DEMO.stations } }; }
  _star({ id }) { arr(id).forEach((x) => { const o = DEMO.byId.get(x); if (o) o.starred = new Date().toISOString(); }); return {}; }
  _unstar({ id }) { arr(id).forEach((x) => { const o = DEMO.byId.get(x); if (o) delete o.starred; }); return {}; }
  _scrobble({ id, submission }) {
    if (submission === 'true') {
      const s = DEMO.byId.get(id);
      if (s && s.type === 'music') { s.playCount = (s.playCount || 0) + 1; s.played = new Date().toISOString(); }
    }
    return {};
  }
  _getSong({ id }) {
    const s = DEMO.byId.get(id);
    if (!s || s.type !== 'music') throw new ApiError('Song not found', 70);
    return { song: s };
  }
  _getLyricsBySongId({ id }) {
    const s = DEMO.byId.get(id);
    if (!s || s.type !== 'music') throw new ApiError('Song not found', 70);
    const ly = demoLyrics(s);
    return { lyricsList: ly ? { structuredLyrics: [ly] } : {} };
  }
}

/* Made-up lyrics for the demo songs, in the shape OpenSubsonic servers send (start in milliseconds).
   About one song in nine has none and one in nine has lyrics without timings, so every look can be tried. */
function demoLyrics(s) {
  let h = 2166136261;
  for (let i = 0; i < s.id.length; i++) { h ^= s.id.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  const kind = h % 9;
  if (kind === 0) return null;
  const r = mulberry32(h);
  const jp = /[぀-ヿ一-鿿]/.test(s.artist + s.title);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const name = s.title.replace(/[『』]|\s*\(Remix\)|\s+Acoustic$/g, '').trim();
  const verseEn = ['Streetlights hum the way they used to', 'I left the porch light on for you', 'We counted cars on the overpass',
    'Your jacket still smells like the rain', 'The radio found a song we knew', 'Every window holds a little sky',
    'We wrote our names in the morning frost', 'I kept the ticket from the last train home', 'The kettle sings and the city wakes',
    'Somebody laughing two floors down', 'I traced the map with a borrowed pen', 'Paper boats on a flooded street',
    'The neighbours dance behind the blinds', 'We ran the long way round the park'];
  const chorusEn = [`${name}, ${name}`, `Take me back to ${name.toLowerCase()}`, 'Hold on, don’t let it fade', 'Sing it slow, sing it low',
    'We were golden for a while', 'Turn it up and let it play'];
  const verseJp = ['夜の街に灯りがともる', '君の声を探してた', '遠くで電車が鳴っている', '小さな窓に空がある', '帰り道に風が吹く', '朝が来るまで話そう'];
  const chorusJp = [name, 'このまま歌っていよう', '忘れないでこの道を', 'もう一度だけ笑って'];
  const verse = jp ? verseJp : verseEn, chorus = jp ? chorusJp : chorusEn;
  const chorusLines = [chorus[0], pick(chorus.slice(1)), pick(chorus.slice(1)), chorus[0]];
  const parts = [
    [pick(verse), pick(verse), pick(verse), pick(verse)], chorusLines, ['', pick(verse), pick(verse), pick(verse), pick(verse)], chorusLines,
    ['', jp ? 'もしも夜が名前を忘れても' : 'And if the night forgets our names', jp ? '歌えばきっと道がわかる' : 'We’ll hum the tune and find the way'], chorusLines,
  ];
  const line = [];
  let t = 7 + r() * 8;
  parts.forEach((part) => part.forEach((text) => {
    line.push({ start: Math.round(t * 1000), value: text });
    t += text ? 3.4 + r() * 2.2 : 9 + r() * 4;
  }));
  if (kind === 1 || t > s.duration - 4) return { lang: 'xxx', synced: false, line: line.map((l) => ({ value: l.value })) };
  line.push({ start: Math.round(t * 1000), value: '' });
  return { lang: 'xxx', synced: true, line };
}

/* A silent stand-in for <audio> used by the demo library */
class FakeAudio extends EventTarget {
  constructor() {
    super();
    this._src = ''; this._t = 0; this._dur = NaN; this.paused = true; this._timer = 0; this._last = 0;
    this.readyState = 0; this.error = null; this.volume = 1; this.preload = 'auto';
  }
  get src() { return this._src; }
  set src(v) {
    this._stop(); this.paused = true; this._src = v || ''; this._t = 0; this.readyState = 0;
    const id = this._src.replace(/^demo:/, '');
    const s = DEMO.byId.get(id);
    this._dur = /^radio-/.test(id) ? Infinity : s ? s.duration : 200;
    if (this._src) setTimeout(() => { this.readyState = 4; this._emit('loadedmetadata'); this._emit('durationchange'); this._emit('canplay'); }, 50);
  }
  get currentTime() { return this._t; }
  set currentTime(v) { this._t = isFinite(this._dur) ? clamp(+v || 0, 0, this._dur) : 0; this._emit('timeupdate'); this._emit('seeked'); }
  get duration() { return this._dur; }
  get buffered() { return { length: 0 }; }
  play() {
    if (!this._src) return Promise.reject(new Error('No source'));
    if (!this.paused) return Promise.resolve();
    this.paused = false; this._last = performance.now();
    this._emit('play'); this._emit('playing');
    clearInterval(this._timer); this._timer = setInterval(() => this._tick(), 250);
    return Promise.resolve();
  }
  pause() { if (this.paused) return; this.paused = true; this._stop(); this._emit('pause'); }
  load() {}
  removeAttribute(n) { if (n === 'src') this.src = ''; }
  _stop() { clearInterval(this._timer); this._timer = 0; }
  _tick() {
    const now = performance.now(); this._t += (now - this._last) / 1000; this._last = now;
    if (isFinite(this._dur) && this._t >= this._dur) { this._t = this._dur; this.paused = true; this._stop(); this._emit('timeupdate'); this._emit('pause'); this._emit('ended'); return; }
    this._emit('timeupdate');
  }
  _emit(type) { this.dispatchEvent(new Event(type)); }
}

/* ---------- Encore's iPhone app ----------
   Inside the iPhone app, the app plays the music itself, so songs keep going and move on while the phone is
   locked, and the lock screen buttons always work. This page still decides what plays next: it tells the app
   the coming songs ahead of time, and catches up with whatever the app did while the page was asleep.
   The app puts window.EncoreNative on the page before anything else runs. */
const Native = (() => {
  const n = window.EncoreNative;
  return n && typeof n.post === 'function' && typeof n.listen === 'function' ? n : null;
})();
/* how many coming songs the app is told about (it plays on through them while the page is asleep:
   300 songs is a day or so of music) */
const NATIVE_AHEAD = 300;

/* Stands in for <audio> and passes everything on to the app.
   Messages from the app with a number (seq) are kept by the app until this page confirms them (ack),
   so nothing is lost while the page sleeps. req numbers the songs this page asked the app to load;
   the app stamps its messages with the last one it had seen, so news about an older request is ignored. */
class NativeAudio extends EventTarget {
  constructor(bridge) {
    super();
    this.native = true; this.bridge = bridge; this.connected = false;
    this._src = ''; this._key = ''; this._t = 0; this._at = 0; this._d = NaN; this._timer = 0;
    this.paused = true; this.waiting = false; this.readyState = 0; this.error = null;
    this.muted = false; this.volume = 1; this.preload = 'auto';
    this.req = 0;          /* the last load request sent */
    this.seq = 0;          /* the last numbered message handled */
    this.catchup = false;  /* handling the batch the app sends when this page starts */
    this.expect = '';      /* a song the app already moved on to by itself: starting it here just follows along */
    this.routes = false;   /* AirPlay speakers or TVs nearby */
  }
  post(m) { try { this.bridge.post(m); } catch (e) { /* the app isn't listening */ } }
  get src() { return this._src; }
  set src(v) { console.warn('Encore: the iPhone app plays songs through track(), not src', v); }
  getAttribute(n) { return n === 'src' && this._src ? this._src : null; }
  removeAttribute(n) {
    if (n !== 'src') return;
    const had = this._key, was = this.paused;
    this._src = ''; this._key = ''; this._t = 0; this._at = 0; this._d = NaN; this.readyState = 0; this.expect = '';
    this.paused = true; this.waiting = false;
    if (had) this.post({ type: 'stop' });
    this._ticker();
    if (!was) this._emit('pause');
  }
  load() {}
  get duration() { return this._d; }
  get buffered() { return { length: 0 }; }
  /* the app reports its time about once a second; in between, the clock runs on here */
  get currentTime() {
    if (this.paused || this.waiting || !this._at) return this._t;
    const t = this._t + (performance.now() - this._at) / 1000;
    return this._d > 0 ? Math.min(t, this._d) : t;
  }
  set currentTime(v) {
    this._t = Math.max(0, +v || 0); this._at = performance.now();
    if (this._key) this.post({ type: 'seek', t: this._t });
    this._emit('timeupdate'); this._emit('seeked');
  }
  play() {
    if (!this._src) return Promise.reject(new Error('No song'));
    this.post({ type: 'play' });
    if (this.paused) { this._t = this.currentTime; this._at = performance.now(); this.paused = false; this._ticker(); this._emit('play'); }
    return Promise.resolve();
  }
  pause() {
    if (this._key) this.post({ type: 'pause' });
    if (this.paused) return;
    this._t = this.currentTime; this._at = performance.now(); this.paused = true; this.waiting = false;
    this._ticker();
    this._emit('pause');
  }
  webkitShowPlaybackTargetPicker() { this.post({ type: 'airplay' }); }
  /* ask the app for everything this page hasn't seen (after signing in) */
  pull() { if (this.connected) this.post({ type: 'pull' }); }

  /* start a song. -> true when the app is already playing it (it moved on by itself), so nothing is sent */
  track(item, { autoplay = true, startAt = 0, restore = false } = {}) {
    const follow = !!item.key && item.key === this.expect;
    this.expect = '';
    this._key = item.key; this._src = item.url || item.key;
    this._d = item.duration > 0 ? item.duration : NaN;
    this.error = null; this.waiting = false; this.readyState = 1;
    this._t = follow ? 0 : Math.max(0, +startAt || 0); this._at = performance.now();
    if (follow) { this._ticker(); return true; }
    this.req++;
    this.post({ type: 'load', req: this.req, item, startAt: this._t, autoplay: !!autoplay, restore: !!restore });
    const was = this.paused;
    this.paused = !autoplay;
    this._ticker();
    if (was !== this.paused) this._emit(autoplay ? 'play' : 'pause');
    return false;
  }

  /* start listening to the app; it answers with what happened while this page wasn't running */
  connect() {
    if (this.connected) return;
    this.connected = true;
    this.bridge.listen((batch) => this._batch(Array.isArray(batch) ? batch : [batch]));
    this.post({ type: 'hello', version: APP_VERSION });
    const wake = () => { if (!document.hidden) this.post({ type: 'pull' }); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', (e) => { if (e.persisted) wake(); });
  }
  _batch(list) {
    let ack = 0;
    this.catchup = false;
    /* numbered news is only taken (and confirmed) while signed in; the app keeps it until then */
    const open = !this.accepting || this.accepting();
    let snapshot = false;
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      if (m.seq) { if (!open || m.seq <= this.seq) continue; this.seq = ack = m.seq; }
      if (m.type === 'welcome') this.catchup = true;
      if (m.type === 'snapshot') snapshot = true;
      try { this._msg(m); } catch (e) { console.error(e); }
    }
    try { this.dispatchEvent(new CustomEvent('native', { detail: { type: 'batchEnd', snapshot } })); } catch (e) { console.error(e); }
    this.catchup = false;
    if (ack) this.post({ type: 'ack', seq: ack });
  }
  _msg(m) {
    const mine = m.key === this._key && m.req === this.req && !!this._key;
    switch (m.type) {
      case 'time': if (mine) this._time(m); break;
      case 'state': if (mine) this._state(!!m.playing, !!m.waiting); break;
      case 'loaded':
        if (!mine) break;
        this.readyState = 4;
        if (m.d > 0 && !(this._d > 0)) this._d = m.d;
        this._emit('loadedmetadata'); this._emit('durationchange');
        break;
      case 'route': {
        this.routes = !!m.available;
        const e = new Event('webkitplaybacktargetavailabilitychanged');
        e.availability = this.routes ? 'available' : 'not-available';
        this.dispatchEvent(e);
        break;
      }
      case 'error':
        if (!this._key || m.key !== this._key) break;
        this.error = { code: 4, message: String(m.message || ''), reason: String(m.reason || '') };
        this._emit('error');
        break;
      default: this.dispatchEvent(new CustomEvent('native', { detail: m }));
    }
  }
  _time(m) {
    this._t = Math.max(0, +m.t || 0); this._at = performance.now();
    if (m.d > 0 && !(this._d > 0)) { this._d = m.d; this._emit('durationchange'); }
    this._emit('timeupdate');
  }
  _state(playing, waiting) {
    const was = this.paused, wasW = this.waiting;
    this._t = this.currentTime; this._at = performance.now();
    this.paused = !playing; this.waiting = playing && waiting;
    this._ticker();
    if (was && playing) this._emit('play');
    if (playing && !this.waiting && (was || wasW)) this._emit('playing');
    if (!was && !playing) this._emit('pause');
    if (this.waiting && !wasW) this._emit('waiting');
  }
  /* the app's whole state (sent when this page wakes up) */
  _sync(m) {
    this._t = Math.max(0, +m.t || 0); this._at = performance.now();
    if (m.d > 0 && !(this._d > 0)) this._d = m.d;
    if (m.ready) this.readyState = 4;
    this._state(!!m.playing, !!m.waiting);
    this._emit('timeupdate');
  }
  /* timeupdate four times a second while playing, like <audio> */
  _ticker() {
    const run = !this.paused && !this.waiting && !!this._key;
    if (run && !this._timer) this._timer = setInterval(() => this._emit('timeupdate'), 250);
    else if (!run && this._timer) { clearInterval(this._timer); this._timer = 0; }
  }
  _emit(type) { this.dispatchEvent(new Event(type)); }
}
const nativeAudio = Native ? new NativeAudio(Native) : null;

/* what the app needs to play a song: full addresses, since it doesn't know this page's address.
   Kept per song (300 are sent on every change), and made again when the song, quality or sign-in changes. */
const nativeItems = new WeakMap();
function nativeItem(s) {
  const sig = [Settings.get('quality'), s.title, s.artist, s.album, s.coverArt, s.duration, s.streamUrl].join('\u0001');
  const hit = s && typeof s === 'object' ? nativeItems.get(s) : null;
  if (hit && hit.api === api && hit.sig === sig) return hit.item;
  const item = makeNativeItem(s);
  if (s && typeof s === 'object') nativeItems.set(s, { api, sig, item });
  return item;
}
function makeNativeItem(s) {
  const abs = (u) => { try { return u ? new URL(u, location.href).href : ''; } catch (e) { return ''; } };
  if (s.isRadio) return { key: s.id, url: abs(s.streamUrl), fallback: '', title: s.title || '', artist: s.artist || '', album: '', art: '', duration: 0, isRadio: true, scrobble: '' };
  const q = Settings.get('quality');
  return {
    key: s.id, url: abs(api.stream(s.id, q)), fallback: !q || q === 'raw' ? abs(api.stream(s.id, '320')) : '',
    title: s.title || '', artist: s.artist || '', album: s.album || '',
    art: s.coverArt ? abs(api.cover(s.coverArt, 600)) : '',
    duration: s.duration > 0 ? +s.duration : 0, isRadio: false,
    /* passed back with the app's news, so the page can show a song the app played that it doesn't have in its lists */
    coverArt: s.coverArt || '', artistId: s.artistId || '', albumId: s.albumId || '',
    /* the app adds submission and time when it registers the play */
    scrobble: abs(api.url('scrobble', { id: s.id })),
  };
}

/* ---------- settings ---------- */
const Settings = {
  defaults: { theme: 'system', accent: '', quality: 'raw', shrink: true, raOpen: false, rpOpen: false, sorts: {},
    glow: false, glowColor: '', glowStrength: 5, glowSat: 10, recentColors: [], lyricsOnline: true },
  data: {},
  load() { this.data = Object.assign({}, this.defaults, store.get('settings', {})); },
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; store.set('settings', this.data); },
  sort(name, def) { return (this.data.sorts || {})[name] || def; },
  setSort(name, v) { this.data.sorts = Object.assign({}, this.data.sorts, { [name]: v }); store.set('settings', this.data); },
  apply() {
    const root = document.documentElement;
    const th = this.get('theme');
    if (th === 'light' || th === 'dark') { root.setAttribute('data-theme', th); root.dataset.encoreTheme = '1'; }
    else if (root.dataset.encoreTheme) { root.removeAttribute('data-theme'); delete root.dataset.encoreTheme; }
    this.applyAccent(this.get('accent'));
    this.applyGlow();
    NativeChrome.update();
  },
  /* hex = a custom colour, '' = the theme's own rose */
  applyAccent(hex) {
    const root = document.documentElement;
    if (hex && hexToRgb(hex)) { root.style.setProperty('--accent', hex); root.style.setProperty('--on-accent', inkFor(hex)); }
    else { root.style.removeProperty('--accent'); root.style.removeProperty('--on-accent'); }
  },
  applyGlow(over = {}) {
    const root = document.documentElement;
    const on = over.glow !== undefined ? over.glow : this.get('glow');
    const color = over.glowColor !== undefined ? over.glowColor : this.get('glowColor');
    const strength = over.glowStrength !== undefined ? over.glowStrength : this.get('glowStrength');
    const sat = over.glowSat !== undefined ? over.glowSat : this.get('glowSat');
    root.classList.toggle('glow-on', !!on);
    if (color && hexToRgb(color)) root.style.setProperty('--glow-c', color); else root.style.removeProperty('--glow-c');
    const s = clamp(+strength || 5, 1, 10), t = clamp(+sat || 10, 1, 10);
    root.style.setProperty('--glow-s', String(s));
    /* saturation sets how much white is in the bar's core (10 = none) and how dense the halo is;
       strength makes the halo wider and a little brighter so it doesn't fade as it spreads */
    root.style.setProperty('--glow-mix', GLOW_MIX[t - 1] + '%');
    root.style.setProperty('--glow-a1', Math.min(100, 72 + t * 3) + '%');
    root.style.setProperty('--glow-a2', Math.min(90, 30 + t * 4 + s * 2) + '%');
    root.style.setProperty('--glow-a3', Math.min(60, 8 + t * 2 + s * 3) + '%');
  },
  rememberColor(hex) {
    if (!hexToRgb(hex)) return;
    const list = [hex.toLowerCase()].concat((this.get('recentColors') || []).filter((c) => c.toLowerCase() !== hex.toLowerCase())).slice(0, 8);
    this.set('recentColors', list);
  },
};
/* share of the glow colour in the bar's core for saturation 1-10 (the rest is white) */
const GLOW_MIX = [40, 47, 53, 60, 67, 73, 80, 87, 93, 100];
const ACCENTS = [
  ['', 'Rose'], ['#ff375f', 'Pink'], ['#bf5af2', 'Purple'], ['#5e5ce6', 'Indigo'], ['#0a84ff', 'Blue'],
  ['#30b0c7', 'Teal'], ['#30d158', 'Green'], ['#ff9f0a', 'Orange'],
];
const QUALITIES = [
  ['raw', 'Original', 'Streams files as they are'],
  ['320', 'High', '320 kbps MP3'],
  ['192', 'Medium', '192 kbps MP3'],
  ['128', 'Low', '128 kbps MP3, saves data'],
];

/* newest play first; dates are compared as times because servers may send them with different offsets */
function byPlayed(a, b) { return (Date.parse(b.played) || 0) - (Date.parse(a.played) || 0); }

/* ---------- library data with light caching ---------- */
const Lib = {
  cache: new Map(),
  starred: new Map(),
  memo(key, ttl, fn) {
    const c = this.cache.get(key);
    if (c) { if (c.p) return c.p; if (Date.now() - c.t < ttl) return Promise.resolve(c.v); }
    const p = fn().then((v) => { this.cache.set(key, { t: Date.now(), v }); return v; }, (e) => { this.cache.delete(key); throw e; });
    this.cache.set(key, { p });
    return p;
  },
  invalidate(prefix) { for (const k of Array.from(this.cache.keys())) if (k.startsWith(prefix)) this.cache.delete(k); },
  clear() { this.cache.clear(); this.starred.clear(); PlaylistSongs.clear(); },
  isStarred(o) { return this.starred.has(o.id) ? this.starred.get(o.id) : !!o.starred; },

  playlists() {
    return this.memo('playlists', 120000, async () => {
      const r = await api.get('getPlaylists');
      return arr(r.playlists && r.playlists.playlist).map(nPlaylist);
    });
  },
  async playlist(id) {
    const r = await api.get('getPlaylist', { id });
    const p = nPlaylist(r.playlist || {});
    p.songs = arr(r.playlist && r.playlist.entry).map(nSong);
    return p;
  },
  artists() {
    return this.memo('artists', 600000, async () => {
      const r = await api.get('getArtists');
      return arr(r.artists && r.artists.index).map((g) => ({ name: g.name, artists: arr(g.artist).map(nArtist) }));
    });
  },
  async artist(id) {
    const r = await api.get('getArtist', { id });
    const a = nArtist(r.artist || {});
    a.albums = arr(r.artist && r.artist.album).map(nAlbum);
    return a;
  },
  async album(id) {
    const r = await api.get('getAlbum', { id });
    const a = nAlbum(r.album || {});
    a.songs = arr(r.album && r.album.song).map(nSong);
    return a;
  },
  recent(n) {
    return this.memo('recent:' + n, 120000, async () => {
      const r = await api.get('getAlbumList2', { type: 'newest', size: n });
      return arr(r.albumList2 && r.albumList2.album).map(nAlbum);
    });
  },
  /* all albums for a sort type; onPage(listSoFar, done) lets the view render as pages arrive */
  async albums(type, onPage) {
    const key = 'albums:' + type, c = this.cache.get(key);
    if (c && c.v && Date.now() - c.t < 600000) { onPage(c.v, true); return c.v; }
    const out = [], size = 500;
    for (let off = 0; off < 200000; off += size) {
      const params = { type, size, offset: off };
      if (type === 'byYear') { params.fromYear = 0; params.toYear = 3000; }
      const r = await api.get('getAlbumList2', params);
      const page = arr(r.albumList2 && r.albumList2.album).map(nAlbum);
      for (const a of page) out.push(a);
      const done = page.length < size;
      onPage(out, done);
      if (done) break;
    }
    this.cache.set(key, { t: Date.now(), v: out });
    return out;
  },
  /* every song in the library (Subsonic search3 with an empty query, paged).
     maxAge: how old a cached copy may be before it's fetched again */
  allSongs(onProgress, maxAge = 900000) {
    return this.memo('songs', maxAge, async () => {
      let total = 0;
      try { const s = await api.get('getScanStatus'); total = +(s.scanStatus && s.scanStatus.count) || 0; } catch (e) { /* optional */ }
      const size = 500, out = [], seen = new Set();
      let query = '';
      for (let off = 0; off < 1000000; off += size) {
        const r = await api.get('search3', { query, songCount: size, songOffset: off, artistCount: 0, albumCount: 0 });
        const page = arr(r.searchResult3 && r.searchResult3.song).map(nSong);
        if (off === 0 && !page.length && query === '') { query = '""'; off -= size; continue; }
        for (const s of page) if (!seen.has(s.id)) { seen.add(s.id); out.push(s); }
        if (onProgress) onProgress(out.length, total);
        if (page.length < size) break;
      }
      if (!out.length) {
        /* server can't list every song at once: gather them album by album */
        const albums = await this.albums('alphabeticalByName', () => {});
        let i = 0;
        const worker = async () => {
          while (i < albums.length) {
            const a = albums[i++];
            try { const full = await this.album(a.id); for (const s of full.songs) if (!seen.has(s.id)) { seen.add(s.id); out.push(s); } } catch (e) { /* skip */ }
            if (onProgress) onProgress(out.length, total);
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
      }
      return out;
    });
  },
  songsAge() { const c = this.cache.get('songs'); return c && c.v ? Date.now() - c.t : Infinity; },
  /* songs by most recent play (Navidrome keeps the last play date per song, from every app) */
  async recentlyPlayed(n, maxAge = 900000, onProgress) {
    const all = await this.allSongs(onProgress, maxAge);
    return all.filter((s) => s.played).sort(byPlayed).slice(0, n);
  },
  /* the newest few without reading the whole library: Navidrome dates an album's last play
     with every song played from it, so the n newest songs are always inside the n newest albums */
  async recentlyPlayedQuick(n) {
    const r = await api.get('getAlbumList2', { type: 'recent', size: n });
    const albums = arr(r.albumList2 && r.albumList2.album).map(nAlbum);
    const lists = await Promise.all(albums.map((a) => this.album(a.id).then((x) => x.songs, () => [])));
    const seen = new Set(), out = [];
    for (const s of lists.flat()) if (s.played && !seen.has(s.id)) { seen.add(s.id); out.push(s); }
    return out.sort(byPlayed).slice(0, n);
  },
  async getSong(id) {
    const r = await api.get('getSong', { id });
    return nSong(r.song || {});
  },
  /* Encore just registered a play with the server: mirror it in the cached copy right away */
  notePlayed(song) {
    const now = new Date().toISOString();
    const bump = (s) => { if (s && s.played !== now) { s.playCount = (s.playCount || 0) + 1; s.played = now; } };
    const c = this.cache.get('songs');
    const cached = c && c.v ? c.v.find((x) => x.id === song.id) : null;
    bump(cached);
    if (song !== cached) bump(song);
  },
  async search(q) {
    const r = await api.get('search3', { query: q, artistCount: 8, albumCount: 12, songCount: 40 });
    const x = r.searchResult3 || {};
    return { artists: arr(x.artist).map(nArtist), albums: arr(x.album).map(nAlbum), songs: arr(x.song).map(nSong) };
  },
  async starredSongs() {
    const r = await api.get('getStarred2');
    return arr(r.starred2 && r.starred2.song).map(nSong);
  },
  async randomSongs(n) {
    const r = await api.get('getRandomSongs', { size: n });
    return arr(r.randomSongs && r.randomSongs.song).map(nSong);
  },
  stations() {
    return this.memo('stations', 300000, async () => {
      const r = await api.get('getInternetRadioStations');
      return arr(r.internetRadioStations && r.internetRadioStations.internetRadioStation);
    });
  },
  async artistSongs(id) {
    const a = await this.artist(id);
    const albums = a.albums.slice().sort((x, y) => (x.year || 0) - (y.year || 0) || collator.compare(x.name, y.name));
    const lists = await Promise.all(albums.map((al) => this.album(al.id).then((f) => f.songs, () => [])));
    return { artist: a, songs: lists.flat() };
  },
  async toggleStar(item, kind) {
    const on = !this.isStarred(item);
    const key = kind === 'album' ? 'albumId' : kind === 'artist' ? 'artistId' : 'id';
    await api.get(on ? 'star' : 'unstar', { [key]: item.id });
    this.starred.set(item.id, on);
    return on;
  },
};

/* ---------- playback & queue ----------
   cur      the song playing now; from = 'ctx' | 'queue' | 'hist' | 'radio'
   ctx      the list playback started from: { title, songs, order (play order as indexes into songs), pos, removed }
   upNext   songs the user added with Play Next / Play Last ("Playing Next")          */
const SILENT_WAV = (() => {
  const n = 800, b = new Uint8Array(44 + n), dv = new DataView(b.buffer);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  w(36, 'data'); dv.setUint32(40, n, true); b.fill(128, 44);
  let s = ''; b.forEach((x) => { s += String.fromCharCode(x); });
  return 'data:audio/wav;base64,' + btoa(s);
})();

const Player = emitter({
  audio: null, cur: null, from: null, ctx: null, upNext: [], history: [],
  shuffle: false, repeat: 'off',
  scrobbled: false, nowSent: false, fallbackTried: false, pendingSeek: 0, errors: 0,
  lastSave: 0, lastPos: 0, ac: null, wantPlay: false, primed: false, priming: false,

  setAudio(el) {
    if (this.audio === el) return;
    if (this.audio) { try { this.audio.pause(); } catch (e) { /* ignore */ } }
    /* leaving the iPhone app's player (for the demo library): clear the lock screen too */
    if (this.audio && this.audio.native) { try { this.audio.removeAttribute('src'); } catch (e) { /* ignore */ } }
    if (this.ac) this.ac.abort();
    this.ac = new AbortController();
    this.primed = false; this.priming = false;
    const o = { signal: this.ac.signal };
    this.audio = el;
    el.addEventListener('play', () => { if (!this.priming) this.emit('state'); }, o);
    el.addEventListener('playing', () => { if (this.priming) return; this.errors = 0; this.emit('state'); this._onPlaying(); }, o);
    el.addEventListener('pause', () => { if (this.priming) return; this.emit('state'); this._msPos(); this.save(); }, o);
    el.addEventListener('ended', () => this._onEnded(), o);
    el.addEventListener('timeupdate', () => this._onTime(), o);
    el.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek) { const t = this.pendingSeek; this.pendingSeek = 0; try { el.currentTime = t; } catch (e) { /* ignore */ } }
      this.emit('time'); this._msPos();
    }, o);
    el.addEventListener('durationchange', () => this.emit('time'), o);
    el.addEventListener('error', () => this._onError(), o);
    el.addEventListener('waiting', () => this.emit('state'), o);
    /* in the iPhone app, the app itself answers the lock screen */
    if (!el.native) this._mediaSessionHandlers();
  },

  get playing() { return !!(this.audio && !this.audio.paused && !this.priming); },
  duration() {
    if (!this.cur) return 0;
    if (this.cur.isRadio) return Infinity;
    if (this.cur.duration > 0) return this.cur.duration;
    const d = this.audio.duration;
    return isFinite(d) && d > 0 ? d : 0;
  },
  time() {
    if (this.pendingSeek && this.audio.readyState < 1) return this.pendingSeek;
    return this.audio.currentTime || 0;
  },
  srcAttr() { const a = this.audio; return a.getAttribute ? a.getAttribute('src') : a.src; },

  /* iPhone only lets audio start from a tap. Buttons that fetch songs first "unlock" the player during the tap. */
  prime() {
    const a = this.audio;
    if (this.primed || !a || a instanceof FakeAudio || a.native || !a.paused) { this.primed = true; return; }
    this.primed = true;
    const had = this.srcAttr();
    if (!had) a.src = SILENT_WAV;
    this.priming = true;
    a.muted = true;
    let p;
    try { p = a.play(); } catch (e) { p = null; }
    const done = () => {
      const src = this.srcAttr();
      if (src === SILENT_WAV || (had && src === had && !this.wantPlay)) a.pause();
      a.muted = false;
      this.priming = false;
      this.emit('state');
    };
    if (p && p.then) p.then(done, () => { a.muted = false; this.priming = false; this.emit('state'); });
    else { a.muted = false; this.priming = false; }
  },

  /* ----- starting playback ----- */
  playList(songs, index = 0, title = '', opts = {}) {
    songs = (songs || []).filter(Boolean);
    if (!songs.length) return;
    const n = songs.length, pos = clamp(index, 0, n - 1);
    let order = Array.from({ length: n }, (_, i) => i), p = pos;
    this.shuffle = !!opts.shuffle;
    if (this.shuffle) { order = [pos].concat(shuffled(order.filter((i) => i !== pos))); p = 0; }
    if (this.cur) this._pushHistory();
    this.ctx = { title, songs, order, pos: p, removed: new Set() };
    this._start(songs[pos], 'ctx');
  },
  playShuffled(songs, title) {
    if (!songs || !songs.length) return;
    this.playList(songs, Math.floor(Math.random() * songs.length), title, { shuffle: true });
  },
  playRadio(st) {
    if (this.cur) this._pushHistory();
    this.ctx = null;
    this._start({ id: 'radio:' + st.id, title: st.name, artist: 'Internet Radio', album: '', isRadio: true, streamUrl: st.streamUrl, coverArt: '', duration: 0 }, 'radio');
  },
  playNext(song) {
    if (!song) return '';
    if (!this.cur) { this.playList([song], 0, song.title); return 'started'; }
    this.upNext.unshift(song); this.emit('queue'); this.save(); return 'queued';
  },
  playLast(song) {
    if (!song) return '';
    if (!this.cur) { this.playList([song], 0, song.title); return 'started'; }
    this.upNext.push(song); this.emit('queue'); this.save(); return 'queued';
  },

  /* restore: this is the song Encore was on when it was last closed. The iPhone app keeps playing
     its own song instead, if it has one, and this page catches up with it. */
  _start(song, from, autoplay = true, startAt = 0, restore = false) {
    if (!song) return;
    this.cur = song; this.from = from;
    this.scrobbled = false; this.nowSent = false; this.fallbackTried = false;
    if (this.audio.native) {
      this.pendingSeek = 0;
      const following = this.audio.track(nativeItem(song), { autoplay, startAt, restore });
      if (autoplay && !following) this.wantPlay = true;
    } else {
      this.pendingSeek = startAt || 0;
      this.audio.src = song.isRadio ? song.streamUrl : api.stream(song.id, Settings.get('quality'));
      if (autoplay) this._play();
    }
    this.emit('change'); this.emit('queue'); this.emit('time'); this.emit('state');
    this._ms(); this.save();
  },
  _play() {
    this.wantPlay = true;
    let p;
    try { p = this.audio.play(); } catch (e) { p = null; }
    if (p && p.catch) p.catch(() => this.emit('state'));
  },
  play() {
    if (!this.cur) return;
    if (!this.srcAttr()) { this._start(this.cur, this.from, true, this.pendingSeek); return; }
    this._play();
  },
  pause() { this.wantPlay = false; if (this.audio) this.audio.pause(); },
  toggle() { if (this.playing) this.pause(); else this.play(); },
  seek(t) {
    const d = this.duration();
    if (!this.cur || !isFinite(d)) return;
    t = clamp(t, 0, Math.max(0, d - 0.25));
    if (this.audio.readyState < 1) this.pendingSeek = t;
    else { try { this.audio.currentTime = t; } catch (e) { this.pendingSeek = t; } }
    this.emit('time'); this._msPos();
  },
  stop() {
    this.pause();
    this.cur = null; this.from = null; this.ctx = null; this.upNext = []; this.history = [];
    try { this.audio.removeAttribute('src'); if (this.audio.load) this.audio.load(); } catch (e) { /* ignore */ }
    this.emit('change'); this.emit('queue'); this.emit('state'); this._ms();
  },

  /* ----- moving through the queue ----- */
  _pushHistory() {
    if (!this.cur || this.cur.isRadio) return;
    const c = this.ctx;
    const idx = this.from === 'ctx' && c && c.pos >= 0 ? c.order[c.pos] : -1;
    this.history.push({ song: this.cur, from: this.from, ctx: c, idx });
    if (this.history.length > 200) this.history.shift();
  },
  /* autoplay false: move on but don't start it (when the iPhone app ran out of songs while the phone was locked) */
  next(user = true, autoplay = true) {
    if (!this.cur) return false;
    if (this.upNext.length) { this._pushHistory(); this._start(this.upNext.shift(), 'queue', autoplay); return true; }
    const c = this.ctx;
    if (c && c.pos + 1 < c.order.length) { this._pushHistory(); c.pos++; this._start(c.songs[c.order[c.pos]], 'ctx', autoplay); return true; }
    if (c && c.order.length && this.repeat === 'all') {
      this._pushHistory();
      if (this.shuffle) { const f = this._loop(0); c.future.shift(); c.order = this._loopStart(f, this.cur); }
      c.pos = 0; this._start(c.songs[c.order[0]], 'ctx', autoplay); return true;
    }
    if (user) { this.pause(); this.seek(0); }
    return false;
  },
  /* A repeated, shuffled list is shuffled again each time round. The new orders are drawn ahead of time and
     kept (c.future) until they're used, so the coming songs the iPhone app is told about are the ones that
     really play. Changing which songs are in the list throws them away. */
  _loop(k) {
    const c = this.ctx;
    if (!c.future) c.future = [];
    while (c.future.length <= k) {
      const n = c.order.length;
      c.future.push({ order: shuffled(c.order), j: n > 1 ? 1 + Math.floor(Math.random() * (n - 1)) : 0 });
    }
    return c.future[k];
  },
  /* don't start the new loop with the song that just finished */
  _loopStart(f, prev) {
    const c = this.ctx, o = f.order.slice();
    if (o.length > 1 && c.songs[o[0]] === prev) [o[0], o[f.j]] = [o[f.j], o[0]];
    return o;
  },
  /* the next n songs, in the order next() would play them */
  _lookahead(n) {
    const out = [];
    for (const s of this.upNext) { if (out.length >= n) return out; out.push(s); }
    const c = this.ctx;
    if (!c || !c.order.length) return out;
    for (let p = Math.max(0, c.pos + 1); p < c.order.length && out.length < n; p++) out.push(c.songs[c.order[p]]);
    if (this.repeat !== 'all') return out;
    for (let k = 0; out.length < n && k < n; k++) {
      const prev = out.length ? out[out.length - 1] : this.cur;
      const order = this.shuffle ? this._loopStart(this._loop(k), prev) : c.order;
      for (const i of order) { if (out.length >= n) break; out.push(c.songs[i]); }
    }
    return out;
  },
  /* force: the iPhone app already went back (it checks the 3 seconds itself) */
  prev(force = false) {
    if (!this.cur) return;
    if ((!force && this.time() > 3) || this.cur.isRadio) { this.seek(0); return; }
    const h = this.history.pop();
    if (!h) { this.seek(0); return; }
    const c = this.ctx;
    const curAt = this.from === 'ctx' && c ? c.pos : -1;
    /* put the current song back where it came from, so Next returns to it */
    if (this.from === 'queue' || this.from === 'hist') this.upNext.unshift(this.cur);
    else if (curAt >= 0) c.pos = Math.max(-1, c.pos - 1);
    let at = h.from === 'ctx' && c && h.ctx === c && h.idx >= 0 ? c.order.indexOf(h.idx) : -1;
    if (at >= 0 && curAt >= 0 && at > curAt) {
      /* going back past the start of a repeated, reshuffled list: bring that song back
         in front of the current one, so Next returns here instead of skipping ahead */
      c.order.splice(at, 1);
      c.order.splice(curAt, 0, h.idx);
      at = curAt;
    }
    if (at >= 0) { c.pos = at; this._start(h.song, 'ctx'); }
    else this._start(h.song, 'hist');
  },
  _onEnded() {
    if (this.priming) return;
    /* each time round counts as a play */
    if (this.cur && this.repeat === 'one' && !this.cur.isRadio) { this.scrobbled = false; this.nowSent = false; this.seek(0); this._play(); return; }
    if (!this.next(false)) { this.pause(); this.seek(0); this.emit('state'); }
  },
  _onError() {
    const a = this.audio, src = this.srcAttr();
    if (!this.cur || !src || src === SILENT_WAV) return;
    if (this.cur.isRadio) { toast('Couldn’t play this station', I.radio, 'var(--red)'); return; }
    /* the iPhone app has already tried the MP3 version, and moves on to the next song by itself */
    if (a.native) {
      if (a.error && a.error.reason === 'network') toast('Couldn’t reach the music server', I.xmark, 'var(--red)');
      else toast(`Couldn’t play “${this.cur.title}”`, I.xmark, 'var(--red)');
      return;
    }
    const q = Settings.get('quality');
    if (!this.fallbackTried && (!q || q === 'raw')) {
      /* the browser couldn't decode the original file (e.g. OGG on iPhone): ask the server for MP3 instead */
      this.fallbackTried = true;
      const t = this.time();
      a.src = api.stream(this.cur.id, '320');
      this.pendingSeek = t; this._play();
      return;
    }
    this.errors++;
    const failed = this.cur;
    toast(`Couldn’t play “${failed.title}”`, I.xmark, 'var(--red)');
    if (this.errors < 4) setTimeout(() => { if (this.cur === failed) this.next(false); }, 1200);
  },
  /* plays are registered with the server here, or by the iPhone app (it keeps doing it while the phone is locked) */
  _onPlaying() {
    if (this.audio.muted) return;
    if (!this.audio.native && !this.nowSent && this.cur && !this.cur.isRadio) { this.nowSent = true; api.scrobble(this.cur.id, false).catch(() => {}); }
    this._msPos();
  },
  _onTime() {
    if (this.priming) return;
    const t = this.time(), d = this.duration();
    if (!this.audio.native && !this.scrobbled && this.cur && !this.cur.isRadio && !this.audio.muted && d > 0 && t >= Math.min(d * 0.5, 240)) {
      this.scrobbled = true;
      const song = this.cur;
      api.scrobble(song.id, true).then(() => { Lib.notePlayed(song); this.emit('played', song); }, () => {});
    }
    this.emit('time');
    const now = Date.now();
    if (now - this.lastSave > 5000) this.save();
    if (now - this.lastPos > 5000) this._msPos();
  },

  /* ----- shuffle / repeat ----- */
  setShuffle(on) {
    this.shuffle = !!on;
    const c = this.ctx;
    if (c) c.future = null;
    if (c && c.order.length) {
      if (on) c.order = c.order.slice(0, c.pos + 1).concat(shuffled(c.order.slice(c.pos + 1)));
      else {
        const curIdx = c.pos >= 0 ? c.order[c.pos] : -1;
        c.order = c.songs.map((_, i) => i).filter((i) => i === curIdx || !(c.removed && c.removed.has(i)));
        c.pos = curIdx >= 0 ? c.order.indexOf(curIdx) : -1;
      }
    }
    this.emit('queue'); this.save();
  },
  cycleRepeat() {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    this.emit('queue'); this.save();
  },

  /* ----- queue editing. k = position in "Continue Playing"; the song is passed along so a list
     that changed underneath (a track ended mid-gesture) can't remove or move the wrong one ----- */
  upcoming(limit = 100) {
    const c = this.ctx;
    if (!c) return [];
    return c.order.slice(c.pos + 1, c.pos + 1 + limit).map((i, k) => ({ song: c.songs[i], k }));
  },
  upcomingCount() { const c = this.ctx; return c ? Math.max(0, c.order.length - c.pos - 1) : 0; },
  ctxSong(k) { const c = this.ctx; return c ? c.songs[c.order[c.pos + 1 + k]] : null; },
  _ctxAt(k, song) {
    const c = this.ctx;
    if (!c) return -1;
    let p = c.pos + 1 + k;
    if (song && c.songs[c.order[p]] !== song) { p = c.order.findIndex((i, q) => q > c.pos && c.songs[i] === song); }
    return p > c.pos && p < c.order.length ? p : -1;
  },
  jumpQueue(j, song) {
    if (song && this.upNext[j] !== song) j = this.upNext.indexOf(song);
    const s = this.upNext[j];
    if (!s) return;
    this._pushHistory(); this.upNext.splice(0, j + 1); this._start(s, 'queue');
  },
  jumpCtx(k, song) {
    const p = this._ctxAt(k, song), c = this.ctx;
    if (p < 0) return;
    this._pushHistory(); c.pos = p; this._start(c.songs[c.order[p]], 'ctx');
  },
  removeQueue(j, song) {
    if (song && this.upNext[j] !== song) j = this.upNext.indexOf(song);
    if (j < 0 || j >= this.upNext.length) return;
    this.upNext.splice(j, 1); this.emit('queue'); this.save();
  },
  removeCtx(k, song) {
    const p = this._ctxAt(k, song), c = this.ctx;
    if (p < 0) return;
    const [i] = c.order.splice(p, 1);
    if (c.removed) c.removed.add(i);
    c.future = null;
    this.emit('queue'); this.save();
  },
  moveQueue(a, b, song) {
    if (a < 0 || a >= this.upNext.length || (song && this.upNext[a] !== song)) { this.emit('queue'); return false; }
    const [x] = this.upNext.splice(a, 1);
    this.upNext.splice(clamp(b, 0, this.upNext.length), 0, x);
    this.emit('queue'); this.save(); return true;
  },
  moveCtx(a, b, song) {
    const c = this.ctx, p = c ? c.pos + 1 + a : -1;
    if (!c || p >= c.order.length || (song && c.songs[c.order[p]] !== song)) { this.emit('queue'); return false; }
    const [x] = c.order.splice(p, 1);
    c.order.splice(clamp(c.pos + 1 + b, c.pos + 1, c.order.length), 0, x);
    this.emit('queue'); this.save(); return true;
  },
  clearQueue() { this.upNext = []; this.emit('queue'); this.save(); },

  /* ----- lock screen / Control Center ----- */
  _mediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* unsupported action */ } };
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next(true));
    set('seekto', (d) => { if (d && d.seekTime != null) this.seek(d.seekTime); });
    set('stop', () => this.pause());
  },
  _ms() {
    if (!('mediaSession' in navigator) || (this.audio && this.audio.native)) return;
    const s = this.cur;
    try {
      if (!s) { navigator.mediaSession.metadata = null; }
      else {
        const art = s.coverArt ? new URL(api.cover(s.coverArt, 512), location.href).href : '';
        navigator.mediaSession.metadata = new MediaMetadata({
          title: s.title, artist: s.artist || '', album: s.album || '',
          artwork: art ? [{ src: art, sizes: '512x512' }] : [],
        });
      }
    } catch (e) { /* ignore */ }
    this._msPos();
  },
  _msPos() {
    this.lastPos = Date.now();
    if (!('mediaSession' in navigator) || (this.audio && this.audio.native)) return;
    const ms = navigator.mediaSession;
    try { ms.playbackState = this.cur ? (this.playing ? 'playing' : 'paused') : 'none'; } catch (e) { /* ignore */ }
    if (!ms.setPositionState) return;
    const d = this.duration();
    try {
      if (this.cur && isFinite(d) && d > 0) ms.setPositionState({ duration: d, playbackRate: 1, position: clamp(this.time(), 0, d) });
      else ms.setPositionState();
    } catch (e) { /* ignore */ }
  },

  /* ----- remember the queue between launches ----- */
  save() {
    this.lastSave = Date.now();
    if (!api || api.demo) return;
    if (!this.cur) { store.del('player'); return; }
    const c = this.ctx;
    let ctx = null, slice = [];
    if (c) {
      /* keep a window around the current song: 50 back, 450 ahead, in play order */
      const lo = Math.max(0, c.pos - 50), hi = Math.min(c.order.length, c.pos + 451);
      slice = c.order.slice(lo, hi);
      ctx = { title: c.title, songs: slice.map((i) => c.songs[i]), pos: c.pos - lo };
    }
    const history = this.history.slice(-30).map((h) => {
      const at = h.from === 'ctx' && h.ctx === c && h.idx >= 0 ? slice.indexOf(h.idx) : -1;
      return { song: h.song, at };
    });
    store.set('player', {
      v: 2, cur: this.cur, from: this.from, ctx, history,
      upNext: this.upNext.slice(0, 300), t: Math.floor(this.time()), shuffle: this.shuffle, repeat: this.repeat,
    });
  },
  restore() {
    if (!api || api.demo) return;
    const s = store.get('player');
    if (!s || !s.cur || !s.cur.id) return;
    const ok = (x) => x && typeof x === 'object' && x.id;
    this.shuffle = !!s.shuffle; this.repeat = s.repeat || 'off';
    this.upNext = Array.isArray(s.upNext) ? s.upNext.filter(ok) : [];
    this.ctx = null;
    if (s.v === 2 && s.ctx && Array.isArray(s.ctx.songs)) {
      const songs = s.ctx.songs;
      if (songs.every(ok)) this.ctx = { title: s.ctx.title || '', songs, order: songs.map((_, i) => i), pos: clamp(+s.ctx.pos || 0, -1, songs.length - 1), removed: new Set() };
    } else if (s.from !== 'radio' && Array.isArray(s.rest)) {
      const songs = (s.from === 'ctx' ? [s.cur] : []).concat(s.rest).filter(ok);
      this.ctx = { title: s.title || '', songs, order: songs.map((_, i) => i), pos: s.from === 'ctx' ? 0 : -1, removed: new Set() };
    }
    this.history = Array.isArray(s.history)
      ? s.history.filter((h) => h && ok(h.song)).map((h) => ({ song: h.song, from: h.at >= 0 && this.ctx ? 'ctx' : 'hist', ctx: this.ctx, idx: h.at >= 0 ? h.at : -1 }))
      : [];
    const from = s.from === 'ctx' && this.ctx ? 'ctx' : s.from === 'radio' ? 'radio' : 'queue';
    this._start(s.cur, from, false, s.t || 0, true);
  },
});

/* ---------- exact listening time, measured by Encore on this device ----------
   Adds up the seconds the music actually plays (pauses, skips and seeks don't count).
   Kept separate from playback: it only listens to the player's events. */
const Listen = {
  data: null, last: null, dirty: false, savedAt: 0, memoryOnly: false,
  fresh() { return { v: 1, since: new Date().toISOString(), total: 0, days: {} }; },
  load(memoryOnly) {
    this.memoryOnly = !!memoryOnly;
    const d = memoryOnly ? null : store.get('listen', null);
    this.data = d && d.v === 1 && d.days && typeof d.total === 'number' ? d : this.fresh();
    this.last = null;
  },
  tick() {
    if (!this.data) return;
    const P = Player;
    /* the iPhone app measures it itself (it keeps counting while the phone is locked) and sends it over */
    if (!P.cur || !P.playing || (P.audio && P.audio.native)) { this.last = null; return; }
    const t = P.time(), now = performance.now(), id = P.cur.id;
    const l = this.last;
    if (l && l.id === id) {
      const dt = t - l.t, wall = (now - l.w) / 1000;
      /* count normal forward playback only: not seeks, not stalls */
      if (dt > 0 && dt <= wall + 1) this.add(dt);
    }
    this.last = { id, t, w: now };
  },
  /* k: the day (YYYY-MM-DD), today if left out */
  add(sec, k = dayKey(new Date())) {
    if (!this.data || !(sec > 0) || sec > 172800 || !/^\d{4}-\d\d-\d\d$/.test(k)) return;
    this.data.days[k] = (this.data.days[k] || 0) + sec;
    this.data.total += sec;
    this.dirty = true;
    if (Date.now() - this.savedAt > 15000) this.save();
  },
  /* listening time brought over from another copy of Encore (the Home Screen version). What each copy
     brought is remembered (by when that copy started counting), so bringing it over again replaces it
     instead of adding it twice. */
  merge(o) {
    if (!this.data || !o || o.v !== 1 || !o.days || typeof o.days !== 'object') return false;
    const d = this.data, src = String(o.since || '');
    if (!d.imports || typeof d.imports !== 'object') d.imports = {};
    const prev = d.imports[src];
    if (prev && prev.days) {
      for (const [k, v] of Object.entries(prev.days)) { if (d.days[k]) d.days[k] = Math.max(0, d.days[k] - (+v || 0)); }
      d.total = Math.max(0, d.total - (+prev.total || 0));
    }
    const days = {};
    let inDays = 0;
    for (const [k, v] of Object.entries(o.days)) {
      const sec = +v;
      if (!/^\d{4}-\d\d-\d\d$/.test(k) || !(sec > 0) || sec > 172800) continue;
      days[k] = sec; inDays += sec;
      d.days[k] = (d.days[k] || 0) + sec;
    }
    /* the other copy's total also has days it no longer lists (it keeps 420) */
    const total = +o.total > 0 && isFinite(+o.total) ? Math.max(+o.total, inDays) : inDays;
    d.total += total;
    d.imports[src] = { days, total };
    if (o.since && Date.parse(o.since) < Date.parse(d.since)) d.since = o.since;
    this.dirty = true; this.savedAt = 0; this.save();
    return true;
  },
  save() {
    this.savedAt = Date.now();
    if (!this.dirty || this.memoryOnly || !this.data) return;
    this.dirty = false;
    const keys = Object.keys(this.data.days).sort();
    if (keys.length > 420) keys.slice(0, keys.length - 420).forEach((k) => delete this.data.days[k]);
    store.set('listen', this.data);
  },
  /* seconds per day for the last n days, oldest first */
  lastDays(n) {
    const out = [], d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (n - 1));
    for (let i = 0; i < n; i++) {
      const k = dayKey(d);
      out.push({ key: k, date: new Date(d), sec: (this.data && this.data.days[k]) || 0 });
      d.setDate(d.getDate() + 1);
    }
    return out;
  },
  sumSince(fromKey) {
    if (!this.data) return 0;
    let s = 0;
    for (const [k, v] of Object.entries(this.data.days)) if (k >= fromKey) s += v;
    return s;
  },
  init() {
    Player.on('time', () => this.tick());
    Player.on('state', () => { this.tick(); if (!Player.playing) this.save(); });
    Player.on('change', () => { this.last = null; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    window.addEventListener('pagehide', () => this.save());
  },
};

/* ---------- keeping the iPhone app and this page in step ---------- */
/* a song the app played that this page doesn't have in its lists any more (from the details the app keeps) */
function songFromNative(info) {
  if (!info || !info.id) return null;
  const s = { id: String(info.id), title: String(info.title || ''), artist: String(info.artist || ''), album: String(info.album || ''),
    duration: +info.duration > 0 ? +info.duration : 0, coverArt: String(info.coverArt || ''),
    artistId: String(info.artistId || ''), albumId: String(info.albumId || '') };
  if (info.isRadio) { s.isRadio = true; s.streamUrl = String(info.url || ''); s.artist = s.artist || 'Internet Radio'; }
  return s;
}
const NativeLink = {
  audio: null, queued: false, onPaste: null,
  /* the app stopped at the end of the songs it knew, after this song: what to do is decided once all of the
     news is in (you may have pressed Play or Back on the lock screen since) */
  ended: '',
  init(audio) {
    this.audio = audio;
    audio.accepting = () => this.active();
    audio.addEventListener('native', (e) => this.handle(e.detail));
    Player.on('queue', () => this.soon());
    Player.on('change', () => this.soon());
  },
  active() { return !!this.audio && Player.audio === this.audio && !!api && !api.demo; },
  /* tell the app the coming songs (once, after everything that changed them in this turn) */
  soon() {
    if (this.queued || !this.audio) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; this.sendAhead(); });
  },
  sendAhead() {
    const P = Player;
    if (!this.active() || !P.cur || !this.audio._key) return;
    this.audio.post({
      type: 'upcoming', key: P.cur.id, req: this.audio.req,
      items: P._lookahead(NATIVE_AHEAD).map(nativeItem),
      /* where the lock screen's back button goes, oldest first */
      back: P.history.slice(-20).map((h) => nativeItem(h.song)),
      repeatOne: P.repeat === 'one',
    });
  },
  handle(m) {
    const P = Player, a = this.audio;
    if (!m) return;
    /* the clipboard, for Bring Over Settings (also in the demo library) */
    if (m.type === 'paste') {
      if (this.onPaste) { const f = this.onPaste; this.onPaste = null; f(typeof m.text === 'string' ? m.text : ''); }
      return;
    }
    if (!this.active()) return;
    switch (m.type) {
      case 'advance': {
        /* The app moved on by itself (the song ended, a lock screen button, a song that wouldn't play).
           When this page has already moved somewhere else, or asked for another song since, it's old news. */
        if ((!a.catchup && m.req !== a.req) || !P.cur || P.cur.id !== m.from) return;
        if (!m.to) { this.ended = m.from; return; }
        this.ended = '';
        /* Make the same move here when it leads to the song the app went to; it's then followed, not loaded
           again. If this page would have gone somewhere else, go where the app went: that's what was heard. */
        const want = m.reason === 'prev' ? (P.history.length ? P.history[P.history.length - 1].song : null) : P._lookahead(1)[0];
        a.expect = m.to;
        try {
          if (want && want.id === m.to) {
            if (m.reason === 'prev') P.prev(true);
            else P.next(m.reason === 'next');
          } else this.follow(m.to, m.song);
        } finally { a.expect = ''; }
        break;
      }
      case 'snapshot': this.reconcile(m); break;
      case 'batchEnd':
        /* news of the end that came without the app's state: ask for it before deciding (reconcile) */
        if (this.ended && !m.snapshot) a.pull();
        break;
      case 'scrobbled': {
        const song = this.find(m.key);
        Lib.notePlayed(song || { id: m.key });
        if (song) P.emit('played', song);
        break;
      }
      case 'listened':
        for (const [k, sec] of Object.entries(m.days || {})) Listen.add(+sec, k);
        Listen.save();
        break;
      default: break;
    }
  },
  /* After catching up: when the app is on another song than this page, and it got there by itself (or it's
     where it was when the app was closed), that's the song you heard, so this page goes there. When the app's
     song came from this page's own earlier request, this page's song is loaded instead, paused. */
  reconcile(m) {
    const P = Player, a = this.audio;
    const ended = this.ended;
    this.ended = '';
    if (m.req !== a.req) return;
    if (ended && m.key === ended && !m.playing && (+m.t || 0) < 1 && P.cur && P.cur.id === ended) {
      /* the app is still stopped at the start of that song, where the end of the list left it */
      this.atEnd();
      if (P.cur && P.cur.id === m.key) a._sync(m);
      return;
    }
    if (!m.key) { if (a._key && P.cur) a.track(nativeItem(P.cur), { autoplay: false, startAt: P.time() }); return; }
    if (m.key === a._key) { a._sync(m); return; }
    if (m.own && this.follow(m.key, m.song)) { a._sync(m); return; }
    if (P.cur) { P.wantPlay = false; a.track(nativeItem(P.cur), { autoplay: false, startAt: P.time() }); P.emit('state'); }
  },
  /* after the last song the app knew: move on to the next song here, paused (so nothing starts by itself),
     or stop at the start of this one when there's nothing next */
  atEnd() {
    const P = Player;
    if (!P.next(false, false)) { P.pause(); P.seek(0); P.emit('state'); }
  },
  /* move this page to the song the app is on, without loading it again */
  follow(key, info) {
    const P = Player, a = this.audio;
    a.expect = key;
    try {
      const j = P.upNext.findIndex((s) => s.id === key);
      if (j >= 0) { P.jumpQueue(j, P.upNext[j]); return !!P.cur && P.cur.id === key; }
      const c = P.ctx;
      if (c) {
        const q = c.order.findIndex((i, x) => x > c.pos && c.songs[i] && c.songs[i].id === key);
        if (q > c.pos) { P.jumpCtx(q - c.pos - 1, c.songs[c.order[q]]); return !!P.cur && P.cur.id === key; }
      }
      const song = this.find(key) || songFromNative(info);
      if (!song) return false;
      P._pushHistory();
      P._start(song, 'hist');
      return true;
    } finally { a.expect = ''; }
  },
  find(key) {
    const P = Player;
    if (P.cur && P.cur.id === key) return P.cur;
    for (let i = P.history.length - 1; i >= 0; i--) if (P.history[i].song.id === key) return P.history[i].song;
    return P.upNext.find((s) => s.id === key) || (P.ctx && P.ctx.songs.find((s) => s && s.id === key)) || null;
  },
  /* the app reads the clipboard (it asks you first) */
  paste() {
    return new Promise((resolve) => {
      if (this.onPaste) this.onPaste('');
      this.onPaste = resolve;
      this.audio.post({ type: 'paste' });
      setTimeout(() => { if (this.onPaste === resolve) { this.onPaste = null; resolve(''); } }, 60000);
    });
  },
};
if (nativeAudio) NativeLink.init(nativeAudio);

/* the iPhone app's status bar: light text on dark screens */
const NativeChrome = {
  last: '',
  update() {
    if (!Native) return;
    const th = Settings.get('theme');
    const light = th === 'light' || (th !== 'dark' && !!window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
    const style = NP.isOpen || !light ? 'light' : 'dark';
    if (style === this.last) return;
    this.last = style;
    Native.post({ type: 'statusBar', style });
  },
  init() {
    if (!Native) return;
    const mq = window.matchMedia && matchMedia('(prefers-color-scheme: light)');
    if (mq && mq.addEventListener) mq.addEventListener('change', () => this.update());
    this.update();
  },
};

/* ---------- moving to the iPhone app: settings, listening time and hidden lyrics ---------- */
const Transfer = {
  pack() {
    Listen.save();
    return JSON.stringify({ encore: 'settings', v: 1, version: APP_VERSION, settings: Settings.data, listen: Listen.data, lyricsHidden: LyHidden.list() });
  },
  /* -> what was brought over, or null when the text isn't Encore's */
  apply(text) {
    let o = null;
    try { o = JSON.parse(String(text || '').trim()); } catch (e) { return null; }
    if (!o || o.encore !== 'settings' || o.v !== 1) return null;
    const got = [];
    if (o.settings && typeof o.settings === 'object') {
      const s = {};
      for (const [k, def] of Object.entries(Settings.defaults)) {
        const v = o.settings[k];
        if (v === undefined || v === null) continue;
        if (Array.isArray(def) ? Array.isArray(v) : typeof v === typeof def) s[k] = v;
      }
      Settings.data = Object.assign({}, Settings.defaults, Settings.data, s);
      store.set('settings', Settings.data);
      Settings.apply();
      got.push('settings');
    }
    if (o.listen && !Listen.memoryOnly && Listen.merge(o.listen)) got.push('listening time');
    if (Array.isArray(o.lyricsHidden) && o.lyricsHidden.length) {
      const mine = LyHidden.list();
      const add = o.lyricsHidden.filter((x) => typeof x === 'string' && !mine.includes(x));
      add.forEach((id) => LyHidden.set(id, true));
      Lyrics.clear();
      got.push('hidden lyrics');
    }
    return got;
  },
};
/* copy text, also on a plain http:// address (where navigator.clipboard isn't available) */
function copyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px';
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.select(); ta.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch (e) { ok = false; }
  ta.remove();
  if (ok) return Promise.resolve(true);
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false);
  return Promise.resolve(false);
}

/* ---------- pages & navigation stacks ---------- */
const pageOf = new WeakMap();
function pageFromEl(el) { const p = el && el.closest && el.closest('.page'); return p ? pageOf.get(p) : null; }
function offsetIn(el, ancestor) {
  let y = 0;
  while (el && el !== ancestor) { y += el.offsetTop; el = el.offsetParent; }
  return y;
}

class Page {
  constructor(tab, { root = false } = {}) {
    this.tab = tab; this.root = root; this.vlists = []; this.cleanups = []; this.handlers = {}; this.lastSt = 0;
    const el = this.el = document.createElement('section');
    el.className = 'page';
    el.innerHTML = `<div class="scroller"><div class="pg${root ? ' root' : ''}"></div></div><div class="edge-top"></div>`
      + `<header class="nav">${root ? '' : `<button class="nb back glass" data-act="back" aria-label="Back">${I.chevL}</button>`}`
      + `<div class="nav-title"></div><div class="nav-r"></div></header><div class="page-shade"></div>`;
    this.scroller = el.querySelector('.scroller');
    this.pg = el.querySelector('.pg');
    this.navEl = el.querySelector('.nav');
    this.titleEl = el.querySelector('.nav-title');
    this.actionsEl = el.querySelector('.nav-r');
    this.shade = el.querySelector('.page-shade');
    pageOf.set(el, this);
    let ticking = false;
    this.scroller.addEventListener('scroll', () => {
      if (Swipe.openRow && el.contains(Swipe.openRow)) Swipe.close();
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; this.onScroll(); });
    }, { passive: true });
  }
  setTitle(t) { this.title = t; this.titleEl.textContent = t; }
  setActions(html) { this.actionsEl.innerHTML = html; }
  navH() { return this.navEl.offsetHeight || 44; }
  titleAt() {
    const t = this.pg.querySelector('[data-title-anchor], .ltitle, .rtitle');
    if (!t) return 20;
    if (t.classList.contains('rtitle')) return 30;
    return offsetIn(t, this.scroller) + t.offsetHeight - this.navH() - 8;
  }
  onScroll() {
    const st = this.scroller.scrollTop;
    this.el.classList.toggle('scrolled', st > 3);
    this.el.classList.toggle('titled', !!this.inlineTitle && st > this.titleAt());
    Dock.onScroll(this, st);
    for (const v of this.vlists) v.update();
  }
  destroy() {
    this.destroyed = true;
    this.cleanups.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    this.vlists = [];
    this.el.remove();
  }
  showError(err, retry) {
    this.pg.querySelectorAll('.spin, .loading-note').forEach((x) => x.remove());
    const box = htmlEl(`<div class="empty"><b>Couldn’t Load</b>${esc(err && err.message ? err.message : 'Something went wrong.')}<br><button class="btn">Try Again</button></div>`);
    box.querySelector('.btn').addEventListener('click', () => { box.remove(); retry(); });
    this.pg.appendChild(box);
  }
}

async function runView(page, view, params) {
  try { await view(page, params || {}); }
  catch (err) {
    console.error(err);
    if (err && (err.code === 40 || err.code === 41)) { App.authFailed(); return; }
    page.showError(err, () => { page.pg.innerHTML = ''; page.setActions(''); runView(page, view, params); });
  }
  requestAnimationFrame(() => page.onScroll());
}

const Nav = {
  cur: 'library', tabs: {}, busy: false,
  init() {
    for (const name of ['library', 'radio', 'search']) this.tabs[name] = { el: $(`.tabv[data-tab="${name}"]`), stack: [] };
  },
  reset() {
    for (const t of Object.values(this.tabs)) { t.stack.forEach((p) => p.destroy()); t.stack = []; }
  },
  top(tab = this.cur) { const s = this.tabs[tab].stack; return s[s.length - 1]; },
  allPages() { return Object.values(this.tabs).flatMap((t) => t.stack); },
  ensureRoot(tab) {
    const t = this.tabs[tab];
    if (t.stack.length) return;
    const p = new Page(tab, { root: true });
    t.stack.push(p); t.el.appendChild(p.el);
    runView(p, Views[tab], {});
  },
  switchTab(name) {
    Swipe.close(true);
    if (name === this.cur && this.tabs[name].stack.length) {
      const st = this.tabs[name].stack;
      if (st.length > 1) this.popToRoot();
      else if (name === 'search' && st[0].input) { st[0].scroller.scrollTop = 0; st[0].input.focus(); }
      else st[0].scroller.scrollTo({ top: 0, behavior: 'smooth' });
      Dock.setMin(false);
      return;
    }
    for (const [n, t] of Object.entries(this.tabs)) t.el.hidden = n !== name;
    this.cur = name;
    this.ensureRoot(name);
    Dock.setTab(name);
    Dock.setMin(false);
  },
  push(view, params = {}) {
    if (this.busy) return null;
    if (NP.isOpen) NP.close();
    UI.closeAll();
    Swipe.close(true);
    const tab = this.tabs[this.cur], prev = this.top();
    const p = new Page(this.cur);
    tab.stack.push(p); tab.el.appendChild(p.el);
    runView(p, Views[view], params);
    if (prev) this.animatePush(p, prev);
    Dock.setMin(false);
    return p;
  },
  animatePush(p, prev) {
    const w = this.tabs[this.cur].el.clientWidth || innerWidth, { easing, duration } = SP.nav;
    this.busy = true;
    p.el.classList.add('moving');
    const a = p.el.animate([{ transform: `translate3d(${w}px,0,0)` }, { transform: 'translate3d(0,0,0)' }], { duration, easing });
    prev.el.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-0.3 * w}px,0,0)` }], { duration, easing, fill: 'forwards' });
    prev.shade.animate([{ opacity: 0 }, { opacity: 0.15 }], { duration, easing, fill: 'forwards' });
    const done = () => {
      p.el.classList.remove('moving');
      const st = this.tabs[prev.tab].stack;
      if (st[st.length - 1] !== prev) prev.el.classList.add('under');
      prev.el.getAnimations().forEach((x) => x.cancel());
      prev.shade.getAnimations().forEach((x) => x.cancel());
      this.busy = false;
    };
    a.finished.then(done, done);
  },
  pop() {
    const tab = this.tabs[this.cur];
    if (tab.stack.length < 2 || this.busy) return;
    Swipe.close(true);
    const p = tab.stack.pop(), prev = this.top();
    prev.el.classList.remove('under');
    const w = tab.el.clientWidth || innerWidth, { easing, duration } = SP.nav;
    this.busy = true;
    p.el.classList.add('moving');
    const a = p.el.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${w}px,0,0)` }], { duration, easing, fill: 'forwards' });
    prev.el.animate([{ transform: `translate3d(${-0.3 * w}px,0,0)` }, { transform: 'translate3d(0,0,0)' }], { duration, easing });
    prev.shade.animate([{ opacity: 0.15 }, { opacity: 0 }], { duration, easing });
    const done = () => { p.destroy(); this.busy = false; if (prev.onShow) prev.onShow(); };
    a.finished.then(done, done);
    Dock.setMin(false);
  },
  popToRoot() {
    const tab = this.tabs[this.cur];
    while (tab.stack.length > 2) tab.stack.splice(1, 1)[0].destroy();
    this.pop();
  },
};

/* ---------- swipe from the left edge to go back ---------- */
const Back = {
  st: null,
  init() {
    document.addEventListener('pointerdown', (e) => this.down(e), { passive: true });
    document.addEventListener('pointermove', (e) => this.move(e), { passive: true });
    document.addEventListener('pointerup', (e) => this.up(e, false), { passive: true });
    document.addEventListener('pointercancel', (e) => this.up(e, true), { passive: true });
  },
  down(e) {
    if (!e.isPrimary || e.clientX > 24 || NP.isOpen || UI.isOpen() || Nav.busy) return;
    const tab = Nav.tabs[Nav.cur];
    if (!tab || tab.stack.length < 2 || !tab.el.contains(e.target)) return;
    const now = performance.now();
    this.st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, decided: false, active: false, cur: Nav.top(), prev: tab.stack[tab.stack.length - 2], w: tab.el.clientWidth, lx: e.clientX, lt: now, v: 0, x: 0 };
  },
  move(e) {
    const s = this.st;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    if (!s.decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.decided = true;
      if (!(dx > 0 && dx > Math.abs(dy) * 1.2)) { this.st = null; return; }
      s.active = true;
      Swipe.close(true);
      s.prev.el.classList.remove('under');
      s.cur.el.classList.add('moving');
      try { s.cur.el.setPointerCapture(s.id); } catch (err) { /* ignore */ }
      Press.cancel(); suppressClicks(450);
    }
    const now = performance.now();
    s.v = (e.clientX - s.lx) / Math.max(1, now - s.lt); s.lx = e.clientX; s.lt = now;
    this.set(clamp(dx, 0, s.w));
  },
  set(x) {
    const s = this.st, p = x / s.w;
    s.x = x;
    s.cur.el.style.transform = `translate3d(${x}px,0,0)`;
    s.prev.el.style.transform = `translate3d(${-0.3 * s.w * (1 - p)}px,0,0)`;
    s.prev.shade.style.opacity = String(0.15 * (1 - p));
  },
  up(e, cancelled) {
    const s = this.st;
    if (!s || e.pointerId !== s.id) return;
    this.st = null;
    if (!s.active) return;
    const x = s.x, done = !cancelled && (x > s.w * 0.4 || (s.v > 0.35 && x > 30));
    const remain = done ? (s.w - x) / s.w : x / s.w;
    const duration = Math.round(clamp(remain * 450, 170, 420)), easing = 'cubic-bezier(.2,.8,.3,1)';
    const p = x / s.w;
    s.cur.el.style.transform = ''; s.prev.el.style.transform = ''; s.prev.shade.style.opacity = '';
    const a = s.cur.el.animate([{ transform: `translate3d(${x}px,0,0)` }, { transform: done ? `translate3d(${s.w}px,0,0)` : 'translate3d(0,0,0)' }], { duration, easing, fill: 'forwards' });
    s.prev.el.animate([{ transform: `translate3d(${-0.3 * s.w * (1 - p)}px,0,0)` }, { transform: done ? 'translate3d(0,0,0)' : `translate3d(${-0.3 * s.w}px,0,0)` }], { duration, easing, fill: 'forwards' });
    s.prev.shade.animate([{ opacity: 0.15 * (1 - p) }, { opacity: done ? 0 : 0.15 }], { duration, easing, fill: 'forwards' });
    Nav.busy = true;
    const fin = () => {
      s.cur.el.classList.remove('moving');
      s.prev.el.getAnimations().forEach((an) => an.cancel());
      s.prev.shade.getAnimations().forEach((an) => an.cancel());
      if (done) {
        const tab = Nav.tabs[s.cur.tab], i = tab.stack.indexOf(s.cur);
        if (i >= 0) tab.stack.splice(i, 1);
        s.cur.destroy();
        if (s.prev.onShow) s.prev.onShow();
      } else {
        s.cur.el.getAnimations().forEach((an) => an.cancel());
        s.prev.el.classList.add('under');
      }
      Nav.busy = false;
    };
    a.finished.then(fin, fin);
  },
};

/* ---------- glass dock: tab pill, search button, mini player ---------- */
const Dock = {
  el: null, min: false,
  init() {
    this.el = $('#dock');
    $$('.tab[data-tab="library"] .ti').forEach((x) => { x.innerHTML = I.libraryTab; });
    $$('.tab[data-tab="radio"] .ti').forEach((x) => { x.innerHTML = I.radio; });
    $('#searchbtn').innerHTML = I.search;
    this.setTab('library');
  },
  setTab(name) {
    $('.tabs', this.el).dataset.sel = name;
    $$('.tab', this.el).forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    $('#searchbtn').classList.toggle('on', name === 'search');
    if (name !== 'search') $('.tab-mini', this.el).innerHTML = name === 'radio' ? I.radio : I.libraryTab;
  },
  setMin(v) {
    if (!Settings.get('shrink')) v = false;
    if (this.min === v) return;
    this.min = v;
    this.el.classList.toggle('min', v);
    clearTimeout(this.mt);
    this.mt = setTimeout(() => Mini.marquee(), 560);
  },
  onScroll(page, st) {
    const d = st - page.lastSt;
    page.lastSt = st;
    if (page !== Nav.top() || NP.isOpen) return;
    const max = page.scroller.scrollHeight - page.scroller.clientHeight;
    if (st < 40) { this.setMin(false); return; }
    if (st > max - 2) return;
    if (d > 7) this.setMin(true);
    else if (d < -12) this.setMin(false);
  },
  setHasMini(v) {
    this.el.classList.toggle('has-mini', v);
    $('#app').classList.toggle('has-mini', v);
  },
  reserve() { return this.el.classList.contains('has-mini') ? 160 : 100; },
};

/* ---------- virtual list: only the rows near the screen exist in the DOM ---------- */
class VList {
  constructor(page, host, { items, height, render, overscan = 700 }) {
    this.page = page; this.host = host; this.render = render; this.overscan = overscan;
    this.heightOf = typeof height === 'function' ? height : () => height;
    this.nodes = new Map();
    host.classList.add('vl');
    this.items = items;
    this.measure();
    page.vlists.push(this);
    this.update();
  }
  measure() {
    const n = this.items.length;
    this.off = new Float64Array(n + 1);
    let y = 0;
    for (let i = 0; i < n; i++) { this.off[i] = y; y += this.heightOf(this.items[i], i); }
    this.off[n] = y;
    this.host.style.height = y + 'px';
  }
  relayout() { this.measure(); for (const [i, el] of this.nodes) el.style.top = this.off[i] + 'px'; this.update(); }
  setItems(items) {
    const oldLen = this.items.length;
    const keepScroll = oldLen && items.length >= oldLen;
    this.items = items;
    if (!keepScroll) { this.nodes.forEach((el) => el.remove()); this.nodes.clear(); }
    else {
      /* the old last row may have been partial (e.g. one album in a two-album row): redraw it */
      const last = this.nodes.get(oldLen - 1);
      if (last) { last.remove(); this.nodes.delete(oldLen - 1); }
    }
    this.measure();
    this.update();
  }
  rerender() { this.nodes.forEach((el) => el.remove()); this.nodes.clear(); this.update(); }
  find(y) {
    let lo = 0, hi = this.items.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.off[mid + 1] <= y) lo = mid + 1; else hi = mid; }
    return lo;
  }
  update() {
    if (!this.host.isConnected) return;
    const sc = this.page.scroller, top = offsetIn(this.host, sc);
    const st = sc.scrollTop - top, vh = sc.clientHeight || innerHeight;
    const n = this.items.length;
    if (!n) return;
    const a = this.find(Math.max(0, st - this.overscan)), b = Math.min(n - 1, this.find(st + vh + this.overscan));
    for (const [i, el] of this.nodes) {
      if (i < a || i > b) {
        if (el.classList.contains('swiping') || el.classList.contains('open')) continue;
        el.remove(); this.nodes.delete(i);
      }
    }
    for (let i = a; i <= b; i++) {
      if (this.nodes.has(i)) continue;
      const el = htmlEl(this.render(this.items[i], i));
      el.classList.add('vi');
      el.style.top = this.off[i] + 'px';
      this.host.appendChild(el);
      this.nodes.set(i, el);
    }
  }
  nodeAt(i) { return this.nodes.get(i); }
  scrollToIndex(i) {
    const sc = this.page.scroller;
    sc.scrollTop = Math.max(0, offsetIn(this.host, sc) + this.off[clamp(i, 0, this.items.length - 1)] - this.page.navH() - 4);
    this.update();
  }
  destroy() { this.nodes.forEach((el) => el.remove()); this.nodes.clear(); this.page.vlists = this.page.vlists.filter((v) => v !== this); }
}

/* ---------- A–Z index on the right edge ---------- */
function makeIndex(page, onJump) {
  if (page.destroyed) return { el: null, layout() {}, remove() {} };
  const el = htmlEl(`<div class="idx" aria-hidden="true">${LETTERS.map((l) => `<span>${l}</span>`).join('')}</div>`);
  page.el.appendChild(el);
  page.el.classList.add('has-idx');
  const layout = () => {
    const top = page.navH() + 75;
    const avail = page.el.clientHeight - top - Dock.reserve();
    const per = clamp(avail / LETTERS.length, 8, 13.5);
    el.style.top = top + 'px';
    el.style.fontSize = Math.min(11, per - 1.5) + 'px';
    el.querySelectorAll('span').forEach((s) => { s.style.lineHeight = per + 'px'; });
  };
  layout();
  let last = -1, active = false;
  const pick = (y) => {
    const r = el.getBoundingClientRect(), h = (r.height - 8) / LETTERS.length;
    const i = clamp(Math.floor((y - r.top - 4) / h), 0, LETTERS.length - 1);
    if (i !== last) { last = i; onJump(LETTERS[i]); }
  };
  el.addEventListener('pointerdown', (e) => { if (!e.isPrimary) return; active = true; last = -1; try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } pick(e.clientY); });
  el.addEventListener('pointermove', (e) => { if (active) pick(e.clientY); });
  const end = () => { active = false; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  const onResize = () => layout();
  window.addEventListener('resize', onResize);
  page.cleanups.push(() => window.removeEventListener('resize', onResize));
  return { el, layout, remove() { el.remove(); page.el.classList.remove('has-idx'); window.removeEventListener('resize', onResize); } };
}
/* first index for each letter (falls forward to the next letter that has items) */
function letterJumps(items, letterFor) {
  const first = {};
  items.forEach((it, i) => { const L = letterFor(it); if (L && first[L] == null) first[L] = i; });
  const out = {};
  let nextIdx = items.length - 1;
  for (let k = LETTERS.length - 1; k >= 0; k--) {
    const L = LETTERS[k];
    if (first[L] != null) nextIdx = first[L];
    out[L] = nextIdx;
  }
  return out;
}

/* ---------- screens ---------- */
const Views = {};
function pillBtns(buttons) {
  return `<div class="pill glass">${buttons.map(([act, icon, label]) => `<button class="pb" data-act="${act}" aria-label="${esc(label)}">${icon}</button>`).join('')}</div>`;
}
function circleBtn(act, icon, label) { return `<button class="nb glass" data-act="${act}" aria-label="${esc(label)}">${icon}</button>`; }
function albumTile(a) {
  return `<button class="gi" data-act="album" data-id="${esc(a.id)}" data-press><div class="art">${img(a.coverArt, 500)}</div><div class="g1">${esc(a.name)}</div><div class="g2">${esc(a.artist)}</div></button>`;
}
function artistRow(a) {
  return `<button class="arow" data-act="artist" data-id="${esc(a.id)}" data-name="${esc(a.name)}" data-press><div class="art mic">${img(a.coverArt || ('ar-' + a.id), 150)}</div><div class="nm">${esc(a.name)}</div><span class="chev">${I.chevR}</span></button>`;
}
function playButtons() {
  return `<div class="pbtns"><button class="pbtn" data-act="play-all">${I.play}Play</button><button class="pbtn" data-act="shuffle-all">${I.shuffle}Shuffle</button></div>`;
}
function headerLetters(name) {
  const n = String(name || '').trim().toUpperCase();
  const m = /^([A-Z])\s*-\s*([A-Z])$/.exec(n);
  if (m) { const out = []; for (let c = m[1].charCodeAt(0); c <= m[2].charCodeAt(0); c++) out.push(String.fromCharCode(c)); return out; }
  const L = letterOf(n);
  return [L];
}
function letterJumpsMulti(items, lettersFor) {
  const first = {};
  items.forEach((it, i) => { (lettersFor(it) || []).forEach((L) => { if (first[L] == null) first[L] = i; }); });
  const out = {};
  let nextIdx = items.length - 1;
  for (let k = LETTERS.length - 1; k >= 0; k--) { if (first[LETTERS[k]] != null) nextIdx = first[LETTERS[k]]; out[LETTERS[k]] = nextIdx; }
  return out;
}

/* ----- Library (home) ----- */
const LIB_SECTIONS = {
  ra: { title: 'Recently Added', see: 'see-recent', setting: 'raOpen' },
  rp: { title: 'Recently Played', see: 'see-played', setting: 'rpOpen' },
};
Views.library = async (page) => {
  page.kind = 'library';
  page.setTitle('Library');
  page.setActions(pillBtns([['new-playlist', I.listPlus, 'New Playlist'], ['lib-menu', I.ellipsis, 'More']])
    + `<button class="avatar" data-act="settings" aria-label="Settings">${esc(initials(api.user || 'Me'))}</button>`);
  const cat = (view, label, icon) => `<button class="cat" data-act="go" data-view="${view}" data-press><span class="ci">${icon}</span>${label}<span class="chev">${I.chevR}</span></button>`;
  const section = (key) => {
    const S = LIB_SECTIONS[key], open = !!Settings.get(S.setting);
    return `<div class="shead" data-sec="${key}" aria-expanded="${open}"><button class="sh-btn" data-act="toggle-sec" data-sec="${key}" aria-expanded="${open}">${S.title}<span class="sh-chev">${I.chevR}</span></button><button class="see" data-act="${S.see}"${open ? '' : ' hidden'}>See All</button></div>`
      + `<div class="secbox ${key}" data-sec="${key}"${open ? '' : ' hidden'}></div>`;
  };
  page.pg.innerHTML = `<h1 class="rtitle">Library</h1>${api.demo ? '<p class="subline">Sample library for trying Encore</p>' : ''}
    <div class="cats">${cat('playlists', 'Playlists', I.playlists)}${cat('artists', 'Artists', I.mic)}${cat('albums', 'Albums', I.album)}${cat('songs', 'Songs', I.note)}${cat('stats', 'Stats', I.chart)}</div>
    ${section('ra')}${section('rp')}`;
  page.handlers['toggle-sec'] = (el) => toggleSection(page, el.dataset.sec);
  page.handlers['see-recent'] = () => Nav.push('albums', { sort: 'newest', title: 'Recently Added' });
  page.handlers['see-played'] = () => Nav.push('played');
  page.reload = () => {
    for (const key of Object.keys(LIB_SECTIONS)) {
      const box = secBox(page, key);
      if (!box) continue;
      delete box.dataset.loaded;
      if (!box.hidden) loadSection(page, key);
    }
  };
  /* a play Encore just registered moves that song to the top of Recently Played (no server round trip) */
  page.cleanups.push(Player.on('played', (song) => {
    const box = secBox(page, 'rp');
    if (!box || !box.dataset.loaded || box.querySelector('.spin')) return;
    if (box.querySelector('.srow.swiping, .srow.open')) { box.dataset.stale = '1'; return; }
    const host = box.querySelector('[data-list]');
    const list = (host && host._list ? host._list.songs : []).filter((x) => x.id !== song.id);
    renderPlayed(box, [song].concat(list).slice(0, 8));
  }));
  await Promise.all(Object.keys(LIB_SECTIONS).filter((k) => Settings.get(LIB_SECTIONS[k].setting)).map((k) => loadSection(page, k)));
};
function secBox(page, key) { return page.pg.querySelector(`.secbox[data-sec="${key}"]`); }
async function loadSection(page, key, quiet) {
  const box = secBox(page, key);
  if (!box || box.dataset.loaded) return;
  box.dataset.loaded = '1';
  delete box.dataset.stale;
  if (!quiet) box.innerHTML = SPIN;
  try {
    if (key === 'ra') {
      const albums = await Lib.recent(24);
      if (page.destroyed) return;
      box.innerHTML = albums.length ? `<div class="grid">${albums.map(albumTile).join('')}</div>` : '<div class="empty">Nothing has been added yet.</div>';
    } else {
      const songs = await Lib.recentlyPlayedQuick(8);
      if (page.destroyed) return;
      /* don't pull a row out from under a finger that's swiping it */
      if (box.querySelector('.srow.swiping, .srow.open')) { box.dataset.stale = '1'; return; }
      renderPlayed(box, songs);
    }
  } catch (err) {
    delete box.dataset.loaded;
    if (page.destroyed) return;
    box.innerHTML = `<div class="empty">${esc(err.message)}<br><button class="btn" data-act="retry-sec" data-sec="${key}">Try Again</button></div>`;
    page.handlers['retry-sec'] = (el) => loadSection(page, el.dataset.sec);
  }
}
function renderPlayed(box, songs) {
  if (!songs.length) { box.innerHTML = '<div class="empty">Songs you play show up here, including ones you play in other apps like Amperfy.</div>'; return; }
  box.innerHTML = '<div class="rp-list"></div>';
  const host = box.firstElementChild;
  const L = bindList(host, songs, 'Recently Played', { render: (s, i) => songRow(s, i, { sub: (x) => `${x.artist} · ${fmtAgo(x.played)}` }) });
  host.innerHTML = songs.map((s, i) => L.render(s, i)).join('');
}
function toggleSection(page, key) {
  const S = LIB_SECTIONS[key];
  const head = page.pg.querySelector(`.shead[data-sec="${key}"]`), btn = head.querySelector('.sh-btn'), box = secBox(page, key), see = head.querySelector('.see');
  const open = head.getAttribute('aria-expanded') !== 'true';
  head.setAttribute('aria-expanded', String(open)); btn.setAttribute('aria-expanded', String(open));
  Settings.set(S.setting, open);
  see.hidden = !open;
  box.getAnimations().forEach((a) => a.cancel());
  if (open) {
    box.hidden = false;
    if (box.dataset.stale) delete box.dataset.loaded;
    loadSection(page, key);
    const h = box.scrollHeight;
    box.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], { duration: 420, easing: SP.ui.easing });
  } else {
    const h = box.offsetHeight;
    const a = box.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 280, easing: 'cubic-bezier(.4,0,.2,1)' });
    a.finished.then(() => { box.hidden = true; }, () => {});
  }
}

/* ----- Recently Played (full list) ----- */
Views.played = async (page) => {
  page.kind = 'played';
  page.setTitle('Recently Played');
  page.pg.innerHTML = `<h1 class="ltitle">Recently Played</h1><p class="subline">Includes songs you played in other apps like Amperfy.</p><div class="host">${SPIN}<div class="loading-note"></div></div>`;
  const host = page.pg.querySelector('.host');
  const load = async () => {
    const note = host.querySelector('.loading-note');
    const songs = await Lib.recentlyPlayed(200, 180000, (n) => { if (note) note.textContent = `Checking ${n.toLocaleString()} songs…`; });
    if (page.destroyed) return;
    if (!songs.length) { host.innerHTML = '<div class="empty"><b>Nothing Played Yet</b>Songs you play show up here.</div>'; return; }
    host.insertAdjacentHTML('beforebegin', page.pg.querySelector('.pbtns') ? '' : playButtons());
    const L = bindList(host, songs, 'Recently Played', { render: (s, i) => songRow(s, i, { sub: (x) => `${x.artist} · ${fmtAgo(x.played)}` }) });
    host.innerHTML = songs.map((s, i) => L.render(s, i)).join('');
  };
  page.handlers['play-all'] = () => { const L = host._list; if (L) Player.playList(L.songs, 0, 'Recently Played'); };
  page.handlers['shuffle-all'] = () => { const L = host._list; if (L) Player.playShuffled(L.songs, 'Recently Played'); };
  page.reload = () => { host.innerHTML = SPIN + '<div class="loading-note"></div>'; load().catch((e) => page.showError(e, page.reload)); };
  await load();
};

/* ----- Stats ----- */
Views.stats = async (page) => {
  page.kind = 'stats';
  page.setTitle('Stats');
  page.pg.innerHTML = `<h1 class="ltitle">Stats</h1>
    <section class="st-block st-all" aria-busy="true"><div class="st-loading">${SPIN}<div class="loading-note">Counting your plays…</div></div></section>
    <section class="st-block st-measured"></section>
    <div class="st-tops"></div>`;
  const measured = page.pg.querySelector('.st-measured');
  let selected = 6;
  const renderMeasured = () => {
    if (!measured.isConnected) return;
    measured.innerHTML = measuredHTML(selected);
  };
  page.handlers['st-day'] = (el) => { selected = +el.dataset.i; renderMeasured(); };
  renderMeasured();
  /* keep today's number current while the page is open */
  const timer = setInterval(() => { if (!document.hidden && Nav.top() === page) renderMeasured(); }, 20000);
  page.cleanups.push(() => clearInterval(timer));

  const allBox = page.pg.querySelector('.st-all'), tops = page.pg.querySelector('.st-tops');
  const note = allBox.querySelector('.loading-note');
  const load = async () => {
    const songs = await Lib.allSongs((n, total) => { if (note) note.textContent = total ? `Counting plays in ${n.toLocaleString()} of ${total.toLocaleString()} songs…` : `Counting plays in ${n.toLocaleString()} songs…`; });
    if (page.destroyed) return;
    const S = computeStats(songs);
    allBox.removeAttribute('aria-busy');
    allBox.innerHTML = allTimeHTML(S);
    tops.innerHTML = '';
    if (!S.plays) { tops.innerHTML = '<div class="empty">Play some music and your most played songs, artists and albums show up here.</div>'; return; }
    tops.insertAdjacentHTML('beforeend', '<div class="sec-h">Top Songs</div><div class="top-songs"></div>');
    const host = tops.querySelector('.top-songs');
    const L = bindList(host, S.topSongs, 'Top Songs', { render: (s, i) => songRow(s, i, { sub: (x) => `${x.artist} · ${plural(x.playCount, 'play')}` }) });
    host.innerHTML = S.topSongs.map((s, i) => L.render(s, i)).join('');
    tops.insertAdjacentHTML('beforeend', '<div class="sec-h">Top Artists</div>' + S.topArtists.map((a) => `<button class="xrow" data-act="artist" data-id="${esc(a.id)}" data-name="${esc(a.name)}" data-press><div class="art round mic">${a.id ? img(api.demo && a.id.startsWith('ar-') ? a.id : 'ar-' + a.id, 150) : ''}</div><div class="txt"><div class="t1">${esc(a.name)}</div><div class="t2">${plural(a.plays, 'play')} · ${plural(a.songs, 'song')}</div></div><span class="chev">${I.chevR}</span></button>`).join(''));
    tops.insertAdjacentHTML('beforeend', '<div class="sec-h">Top Albums</div>' + S.topAlbums.map((a) => `<button class="xrow" data-act="album" data-id="${esc(a.id)}" data-press><div class="art">${img(a.coverArt, 150)}</div><div class="txt"><div class="t1">${esc(a.name || 'Unknown Album')}</div><div class="t2">${esc(a.artist)} · ${plural(a.plays, 'play')}</div></div><span class="chev">${I.chevR}</span></button>`).join(''));
    tops.insertAdjacentHTML('beforeend', '<div class="foot">Play counts and last-played dates come from your Navidrome server, so they include every app you play music in.</div>');
  };
  page.reload = () => { Lib.invalidate('songs'); allBox.innerHTML = `<div class="st-loading">${SPIN}</div>`; load().catch((e) => page.showError(e, page.reload)); };
  await load();
};
function computeStats(songs) {
  let plays = 0, sec = 0, played = 0;
  const artists = new Map(), albums = new Map();
  for (const s of songs) {
    const n = s.playCount || 0;
    if (!n) continue;
    plays += n; sec += n * (s.duration || 0); played++;
    const name = s.primaryArtist || s.artist;
    const ak = s.artistId || 'name:' + name;
    const a = artists.get(ak) || { id: s.artistId, name, plays: 0, songs: 0 };
    if (name.length < a.name.length) a.name = name;
    a.plays += n; a.songs++; artists.set(ak, a);
    const bk = s.albumId || 'name:' + s.album;
    const b = albums.get(bk) || { id: s.albumId, name: s.album, artist: s.albumArtist || s.artist, coverArt: s.coverArt, plays: 0 };
    b.plays += n; albums.set(bk, b);
  }
  const byPlays = (x, y) => y.plays - x.plays || collator.compare(x.name || '', y.name || '');
  const topSongs = songs.filter((s) => s.playCount > 0)
    .sort((x, y) => y.playCount - x.playCount || byPlayed(x, y)).slice(0, 25);
  return {
    plays, sec, played, artistCount: artists.size,
    topSongs,
    topArtists: Array.from(artists.values()).sort(byPlays).slice(0, 10),
    topAlbums: Array.from(albums.values()).filter((b) => b.id).sort(byPlays).slice(0, 10),
  };
}
function allTimeHTML(S) {
  return `<div class="st-label">Total listening time</div>
    <div class="st-hero">${esc(fmtListen(S.sec, { short: true }))}</div>
    <p class="st-note">Estimated from Navidrome’s play counts, so it includes other apps like Amperfy. Each play counts as the whole song.</p>
    <div class="st-tiles">
      <div class="st-tile"><div class="st-tl">Plays</div><div class="st-tv">${fmtCompact(S.plays)}</div></div>
      <div class="st-tile"><div class="st-tl">Songs played</div><div class="st-tv">${fmtCompact(S.played)}</div></div>
      <div class="st-tile"><div class="st-tl">Artists</div><div class="st-tv">${fmtCompact(S.artistCount)}</div></div>
    </div>`;
}
/* round gridline steps in minutes; neither a step nor its double ends in 6 */
const ST_STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 240, 300, 420, 600, 720];
function measuredHTML(sel) {
  const days = Listen.lastDays(7), d = Listen.data || { total: 0, since: new Date().toISOString() };
  const maxMin = Math.max(...days.map((x) => x.sec / 60));
  const step = ST_STEPS.find((s) => s * 2 >= maxMin) || Math.ceil(maxMin / 2 / 60) * 60;
  const top = step * 2;
  const since = new Date(d.since);
  const sinceLabel = since.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const now = new Date();
  const monthKey = dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const week = days.reduce((t, x) => t + x.sec, 0);
  const pick = days[sel] || days[6];
  const dayName = (x, i) => (i === 6 ? 'Today' : i === 5 ? 'Yesterday' : x.date.toLocaleDateString(undefined, { weekday: 'long' }));
  const gl = (m) => (m >= 60 ? `${m / 60} hr` : `${m} min`);
  const cols = days.map((x, i) => {
    const pct = top ? Math.min(100, (x.sec / 60 / top) * 100) : 0;
    const label = `${x.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}: ${fmtListen(x.sec)}`;
    return `<button class="st-col${i === sel ? ' on' : ''}" data-act="st-day" data-i="${i}" aria-label="${esc(label)}" aria-pressed="${i === sel}"><span class="st-bar" style="height:${pct.toFixed(1)}%"></span></button>`;
  }).join('');
  const xl = days.map((x, i) => `<span class="${i === sel ? 'on' : ''}">${esc(x.date.toLocaleDateString(undefined, { weekday: 'narrow' }))}</span>`).join('');
  const rows = days.map((x) => `<tr><th scope="row">${esc(x.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }))}</th><td>${esc(fmtListen(x.sec))}</td></tr>`).join('');
  return `<div class="sec-h st-h">Measured by Encore</div>
    <p class="st-note">Exact time music played on this device since ${esc(sinceLabel)}. Pauses and skips don’t count.</p>
    <div class="st-readout"><span class="st-rv">${esc(fmtListen(pick.sec, { short: true }))}</span><span class="st-rl">${esc(dayName(pick, sel))}</span></div>
    <figure class="st-chart" aria-label="Minutes listened per day, last 7 days">
      <div class="st-plot">
        <div class="st-grid" style="bottom:50%"><span>${gl(step)}</span></div>
        <div class="st-grid" style="bottom:100%"><span>${gl(top)}</span></div>
        <div class="st-cols">${cols}</div>
        ${week < 1 ? `<p class="st-empty">${d.total >= 1 ? 'Nothing played in the last 7 days.' : 'Nothing measured yet. Play some music and it shows up here.'}</p>` : ''}
      </div>
      <div class="st-x" aria-hidden="true">${xl}</div>
      <table class="sr-only"><caption>Listening time per day</caption>${rows}</table>
    </figure>
    <div class="st-tiles">
      <div class="st-tile"><div class="st-tl">Last 7 days</div><div class="st-tv">${esc(fmtListen(week, { short: true }))}</div></div>
      <div class="st-tile"><div class="st-tl">This month</div><div class="st-tv">${esc(fmtListen(Listen.sumSince(monthKey), { short: true }))}</div></div>
      <div class="st-tile"><div class="st-tl">Since ${esc(sinceLabel)}</div><div class="st-tv">${esc(fmtListen(d.total, { short: true }))}</div></div>
    </div>`;
}

/* ----- Playlists ----- */
Views.playlists = async (page) => {
  page.kind = 'playlists';
  page.setTitle('Playlists');
  page.setActions(pillBtns([['new-playlist', I.plus, 'New Playlist'], ['sort', I.sort, 'Sort']]));
  page.pg.innerHTML = `<h1 class="ltitle">Playlists</h1><div style="height:9px"></div><div class="host">${SPIN}</div>`;
  const host = page.pg.querySelector('.host');
  const sorts = [['name', 'Title'], ['changed', 'Recently Updated'], ['created', 'Recently Added']];
  let data = [];
  const render = () => {
    const k = Settings.sort('playlists', 'name'), list = data.slice();
    if (k === 'name') list.sort((a, b) => collator.compare(a.name, b.name));
    else list.sort((a, b) => String(b[k] || '').localeCompare(String(a[k] || '')));
    host.innerHTML = list.length
      ? list.map((p) => `<button class="prow" data-act="playlist" data-id="${esc(p.id)}" data-press><div class="art list">${img(p.coverArt || p.id, 200)}</div><div class="txt"><div class="t1">${esc(p.name)}</div></div><span class="chev">${I.chevR}</span></button>`).join('')
      : '<div class="empty"><b>No Playlists</b>Tap + to make one.</div>';
  };
  page.handlers.sort = () => sortSheet('playlists', sorts, 'name', render);
  page.reload = async () => { try { data = await Lib.playlists(); render(); } catch (e) { toast(e.message, I.xmark, 'var(--red)'); } };
  data = await Lib.playlists();
  if (page.destroyed) return;
  render();
};

/* ----- Artists ----- */
Views.artists = async (page) => {
  page.kind = 'artists';
  page.setTitle('Artists');
  page.setActions(circleBtn('filter', I.sort, 'Filter'));
  page.pg.innerHTML = `<h1 class="ltitle">Artists</h1><div style="height:5px"></div><div class="host">${SPIN}</div>`;
  const host = page.pg.querySelector('.host');
  const groups = await Lib.artists();
  if (page.destroyed) return;
  let vl = null, idx = null, jumps = {};
  const render = () => {
    const fav = Settings.sort('artistsFilter', 'all') === 'starred';
    const items = [];
    for (const g of groups) {
      const list = fav ? g.artists.filter((a) => Lib.isStarred(a)) : g.artists;
      if (!list.length) continue;
      items.push({ h: g.name });
      list.forEach((a) => items.push({ a }));
    }
    if (vl) { vl.destroy(); vl = null; }
    host.innerHTML = '';
    if (!items.length) {
      host.innerHTML = `<div class="empty"><b>No Artists</b>${fav ? 'Artists you star show up here.' : 'Your library doesn’t have any artists yet.'}</div>`;
      if (idx) { idx.remove(); idx = null; }
      return;
    }
    vl = new VList(page, host, { items, height: (it) => (it.h != null ? 37 : 57), render: (it) => (it.h != null ? `<div class="lh">${esc(it.h)}</div>` : artistRow(it.a)) });
    jumps = letterJumpsMulti(items, (it) => (it.h != null ? headerLetters(it.h) : null));
    if (!idx) idx = makeIndex(page, (L) => { if (vl) vl.scrollToIndex(jumps[L]); });
  };
  page.handlers.filter = () => sortSheet('artistsFilter', [['all', 'All Artists'], ['starred', 'Favorites']], 'all', render);
  render();
};

/* ----- Albums ----- */
Views.albums = async (page, params) => {
  page.kind = 'albums';
  const title = params.title || 'Albums';
  page.setTitle(title);
  const fixed = params.sort;
  if (!fixed) page.setActions(circleBtn('sort', I.sort, 'Sort'));
  page.pg.innerHTML = `<h1 class="ltitle">${esc(title)}</h1><div style="height:15px"></div><div class="host">${SPIN}</div>`;
  const host = page.pg.querySelector('.host');
  const sorts = [['alphabeticalByName', 'Title'], ['alphabeticalByArtist', 'Artist'], ['newest', 'Recently Added'], ['recent', 'Recently Played'], ['frequent', 'Most Played']];
  let vl = null, idx = null, jumps = {}, loadSeq = 0;
  const rowH = () => { const cell = ((page.el.clientWidth || innerWidth) - 40 - 12) / 2; return cell + 7 + 34 + 18; };
  const load = async (type) => {
    const my = ++loadSeq;
    if (vl) { vl.destroy(); vl = null; }
    if (idx) { idx.remove(); idx = null; }
    host.style.height = ''; host.innerHTML = SPIN;
    let first = true;
    await Lib.albums(type, (list, done) => {
      if (my !== loadSeq || page.destroyed) return;
      const rows = [];
      for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
      if (first) { host.innerHTML = ''; first = false; }
      if (!rows.length) { if (done) host.innerHTML = '<div class="empty"><b>No Albums</b>Nothing to show here yet.</div>'; return; }
      if (!vl) vl = new VList(page, host, { items: rows, height: rowH, render: (r) => `<div class="grow">${r.map(albumTile).join('')}</div>` });
      else vl.setItems(rows);
      if (done && (type === 'alphabeticalByName' || type === 'alphabeticalByArtist')) {
        const field = type === 'alphabeticalByName' ? 'name' : 'artist';
        jumps = letterJumpsMulti(rows, (r) => r.map((a) => letterOf(sortKey(a[field]))));
        idx = makeIndex(page, (L) => { if (vl) vl.scrollToIndex(jumps[L]); });
      }
    });
  };
  page.handlers.sort = () => sortSheet('albums', sorts, 'alphabeticalByName', (v) => { load(v).catch((e) => page.showError(e, () => load(v))); });
  await load(fixed || Settings.sort('albums', 'alphabeticalByName'));
};

/* ----- Songs ----- */
function sortSongs(all, k) {
  const list = all.slice();
  if (k === 'artist') {
    for (const s of list) { s._k = sortKey(s.artist); s._L = letterOf(s._k); }
    list.sort((a, b) => cmpKeyed(a, b) || collator.compare(a.album, b.album) || (a.disc - b.disc) || (a.track - b.track));
  } else if (k === 'album') {
    list.sort((a, b) => collator.compare(sortKey(a.album), sortKey(b.album)) || (a.disc - b.disc) || (a.track - b.track));
  } else if (k === 'recent') {
    list.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  } else {
    keyed(list, 'title'); list.sort(cmpKeyed);
  }
  return list;
}
Views.songs = async (page) => {
  page.kind = 'songs';
  page.setTitle('Songs');
  page.setActions(circleBtn('sort', I.sort, 'Sort'));
  page.pg.innerHTML = `<h1 class="ltitle">Songs</h1>${playButtons()}<div class="host">${SPIN}<div class="loading-note"></div></div>`;
  const host = page.pg.querySelector('.host'), note = host.querySelector('.loading-note');
  const all = await Lib.allSongs((n, total) => {
    note.textContent = total ? `Loading ${n.toLocaleString()} of ${total.toLocaleString()} songs…` : `Loading ${n.toLocaleString()} songs…`;
  });
  if (page.destroyed) return;
  let vl = null, idx = null, jumps = {};
  const sorts = [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['recent', 'Recently Added']];
  const render = () => {
    const k = Settings.sort('songs', 'title'), list = sortSongs(all, k);
    if (vl) { vl.destroy(); vl = null; }
    if (idx) { idx.remove(); idx = null; }
    host.innerHTML = ''; host.style.height = '';
    const L = bindList(host, list, 'Songs');
    if (!list.length) { host.innerHTML = '<div class="empty"><b>No Songs</b>Your library looks empty.</div>'; return; }
    vl = new VList(page, host, { items: list, height: 57, render: L.render });
    if (k === 'title' || k === 'artist') {
      jumps = letterJumpsMulti(list, (s) => [s._L]);
      idx = makeIndex(page, (Lt) => { if (vl) vl.scrollToIndex(jumps[Lt]); });
    }
  };
  page.handlers['play-all'] = () => { const L = host._list; if (L) Player.playList(L.songs, 0, 'Songs'); };
  page.handlers['shuffle-all'] = () => { const L = host._list; if (L) Player.playShuffled(L.songs, 'Songs'); };
  page.handlers.sort = () => sortSheet('songs', sorts, 'title', render);
  render();
};

/* ----- Album ----- */
Views.album = async (page, { id }) => {
  page.kind = 'album'; page.kindId = id; page.inlineTitle = true;
  page.pg.innerHTML = SPIN;
  const a = await Lib.album(id);
  if (page.destroyed) return;
  page.setTitle(a.name);
  const starBtn = () => pillBtns([['star-album', Lib.isStarred(a) ? I.starFill : I.star, 'Favorite'], ['album-more', I.ellipsis, 'More']]);
  page.setActions(starBtn());
  if (Lib.isStarred(a)) page.actionsEl.querySelector('[data-act="star-album"]').classList.add('on');
  const discs = new Set(a.songs.map((s) => s.disc || 1)), multi = discs.size > 1;
  const showArtist = a.songs.some((s) => s.artist && a.artist && s.artist !== a.artist);
  const total = a.songs.reduce((t, s) => t + s.duration, 0);
  const meta = [a.genre, a.year || ''].filter(Boolean).join(' · ');
  let rows = '', lastDisc = null;
  const render = (s, i) => songRow(s, i, { track: true, showArtist: showArtist && s.artist !== a.artist });
  a.songs.forEach((s, i) => {
    if (multi && (s.disc || 1) !== lastDisc) { lastDisc = s.disc || 1; rows += `<div class="disc">Disc ${lastDisc}</div>`; }
    rows += render(s, i);
  });
  page.pg.innerHTML = `<div class="alhero"><div class="art">${img(a.coverArt, 900)}</div><h1 data-title-anchor>${esc(a.name)}</h1>`
    + (a.artist ? `<button class="aa" data-act="artist" data-id="${esc(a.artistId)}" data-name="${esc(a.artist)}">${esc(a.artist)}</button>` : '')
    + (meta ? `<div class="am">${esc(meta)}</div>` : '') + `</div>${a.songs.length ? playButtons() : ''}<div class="host">${rows}</div>`
    + `<div class="foot">${plural(a.songs.length, 'song')}, ${fmtTotal(total)}</div>`;
  bindList(page.pg.querySelector('.host'), a.songs, a.name, { render });
  page.handlers['play-all'] = () => Player.playList(a.songs, 0, a.name);
  page.handlers['shuffle-all'] = () => Player.playShuffled(a.songs, a.name);
  page.handlers['star-album'] = async (btn) => {
    try {
      const on = await Lib.toggleStar(a, 'album');
      btn.innerHTML = on ? I.starFill : I.star; btn.classList.toggle('on', on);
      toast(on ? 'Album Added to Favorites' : 'Album Removed from Favorites', on ? I.starFill : I.star);
    } catch (e) { toast(e.message, I.xmark, 'var(--red)'); }
  };
  page.handlers['album-more'] = () => UI.sheet({
    head: { art: a.coverArt, title: a.name, sub: a.artist },
    items: [
      { icon: I.playNext, color: 'var(--purple)', label: 'Play Next', run: () => queueMany(a.songs, 'next') },
      { icon: I.playLast, color: 'var(--orange)', label: 'Play Last', run: () => queueMany(a.songs, 'last') },
      { icon: I.shuffle, label: 'Shuffle', run: () => Player.playShuffled(a.songs, a.name) },
      { icon: I.listPlus, label: 'Add to a Playlist…', run: () => pickPlaylist(a.songs) },
    ].concat(a.artistId ? [{ icon: I.mic, label: 'Go to Artist', run: () => Nav.push('artist', { id: a.artistId, name: a.artist }) }] : []),
  });
};
function queueMany(songs, act) {
  if (!songs.length) return;
  if (!Player.cur) { Player.playList(songs, 0, songs[0].album || 'Queue'); return; }
  if (act === 'next') Player.upNext.unshift(...songs); else Player.upNext.push(...songs);
  Player.emit('queue'); Player.save();
  toast(act === 'next' ? 'Playing Next' : 'Playing Last', act === 'next' ? I.playNext : I.playLast, act === 'next' ? 'var(--purple)' : 'var(--orange)');
}

/* ----- Artist ----- */
Views.artist = async (page, { id, name }) => {
  page.kind = 'artist'; page.kindId = id; page.inlineTitle = true;
  page.setTitle(name || '');
  page.pg.innerHTML = SPIN;
  const a = await Lib.artist(id);
  if (page.destroyed) return;
  page.setTitle(a.name);
  page.setActions(pillBtns([['star-artist', Lib.isStarred(a) ? I.starFill : I.star, 'Favorite'], ['artist-more', I.ellipsis, 'More']]));
  if (Lib.isStarred(a)) page.actionsEl.querySelector('[data-act="star-artist"]').classList.add('on');
  const albums = a.albums.slice().sort((x, y) => (y.year || 0) - (x.year || 0) || collator.compare(x.name, y.name));
  const heroId = a.coverArt || (albums[0] && albums[0].coverArt) || '';
  const heroUrl = heroId ? api.cover(heroId, 900) : '';
  page.pg.innerHTML = `<div class="ahero${heroUrl ? '' : ' noimg'}">${heroUrl ? `<img src="${esc(heroUrl)}" alt="" draggable="false">` : ''}<h1 data-title-anchor>${esc(a.name)}</h1><button class="aplay" data-act="artist-play" aria-label="Play ${esc(a.name)}">${I.play}</button></div>`
    + `<div class="sec-h">Albums</div>` + (albums.length ? `<div class="grid">${albums.map(albumTile).join('')}</div>` : '<div class="empty">No albums.</div>');
  const songs = async () => (await Lib.artistSongs(id)).songs;
  page.handlers['artist-play'] = async () => { const s = await songs(); Player.playList(s, 0, a.name); };
  page.handlers['star-artist'] = async (btn) => {
    try {
      const on = await Lib.toggleStar(a, 'artist');
      btn.innerHTML = on ? I.starFill : I.star; btn.classList.toggle('on', on);
      toast(on ? 'Artist Added to Favorites' : 'Artist Removed from Favorites', on ? I.starFill : I.star);
    } catch (e) { toast(e.message, I.xmark, 'var(--red)'); }
  };
  page.handlers['artist-more'] = () => UI.sheet({
    head: { art: heroId, title: a.name, sub: plural(albums.length, 'album'), round: true },
    items: [
      { icon: I.shuffle, label: 'Shuffle', run: async () => Player.playShuffled(await songs(), a.name) },
      { icon: I.playNext, color: 'var(--purple)', label: 'Play Next', run: async () => queueMany(await songs(), 'next') },
      { icon: I.playLast, color: 'var(--orange)', label: 'Play Last', run: async () => queueMany(await songs(), 'last') },
    ],
  });
};

/* ----- Playlist ----- */
Views.playlist = async (page, { id }) => {
  page.kind = 'playlist'; page.kindId = id; page.inlineTitle = true;
  page.setActions(circleBtn('pl-more', I.ellipsis, 'More'));
  let data = null;
  const load = async () => {
    page.vlists.slice().forEach((v) => v.destroy());
    page.pg.innerHTML = SPIN;
    const p = data = await Lib.playlist(id);
    if (page.destroyed) return;
    page.setTitle(p.name);
    const total = p.songs.reduce((t, s) => t + s.duration, 0);
    page.pg.innerHTML = `<div class="alhero"><div class="art list">${img(p.coverArt || p.id, 900)}</div><h1 data-title-anchor>${esc(p.name)}</h1>`
      + (p.comment ? `<p class="desc">${esc(p.comment)}</p>` : '') + `<div class="am">${plural(p.songs.length, 'song')}</div></div>`
      + (p.songs.length ? playButtons() : '') + '<div class="host"></div>'
      + (p.songs.length ? `<div class="foot">${plural(p.songs.length, 'song')}, ${fmtTotal(total)}</div>` : '');
    const host = page.pg.querySelector('.host');
    const L = bindList(host, p.songs, p.name, { playlistId: p.id });
    if (!p.songs.length) host.innerHTML = '<div class="empty"><b>No Songs Yet</b>Open a song’s ••• menu and choose Add to a Playlist.</div>';
    else if (p.songs.length > 250) new VList(page, host, { items: p.songs, height: 57, render: L.render });
    else host.innerHTML = p.songs.map((s, i) => L.render(s, i)).join('');
    requestAnimationFrame(() => page.onScroll());
  };
  page.handlers['play-all'] = () => data && Player.playList(data.songs, 0, data.name);
  page.handlers['shuffle-all'] = () => data && Player.playShuffled(data.songs, data.name);
  page.handlers['pl-more'] = () => {
    if (!data) return;
    const p = data;
    UI.sheet({
      head: { art: p.coverArt || p.id, title: p.name, sub: plural(p.songs.length, 'song'), list: true },
      items: [
        { icon: I.playNext, color: 'var(--purple)', label: 'Play Next', run: () => queueMany(p.songs, 'next') },
        { icon: I.playLast, color: 'var(--orange)', label: 'Play Last', run: () => queueMany(p.songs, 'last') },
        { icon: I.listPlus, label: 'Rename…', run: async () => {
          const name = await UI.prompt({ title: 'Rename Playlist', value: p.name, ok: 'Save' });
          if (!name || name === p.name) return;
          try { await api.get('updatePlaylist', { playlistId: p.id, name }); Lib.invalidate('playlists'); refreshPages('playlists'); load(); } catch (e) { toast(e.message, I.xmark, 'var(--red)'); }
        } },
        { icon: I.trash, label: 'Delete Playlist', red: true, run: async () => {
          const ok = await UI.confirm({ title: `Delete “${p.name}”?`, message: 'This removes the playlist from your server. The songs stay in your library.', ok: 'Delete', red: true });
          if (!ok) return;
          try { await api.get('deletePlaylist', { id: p.id }); Lib.invalidate('playlists'); refreshPages('playlists'); toast('Playlist Deleted', I.trash, 'var(--red)'); if (Nav.top() === page) Nav.pop(); } catch (e) { toast(e.message, I.xmark, 'var(--red)'); }
        } },
      ],
    });
  };
  page.reload = () => load().catch((e) => page.showError(e, page.reload));
  await load();
};

/* ----- Search ----- */
Views.search = (page) => {
  page.kind = 'search';
  page.setTitle('Search');
  page.pg.innerHTML = `<h1 class="ltitle">Search</h1><div class="sbar"><label class="sfield glass">${I.search}<input type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Artists, Albums, Songs" aria-label="Search your library"><button class="sclear" data-act="s-clear" aria-label="Clear search" hidden>${I.xfill}</button></label></div><div class="sres"></div>`;
  const input = page.input = page.pg.querySelector('input'), clear = page.pg.querySelector('.sclear'), res = page.pg.querySelector('.sres');
  let timer = 0, seq = 0, lastQ = '';
  const recents = () => store.get('recentSearches', []);
  const remember = (q) => { if (!q) return; store.set('recentSearches', [q].concat(recents().filter((x) => x.toLowerCase() !== q.toLowerCase())).slice(0, 12)); };
  const showRecents = () => {
    const r = recents();
    res.innerHTML = r.length
      ? `<div class="sec-h">Recently Searched<button class="lnk" data-act="s-forget">Clear</button></div>${r.map((q) => `<button class="recent" data-act="s-recent" data-q="${esc(q)}">${esc(q)}</button>`).join('')}`
      : '<div class="empty">Search your artists, albums and songs.</div>';
  };
  const run = async (q) => {
    const my = ++seq; lastQ = q;
    if (!q) { showRecents(); return; }
    res.innerHTML = SPIN;
    try {
      const r = await Lib.search(q);
      if (my !== seq) return;
      let html = '';
      if (r.artists.length) html += '<div class="sec-h">Artists</div>' + r.artists.map((a) => `<button class="xrow" data-act="artist" data-id="${esc(a.id)}" data-name="${esc(a.name)}" data-press><div class="art round mic">${img(a.coverArt || ('ar-' + a.id), 150)}</div><div class="txt"><div class="t1">${esc(a.name)}</div><div class="t2">Artist</div></div><span class="chev">${I.chevR}</span></button>`).join('');
      if (r.albums.length) html += '<div class="sec-h">Albums</div>' + r.albums.map((a) => `<button class="xrow" data-act="album" data-id="${esc(a.id)}" data-press><div class="art">${img(a.coverArt, 150)}</div><div class="txt"><div class="t1">${esc(a.name)}</div><div class="t2">Album · ${esc(a.artist)}</div></div><span class="chev">${I.chevR}</span></button>`).join('');
      if (r.songs.length) html += '<div class="sec-h">Songs</div><div class="songs"></div>';
      if (!html) html = `<div class="empty"><b>No Results</b>Nothing in your library matches “${esc(q)}”.</div>`;
      res.innerHTML = html;
      const box = res.querySelector('.songs');
      if (box) {
        const L = bindList(box, r.songs, q, { render: (s, i) => songRow(s, i, { sub: (x) => 'Song · ' + x.artist }) });
        box.innerHTML = r.songs.map((s, i) => L.render(s, i)).join('');
      }
    } catch (err) {
      if (my === seq) res.innerHTML = `<div class="empty"><b>Couldn’t Search</b>${esc(err.message)}</div>`;
    }
  };
  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value.trim()), 250);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { input.blur(); remember(input.value.trim()); } });
  res.addEventListener('click', (e) => { if (lastQ && e.target.closest('.xrow, .srow')) remember(lastQ); });
  page.scroller.addEventListener('touchmove', () => { if (document.activeElement === input) input.blur(); }, { passive: true });
  page.handlers['s-clear'] = () => { input.value = ''; clear.hidden = true; run(''); input.focus(); };
  page.handlers['s-forget'] = () => { store.del('recentSearches'); showRecents(); };
  page.handlers['s-recent'] = (el) => { input.value = el.dataset.q; clear.hidden = false; run(el.dataset.q); remember(el.dataset.q); };
  showRecents();
};

/* ----- Radio ----- */
Views.radio = async (page) => {
  page.kind = 'radio';
  page.setTitle('Radio');
  page.pg.innerHTML = `<h1 class="ltitle">Radio</h1><div class="sec-h">Mixes</div>
    <div class="mixes">
      <button class="mix" data-act="mix-all" style="--g:linear-gradient(150deg,#f0545e,#a51d4a)" data-press>${I.shuffleAll}<div><b>Shuffle All</b><span>Random songs from your whole library</span></div></button>
      <button class="mix" data-act="mix-fav" style="--g:linear-gradient(150deg,#8b8ff9,#3d33c2)" data-press>${I.starFill}<div><b>Favorites Mix</b><span>Your starred songs, shuffled</span></div></button>
    </div>
    <div class="sec-h">Stations</div><div class="stations">${SPIN}</div>`;
  page.handlers['mix-all'] = async () => {
    try { const s = await Lib.randomSongs(200); if (!s.length) { toast('Your library is empty', I.xmark, 'var(--red)'); return; } Player.playList(s, 0, 'Shuffle All'); NP.open(); }
    catch (e) { toast(e.message, I.xmark, 'var(--red)'); }
  };
  page.handlers['mix-fav'] = async () => {
    try { const s = await Lib.starredSongs(); if (!s.length) { toast('Star a few songs first', I.star); return; } Player.playShuffled(s, 'Favorites Mix'); NP.open(); }
    catch (e) { toast(e.message, I.xmark, 'var(--red)'); }
  };
  const box = page.pg.querySelector('.stations');
  let st = [];
  try { st = await Lib.stations(); } catch (e) { box.innerHTML = `<div class="empty" style="padding-top:20px">${esc(e.message)}</div>`; return; }
  if (page.destroyed) return;
  box.innerHTML = st.length
    ? st.map((s, i) => { let host = ''; try { host = s.homePageUrl ? new URL(s.homePageUrl).host : ''; } catch (e) { /* ignore */ } return `<button class="xrow" data-act="station" data-i="${i}" data-press><div class="art radio"></div><div class="txt"><div class="t1">${esc(s.name)}</div><div class="t2">${esc(host || 'Internet Radio')}</div></div><span class="live">LIVE</span></button>`; }).join('')
    : '<div class="empty" style="padding-top:20px">No stations yet. Add internet radio stations in Navidrome’s web app (under Radios) and they’ll show up here.</div>';
  page.handlers.station = (el) => { const s = st[+el.dataset.i]; if (s) { Player.playRadio(s); NP.open(); } };
};

/* ---------- rows ---------- */
const EQ = '<div class="eq"><i></i><i></i><i></i><i></i></div>';
function img(id, size) {
  const u = id && api ? api.cover(id, size) : '';
  return u ? `<img src="${esc(u)}" alt="" loading="lazy" decoding="async" draggable="false">` : '';
}
function songRow(s, i, opts = {}) {
  const playing = !!(Player.cur && Player.cur.id === s.id);
  const star = Lib.isStarred(s) ? `<span class="smark">${I.starFill}</span>` : '';
  const more = `<button class="more" data-act="song-more" aria-label="More options">${I.ellipsis}</button>`;
  if (opts.track) {
    const sub = opts.showArtist && s.artist ? `<div class="t2">${esc(s.artist)}</div>` : '';
    return `<div class="srow trk${playing ? ' playing' : ''}" data-i="${i}" data-id="${esc(s.id)}" data-press><div class="row-c">${star}<div class="num" data-n="${s.track || ''}">${playing ? EQ : (s.track || '')}</div><div class="txt"><div class="t1">${esc(s.title)}</div>${sub}</div>${more}</div></div>`;
  }
  const sub = opts.sub ? opts.sub(s) : s.artist;
  return `<div class="srow${playing ? ' playing' : ''}" data-i="${i}" data-id="${esc(s.id)}" data-press><div class="row-c">${star}<div class="art">${img(s.coverArt, 150)}${playing ? EQ : ''}</div><div class="txt"><div class="t1">${esc(s.title)}</div><div class="t2">${esc(sub)}</div></div>${more}</div></div>`;
}
/* attach the song list behind a container so taps, swipes and menus can find the song */
function bindList(host, songs, title, extra = {}) {
  host.setAttribute('data-list', '');
  host._list = Object.assign({ songs, title, render: (s, i) => songRow(s, i) }, extra);
  return host._list;
}
function songForRow(row) {
  if (!row) return null;
  if (row.classList.contains('qrow')) return NP.songFor(row);
  const host = row.closest('[data-list]');
  return host && host._list ? host._list.songs[+row.dataset.i] : null;
}
function refreshPlaying() {
  const id = Player.cur ? Player.cur.id : null;
  $$('.srow.playing').forEach((r) => {
    if (r.dataset.id === id) return;
    r.classList.remove('playing');
    const eq = r.querySelector('.eq'); if (eq) eq.remove();
    const num = r.querySelector('.num'); if (num) num.textContent = num.dataset.n || '';
  });
  if (!id) return;
  $$(`.srow[data-id="${CSS.escape(id)}"]`).forEach((r) => {
    if (r.classList.contains('playing')) return;
    r.classList.add('playing');
    const num = r.querySelector('.num');
    if (num) num.innerHTML = EQ;
    else { const art = r.querySelector('.art'); if (art) art.insertAdjacentHTML('beforeend', EQ); }
  });
}
function refreshSongRows(id) {
  $$(`.srow[data-id="${CSS.escape(id)}"]`).forEach((row) => {
    if (row._sw) return;
    const host = row.closest('[data-list]'), L = host && host._list;
    if (!L || !L.render) return;
    const i = +row.dataset.i, el = htmlEl(L.render(L.songs[i], i));
    if (row.classList.contains('vi')) {
      el.classList.add('vi'); el.style.top = row.style.top;
      const page = pageFromEl(host), vl = page && page.vlists.find((v) => v.host === host);
      if (vl) vl.nodes.set(i, el);
    }
    row.replaceWith(el);
  });
}

/* ---------- tap feedback ---------- */
let suppressUntil = 0;
function suppressClicks(ms) { suppressUntil = Math.max(suppressUntil, performance.now() + ms); }
const Press = {
  el: null, t: 0, x: 0, y: 0,
  init() {
    document.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-press]');
      if (!el || e.target.closest('.more, .sw-b, .grip')) return;
      this.cancel();
      this.el = el; this.x = e.clientX; this.y = e.clientY;
      this.t = setTimeout(() => { if (this.el === el) el.classList.add('pressed'); }, 75);
    }, { passive: true });
    document.addEventListener('pointermove', (e) => {
      if (this.el && (Math.abs(e.clientX - this.x) > 7 || Math.abs(e.clientY - this.y) > 7)) this.cancel();
    }, { passive: true });
    document.addEventListener('pointerup', () => {
      const el = this.el;
      if (!el) return;
      clearTimeout(this.t); this.el = null;
      el.classList.add('pressed');
      setTimeout(() => el.classList.remove('pressed'), 150);
    }, { passive: true });
    document.addEventListener('pointercancel', () => this.cancel(), { passive: true });
    document.addEventListener('scroll', () => this.cancel(), { capture: true, passive: true });
  },
  cancel() { clearTimeout(this.t); if (this.el) this.el.classList.remove('pressed'); this.el = null; },
};

/* ---------- swipe a song right: purple = Play Next, orange = Play Last ---------- */
const Swipe = {
  st: null, openRow: null, openSt: null,
  init() {
    document.addEventListener('pointerdown', (e) => this.down(e), { passive: true });
    document.addEventListener('pointermove', (e) => this.move(e), { passive: true });
    document.addEventListener('pointerup', (e) => this.up(e, false), { passive: true });
    document.addEventListener('pointercancel', (e) => this.up(e, true), { passive: true });
  },
  config(row) {
    if (row.classList.contains('qrow')) return { dir: -1, acts: [{ id: 'remove', label: 'Remove', color: 'var(--red)', icon: I.trash }] };
    const next = { id: 'next', label: 'Play Next', color: 'var(--purple)', icon: I.playNext };
    const last = { id: 'last', label: 'Play Last', color: 'var(--orange)', icon: I.playLast };
    /* orange appears once you've queued something, so you can line songs up behind it */
    return { dir: 1, acts: Player.cur && Player.upNext.length ? [last, next] : [next] };
  },
  down(e) {
    if (!e.isPrimary || e.button > 0 || e.target.closest('.sw-b')) return;
    const row = e.target.closest('.srow, .qrow');
    if (this.openRow && row !== this.openRow) { this.close(); suppressClicks(350); return; }
    if (!row || e.target.closest('.grip')) return;
    if (row.classList.contains('srow') && e.clientX < 24) return;
    const now = performance.now();
    this.st = { row, id: e.pointerId, x0: e.clientX, y0: e.clientY, decided: false, active: false, base: row === this.openRow ? this.openSt.off : 0, lx: e.clientX, lt: now, v: 0, off: 0 };
  },
  move(e) {
    const s = this.st;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    if (!s.decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.decided = true;
      const cfg = s.base ? this.openSt.cfg : this.config(s.row);
      if (!(Math.abs(dx) > Math.abs(dy) * 1.15) || (!s.base && Math.sign(dx) !== cfg.dir)) { this.st = null; return; }
      s.cfg = cfg; s.active = true;
      this.begin(s);
    }
    if (!s.active) return;
    const now = performance.now();
    s.v = (e.clientX - s.lx) / Math.max(1, now - s.lt); s.lx = e.clientX; s.lt = now;
    this.layout(s, s.base + dx * s.cfg.dir);
  },
  begin(s) {
    Press.cancel(); LongPress.cancel(); suppressClicks(450);
    const row = s.row;
    if (row === this.openRow) {
      const o = this.openSt;
      Object.assign(s, { btns: o.btns, actsEl: o.actsEl, content: o.content, R: o.R, T: o.T, w: o.w, prevRow: o.prevRow, song: o.song });
      o.dead = true;
      this.openRow = null; this.openSt = null;
      row.classList.remove('open');
    } else {
      if (row._sw) this.cleanup(row._sw, true);
      const dir = s.cfg.dir;
      s.actsEl = htmlEl(`<div class="sw-acts">${s.cfg.acts.map((a) => `<button class="sw-b${dir < 0 ? ' trail' : ''}" data-sw="${a.id}" style="--c:${a.color}" aria-label="${esc(a.label)}">${a.icon}</button>`).join('')}</div>`);
      row.prepend(s.actsEl);
      s.btns = Array.from(s.actsEl.children);
      s.content = row.querySelector('.row-c');
      s.w = row.clientWidth || innerWidth;
      s.R = 10 + s.cfg.acts.length * 70;
      s.T = Math.max(s.R + 85, s.w * 0.55);
      s.prevRow = this.rowAbove(row);
      if (s.prevRow) s.prevRow.classList.add('sep-hide');
    }
    s.song = songForRow(row);
    row._sw = s;
    row.classList.add('swiping');
    s.content.style.transition = 'background-color .2s, border-radius .2s';
    s.btns.forEach((b) => { b.style.transition = 'width .22s var(--spring-soft), left .22s var(--spring-soft), opacity .15s'; });
    try { row.setPointerCapture(s.id); } catch (err) { /* ignore */ }
  },
  rowAbove(row) {
    if (row.classList.contains('vi')) return row.parentElement.querySelector(`:scope > [data-i="${+row.dataset.i - 1}"]`);
    const p = row.previousElementSibling;
    return p && (p.classList.contains('srow') || p.classList.contains('qrow')) ? p : null;
  },
  layout(s, reveal) {
    let off = reveal;
    if (off < 0) off *= 0.25;
    off = Math.min(off, s.w - 30);
    s.off = off;
    const dir = s.cfg.dir, p = clamp(off / s.R, 0, 1), armed = off > s.T;
    s.armed = armed;
    s.btns.forEach((b, i) => {
      if (armed) {
        if (i === 0) { b.style.width = Math.max(60, off - 20) + 'px'; b.style.transform = 'none'; b.style.opacity = '1'; }
        else { b.style.transform = `translateX(${i * 70 * dir}px) scale(.4)`; b.style.opacity = '0'; }
        return;
      }
      b.style.width = '';
      const c = (40 + i * 70) * p;
      b.style.transform = `translateX(${(c - 40) * dir}px) scale(${0.45 + 0.55 * p})`;
      b.style.opacity = String(clamp(p * 1.5 - i * 0.25, 0, 1));
    });
    s.content.style.transform = `translate3d(${off * dir}px,0,0)`;
  },
  up(e, cancelled) {
    const s = this.st;
    if (!s || e.pointerId !== s.id) return;
    this.st = null;
    if (!s.active) {
      if (!s.decided && s.row === this.openRow && !cancelled) { this.close(); suppressClicks(350); }
      return;
    }
    const v = s.v * s.cfg.dir;
    if (!cancelled && s.armed) {
      if (!s.fired) { s.fired = true; this.perform(s, s.cfg.acts[0].id); }
      this.animateTo(s, 0, () => this.cleanup(s));
      return;
    }
    if (!cancelled && (s.off > s.R * 0.55 || (v > 0.35 && s.off > 25))) {
      s.row.classList.add('open'); s.row.classList.remove('swiping');
      this.openRow = s.row; this.openSt = s;
      this.animateTo(s, s.R);
      return;
    }
    this.animateTo(s, 0, () => this.cleanup(s));
  },
  animateTo(s, target, done) {
    const { easing, duration } = SP.snap;
    s.content.style.transition = `transform ${duration}ms ${easing}, background-color .25s, border-radius .25s`;
    s.btns.forEach((b) => { b.style.transition = `transform ${duration}ms ${easing}, opacity .2s, width .25s var(--spring-soft)`; });
    this.layout(s, target);
    clearTimeout(s.timer);
    if (done) s.timer = setTimeout(done, duration);
  },
  cleanup(s, immediate) {
    if (s.dead) return;
    s.dead = true; clearTimeout(s.timer);
    const row = s.row;
    if (row._sw === s) row._sw = null;
    if (s.actsEl) s.actsEl.remove();
    row.classList.remove('swiping', 'open');
    if (s.content) {
      if (immediate) s.content.style.transition = 'none';
      s.content.style.transform = '';
      if (immediate) void s.content.offsetWidth;
      s.content.style.transition = '';
    }
    if (s.prevRow) s.prevRow.classList.remove('sep-hide');
    if (this.openSt === s) { this.openRow = null; this.openSt = null; }
    if (row.classList.contains('qrow')) NP.flushQueue();
  },
  close(immediate) {
    const s = this.openSt;
    if (!s) return;
    this.openRow = null; this.openSt = null;
    s.row.classList.remove('open'); s.row.classList.add('swiping');
    if (immediate) this.cleanup(s, true); else this.animateTo(s, 0, () => this.cleanup(s));
  },
  tapAction(btn) {
    const row = btn.closest('.srow, .qrow'), s = row && row._sw;
    if (!s || s.fired) return;
    s.fired = true;
    this.perform(s, btn.dataset.sw);
    if (this.openSt === s) { this.openRow = null; this.openSt = null; }
    row.classList.remove('open'); row.classList.add('swiping');
    this.animateTo(s, 0, () => this.cleanup(s));
  },
  perform(s, act) {
    if (act === 'remove') { NP.removeRow(s.row, s.song); return; }
    if (s.song) queueSong(s.song, act);
  },
};
function queueSong(song, act) {
  const r = act === 'last' ? Player.playLast(song) : Player.playNext(song);
  if (r === 'started') toast('Playing', I.play, 'var(--accent)');
  else if (act === 'last') toast('Playing Last', I.playLast, 'var(--orange)');
  else toast('Playing Next', I.playNext, 'var(--purple)');
}

/* ---------- long-press a song for its menu ---------- */
const LongPress = {
  t: 0, x: 0, y: 0,
  init() {
    document.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('.srow');
      if (!e.isPrimary || !row || e.target.closest('.more, .sw-b') || e.button > 0) return;
      this.cancel();
      this.x = e.clientX; this.y = e.clientY;
      this.t = setTimeout(() => {
        this.t = 0;
        if ((Swipe.st && Swipe.st.active) || row._sw) return;
        Press.cancel(); this.fired = true; suppressClicks(5000);
        const s = songForRow(row);
        if (s) songMenu(s, listCtx(row));
      }, 520);
    }, { passive: true });
    document.addEventListener('pointermove', (e) => {
      if (this.t && (Math.abs(e.clientX - this.x) > 8 || Math.abs(e.clientY - this.y) > 8)) this.cancel();
    }, { passive: true });
    document.addEventListener('pointerup', () => {
      this.cancel();
      /* swallow only the click that ends the long press, so the menu is usable right away */
      if (this.fired) { this.fired = false; suppressUntil = performance.now() + 120; }
    }, { passive: true });
    document.addEventListener('pointercancel', () => { this.cancel(); if (this.fired) { this.fired = false; suppressUntil = performance.now() + 120; } }, { passive: true });
    document.addEventListener('contextmenu', (e) => { if (e.target.closest('.srow, .qrow, .gi, img')) e.preventDefault(); });
  },
  cancel() { clearTimeout(this.t); this.t = 0; },
};

/* ---------- song menu & playlist helpers ---------- */
function listCtx(row) {
  const host = row && row.closest('[data-list]'), L = host && host._list;
  if (!L || L.playlistId == null) return {};
  const i = +row.dataset.i;
  return { playlistId: L.playlistId, index: i, songId: L.songs[i] && L.songs[i].id, page: pageFromEl(host) };
}
function songMenu(song, ctx = {}) {
  if (!song || song.isRadio) return;
  const starred = Lib.isStarred(song);
  const items = [
    { icon: I.playNext, color: 'var(--purple)', label: 'Play Next', run: () => queueSong(song, 'next') },
    { icon: I.playLast, color: 'var(--orange)', label: 'Play Last', run: () => queueSong(song, 'last') },
    { icon: I.listPlus, label: 'Add to a Playlist…', run: () => pickPlaylist([song]) },
    { icon: starred ? I.starFill : I.star, color: starred ? 'var(--accent)' : '', label: starred ? 'Remove from Favorites' : 'Add to Favorites', run: () => toggleSongStar(song) },
  ].concat(LyView.menuItems(song));
  if (song.albumId) items.push({ icon: I.album, label: 'Go to Album', run: () => Nav.push('album', { id: song.albumId }) });
  if (song.artistId) items.push({ icon: I.mic, label: 'Go to Artist', run: () => Nav.push('artist', { id: song.artistId, name: song.artist }) });
  if (ctx.playlistId != null) items.push({ icon: I.minus, label: 'Remove from This Playlist', red: true, run: () => removeFromPlaylist(ctx) });
  UI.sheet({
    head: { art: song.coverArt, title: song.title, sub: [song.artist, song.album].filter(Boolean).join(' · '), extra: typeof song.playCount === 'number' ? playLine(song) : '' },
    items,
    /* the list may be a few minutes old: ask the server for this song's latest count */
    onOpen: (sh) => {
      Lib.getSong(song.id).then((fresh) => {
        const line = sh.querySelector('.sh-head .t3');
        if (line && fresh && fresh.id === song.id) line.textContent = playLine(fresh);
      }, () => {});
    },
  });
}
function playLine(s) {
  if (!s.playCount) return 'Not played yet';
  return `Played ${s.playCount === 1 ? 'once' : `${s.playCount.toLocaleString()} times`}${s.played ? ` · last ${fmtAgo(s.played)}` : ''}`;
}
async function toggleSongStar(song) {
  try {
    const on = await Lib.toggleStar(song, 'song');
    toast(on ? 'Added to Favorites' : 'Removed from Favorites', on ? I.starFill : I.star, on ? 'var(--accent)' : 'var(--fg3)');
    refreshSongRows(song.id);
    NP.renderStar();
  } catch (e) { toast(e.message, I.xmark, 'var(--red)'); }
}
async function addToPlaylist(p, songs) {
  try {
    await api.get('updatePlaylist', { playlistId: p.id, songIdToAdd: songs.map((s) => s.id) });
    Lib.invalidate('playlists');
    toast(songs.length > 1 ? `Added ${plural(songs.length, 'song')} to ${p.name}` : `Added to ${p.name}`, I.check);
    refreshPages('playlist', p.id);
    return true;
  } catch (e) { toast(e.message, I.xmark, 'var(--red)'); return false; }
}
async function newPlaylist(songs = []) {
  const message = songs.length > 1 ? `With ${plural(songs.length, 'song')}` : songs.length ? `With “${songs[0].title}”` : '';
  const name = await UI.prompt({ title: 'New Playlist', message, placeholder: 'Playlist name', ok: 'Create' });
  if (!name) return false;
  try {
    const res = await api.get('createPlaylist', { name, songId: songs.map((s) => s.id) });
    Lib.invalidate('playlists');
    toast(songs.length ? `Added to ${name}` : `Created “${name}”`, I.check);
    refreshPages('playlists');
    if (!songs.length && res.playlist && res.playlist.id) Nav.push('playlist', { id: res.playlist.id });
    return true;
  } catch (e) { toast(e.message, I.xmark, 'var(--red)'); return false; }
}
async function removeFromPlaylist(ctx) {
  try {
    /* the playlist may have changed elsewhere since this page loaded: confirm the position first */
    const fresh = await Lib.playlist(ctx.playlistId);
    let i = ctx.index;
    if (!fresh.songs[i] || fresh.songs[i].id !== ctx.songId) i = fresh.songs.findIndex((s) => s.id === ctx.songId);
    if (i < 0) { refreshPages('playlist', ctx.playlistId); return; }
    await api.get('updatePlaylist', { playlistId: ctx.playlistId, songIndexToRemove: i });
    Lib.invalidate('playlists');
    toast('Removed from Playlist', I.minus, 'var(--red)');
    refreshPages('playlist', ctx.playlistId);
  } catch (e) { toast(e.message, I.xmark, 'var(--red)'); }
}
function refreshPages(kind, id) {
  Nav.allPages().forEach((p) => { if (p.kind === kind && (id == null || p.kindId === id) && p.reload) p.reload(); });
}
function sortSheet(name, options, def, onPick) {
  const cur = Settings.sort(name, def);
  UI.sheet({ title: 'Sort By', items: options.map(([v, label]) => ({ label, checked: v === cur, run: () => { if (v !== cur) { Settings.setSort(name, v); onPick(v); } } })) });
}

/* ---------- Add to Playlist ----------
   A full sheet like Apple Music's: find a playlist by name, the most recently updated ones on top,
   then every playlist you can add to. Each one says when the song is already in it, and choosing
   such a playlist asks before adding the song a second time. */

/* the song IDs in each playlist, kept until Navidrome reports that the playlist changed */
const PlaylistSongs = {
  cache: new Map(),
  get(p) {
    const stamp = `${p.changed}|${p.songCount}`;
    const hit = this.cache.get(p.id);
    if (hit && hit.stamp === stamp) return hit.ids;
    const ids = Lib.playlist(p.id).then((full) => new Set(full.songs.map((s) => s.id)));
    this.cache.set(p.id, { stamp, ids });
    ids.catch(() => { const c = this.cache.get(p.id); if (c && c.ids === ids) this.cache.delete(p.id); });
    return ids;
  },
  /* Encore is adding these songs right now: count them as in the playlist straight away, so the
     sheet is right even if it's opened again before the server has finished saving */
  noteAdded(id, songIds) {
    const c = this.cache.get(id);
    if (c) c.ids = c.ids.then((set) => { songIds.forEach((x) => set.add(x)); return set; });
  },
  forget(id) { this.cache.delete(id); },
  clear() { this.cache.clear(); },
};

const PICK_SORTS = [['name', 'Title'], ['changed', 'Recently Updated'], ['created', 'Recently Added']];
const foldText = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/* Navidrome's times can have up to 9 decimals; trimmed to 3 so every browser reads them */
const playlistTime = (p, k) => Date.parse(String(p[k] || '').replace(/(\.\d{3})\d+/, '$1')) || 0;

/* the line under a playlist's name: n of the songs being added are in it already */
function alreadyLine(n, total) {
  if (!n) return '';
  if (total === 1) return 'Song already in playlist';
  return n === total ? 'All songs already in playlist' : `${n} of ${total} songs already in playlist`;
}

/* what to add when some of the songs are in the playlist already: 'all', 'new' (only the others), or null */
function askAlreadyIn(p, songs, have) {
  const title = `Already in “${p.name}”`;
  if (songs.length === 1) {
    return UI.dialog({ title, message: `“${songs[0].title}” is already in this playlist. Add it again?`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Add Again', value: 'all', primary: true }] });
  }
  if (have === songs.length) {
    return UI.dialog({ title, message: `All ${songs.length} songs are already in this playlist. Add them again?`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Add Again', value: 'all', primary: true }] });
  }
  const others = songs.length - have;
  return UI.dialog({ title, message: `${have} of these ${songs.length} songs are already in this playlist.`, stacked: true,
    buttons: [{ label: `Add the Other ${others}`, value: 'new', primary: true }, { label: `Add All ${songs.length}`, value: 'all' }, { label: 'Cancel', value: null }] });
}

/* the playlist's songs couldn't be loaded, so whether these are in it is unknown: ask instead of guessing */
function askUnchecked(p, songs) {
  return UI.dialog({ title: `Couldn’t Check “${p.name}”`,
    message: `Encore couldn’t load this playlist to see whether ${songs.length === 1 ? 'this song is' : 'these songs are'} already in it. Add anyway?`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Add', value: 'all', primary: true }] });
}

async function pickPlaylist(songs) {
  songs = (songs || []).filter((s) => s && s.id && !s.isRadio);
  if (!songs.length) return;
  const ids = songs.map((s) => s.id);
  const m = htmlEl(`<div class="modal pk"><div class="bd"></div><div class="card" role="dialog" aria-modal="true" aria-label="Add to Playlist">
    <div class="m-nav pk-nav"><button class="nb glass pk-x" aria-label="Close">${I.xmark}</button>Add to Playlist<button class="nb glass pk-sort" aria-label="Sort">${I.sort}</button></div>
    <div class="pk-find"><label class="sfield">${I.search}<input type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Find in Playlists" aria-label="Find in Playlists"><button class="sclear" aria-label="Clear" hidden>${I.xfill}</button></label></div>
    <div class="pk-body">${SPIN}</div>
    <button class="pk-new glass" aria-label="New Playlist">${I.plus}</button>
  </div></div>`);
  const body = m.querySelector('.pk-body'), input = m.querySelector('input'), clearBtn = m.querySelector('.sclear');
  UI.layer().appendChild(m);
  void m.offsetWidth;
  m.classList.add('in'); m.querySelector('.bd').classList.add('in');

  /* the sheet slides up under the finger: a quick second tap (from a double-tap on the menu) must
     not land on whichever playlist is passing by */
  const readyAt = performance.now() + 500;
  const ready = () => performance.now() >= readyAt;
  let closed = false, busy = false, loaded = false, pls = [], query = '';
  const have = new Map();   /* playlist id -> how many of these songs it already has, once known */
  const close = () => {
    if (closed) return;
    closed = true;
    /* a sort sheet or question opened on top of this one goes with it */
    const i = UI.stack.indexOf(close);
    if (i >= 0) UI.stack.slice(i + 1).reverse().forEach((c) => c(null));
    UI.stack = UI.stack.filter((c) => c !== close);
    input.blur();
    m.classList.remove('in'); m.querySelector('.bd').classList.remove('in');
    setTimeout(() => m.remove(), 520);
  };
  /* closed by a tap: the page underneath mustn't get that tap's twin */
  const closeByTap = () => { suppressClicks(350); close(); };
  UI.stack.push(close);

  const row = (p) => {
    const line = alreadyLine(have.get(p.id) || 0, ids.length);
    return `<button class="pk-row" data-id="${esc(p.id)}" data-press><div class="art list">${img(p.coverArt || p.id, 150)}</div><div class="txt"><div class="t1">${esc(p.name)}</div><div class="t2"${line ? '' : ' hidden'}>${esc(line)}</div></div></button>`;
  };
  const render = () => {
    if (closed || !loaded) return;   /* until the list is here, the spinner stays */
    if (!pls.length) { body.innerHTML = '<div class="empty"><b>No Playlists</b>Tap + to make one.</div>'; return; }
    const k = Settings.sort('addToPlaylist', 'name');
    const all = pls.slice().sort(k === 'name' ? (a, b) => collator.compare(a.name, b.name) : (a, b) => playlistTime(b, k) - playlistTime(a, k));
    const q = foldText(query.trim());
    let html = '';
    if (q) {
      const found = all.filter((p) => foldText(p.name).includes(q));
      html = found.length ? found.map(row).join('') : `<div class="empty"><b>No Results</b>No playlists match “${esc(query.trim())}”.</div>`;
    } else {
      /* like Apple Music: the latest ones on top once there are a few */
      if (pls.length >= 3) {
        const recent = pls.slice().sort((a, b) => playlistTime(b, 'changed') - playlistTime(a, 'changed')).slice(0, 3);
        html += `<div class="sec-h">Recents</div>${recent.map(row).join('')}`;
      }
      html += `<div class="sec-h">All Playlists</div>${all.map(row).join('')}`;
    }
    body.innerHTML = html;
  };
  /* the line under a playlist's name, wherever it appears (it can be in Recents and All Playlists) */
  const setLine = (id, text) => {
    body.querySelectorAll('.pk-row').forEach((r) => {
      if (r.dataset.id !== id) return;
      const t = r.querySelector('.t2');
      t.textContent = text; t.hidden = !text;
    });
  };
  const mark = (id) => setLine(id, alreadyLine(have.get(id) || 0, ids.length));
  const learn = (p, inIt) => { have.set(p.id, ids.filter((id) => inIt.has(id)).length); if (!closed) mark(p.id); };

  m.querySelector('.bd').addEventListener('click', closeByTap);
  m.querySelector('.pk-x').addEventListener('click', closeByTap);
  m.querySelector('.pk-sort').addEventListener('click', () => { if (!closed && !busy) sortSheet('addToPlaylist', PICK_SORTS, 'name', render); });
  m.querySelector('.pk-new').addEventListener('click', async () => {
    if (closed || busy || !ready()) return;
    busy = true;
    try {
      /* the name box opens over the sheet, so Cancel brings you back to the list */
      if (await newPlaylist(songs) && !closed) closeByTap();
    } finally { busy = false; }
  });
  input.addEventListener('input', () => { query = input.value; clearBtn.hidden = !query; render(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  clearBtn.addEventListener('click', (e) => { e.preventDefault(); input.value = ''; query = ''; clearBtn.hidden = true; render(); input.focus(); });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('.pk-row');
    if (!b || closed || busy || !ready()) return;
    const p = pls.find((x) => x.id === b.dataset.id);
    if (!p) return;
    busy = true;
    try {
      let inIt = null;
      if (!have.has(p.id)) setLine(p.id, 'Checking…');   /* so the tap visibly did something */
      try { inIt = await PlaylistSongs.get(p); learn(p, inIt); } catch (err) { if (!closed) mark(p.id); }
      if (closed) return;
      const n = inIt ? ids.filter((id) => inIt.has(id)).length : 0;
      let add = songs;
      if (!inIt) {
        if (!(await askUnchecked(p, songs)) || closed) return;
      } else if (n) {
        const choice = await askAlreadyIn(p, songs, n);
        if (!choice || closed) return;
        if (choice === 'new') add = songs.filter((s) => !inIt.has(s.id));
      }
      closeByTap();
      PlaylistSongs.noteAdded(p.id, add.map((s) => s.id));
      if (!(await addToPlaylist(p, add))) PlaylistSongs.forget(p.id);
    } finally { busy = false; }
  });

  try {
    /* a fresh list: its "changed" times tell which remembered playlist contents are still right */
    Lib.invalidate('playlists');
    pls = (await Lib.playlists()).filter((p) => !p.readonly);
  } catch (e) {
    close();
    toast(e.message, I.xmark, 'var(--red)');
    return;
  }
  loaded = true;
  render();
  if (closed) return;
  /* check the playlists three at a time, so a playlist you tap (and the artwork, and the music)
     isn't stuck waiting behind all of them on a slow connection */
  const queue = pls.slice();
  const worker = async () => {
    while (queue.length && !closed) {
      const p = queue.shift();
      try { learn(p, await PlaylistSongs.get(p)); } catch (e) { /* the line stays empty; a tap checks again */ }
    }
  };
  worker(); worker(); worker();
}

/* ---------- lyrics ----------
   Where lyrics come from, in this order:
   1. your server: Navidrome reads lyrics stored inside the music file or in a .lrc / .txt file next to it
      (OpenSubsonic getLyricsBySongId)
   2. when "Look Up Lyrics Online" is on and the server had nothing timed: LRCLIB (lrclib.net), a free public lyrics
      library, asked straight from the phone. It gets the song's title, artist and length. No cookies or Referer are
      sent; like any request to another site, the browser adds an Origin header with this app's own address
      (a private address such as http://192.168.1.20:4534), and LRCLIB sees the phone's internet address.
   A result is { synced, lines: [{ t, text }], source: 'server' | 'lrclib' | 'demo', instrumental }, or null when
   there are none. Synced lines carry t = seconds into the song; other lines have t = null. */
const LYRICS_LEAD = 0.2; /* light a line up this much early, so it is lit as the singing starts */

/* LRC text ("[01:02.34]words") -> [{ t, text }] sorted by time. Handles several stamps on one line, [mm:ss:xx] stamps,
   word timings (<01:02.34>) and the [offset:+/-ms] tag, where a positive offset makes the words come sooner. */
function parseLRC(src) {
  const out = [];
  let offset = 0;
  const stamp = /^\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/;
  String(src || '').split(/\r?\n/).forEach((raw) => {
    let rest = raw.trim(), m;
    const off = /^\[offset:\s*([+-]?\d+)\s*\]$/i.exec(rest);
    if (off) { offset = +off[1] || 0; return; }
    const times = [];
    while ((m = stamp.exec(rest))) { times.push(+m[1] * 60 + parseFloat(m[2].replace(':', '.'))); rest = rest.slice(m[0].length); }
    if (!times.length) return; /* tags like [ar:...] or stray text */
    const text = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').replace(/\s+/g, ' ').trim();
    times.forEach((t) => { if (isFinite(t)) out.push({ t, text }); });
  });
  out.forEach((l) => { l.t = Math.max(0, l.t - offset / 1000); });
  return out.sort((a, b) => a.t - b.t);
}
/* plain text -> lines without times; runs of blank lines become one break */
function plainLyricLines(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const s = raw.replace(/\s+/g, ' ').trim();
    if (s || (out.length && out[out.length - 1].text)) out.push({ t: null, text: s });
  });
  while (out.length && !out[out.length - 1].text) out.pop();
  return out;
}
/* timed lines -> a result. Lines whose times are all the same (often all 0) aren't really timed: shown as plain text. */
function lyTimed(lines, source) {
  const words = lines.filter((l) => l.text);
  if (!words.length) return null;
  if (words.length > 1 && new Set(words.map((l) => l.t)).size < 2) return { synced: false, lines: plainLyricLines(lines.map((l) => l.text).join('\n')), source };
  return { synced: true, lines, source };
}
/* Synced lines as shown, in time order. An empty line is a break in the singing: breaks shorter than 4 s are dropped
   (the line before stays lit), longer ones show three dots, and a long intro gets dots too. Lines that share a time
   are shown and lit together. */
function tidySynced(lines, dur) {
  const src = lines.filter((l) => isFinite(l.t)).slice().sort((a, b) => a.t - b.t);
  const out = [];
  src.forEach((l, i) => {
    const last = out[out.length - 1];
    if (l.text) {
      if (last && last.text && last.t === l.t) last.text += '\n' + l.text;
      else out.push({ t: l.t, text: l.text });
      return;
    }
    if (!last || !last.text || l.t <= last.t) return;
    let next = null;
    for (let j = i + 1; j < src.length; j++) if (src[j].text) { next = src[j]; break; }
    const end = next ? next.t : (dur > l.t ? dur : l.t + 10);
    if (end - l.t >= 4) out.push({ t: l.t, text: '' });
  });
  if (out.length && out[0].t >= 4) out.unshift({ t: 0, text: '' });
  return out;
}

/* ----- matching songs to LRCLIB entries ----- */
const LY_ACCENTS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
const nmText = (s) => String(s || '').normalize('NFKD').replace(LY_ACCENTS, '').normalize('NFC').toLowerCase()
  .replace(/&/g, ' and ').replace(/['’`´]/g, '').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
/* A whole " - …" part that names a version rather than a song: "Remastered 2011", "2011 Remaster", "Live", "Live at …",
   "Radio Edit", "Single Version", "Original Mix", "… Remix", "From “Film”", "From the Motion Picture …". Only whole
   parts count, so songs such as "Live Forever", "Stereo Hearts", "Clean" or "From the Inside" aren't mistaken for one.
   Instrumental versions are not a version here: they have no words. */
const LY_VERSION = /^(?:(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?remaster(?:ed)?(?:\s+(?:\d{4}|version|edition|mix))*|live(?:\s+(?:at|from|in|on)\b.*|\s+version|\s+\d{4})?|radio\s+edit|bonus\s+track|(?:radio|single|album|extended|original|club|acoustic|live|mono|stereo|demo|clean|explicit|deluxe|anniversary)\s+(?:version|mix|edit|edition)|(?:\S+\s+){0,3}(?:remix|rework|bootleg|mix|edit|version)|karaoke|mono|stereo|demo|acoustic|from\s+["“”‘’'(].*|from\s+the\s+(?:motion\s+picture|film|movie|series|musical|soundtrack|original\s+(?:motion\s+picture|soundtrack|series|score))\b.*)$/i;
/* labels for versions without the singing; looked for only in brackets or after " - ", so songs called "Instrumental
   Love" are still looked up. Karaoke versions do get lyrics: singing along is what they're for. */
const LY_NO_WORDS = /\b(?:instrumental|inst\.?|off[\s-]?vocal|backing\s+track|minus\s+one|no\s+vocals?|without\s+vocals?)\b|^m\s*\/?\s*r$/i;
/* labels for a different piece than the song itself */
const LY_OTHER_PIECE = /\b(?:reprise|interlude|skit|intro|outro|snippet|teaser|preview)\b/i;
const lyIsVersion = (part) => !LY_NO_WORDS.test(String(part || '').trim()) && !LY_OTHER_PIECE.test(String(part || '')) && LY_VERSION.test(String(part || '').trim());
/* the bracketed bits and the " - " endings of a title */
function lyLabels(title) {
  const t = String(title || '').normalize('NFKC'), out = [];
  t.replace(/[([【〔]([^)\]】〕]*)[)\]】〕]/g, (m, inner) => { out.push(inner.trim()); return m; });
  t.split(/\s+[-–—]\s+/).slice(1).forEach((x) => out.push(x.replace(/[([【〔][^)\]】〕]*[)\]】〕]/g, ' ').trim()));
  return out.filter(Boolean);
}
const lyNoWords = (title) => lyLabels(title).some((x) => LY_NO_WORDS.test(x));
/* a title without bracketed extras or version endings */
function lyBaseTitle(s) {
  let t = String(s || '').normalize('NFKC').replace(/\s*[([【〔][^)\]】〕]*[)\]】〕]/g, ' ');
  let parts = t.split(/\s+[-–—]\s+/);
  while (parts.length > 1 && lyIsVersion(parts[parts.length - 1])) parts = parts.slice(0, -1);
  return nmText(parts.join(' - '));
}
function lyTitleMatch(a, b) {
  const x = lyBaseTitle(a).replace(/ /g, ''), y = lyBaseTitle(b).replace(/ /g, '');
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return s.length >= 4 && l.includes(s) && s.length / l.length >= 0.65;
}
/* artists are compared whole ("Aster" is not "Aster Lane"), ignoring spaces and a leading "The";
   "A & B", "A feat. B", "A, B" and Navidrome's "A • B" match either of them */
const lyArtistKey = (s) => nmText(s).replace(/^the /, '').replace(/ /g, '');
const lyArtistParts = (s) => String(s || '').split(/\s*(?:[,;/&+•·]|\band\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bx\b|\bvs\.?)\s*/i)
  .map(lyArtistKey).filter((x) => x.length >= 2);
function lyArtistMatch(a, b) {
  const x = lyArtistKey(a), y = lyArtistKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const px = lyArtistParts(a), py = lyArtistParts(b);
  return px.some((p) => py.includes(p));
}
/* the first of several artists ("A, B", "A & B", "A x B", "A and B", "A • B", "A feat. B"), for searching; results
   are still accepted for any of the tagged names */
const lyFirstArtist = (a) => String(a || '').replace(/\s+(?:ft|feat|featuring)\.?\s+.*$/i, '')
  .split(/\s*[,;/•·]\s*|\s+(?:&|x|and|with)\s+/i)[0].replace(/\s+/g, ' ').trim();
const lyNoFeat = (t) => String(t || '').replace(/(?:^|\s+)(?:ft|feat|featuring)\.?\s+.*$/i, '').replace(/\s*[-–—:|]\s*$/, '').trim();
const lyUnquote = (t) => String(t || '').replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').replace(/\s+/g, ' ').trim();
/* Downloaded files often carry video titles: "Artist - Song (Official Video)", "Artist ft. Guest - Song",
   "Song | Live Session", "ArtistVEVO", "Artist - Topic". This makes plain song and artist names out of them:
   the most likely reading first, and a second reading when the title could be taken either way. */
function lyReadings(title, artist) {
  const JUNK = /\b(?:official|video|audio|lyrics?|visuali[sz]er|mv|m\/v|hd|hq|4k|\d{3,4}p|remaster(?:ed)?|explicit|clean|colou?r coded|full song|ft|feat|featuring|prod|from|karaoke)\b/i;
  let t = String(title || '').normalize('NFKC');
  t = t.replace(/\s+[|｜]\s+.*$/, '').replace(/\s+\/\/\s+.*$/, '');
  t = t.replace(/\s*[([【〔]([^)\]】〕]*)[)\]】〕]/g, (m, inner) => (JUNK.test(inner) ? ' ' : m));
  const a = String(artist || '').normalize('NFKC').replace(/\s*-\s*topic$/i, '').replace(/\s*vevo$/i, '').trim();
  let parts = t.split(/\s+[-–—]\s+/).map(lyNoFeat).filter(Boolean);
  if (!parts.length) return [];
  const out = [];
  const add = (track, art) => { track = lyUnquote(track); art = lyFirstArtist(art); if (track) out.push({ track, artist: art }); };
  const trimVersions = (ps) => { while (ps.length > 1 && lyIsVersion(ps[ps.length - 1])) ps = ps.slice(0, -1); return ps; };
  if (parts.length === 1) { add(parts[0], a); return out; }
  /* "Artist - Song …" where Artist is the tagged artist ("Oasis - Live Forever" by Oasis) */
  if (a && lyArtistMatch(lyFirstArtist(parts[0]), lyFirstArtist(a))) { add(trimVersions(parts.slice(1)).join(' - '), parts[0]); return out; }
  const kept = trimVersions(parts);
  if (kept.length === 1) {
    /* "Song - Remastered 2011": the song with the version ending dropped */
    add(kept[0], a);
  } else {
    /* a channel's upload of "Artist - Song"; or else the artist's own "Song - Live Session" and the like
       (but not "Song - Reprise" or "Song - Interlude", which are different pieces) */
    add(kept.slice(1).join(' - '), kept[0]);
    if (a && !kept.slice(1).some((x) => LY_OTHER_PIECE.test(x) || LY_NO_WORDS.test(x))) add(kept[0], a);
  }
  return out;
}
/* Navidrome calls a missing artist "[Unknown Artist]"; Encore says "Unknown Artist" */
const LY_NO_ARTIST = /^[[<]?\s*(?:unknown(?: artist)?|various artists)\s*[\]>]?$/i;
const lyTagged = (x) => (LY_NO_ARTIST.test(String(x || '').trim()) ? '' : String(x || '').trim());
/* the names to try: as tagged first, then the cleaned-up readings (up to 3 sets, no repeats) */
function lyQueries(s) {
  const title = String(s.title || '').trim(), artist = lyTagged(s.artist), primary = lyTagged(s.primaryArtist);
  const out = [];
  const add = (q) => {
    const track = String(q.track || '').trim(), art = String(q.artist || '').trim();
    if (track && !out.some((o) => nmText(o.track) === nmText(track) && nmText(o.artist) === nmText(art))) out.push({ track, artist: art });
  };
  if (title && artist) add({ track: title, artist });
  lyReadings(title, primary || artist).forEach(add);
  return out.slice(0, 3);
}
/* one LRCLIB entry -> a result. Its timings are only used when its length is within 3 s of the song's; otherwise the
   words would run early or late, so they are shown without timings. */
function lrclibResult(x, dur) {
  if (!x) return null;
  const d = +x.duration || 0, close = !(dur > 0) || !(d > 0) || Math.abs(d - dur) <= 3;
  if (x.instrumental) return close ? { synced: false, instrumental: true, lines: [], source: 'lrclib' } : null;
  if (x.syncedLyrics && close) { const r = lyTimed(parseLRC(x.syncedLyrics), 'lrclib'); if (r) return r; }
  const plain = x.plainLyrics || (x.syncedLyrics ? parseLRC(x.syncedLyrics).map((l) => l.text).join('\n') : '');
  const lines = plainLyricLines(plain);
  return lines.length ? { synced: false, lines, source: 'lrclib' } : null;
}
/* The best match in a list of LRCLIB entries: same song name and one of the artists, then timed lyrics of the right
   length first. With no artist to go by, only the same song name with the same length (within 1.5 s) is trusted,
   and only when all such entries are by one artist. */
function lrclibPick(list, track, artists, dur) {
  if (!Array.isArray(list) || !list.length) return null;
  const names = artists.filter(Boolean);
  const known = (x) => dur > 0 && +x.duration > 0;
  const delta = (x) => (known(x) ? Math.abs(+x.duration - dur) : 0);
  let ok;
  if (names.length) {
    ok = list.filter((x) => x && lyTitleMatch(x.trackName || x.name, track) && names.some((a) => lyArtistMatch(x.artistName, a)));
  } else {
    const T = lyBaseTitle(track);
    ok = list.filter((x) => x && T && lyBaseTitle(x.trackName || x.name) === T && known(x) && delta(x) <= 1.5);
    if (new Set(ok.map((x) => lyArtistKey(x.artistName))).size !== 1) return null;
  }
  const rank = (x) => (x.syncedLyrics && delta(x) <= 3 ? 0 : x.instrumental && delta(x) <= 3 ? 1 : 2) * 100000 + delta(x);
  ok.sort((a, b) => rank(a) - rank(b));
  for (const x of ok) { const r = lrclibResult(x, dur); if (r) return r; }
  return null;
}

const LRCLIB = {
  base: 'https://lrclib.net/api/',
  bare: false, /* true once a request without the Lrclib-Client header worked where one with it didn't */
  /* LRCLIB asks apps to name themselves; from a web page that's the Lrclib-Client header, which LRCLIB's server allows.
     The header makes the browser check with LRCLIB first, so if a request with it can't get through, it is tried
     once more without it before giving up. */
  async call(path, params) {
    try { return await this.request(path, params, !this.bare); } catch (e) {
      if (e.code !== 'network' || e.timeout || this.bare) throw e;
      const r = await this.request(path, params, false);
      this.bare = true;
      return r;
    }
  },
  async request(path, params, named) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const unreachable = (e) => {
      const slow = !!(e && e.name === 'AbortError');
      const err = new ApiError(slow ? 'LRCLIB, the online lyrics library, took too long to answer.' : 'Couldn’t reach LRCLIB, the online lyrics library.', 'network');
      err.timeout = slow;
      return err;
    };
    try {
      let res;
      try {
        res = await fetch(this.base + path + '?' + new URLSearchParams(params).toString(), {
          signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
          headers: named ? { 'Lrclib-Client': `Encore ${APP_VERSION} (self-hosted music player)` } : {},
        });
      } catch (e) { throw unreachable(e); }
      /* "not found", and requests LRCLIB won't take (e.g. a length over an hour), mean there's nothing to show */
      if (res.status === 404 || res.status === 400 || res.status === 422) return null;
      if (!res.ok) throw new ApiError(res.status === 503 || res.status === 429 ? 'LRCLIB, the online lyrics library, is busy. Try again in a minute.' : `LRCLIB, the online lyrics library, answered with error ${res.status}.`, 'http');
      try { return await res.json(); } catch (e) {
        if (e && e.name === 'AbortError') throw unreachable(e);
        throw new ApiError('LRCLIB sent an answer Encore couldn’t read.', 'format');
      }
    } finally { clearTimeout(timer); }
  },
  /* At most 5 requests: an exact lookup for the names as tagged, a search for each set of names (up to 3), and one
     free-text search if nothing matched (which also tries the names the other way round, for "Song - Artist"). */
  async find(s) {
    const dur = Math.round(+s.duration || 0);
    const length = dur >= 1 && dur <= 3600 ? { duration: dur } : {}; /* LRCLIB only takes 1 s to 1 hour */
    const all = lyQueries(s);
    const qs = all.filter((q) => q.artist);
    const tagged = lyTagged(s.artist);
    const names = (q) => [q.artist, tagged, lyFirstArtist(tagged)];
    let fallback = null, budget = 5;
    for (let n = 0; n < qs.length && budget > 1; n++) {
      const q = qs[n];
      if (n === 0) {
        budget--;
        const r1 = lrclibResult(await this.call('get', Object.assign({ track_name: q.track, artist_name: q.artist }, length)), dur);
        if (r1 && (r1.synced || r1.instrumental)) return r1;
        fallback = fallback || r1;
      }
      budget--;
      const r2 = lrclibPick(await this.call('search', { track_name: q.track, artist_name: q.artist }), q.track, names(q), dur);
      if (r2 && (r2.synced || r2.instrumental)) return r2;
      fallback = fallback || r2;
    }
    const q = lyReadings(s.title, lyTagged(s.primaryArtist) || tagged)[0] || all[0];
    if (fallback || !q) return fallback;
    const list = await this.call('search', { q: (q.artist ? q.artist + ' ' : '') + q.track });
    return lrclibPick(list, q.track, names(q), dur) || (q.artist ? lrclibPick(list, q.artist, [q.track], dur) : null);
  },
};

/* a promise that gives up after ms (used so a stalled server answer can't leave the lyrics loading forever) */
function lyWithin(p, ms, message) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ApiError(message, 'network')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/* songs whose LRCLIB lyrics you hid with "Wrong lyrics?", remembered on this device */
const LyHidden = {
  ids: null,
  list() {
    if (!this.ids) { const v = store.get('lyricsHidden', []); this.ids = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
    return this.ids;
  },
  has(id) { return this.list().includes(id); },
  /* -> false when it couldn't be saved on the device (it still applies until Encore is closed) */
  set(id, hide) {
    const rest = this.list().filter((x) => x !== id);
    if (hide) rest.push(id);
    this.ids = rest.slice(-500);
    try { localStorage.setItem('encore.lyricsHidden', JSON.stringify(this.ids)); return true; } catch (e) { return false; }
  },
};

const Lyrics = {
  mem: new Map(), busy: new Map(), gen: 0,
  clear() { this.mem.clear(); this.busy.clear(); this.gen++; },
  key(s) { return JSON.stringify([s.id, s.title, s.artist, Math.round(+s.duration || 0), Settings.get('lyricsOnline') ? 1 : 0, LyHidden.has(s.id) ? 1 : 0]); },
  get(s) {
    const k = this.key(s), gen = this.gen;
    if (this.mem.has(k)) return Promise.resolve(this.mem.get(k));
    if (this.busy.has(k)) return this.busy.get(k);
    const p = this.find(s).then(({ r, keep }) => {
      if (keep && gen === this.gen) {
        this.mem.set(k, r);
        if (this.mem.size > 200) this.mem.delete(this.mem.keys().next().value);
      }
      return r;
    });
    const done = () => { if (this.busy.get(k) === p) this.busy.delete(k); };
    p.then(done, done);
    this.busy.set(k, p);
    return p;
  },
  /* -> { r: a result or null, keep: whether that answer can be reused for the rest of the session } */
  async find(s) {
    const a = api;
    if (!a) return { r: null, keep: false };
    let mine = null, mineErr = null;
    try {
      mine = this.fromServer(await lyWithin(a.get('getLyricsBySongId', { id: s.id }, { timeout: 12000 }), 15000, 'The music server took too long to answer.'));
    } catch (e) { mineErr = e; }
    if (mine && a.demo) mine.source = 'demo';
    if (mine && mine.synced) return { r: mine, keep: true };
    /* only a clean answer from the server is remembered; after a hiccup (Navidrome restarting, a slow answer) it is
       asked again next time, so your own lyrics aren't hidden for the rest of the session */
    const sure = !mineErr || mineErr.code === 70;
    const down = !!(mineErr && mineErr.code === 'network');
    /* online lookups: not in the demo, not when switched off, not for songs whose LRCLIB lyrics you hid, and not for
       songs named as instrumental or karaoke versions (LRCLIB would give the sung version's words) */
    if (a.demo || !Settings.get('lyricsOnline') || LyHidden.has(s.id) || lyNoWords(s.title)) {
      if (mine) return { r: mine, keep: true };
      if (down) throw mineErr;
      return { r: null, keep: sure };
    }
    let web;
    try { web = await LRCLIB.find(s); } catch (e) {
      if (mine) return { r: mine, keep: false };
      throw e;
    }
    if (web && web.synced) return { r: web, keep: sure };
    if (mine) return { r: mine, keep: true }; /* your own lyrics beat LRCLIB's untimed ones */
    if (down && !web) throw mineErr;
    return { r: web || null, keep: sure };
  },
  /* OpenSubsonic structuredLyrics -> a result; timed lyrics win over plain ones */
  fromServer(r) {
    const list = arr(r && r.lyricsList && r.lyricsList.structuredLyrics)
      .filter((l) => l && arr(l.line).some((x) => x && String(x.value || '').trim()));
    const pick = list.find((l) => l.synced) || list[0];
    if (!pick) return null;
    if (pick.synced) {
      const off = (+pick.offset || 0) / 1000;
      let last = 0;
      const lines = arr(pick.line).map((x) => {
        const st = x && x.start != null && isFinite(+x.start) ? +x.start / 1000 - off : last;
        last = st;
        return { t: Math.max(0, st), text: String((x && x.value) || '').replace(/\s+/g, ' ').trim() };
      });
      return lyTimed(lines, 'server');
    }
    const lines = plainLyricLines(arr(pick.line).map((x) => (x && x.value) || '').join('\n'));
    return lines.length ? { synced: false, lines, source: 'server' } : null;
  },
};

/* The lyrics page inside Now Playing: the line being sung is bright and kept in view; tap a line to jump there.
   Scrolling by hand pauses the following for 3 seconds. */
const LyView = {
  box: null, songId: null, key: '', status: 'idle', res: null, err: null, lines: [], els: [], idx: -1, raf: 0, seq: 0,
  hold: false, moved: false, fingers: new Map(), top0: 0, selfTop: null, holdUntil: 0, wander: false, loads: [],
  init(box) {
    this.box = box;
    const now = () => performance.now();
    /* A finger on the lyrics holds them still. When the last finger lifts, following waits 3 s if the lyrics were
       scrolled, and otherwise catches up at once. Each touch's move and end are also listened for on the touched
       element itself: if the lyrics are redrawn under the finger, only that (removed) element still gets them.
       Touches the browser no longer reports (an end that never came) are forgotten at the next touch or when
       Encore goes to the background. */
    const release = () => {
      this.hold = false;
      if (this.moved || Math.abs(box.scrollTop - this.top0) > 2) this.holdUntil = now() + 3000;
      this.wander = true;
      this.loop();
    };
    this.endAll = () => { Array.from(this.fingers.values()).forEach((done) => done()); };
    const settle = (e) => {
      const down = new Set(Array.from((e && e.touches) || []).map((t) => t.identifier));
      Array.from(this.fingers.entries()).forEach(([id, done]) => { if (!down.has(id)) done(); });
    };
    box.addEventListener('touchstart', (e) => {
      settle(e);
      const target = e.target;
      Array.from(e.changedTouches || []).forEach((t) => {
        const id = t.identifier, y0 = t.clientY;
        if (this.fingers.has(id)) this.fingers.get(id)(); /* an old touch with the same id whose end never came */
        if (!this.fingers.size) { this.moved = false; this.top0 = box.scrollTop; }
        const move = (ev) => { Array.from(ev.changedTouches || []).forEach((c) => { if (c.identifier === id && Math.abs(c.clientY - y0) > 10) this.moved = true; }); };
        const end = (ev) => { if (Array.from(ev.changedTouches || []).some((c) => c.identifier === id)) done(); };
        const done = () => {
          target.removeEventListener('touchmove', move); target.removeEventListener('touchend', end); target.removeEventListener('touchcancel', end);
          if (this.fingers.delete(id) && !this.fingers.size) release();
        };
        target.addEventListener('touchmove', move, { passive: true });
        target.addEventListener('touchend', end, { passive: true });
        target.addEventListener('touchcancel', end, { passive: true });
        this.fingers.set(id, done);
      });
      this.hold = this.fingers.size > 0;
    }, { passive: true });
    const away = () => { if (this.fingers.size) this.endAll(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) away(); });
    window.addEventListener('pagehide', away);
    box.addEventListener('wheel', () => { this.wander = true; this.holdUntil = now() + 3000; this.loop(); }, { passive: true });
    /* scrolling only counts as the user's while a finger is down, or while a flick or wheel is still moving it;
       Encore's own scrolling happens outside those times */
    box.addEventListener('scroll', () => {
      if (this.selfTop !== null && Math.abs(box.scrollTop - this.selfTop) < 2) { this.selfTop = null; return; }
      this.selfTop = null;
      if (this.hold) { this.moved = true; return; }
      if (now() < this.holdUntil) { this.holdUntil = Math.max(this.holdUntil, now() + 2500); this.wander = true; this.loop(); }
    }, { passive: true });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ly]');
      if (b) { this.action(b.dataset.ly); return; }
      const ll = e.target.closest('.ll[data-t]');
      if (!ll || !this.res || !this.res.synced || !this.live()) return;
      this.unhold();
      Player.seek(+ll.dataset.t);
      if (!Player.playing) Player.play();
      this.sync(false);
      this.loop();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.live()) { this.sync(true); this.loop(); } });
  },
  async action(act) {
    const s = Player.cur;
    if (act === 'retry') { this.unhold(); this.load(true); return; }
    if (!s) return;
    if (act === 'hide') {
      const ok = await UI.confirm({ title: 'Hide LRCLIB’s lyrics for this song?', message: 'Encore won’t use LRCLIB, the online lyrics library, for this song on this device. Lyrics from your server still show.', ok: 'Hide' });
      if (!ok) return;
      /* the song you were looking at, even if another one has started since */
      if (!LyHidden.set(s.id, true)) toast('Hidden until you close Encore (couldn’t save on this device)', I.lyrics);
    } else if (act === 'unhide') {
      if (!LyHidden.set(s.id, false)) toast('Shown until you close Encore (couldn’t save on this device)', I.lyrics);
    } else return;
    if (Player.cur && Player.cur.id === s.id) this.load(false);
  },
  /* "…" menu items for the song whose lyrics are on screen */
  menuItems(song) {
    if (!song || !this.live() || this.songId !== song.id || (api && api.demo)) return [];
    const r = this.res;
    if (this.status === 'ok' && r && r.source === 'lrclib') return [{ icon: I.lyrics, label: r.instrumental ? 'Not Instrumental? Hide This' : 'Wrong Lyrics? Hide Them', run: () => this.action('hide') }];
    if (LyHidden.has(song.id) && !(r && r.synced)) return [{ icon: I.lyrics, label: 'Show LRCLIB’s Lyrics Again', run: () => this.action('unhide') }];
    return [];
  },
  /* forget any hand-scroll (fingers still down keep holding) */
  unhold() { this.holdUntil = 0; this.wander = false; if (!this.fingers.size) { this.hold = false; this.moved = false; } },
  live() { return !!(NP.isOpen && NP.mode === 'lyrics' && Player.cur && this.songId === Player.cur.id); },
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; },
  async load(force) {
    const s = Player.cur;
    if (!s || s.isRadio || !this.box) return;
    /* the key changes with the song, its names, the online setting, hiding, and Refresh Library */
    const key = Lyrics.key(s) + '|' + Lyrics.gen;
    if (!force && this.key === key && this.status !== 'error') {
      if (this.status !== 'loading') { this.sync(true); this.loop(); }
      return;
    }
    const seq = ++this.seq;
    this.stop();
    this.songId = s.id; this.key = key; this.status = 'loading'; this.res = null; this.err = null;
    this.paint();
    /* skipping through songs: from the second quick change in a row, wait a moment so songs passed over aren't
       looked up (songs already looked up show straight away) */
    const t = performance.now();
    this.loads = this.loads.filter((x) => t - x < 1500).concat(t);
    if (!force && this.loads.length >= 3 && !Lyrics.mem.has(Lyrics.key(s))) { await sleep(400); if (seq !== this.seq) return; }
    let res = null, err = null;
    try { res = await Lyrics.get(s); } catch (e) { err = e; }
    if (seq !== this.seq) return; /* another song started while this one was being looked up */
    if (err) { this.status = 'error'; this.err = err; } else { this.status = res ? 'ok' : 'none'; this.res = res; }
    this.paint();
    this.sync(true);
    this.loop();
  },
  paint() {
    const r = this.res, s = Player.cur;
    let html = '';
    this.lines = []; this.els = []; this.idx = -1;
    if (this.status === 'loading') html = `<div class="ly-msg" role="status" aria-label="Loading lyrics">${SPIN}</div>`;
    else if (this.status === 'error') html = `<div class="ly-msg"><b>Couldn’t Load Lyrics</b><span>${esc((this.err && this.err.message) || 'Something went wrong.')}</span><button data-ly="retry">Try Again</button></div>`;
    else if (this.status === 'none' || !r) {
      const hidden = !!(s && LyHidden.has(s.id)) && !(api && api.demo);
      const why = api && api.demo ? 'This demo song has no lyrics.'
        : hidden ? 'You hid LRCLIB’s lyrics for this song.'
          : !Settings.get('lyricsOnline') ? 'Your server doesn’t have lyrics for this song. To also search LRCLIB, the online lyrics library, turn on Look Up Lyrics Online in Settings.'
            : s && lyNoWords(s.title) ? 'This song’s name says it’s a version without the singing, so Encore didn’t look it up online.'
              : 'Your server and LRCLIB, the online lyrics library, don’t have lyrics for this song.';
      html = `<div class="ly-msg"><b>No Lyrics</b><span>${esc(why)}</span>${hidden ? '<button data-ly="unhide">Show Them Again</button>' : ''}</div>`;
    } else if (r.instrumental) html = '<div class="ly-msg"><b>Instrumental</b><span>LRCLIB, the online lyrics library, lists this song as having no words.</span><button data-ly="hide">Not Instrumental?</button></div>';
    else {
      const from = r.source === 'lrclib' ? 'Lyrics from LRCLIB' : r.source === 'demo' ? 'Made-up demo lyrics' : 'Lyrics from your server';
      const hiddenHere = !!(s && LyHidden.has(s.id)) && r.source === 'server' && !r.synced;
      const wrong = r.source === 'lrclib' ? ' · <button data-ly="hide">Wrong lyrics?</button>'
        : hiddenHere ? ' · <button data-ly="unhide">Show LRCLIB’s lyrics</button>' : '';
      const src = `<div class="ly-src">${from}${r.synced ? '' : ' · not timed to the song'}${wrong}</div>`;
      if (r.synced) {
        this.lines = tidySynced(r.lines, Player.duration());
        html = `<div class="ly-lines">${this.lines.map((l) => (l.text
          ? `<div class="ll" dir="auto" data-t="${l.t}">${esc(l.text)}</div>`
          : `<div class="ll gap" data-t="${l.t}" aria-hidden="true"><i></i><i></i><i></i></div>`)).join('')}${src}</div>`;
      } else {
        html = `<div class="ly-lines plain">${r.lines.map((l) => (l.text ? `<div class="ll" dir="auto">${esc(l.text)}</div>` : '<div class="ll br"></div>')).join('')}${src}</div>`;
      }
    }
    /* new content: a hand-scroll of the old content no longer applies (a finger still down keeps holding) */
    this.unhold();
    this.box.innerHTML = html;
    if (this.box.scrollTop) { this.selfTop = 0; this.box.scrollTop = 0; }
    this.top0 = 0;
    if (r && r.synced && this.status === 'ok') this.els = Array.from(this.box.querySelectorAll('.ll[data-t]'));
  },
  /* the last line that has started by time t, or -1 before the first */
  at(t) {
    const L = this.lines;
    let lo = 0, hi = L.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (L[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  },
  sync(jump) {
    if (!this.els.length || !this.live()) return;
    const i = this.at(Player.time() + LYRICS_LEAD);
    if (i !== this.idx) {
      const a = this.els[this.idx], b = this.els[i];
      if (a) { a.classList.remove('on'); a.removeAttribute('aria-current'); }
      if (b) { b.classList.add('on'); b.setAttribute('aria-current', 'true'); }
      this.idx = i;
      this.follow(jump);
    } else if (jump || (this.wander && Player.playing && !this.hold && performance.now() >= this.holdUntil)) this.follow(jump);
  },
  /* scroll so the lit line sits a third of the way down */
  follow(jump) {
    if (this.hold || performance.now() < this.holdUntil || document.hidden) return;
    this.wander = false;
    const box = this.box, el = this.els[Math.max(0, this.idx)];
    if (!el || !box.clientHeight) return;
    const top = Math.max(0, Math.round(el.offsetTop - box.clientHeight * 0.3));
    if (Math.abs(box.scrollTop - top) < 2) return;
    const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (jump || calm || typeof box.scrollTo !== 'function') box.scrollTop = top;
    else box.scrollTo({ top, behavior: 'smooth' });
  },
  /* runs every frame while the song plays (and while a hand-scroll is waiting to snap back) */
  loop() {
    if (this.raf || !this.els.length || !this.live() || document.hidden) return;
    const step = () => {
      this.raf = 0;
      if (!this.live() || document.hidden) return;
      this.sync(false);
      if (Player.playing || this.hold || performance.now() < this.holdUntil) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },
};

/* ---------- Now Playing (full screen) with the Up Next queue ---------- */
const NP = {
  el: null, isOpen: false, mode: 'player', scrubbing: false,
  init() {
    const el = this.el = $('#np');
    el.innerHTML = `
      <div class="np-bg"><img alt="" data-l="a"><img alt="" data-l="b" style="opacity:0"></div><div class="np-dim"></div>
      <div class="np-in">
        <button class="np-grab" data-np="close" aria-label="Close Now Playing"></button>
        <div class="np-stage">
          <div class="np-art"><img alt="" draggable="false" hidden></div>
          <div class="np-qhead"><div class="txt"><div class="q1"></div><div class="q2"></div></div><button class="np-ib" data-np="star" aria-label="Favorite">${I.star}</button><button class="np-ib" data-np="more" aria-label="More">${I.ellipsis}</button></div>
          <div class="npq"></div>
          <div class="npl" role="region" aria-label="Lyrics"></div>
        </div>
        <div class="np-meta"><div class="np-titles"><div class="np-t mq-wrap"><div class="mq"><span></span></div></div><div class="np-a lnk" data-np="artist"></div></div><button class="np-ib" data-np="star" aria-label="Favorite">${I.star}</button><button class="np-ib" data-np="more" aria-label="More">${I.ellipsis}</button></div>
        <div class="np-scrub" aria-label="Song position"><div class="np-bar"><span class="np-track"></span><span class="np-fill"></span></div><div class="np-times"><span class="cur">0:00</span><span class="rem">-0:00</span></div></div>
        <div class="np-ctrls"><button class="sm" data-np="prev" aria-label="Previous">${I.prev}</button><button class="big" data-np="toggle" aria-label="Play">${I.play}</button><button class="sm" data-np="next" aria-label="Next">${I.next}</button></div>
        <div class="np-bottom"><button data-np="lyrics" aria-label="Lyrics" aria-pressed="false">${I.lyrics}</button><button data-np="shuffle" aria-label="Shuffle">${I.shuffle}</button><button data-np="airplay" aria-label="AirPlay" hidden>${I.airplay}</button><button data-np="queue" aria-label="Up Next">${I.queue}</button></div>
      </div>`;
    this.bar = el.querySelector('.np-fill');
    this.curEl = el.querySelector('.np-times .cur');
    this.remEl = el.querySelector('.np-times .rem');
    this.q = el.querySelector('.npq');
    LyView.init(el.querySelector('.npl'));
    this.bindDrag(); this.bindScrub(); this.bindReorder();
    Player.on('change', () => { if (this.isOpen) this.render(); });
    Player.on('state', () => { this.state(); LyView.loop(); });
    Player.on('time', () => { if (this.isOpen) { this.time(); LyView.sync(false); LyView.loop(); } });
    Player.on('queue', () => {
      if (this.isOpen && this.mode === 'queue') { if (this.dragging || this.q.querySelector('.qrow.swiping, .qrow.open')) this.queueDirty = true; else this.renderQueue(); }
      this.renderModes();
    });
    const audio = nativeAudio || $('#audio');
    if (audio && (audio.native || window.WebKitPlaybackTargetAvailabilityEvent)) {
      audio.addEventListener('webkitplaybacktargetavailabilitychanged', (e) => {
        el.querySelector('[data-np="airplay"]').hidden = e.availability !== 'available';
      });
    }
  },
  open() {
    if (!Player.cur || this.isOpen) return;
    Swipe.close(true); UI.closeAll();
    this.isOpen = true;
    NativeChrome.update();
    const el = this.el;
    el.classList.add('open');
    this.render();
    this.layoutArt(true);
    const { easing, duration } = SP.sheet;
    el.style.transform = 'translate3d(0,0,0)';
    el.animate([{ transform: 'translate3d(0,100%,0)' }, { transform: 'translate3d(0,0,0)' }], { duration, easing });
  },
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    NativeChrome.update();
    const el = this.el, from = el.style.transform || 'translate3d(0,0,0)';
    el.style.transform = 'translate3d(0,105%,0)';
    const a = el.animate([{ transform: from }, { transform: 'translate3d(0,105%,0)' }], { duration: 380, easing: 'cubic-bezier(.3,.7,.3,1)' });
    /* the queue closes with the player; lyrics stay up for next time, like in Apple Music */
    const done = () => { if (!this.isOpen) { el.classList.remove('open'); LyView.stop(); if (this.mode === 'queue') this.setMode('player'); } };
    a.finished.then(done, done);
  },
  setMode(m) {
    this.mode = m;
    /* "q" = the small-artwork layout that the queue and the lyrics share */
    this.el.classList.toggle('q', m !== 'player');
    this.el.classList.toggle('ly', m === 'lyrics');
    this.el.querySelector('[data-np="queue"]').classList.toggle('on', m === 'queue');
    const lyBtn = this.el.querySelector('[data-np="lyrics"]');
    lyBtn.classList.toggle('on', m === 'lyrics');
    lyBtn.setAttribute('aria-pressed', String(m === 'lyrics'));
    if (m === 'queue') { this.renderQueue(); this.q.scrollTop = 0; }
    if (m === 'lyrics') LyView.load(false); else LyView.stop();
    this.layoutArt();
  },
  layoutArt(noAnim) {
    const stage = this.el.querySelector('.np-stage'), art = this.el.querySelector('.np-art');
    const w = stage.clientWidth, h = stage.clientHeight;
    let x = 0, y = 0, size = 64;
    if (this.mode === 'player') { size = Math.max(80, Math.min(w, h)); x = (w - size) / 2; y = Math.max(0, (h - size) / 2); }
    if (noAnim) art.classList.add('noanim');
    art.style.left = x + 'px'; art.style.top = y + 'px'; art.style.width = size + 'px'; art.style.height = size + 'px';
    if (noAnim) { void art.offsetWidth; art.classList.remove('noanim'); }
  },
  render() {
    const s = Player.cur;
    if (!s) { this.close(); return; }
    const el = this.el;
    const artBox = el.querySelector('.np-art'), artImg = artBox.querySelector('img');
    artBox.classList.toggle('radio', !!s.isRadio);
    const u = s.coverArt ? api.cover(s.coverArt, 900) : '';
    if (artImg.dataset.u !== u) { artImg.dataset.u = u; if (u) { artImg.src = u; artImg.hidden = false; } else { artImg.removeAttribute('src'); artImg.hidden = true; } }
    this.setBg(s.coverArt ? api.cover(s.coverArt, 300) : '');
    setMarquee(el.querySelector('.np-t'), s.title);
    const a = el.querySelector('.np-a');
    a.textContent = s.artist || '';
    a.classList.toggle('lnk', !!s.artistId);
    el.querySelector('.q1').textContent = s.title;
    el.querySelector('.q2').textContent = s.artist || '';
    el.querySelector('.np-scrub').classList.toggle('live', !!s.isRadio);
    el.querySelectorAll('[data-np="star"], [data-np="more"], [data-np="lyrics"]').forEach((b) => { b.hidden = !!s.isRadio; });
    if (s.isRadio && this.mode === 'lyrics') this.setMode('player');
    this.renderStar(); this.state(); this.time(); this.renderModes();
    if (this.mode === 'queue') this.renderQueue();
    if (this.mode === 'lyrics') LyView.load(false);
  },
  renderStar() {
    const s = Player.cur;
    if (!s || !this.el) return;
    const on = Lib.isStarred(s);
    this.el.querySelectorAll('[data-np="star"]').forEach((b) => { b.innerHTML = on ? I.starFill : I.star; b.classList.toggle('on', on); });
  },
  renderModes() {
    if (!this.el) return;
    this.el.querySelector('.np-bottom [data-np="shuffle"]').classList.toggle('on', Player.shuffle);
  },
  setBg(u) {
    const [a, b] = this.el.querySelectorAll('.np-bg img');
    const front = b.style.opacity === '1' ? b : a, back = front === a ? b : a;
    if ((front.dataset.u || '') === u) return;
    back.dataset.u = u;
    const swap = () => { back.style.opacity = '1'; front.style.opacity = '0'; };
    if (u) { back.onload = swap; back.onerror = swap; back.src = u; } else { back.removeAttribute('src'); swap(); }
  },
  state() {
    if (!this.el) return;
    const playing = Player.playing;
    this.el.classList.toggle('paused', !playing);
    const t = this.el.querySelector('[data-np="toggle"]');
    t.innerHTML = playing ? I.pause : I.play;
    t.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  },
  time() {
    if (this.scrubbing || !Player.cur) return;
    const d = Player.duration();
    if (!isFinite(d)) { this.bar.style.width = '100%'; this.curEl.textContent = fmtTime(Player.time()); this.remEl.textContent = 'LIVE'; return; }
    this.showTime(Player.time(), d);
  },
  showTime(t, d) {
    this.bar.style.width = `${(d > 0 ? clamp(t / d, 0, 1) : 0) * 100}%`;
    this.curEl.textContent = fmtTime(t);
    this.remEl.textContent = '-' + fmtTime(Math.max(0, d - t));
  },
  action(act, btn) {
    const s = Player.cur;
    switch (act) {
      case 'close': this.close(); break;
      case 'toggle': Player.toggle(); break;
      case 'prev': Player.prev(); break;
      case 'next': Player.next(true); break;
      case 'queue': this.setMode(this.mode === 'queue' ? 'player' : 'queue'); break;
      case 'lyrics': if (s && !s.isRadio) this.setMode(this.mode === 'lyrics' ? 'player' : 'lyrics'); break;
      case 'shuffle': Player.setShuffle(!Player.shuffle); toast(Player.shuffle ? 'Shuffle On' : 'Shuffle Off', I.shuffle); break;
      case 'repeat': Player.cycleRepeat(); toast(Player.repeat === 'off' ? 'Repeat Off' : Player.repeat === 'all' ? 'Repeat All' : 'Repeat One', Player.repeat === 'one' ? I.repeat1 : I.repeat); break;
      case 'clear': Player.clearQueue(); break;
      case 'airplay': { const a = nativeAudio || $('#audio'); if (a && a.webkitShowPlaybackTargetPicker) a.webkitShowPlaybackTargetPicker(); break; }
      case 'star': if (s && !s.isRadio) toggleSongStar(s); break;
      case 'more': if (s && !s.isRadio) songMenu(s); break;
      case 'artist': if (s && s.artistId) { this.close(); Nav.push('artist', { id: s.artistId, name: s.artist }); } break;
      default: break;
    }
    void btn;
  },

  /* ----- queue list ----- */
  renderQueue() {
    const box = this.q, up = Player.upNext, ctxItems = Player.upcoming(100), total = Player.upcomingCount();
    const qRow = (s, k, sec) => `<div class="qrow" data-sec="${sec}" data-k="${k}" data-press><div class="row-c"><div class="art">${img(s.coverArt, 150)}</div><div class="txt"><div class="t1">${esc(s.title)}</div><div class="t2">${esc(s.artist)}</div></div><span class="grip" aria-label="Drag to reorder">${I.grip}</span></div></div>`;
    let html = '';
    if (up.length) html += `<div class="qsec-h"><div><h3>Playing Next</h3></div><button class="qbtn" data-np="clear">Clear</button></div><div class="qsec" data-sec="next">${up.map((s, j) => qRow(s, j, 'next')).join('')}</div>`;
    const title = Player.ctx && Player.ctx.title ? `From ${esc(Player.ctx.title)}` : '';
    html += `<div class="qsec-h"><div><h3>Continue Playing</h3>${title ? `<div class="sub">${title}</div>` : ''}</div><div class="qtg"><button class="qbtn${Player.shuffle ? ' on' : ''}" data-np="shuffle" aria-label="Shuffle">${I.shuffle}</button><button class="qbtn${Player.repeat !== 'off' ? ' on' : ''}" data-np="repeat" aria-label="Repeat">${Player.repeat === 'one' ? I.repeat1 : I.repeat}</button></div></div>`;
    html += ctxItems.length
      ? `<div class="qsec" data-sec="ctx">${ctxItems.map(({ song, k }) => qRow(song, k, 'ctx')).join('')}</div>`
      : `<div class="q-empty">${Player.repeat === 'all' && Player.ctx && Player.ctx.order.length ? 'The list starts over after this song.' : 'Nothing else is lined up.'}</div>`;
    if (total > ctxItems.length) html += `<div class="q-more">and ${plural(total - ctxItems.length, 'more song')}</div>`;
    const st = box.scrollTop;
    box.innerHTML = html;
    box.scrollTop = st;
  },
  songFor(row) {
    const k = +row.dataset.k;
    return row.dataset.sec === 'next' ? Player.upNext[k] : Player.ctxSong(k);
  },
  removeRow(row, song) {
    const k = +row.dataset.k;
    this.queueDirty = false;
    if (row.dataset.sec === 'next') Player.removeQueue(k, song); else Player.removeCtx(k, song);
    if (this.queueDirty) this.renderQueue();
  },
  jump(row) {
    const k = +row.dataset.k, song = this.songFor(row);
    if (row.dataset.sec === 'next') Player.jumpQueue(k, song); else Player.jumpCtx(k, song);
  },
  flushQueue() { if (this.queueDirty) { this.queueDirty = false; if (this.isOpen && this.mode === 'queue') this.renderQueue(); } },

  /* ----- gestures ----- */
  bindDrag() {
    let st = null;
    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || !this.isOpen || e.target.closest('.npq, .npl, .np-scrub')) return;
      st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, v: 0, ly: e.clientY, lt: performance.now() };
    });
    el.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dy = e.clientY - st.y0, dx = e.clientX - st.x0;
      if (!st.active) {
        if (dy > 10 && dy > Math.abs(dx)) { st.active = true; try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } suppressClicks(400); }
        else if (Math.abs(dx) > 10 || dy < -10) { st = null; return; } else return;
      }
      const now = performance.now();
      st.v = (e.clientY - st.ly) / Math.max(1, now - st.lt); st.ly = e.clientY; st.lt = now;
      el.style.transform = `translate3d(0,${Math.max(0, dy)}px,0)`;
    });
    const end = (e) => {
      if (!st || e.pointerId !== st.id) return;
      const s = st; st = null;
      if (!s.active) return;
      const dy = e.clientY - s.y0;
      if (e.type !== 'pointercancel' && (dy > 140 || s.v > 0.5)) { this.close(); return; }
      const from = el.style.transform;
      el.style.transform = 'translate3d(0,0,0)';
      el.animate([{ transform: from }, { transform: 'translate3d(0,0,0)' }], { duration: SP.snap.duration, easing: SP.snap.easing });
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  },
  bindScrub() {
    const sc = this.el.querySelector('.np-scrub'), bar = sc.querySelector('.np-bar');
    let st = null;
    sc.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      const d = Player.duration();
      if (!Player.cur || !isFinite(d) || d <= 0) return;
      st = { id: e.pointerId, x0: e.clientX, f0: clamp(Player.time() / d, 0, 1), d, f: null };
      try { sc.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      sc.classList.add('drag'); this.scrubbing = true;
    });
    sc.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x0;
      if (st.f == null && Math.abs(dx) < 3) return;
      st.f = clamp(st.f0 + dx / (bar.clientWidth || 1), 0, 1);
      this.showTime(st.f * st.d, st.d);
    });
    const end = (e) => {
      if (!st || e.pointerId !== st.id) return;
      const s = st; st = null;
      sc.classList.remove('drag'); this.scrubbing = false;
      if (s.f != null && e.type !== 'pointercancel') Player.seek(s.f * s.d);
      this.time();
    };
    sc.addEventListener('pointerup', end);
    sc.addEventListener('pointercancel', end);
  },
  bindReorder() {
    const box = this.q;
    let st = null;
    box.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest('.grip');
      if (!grip || !e.isPrimary || st) return;
      const row = grip.closest('.qrow'), rows = Array.from(row.parentElement.children);
      Press.cancel(); Swipe.close(true);
      this.dragging = true;
      st = { id: e.pointerId, row, rows, i: rows.indexOf(row), to: rows.indexOf(row), y0: e.clientY, y: e.clientY, s0: box.scrollTop, h: row.offsetHeight || 57, sec: row.dataset.sec, raf: 0, song: this.songFor(row) };
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      row.classList.add('lift');
      rows.forEach((r) => { if (r !== row) r.classList.add('shift'); });
      const loop = () => {
        if (!st) return;
        const r = box.getBoundingClientRect();
        if (st.y < r.top + 55) box.scrollTop -= 7; else if (st.y > r.bottom - 55) box.scrollTop += 7;
        this.reorderMove(st);
        st.raf = requestAnimationFrame(loop);
      };
      st.raf = requestAnimationFrame(loop);
    });
    box.addEventListener('pointermove', (e) => { if (st && e.pointerId === st.id) { st.y = e.clientY; this.reorderMove(st); } });
    const end = (e) => {
      if (!st || e.pointerId !== st.id) return;
      const s = st; st = null;
      cancelAnimationFrame(s.raf);
      suppressClicks(300);
      this.dragging = false; this.queueDirty = false;
      if (s.to !== s.i && e.type !== 'pointercancel') { if (s.sec === 'next') Player.moveQueue(s.i, s.to, s.song); else Player.moveCtx(s.i, s.to, s.song); }
      else this.renderQueue();
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
  },
  reorderMove(st) {
    const dy = (st.y - st.y0) + (this.q.scrollTop - st.s0);
    st.row.style.transform = `translateY(${dy}px)`;
    const to = clamp(st.i + Math.round(dy / st.h), 0, st.rows.length - 1);
    st.to = to;
    st.rows.forEach((r, j) => {
      if (r === st.row) return;
      let shift = 0;
      if (j > st.i && j <= to) shift = -st.h; else if (j < st.i && j >= to) shift = st.h;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  },
};

/* scrolling title for long names */
function setMarquee(wrap, text) {
  if (!wrap) return;
  wrap.classList.remove('run');
  wrap.innerHTML = `<div class="mq"><span>${esc(text)}</span></div>`;
  requestAnimationFrame(() => {
    const mq = wrap.firstElementChild, span = mq && mq.firstElementChild;
    if (!span || !wrap.clientWidth) return;
    const w = span.scrollWidth;
    if (w - wrap.clientWidth > 2) {
      mq.innerHTML = `<span>${esc(text)}</span><span aria-hidden="true">${esc(text)}</span>`;
      const dist = w + 40;
      mq.style.setProperty('--d', dist + 'px');
      mq.style.setProperty('--dur', (dist / 30 / 0.78).toFixed(1) + 's');
      wrap.classList.add('run');
    }
  });
}

/* ---------- spectrum colour picker ----------
   A saturation/brightness square, a hue bar, a hex box and recently used colours.
   onPreview(hex) runs while dragging or typing; onCommit(hex) when the choice is final. */
function colorPicker({ value, recent = [], onPreview, onCommit }) {
  const start = hexToRgb(value) || { r: 230, g: 67, b: 78 };
  let hsv = rgbToHsv(start), hex = rgbToHex(start), recentList = recent.slice(0, 8);
  const el = htmlEl(`<div class="cp">
    <div class="cp-sv" role="slider" tabindex="0" aria-label="Saturation and brightness"><span class="cp-sv-thumb"></span></div>
    <div class="cp-hue" role="slider" tabindex="0" aria-label="Hue" aria-valuemin="0" aria-valuemax="360"><span class="cp-hue-thumb"></span></div>
    <div class="cp-row">
      <span class="cp-chip"></span>
      <input class="cp-hex" id="cp-hex" type="text" maxlength="7" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" enterkeyhint="done" aria-label="Hex colour code">
      <div class="cp-recent" aria-label="Recent colours"></div>
    </div>
  </div>`);
  const sv = el.querySelector('.cp-sv'), svT = el.querySelector('.cp-sv-thumb');
  const hue = el.querySelector('.cp-hue'), hueT = el.querySelector('.cp-hue-thumb');
  const chip = el.querySelector('.cp-chip'), input = el.querySelector('.cp-hex'), recentBox = el.querySelector('.cp-recent');

  const paint = () => {
    const pure = rgbToHex(hsvToRgb(hsv.h % 360, 1, 1));
    sv.style.setProperty('--hue', pure);
    svT.style.left = `${hsv.s * 100}%`;
    svT.style.top = `${(1 - hsv.v) * 100}%`;
    svT.style.background = hex;
    hueT.style.left = `${(hsv.h / 360) * 100}%`;
    hueT.style.background = pure;
    hue.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
    sv.setAttribute('aria-valuetext', `saturation ${Math.round(hsv.s * 100)} percent, brightness ${Math.round(hsv.v * 100)} percent`);
    chip.style.background = hex;
  };
  const renderRecent = () => {
    recentBox.innerHTML = recentList.map((c) => `<button type="button" style="--c:${esc(c)}" data-hex="${esc(c)}" aria-label="Use ${esc(c)}"></button>`).join('');
  };
  const emit = (commit) => {
    if (commit) {
      recentList = [hex].concat(recentList.filter((c) => c.toLowerCase() !== hex.toLowerCase())).slice(0, 8);
      renderRecent();
      if (onCommit) onCommit(hex);
    } else if (onPreview) onPreview(hex);
  };
  const fromHsv = (commit) => {
    hex = rgbToHex(hsvToRgb(hsv.h % 360, hsv.s, hsv.v));
    if (document.activeElement !== input) input.value = hex;
    paint();
    emit(commit);
  };
  const setHex = (h, commit) => {
    const c = hexToRgb(h);
    if (!c) return false;
    const next = rgbToHsv(c);
    /* greys have no hue of their own: keep the bar where it was */
    hsv = { h: next.s ? next.h : hsv.h, s: next.s, v: next.v };
    hex = rgbToHex(c);
    if (document.activeElement !== input) input.value = hex;
    paint();
    emit(commit);
    return true;
  };

  /* dragging: the square and the bar follow the finger, the colour is saved on release */
  const drag = (target, update) => {
    let id = null, startHex = hex;
    target.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || id !== null) return;
      id = e.pointerId; startHex = hex;
      try { target.setPointerCapture(id); } catch (err) { /* ignore */ }
      e.preventDefault();
      if (document.activeElement === input) input.blur();
      update(e); fromHsv(false);
    });
    target.addEventListener('pointermove', (e) => { if (e.pointerId === id) { update(e); fromHsv(false); } });
    /* a drag the system interrupts (pointercancel) goes back to where it started */
    const end = (e) => { if (e.pointerId !== id) return; id = null; if (e.type === 'pointercancel') setHex(startHex, false); else fromHsv(true); };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };
  drag(sv, (e) => {
    const r = sv.getBoundingClientRect();
    hsv.s = clamp((e.clientX - r.left) / r.width, 0, 1);
    hsv.v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
  });
  drag(hue, (e) => {
    const r = hue.getBoundingClientRect();
    hsv.h = clamp((e.clientX - r.left) / r.width, 0, 1) * 359.9;
  });

  /* keyboard */
  sv.addEventListener('keydown', (e) => {
    const k = e.key, d = e.shiftKey ? 0.1 : 0.02;
    if (k === 'ArrowLeft') hsv.s = clamp(hsv.s - d, 0, 1);
    else if (k === 'ArrowRight') hsv.s = clamp(hsv.s + d, 0, 1);
    else if (k === 'ArrowUp') hsv.v = clamp(hsv.v + d, 0, 1);
    else if (k === 'ArrowDown') hsv.v = clamp(hsv.v - d, 0, 1);
    else return;
    e.preventDefault(); fromHsv(true);
  });
  hue.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 15 : 3;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') hsv.h = clamp(hsv.h - d, 0, 359.9);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') hsv.h = clamp(hsv.h + d, 0, 359.9);
    else return;
    e.preventDefault(); fromHsv(true);
  });

  /* typing a code: shows as soon as it's a full code, saves on Done/Enter */
  const typed = () => { let v = input.value.trim(); if (v && v[0] !== '#') v = '#' + v; return v; };
  input.addEventListener('input', () => { const v = typed(); if (/^#[0-9a-f]{6}$/i.test(v)) setHex(v, false); });
  const commitTyped = () => { if (!setHex(typed(), true)) input.value = hex; };
  input.addEventListener('change', commitTyped);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });

  recentBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hex]');
    if (b) setHex(b.dataset.hex, true);
  });

  input.value = hex;
  renderRecent();
  paint();
  return el;
}

/* ---------- sheets, alerts, toasts ---------- */
const UI = {
  stack: [],
  isOpen() { return this.stack.length > 0; },
  closeAll() { this.stack.slice().reverse().forEach((c) => c(null)); },
  layer() { return $('#overlay'); },
  sheet({ head, title, items, cancel = true, onOpen }) {
    return new Promise((resolve) => {
      const bd = htmlEl('<div class="bd"></div>');
      const headHtml = head
        ? `<div class="sh-head"><div class="art${head.round ? ' mic' : ''}${head.list ? ' list' : ''}"${head.round ? ' style="border-radius:50%"' : ''}>${img(head.art, 150)}</div><div class="txt"><div class="t1">${esc(head.title)}</div>${head.sub ? `<div class="t2">${esc(head.sub)}</div>` : ''}${head.extra != null ? `<div class="t3">${esc(head.extra)}</div>` : ''}</div></div>`
        : '';
      const body = items.map((it, i) => (it === '-' ? '<div class="sh-gap"></div>'
        : `<button class="sh-item${it.red ? ' red' : ''}" data-i="${i}"${it.color ? ` style="--ic:${it.color}"` : ''}><span class="ic">${it.icon || ''}</span><span class="lb">${esc(it.label)}</span>${it.checked ? `<span class="ck">${I.check}</span>` : ''}</button>`)).join('');
      const sh = htmlEl(`<div class="sheet" role="dialog" aria-modal="true">${headHtml}${title ? `<div class="sh-title">${esc(title)}</div>` : ''}${body}${cancel ? '<button class="sh-cancel">Cancel</button>' : ''}</div>`);
      this.layer().append(bd, sh);
      void sh.offsetWidth;
      bd.classList.add('in'); sh.classList.add('in');
      if (onOpen) { try { onOpen(sh); } catch (e) { console.error(e); } }
      let closed = false;
      const close = (val) => {
        if (closed) return;
        closed = true;
        this.stack = this.stack.filter((c) => c !== close);
        bd.classList.remove('in'); sh.classList.remove('in');
        setTimeout(() => { bd.remove(); sh.remove(); }, 480);
        resolve(val);
      };
      this.stack.push(close);
      /* closed by a tap: the second tap of a quick double-tap mustn't reach the page behind */
      bd.addEventListener('click', () => { suppressClicks(350); close(null); });
      sh.addEventListener('click', (e) => {
        if (closed) return;
        const b = e.target.closest('.sh-item');
        if (b) { suppressClicks(350); const it = items[+b.dataset.i]; close(it); if (it && it.run) it.run(); return; }
        if (e.target.closest('.sh-cancel')) { suppressClicks(350); close(null); }
      });
    });
  },
  dialog({ title, message, input, value = '', placeholder = '', buttons, stacked = false }) {
    return new Promise((resolve) => {
      const bd = htmlEl('<div class="bd" style="z-index:90"></div>');
      const al = htmlEl(`<div class="alert" role="alertdialog" aria-modal="true"><div class="al-t">${esc(title)}</div>${message ? `<div class="al-m">${esc(message)}</div>` : ''}${input ? `<input class="al-in" type="text" autocomplete="off" autocapitalize="sentences" placeholder="${esc(placeholder)}" value="${esc(value)}" aria-label="${esc(title)}">` : ''}<div class="al-btns${stacked ? ' col' : ''}">${buttons.map((b, i) => `<button class="al-btn${b.primary ? ' primary' : ''}${b.red ? ' red' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`);
      this.layer().append(bd, al);
      const field = al.querySelector('.al-in');
      if (field) { field.focus(); field.select(); }
      void al.offsetWidth;
      bd.classList.add('in'); al.classList.add('in');
      let closed = false;
      const close = (val) => {
        if (closed) return;
        closed = true;
        this.stack = this.stack.filter((c) => c !== close);
        if (field) field.blur();
        bd.classList.remove('in'); al.classList.remove('in');
        setTimeout(() => { bd.remove(); al.remove(); }, 380);
        resolve(val);
      };
      this.stack.push(close);
      /* a question that opens under the finger (e.g. a double-tapped playlist row) mustn't be answered by the second tap */
      const readyAt = performance.now() + 350;
      al.addEventListener('click', (e) => {
        const b = e.target.closest('.al-btn');
        if (!b || closed || performance.now() < readyAt) return;
        suppressClicks(350);
        const btn = buttons[+b.dataset.i];
        close(btn.value === undefined ? (field ? field.value.trim() : true) : btn.value);
      });
      if (field) field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(field.value.trim()); } });
    });
  },
  prompt({ title, message, value, placeholder, ok = 'OK' }) {
    return this.dialog({ title, message, input: true, value, placeholder, buttons: [{ label: 'Cancel', value: null }, { label: ok, primary: true }] });
  },
  confirm({ title, message, ok = 'OK', red = false }) {
    return this.dialog({ title, message, buttons: [{ label: 'Cancel', value: false }, { label: ok, value: true, primary: !red, red }] });
  },
};
function toast(text, icon = I.check, color = 'var(--accent)') {
  const t = $('#toast');
  if (!t) return;
  t.querySelector('.tic').innerHTML = icon;
  t.style.setProperty('--c', color);
  t.style.setProperty('--tic-ink', color === 'var(--accent)' ? 'var(--on-accent)' : '#fff');
  t.querySelector('.tx').textContent = text;
  t.classList.add('in');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('in'), 1800);
}

/* ---------- mini player ---------- */
const Mini = {
  init() {
    const m = $('#mini');
    m.querySelector('.next').innerHTML = I.next;
    m.addEventListener('click', (e) => { if (!e.target.closest('.mini-btn')) NP.open(); });
    Player.on('change', () => { this.render(); refreshPlaying(); });
    Player.on('state', () => this.state());
    this.render();
  },
  render() {
    const s = Player.cur;
    Dock.setHasMini(!!s);
    if (!s) { this.state(); return; }
    const m = $('#mini'), im = m.querySelector('.art img');
    m.querySelector('.art').classList.toggle('radio', !!s.isRadio);
    const u = s.coverArt ? api.cover(s.coverArt, 150) : '';
    if (im.dataset.u !== u) { im.dataset.u = u; if (u) { im.src = u; im.hidden = false; } else { im.removeAttribute('src'); im.hidden = true; } }
    this.marquee();
    this.state();
  },
  marquee() { setMarquee($('#mini .mq-wrap'), Player.cur ? Player.cur.title : ''); },
  state() {
    const p = Player.playing, b = $('#mini .play');
    b.innerHTML = p ? I.pause : I.play;
    b.setAttribute('aria-label', p ? 'Pause' : 'Play');
    $('#app').classList.toggle('paused', !p);
  },
};

/* ---------- settings ---------- */
function currentAccentHex() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const c = cssColorToRgb(v);
  return c ? rgbToHex(c) : '#e6434e';
}
function openSettings() {
  const layer = UI.layer();
  const m = htmlEl('<div class="modal"><div class="bd"></div><div class="card" role="dialog" aria-modal="true" aria-label="Settings"><div class="m-nav">Settings<button class="done">Done</button></div><div class="m-body"></div></div></div>');
  const body = m.querySelector('.m-body');
  let picker = null; /* which spectrum picker is open: 'accent', 'glow' or none */
  let closed = false;
  const isPreset = (hex) => !hex || ACCENTS.some(([c]) => c && c.toLowerCase() === String(hex).toLowerCase());
  const glowMode = () => { const g = Settings.get('glowColor') || ''; return !g ? 'accent' : g.toLowerCase() === '#ffffff' ? 'white' : 'custom'; };

  const updateWarn = (hex) => {
    const warn = body.querySelector('.cp-warn');
    if (!warn) return;
    /* the built-in colours are chosen to work in both themes; only check custom ones */
    const c = isPreset(hex) ? null : hexToRgb(hex), bg = cssColorToRgb(getComputedStyle(document.body).backgroundColor);
    if (!c || !bg || contrastRatio(c, bg) >= 3) { warn.hidden = true; return; }
    warn.hidden = false;
    warn.textContent = `This colour is hard to see on the ${relLum(bg) < 0.4 ? 'dark' : 'light'} background, so buttons and icons in it may be hard to read.`;
  };
  const refreshAccentSwatches = (hex) => {
    const custom = !isPreset(hex);
    body.querySelectorAll('[data-accent]').forEach((b) => b.classList.toggle('on', (b.dataset.accent || '').toLowerCase() === (hex || '').toLowerCase()));
    const cs = body.querySelector('.swatch.custom[data-s="pick-accent"]');
    if (cs) { cs.classList.toggle('on', custom); cs.style.setProperty('--c', custom ? hex : 'transparent'); }
  };
  const makePicker = (kind) => {
    if (kind === 'accent') {
      return colorPicker({
        value: Settings.get('accent') || currentAccentHex(),
        recent: Settings.get('recentColors') || [],
        onPreview: (hex) => { if (closed) return; Settings.applyAccent(hex); refreshAccentSwatches(hex); updateWarn(hex); },
        onCommit: (hex) => { if (closed) return; Settings.set('accent', hex); Settings.applyAccent(hex); Settings.rememberColor(hex); refreshAccentSwatches(hex); updateWarn(hex); },
      });
    }
    const g = Settings.get('glowColor');
    return colorPicker({
      value: g && g.toLowerCase() !== '#ffffff' ? g : currentAccentHex(),
      recent: Settings.get('recentColors') || [],
      onPreview: (hex) => { if (!closed) Settings.applyGlow({ glowColor: hex }); },
      onCommit: (hex) => { if (closed) return; Settings.set('glowColor', hex); Settings.applyGlow(); Settings.rememberColor(hex); },
    });
  };
  const render = () => {
    const theme = Settings.get('theme'), acc = Settings.get('accent') || '', q = QUALITIES.find((x) => x[0] === Settings.get('quality')) || QUALITIES[0];
    const server = api.demo ? 'Demo library' : (api.server || location.host);
    const custom = !isPreset(acc);
    const glow = !!Settings.get('glow'), gm = glowMode(), gs = clamp(+Settings.get('glowStrength') || 5, 1, 10), gt = clamp(+Settings.get('glowSat') || 10, 1, 10);
    const seg = (attr, cur, opts) => `<div class="seg" role="radiogroup">${opts.map(([v, l]) => `<button role="radio" aria-checked="${cur === v}" class="${cur === v ? 'on' : ''}" ${attr}="${v}">${l}</button>`).join('')}</div>`;
    body.innerHTML = `
      <div class="g-h">Account</div>
      <div class="g"><div class="acct"><div class="avatar">${esc(initials(api.user || 'Me'))}</div><div class="txt"><div class="t1">${esc(api.user || '')}</div><div class="t2">${esc(server)}</div></div></div></div>
      <div class="g-h">Playback</div>
      <div class="g"><button class="g-row" data-s="quality" data-press>Streaming Quality<span class="v">${esc(q[1])}${I.chevR}</span></button></div>
      <div class="g-f">${esc(q[2])}. If a song won’t play in its original format, it’s converted to MP3 automatically.</div>
      <div class="g-h">Appearance</div>
      <div class="g">
        <div class="g-row">Theme${seg('data-theme-v', theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])}</div>
        <div class="g-row g-block">
          <div class="g-lb">Accent Colour</div>
          <div class="swatches">${ACCENTS.map(([c, n]) => `<button class="swatch${acc.toLowerCase() === c.toLowerCase() ? ' on' : ''}" data-accent="${c}" style="--c:${c || '#e6434e'}" aria-label="${n}"></button>`).join('')}<button class="swatch custom${custom ? ' on' : ''}" data-s="pick-accent" style="--c:${custom ? esc(acc) : 'transparent'}" aria-label="Pick any colour" aria-expanded="${picker === 'accent'}"></button></div>
          <div class="cp-slot" data-for="accent"></div>
          <p class="cp-warn" hidden></p>
        </div>
        <div class="g-row">Shrink Tab Bar on Scroll<button class="switch" role="switch" aria-checked="${!!Settings.get('shrink')}" data-s="shrink" aria-label="Shrink tab bar on scroll"></button></div>
      </div>
      <div class="g-f">The rainbow circle opens the full colour spectrum.</div>
      <div class="g-h">Now Playing</div>
      <div class="g">
        <div class="g-row">Progress Bar Glow<button class="switch" role="switch" aria-checked="${glow}" data-s="glow" aria-label="Progress bar glow"></button></div>
        ${glow ? `
        <div class="gp" aria-hidden="true"><div class="np-bar"><span class="np-track"></span><span class="np-fill" style="width:62%"></span></div><div class="gp-times"><span>1:52</span><span>-1:09</span></div></div>
        <div class="g-row">Colour${seg('data-glow-v', gm, [['accent', 'Accent'], ['white', 'White'], ['custom', 'Custom']])}</div>
        <div class="cp-slot" data-for="glow"></div>
        <div class="g-row"><span class="g-rl">Strength</span><input class="range" id="glow-strength" type="range" min="1" max="10" step="1" value="${gs}" style="--p:${((gs - 1) / 9) * 100}%" aria-label="Glow strength"><span class="gs-v" data-for="glow-strength">${gs}</span></div>
        <div class="g-row"><span class="g-rl">Saturation</span><input class="range" id="glow-sat" type="range" min="1" max="10" step="1" value="${gt}" style="--p:${((gt - 1) / 9) * 100}%" aria-label="Glow saturation"><span class="gs-v" data-for="glow-sat">${gt}</span></div>` : ''}
      </div>
      <div class="g-f">${glow ? 'Accent follows your accent colour. Custom opens the full spectrum. Higher saturation means a deeper colour with less white in the middle.' : 'Makes the song position bar in Now Playing glow.'}</div>
      <div class="g-h">Lyrics</div>
      <div class="g"><div class="g-row">Look Up Lyrics Online<button class="switch" role="switch" aria-checked="${!!Settings.get('lyricsOnline')}" data-s="lyricsOnline" aria-label="Look up lyrics online"></button></div></div>
      <div class="g-f">Lyrics come from your server first. When it has no timed lyrics for a song, Encore looks the song up on LRCLIB (lrclib.net), a free online lyrics library, by its title, artist and length.</div>
      <div class="g-h">Library</div>
      <div class="g"><button class="g-row" data-s="refresh" data-press>Refresh Library<span class="v">${I.refresh}</span></button></div>
      <div class="g-f">Reloads playlists, artists, albums, songs and play counts from your server.</div>
      ${Native ? `
      <div class="g-h">iPhone App</div>
      <div class="g">
        <button class="g-row" data-s="native-address" data-press>Encore’s Address<span class="v">${esc(location.host)}${I.chevR}</span></button>
        <button class="g-row" data-s="native-import" data-press>Bring Over Settings<span class="v">${I.chevR}</span></button>
      </div>
      <div class="g-f">Bring Over Settings copies your settings, listening time and hidden lyrics from the Home Screen version of Encore. Tap Copy Settings for the iPhone App there first.</div>` : api.demo ? '' : `
      <div class="g-h">iPhone App</div>
      <div class="g"><button class="g-row" data-s="native-export" data-press>Copy Settings for the iPhone App</button></div>
      <div class="g-f">Copies your settings, listening time and hidden lyrics, so Encore’s iPhone app can bring them over.</div>`}
      <div class="g" style="margin-top:30px"><button class="g-row red" data-s="signout" data-press>${api.demo ? 'Leave Demo' : 'Sign Out'}</button></div>
      <div class="g-f" style="text-align:center;margin-top:18px">Encore ${APP_VERSION}${Native && Native.appVersion ? ` · iPhone app ${esc(Native.appVersion)}` : ''}<br>Plays music from Subsonic-compatible servers like Navidrome</div>`;
    if (picker === 'glow' && !(glow && gm === 'custom')) picker = null;
    if (picker) {
      const slot = body.querySelector(`.cp-slot[data-for="${picker}"]`);
      if (slot) slot.appendChild(makePicker(picker));
    }
    updateWarn(acc);
  };
  render();
  layer.appendChild(m);
  void m.offsetWidth;
  m.classList.add('in'); m.querySelector('.bd').classList.add('in');
  const close = () => {
    if (closed) return;
    closed = true;
    UI.stack = UI.stack.filter((c) => c !== close);
    /* a colour that was being dragged but never let go of: put the saved one back */
    Settings.apply();
    m.classList.remove('in'); m.querySelector('.bd').classList.remove('in');
    setTimeout(() => m.remove(), 520);
  };
  UI.stack.push(close);
  m.querySelector('.bd').addEventListener('click', () => { suppressClicks(350); close(); });
  m.querySelector('.done').addEventListener('click', () => { suppressClicks(350); close(); });
  const GLOW_SLIDERS = { 'glow-strength': 'glowStrength', 'glow-sat': 'glowSat' };
  body.addEventListener('input', (e) => {
    const key = GLOW_SLIDERS[e.target.id];
    if (!key || closed) return;
    const v = clamp(+e.target.value || 5, 1, 10);
    e.target.style.setProperty('--p', `${((v - 1) / 9) * 100}%`);
    const lb = body.querySelector(`.gs-v[data-for="${e.target.id}"]`); if (lb) lb.textContent = String(v);
    Settings.applyGlow({ [key]: v });
  });
  body.addEventListener('change', (e) => {
    const key = GLOW_SLIDERS[e.target.id];
    if (!key || closed) return;
    Settings.set(key, clamp(+e.target.value || 5, 1, 10));
    Settings.applyGlow();
  });
  body.addEventListener('click', async (e) => {
    if (closed) return;
    const t = e.target.closest('[data-s], [data-theme-v], [data-accent], [data-glow-v]');
    if (!t) return;
    if (t.dataset.themeV) { Settings.set('theme', t.dataset.themeV); Settings.apply(); render(); return; }
    if (t.dataset.accent !== undefined) { Settings.set('accent', t.dataset.accent); Settings.apply(); if (picker === 'accent') picker = null; render(); return; }
    if (t.dataset.glowV) {
      const v = t.dataset.glowV;
      if (v === 'accent') { Settings.set('glowColor', ''); picker = null; }
      else if (v === 'white') { Settings.set('glowColor', '#ffffff'); picker = null; }
      else { if (glowMode() !== 'custom') Settings.set('glowColor', currentAccentHex()); picker = 'glow'; }
      Settings.applyGlow(); render(); return;
    }
    const s = t.dataset.s;
    if (s === 'pick-accent') {
      picker = picker === 'accent' ? null : 'accent';
      render();
      if (picker) { const slot = body.querySelector('.cp-slot[data-for="accent"]'); if (slot && slot.scrollIntoView) slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    } else if (s === 'glow') {
      Settings.set('glow', !Settings.get('glow')); Settings.applyGlow(); render();
    } else if (s === 'quality') {
      /* the iPhone app is told the new addresses for the coming songs (the one playing carries on) */
      UI.sheet({ title: 'Streaming Quality', items: QUALITIES.map(([v, l, d]) => ({ label: `${l} — ${d}`, checked: Settings.get('quality') === v, run: () => { Settings.set('quality', v); render(); NativeLink.soon(); } })) });
    } else if (s === 'native-export') {
      const ok = await copyText(Transfer.pack());
      toast(ok ? 'Copied. Now open the iPhone app.' : 'Couldn’t copy', ok ? I.check : I.xmark, ok ? 'var(--accent)' : 'var(--red)');
    } else if (s === 'native-import') {
      const text = await NativeLink.paste();
      if (closed) return;
      const got = Transfer.apply(text);
      if (!got || !got.length) { toast(!text ? 'Nothing to bring over' : got ? 'Nothing new to bring over' : 'That isn’t from Encore', I.xmark, 'var(--red)'); return; }
      render();
      toast(`Brought over ${got.join(', ').replace(/, ([^,]*)$/, ' and $1')}`, I.check);
    } else if (s === 'native-address') {
      const ok = await UI.confirm({ title: 'Change Encore’s address?', message: 'The app goes back to its first screen, where you can enter another address. At a new address you sign in again.', ok: 'Change' });
      if (ok && Native) Native.post({ type: 'changeAddress' });
    } else if (s === 'shrink') {
      Settings.set('shrink', !Settings.get('shrink')); if (!Settings.get('shrink')) Dock.setMin(false); render();
    } else if (s === 'lyricsOnline') {
      Settings.set('lyricsOnline', !Settings.get('lyricsOnline')); render();
    } else if (s === 'refresh') {
      close(); refreshLibrary();
    } else if (s === 'signout') {
      const ok = await UI.confirm({ title: api.demo ? 'Leave the demo?' : 'Sign out?', message: api.demo ? '' : 'Your queue on this device is cleared. Nothing changes on your server.', ok: api.demo ? 'Leave' : 'Sign Out', red: true });
      if (ok) { close(); App.signOut(); }
    }
  });
}
function refreshLibrary() {
  Lib.clear();
  Lyrics.clear();
  Nav.allPages().forEach((p) => { if (p.reload) p.reload(); });
  toast('Refreshing Library', I.refresh);
}

/* ---------- sign in ---------- */
const APP_ICON = `<svg viewBox="0 0 100 100"><defs><linearGradient id="encbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2238"/><stop offset="1" stop-color="#0d0c12"/></linearGradient><linearGradient id="encbar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e6434e"/><stop offset=".55" stop-color="#f09748"/><stop offset="1" stop-color="#ffd27a"/></linearGradient></defs><rect width="100" height="100" fill="url(#encbg)"/><g fill="url(#encbar)"><rect x="25" y="43" width="11" height="32" rx="5.5"/><rect x="44.5" y="25" width="11" height="50" rx="5.5"/><rect x="64" y="35" width="11" height="40" rx="5.5"/></g></svg>`;
function normalizeServer(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  s = s.replace(/\/+$/, '').replace(/\/rest$/i, '');
  return s;
}
function showLogin(message) {
  const el = $('#login');
  el.hidden = false;
  const saved = store.get('lastLogin', {});
  el.innerHTML = `<div class="lg-in">
    <div class="lg-icon">${APP_ICON}</div>
    <h1 class="lg-title">Encore</h1>
    <p class="lg-sub">Sign in with your Navidrome account, or any Subsonic-compatible server.</p>
    <form class="lg-form" novalidate>
      <div class="lg-group">
        <div class="field"><label for="lg-server">Server</label><input id="lg-server" type="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="This server" value="${esc(saved.server || '')}"></div>
        <div class="field"><label for="lg-user">Username</label><input id="lg-user" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="username" value="${esc(saved.user || '')}"></div>
        <div class="field"><label for="lg-pass">Password</label><input id="lg-pass" type="password" autocomplete="current-password"></div>
      </div>
      <p class="lg-note">Leave Server empty when Encore is hosted next to Navidrome (that’s how the setup guide installs it). Otherwise enter the address you use for Navidrome, like http://192.168.1.20:4533.</p>
      <button class="lg-btn" type="submit">Sign In</button>
      <p class="lg-err"${message ? '' : ' hidden'}>${esc(message || '')}</p>
    </form>
    <button class="lg-link" data-act="demo" type="button">Try the Demo Library</button>
  </div>`;
  const form = el.querySelector('form'), err = el.querySelector('.lg-err'), btn = el.querySelector('.lg-btn');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const server = normalizeServer(el.querySelector('#lg-server').value);
    const user = el.querySelector('#lg-user').value.trim(), pass = el.querySelector('#lg-pass').value;
    err.hidden = true;
    if (!user || !pass) { err.textContent = 'Enter your username and password.'; err.hidden = false; return; }
    if (server && location.protocol === 'https:' && server.startsWith('http:')) {
      err.textContent = 'This page is on https, so browsers block an http server address. Leave Server empty, or use an https address.';
      err.hidden = false; return;
    }
    btn.disabled = true; btn.textContent = 'Signing In…';
    const salt = randomSalt(), token = md5(pass + salt);
    const client = new Subsonic({ server, user, token, salt });
    try {
      await client.get('ping', {}, { timeout: 12000 });
      store.set('creds', { server, user, token, salt });
      store.set('lastLogin', { server, user });
      App.useApi(client);
      App.enter();
    } catch (ex) {
      let msg = ex.message;
      if (ex.code === 'network' && !server) msg = 'Couldn’t find Navidrome at this address. Check that the /rest/ path is proxied to Navidrome, or enter its address in Server.';
      else if (ex.code === 'network') msg = `Couldn’t reach ${server}. Check the address and that your phone can reach it (Wi-Fi or Tailscale).`;
      err.textContent = msg; err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = 'Sign In'; }
  });
}

/* ---------- wiring ---------- */
const Actions = {
  back: () => Nav.pop(),
  go: (el) => Nav.push(el.dataset.view),
  album: (el) => { if (el.dataset.id) Nav.push('album', { id: el.dataset.id }); },
  artist: (el) => { if (el.dataset.id) Nav.push('artist', { id: el.dataset.id, name: el.dataset.name }); },
  playlist: (el) => Nav.push('playlist', { id: el.dataset.id }),
  'song-more': (el) => { const row = el.closest('.srow'), s = songForRow(row); if (s) songMenu(s, listCtx(row)); },
  toggle: () => Player.toggle(),
  next: () => Player.next(true),
  settings: () => openSettings(),
  'new-playlist': () => newPlaylist(),
  'lib-menu': () => UI.sheet({ items: [
    { icon: I.refresh, label: 'Refresh Library', run: refreshLibrary },
    { icon: I.gear, label: 'Settings', run: openSettings },
  ] }),
  demo: () => { store.set('creds', { demo: true }); App.useApi(new DemoApi()); App.enter(); },
};
const ASYNC_PLAY = new Set(['mix-all', 'mix-fav', 'artist-play', 'station']);
function runAction(el, e) {
  const act = el.dataset.act, page = pageFromEl(el);
  if (ASYNC_PLAY.has(act)) Player.prime();
  if (page && page.handlers[act]) { page.handlers[act](el, e); return; }
  if (Actions[act]) Actions[act](el, e);
}
function playRow(row) {
  if (row.classList.contains('open') || row._sw) { Swipe.close(); return; }
  const host = row.closest('[data-list]'), L = host && host._list;
  if (!L) return;
  Player.playList(L.songs, +row.dataset.i, L.title);
}

const App = {
  started: false,
  start() {
    Settings.load(); Settings.apply();
    document.documentElement.style.setProperty('--spring', SP.ui.easing);
    Nav.init(); Dock.init(); NP.init(); Mini.init();
    Swipe.init(); Press.init(); LongPress.init(); Back.init();
    Listen.init();
    this.bindEvents();
    const creds = store.get('creds');
    if (FORCE_DEMO || (creds && creds.demo)) { this.useApi(new DemoApi()); this.enter(); }
    else if (creds && creds.user && creds.token) { this.useApi(new Subsonic(creds)); this.enter(); this.verify(); }
    else { this.useApi(null); showLogin(); }
    /* in the iPhone app: now that the queue is back, hear what the app did while this page wasn't running */
    NativeChrome.init();
    if (nativeAudio) nativeAudio.connect();
    this.started = true;
  },
  useApi(a) {
    Listen.save();
    api = a;
    Lyrics.clear();
    Player.setAudio(a && a.demo ? (this.fake || (this.fake = new FakeAudio())) : (nativeAudio || $('#audio')));
    Listen.load(!a || a.demo);
  },
  enter() {
    $('#login').hidden = true;
    $('#login').innerHTML = '';
    UI.closeAll();
    if (NP.isOpen) NP.close();
    Player.stop();
    Lib.clear();
    Nav.reset();
    Nav.cur = '';
    Nav.switchTab('library');
    Player.restore();
    Mini.render();
    /* in the iPhone app, after signing in: what is the app playing? */
    if (nativeAudio) nativeAudio.pull();
  },
  async verify() {
    try { await api.get('ping', {}, { timeout: 15000 }); }
    catch (e) { if (e.code === 40 || e.code === 41) this.authFailed(); }
  },
  authFailed() {
    this.signOut('Your sign-in stopped working. Sign in again.');
  },
  signOut(message) {
    UI.closeAll();
    if (NP.isOpen) NP.close();
    Player.stop();
    store.del('creds'); store.del('player');
    Lib.clear(); Nav.reset();
    this.useApi(null);
    showLogin(message);
  },
  bindEvents() {
    /* block the tap that ends a swipe or long-press from also triggering a button */
    document.addEventListener('click', (e) => {
      if (performance.now() < suppressUntil && !e.target.closest('.sw-b')) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    document.addEventListener('click', (e) => {
      const sw = e.target.closest('.sw-b');
      if (sw) { Swipe.tapAction(sw); return; }
      const tab = e.target.closest('#dock [data-tab]');
      if (tab) { Nav.switchTab(tab.dataset.tab); return; }
      if (e.target.closest('#tabpill') && Dock.min) { Dock.setMin(false); return; }
      const np = e.target.closest('[data-np]');
      if (np) { NP.action(np.dataset.np, np); return; }
      const actEl = e.target.closest('[data-act]');
      if (actEl) { runAction(actEl, e); return; }
      if (e.target.closest('.grip')) return;
      const row = e.target.closest('.srow');
      if (row) { playRow(row); return; }
      const q = e.target.closest('.qrow');
      if (q) { if (q.classList.contains('open') || q._sw) Swipe.close(); else NP.jump(q); }
    });
    document.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG') e.target.classList.add('broken'); }, true);
    document.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input')) return;
      if (e.key === 'Escape') { if (UI.isOpen()) UI.closeAll(); else if (NP.isOpen) NP.close(); else Nav.pop(); }
      if (e.key === ' ' && api) { e.preventDefault(); Player.toggle(); }
    });
    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        Nav.allPages().forEach((p) => p.vlists.forEach((v) => v.relayout()));
        if (NP.isOpen) { NP.layoutArt(true); LyView.sync(true); }
        Mini.marquee();
      }, 150);
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) Player.save(); });
    window.addEventListener('pagehide', () => Player.save());
    /* lets :active styles work on iOS */
    document.addEventListener('touchstart', () => {}, { passive: true });
  },
};

window.__encore = { App, Player, Nav, Lib, Settings, NP, Swipe, Dock, Listen, Lyrics, LyView, LRCLIB, md5, version: APP_VERSION, get api() { return api; },
  NativeLink, nativeAudio, nativeItem, Transfer, native: !!Native,
  LyHidden, lyricsUtil: { parseLRC, plainLyricLines, tidySynced, lyReadings, lyQueries, lyTitleMatch, lyArtistMatch, lrclibPick, lrclibResult, lyNoWords } };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => App.start());
else App.start();

})();
