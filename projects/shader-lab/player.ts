// Visual Synth Player: one snapshot at a time, played through its mapped macro knobs.
// Instrument-first counterpart to the film-first showcase; the full editor stays one click away.
import { createRenderer, type SynthRenderer } from "./renderer";
import { manifests, isGenerator, validatePatch, type Patch, type SynthNode } from "./core";
import { type CatalogPreset } from "./preset-catalog";
import { playerSnapshots } from "./player-snapshots";
import { exportClip } from "./export";
import { pickProfile, type MidiProfile } from "./midi-profiles";
import { outputSize, sizeLadder } from "./display-size";
import { exportSizeFor, shareFormats, type ShareFormatId } from "./share-formats";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const snapshots: CatalogPreset[] = playerSnapshots();
const basePalettes = ["Tidal silk", "Ember veil", "Opal current", "Redwood pop", "Acid canopy", "Maroon sun", "Simpsonwave", "Ion storm", "Solar candy"];
const extraPalettes: Record<string, string[]> = {
  hyperbolic: ["Iridescent", "Stained glass", "Luma only"],
  quasicrystal: ["Iridescent", "Stained glass", "Luma only"],
  polytope: ["Iridescent", "Stained glass", "Luma only"],
  multigrid: ["Zellige glaze", "Delft glaze", "Terracotta glaze"],
};
// Sources whose palette parameter is their own short list rather than the shared stops.
const ownPalettes: Record<string, string[]> = { fizz: ["White can", "Frost blue", "Chrome night"] };
const attractorPrints = ["Cyanotype", "Van Dyke", "Platinum", "Oxblood", "Luma only", "Neon"];

interface Macro { node: string; param: string; label: string; cc: number }
interface ControlValue { label: string; value: number; min: number; max: number }
type ControlValues = [number, number, number, number];
let preset: CatalogPreset;
let base: Patch;          // knob-edited values (Morph = 0)
let target: Patch;        // Morph = 1: seeded mutation of every other continuous parameter
let morph = 0;
let mutation = 1;
let macros: Macro[] = [];
let morphCC = 1;
let midiProfile: MidiProfile = pickProfile([]);
let dirty = true;
let time = 0;
let running = true;
let frame9x16 = new URLSearchParams(location.search).get("frame") === "9x16";
let exportFormat: ShareFormatId = defaultExportFormat();
let undoValues: ControlValues | null = null;
let controlAnimation = 0;

// ---------- Morph target ----------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const skipped = (node: SynthNode, key: string) =>
  ["palette", "print", "seed", "grid", "offset"].includes(key) || ["lfo", "adsr", "gate", "output"].includes(node.type) ||
  macros.some((m) => m.node === node.id && m.param === key) ||
  [preset.touch?.x, preset.touch?.y].some((t) => t?.node === node.id && t.param === key);
function makeTarget() {
  const r = rng(mutation * 2654435761 + preset.id.length);
  target = structuredClone(base);
  for (const node of target.nodes) {
    for (const [key, spec] of Object.entries(manifests[node.type].params)) {
      if (!spec.modulatable || skipped(node, key)) continue;
      const span = spec.max - spec.min;
      const v = node.params[key]! + span * (r() - 0.5) * 0.5;
      node.params[key] = Math.min(spec.max, Math.max(spec.min, v));
    }
  }
}
function effective(): Patch {
  const out = structuredClone(base);
  if (morph <= 0) return out;
  for (const node of out.nodes) {
    const t = target.nodes.find((n) => n.id === node.id)!;
    for (const [key, spec] of Object.entries(manifests[node.type].params)) {
      if (!spec.modulatable || skipped(node, key)) continue;
      node.params[key] = node.params[key]! + (t.params[key]! - node.params[key]!) * morph;
    }
  }
  return out;
}

// ---------- Knobs ----------
const ARC = 270, START = 135;
function polar(r: number, deg: number) { const a = (deg * Math.PI) / 180; return [40 + r * Math.cos(a), 40 + r * Math.sin(a)]; }
function arc(from: number, to: number) {
  const [x1, y1] = polar(32, from), [x2, y2] = polar(32, to);
  return `M${x1} ${y1} A32 32 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}
interface KnobView { el: HTMLElement; set(v: number): void; learn(on: boolean): void; cc(n: number | null): void }
function knob(label: string, className: string, get: () => number, put: (v: number) => void, format: () => string, reset: () => void, onLearn: () => void): KnobView {
  const el = document.createElement("div");
  el.className = `knob ${className}`; el.tabIndex = 0;
  el.setAttribute("role", "slider"); el.setAttribute("aria-label", label);
  el.innerHTML = `<svg viewBox="0 0 80 80" aria-hidden="true"><path class="track" d="${arc(START, START + ARC)}"/><path class="value"/><circle class="cap" cx="40" cy="40" r="22"/><line class="pointer" x1="40" y1="40" x2="40" y2="24"/></svg><button class="label" type="button" title="Click, then move a MIDI control to map it"></button><output></output><span class="cc"></span>`;
  const value = el.querySelector<SVGPathElement>(".value")!, pointer = el.querySelector<SVGLineElement>(".pointer")!;
  const lab = el.querySelector<HTMLButtonElement>(".label")!, out = el.querySelector("output")!, cc = el.querySelector<HTMLSpanElement>(".cc")!;
  lab.textContent = label;
  lab.onclick = onLearn;
  const set = (v: number) => {
    const deg = START + ARC * v;
    value.setAttribute("d", v > 0.002 ? arc(START, deg) : "");
    const [x, y] = polar(18, deg);
    pointer.setAttribute("x2", String(x)); pointer.setAttribute("y2", String(y));
    out.textContent = format();
    el.setAttribute("aria-valuenow", v.toFixed(3));
  };
  let drag: { y: number; v: number } | null = null;
  el.addEventListener("pointerdown", (e) => { if ((e.target as HTMLElement).closest(".label")) return; drag = { y: e.clientY, v: get() }; el.setPointerCapture(e.pointerId); });
  el.addEventListener("pointermove", (e) => { if (!drag) return; const k = e.shiftKey ? 800 : 220; put(Math.min(1, Math.max(0, drag.v + (drag.y - e.clientY) / k))); set(get()); });
  el.addEventListener("pointerup", () => { drag = null; });
  el.addEventListener("dblclick", () => { reset(); set(get()); });
  el.addEventListener("wheel", (e) => { e.preventDefault(); put(Math.min(1, Math.max(0, get() - Math.sign(e.deltaY) * 0.02))); set(get()); }, { passive: false });
  el.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.02 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.02 : 0;
    if (d) { e.preventDefault(); put(Math.min(1, Math.max(0, get() + d))); set(get()); }
  });
  set(get());
  return { el, set, learn: (on) => lab.classList.toggle("learning", on), cc: (n) => { cc.textContent = n === null ? "" : `CC ${n}`; } };
}

let views: KnobView[] = [];
let morphView: KnobView;
let learning: number | "morph" | null = null;
function spec(m: Macro) { const node = base.nodes.find((n) => n.id === m.node)!; return { node, meta: manifests[node.type].params[m.param]! }; }
function norm(m: Macro) { const { node, meta } = spec(m); return (node.params[m.param]! - meta.min) / (meta.max - meta.min); }
function setNorm(m: Macro, v: number) {
  const { node, meta } = spec(m);
  const raw = meta.min + v * (meta.max - meta.min);
  node.params[m.param] = Math.min(meta.max, Math.max(meta.min, meta.min + Math.round((raw - meta.min) / meta.step) * meta.step));
  dirty = true;
}
function renderKnobs() {
  const box = $("knobs");
  box.replaceChildren();
  views = macros.map((m, i) => {
    const { meta } = spec(m);
    const digits = Math.max(0, Math.ceil(-Math.log10(meta.step)));
    const original = preset.patch.nodes.find((n) => n.id === m.node)!.params[m.param] ?? meta.default;
    const view = knob(m.label, "", () => norm(m), (v) => setNorm(m, v), () => spec(m).node.params[m.param]!.toFixed(digits),
      () => { spec(m).node.params[m.param] = original; dirty = true; }, () => toggleLearn(i));
    box.append(view.el);
    return view;
  });
  morphView = knob("Morph", "morph", () => morph, (v) => { morph = v; dirty = true; }, () => `${Math.round(morph * 100)}%`,
    () => { morph = 0; dirty = true; }, () => toggleLearn("morph"));
  box.append(morphView.el);
  showCCs();
}
function toggleLearn(which: number | "morph") {
  learning = learning === which ? null : which;
  views.forEach((v, i) => v.learn(learning === i));
  morphView.learn(learning === "morph");
  if (learning !== null) status(midiAccess ? "Move a MIDI knob to map it." : "Turn on MIDI first, then move a knob.", 2500);
}
function showCCs() {
  const on = !!midiAccess;
  views.forEach((v, i) => v.cc(on ? macros[i]!.cc : null));
  morphView?.cc(on ? morphCC : null);
}

function controlValues(): ControlValues {
  return [spec(macros[0]!).node.params[macros[0]!.param]!, spec(macros[1]!).node.params[macros[1]!.param]!, spec(macros[2]!).node.params[macros[2]!.param]!, morph];
}
function controlValueDetails(): ControlValue[] {
  return [
    ...macros.map((m) => {
      const { node, meta } = spec(m);
      return { label: m.label, value: node.params[m.param]!, min: meta.min, max: meta.max };
    }),
    { label: "Morph", value: morph, min: 0, max: 1 },
  ];
}
function setControlValues(values: ControlValues) {
  macros.forEach((m, i) => {
    const { node, meta } = spec(m);
    node.params[m.param] = Math.min(meta.max, Math.max(meta.min, values[i]!));
    views[i]?.set(norm(m));
  });
  morph = Math.min(1, Math.max(0, values[3]));
  morphView?.set(morph);
  dirty = true;
  updateTestHook();
}
function syncUndoUi() {
  $<HTMLButtonElement>("undo").disabled = !undoValues;
}
function randomInSafeRange(min: number, max: number, step = 0.01) {
  const span = max - min;
  const raw = min + span * (0.1 + Math.random() * 0.8);
  const snapped = min + Math.round((raw - min) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}
function animateControls(from: ControlValues, to: ControlValues) {
  const token = ++controlAnimation;
  const reduce = matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (reduce) { setControlValues(to); return; }
  const startAt = performance.now();
  const duration = 400;
  const tick = (now: number) => {
    if (token !== controlAnimation) return;
    const t = Math.min(1, (now - startAt) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    setControlValues(from.map((v, i) => v + (to[i]! - v) * eased) as ControlValues);
    if (t < 1) requestAnimationFrame(tick);
    else setControlValues(to);
  };
  requestAnimationFrame(tick);
}
function randomizeControls() {
  const before = controlValues();
  let next = before;
  for (let attempt = 0; attempt < 8 && next.filter((v, i) => v !== before[i]!).length < 2; attempt++) {
    next = [
      ...macros.map((m) => {
        const { meta } = spec(m);
        return randomInSafeRange(meta.min, meta.max, meta.step);
      }),
      randomInSafeRange(0, 1, 0.01),
    ] as ControlValues;
  }
  undoValues = before;
  syncUndoUi();
  animateControls(before, next);
  status("Randomized knobs and Morph", 1200);
}
function undoRandomize() {
  if (!undoValues) return;
  const restore = undoValues;
  undoValues = null;
  syncUndoUi();
  controlAnimation++;
  setControlValues(restore);
  status("Randomize undone", 1200);
}

// ---------- MIDI (profile defaults are best-known and unverified on hardware) ----------
let midiAccess: MIDIAccess | null = null;
function applyMidiProfile(profile: MidiProfile) {
  midiProfile = profile;
  macros.forEach((m, i) => { m.cc = profile.knobs[i] ?? m.cc; });
  morphCC = profile.morph;
  showCCs();
}
async function toggleMidi() {
  if (midiAccess) {
    for (const input of midiAccess.inputs.values()) input.onmidimessage = null;
    midiAccess = null; $("midi").setAttribute("aria-pressed", "false"); $("notes").hidden = true; showCCs(); return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess();
    const inputs = [...midiAccess.inputs.values()];
    for (const input of inputs) input.onmidimessage = onMidi;
    applyMidiProfile(pickProfile(inputs.map((i) => i.name ?? "")));
    $("midi").setAttribute("aria-pressed", "true");
    $("notes").hidden = false;
    status(inputs.length ? `MIDI: ${midiProfile.name} (${inputs.map((i) => i.name).join(", ")})` : "MIDI on, but no input devices are connected.", 3000);
    showCCs();
  } catch (e) {
    status(`MIDI unavailable: ${e instanceof Error ? e.message : String(e)}`, 4000);
  }
}
// Pads and arcade buttons (e.g. Midi Fighter 3D, which starts at note 36): immediate triggers.
const padActions: (() => void)[] = [
  () => step(-1), () => step(1), () => $("mutate").click(), () => $("play").click(),
  ...[0, 1 / 3, 2 / 3, 1].map((v) => () => { morph = v; morphView.set(v); dirty = true; }),
  () => cyclePalette(-1), () => cyclePalette(1),
  () => $("randomize").click(),
];
function cyclePalette(d: number) {
  const select = $<HTMLSelectElement>("palette");
  if (select.disabled) return;
  select.selectedIndex = (select.selectedIndex + d + select.options.length) % select.options.length;
  select.dispatchEvent(new Event("change"));
}
function onMidi(e: MIDIMessageEvent) {
  const [st, cc, val] = e.data ?? [];
  if (st !== undefined && (st & 0xf0) === 0x90 && (val ?? 0) > 0) {
    const action = midiProfile.pads.indexOf(cc ?? -1);
    if (action >= 0) padActions[action]?.();
    return;
  }
  if (st === undefined || (st & 0xf0) !== 0xb0) return;
  const v = (val ?? 0) / 127;
  if (learning !== null) {
    if (learning === "morph") morphCC = cc!; else macros[learning]!.cc = cc!;
    toggleLearn(learning); showCCs(); return;
  }
  if (cc === morphCC || midiProfile.tilt?.includes(cc ?? -1)) { morph = v; morphView.set(v); dirty = true; return; }
  const i = macros.findIndex((m) => m.cc === cc);
  if (i >= 0) { setNorm(macros[i]!, v); views[i]!.set(norm(macros[i]!)); }
}

// ---------- Touch / XY ----------
// Dragging on the picture plays the snapshot's touch mapping: x/y set parameters and, for
// simulations, each move injects at the pointer (performance-only, not recorded in the patch).
let touching = false;
function contentPoint(e: PointerEvent) {
  const canvas = $<HTMLCanvasElement>("screen"), box = canvas.getBoundingClientRect();
  const aspect = canvas.width / canvas.height, w = Math.min(box.width, box.height * aspect), h = w / aspect;
  const x = (e.clientX - box.left - (box.width - w) / 2) / w, y = (e.clientY - box.top - (box.height - h) / 2) / h;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
function touchAt(e: PointerEvent) {
  const t = preset.touch, pt = contentPoint(e);
  if (!t || !pt) return;
  for (const [axis, v] of [["x", pt.x], ["y", 1 - pt.y]] as const) {
    const target = t[axis];
    if (!target) continue;
    const macro = { node: target.node, param: target.param, label: axis, cc: -1 };
    setNorm(macro, v);
    const i = macros.findIndex((m) => m.node === target.node && m.param === target.param);
    if (i >= 0) views[i]!.set(norm(macros[i]!));
  }
  if (t.inject) renderer?.live({ node: t.inject, kind: "inject", x: pt.x, y: pt.y, radius: 0.035, amount: 1 });
}
const stage = document.querySelector<HTMLElement>(".stage")!;
stage.addEventListener("pointerdown", (e) => { if (!preset.touch) return; touching = true; stage.setPointerCapture(e.pointerId); touchAt(e); });
stage.addEventListener("pointermove", (e) => { if (touching) touchAt(e); });
stage.addEventListener("pointerup", () => { touching = false; });
stage.addEventListener("pointercancel", () => { touching = false; });

// ---------- Snapshot selection ----------
let listQuery = "";
let listActive = 0;
function groupedSnapshots(query = "") {
  const q = query.trim().toLowerCase();
  const matches = q ? snapshots.filter((s) => `${s.bank} ${s.name} ${s.description} ${s.controls.map((c) => c.label).join(" ")}`.toLowerCase().includes(q)) : snapshots;
  return [...new Set(snapshots.map((s) => s.bank))]
    .map((bank) => ({ bank, items: matches.filter((s) => s.bank === bank) }))
    .filter((group) => group.items.length);
}
function visibleSnapshots() {
  return groupedSnapshots(listQuery).flatMap((group) => group.items);
}
function setListActive(index: number) {
  const items = visibleSnapshots();
  if (!items.length) { listActive = 0; return; }
  listActive = (index + items.length) % items.length;
  const current = $(`snapshot-${items[listActive]!.id}`);
  current?.focus();
}
function paletteOptions() {
  const select = $<HTMLSelectElement>("palette");
  select.replaceChildren();
  const source = base.nodes.find((n) => isGenerator(n.type) && n.type !== "video");
  const key = source?.type === "attractor" ? "print" : "palette";
  const names = source?.type === "attractor" ? attractorPrints
    : ownPalettes[source?.type ?? ""] ?? [...basePalettes, ...(extraPalettes[source?.type ?? ""] ?? [])];
  select.disabled = !source || !(key in (source?.params ?? {}));
  // Sources without a palette (Julia, Frost Fizz finishes, simulations' own) hide the menu.
  select.closest<HTMLElement>(".pal")!.hidden = select.disabled;
  names.forEach((n, i) => select.add(new Option(n, String(i))));
  if (source && key in source.params) select.value = String(source.params[key]);
  select.onchange = () => {
    for (const node of base.nodes) if (isGenerator(node.type) && key in node.params) node.params[key] = Number(select.value);
    makeTarget(); dirty = true;
  };
}
function select(next: CatalogPreset) {
  preset = next;
  base = structuredClone(next.patch);
  macros = next.controls.map((c, i) => ({ ...c, cc: midiProfile.knobs[i] ?? 21 + i }));
  mutation = 1; morph = 0; undoValues = null; controlAnimation++; makeTarget();
  time = 0; dirty = true; resetNeeded = true;
  // A heavy snapshot may have stepped the size down; try full size again once this one is set.
  if (fallbackStep > 0) restoreSize = true;
  fallbackStep = 0;
  $("name").textContent = next.name;
  $("bank").textContent = `${next.bank} · ${snapshots.indexOf(next) + 1} / ${snapshots.length}`;
  $("desc").textContent = next.touch ? `${next.description} ✋ ${next.touch.hint}` : next.description;
  $("hint").textContent = next.touch ? `✋ ${next.touch.hint}` : "";
  document.body.classList.toggle("touchable", !!next.touch);
  renderKnobs(); paletteOptions(); renderDrawer();
  syncUndoUi();
  history.replaceState(null, "", `#${next.id}`);
  updateTestHook();
}
function step(d: number) { select(snapshots[(snapshots.indexOf(preset) + d + snapshots.length) % snapshots.length]!); }
function renderDrawer() {
  const drawer = $("drawer");
  drawer.replaceChildren();
  const search = document.createElement("input");
  search.id = "snapshot-filter";
  search.type = "search";
  search.placeholder = "Filter snapshots";
  search.autocomplete = "off";
  search.value = listQuery;
  search.setAttribute("aria-label", "Filter snapshots");
  search.oninput = () => { listQuery = search.value; listActive = 0; renderDrawer(); $<HTMLInputElement>("snapshot-filter").focus(); };
  search.onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setListActive(0); }
    if (e.key === "Enter") { const first = visibleSnapshots()[0]; if (first) { select(first); toggleDrawer(false); } }
    if (e.key === "Escape") { e.preventDefault(); toggleDrawer(false); $("title-picker").focus(); }
  };
  drawer.append(search);
  const groups = groupedSnapshots(listQuery);
  let flatIndex = 0;
  for (const { bank, items } of groups) {
    const h = document.createElement("h2"); h.textContent = bank; drawer.append(h);
    for (const s of items) {
      const b = document.createElement("button");
      const itemIndex = flatIndex++;
      b.id = `snapshot-${s.id}`;
      b.dataset.snapshotId = s.id;
      b.innerHTML = `<span></span><small></small>`;
      b.querySelector("span")!.textContent = s.name;
      b.querySelector("small")!.textContent = s.controls.map((c) => c.label).join(" · ");
      if (s === preset) b.setAttribute("aria-current", "true");
      if (itemIndex === listActive) b.setAttribute("data-active", "true");
      b.onclick = () => { select(s); toggleDrawer(false); };
      b.onkeydown = (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setListActive(itemIndex + 1); }
        if (e.key === "ArrowUp") { e.preventDefault(); setListActive(itemIndex - 1); }
        if (e.key === "Enter") { e.preventDefault(); select(s); toggleDrawer(false); }
        if (e.key === "Escape") { e.preventDefault(); toggleDrawer(false); $("title-picker").focus(); }
      };
      drawer.append(b);
    }
  }
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No snapshots";
    drawer.append(empty);
  }
  return;
  for (const bank of new Set(snapshots.map((s) => s.bank))) {
    const h = document.createElement("h2"); h.textContent = bank; drawer.append(h);
    for (const s of snapshots.filter((x) => x.bank === bank)) {
      const b = document.createElement("button");
      b.innerHTML = `<span></span><small></small>`;
      b.querySelector("span")!.textContent = s.name; b.querySelector("small")!.textContent = s.controls.map((c) => c.label).join(" · ");
      if (s === preset) b.setAttribute("aria-current", "true");
      b.onclick = () => { select(s); toggleDrawer(false); };
      drawer.append(b);
    }
  }
}
function toggleDrawer(open = $("drawer").hidden) {
  const drawer = $("drawer");
  drawer.hidden = !open;
  $("browse").setAttribute("aria-expanded", String(open));
  $("title-picker").setAttribute("aria-expanded", String(open));
  if (open) {
    listActive = Math.max(0, visibleSnapshots().findIndex((s) => s === preset));
    renderDrawer();
    requestAnimationFrame(() => $<HTMLInputElement>("snapshot-filter")?.focus());
  }
}

// ---------- Rendering ----------
let renderer: SynthRenderer | null = null;
let resetNeeded = true;
let statusTimer = 0;
let fallbackStep = 0;
let restoreSize = false;
let frameCounter = 0;
function status(text: string, ms = 0) {
  $("status").textContent = text;
  clearTimeout(statusTimer);
  if (ms) statusTimer = window.setTimeout(() => { $("status").textContent = ""; }, ms);
}
function updateTestHook() {
  (window as any).visualSynthPlayer = {
    snapshotCount: snapshots.length,
    snapshotGroups: groupedSnapshots().map((group) => ({ bank: group.bank, count: group.items.length })),
    currentSnapshot: preset ? { id: preset.id, name: preset.name, bank: preset.bank } : null,
    controls: macros.length === 3 ? controlValueDetails() : [],
    frameCounter,
    canvasSize: renderer ? [renderer.canvas.width, renderer.canvas.height] : [0, 0],
    fallbackStatus: $("status").textContent,
    frame9x16: isFrame9x16Active(),
  };
}
// Render at the screen's shape (every source is aspect-aware). Fine pointers use native
// pixels capped at 2K by default; touch keeps the older 0.9 MP budget.
function isFrame9x16Active() {
  return frame9x16 && innerWidth > innerHeight;
}
function updateFrameUi() {
  document.body.classList.toggle("frame-9x16", isFrame9x16Active());
  const button = $<HTMLButtonElement>("frame");
  button.setAttribute("aria-pressed", String(frame9x16));
}
function setFrame9x16(next: boolean) {
  frame9x16 = next;
  const params = new URLSearchParams(location.search);
  if (next) params.set("frame", "9x16");
  else params.delete("frame");
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  updateFrameUi();
  fallbackStep = 0;
  applyRenderSize();
}
function renderSize(): [number, number] {
  const aspect = isFrame9x16Active() ? 9 / 16 : Math.min(2.4, Math.max(0.42, innerWidth / Math.max(innerHeight, 1)));
  const params = new URLSearchParams(location.search);
  const res = params.get("res")?.toLowerCase();
  const finePointer = matchMedia?.("(pointer: fine)").matches ?? true;
  if (res !== "720" && (finePointer || res === "2k" || res === "4k")) {
    const cssHeight = Math.max(1, innerHeight);
    return outputSize({
      cssWidth: cssHeight * aspect,
      cssHeight,
      dpr: devicePixelRatio || 1,
      maxDimension: 8192,
      maxPixels: res === "4k" ? 3840 * 2160 : 2560 * 1440,
    });
  }
  const h = Math.round(Math.sqrt(921600 / aspect) / 8) * 8;
  return [Math.round((h * aspect) / 8) * 8, h];
}
let resizeTimer = 0;
function applyRenderSize() {
  if (!renderer) return false;
  const target = renderSize();
  for (const [index, [w, h]] of sizeLadder(target).entries()) {
    if (index < fallbackStep) continue;
    if (w === renderer.canvas.width && h === renderer.canvas.height) return true;
    try {
      renderer.resize(w, h);
      resetNeeded = true;
      dirty = true;
      updateTestHook();
      return true;
    } catch (error) {
      status(`Resolution fallback: ${error instanceof Error ? error.message : String(error)}`, 3000);
    }
  }
  return false;
}
async function tryLowerRenderSize(patch: Patch) {
  if (!renderer) return false;
  const ladder = sizeLadder(renderSize());
  let lastError: unknown;
  for (let nextStep = fallbackStep + 1; nextStep < ladder.length; nextStep++) {
    const [w, h] = ladder[nextStep]!;
    try {
      renderer.resize(w, h);
      fallbackStep = nextStep;
      await renderer.setPatch(patch);
      resetNeeded = true;
      dirty = true;
      status(`Rendering at ${renderer.canvas.width}×${renderer.canvas.height} to fit GPU memory`);
      updateTestHook();
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) status(`Render failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  return false;
}
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    fallbackStep = 0;
    updateFrameUi();
    applyRenderSize();
  }, 250);
});
async function start() {
  const canvas = $<HTMLCanvasElement>("screen");
  try {
    let lastError: unknown;
    for (const [w, h] of sizeLadder(renderSize())) {
      try {
        renderer = await createRenderer(canvas, { width: w, height: h, preview: false });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!renderer) throw lastError;
  } catch (e) {
    status(`WebGPU is required: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  let last = performance.now(), busy = false;
  const loop = async (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (busy || document.hidden || !renderer) return;
    if (running) time += dt;
    if (dirty) {
      const patch = effective();
      if (validatePatch(patch).length) return;
      try {
        await renderer.setPatch(patch);
      } catch (error) {
        if (!await tryLowerRenderSize(patch)) {
          dirty = false;
          status(`Render failed: ${error instanceof Error ? error.message : String(error)}`);
          updateTestHook();
          return;
        }
      }
      if (resetNeeded) { renderer.reset(); resetNeeded = false; }
      dirty = false;
      if (restoreSize) { restoreSize = false; if (applyRenderSize()) status(""); }
    }
    busy = true;
    renderer.renderAt(time).then(() => { busy = false; frameCounter++; updateTestHook(); }, (e) => { busy = false; status(String(e instanceof Error ? e.message : e)); updateTestHook(); });
  };
  requestAnimationFrame(loop);
}

// ---------- Actions ----------
$("prev").onclick = () => step(-1);
$("next").onclick = () => step(1);
$("browse").onclick = () => toggleDrawer();
$("title-picker").onclick = () => toggleDrawer();
$("title-picker").onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleDrawer(); }
  if (e.key === "ArrowDown") { e.preventDefault(); toggleDrawer(true); setListActive(listActive); }
};
$("mutate").onclick = () => { mutation++; makeTarget(); if (morph === 0) { morph = 0.6; morphView.set(morph); } dirty = true; status(`Morph target #${mutation}`, 1200); };
$("randomize").onclick = randomizeControls;
$("undo").onclick = undoRandomize;
$("play").onclick = () => { running = !running; $("play").textContent = running ? "Pause" : "Play"; $("play").setAttribute("aria-pressed", String(running)); };
$("midi").onclick = toggleMidi;
$("frame").onclick = () => setFrame9x16(!frame9x16);
$("edit").onclick = (e) => {
  e.preventDefault();
  const patch = { ...effective(), name: `${preset.name} · player` };
  const bytes = new TextEncoder().encode(JSON.stringify(patch));
  let bin = ""; bytes.forEach((b) => { bin += String.fromCharCode(b); });
  const encoded = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  window.open(`/projects/shader-lab/?patch=${encoded}`, "_blank", "noopener");
};
function defaultExportFormat(): ShareFormatId {
  try {
    const saved = localStorage.getItem("visual-synth-player-export-format") as ShareFormatId | null;
    if (saved && shareFormats.some((format) => format.id === saved)) return saved;
  } catch {}
  return innerHeight > innerWidth ? "vertical" : "landscape";
}
function rememberExportFormat(format: ShareFormatId) {
  exportFormat = format;
  try { localStorage.setItem("visual-synth-player-export-format", format); } catch {}
}
function renderExportMenu() {
  const menu = $("export-menu");
  menu.replaceChildren(
    ...shareFormats.map((format) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = format.label;
      button.setAttribute("aria-current", String(format.id === exportFormat));
      button.onclick = () => void exportChosen(format.id);
      return button;
    }),
  );
}
function setExportMenu(open: boolean) {
  const menu = $("export-menu");
  const button = $<HTMLButtonElement>("export");
  renderExportMenu();
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}
async function exportChosen(formatId: ShareFormatId) {
  rememberExportFormat(formatId);
  setExportMenu(false);
  const button = $<HTMLButtonElement>("export");
  const [width, height] = exportSizeFor(formatId);
  button.disabled = true;
  try {
    const blob = await exportClip(effective(), { format: "mp4", width, height, fps: 30, duration: Math.min(preset.duration || 12, 16),
      onProgress: (f) => { button.textContent = `${Math.round(f * 100)}%`; } });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${preset.id}-${formatId}.mp4`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { status(`Export failed: ${e instanceof Error ? e.message : String(e)}`, 5000); }
  finally { button.disabled = false; button.textContent = "Export clip"; }
}
$("export").onclick = () => setExportMenu($("export-menu").hidden);
document.addEventListener("click", (event) => {
  if (!(event.target as HTMLElement).closest?.(".export-wrap")) setExportMenu(false);
  if (!(event.target as HTMLElement).closest?.("#drawer,#browse,#title-picker")) toggleDrawer(false);
});
renderExportMenu();
updateFrameUi();
addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest?.("input,select,textarea")) return;
  if (e.key === "h" || e.key === "H") document.body.classList.toggle("hide-ui");
  if (e.key === "f" || e.key === "F") {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }
  if (e.key === "ArrowRight" && !(e.target as HTMLElement).closest?.(".knob")) step(1);
  if (e.key === "ArrowLeft" && !(e.target as HTMLElement).closest?.(".knob")) step(-1);
  if (e.key === " " && !(e.target as HTMLElement).closest?.("button")) { e.preventDefault(); $("play").click(); }
  if (e.key === "m" || e.key === "M") $("mutate").click();
  if (e.key === "r" || e.key === "R") $("randomize").click();
  if (e.key === "u" || e.key === "U") $("undo").click();
  if (e.key === "l" || e.key === "L") toggleDrawer();
  if (e.key === "v" || e.key === "V") setFrame9x16(!frame9x16);
  if (e.key === "Escape") toggleDrawer(false);
});
addEventListener("fullscreenchange", () => { fallbackStep = 0; updateFrameUi(); applyRenderSize(); });
addEventListener("hashchange", () => { const s = snapshots.find((x) => x.id === location.hash.slice(1)); if (s && s !== preset) select(s); });

select(snapshots.find((s) => s.id === location.hash.slice(1)) ?? snapshots[0]!);
updateTestHook();
void start();
