// Draws the Doodle Lab colored-pencil art as static SVGs into projects/doodle-lab/art/.
// Run: node projects/doodle-lab/tools/gen-art.mjs
// Each file is self-contained (its own filter + hatch patterns) because SVG used as an
// image cannot reference defs in the host page.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const OUT = fileURLToPath(new URL("../art/", import.meta.url));
mkdirSync(OUT, { recursive: true });

// Colored-pencil hatch fills: a light wash plus diagonal strokes.
const HUES = {
  red: ["#ee8f7b", "#bf3522"], green: ["#a9d196", "#3f8a48"], pine: ["#79ab84", "#1f5e38"],
  moss: ["#c3d98f", "#6f9a33"], blue: ["#b5d6ee", "#3b7fb8"], ochre: ["#f4d58f", "#c48a1c"],
  plum: ["#d3b0d2", "#7b3f7a"], brown: ["#d2ab83", "#7a4f2c"], skin: ["#f8d8bd", "#e2a27c"],
  white: ["#fffdf6", "#ddd5c6"], nose: ["#f4ab96", "#d6705a"], sky: ["#dcecf6", "#9cc3de"],
  far: ["#c9dcc4", "#8fb192"], far2: ["#b7cfc0", "#7fa295"], glass: ["#e6f3fb", "#a9d0ea"],
  pink: ["#f6c1cf", "#d8708f"], gray: ["#d9d4cc", "#8c8378"],
};
const LINE = {
  red: "#8a2416", green: "#2c5f31", pine: "#1b4a2c", moss: "#4d6d23", blue: "#2b5f8e", ochre: "#8a5d10",
  plum: "#5c2c5b", brown: "#5a3820", skin: "#a8674a", white: "#7d7466", nose: "#a24d3b", sky: "#6d98b8",
  far: "#7c9e80", far2: "#6f9184", glass: "#5f8fb0", pink: "#a4506b", gray: "#5d554b",
};
function patterns(step = 4, angle = 38) {
  return Object.entries(HUES).map(([k, [wash, stroke]], i) =>
    `<pattern id="h-${k}" width="${step}" height="${step}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle + (i % 3) * 7})">` +
    `<rect width="${step}" height="${step}" fill="${wash}"/><path d="M0 0V${step}" stroke="${stroke}" stroke-width="${(step * 0.36).toFixed(2)}"/></pattern>`).join("");
}
// Wobble (low-frequency displacement) and grain (high-frequency alpha mask).
function filter(id, { wob = 2.4, seed = 4, grain = 1.1, bite = 2.0 } = {}) {
  return `<filter id="${id}" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${seed}" result="w"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="w" scale="${wob}" xChannelSelector="R" yChannelSelector="G" result="s"/>` +
    `<feTurbulence type="fractalNoise" baseFrequency="${grain}" numOctaves="1" seed="${seed + 5}" result="g"/>` +
    `<feColorMatrix in="g" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -${bite} 0 0 0 ${(bite * 0.5 + 0.72).toFixed(2)}" result="m"/>` +
    `<feComposite in="s" in2="m" operator="in"/></filter>`;
}
const svg = (w, h, body, { step, angle, fx } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<defs>${filter("pc", fx)}${patterns(step, angle)}</defs>${body}</svg>\n`;

let uid = 0;
// shapes: [{d, fill:'red'|null, line:'red'|hex|null, w:1.5, dots:[..]}]; outlines drawn twice, offset.
function draw(shapes, { dx = 0.9, dy = 0.7, sw = 1.5 } = {}) {
  const id = `L${uid++}`;
  const fills = shapes.filter((s) => s.fill).map((s) => `<path d="${s.d}" fill="url(#h-${s.fill})"${s.o ? ` opacity="${s.o}"` : ""}/>`).join("");
  const lines = shapes.filter((s) => s.line !== null).map((s) => {
    const c = s.line ? (LINE[s.line] || s.line) : LINE[s.fill] || "#3a3128";
    return `<path d="${s.d}" stroke="${c}"${s.w ? ` stroke-width="${s.w}"` : ""}/>`;
  }).join("");
  return `<g filter="url(#pc)">${fills}<g id="${id}" fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${lines}</g>` +
    `<use href="#${id}" transform="translate(${dx} ${dy})" opacity=".45"/></g>`;
}
const at = (x, y, s, inner, r = 0) => `<g transform="translate(${x} ${y}) scale(${s})${r ? ` rotate(${r})` : ""}">${inner}</g>`;

// ---------- motifs (each drawn in a local box, origin at the base centre) ----------
const pine = (hue = "pine") => `<g transform="translate(0 -9)">` + draw([
  { d: "M-4 0 L-4 10 L4 10 L4 0", fill: "brown" },
  { d: "M0 -78 L-11 -54 L-6 -55 L-19 -32 L-12 -33 L-27 -6 C-12 -2 12 -2 27 -6 L12 -33 L19 -32 L6 -55 L11 -54 Z", fill: hue },
  { d: "M-6 -46 L2 -50 M-12 -24 L-2 -28 M4 -18 L14 -22", fill: null, line: hue, w: 1.1 },
]) + `</g>`;
const roundTree = (hue = "green") => `<g transform="translate(0 -9)">` + draw([
  { d: "M-4 10 C-3 0 -4 -10 -3 -18 L3 -18 C3 -10 4 0 5 10 Z", fill: "brown" },
  { d: "M-3 -12 L-11 -22 M3 -14 L10 -24", fill: null, line: "brown", w: 1.2 },
  { d: "M-20 -16 C-34 -16 -38 -32 -28 -38 C-34 -52 -20 -62 -8 -56 C-4 -70 16 -70 20 -56 C34 -60 42 -44 34 -36 C42 -28 34 -14 22 -16 C14 -8 -8 -8 -20 -16 Z", fill: hue },
  { d: "M-16 -40 C-12 -44 -8 -44 -6 -40 M8 -30 C12 -34 16 -34 18 -30 M4 -52 C6 -55 10 -55 12 -52", fill: null, line: hue, w: 1.1 },
]) + `</g>`;
const fern = (hue = "moss") => {
  let d = "M0 0 C-2 -14 2 -30 10 -40";
  const leaves = [];
  for (let i = 0; i < 7; i++) {
    const t = i / 7, x = -1 + t * 10 + t * t * 2, y = -4 - t * 34, len = 11 - i * 1.2;
    leaves.push(`M${x.toFixed(1)} ${y.toFixed(1)} q${(-len * 0.6).toFixed(1)} -2 ${(-len).toFixed(1)} ${(-len * 0.5).toFixed(1)}`);
    leaves.push(`M${x.toFixed(1)} ${y.toFixed(1)} q${(len * 0.6).toFixed(1)} 1 ${len.toFixed(1)} ${(-len * 0.2).toFixed(1)}`);
  }
  return draw([{ d, fill: null, line: hue, w: 1.6 }, { d: leaves.join(" "), fill: null, line: hue, w: 1.8 }]);
};
const grass = (hue = "green") => draw([{ d: "M-10 0 Q-9 -8 -12 -13 M-5 0 Q-4 -10 -1 -15 M0 0 Q1 -7 6 -11 M5 0 Q7 -6 12 -8", fill: null, line: hue, w: 1.4 }]);
const mushroom = (hue = "red", tilt = 0) => draw([
  { d: "M-6 0 C-5 -8 -5 -16 -4 -22 L5 -22 C4 -16 5 -8 7 0 Z", fill: "white", line: "white" },
  { d: "M-24 -20 C-23 -38 -10 -46 0 -46 C12 -46 24 -38 24 -20 C12 -24 -12 -24 -24 -20 Z", fill: hue },
  { d: "M-13 -33 m-3 0 a3 2.6 0 1 0 6 0 a3 2.6 0 1 0 -6 0 M5 -38 m-2.6 0 a2.6 2.2 0 1 0 5.2 0 a2.6 2.2 0 1 0 -5.2 0 M13 -28 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 M-3 -27 m-2 0 a2 1.8 0 1 0 4 0 a2 1.8 0 1 0 -4 0", fill: "white", line: "red", w: 1.1 },
]);
const fence = () => "";

// Gnome, standing, origin at feet centre; hat hue, tunic hue; extra = arm/prop shapes.
const gnomeBody = (hat = "red", tunic = "blue", extra = []) => draw([
  { d: "M-9 -2 C-15 -2 -16 4 -10 4 L-2 4 L-2 -4 Z M9 -2 C15 -2 16 4 10 4 L2 4 L2 -4 Z", fill: "brown" },
  { d: "M-13 -30 C-16 -18 -16 -8 -13 -2 L13 -2 C16 -8 16 -18 13 -30 Z", fill: tunic },
  { d: "M-14 -14 L14 -14 L14 -10 L-14 -10 Z", fill: "ochre", w: 1.1 },
  { d: "M-15 -46 C-17 -32 -9 -20 0 -16 C9 -20 17 -32 15 -46 C11 -40 6 -38 0 -38 C-6 -38 -11 -40 -15 -46 Z", fill: "white" },
  { d: "M-10 -50 C-10 -58 -5 -61 0 -61 C5 -61 10 -58 10 -50 C8 -45 -8 -45 -10 -50 Z", fill: "skin" },
  { d: "M-4.5 -46 a4.5 4 0 1 0 9 0 a4.5 4 0 1 0 -9 0", fill: "nose" },
  { d: "M-5 -51.5 l0.2 0.2 M5 -51.5 l0.2 0.2", fill: null, line: "#2a211a", w: 2.2 },
  { d: "M-17 -52 C-10 -62 -6 -78 2 -96 C6 -100 12 -99 13 -94 C10 -95 7 -94 6 -90 C9 -76 13 -62 17 -52 C8 -56 -8 -56 -17 -52 Z", fill: hat },
  ...extra,
]);
const gnomeLens = () => gnomeBody("red", "blue", [
  { d: "M12 -27 C18 -30 22 -34 26 -40", fill: null, line: "blue", w: 3.2 },
  { d: "M26 -40 L32 -48", fill: null, line: "brown", w: 3 },
  { d: "M33 -60 m-11 0 a11 11 0 1 0 22 0 a11 11 0 1 0 -22 0", fill: "glass", w: 2.2, line: "gray" },
  { d: "M27 -64 q3 -4 8 -4", fill: null, line: "#ffffff", w: 2 },
  { d: "M-12 -27 C-16 -24 -18 -20 -17 -16", fill: null, line: "blue", w: 3.2 },
]);

// ---------- files ----------
const files = {};

// Paper grain tile.
files["paper.svg"] = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260">` +
  `<filter id="g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="11" stitchTiles="stitch"/>` +
  `<feColorMatrix values="0 0 0 0 0.42  0 0 0 0 0.33  0 0 0 0 0.2  0 0 0 0.9 -0.36"/></filter>` +
  `<filter id="f" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves="2" seed="3" stitchTiles="stitch"/>` +
  `<feColorMatrix values="0 0 0 0 0.55  0 0 0 0 0.45  0 0 0 0 0.3  0 0 0 0.28 -0.1"/></filter>` +
  `<rect width="260" height="260" filter="url(#f)"/><rect width="260" height="260" filter="url(#g)"/></svg>\n`;

// Hand-drawn frame for border-image (slice 40). Corners overshoot like a quick pencil box.
const frame = (color, w = 1.8, size = 200, r = 22, fill = "") => {
  const a = 9, b = size - 9;
  const box = (o, j) => `M${a + r + o} ${a + j} L${b - r - o} ${a - j * 0.6} C${b - 4} ${a + 1} ${b + 0.5} ${a + 5} ${b - j} ${a + r} ` +
    `L${b + j * 0.5} ${b - r} C${b - 1} ${b - 3} ${b - 5} ${b + j} ${b - r} ${b - j} L${a + r} ${b + j * 0.4} C${a + 4} ${b - 1} ${a - 0.5} ${b - 5} ${a + j} ${b - r} ` +
    `L${a - j * 0.4} ${a + r} C${a + 1} ${a + 4} ${a + 5} ${a - 1} ${a + r + o + 6} ${a + j * 0.8}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><defs>${filter("pc", { wob: 2.2, seed: 7, grain: 0.9, bite: 0.9 })}</defs>` +
    (fill ? `<path d="${box(0, 0)}" fill="${fill}"/>` : "") +
    `<g filter="url(#pc)" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${box(0, 0.8)}" stroke-width="${w}"/><path d="${box(3, -0.7)}" stroke-width="${w * 0.7}" opacity=".55"/></g></svg>\n`;
};
files["frame-tray.svg"] = frame("#35533a", 2.4, 200, 26);
files["frame-card.svg"] = frame("#4a4136", 1.7, 120, 8);
files["frame-peek.svg"] = frame("#4a3a2c", 2.6, 200, 20);

// Pill outline (chips, counts, tags) and button outline; slice 14.
const pill = (color, w, W = 64, H = 32) => {
  const r = H / 2 - 3;
  const p = (j) => `M${3 + r} ${3 + j} L${W - 3 - r} ${3 - j * 0.5} C${W + 0.5} ${2 + j} ${W + 0.5} ${H - 2} ${W - 3 - r} ${H - 3 + j * 0.5} L${3 + r} ${H - 3 - j * 0.3} C${-0.5} ${H - 2} ${-0.5 + j} ${2} ${3 + r + 4} ${3 + j * 0.6}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${filter("pc", { wob: 1.2, seed: 5, grain: 1, bite: 1.3 })}</defs>` +
    `<g filter="url(#pc)" fill="none" stroke="${color}" stroke-linecap="round"><path d="${p(0.6)}" stroke-width="${w}"/><path d="${p(-0.8)}" stroke-width="${w * 0.6}" opacity=".5"/></g></svg>\n`;
};
files["pill.svg"] = pill("#5a4e40", 1.4);
files["pill-green.svg"] = pill("#2f6b37", 1.3);
files["pill-red.svg"] = pill("#9c2d1c", 1.4);
const btn = (color, w) => {
  const W = 80, H = 40;
  const p = (j) => `M12 ${4 + j} L${W - 12} ${4 - j * 0.6} C${W - 3} ${4} ${W - 3 + j} ${8} ${W - 4} ${16} L${W - 4 + j * 0.4} ${H - 14} C${W - 4} ${H - 5} ${W - 8} ${H - 4 + j} ${W - 14} ${H - 4} L12 ${H - 4 + j * 0.4} C5 ${H - 4} ${4 + j} ${H - 8} 4 ${H - 15} L${4 - j * 0.4} 14 C4 6 7 ${4 + j} 17 ${4 + j * 0.3}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${filter("pc", { wob: 1.4, seed: 9, grain: 1, bite: 1.2 })}</defs>` +
    `<g filter="url(#pc)" fill="none" stroke="${color}" stroke-linecap="round"><path d="${p(0.7)}" stroke-width="${w}"/><path d="${p(-0.9)}" stroke-width="${w * 0.6}" opacity=".55"/></g></svg>\n`;
};
files["btn.svg"] = btn("#4a4136", 1.7);
files["btn-play.svg"] = btn("#6e1a0e", 2.1);
files["btn-light.svg"] = btn("#fff8ec", 1.6);

// Wavy pencil rule that tiles horizontally (toolbar edge).
files["rule.svg"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 12" width="240" height="12"><defs>${filter("pc", { wob: 1, seed: 2, grain: 1, bite: 1.3 })}</defs>` +
  `<g filter="url(#pc)" fill="none" stroke="#4d6b45" stroke-linecap="round"><path d="M0 6 C40 3 80 9 120 6 S200 3 240 6" stroke-width="1.8"/><path d="M0 7.5 C50 5 90 10 130 7 S210 5 240 7.5" stroke-width="1" opacity=".5"/></g></svg>\n`;

// Scribble underline for titles.
files["scribble.svg"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 30" width="300" height="30" preserveAspectRatio="none"><defs>${filter("pc", { wob: 2, seed: 3, grain: 0.9, bite: 1.3 })}</defs>` +
  `<g filter="url(#pc)" fill="none" stroke-linecap="round"><path d="M6 16 C80 8 190 8 292 12" stroke="#c0392b" stroke-width="5"/><path d="M20 22 C100 15 200 17 280 18" stroke="#d98a2b" stroke-width="3.2" opacity=".8"/></g></svg>\n`;
files["scribble-green.svg"] = files["scribble.svg"].replace("#c0392b", "#3f8a48").replace("#d98a2b", "#8fbf5a");

// Mushroom cluster for tray corners (origin bottom-left region).
files["mushrooms.svg"] = svg(110, 76,
  at(20, 72, 0.9, grass("green")) + at(92, 72, 0.8, grass("moss")) +
  at(64, 72, 0.62, mushroom("red")) + at(40, 72, 1, mushroom("red")) + at(84, 72, 0.44, mushroom("ochre")) +
  at(10, 72, 0.6, fern("moss")));
files["mushrooms-b.svg"] = svg(100, 70,
  at(50, 66, 0.9, grass("moss")) + at(30, 66, 0.72, mushroom("plum")) + at(62, 66, 0.9, mushroom("red")) + at(88, 66, 0.55, fern("green")));

// Gnome peeking over an edge, holding a big pencil. Bottom edge = tray edge.
files["gnome-pencil.svg"] = svg(112, 100,
  // pencil behind, poking up diagonally
  draw([
    { d: "M66 100 L92 34 L101 37 L76 100 Z", fill: "ochre" },
    { d: "M92 34 L101 37 L101.5 21 Z", fill: "skin" },
    { d: "M98.5 27 L101.5 21 L101.8 28 Z", fill: "gray" },
    { d: "M96.5 36 L71 100", fill: null, line: "ochre", w: 1 },
  ]) +
  at(50, 134, 1, gnomeBody("green", "plum")) +
  draw([
    { d: "M22 100 C21 91 33 89 36 96 L36 100 Z", fill: "skin" },
    { d: "M64 100 C63 91 75 89 78 96 L78 100 Z", fill: "skin" },
    { d: "M27 94 L27 100 M31 93 L31 100 M69 94 L69 100 M73 93 L73 100", fill: null, line: "skin", w: 1 },
  ]));

// Gnome sitting on a mushroom, reading lab notes.
files["gnome-reader.svg"] = svg(124, 150,
  at(62, 146, 1.35, mushroom("red")) +
  at(62, 92, 0.9, gnomeBody("blue", "green", [
    { d: "M-18 -30 L2 -24 L20 -32 L20 -12 L2 -6 L-18 -12 Z", fill: "white", line: "brown", w: 1.3 },
    { d: "M2 -24 L2 -6 M-14 -24 L-3 -21 M-14 -19 L-3 -16 M6 -21 L16 -24 M6 -16 L16 -19", fill: null, line: "gray", w: 1 },
  ])) + at(106, 146, 0.8, grass("green")) + at(16, 146, 0.9, fern("moss")));

// Header grove: pines, round tree, mushrooms and the lens gnome inspecting one.
files["grove.svg"] = svg(380, 250,
  draw([{ d: "M4 240 C80 234 160 238 230 236 C290 234 340 238 376 240", fill: null, line: "moss", w: 2 }]) +
  at(78, 238, 2.1, pine("far")) + at(300, 236, 2.4, pine("pine")) + at(150, 238, 2.0, roundTree("green")) +
  at(348, 239, 1.3, pine("far2")) + at(36, 240, 1.3, pine("pine")) +
  at(232, 241, 1.12, gnomeLens()) + at(284, 241, 0.8, mushroom("red")) + at(318, 241, 0.5, mushroom("ochre")) +
  at(196, 241, 1, fern("moss")) + at(110, 241, 0.9, grass("green")) + at(342, 241, 0.8, grass("moss")) +
  draw([{ d: "M330 60 c4 -6 10 -6 12 0 c3 -4 8 -2 8 2 M244 36 c3 -4 7 -4 9 0 c2 -3 6 -2 6 1", fill: null, line: "gray", w: 1.3 }]));

// Faint far forest, fixed along the bottom of the viewport. Tiles horizontally (ground meets at y=118).
{
  let body = draw([{ d: "M0 150 L0 118 C80 104 160 112 240 106 C340 98 420 116 520 108 C570 104 600 110 640 118 L640 150 Z", fill: "far", line: null }]) +
    draw([{ d: "M0 118 C80 104 160 112 240 106 C340 98 420 116 520 108 C570 104 600 110 640 118", fill: null, line: "far", w: 1.3 }]);
  const xs = [40, 84, 128, 176, 222, 264, 312, 360, 404, 448, 496, 546, 598];
  xs.forEach((x, i) => {
    const s = 0.6 + ((i * 37) % 10) / 18, y = 114 + ((i * 13) % 7);
    body += i % 4 === 2 ? at(x, y, s * 0.9, roundTree(i % 2 ? "far" : "far2")) : at(x, y, s, pine(i % 3 ? "far" : "far2"));
  });
  files["forest-far.svg"] = svg(640, 150, body, { step: 5 });
}

// Near forest band for the footer. Tiles horizontally (ground meets at y=160).
{
  const ground = "C90 150 200 158 300 152 C420 146 520 160 640 152 C720 148 760 154 800 160";
  let body = draw([{ d: `M0 190 L0 160 ${ground} L800 190 Z`, fill: "moss", line: null }]) +
    draw([{ d: `M0 160 ${ground}`, fill: null, line: "moss", w: 1.4 }]);
  const items = [
    [52, 160, 1.3, "pine"], [112, 158, 1.1, "round"], [160, 156, 0.8, "fern"], [206, 156, 1.6, "pine"], [262, 155, 0.8, "mush"],
    [310, 154, 1.2, "round2"], [368, 153, 1.0, "pine2"], [414, 152, 1.0, "fern"], [470, 153, 1.4, "pine"], [528, 156, 0.6, "mush"],
    [570, 156, 1.1, "round"], [630, 152, 1.2, "pine2"], [684, 151, 0.9, "fern"], [728, 152, 1.5, "pine"], [770, 157, 0.9, "grass"],
  ];
  for (const [x, y, s, k] of items) {
    body += at(x, y, s, k === "pine" ? pine("pine") : k === "pine2" ? pine("green") : k === "round" ? roundTree("green") :
      k === "round2" ? roundTree("moss") : k === "fern" ? fern("moss") : k === "mush" ? mushroom("red") : grass("green"));
  }
  body += at(274, 156, 0.9, grass("green")) + at(540, 158, 1, grass("moss")) + at(136, 158, 1, grass("moss"));
  files["forest-near.svg"] = svg(800, 190, body);
}

// Side sprigs for wide screens.
files["edge-left.svg"] = svg(160, 300, at(84, 296, 2.8, pine("pine")) + at(140, 296, 1.1, fern("moss")) + at(24, 296, 1.2, grass("green")));
files["edge-right.svg"] = svg(160, 300, at(90, 296, 1.6, roundTree("green")) + at(28, 296, 0.8, mushroom("red")) + at(140, 296, 1.1, grass("moss")));

for (const [name, content] of Object.entries(files)) writeFileSync(OUT + name, content);
console.log(Object.keys(files).join(" "));
