// ── KRONOS · Bloco B — Regra de cor "gestor-first" ──────────────────────────────
// Se o gestor mantém todas as séries na MESMA cor (ou no default), o sistema gera
// uma rampa harmônica da mesma família, ordenada por VALOR (hierarquia: maior valor
// = tom mais forte). Se o gestor DIFERENCIOU as cores, respeita a escolha dele.

const BRAND = '#F15A24';
const DEFAULT_GRAY = '#94a3b8';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const normHex = c => (c || '').toLowerCase().replace(/\s/g, '');

// ── Conversões HSL ⇄ HEX ────────────────────────────────────────────────────────
export function hexToHsl(hex) {
  let h = normHex(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0; const lig = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = lig > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hue = (b - r) / d + 2; break;
      default: hue = (r - g) / d + 4;
    }
    hue /= 6;
  }
  return { h: hue * 360, s: sat * 100, l: lig * 100 };
}

export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  const to = v => v.toString(16).padStart(2, '0');
  return '#' + to(f(0)) + to(f(8)) + to(f(4));
}

// ── Detecção "uniforme" (gestor deixou tudo igual ou no default) ─────────────────
export function isUniform(colors) {
  const nonEmpty = colors.map(normHex).filter(Boolean);
  if (!nonEmpty.length) return true;
  return nonEmpty.every(c => c === nonEmpty[0]);
}

// ── Rampa de n cores da mesma família, do tom mais forte (i=0) ao mais claro ──────
export function rampFromBase(baseHex, n) {
  if (n <= 0) return [];
  if (n === 1) return [baseHex];
  const { h, s, l } = hexToHsl(baseHex);
  const Lmin = clamp(l - 4, 30, 55);
  const Lmax = clamp(l + 34, 62, 84);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(hslToHex(h, clamp(s - t * 16, 34, 100), Lmin + (Lmax - Lmin) * t));
  }
  return out;
}

function pickBase(colors) {
  const common = colors.map(normHex).filter(Boolean)[0];
  return (!common || common === DEFAULT_GRAY) ? BRAND : common;
}

// ── API principal ────────────────────────────────────────────────────────────────
// colors: cores já resolvidas (podem incluir o default cinza)
// values: números na mesma ordem, usados p/ ordenar a hierarquia (opcional)
// Retorna as cores na ORDEM ORIGINAL de entrada.
export function resolveSeriesColors(colors, values) {
  if (!isUniform(colors)) return colors.slice();   // gestor diferenciou → respeita
  const ramp = rampFromBase(pickBase(colors), colors.length);
  const order = colors.map((_, i) => i)
    .sort((a, b) => (Number(values?.[b]) || 0) - (Number(values?.[a]) || 0));
  const out = new Array(colors.length);
  order.forEach((origIdx, rank) => { out[origIdx] = ramp[rank]; });
  return out;
}
