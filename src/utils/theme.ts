// ── Theming: preset (paleta) × scheme × tamaño × fuente × movimiento ────────
// Fuente ÚNICA de verdad: la tabla PRESETS. Cada preset trae paleta clara/oscura y
// una fuente sugerida. Todo se aplica como variables inline en <html> (--color-*,
// --font-sans) + atributos (data-theme/data-preset/data-reduce-motion) y el root
// font-size (escala toda la UI). Los componentes no cambian: usan bg-surface / bg-brand.
//
// ➕ Añadir un preset = agregar UN objeto a PRESETS. Nada de CSS ni de boot.

export type ThemeScheme = "system" | "light" | "dark";
export type TextSize = "tiny" | "regular" | "large" | "xl";
export type FontChoice = "default" | "serif" | "mono";
type FontKind = "sans" | "serif" | "mono";

type Palette = {
  brand: string; "brand-2": string; "brand-fg": string;
  surface: string; "surface-2": string; "surface-3": string;
  border: string; ink: string; muted: string;
};

export type ThemePreset = {
  id: string;
  label: string;
  font: FontKind;
  light: Palette;
  dark: Palette;
};

export const PRESETS: ThemePreset[] = [
  { id: "ghosty", label: "Default", font: "sans",
    light: { brand: "#7c3aed", "brand-2": "#a78bfa", "brand-fg": "#ffffff", surface: "#ffffff", "surface-2": "#f6f5fb", "surface-3": "#ecebf6", border: "#e4e2f0", ink: "#1c1b22", muted: "#6b6975" },
    dark: { brand: "#a78bfa", "brand-2": "#7c3aed", "brand-fg": "#14121a", surface: "#14121a", "surface-2": "#1c1a25", "surface-3": "#272536", border: "#302d3f", ink: "#f2f1f7", muted: "#9995ad" } },
  { id: "slate", label: "Slate", font: "sans",
    light: { brand: "#4f46e5", "brand-2": "#818cf8", "brand-fg": "#ffffff", surface: "#ffffff", "surface-2": "#f1f5f9", "surface-3": "#e2e8f0", border: "#d3dbe6", ink: "#0f172a", muted: "#64748b" },
    dark: { brand: "#818cf8", "brand-2": "#4f46e5", "brand-fg": "#0b1220", surface: "#0f172a", "surface-2": "#1e293b", "surface-3": "#334155", border: "#334155", ink: "#f1f5f9", muted: "#94a3b8" } },
  { id: "dieter", label: "Dieter Rams", font: "sans",
    light: { brand: "#cc5500", "brand-2": "#f59e0b", "brand-fg": "#ffffff", surface: "#fafaf9", "surface-2": "#f5f5f4", "surface-3": "#e7e5e4", border: "#d6d3d1", ink: "#1c1917", muted: "#78716c" },
    dark: { brand: "#f59e0b", "brand-2": "#cc5500", "brand-fg": "#1c1917", surface: "#1c1917", "surface-2": "#292524", "surface-3": "#44403c", border: "#44403c", ink: "#fafaf9", muted: "#a8a29e" } },
  { id: "ocean", label: "Ocean", font: "sans",
    light: { brand: "#0891b2", "brand-2": "#22d3ee", "brand-fg": "#ffffff", surface: "#ffffff", "surface-2": "#f0f9fb", "surface-3": "#e0f2f7", border: "#cde8ee", ink: "#0c2830", muted: "#5b7681" },
    dark: { brand: "#22d3ee", "brand-2": "#0891b2", "brand-fg": "#06232b", surface: "#0a2229", "surface-2": "#0f2f38", "surface-3": "#164450", border: "#1d4c58", ink: "#e6f6fb", muted: "#85b0bb" } },
  { id: "forest", label: "Forest", font: "sans",
    light: { brand: "#059669", "brand-2": "#34d399", "brand-fg": "#ffffff", surface: "#ffffff", "surface-2": "#f0fdf4", "surface-3": "#dcfce7", border: "#cbe8d3", ink: "#08271a", muted: "#5b7a68" },
    dark: { brand: "#34d399", "brand-2": "#059669", "brand-fg": "#052117", surface: "#0a2018", "surface-2": "#0f2c20", "surface-3": "#16412f", border: "#1d4a37", ink: "#e7f7ef", muted: "#86b3a0" } },
  { id: "rose", label: "Rose", font: "sans",
    light: { brand: "#e11d48", "brand-2": "#fb7185", "brand-fg": "#ffffff", surface: "#ffffff", "surface-2": "#fff1f2", "surface-3": "#ffe4e6", border: "#fecdd3", ink: "#300711", muted: "#8a5b63" },
    dark: { brand: "#fb7185", "brand-2": "#e11d48", "brand-fg": "#2b0710", surface: "#1f0a0f", "surface-2": "#2b1016", "surface-3": "#3f1721", border: "#4a1d28", ink: "#f9e9ec", muted: "#b38a92" } },
  { id: "paper", label: "Paper", font: "serif",
    light: { brand: "#9a6b3f", "brand-2": "#c4915c", "brand-fg": "#ffffff", surface: "#faf7f0", "surface-2": "#f3ede1", "surface-3": "#e8dfce", border: "#ddd2bd", ink: "#2b2620", muted: "#6f6656" },
    dark: { brand: "#c4915c", "brand-2": "#9a6b3f", "brand-fg": "#201b14", surface: "#201b14", "surface-2": "#2a241b", "surface-3": "#3a3226", border: "#3f3628", ink: "#f2ece0", muted: "#a99a82" } },
  { id: "ink", label: "Ink", font: "sans",
    light: { brand: "#171717", "brand-2": "#525252", "brand-fg": "#ffffff", surface: "#ffffff", "surface-2": "#f5f5f5", "surface-3": "#e5e5e5", border: "#d4d4d4", ink: "#0a0a0a", muted: "#737373" },
    dark: { brand: "#e5e5e5", "brand-2": "#a3a3a3", "brand-fg": "#0a0a0a", surface: "#0a0a0a", "surface-2": "#171717", "surface-3": "#262626", border: "#2e2e2e", ink: "#fafafa", muted: "#8f8f8f" } },
  { id: "terminal", label: "Terminal", font: "mono",
    light: { brand: "#15803d", "brand-2": "#16a34a", "brand-fg": "#ffffff", surface: "#f7f8f7", "surface-2": "#ecefec", "surface-3": "#dde3dd", border: "#cdd6cd", ink: "#14261a", muted: "#5c6b60" },
    dark: { brand: "#22c55e", "brand-2": "#16a34a", "brand-fg": "#041007", surface: "#041007", "surface-2": "#08200f", "surface-3": "#0c3016", border: "#10401d", ink: "#b9f7c9", muted: "#5fae74" } },
  { id: "neon", label: "Neon", font: "mono",
    light: { brand: "#db2777", "brand-2": "#06b6d4", "brand-fg": "#ffffff", surface: "#ffffff", "surface-2": "#fdf2f8", "surface-3": "#fce7f3", border: "#f5d0e5", ink: "#2a0a1c", muted: "#8a5b74" },
    dark: { brand: "#f0abfc", "brand-2": "#22d3ee", "brand-fg": "#16011f", surface: "#0d0714", "surface-2": "#160c22", "surface-3": "#241436", border: "#33204a", ink: "#f5e9ff", muted: "#b596d6" } },
  { id: "solarized", label: "Solarized", font: "mono",
    light: { brand: "#268bd2", "brand-2": "#2aa198", "brand-fg": "#fdf6e3", surface: "#fdf6e3", "surface-2": "#eee8d5", "surface-3": "#e3ddc7", border: "#d8d0b8", ink: "#073642", muted: "#93a1a1" },
    dark: { brand: "#268bd2", "brand-2": "#2aa198", "brand-fg": "#002b36", surface: "#002b36", "surface-2": "#073642", "surface-3": "#0d4552", border: "#14515f", ink: "#eee8d5", muted: "#93a1a1" } },
  { id: "protanopia", label: "Protanopia", font: "sans",
    light: { brand: "#0072b2", "brand-2": "#e69f00", "brand-fg": "#ffffff", surface: "#ffffff", "surface-2": "#f2f4f7", "surface-3": "#e6eaf0", border: "#d4dae3", ink: "#10151c", muted: "#5b6675" },
    dark: { brand: "#56b4e9", "brand-2": "#e69f00", "brand-fg": "#0a1017", surface: "#0c1017", "surface-2": "#141a23", "surface-3": "#1e2732", border: "#2a3542", ink: "#eef2f7", muted: "#94a3b5" } },
];

export const FONT_STACKS: Record<FontKind, string> = {
  sans: `"Inter", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`,
  serif: `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif`,
  mono: `"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`,
};

const TEXT_SCALE: Record<TextSize, string> = { tiny: "14px", regular: "16px", large: "18px", xl: "20px" };

export type ThemeState = {
  preset: string;
  scheme: ThemeScheme;
  textSize: TextSize;
  font: FontChoice;
  reduceMotion: boolean;
  darkSidebar: boolean;
};

const KEYS = {
  preset: "gt.preset", scheme: "gt.scheme", textSize: "gt.textSize",
  font: "gt.font", reduceMotion: "gt.reduceMotion", darkSidebar: "gt.darkSidebar",
};

export function readTheme(): ThemeState {
  if (typeof localStorage === "undefined")
    return { preset: "ghosty", scheme: "system", textSize: "regular", font: "default", reduceMotion: false, darkSidebar: false };
  return {
    preset: localStorage.getItem(KEYS.preset) || "ghosty",
    scheme: (localStorage.getItem(KEYS.scheme) as ThemeScheme) || "system",
    textSize: (localStorage.getItem(KEYS.textSize) as TextSize) || "regular",
    font: (localStorage.getItem(KEYS.font) as FontChoice) || "default",
    reduceMotion: localStorage.getItem(KEYS.reduceMotion) === "1",
    darkSidebar: localStorage.getItem(KEYS.darkSidebar) === "1",
  };
}

export function resolveDark(scheme: ThemeScheme): boolean {
  if (scheme === "dark") return true;
  if (scheme === "light") return false;
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export function presetById(id: string): ThemePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export function paletteVars(preset: ThemePreset, dark: boolean): Record<string, string> {
  const pal = dark ? preset.dark : preset.light;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pal)) out[`--color-${k}`] = v;
  return out;
}

export function applyTheme(s: ThemeState): void {
  if (typeof document === "undefined") return;
  const preset = presetById(s.preset);
  const dark = resolveDark(s.scheme);
  const r = document.documentElement;
  r.setAttribute("data-theme", dark ? "dark" : "light");
  if (preset.id !== "ghosty") r.setAttribute("data-preset", preset.id);
  else r.removeAttribute("data-preset");
  for (const [k, v] of Object.entries(paletteVars(preset, dark))) r.style.setProperty(k, v);
  const fontKind: FontKind = s.font === "default" ? preset.font : s.font;
  r.style.setProperty("--font-sans", FONT_STACKS[fontKind]);
  r.style.fontSize = TEXT_SCALE[s.textSize];
  if (s.reduceMotion) r.setAttribute("data-reduce-motion", "1");
  else r.removeAttribute("data-reduce-motion");
}

// ── Store reactivo mínimo ────────────────────────────────────────────────────
let current: ThemeState | null = null;
const listeners = new Set<() => void>();

export function getTheme(): ThemeState {
  if (!current) current = readTheme();
  return current;
}

export function setThemePartial(patch: Partial<ThemeState>): void {
  const next = { ...getTheme(), ...patch };
  current = next;
  try {
    localStorage.setItem(KEYS.preset, next.preset);
    localStorage.setItem(KEYS.scheme, next.scheme);
    localStorage.setItem(KEYS.textSize, next.textSize);
    localStorage.setItem(KEYS.font, next.font);
    localStorage.setItem(KEYS.reduceMotion, next.reduceMotion ? "1" : "0");
    localStorage.setItem(KEYS.darkSidebar, next.darkSidebar ? "1" : "0");
  } catch {}
  applyTheme(next);
  listeners.forEach((l) => l());
}

export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function watchSystemScheme(): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const s = getTheme();
    if (s.scheme === "system") {
      applyTheme(s);
      listeners.forEach((l) => l());
    }
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

// Script inline en <head> para leer localStorage y aplicar tema antes del primer paint (evita FOUC).
export const THEME_BOOT = `(function(){try{
var P=${JSON.stringify(Object.fromEntries(PRESETS.map((p) => [p.id, { light: p.light, dark: p.dark, font: p.font }])))};
var F=${JSON.stringify(FONT_STACKS)};
var T=${JSON.stringify(TEXT_SCALE)};
var g=function(k,d){return localStorage.getItem(k)||d};
var id=g('${KEYS.preset}','ghosty');var sc=g('${KEYS.scheme}','system');
var ts=g('${KEYS.textSize}','regular');var fo=g('${KEYS.font}','default');
var rm=localStorage.getItem('${KEYS.reduceMotion}')==='1';
var dark=sc==='dark'||(sc==='system'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);
var pr=P[id]||P.ghosty;var pal=dark?pr.dark:pr.light;var r=document.documentElement;
r.setAttribute('data-theme',dark?'dark':'light');
if(id&&id!=='ghosty')r.setAttribute('data-preset',id);else r.removeAttribute('data-preset');
for(var k in pal)r.style.setProperty('--color-'+k,pal[k]);
r.style.setProperty('--font-sans',F[fo==='default'?pr.font:fo]);
r.style.fontSize=T[ts]||T.regular;
if(rm)r.setAttribute('data-reduce-motion','1');
}catch(e){}})();`;
