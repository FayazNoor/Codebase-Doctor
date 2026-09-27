#!/usr/bin/env node
/**
 * Hand-drawn explainer sketches for the project site and the pitch deck.
 *
 * Each sketch is drawn with rough.js (fixed seeds, so the output is stable) on a 1600-wide canvas and written as:
 *   site/sketches/<name>.svg          the artwork only — no <text>, so it can be placed as an image anywhere;
 *   site/sketches/<name>.labels.json  its labels (centre x, top y, width, size, colour) in canvas units.
 * The site shows the SVG inline with the labels as real text on top (see injectIntoPage below); the deck places
 * the same SVG as an image with the labels as text boxes, because fonts never load inside an SVG.
 *
 * Usage: node scripts/site/sketches.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import rough from "roughjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = path.join(root, "site", "sketches");
const g = rough.generator();

const INK = "#2a2a30", MUTED = "#6b6b74";
const AMBER = "#c77f00", AMBER_INK = "#8f5c00", AMBER_FILL = "#fbe6bd";
const GREEN = "#1f8a4c", GREEN_FILL = "#d6efdd";
const RED = "#c0392b", RED_FILL = "#f8d9d4";
const PAPER_FILL = "#ffffff", GREY_FILL = "#ecebe4";

const r1 = (s) => s.replace(/-?\d+\.\d+/g, (n) => String(Math.round(+n * 10) / 10));

/** The CSS the inline sketches need (also used by the site's stylesheet). */
export const SKETCH_CSS = `.sketch{position:relative;margin:0;container-type:inline-size}
.sketch svg{display:block;width:100%;height:auto}
.sketch .sk{position:absolute;font-family:Caveat,"Segoe Print","Comic Sans MS",cursive;line-height:1.02;font-size:calc(var(--s) * 100cqw / 1600)}`;

class Sketch {
  constructor(name, w, h, alt) {
    Object.assign(this, { name, w, h, alt, groups: [], labels: [], seed: 1 });
    this.group();
  }
  group(delay = null) { this.cur = { delay: delay ?? this.groups.length * 90, paths: [] }; this.groups.push(this.cur); return this; }
  o(extra = {}) { return { seed: this.seed++, roughness: 1.25, bowing: 1, strokeWidth: 2.4, stroke: INK, ...extra }; }
  add(d) { for (const p of g.toPaths(d)) this.cur.paths.push(p); return this; }

  // primitives
  rect(x, y, w, h, o) { return this.add(g.rectangle(x, y, w, h, this.o(o))); }
  line(x1, y1, x2, y2, o) { return this.add(g.line(x1, y1, x2, y2, this.o(o))); }
  circle(cx, cy, d, o) { return this.add(g.circle(cx, cy, d, this.o(o))); }
  ellipse(cx, cy, w, h, o) { return this.add(g.ellipse(cx, cy, w, h, this.o(o))); }
  curve(pts, o) { return this.add(g.curve(pts, this.o(o))); }
  poly(pts, o) { return this.add(g.linearPath(pts, this.o(o))); }
  path(d, o) { return this.add(g.path(d, this.o(o))); }
  rrect(x, y, w, h, r, o) {
    return this.path(`M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`, o);
  }
  arrow(pts, o = {}) {
    this.curve(pts, { strokeWidth: 2.6, ...o });
    const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = o.head ?? 20;
    for (const s of [-1, 1]) this.line(b[0], b[1], b[0] - L * Math.cos(ang + s * 0.5), b[1] - L * Math.sin(ang + s * 0.5), { strokeWidth: 2.6, ...o });
    return this;
  }

  // icons
  doc(x, y, w, h, { lines = 4, fill = PAPER_FILL } = {}) {
    const f = Math.min(w, h) * 0.22;
    this.path(`M${x} ${y}H${x + w - f}L${x + w} ${y + f}V${y + h}H${x}Z`, { fill, fillStyle: "solid" });
    this.poly([[x + w - f, y], [x + w - f, y + f], [x + w, y + f]], { strokeWidth: 2 });
    for (let i = 0; i < lines; i++) {
      const ly = y + h * 0.34 + i * (h * 0.5) / lines;
      this.line(x + w * 0.16, ly, x + w * (0.84 - ((i * 37) % 3) * 0.12), ly, { strokeWidth: 1.8, stroke: MUTED, roughness: 0.9 });
    }
    return this;
  }
  magnifier(cx, cy, r, { lens = "#f4f1e8" } = {}) {
    this.circle(cx, cy, r * 2, { fill: lens, fillStyle: "solid", strokeWidth: 3 });
    return this.line(cx + r * 0.72, cy + r * 0.72, cx + r * 1.7, cy + r * 1.7, { strokeWidth: 7 });
  }
  check(x, y, s, color = GREEN) { return this.poly([[x, y + s * 0.55], [x + s * 0.36, y + s * 0.9], [x + s, y]], { stroke: color, strokeWidth: 4.5, roughness: 0.9 }); }
  cross(x, y, s, color = RED) { this.line(x, y, x + s, y + s, { stroke: color, strokeWidth: 4.5, roughness: 0.9 }); return this.line(x + s, y, x, y + s, { stroke: color, strokeWidth: 4.5, roughness: 0.9 }); }
  lock(cx, cy, s, { color = AMBER, fill = AMBER_FILL } = {}) {
    this.path(`M${cx - s * 0.32} ${cy - s * 0.1}V${cy - s * 0.38}Q${cx - s * 0.32} ${cy - s * 0.75} ${cx} ${cy - s * 0.75}Q${cx + s * 0.32} ${cy - s * 0.75} ${cx + s * 0.32} ${cy - s * 0.38}V${cy - s * 0.1}`, { stroke: color, strokeWidth: 3.2 });
    this.rrect(cx - s * 0.5, cy - s * 0.12, s, s * 0.78, s * 0.12, { stroke: color, fill, fillStyle: "solid", strokeWidth: 3 });
    return this.circle(cx, cy + s * 0.25, s * 0.14, { stroke: color, fill: color, fillStyle: "solid", strokeWidth: 1.5 });
  }
  gate(x, y, w, h, { open = false, color = AMBER, fill = AMBER_FILL, lock = true } = {}) {
    const pw = w * 0.1, by = y + h * 0.38, bh = h * 0.16;
    this.rect(x, y, pw, h, { fill: GREY_FILL, fillStyle: "solid" });
    this.rect(x + w - pw, y, pw, h, { fill: GREY_FILL, fillStyle: "solid" });
    this.line(x - pw * 0.6, y + h, x + w + pw * 0.6, y + h, { strokeWidth: 2 });
    if (!open) {
      this.rect(x + pw, by, w - 2 * pw, bh, { stroke: color, fill: color, fillStyle: "hachure", hachureGap: 14, fillWeight: 2.2, hachureAngle: -45, strokeWidth: 3 });
      if (lock) this.lock(x + w / 2, by + bh * 0.2, Math.min(w, h) * 0.3, { color, fill });
    } else {
      // The bar swung up around its pivot on the left post.
      const ax = x + pw, ay = by + bh / 2, L = (w - 2 * pw) * 0.92, a = -1.25;
      const rot = (u, v) => [ax + u * Math.cos(a) - v * Math.sin(a), ay + u * Math.sin(a) + v * Math.cos(a)];
      this.path(`M${rot(0, -bh / 2)}L${rot(L, -bh / 2)}L${rot(L, bh / 2)}L${rot(0, bh / 2)}Z`.replace(/,/g, " "),
        { stroke: color, fill: color, fillStyle: "hachure", hachureGap: 14, fillWeight: 2.2, hachureAngle: 20, strokeWidth: 3 });
    }
    return this;
  }
  bubble(x, y, w, h, { tail = "bl", fill = PAPER_FILL, stroke = INK } = {}) {
    const r = 22, t = tail === "bl" ? [x + 40, y + h, x + 18, y + h + 34, x + 76, y + h] : [x + w - 76, y + h, x + w - 18, y + h + 34, x + w - 40, y + h];
    this.rrect(x, y, w, h, r, { fill, fillStyle: "solid", stroke });
    return this.poly([[t[0], t[1] - 1], [t[2], t[3]], [t[4], t[5] - 1]], { stroke, fill, fillStyle: "solid" });
  }
  clipboard(x, y, w, h, rows) {
    this.rrect(x, y, w, h, 16, { fill: PAPER_FILL, fillStyle: "solid", strokeWidth: 2.6 });
    this.rrect(x + w * 0.3, y - 16, w * 0.4, 36, 10, { fill: GREY_FILL, fillStyle: "solid" });
    rows.forEach((row, i) => {
      const ry = y + 58 + i * ((h - 80) / rows.length), s = 34;
      this.rect(x + 26, ry, s, s, { strokeWidth: 2 });
      if (row.mark === "check") this.check(x + 30, ry + 2, s - 6);
      if (row.mark === "cross") this.cross(x + 32, ry + 6, s - 12);
      this.line(x + 80, ry + s / 2, x + w - 30, ry + s / 2, { strokeWidth: 1.8, stroke: MUTED, roughness: 0.9 });
    });
    return this;
  }
  branch(x, y, len, n) {
    this.line(x, y, x + len, y, { strokeWidth: 3 });
    for (let i = 0; i < n; i++) this.circle(x + 20 + i * ((len - 40) / (n - 1)), y, 30, { fill: AMBER_FILL, fillStyle: "solid", strokeWidth: 2.6 });
    return this;
  }
  pr(x, y, s, color = INK) {
    this.circle(x, y, s * 0.3, { stroke: color, strokeWidth: 3 });
    this.circle(x, y + s, s * 0.3, { stroke: color, strokeWidth: 3 });
    this.line(x, y + s * 0.15, x, y + s * 0.85, { stroke: color, strokeWidth: 3 });
    this.circle(x + s * 0.75, y + s, s * 0.3, { stroke: color, strokeWidth: 3 });
    this.curve([[x + s * 0.75, y + s * 0.85], [x + s * 0.75, y + s * 0.35], [x + s * 0.55, y + s * 0.12], [x + s * 0.22, y + s * 0.1]], { stroke: color, strokeWidth: 3 });
    return this.poly([[x + s * 0.34, y - s * 0.04], [x + s * 0.2, y + s * 0.1], [x + s * 0.34, y + s * 0.24]], { stroke: color, strokeWidth: 3 });
  }
  cloud(cx, cy, w, h, o) {
    const x = cx - w / 2, y = cy - h / 2;
    return this.path(`M${x + w * 0.22} ${y + h}C${x - w * 0.06} ${y + h} ${x - w * 0.04} ${y + h * 0.48} ${x + w * 0.2} ${y + h * 0.5}C${x + w * 0.18} ${y + h * 0.06} ${x + w * 0.58} ${y - h * 0.08} ${x + w * 0.66} ${y + h * 0.3}C${x + w * 0.86} ${y + h * 0.12} ${x + w * 1.06} ${y + h * 0.42} ${x + w * 0.9} ${y + h * 0.62}C${x + w * 1.08} ${y + h * 0.76} ${x + w} ${y + h} ${x + w * 0.8} ${y + h}Z`, { fill: PAPER_FILL, fillStyle: "solid", ...o });
  }
  window(x, y, w, h, { dots = true } = {}) {
    this.rrect(x, y, w, h, 18, { fill: PAPER_FILL, fillStyle: "solid", strokeWidth: 2.8 });
    this.line(x, y + 54, x + w, y + 54, { strokeWidth: 2 });
    if (dots) for (let i = 0; i < 3; i++) this.circle(x + 30 + i * 26, y + 27, 14, { strokeWidth: 1.8 });
    return this;
  }
  ecg(x, y, w, amp, scores) {
    const pts = [[x, y]], gap = w / (scores.length + 1);
    scores.forEach((s, i) => {
      const cx = x + gap * (i + 1), hgt = 8 + s / 100 * amp;
      pts.push([cx - 28, y], [cx - 18, y - 6], [cx - 10, y], [cx - 4, y + 10], [cx, y - hgt], [cx + 6, y + 16], [cx + 12, y], [cx + 30, y - 8], [cx + 40, y]);
    });
    pts.push([x + w, y]);
    return this.poly(pts, { strokeWidth: 3, roughness: 0.6 });
  }

  // labels: x = centre, y = top of the text box, in canvas units
  label(x, y, text, { size = 36, w = 360, color = INK, weight = 600, align = "center" } = {}) {
    this.labels.push({ x, y, w, size, color, weight, align, text });
    return this;
  }

  svg({ animated = false } = {}) {
    const body = this.groups.map((grp) => {
      const inner = grp.paths.map((p) => {
        const fill = p.fill && p.fill !== "none" ? p.fill : "none";
        const isFill = fill !== "none" && (!p.stroke || p.stroke === "none");
        const attrs = isFill
          ? `fill="${fill}"${animated ? ' class="f"' : ""}`
          : `fill="none" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${animated ? ' class="s" pathLength="1"' : ""}`;
        return `<path d="${r1(p.d)}" ${attrs}/>`;
      }).join("");
      return animated ? `<g style="--d:${grp.delay}ms">${inner}</g>` : `<g>${inner}</g>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}"${animated ? ' aria-hidden="true"' : ""}>${body}</svg>`;
  }
  html() {
    const pct = (v, of) => +(v / of * 100).toFixed(3);
    const labels = this.labels.map((l) =>
      `<span class="sk" style="left:${pct(l.x - l.w / 2, this.w)}%;top:${pct(l.y, this.h)}%;width:${pct(l.w, this.w)}%;--s:${l.size};color:${l.color};font-weight:${l.weight};text-align:${l.align}">${l.text}</span>`).join("");
    return `<figure class="sketch reveal" style="aspect-ratio:${this.w}/${this.h}" role="img" aria-label="${this.alt.replace(/"/g, "&quot;")}">${this.svg({ animated: true })}${labels}</figure>`;
  }
}

// ---------------------------------------------------------------------------
// The sketches
// ---------------------------------------------------------------------------

function problem() {
  const s = new Sketch("problem", 1600, 600,
    "Three hand-drawn panels: a stack of files under a magnifying glass (where is it used?), a cracked file tagged 18.3.1 (what will break?), and a checklist with a tick, a cross and a question mark (did it actually work?).");
  // A: where is it used?
  s.group(0).doc(130, 150, 190, 240).doc(165, 120, 190, 240).doc(200, 90, 190, 240);
  s.group().magnifier(360, 300, 72);
  s.label(128, 70, "?", { size: 64, w: 60, color: AMBER_INK, weight: 700 }).label(470, 150, "?", { size: 56, w: 60, color: AMBER_INK, weight: 700 });
  s.label(290, 470, "Where is it used?", { size: 46, w: 480 });
  // B: what will break?
  s.group(600).doc(690, 100, 220, 290, { lines: 5 });
  s.poly([[770, 100], [790, 160], [760, 205], [805, 255], [775, 305], [815, 350], [795, 390]], { stroke: RED, strokeWidth: 4, roughness: 0.8 });
  s.group().rrect(905, 150, 150, 58, 14, { fill: AMBER_FILL, fillStyle: "solid", stroke: AMBER });
  s.line(910, 180, 880, 205, { stroke: AMBER, strokeWidth: 2 });
  s.label(980, 154, "18.3.1", { size: 38, w: 150, color: AMBER_INK, weight: 700 });
  s.label(800, 470, "What will break?", { size: 46, w: 480 });
  // C: did it actually work?
  s.group(1100).clipboard(1200, 100, 260, 300, [{ mark: "check" }, { mark: "cross" }, { mark: "none" }]);
  s.label(1244, 300, "?", { size: 48, w: 40, color: AMBER_INK, weight: 700 });
  s.label(1330, 470, "Did it actually work?", { size: 46, w: 520 });
  return s;
}

function flow() {
  const s = new Sketch("flow", 1600, 820,
    "Hand-drawn flow: you ask in IBM Bob, Codebase Doctor analyses every usage and writes a ten-step plan, then a locked gate waits for you to type approved; after that it applies one commit per step, verifies with your own lint, tests and build, and opens a pull request only when the checks pass.");
  // Row 1
  s.group(0).bubble(40, 120, 270, 130);
  s.label(175, 142, "upgrade react<br>to 18.3.1", { size: 36, w: 250 });
  s.label(175, 300, "You, in IBM Bob", { size: 40, w: 300, weight: 700 });
  s.group().arrow([[325, 190], [370, 180], [415, 190]]);
  s.group().doc(450, 110, 130, 165, { lines: 4 }).magnifier(575, 225, 46);
  s.label(560, 300, "Analyse", { size: 40, w: 260, weight: 700 });
  s.label(560, 348, "every usage, file & line", { size: 32, w: 330, color: MUTED });
  s.group().arrow([[680, 190], [725, 180], [770, 190]]);
  s.group().rrect(800, 100, 170, 185, 16, { fill: PAPER_FILL, fillStyle: "solid" });
  for (let i = 0; i < 4; i++) { s.circle(830, 138 + i * 38, 22, { strokeWidth: 1.8 }); s.line(852, 138 + i * 38, 945 - (i % 2) * 28, 138 + i * 38, { strokeWidth: 1.8, stroke: MUTED, roughness: 0.9 }); }
  s.label(885, 300, "Plan", { size: 40, w: 240, weight: 700 });
  s.label(885, 348, "ten steps, in order", { size: 32, w: 300, color: MUTED });
  s.group().arrow([[1000, 190], [1060, 180], [1120, 190]]);
  s.group().gate(1160, 90, 300, 210);
  s.label(1310, 318, "you type “approved”", { size: 42, w: 400, color: AMBER_INK, weight: 700 });
  s.label(1310, 368, "nothing changes before", { size: 32, w: 400, color: MUTED });
  // return sweep
  s.group().arrow([[1310, 420], [1250, 470], [900, 480], [420, 470], [190, 495], [165, 545]], { stroke: MUTED, strokeWidth: 2.2 });
  // Row 2
  s.group().branch(60, 650, 300, 4);
  s.label(210, 690, "Apply", { size: 40, w: 260, weight: 700 });
  s.label(210, 738, "one commit per step", { size: 32, w: 320, color: MUTED });
  s.group().arrow([[400, 650], [445, 640], [490, 650]]);
  s.group().clipboard(560, 545, 190, 160, [{ mark: "check" }, { mark: "check" }, { mark: "check" }]);
  s.label(655, 718, "Verify", { size: 40, w: 260, weight: 700 });
  s.label(655, 766, "your own lint, tests & build", { size: 32, w: 400, color: MUTED });
  s.group().lock(955, 620, 46, { color: GREEN, fill: GREEN_FILL });
  s.arrow([[820, 668], [950, 660], [1080, 668]], { stroke: GREEN });
  s.label(955, 690, "only if green", { size: 32, w: 220, color: GREEN, weight: 700 });
  s.group().pr(1190, 575, 110);
  s.circle(1370, 590, 64, { stroke: GREEN, fill: GREEN_FILL, fillStyle: "solid", strokeWidth: 2.6 }).check(1354, 574, 32);
  s.label(1270, 718, "Pull request", { size: 40, w: 320, weight: 700 });
  s.label(1270, 766, "the report is its description", { size: 32, w: 420, color: MUTED });
  return s;
}

function bob() {
  const s = new Sketch("bob", 1600, 700,
    "Hand-drawn architecture: on your machine, IBM Bob (the migration-doctor skill, Plan mode and the report artifact) talks to the Codebase Doctor MCP server over stdio through 12 tools; only the verified branch and the pull request go to GitHub.");
  s.group(0).rrect(24, 70, 1200, 600, 30, { stroke: MUTED, strokeWidth: 2, strokeLineDash: [14, 12] });
  s.label(150, 84, "your machine", { size: 34, w: 240, color: MUTED });
  // Bob window
  s.group().window(70, 140, 600, 440);
  s.label(300, 150, "IBM Bob", { size: 36, w: 220, weight: 700 });
  s.bubble(250, 220, 390, 70, { tail: "br" });
  s.label(445, 232, "upgrade react to 18.3.1", { size: 32, w: 370 });
  s.bubble(100, 330, 420, 70, { fill: AMBER_FILL, stroke: AMBER });
  s.label(310, 342, "plan ready — reply “approved”", { size: 32, w: 410, color: AMBER_INK });
  s.bubble(420, 440, 220, 70, { tail: "br" });
  s.label(530, 452, "approved", { size: 34, w: 200, weight: 700 });
  s.label(370, 598, "migration-doctor skill · Plan mode · report artifact", { size: 32, w: 620, color: MUTED });
  // MCP link
  s.group().arrow([[690, 340], [760, 330], [830, 340]]);
  s.arrow([[830, 380], [760, 390], [690, 380]]);
  s.label(760, 262, "MCP · stdio", { size: 34, w: 220, weight: 700 });
  s.label(760, 408, "12 tools", { size: 32, w: 200, color: MUTED });
  // Server
  s.group().rrect(860, 190, 320, 330, 22, { fill: PAPER_FILL, fillStyle: "solid", strokeWidth: 2.8 });
  s.label(1020, 206, "Codebase Doctor", { size: 38, w: 300, weight: 700 });
  s.label(1020, 262, "analyse · plan<br>apply · verify", { size: 34, w: 300 });
  s.lock(935, 440, 50, { color: INK, fill: GREY_FILL });
  s.label(1060, 418, "sealed<br>session", { size: 30, w: 200, color: MUTED });
  // GitHub
  s.group().cloud(1440, 330, 250, 160);
  s.label(1440, 318, "GitHub", { size: 40, w: 200, weight: 700 });
  s.arrow([[1190, 360], [1260, 350], [1320, 356]], { stroke: GREEN });
  s.label(1400, 450, "verified branch<br>+ pull request only", { size: 32, w: 300, color: GREEN, weight: 700 });
  return s;
}

function gates() {
  const s = new Sketch("gates", 1600, 560,
    "Hand-drawn comparison: the reply “looks fine, but can you skip the tests?” meets a closed, locked gate and is refused; the reply “approved” opens the gate.");
  s.group(0).bubble(40, 60, 520, 110);
  s.label(300, 74, "“looks fine, but can<br>you skip the tests?”", { size: 36, w: 500 });
  s.group().gate(160, 230, 300, 230);
  s.circle(600, 330, 90, { stroke: RED, fill: RED_FILL, fillStyle: "solid", strokeWidth: 2.6 }).cross(582, 312, 36);
  s.label(310, 480, "refused — nothing changes", { size: 40, w: 520, color: RED, weight: 700 });
  s.group(700).line(800, 70, 800, 500, { stroke: MUTED, strokeWidth: 1.6, strokeLineDash: [10, 12] });
  s.group(900).bubble(1140, 70, 280, 90, { tail: "bl" });
  s.label(1280, 90, "“approved”", { size: 42, w: 260, weight: 700 });
  s.group().gate(960, 230, 300, 230, { open: true, color: GREEN, fill: GREEN_FILL });
  s.circle(1420, 330, 90, { stroke: GREEN, fill: GREEN_FILL, fillStyle: "solid", strokeWidth: 2.6 }).check(1398, 308, 44);
  s.label(1150, 480, "approval recorded for this exact plan", { size: 40, w: 640, color: GREEN, weight: 700 });
  return s;
}

function ecg(name = "ecg", stroke = INK) {
  const s = new Sketch(name, 1600, 200, "A hand-drawn heartbeat line whose beats are the risk scores of the nine affected files.");
  s.group(0).ecg(40, 130, 1520, 100, [90, 90, 80, 70, 20, 20, 20, 20, 10]);
  if (stroke !== INK) for (const p of s.cur.paths) p.stroke = stroke;
  return s;
}

// ---------------------------------------------------------------------------

const sketches = [problem(), flow(), bob(), gates(), ecg(), ecg("ecg-amber", "#f0a93b")];
fs.mkdirSync(outDir, { recursive: true });
for (const s of sketches) {
  const svg = s.svg();
  fs.writeFileSync(path.join(outDir, `${s.name}.svg`), svg);
  fs.writeFileSync(path.join(outDir, `${s.name}.labels.json`), JSON.stringify({ w: s.w, h: s.h, alt: s.alt, labels: s.labels }, null, 1));
  console.log(`sketches/${s.name}.svg  ${(svg.length / 1024).toFixed(1)} KB, ${s.labels.length} labels`);
}

// --preview <file>: every sketch on one page, for reviewing the drawings.
const pv = process.argv.indexOf("--preview");
if (pv > 0) {
  fs.writeFileSync(process.argv[pv + 1], `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat:wght@500..700&display=swap">
<style>body{margin:0;padding:24px;background:#fafaf8;display:grid;gap:40px}${SKETCH_CSS}</style>${sketches.map((s) => s.html()).join("\n")}`);
  console.log("preview written");
}

// Inject the inline versions into the site's pages between <!-- sketch:name --> … <!-- /sketch:name --> markers.
for (const page of ["index.html"]) {
  const file = path.join(root, "site", page);
  let html = fs.readFileSync(file, "utf8"), n = 0;
  for (const s of sketches) {
    const re = new RegExp(`(<!-- sketch:${s.name} -->)[\\s\\S]*?(<!-- /sketch:${s.name} -->)`, "g");
    html = html.replace(re, (_, a, b) => { n++; return `${a}${s.html()}${b}`; });
  }
  fs.writeFileSync(file, html);
  console.log(`${page}: ${n} sketch region(s) refreshed`);
}
