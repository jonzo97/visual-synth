// Doodle Lab dashboard. Doodles are discovered from their metadata files at build/dev time,
// so contributors add three files and never edit this page.
const fresh = import.meta.glob("./doodles/*.json", { eager: true, import: "default" });
const snapshots = import.meta.glob("./snapshots/*.json", { eager: true, import: "default" });
const pack = import.meta.glob("./pack/*.json", { eager: true, import: "default" });
const gemini = import.meta.glob("./gemini/*.json", { eager: true, import: "default" });

const $ = (id) => document.getElementById(id);
const toEntry = (tray) => ([path, meta]) => {
  const base = path.replace(/\.json$/, "");
  // Invalid metadata is skipped loudly rather than breaking the whole page.
  if (!meta || typeof meta.title !== "string" || !meta.title) { console.warn(`Doodle Lab: ${path} has no title; skipped`); return null; }
  // meta.page may point elsewhere on this site (a tab inside a shared page, or the Visual Synth
  // Player) but never off-site: absolute URLs and protocol-relative paths are refused.
  let page = `${base}.html`;
  if (meta.page) {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(meta.page)) { console.warn(`Doodle Lab: ${path} links off-site; skipped`); return null; }
    page = meta.page.startsWith("/") ? meta.page : `./${meta.page}`;
  }
  return { ...meta, tray, slug: base.split("/").pop(), page, poster: `${base}.png` };
};
const entries = [
  ...Object.entries(fresh).map(toEntry("fresh")),
  ...Object.entries(snapshots).map(toEntry("snapshots")),
  ...Object.entries(pack).map(toEntry("pack")),
  ...Object.entries(gemini).map(toEntry("gemini")),
].filter(Boolean).map((e) => ({ ...e, tray: e.tags?.includes("archive") ? "archive" : e.tray }));

const trays = [
  { id: "fresh", title: "Instruments", note: "Playable doodles: a few knobs, many looks. Made by Claude and its lab agents." },
  { id: "snapshots", title: "Synth snapshots", note: "Visual Synth patches boiled down to three knobs and a Morph wheel. Each card shows its signal chain; Play opens the Player." },
  { id: "gemini", title: "Gemini experiments", note: "Made by Gemini 3.8 Flash in the foundry loop (brief, build, headless check, critique, bolder variant), then picked by Claude from their posters. Fast and rough; the best may become Visual Synth modules." },
  { id: "pack", title: "Genart night pack · Claude mobile demos", note: "Built in one Claude mobile session on Sep 22. Several now live inside the Visual Synth." },
  { id: "archive", title: "Archive", note: "Superseded drafts kept for history." },
];
const trayName = Object.fromEntries(trays.map((t) => [t.id, t.title]));

// Newest first inside each tray; ties sort by title.
entries.sort((a, b) => (b.made || "").localeCompare(a.made || "") || a.title.localeCompare(b.title));

// Filter chips only for tags shared by two or more doodles; one-off tags still match search.
const tagCounts = entries.flatMap((e) => e.tags || []).reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());
const allTags = [...tagCounts].filter(([t, n]) => n > 1 && t !== "archive").map(([t]) => t).sort();
let activeTag = "";
let query = "";
try { activeTag = sessionStorage.getItem("doodle-lab-tag") || ""; } catch {}

function renderChips() {
  const chips = $("chips");
  chips.replaceChildren();
  for (const tag of ["", ...allTags]) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = tag || "Everything";
    b.setAttribute("aria-pressed", String(tag === activeTag));
    b.onclick = () => {
      activeTag = tag;
      try { sessionStorage.setItem("doodle-lab-tag", tag); } catch {}
      renderChips(); renderTrays();
    };
    chips.append(b);
  }
}

const matches = (e) => {
  if (activeTag && !(e.tags || []).includes(activeTag)) return false;
  if (!query) return true;
  const hay = [e.title, e.blurb, e.controls, e.tech, e.chain, ...(e.tags || [])].join(" ").toLowerCase();
  return query.split(/\s+/).every((word) => hay.includes(word));
};

function card(e) {
  const node = $("card").content.firstElementChild.cloneNode(true);
  const img = node.querySelector("img");
  img.src = e.poster; img.alt = `${e.title} poster`;
  img.onerror = () => { img.remove(); node.querySelector(".plate").classList.add("no-poster"); };
  node.querySelector("h3").textContent = e.title;
  node.querySelector(".blurb").textContent = e.blurb;
  node.querySelector(".tech").textContent = e.tech || "";
  const chain = node.querySelector(".chain");
  if (chain) { chain.textContent = e.chain || ""; chain.hidden = !e.chain; }
  const tags = node.querySelector(".tags");
  const isNew = e.tray === "fresh" || e.tray === "snapshots";
  for (const tag of [...(isNew ? ["new"] : []), ...(e.tags || [])]) {
    const li = document.createElement("li"); li.textContent = tag;
    if (tag === "new") li.className = "new";
    tags.append(li);
  }
  const play = node.querySelector(".play");
  play.href = e.page; play.setAttribute("aria-label", `Play ${e.title}`);
  node.querySelector(".plate").setAttribute("aria-label", `Peek at ${e.title} live`);
  node.querySelector(".plate").onclick = () => openPeek(e);
  node.querySelector(".peek-btn").onclick = () => openPeek(e);
  // Gentle tilt and foil highlight follow the pointer.
  node.addEventListener("pointermove", (ev) => {
    const r = node.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    node.style.setProperty("--mx", `${x * 100}%`); node.style.setProperty("--my", `${y * 100}%`);
    node.style.setProperty("--ry", `${(x - 0.5) * 8}deg`); node.style.setProperty("--rx", `${(0.5 - y) * 6}deg`);
  });
  node.addEventListener("pointerleave", () => { node.style.setProperty("--rx", "0deg"); node.style.setProperty("--ry", "0deg"); });
  return node;
}

function renderTrays() {
  const main = $("trays");
  main.replaceChildren();
  let shown = 0;
  for (const tray of trays) {
    const items = entries.filter((e) => e.tray === tray.id && matches(e));
    const all = entries.filter((e) => e.tray === tray.id);
    if (!all.length && tray.id !== "fresh") continue;
    const section = document.createElement("section");
    section.className = "tray"; section.id = `tray-${tray.id}`;
    section.innerHTML = `<div class="tray-head"><h2></h2><p></p></div><div class="grid"></div>`;
    section.querySelector("h2").textContent = tray.title;
    section.querySelector("p").textContent = `${tray.note} · ${items.length} of ${all.length}`;
    const grid = section.querySelector(".grid");
    if (!all.length) {
      grid.outerHTML = `<p class="empty"><span class="oven">🍪</span> Nothing out of the oven yet. New doodles appear here as soon as their files land in <code>doodles/</code>.</p>`;
    } else if (!items.length) {
      grid.outerHTML = `<p class="empty">No doodles in this tray match the current filter.</p>`;
    } else {
      items.forEach((e) => grid.append(card(e)));
    }
    shown += items.length;
    main.append(section);
  }
  $("counts").innerHTML = "";
  for (const [label, n] of [["instruments", entries.filter((e) => e.tray === "fresh").length], ["synth snapshots", entries.filter((e) => e.tray === "snapshots").length], ["mobile demos", entries.filter((e) => e.tray === "pack").length], ["Gemini experiments", entries.filter((e) => e.tray === "gemini").length], ["showing", shown]]) {
    const s = document.createElement("span"); s.textContent = `${n} ${label}`; $("counts").append(s);
  }
}

let lastFocus = null;
// Swap the preview without adding joint-session history, so Back moves the page, not the frame.
function setFrame(url) {
  const f = $("peek-frame");
  try { f.contentWindow.location.replace(new URL(url, location.href).href); } catch { f.src = url; }
}
function openPeek(e) {
  lastFocus = document.activeElement;
  $("peek-tray").textContent = trayName[e.tray];
  $("peek-title").textContent = e.title;
  $("peek-controls").textContent = e.controls || "";
  $("peek-open").href = e.page;
  setFrame(e.page);
  $("peek").hidden = false;
  $("peek-close").focus();
  if (location.hash !== `#${e.slug}`) history.pushState(null, "", `#${e.slug}`);
}
function closePeek() {
  if ($("peek").hidden) return;
  $("peek").hidden = true;
  setFrame("about:blank"); // stop the doodle's GPU work
  // Closing replaces the #slug entry, so Back goes to wherever the visitor was before.
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  lastFocus?.focus?.();
}
$("peek-close").onclick = closePeek;
addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !$("peek").hidden) closePeek();
  if (ev.key === "/" && document.activeElement !== $("q")) { ev.preventDefault(); $("q").focus(); }
});
$("q").addEventListener("input", () => { query = $("q").value.trim().toLowerCase(); renderTrays(); });

renderChips();
renderTrays();
// Deep link: /projects/doodle-lab/#<slug> opens that doodle's live peek; back/forward and
// edited hashes follow.
function followHash() {
  const linked = entries.find((e) => e.slug === decodeURIComponent(location.hash.slice(1)));
  if (linked) openPeek(linked); else closePeek();
}
addEventListener("hashchange", followHash);
addEventListener("popstate", followHash);
followHash();
