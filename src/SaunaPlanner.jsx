import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Sauna Planner — interactive 3D layout tool
// Room defaults: 1.70 x 2.60 x 2.10 m. Everything is parametric.
// Custom orbit controls (drag = rotate, wheel/pinch = zoom, shift/right/2-finger = pan)
// ---------------------------------------------------------------------------

const PAL = {
  bg: 0x17120e,
  ground: 0x1d1712,
  floor: 0x6e5337,
  wall: 0xc1955f,
  wallDark: 0x9c7549,
  ceil: 0xb88f5c,
  bench: 0xe7cda2,
  benchDark: 0xd4b486,
  steel: 0x36322f,
  black: 0x232021,
  stoneC: 0x5b544d,
  ember: 0xe2762d,
  glass: 0xaacfdd,
  frame: 0x7a5c39,
  intake: 0x5aa7d6,
  exhaust: 0xd95f4a,
  dry: 0xa39581,
};

const UI = {
  bg: "#17120e",
  panel: "#211912",
  panel2: "#2a2017",
  line: "#3a2d1f",
  text: "#ead9bd",
  dim: "#9d8a6f",
  ember: "#e2762d",
  warn: "#e0512f",
  ok: "#7fae6a",
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// Three bench tiers; each tucks 5 cm under the level above on shared walls
const LEVELS = [
  { name: "Upper", hint: "sitting level", keys: { left: "bLeft", back: "bBack", right: "bRight", h: "upH", d: "upD", z0: "upZ0" }, hMin: 0.6, hMax: 1.3, dMin: 0.4, dMax: 0.9 },
  { name: "Middle", hint: "footrest / second seat", keys: { left: "loLeft", back: "loBack", right: "loRight", h: "loH", d: "loD", z0: "loZ0" }, hMin: 0.2, hMax: 0.8, dMin: 0.25, dMax: 0.7 },
  { name: "Step", hint: "climbing step", keys: { left: "stLeft", back: "stBack", right: "stRight", h: "stH", d: "stD", z0: "stZ0" }, hMin: 0.08, hMax: 0.45, dMin: 0.15, dMax: 0.9 },
];

// ---------- small three helpers ----------
function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts });
}
function box(w, h, d, material, edges = true, edgeColor = 0x2b2118, edgeOpacity = 0.35) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  if (edges) {
    const eg = new THREE.EdgesGeometry(g);
    const lm = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: edgeOpacity });
    m.add(new THREE.LineSegments(eg, lm));
  }
  return m;
}
function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((mm) => mm.dispose());
      else o.material.dispose();
    }
  });
}

// ---------- bench slats ----------
function buildBenchTop(len, depth, thickness, yTop) {
  // boards run along the bench length (z), laid across the depth (x)
  const grp = new THREE.Group();
  const board = 0.062, gap = 0.012;
  const n = Math.max(2, Math.floor((depth + gap) / (board + gap)));
  const used = n * board + (n - 1) * gap;
  const start = (depth - used) / 2;
  for (let i = 0; i < n; i++) {
    const b = box(board, thickness, len, mat(PAL.bench, { roughness: 0.7 }));
    b.position.set(start + board / 2 + i * (board + gap), yTop - thickness / 2, len / 2);
    grp.add(b);
  }
  return grp;
}
// Seated planning manikin (roughly a 50th-percentile adult), facing local +z
function buildPerson(seatY, material) {
  const g = new THREE.Group();
  const part = (w, h, d, x, y, z) => {
    const b = box(w, h, d, material);
    b.position.set(x, y, z);
    g.add(b);
  };
  part(0.34, 0.56, 0.2, 0, seatY + 0.28, -0.02); // torso
  part(0.3, 0.13, 0.44, 0, seatY + 0.065, 0.15); // thighs
  const shinH = Math.min(0.5, seatY + 0.04);     // shins stop at the floor on low benches
  part(0.26, shinH, 0.12, 0, seatY + 0.06 - shinH / 2, 0.34);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), material);
  head.position.set(0, seatY + 0.67, 0);
  head.castShadow = true;
  g.add(head);
  return g;
}

// ---------- UI primitives (module scope so inputs survive re-renders) ----------
const fmt = (v, dec = 2) => String(Number(Number(v).toFixed(dec)));
const Row = ({ label, value, unit, min, max, step, onChange, decimals = 2 }) => {
  const [draft, setDraft] = useState(fmt(value, decimals));
  useEffect(() => { setDraft(fmt(value, decimals)); }, [value, decimals]);
  const commit = (s) => {
    const v = parseFloat(s);
    if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <label style={{ display: "block", margin: "10px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: UI.dim, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <input
            type="number" inputMode="decimal" min={min} max={max} step={step} value={draft}
            onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
            onBlur={() => setDraft(fmt(value, decimals))}
            style={{
              width: 60, textAlign: "right", fontFamily: MONO, fontSize: 12,
              color: UI.text, background: UI.panel2, border: `1px solid ${UI.line}`,
              borderRadius: 6, padding: "2px 6px", outline: "none",
            }}
          />
          <span style={{ fontFamily: MONO, color: UI.dim, fontSize: 12 }}>{unit}</span>
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: UI.ember, height: 16 }}
      />
    </label>
  );
};

const Seg = ({ value, options, onChange }) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
    {options.map(([val, lab]) => (
      <button key={val} onClick={() => onChange(val)}
        style={{
          padding: "5px 11px", borderRadius: 999, fontSize: 12, cursor: "pointer",
          border: `1px solid ${val === value ? UI.ember : UI.line}`,
          background: val === value ? "rgba(226,118,45,0.16)" : "transparent",
          color: val === value ? UI.ember : UI.dim, fontFamily: "inherit",
        }}>
        {lab}
      </button>
    ))}
  </div>
);

const Section = ({ title, children, defaultOpen }) => {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <details open={open} onToggle={(e) => setOpen(e.target.open)} style={{ borderBottom: `1px solid ${UI.line}` }}>
      <summary style={{
        cursor: "pointer", padding: "12px 16px", fontSize: 11, letterSpacing: "0.14em",
        textTransform: "uppercase", color: UI.text, fontWeight: 600, userSelect: "none", listStyle: "none",
      }}>
        <span style={{ color: UI.ember, marginRight: 8 }}>▸</span>{title}
      </summary>
      <div style={{ padding: "0 16px 14px" }}>{children}</div>
    </details>
  );
};

const Toggle = ({ label, value, onChange }) => (
  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "10px 0", fontSize: 12, color: UI.dim, cursor: "pointer" }}>
    <span>{label}</span>
    <span onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: 999, position: "relative",
        background: value ? UI.ember : UI.line, transition: "background 0.15s", flexShrink: 0,
      }}>
      <span style={{
        position: "absolute", top: 2, left: value ? 18 : 2, width: 16, height: 16,
        borderRadius: 999, background: UI.bg, transition: "left 0.15s",
      }} />
    </span>
  </label>
);

const WallToggles = ({ options, state, onToggle }) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
    {options.map(([k, lab]) => (
      <button key={k} onClick={() => onToggle(k, !state[k])}
        style={{
          padding: "5px 11px", borderRadius: 999, fontSize: 12, cursor: "pointer",
          border: `1px solid ${state[k] ? UI.ember : UI.line}`,
          background: state[k] ? "rgba(226,118,45,0.16)" : "transparent",
          color: state[k] ? UI.ember : UI.dim, fontFamily: "inherit",
        }}>
        {lab}
      </button>
    ))}
  </div>
);

// Default settings — also the whitelist/type-reference for imported settings
const DEFAULTS = {
  W: 1.7, D: 2.6, H: 2.1,
  bLeft: true, bRight: false, bBack: false,
  loLeft: true, loRight: false, loBack: false,
  stLeft: false, stRight: false, stBack: false,
  stH: 0.22, stD: 0.3,
  // bench heights: upper = distance below the ceiling, middle = distance below the upper bench (the step's
  // stH is above the floor). The planner derives upH / loH above the floor from these.
  upCeil: 1.2, upD: 0.55, loDrop: 0.45, loD: 0.4,
  upZ0: 0, loZ0: 0, stZ0: 0, bz1: 2.6,
  showRails: true,
  showPeople: true, seatW: 0.6, showSeatW: true,
  heater: "cilindro", heaterWall: "front", heaterX: 1.4,
  clearance: 0.25, showClear: true,
  // custom box heater: width along the wall, depth out from it, height, bottom above floor, min distance to ceiling
  hBottom: 0.1, ceilClear: 0.9, // Harvia Spirit: bottom above the floor, min. distance from its top to the ceiling
  railing: false, // Harvia Spirit: safety railing around its top
  // temperature sensor on the heater's wall: centre below the ceiling, and sideways from the heater's
  // centre line (+ = away from the door)
  sensorCeil: 0.1, sensorSide: 0.19,
  // heater control panel: any wall, along it (same reference corner as the vents), centre height above the floor
  cpWall: "front", cpX: 0.2, cpH: 1.0,
  doorX: 0.45, doorW: 0.6,
  showVents: true,
  // vents (round): centre heights from their own reference, diameters in mm
  v1x: 1.4, v1top: 0.8, v1d: 100, v1wall: "front", // supply: above the heater top
  v1oX: 1.4, v1oH: 0.3, //                            supply's outside opening: along the wall, above the floor
  v2x: 2.3, v2h: 0.25, v2d: 125, v2wall: "left", //   exhaust: above the floor
  v3x: 0.85, v3ceil: 0.15, v3d: 100, v3wall: "back", // drying: below the ceiling
};

// status badge for the toolbar: green when OK, red when not, neutral when it just informs
const BADGE_TONES = {
  ok: { bg: "rgba(127,174,106,0.12)", line: UI.ok, text: UI.ok },
  warn: { bg: "rgba(224,81,47,0.16)", line: UI.warn, text: UI.warn },
  info: { bg: UI.panel2, line: UI.line, text: UI.text },
};
const Badge = ({ tone, children }) => (
  <div style={{
    fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 8,
    background: BADGE_TONES[tone].bg, border: `1px solid ${BADGE_TONES[tone].line}`, color: BADGE_TONES[tone].text,
  }}>
    {children}
  </div>
);

// SVG path of a rectangle with its own radius per corner (screen coordinates, y down)
const roundedRectPath = (x0, y0, x1, y1, { tl, tr, br, bl }) =>
  `M ${x0 + tl} ${y0} H ${x1 - tr} A ${tr} ${tr} 0 0 1 ${x1} ${y0 + tr} V ${y1 - br} A ${br} ${br} 0 0 1 ${x1 - br} ${y1} ` +
  `H ${x0 + bl} A ${bl} ${bl} 0 0 1 ${x0} ${y1 - bl} V ${y0 + tl} A ${tl} ${tl} 0 0 1 ${x0 + tl} ${y0} Z`;

// A rounded block, centred on x/z, standing on y = 0: footprint 2hw × 2hd with front corners (+z) of radius rf
// and back corners of radius rb, height h, top and bottom edges rounded by e. Built as stacked rings of the
// footprint, each inset along a quarter circle near the top and bottom — so the outline never folds over itself,
// whatever the proportions — plus flat caps. The middle rings are the full footprint: the outer size is exact.
function roundedBlockGeometry(hw, hd, rf, rb, h, e, segs = 8, steps = 6) {
  e = Math.max(0.001, Math.min(e, h / 2 - 0.001, hw - 0.002, hd - 0.002));
  const ring = (d) => { // footprint inset by d (corner radii shrink by d too, keeping the offset even), as [x, z]
    const W = hw - d, Dd = hd - d;
    const rB = Math.max(0.001, Math.min(rb - d, W - 0.0005, Dd - 0.0005));
    // front and back corners share each side: keep a straight piece between them so the outline can't fold
    const rF = Math.max(0.001, Math.min(rf - d, W - 0.0005, 2 * Dd - rB - 0.0005));
    const pts = [];
    const arc = (cx, cz, r, a0, a1) => {
      for (let i = 0; i <= segs; i++) {
        const a = a0 + ((a1 - a0) * i) / segs;
        pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
      }
    };
    arc(W - rF, Dd - rF, rF, 0, Math.PI / 2); // front-right
    arc(-W + rF, Dd - rF, rF, Math.PI / 2, Math.PI); // front-left
    arc(-W + rB, -Dd + rB, rB, Math.PI, Math.PI * 1.5); // back-left
    arc(W - rB, -Dd + rB, rB, Math.PI * 1.5, Math.PI * 2); // back-right
    return pts;
  };
  // the profile: (height, inset) from the bottom edge, up the side, over the top edge
  const prof = [];
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * (Math.PI / 2); prof.push([e - e * Math.cos(a), e - e * Math.sin(a)]); }
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * (Math.PI / 2); prof.push([h - e + e * Math.sin(a), e - e * Math.cos(a)]); }
  const pos = [], idx = [];
  const n = ring(0).length;
  for (const [y, d] of prof) for (const [x, z] of ring(d)) pos.push(x, y, z);
  for (let j = 0; j < prof.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * n + i, b = j * n + ((i + 1) % n), c = (j + 1) * n + ((i + 1) % n), d = (j + 1) * n + i;
      idx.push(a, b, c, a, c, d);
    }
  }
  // flat caps (fans from the centre; the outline is convex)
  const cap = (y, d, up) => {
    const base = pos.length / 3;
    pos.push(0, y, 0);
    for (const [x, z] of ring(d)) pos.push(x, y, z);
    for (let i = 0; i < n; i++) {
      const p1 = base + 1 + i, p2 = base + 1 + ((i + 1) % n);
      if (up) idx.push(base, p2, p1); else idx.push(base, p1, p2);
    }
  };
  cap(0, e, false);
  cap(h, e, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// The safety railing's band seen from above, as [along, depth] points (along relative to the heater's centre,
// depth out from the wall): out along one side from the wall, round the two front corners (outer radius R),
// back to the wall, then back the same way on the inside (band thickness t)
function railContour(w, d, R, t, segs = 10) {
  const pts = [];
  const arc = (ca, cd, r, a0, a1) => {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + ((a1 - a0) * i) / segs;
      pts.push([ca + r * Math.cos(a), cd + r * Math.sin(a)]);
    }
  };
  pts.push([-w / 2, 0]);
  arc(-w / 2 + R, d - R, R, Math.PI, Math.PI / 2);
  arc(w / 2 - R, d - R, R, Math.PI / 2, 0);
  pts.push([w / 2, 0], [w / 2 - t, 0]);
  arc(w / 2 - R, d - R, R - t, 0, Math.PI / 2);
  arc(-w / 2 + R, d - R, R - t, Math.PI / 2, Math.PI);
  pts.push([-w / 2 + t, 0]);
  return pts;
}

// small arrow glyph (points along +x before rotation), sized to a circle of radius r
const ARROW_PTS = [[-0.62, -0.13], [0.1, -0.13], [0.1, -0.38], [0.68, 0], [0.1, 0.38], [0.1, 0.13], [-0.62, 0.13]];
const arrowGlyph = (cx, cy, r, angle, fill) => (
  <polygon points={ARROW_PTS.map(([x, y]) => `${x * r},${y * r}`).join(" ")} fill={fill}
    transform={`translate(${cx} ${cy}) rotate(${(angle * 180) / Math.PI})`} />
);

const Btn = ({ children, onClick, primary }) => (
  <button onClick={onClick}
    style={{
      padding: "6px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
      border: `1px solid ${primary ? UI.ember : UI.line}`,
      background: primary ? "rgba(226,118,45,0.16)" : UI.panel2,
      color: primary ? UI.ember : UI.text,
    }}>
    {children}
  </button>
);

// temperature sensor housing (w along the wall × h × d out from the wall), drawn light so it reads as a device
const SENSOR = { w: 0.05, h: 0.07, d: 0.025, c: "#ece6da" };
// heater control panel (Harvia Xenio panel: 85 × 110 × 24 mm), dark with a lit display; rules: at least
// CP_MIN_FROM_HEATER from the heater, centre at most CP_MAX_HEIGHT above the floor
const CP = { w: 0.085, h: 0.11, d: 0.024, c: "#2b2829" };
const CP_MIN_FROM_HEATER = 1.0, CP_MAX_HEIGHT = 1.2;
// Harvia Spirit, wall-mounted: width along the wall × depth out from it × height (outer limits of the body)
const SPIRIT = { w: 0.385, d: 0.335, h: 0.75 };
// Harvia Spirit SP60/90 safety railing (HSP3M, harvia.com): 545 wide × 450 deep × 130 mm tall, black-painted
// birch, fixed around the top of the heater — drawn as a U whose back ends meet the wall (t = bar thickness)
const RAIL = { w: 0.545, d: 0.45, h: 0.13, t: 0.022, c: "#1b1918" };

// ---------- floor plan helpers ----------
const PLAN = {
  floor: "#211910",
  grid: "rgba(234,217,189,0.05)",
  grid5: "rgba(234,217,189,0.10)",
  grid10: "rgba(234,217,189,0.17)",
  wall: "#e2d2b3",
  tiers: ["#d3a466", "#b3854f", "#8e6942"], // upper, middle, step
  benchEdge: "#3b2915",
  slat: "rgba(43,28,14,0.38)",
  rail: "#5e4123",
  person: "#9aa7b8",
  head: "#c3ccd6",
  personDark: "#2b3138",
  dim: "#9d8a6f",
  free: "#7fae6a",
};
// complete colour sets for the 2D views (floor plan, side view): the dark screen look, and a light one
// that prints well — white paper, dark ink walls and dimensions, lighter fills, accents deepened for white
const PLAN_THEMES = {
  dark: {
    ...PLAN,
    bg: UI.bg, text: UI.dim, ember: UI.ember, warn: UI.warn,
    heaterFill: "#2b2829", heaterEdge: "#8f8a84", heaterInner: "#5f5850", cilFill: "#3a3633", cilBase: "#232021",
    stone: "#5b544d", ink: "#171210", arrow: "#f4efe6", sensor: SENSOR.c, sensorInk: SENSOR.c, cp: CP.c,
    tierInk: PLAN.tiers, slot: PLAN.person,
    railPlan: "#4a4440", railPlanEdge: "#d8cdb8", railSide: RAIL.c,
    vents: ["#5aa7d6", "#d95f4a", "#a39581"], // supply, exhaust, drying
    legendBg: UI.panel, legendText: UI.dim, legendStrong: UI.text, line: UI.line,
  },
  light: {
    floor: "#ffffff",
    grid: "rgba(40,30,20,0.06)", grid5: "rgba(40,30,20,0.11)", grid10: "rgba(40,30,20,0.19)",
    wall: "#3b3530",
    tiers: ["#efd3a4", "#e0bc87", "#cfa36f"],
    benchEdge: "#6b4c2a", slat: "rgba(90,60,30,0.32)", rail: "#7a5a36",
    person: "#d3dbe4", head: "#eef1f5", personDark: "#4a525c",
    dim: "#4f4740", free: "#2f7a22",
    bg: "#ffffff", text: "#4f4740", ember: "#d2611c", warn: "#c63b1d",
    heaterFill: "#8c857e", heaterEdge: "#2b2621", heaterInner: "#c4bcb3", cilFill: "#8c857e", cilBase: "#5a534c",
    stone: "#b0a79c", ink: "#2b2621", arrow: "#ffffff", sensor: "#ffffff", sensorInk: "#2b2621", cp: "#4a4440",
    tierInk: ["#9a6a2a", "#86581f", "#704716"], slot: "#7d8894",
    railPlan: "#6e665e", railPlanEdge: "#2b2621", railSide: "#4a4440",
    vents: ["#2f80bf", "#c4432c", "#8a7a63"],
    legendBg: "#f4f1ec", legendText: "#4f4740", legendStrong: "#2b2621", line: "#d9d2c7",
  },
};
// lengths in the 2D views: metric (metres, as in the rest of the planner) or imperial — feet and inches to the
// nearest 1/4", written as on US drawings (5'-6 3/4", inches alone under a foot); plain ' " and x/4 fractions
// stay legible at small sizes, unlike the ′ ″ ¾ glyphs
const M_PER_IN = 0.0254;
const quarterInches = (m) => Math.round((Math.abs(m) / M_PER_IN) * 4);
const fmtQuarter = (q) => {
  const ft = Math.floor(q / 48), r = q - ft * 48;
  const inch = Math.floor(r / 4), frac = ["", "1/4", "1/2", "3/4"][r % 4];
  const showInch = inch > 0 || ft > 0 || !frac; // 1'-0 1/4", but 1/4" alone
  const ins = (showInch ? `${inch}` : "") + (frac ? (showInch ? " " : "") + frac : "") + '"';
  return ft ? `${ft}'-${ins}` : ins;
};
const fmtImperial = (m) => fmtQuarter(quarterInches(m));
// metres to 2 decimals; computed lengths are snapped to the µm first, so 1.365 − 0.9 (0.46499999…) shows as 0.47
const toCm2 = (m) => (Math.round(Math.abs(m) * 1e6) / 1e6).toFixed(2);
const fmtMetric = (m) => `${toCm2(m)} m`;
const PZ0 = { z: 1, cx: 0, cy: 0 };
// visible viewBox for a base (fit-to-view) box, zoom level and pan offset (metres)
const viewGeom = (b, z) => {
  const vw = b.bW / z.z, vh = b.bH / z.z;
  const minX = b.bcx + z.cx - vw / 2, minY = b.bcy + z.cy - vh / 2;
  const s = Math.min(b.w / vw, b.h / vh);
  return { vw, vh, minX, minY, s, offX: (b.w - vw * s) / 2, offY: (b.h - vh * s) / 2 };
};
const Swatch = ({ color, ring, dashed, dot, outline, frame }) => (
  <span style={{
    width: 10, height: 10, borderRadius: ring || dot || outline ? 999 : 2, display: "inline-block", marginRight: 6, verticalAlign: "-1px",
    boxSizing: "border-box",
    background: ring || dashed ? "transparent" : outline ? `${color}33` : color,
    border: ring || dashed ? `1.5px dashed ${color}` : outline ? `1.5px solid ${color}` : frame ? `1.5px solid ${frame}` : "none",
  }} />
);

// ---------- main component ----------
export default function SaunaPlanner() {
  const mountRef = useRef(null);
  const threeRef = useRef(null);

  // s = the settings as stored and edited; p = the same plus the bench heights above the floor that the rest
  // of the planner draws with (upper from the ceiling, middle from the upper bench)
  const [s, setS] = useState(DEFAULTS);
  const p = useMemo(() => {
    const upH = Math.min(s.H - 0.2, Math.max(0.15, s.H - s.upCeil));
    const loH = Math.min(upH - 0.05, Math.max(0.05, upH - s.loDrop));
    return { ...s, upH, loH, hW: SPIRIT.w, hD: SPIRIT.d, hH: SPIRIT.h };
  }, [s]);

  const set = (k, v) => setS((prev) => ({ ...prev, [k]: v }));

  // ----- view mode: 3D model or 2D floor plan -----
  const [view, setView] = useState("3d");
  // colour theme of the 2D views (floor plan, side view): dark on screen, or light for printing
  const [planTheme, setPlanTheme] = useState("dark");
  const C = PLAN_THEMES[planTheme];
  // units of the 2D views' measurements: metric, imperial, or both (imperial on a second line)
  const [units, setUnits] = useState("metric");
  const planRef = useRef(null);
  const planBaseRef = useRef(null);
  const [planSize, setPlanSize] = useState({ w: 800, h: 600 });
  const [pz, setPz] = useState(PZ0);
  const pzRef = useRef(PZ0);
  const resetPlanView = () => { pzRef.current = PZ0; setPz(PZ0); };

  // ----- save / load settings as text -----
  const [ioText, setIoText] = useState("");
  const [ioMsg, setIoMsg] = useState("");
  const exportSettings = () => {
    const txt = JSON.stringify({ v: 1, ...s });
    setIoText(txt);
    setIoMsg("Exported — copy the text below and keep it anywhere.");
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => setIoMsg("Exported and copied to clipboard.")).catch(() => {});
    } catch (e) { /* clipboard unavailable — text box still has it */ }
  };
  const importSettings = () => {
    try {
      const o = JSON.parse(ioText.trim());
      const next = { ...DEFAULTS };
      let n = 0;
      for (const k of Object.keys(DEFAULTS)) {
        if (!(k in o)) continue;
        const v = o[k];
        if (typeof v !== typeof DEFAULTS[k]) continue;
        // v1top and sensorSide may be negative; vent diameters are in mm
        if (typeof v === "number" && (!Number.isFinite(v) || v < (k === "v1top" || k === "sensorSide" ? -5 : 0) || v > 500)) continue;
        next[k] = v; n++;
      }
      // legacy: supply/drying heights used to be measured from the floor — convert so the vents stay put
      const legacyNum = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 50;
      if (!("v1top" in o) && legacyNum(o.v1h)) {
        const top = next.heater === "custom" || next.heater === "spirit" ? next.hBottom + SPIRIT.h : next.heater === "cilindro" ? 0.97 : 0.96;
        next.v1top = o.v1h - top; n++;
      }
      if (!("v3ceil" in o) && legacyNum(o.v3h)) { next.v3ceil = Math.max(0, next.H - o.v3h); n++; }
      // saved before the supply duct existed: put the outside opening straight below the inside one
      if (!("v1oX" in o)) next.v1oX = next.v1x;
      // legacy: upper / middle bench heights used to be measured from the floor — convert so they stay put
      const oldUpH = legacyNum(o.upH) ? o.upH : next.H - next.upCeil;
      const toMm = (v) => Math.round(v * 1000) / 1000;
      if (!("upCeil" in o) && legacyNum(o.upH)) { next.upCeil = toMm(Math.max(0, next.H - o.upH)); n++; }
      if (!("loDrop" in o) && legacyNum(o.loH)) { next.loDrop = toMm(Math.max(0, oldUpH - o.loH)); n++; }
      // legacy: older exports used a single shared "bz0" start for all levels
      if (typeof o.bz0 === "number" && Number.isFinite(o.bz0) && o.bz0 >= 0 && o.bz0 <= 50) {
        next.upZ0 = o.bz0; next.loZ0 = o.bz0; next.stZ0 = o.bz0; n++;
      }
      // legacy: the custom-size heater is now the Harvia Spirit at its fixed size
      if (next.heater === "custom") next.heater = "spirit";
      if (!n) throw new Error("no recognised settings");
      setS(next);
      setIoMsg(`Loaded ${n} settings.`);
    } catch (e) {
      setIoMsg("Couldn't read that — paste the exact exported text and try again.");
    }
  };

  // phone mode = touch-primary device AND narrow window; a narrow desktop pane stays desktop
  const [isPhone, setIsPhone] = useState(() => {
    try {
      return window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 700;
    } catch (e) { return false; }
  });
  useEffect(() => {
    const update = () => {
      try {
        setIsPhone(window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 700);
      } catch (e) { /* keep current mode */ }
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ----- derived geometry facts (also used for the clearance check) -----
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isSpirit = p.heater === "spirit"; // Harvia Spirit, back against its wall, size from SPIRIT
  // round heaters: radius; box heater: half its width along the wall
  const heaterR = p.heater === "cilindro" ? 0.16 : p.heater === "drop" ? 0.2 : Math.max(0.05, p.hW / 2);
  const onSideWall = p.heaterWall === "left" || p.heaterWall === "right";
  const hWallLen = onSideWall ? p.D : p.W;
  const hFromWall = p.heater === "drop" ? 0.13 : isSpirit ? p.hD / 2 : p.clearance + heaterR;
  const hAlong = clamp(p.heaterX, heaterR + 0.02, hWallLen - heaterR - 0.02);
  const hx = onSideWall ? (p.heaterWall === "left" ? hFromWall : p.W - hFromWall) : hAlong;
  const hz = onSideWall ? hAlong : (p.heaterWall === "front" ? hFromWall : p.D - hFromWall);
  const ringR = heaterR + p.clearance; // keep-out radius of the round heaters
  // keep-out model shared by all heaters: a footprint box (zero-size for round heaters) plus a reach
  const hbx = isSpirit ? (onSideWall ? p.hD / 2 : p.hW / 2) : 0; // half-extent along room x
  const hbz = isSpirit ? (onSideWall ? p.hW / 2 : p.hD / 2) : 0; // half-extent along room z
  const reach = isSpirit ? p.clearance : ringR;
  const heaterBottom = isSpirit ? p.hBottom : 0;
  const heaterTop = isSpirit ? p.hBottom + p.hH : p.heater === "cilindro" ? 0.97 : 0.96;
  // custom heater shaped like the Harvia Spirit, filling exactly hW × hD × hH: soft vertical edges (rounder at
  // the front), rounded top and bottom edges, and a layer of stones on top whose highest points reach the top
  const hShape = (() => {
    const bev = Math.min(0.035, p.hH / 6, p.hW / 6, p.hD / 6); // top / bottom edge rounding
    const rF = Math.max(bev + 0.005, Math.min(0.12, p.hW / 2 - 0.01, p.hD * 0.55)); // front corners (plan)
    const rB = Math.max(bev + 0.002, Math.min(0.03, p.hW / 4, p.hD / 4)); // back corners, at the wall
    const sr = Math.min(0.032, p.hH / 12, p.hW / 8, p.hD / 8); // stone radius
    return { bev, rF, rB, sr, bodyTop: heaterTop - 1.15 * sr };
  })();

  // vents (round, shared by all views): centre height from each vent's own reference —
  // supply from the heater top, exhaust from the floor, drying from the ceiling
  const ventSpecs = [
    { wall: p.v1wall, off: p.v1x, dmm: p.v1d, c: "#5aa7d6", ref: "heater", y: heaterTop + p.v1top },
    { wall: p.v2wall, off: p.v2x, dmm: p.v2d, c: "#d95f4a", ref: "floor", y: p.v2h },
    { wall: p.v3wall, off: p.v3x, dmm: p.v3d, c: "#a39581", ref: "ceiling", y: p.H - p.v3ceil },
  ].map((v) => {
    const d = Math.max(0.02, v.dmm / 1000), r = d / 2;
    const endWall = v.wall === "front" || v.wall === "back";
    const along = clamp(v.off, r + 0.02, (endWall ? p.W : p.D) - r - 0.02);
    const y = clamp(v.y, r + 0.02, p.H - r - 0.02); // keep the whole opening on the wall
    const rel = v.ref === "heater" ? y - heaterTop : v.ref === "floor" ? y : y - p.H;
    const label = `Ø${Math.round(v.dmm)} · ${v.ref} ${rel >= 0 ? "+" : "−"}${Math.abs(rel).toFixed(2)}`;
    return { ...v, d, r, endWall, along, y, label };
  });

  // temperature sensor on the heater's wall: centre the set distance below the ceiling and sideways from the
  // heater's centre line, + = away from the door (side walls: away from the door wall; front/back walls: away
  // from the door opening along the wall)
  const doorMid = clamp(p.doorX, 0.02, p.W - p.doorW - 0.02) + p.doorW / 2;
  const sensorAway = onSideWall || hAlong >= doorMid ? 1 : -1;
  const sensorAlong = clamp(hAlong + sensorAway * p.sensorSide, SENSOR.w / 2 + 0.01, hWallLen - SENSOR.w / 2 - 0.01);
  const sensorY = clamp(p.H - p.sensorCeil, SENSOR.h / 2 + 0.01, p.H - SENSOR.h / 2 - 0.005);
  // straight-line distance to the supply vent (Harvia's control-unit manual: ≥ 1.0 m, or ≥ 0.5 m if the vent
  // blows away from the sensor)
  const wallPt = (wall, along, y) =>
    wall === "front" ? [along, y, 0] : wall === "back" ? [along, y, p.D] : wall === "left" ? [0, y, along] : [p.W, y, along];
  const sensorPt = wallPt(p.heaterWall, sensorAlong, sensorY);
  // the supply is a duct: the inside opening runs through the wall to an outside opening on the same wall,
  // same diameter, normally lower so warm air can't escape that way
  const supplyOut = (() => {
    const v = ventSpecs[0];
    const along = clamp(p.v1oX, v.r + 0.02, (v.endWall ? p.W : p.D) - v.r - 0.02);
    const y = clamp(p.v1oH, v.r + 0.02, p.H - v.r - 0.02);
    return { along, y, drop: v.y - y };
  })();
  const sensorToSupply = Math.hypot(...wallPt(ventSpecs[0].wall, ventSpecs[0].along, ventSpecs[0].y).map((c, i) => c - sensorPt[i]));
  const supplyMm = Math.round(sensorToSupply * 1000);
  // best airflow at the supply's inside opening: along its wall, away from the sensor — the sensor→vent
  // direction flattened onto the vent's wall, as (along the wall, up); straight down if the sensor is
  // straight out in front of the vent
  const supplyFlow = (() => {
    const v = ventSpecs[0];
    const d = wallPt(v.wall, v.along, v.y).map((c, i) => c - sensorPt[i]);
    const a = v.endWall ? d[0] : d[2], u = d[1], len = Math.hypot(a, u);
    return len < 1e-3 ? { a: 0, u: -1 } : { a: a / len, u: u / len };
  })();

  // heater control panel on its wall, and the shortest distance between its body and the heater's
  const cpEndWall = p.cpWall === "front" || p.cpWall === "back";
  const cpAlong = clamp(p.cpX, CP.w / 2 + 0.01, (cpEndWall ? p.W : p.D) - CP.w / 2 - 0.01);
  const cpY = clamp(p.cpH, CP.h / 2 + 0.01, Math.min(CP_MAX_HEIGHT, p.H - CP.h / 2 - 0.01));
  const cpToHeater = (() => {
    // the panel as a box in room coordinates (x, y, z ranges), on its wall's inner face
    const al = [cpAlong - CP.w / 2, cpAlong + CP.w / 2], yr = [cpY - CP.h / 2, cpY + CP.h / 2];
    const xr = p.cpWall === "left" ? [0, CP.d] : p.cpWall === "right" ? [p.W - CP.d, p.W] : al;
    const zr = p.cpWall === "front" ? [0, CP.d] : p.cpWall === "back" ? [p.D - CP.d, p.D] : al;
    const gap = ([a0, a1], [b0, b1]) => Math.max(0, a0 - b1, b0 - a1);
    const dy = gap(yr, [heaterBottom, heaterTop]);
    if (isSpirit) return Math.hypot(gap(xr, [hx - hbx, hx + hbx]), dy, gap(zr, [hz - hbz, hz + hbz]));
    // round heaters: a cylinder of radius heaterR around (hx, hz)
    const flat = Math.max(0, Math.hypot(gap(xr, [hx, hx]), gap(zr, [hz, hz])) - heaterR);
    return Math.hypot(flat, dy);
  })();
  const cpMm = Math.round(cpToHeater * 1000), cpOk = cpMm >= CP_MIN_FROM_HEATER * 1000; // judged in whole mm, as shown

  const bz1 = clamp(p.bz1, 0, p.D);
  const lvZ0 = (i) => clamp(Math.min(p[LEVELS[i].keys.z0], bz1), 0, p.D);
  // generic level helpers: offsets cascade (each tier tucks 5 cm under the one above)
  const lvOn = (i, w) => !!p[LEVELS[i].keys[w]];
  const lvD = (i) => p[LEVELS[i].keys.d];
  const lvH = (i) => p[LEVELS[i].keys.h];
  const lvOffset = (i, w) => {
    let off = 0, any = false;
    for (let j = 0; j < i; j++) if (lvOn(j, w)) { off += lvD(j) - 0.05; any = true; }
    return any ? off : i === 0 ? 0 : 0.02;
  };
  // side wings of each level stop where that level's back bench begins
  const zE = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const prev = i === 0 ? bz1 : zE[i - 1];
    zE.push(lvOn(i, "back") ? clamp(Math.min(prev, p.D - lvOffset(i, "back") - lvD(i)), lvZ0(i), p.D) : prev);
  }

  function benchRects() {
    const r = [];
    LEVELS.forEach((L, i) => {
      const d = lvD(i), nm = L.name.toLowerCase();
      if (lvOn(i, "left")) {
        const o = lvOffset(i, "left");
        r.push({ x0: o, x1: o + d, z0: lvZ0(i), z1: zE[i], name: `${nm} left bench`, tier: i, wall: "left" });
      }
      if (lvOn(i, "right")) {
        const o = lvOffset(i, "right");
        r.push({ x0: p.W - o - d, x1: p.W - o, z0: lvZ0(i), z1: zE[i], name: `${nm} right bench`, tier: i, wall: "right" });
      }
      if (lvOn(i, "back")) {
        const o = lvOffset(i, "back");
        r.push({ x0: 0, x1: p.W, z0: p.D - o - d, z1: p.D - o, name: `${nm} back bench`, tier: i, wall: "back" });
      }
    });
    return r;
  }
  function clearanceConflicts() {
    const bad = [];
    // walls: the keep-out may not reach through any wall except the one the heater stands/hangs on
    const wallDist = { left: hx - hbx, right: p.W - hx - hbx, front: hz - hbz, back: p.D - hz - hbz };
    for (const [w, dist] of Object.entries(wallDist)) {
      if (w !== p.heaterWall && dist < reach - 0.001) bad.push(w === "front" ? "door wall" : `${w} wall`);
    }
    // benches: gap between the heater footprint and each bench, seen from above
    for (const r of benchRects()) {
      const dx = Math.max(r.x0 - (hx + hbx), 0, (hx - hbx) - r.x1);
      const dz = Math.max(r.z0 - (hz + hbz), 0, (hz - hbz) - r.z1);
      if (Math.hypot(dx, dz) < reach - 0.001) bad.push(r.name);
    }
    // box heater: the minimum distance from its top to the ceiling
    if (isSpirit && heaterTop + p.ceilClear > p.H + 0.001) bad.push("ceiling");
    return bad;
  }
  const conflicts = clearanceConflicts();

  // safety railing (Harvia Spirit only): a rounded U around the top, centred on the heater along its wall, its
  // back ends at the wall. The front corners follow the heater's own, kept the railing's side gap further out.
  const railOn = isSpirit && p.railing;
  const railW = Math.max(RAIL.w, p.hW + 0.04), railD = Math.max(RAIL.d, p.hD + 0.04);
  const railR = Math.max(RAIL.t + 0.005, Math.min(hShape.rF + (railW - p.hW) / 2, railW / 2 - 0.001, railD - 0.001));
  // a point given along its wall and out from it → room x / z
  const wallXZ = (along, depth) =>
    p.heaterWall === "front" ? [along, depth] : p.heaterWall === "back" ? [along, p.D - depth]
    : p.heaterWall === "left" ? [depth, along] : [p.W - depth, along];
  // bounding footprint in room x / z (walls are checked against this: the back ends meet the wall square)
  const [fxa, fza] = wallXZ(hAlong - railW / 2, 0), [fxb, fzb] = wallXZ(hAlong + railW / 2, railD);
  const railFoot = { x0: Math.min(fxa, fxb), x1: Math.max(fxa, fxb), z0: Math.min(fza, fzb), z1: Math.max(fza, fzb) };
  // walls and benches the railing would collide with (seen from above, rounded front corners included)
  const railHits = (() => {
    if (!railOn) return [];
    const r = railFoot, hits = [];
    if (r.x0 < -0.001) hits.push("left wall");
    if (r.x1 > p.W + 0.001) hits.push("right wall");
    if (r.z0 < -0.001) hits.push("door wall");
    if (r.z1 > p.D + 0.001) hits.push("back wall");
    // a bench rectangle in (along − heater centre, depth) coordinates of the heater's wall
    const toAD = (b) =>
      p.heaterWall === "front" ? [b.x0 - hAlong, b.x1 - hAlong, b.z0, b.z1]
      : p.heaterWall === "back" ? [b.x0 - hAlong, b.x1 - hAlong, p.D - b.z1, p.D - b.z0]
      : p.heaterWall === "left" ? [b.z0 - hAlong, b.z1 - hAlong, b.x0, b.x1]
      : [b.z0 - hAlong, b.z1 - hAlong, p.W - b.x1, p.W - b.x0];
    const ov = (a0, a1, b0, b1) => a0 < b1 - 0.001 && b0 < a1 - 0.001;
    const hw = railW / 2, R = railR;
    for (const b of benchRects()) {
      const [a0, a1, d0, d1] = toAD(b);
      // the rounded footprint = two overlapping rectangles + the two front corner circles
      const core = (ov(a0, a1, -hw, hw) && ov(d0, d1, 0, railD - R)) || (ov(a0, a1, -hw + R, hw - R) && ov(d0, d1, 0, railD));
      const corner = [-1, 1].some((sg) => {
        const ca = sg * (hw - R), cd = railD - R;
        return Math.hypot(Math.max(a0 - ca, 0, ca - a1), Math.max(d0 - cd, 0, cd - d1)) < R - 0.001;
      });
      if (core || corner) hits.push(b.name);
    }
    return hits;
  })();

  // seated capacity on the upper level: pack figures at seatW spacing per wing
  function peoplePlacements() {
    const out = [];
    const sw = clamp(p.seatW, 0.4, 0.9);
    // sit toward the front of deep benches so the shins dangle off the edge instead of clipping through
    const hip = Math.max(0.17, p.upD - 0.28); // hip-centre distance from the wall
    const z0u = lvZ0(0);
    const lenS = Math.max(0, zE[0] - z0u);
    const place = (usable, start, fn) => {
      const n = Math.floor(usable / sw + 1e-6);
      for (let k = 0; k < n; k++) fn(start + (usable / n) * (k + 0.5));
    };
    if (p.bLeft) place(lenS, z0u, (t) => out.push({ x: hip, z: t, ry: Math.PI / 2, sx: p.upD / 2, sz: t, along: "z" }));
    if (p.bRight) place(lenS, z0u, (t) => out.push({ x: p.W - hip, z: t, ry: -Math.PI / 2, sx: p.W - p.upD / 2, sz: t, along: "z" }));
    if (p.bBack) {
      const s = p.bLeft ? p.upD : 0;
      const u = Math.max(0, p.W - s - (p.bRight ? p.upD : 0));
      place(u, s, (t) => out.push({ x: t, z: p.D - hip, ry: Math.PI, sx: t, sz: p.D - p.upD / 2, along: "x" }));
    }
    return out;
  }
  const people = peoplePlacements();

  // ----- floor plan facts (same geometry as the 3D model) -----
  const planRects = benchRects();
  const railMarks = [];
  if (p.showRails) {
    const z0u = lvZ0(0);
    for (const side of ["left", "right"]) {
      if (!(side === "left" ? p.bLeft : p.bRight)) continue;
      if (z0u > 0.03) railMarks.push({ side, z: z0u + 0.03 });
      if (!p.bBack && zE[0] < p.D - 0.03) railMarks.push({ side, z: zE[0] - 0.03 });
    }
  }
  // a spot in [lo, hi] clear of the heater + its clearance (c ± r); prefers the middle, null if none
  const keepX = hbx + reach + 0.08, keepZ = hbz + reach + 0.08; // heater keep-out + margin, per axis
  const clearSpot = (lo, hi, c, r) => {
    if (hi - lo < 0.02) return null;
    const mid = (lo + hi) / 2;
    if (Math.abs(mid - c) >= r) return mid;
    const la = Math.min(hi, c - r) - lo, lb = hi - Math.max(lo, c + r);
    if (Math.max(la, lb) < 0.06) return null;
    return la >= lb ? lo + la / 2 : hi - lb / 2;
  };
  const backRects = planRects.filter((r) => r.wall === "back");
  const backFront = backRects.length ? Math.min(...backRects.map((r) => r.z0)) : p.D;
  // free floor between the side benches: where most tiers overlap, in front of any back bench, away from the heater
  let aisle = null;
  const sideRects = planRects.filter((r) => r.wall !== "back" && r.z1 > r.z0);
  if (sideRects.length) {
    const zA = Math.max(...sideRects.map((r) => r.z0)), zB = Math.min(...sideRects.map((r) => r.z1));
    const lo = zA < zB ? zA : Math.min(...sideRects.map((r) => r.z0));
    const hi = Math.min(backFront, zA < zB ? zB : Math.max(...sideRects.map((r) => r.z1)));
    if (hi > lo) {
      const zs = clearSpot(lo, hi, hz, keepZ);
      const zl = zs === null ? (lo + hi) / 2 : zs;
      const cross = sideRects.filter((r) => r.z0 <= zl && r.z1 >= zl);
      const L = Math.max(0, ...cross.filter((r) => r.wall === "left").map((r) => r.x1));
      const R = Math.min(p.W, ...cross.filter((r) => r.wall === "right").map((r) => r.x0));
      if (cross.length && R - L > 0.02) aisle = { z: zl, x0: L, x1: R };
    }
  }
  // the heater's half-size seen from above, along room x and z (the drop is an ellipse, longer along its wall)
  const hPlanX = isSpirit ? hbx : p.heater === "cilindro" ? heaterR : onSideWall ? 0.124 : 0.2;
  const hPlanZ = isSpirit ? hbz : p.heater === "cilindro" ? heaterR : onSideWall ? 0.2 : 0.124;
  // free floor across the room level with the heater: from the front of the side benches there (the lowest
  // tier on that side) to the heater — or to its safety railing, when fitted. Shown instead of the aisle above;
  // the aisle remains the fallback when no side bench is level with the heater
  const heaterGaps = [];
  {
    const level = sideRects.filter((r) => r.z0 <= hz && r.z1 >= hz);
    const ox0 = railOn ? railFoot.x0 : hx - hPlanX, ox1 = railOn ? railFoot.x1 : hx + hPlanX;
    const lefts = level.filter((r) => r.wall === "left").map((r) => r.x1);
    const rights = level.filter((r) => r.wall === "right").map((r) => r.x0);
    if (lefts.length && ox0 - Math.max(...lefts) > 0.02) heaterGaps.push({ z: hz, x0: Math.max(...lefts), x1: ox0 });
    if (rights.length && Math.min(...rights) - ox1 > 0.02) heaterGaps.push({ z: hz, x0: ox1, x1: Math.min(...rights) });
  }
  // free floor from the door wall to the front of the back benches (skipped if the heater blocks the way)
  let depthFree = null;
  if (backRects.length && backFront > 0.05) {
    const xl = clearSpot(aisle ? aisle.x0 : 0, aisle ? aisle.x1 : p.W, hx, keepX);
    if (xl !== null) depthFree = { x: xl, z1: backFront };
  }

  // the render loop reads this each frame, so 3D rendering pauses while a 2D view is shown
  const viewRef = useRef(view);
  viewRef.current = view;

  // 2D views (floor plan, side view): size tracking + pan (drag) / zoom (wheel, pinch) / fit (double-click)
  useEffect(() => {
    if (view === "3d") return undefined;
    const el = planRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth && el.clientHeight) setPlanSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    const pts = new Map();
    let lastD = 0, lastMx = 0, lastMy = 0;
    const apply = (next) => {
      const b = planBaseRef.current;
      const c = {
        z: next.z,
        cx: Math.min(b.bW / 2, Math.max(-b.bW / 2, next.cx)),
        cy: Math.min(b.bH / 2, Math.max(-b.bH / 2, next.cy)),
      };
      pzRef.current = c;
      setPz(c);
    };
    const rel = (e) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const zoomAt = (x, y, f) => {
      const b = planBaseRef.current, cur = pzRef.current;
      const z2 = Math.min(8, Math.max(1, cur.z * f));
      const fe = z2 / cur.z;
      if (Math.abs(fe - 1) < 1e-9) return;
      const g = viewGeom(b, cur);
      const ux = g.minX + (x - g.offX) / g.s, uy = g.minY + (y - g.offY) / g.s;
      const s2 = g.s * fe;
      const minX2 = ux - (x - g.offX) / s2, minY2 = uy - (y - g.offY) / s2;
      apply({ z: z2, cx: minX2 + g.vw / fe / 2 - b.bcx, cy: minY2 + g.vh / fe / 2 - b.bcy });
    };
    const panBy = (dx, dy) => {
      const cur = pzRef.current, g = viewGeom(planBaseRef.current, cur);
      apply({ z: cur.z, cx: cur.cx - dx / g.s, cy: cur.cy - dy / g.s });
    };
    const onWheel = (e) => {
      e.preventDefault();
      const [x, y] = rel(e);
      zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
    };
    const onDown = (e) => {
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, rel(e));
      el.style.cursor = "grabbing";
      if (pts.size === 2) {
        const [a, c] = [...pts.values()];
        lastD = Math.hypot(a[0] - c[0], a[1] - c[1]);
        lastMx = (a[0] + c[0]) / 2; lastMy = (a[1] + c[1]) / 2;
      }
    };
    const onMove = (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId), cur = rel(e);
      pts.set(e.pointerId, cur);
      if (pts.size === 1) panBy(cur[0] - prev[0], cur[1] - prev[1]);
      else if (pts.size === 2) {
        const [a, c] = [...pts.values()];
        const d = Math.hypot(a[0] - c[0], a[1] - c[1]);
        const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2;
        panBy(mx - lastMx, my - lastMy);
        if (lastD > 0 && d > 0) zoomAt(mx, my, d / lastD);
        lastD = d; lastMx = mx; lastMy = my;
      }
    };
    const onUp = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) lastD = 0;
      if (!pts.size) el.style.cursor = "grab";
    };
    const onDbl = () => apply(PZ0);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("dblclick", onDbl);
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("dblclick", onDbl);
    };
  }, [view]);

  // ------------------------------------------------------------------
  // mount: renderer, camera, lights, controls, loop
  // ------------------------------------------------------------------
  useEffect(() => {
    const mountEl = mountRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    mountEl.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(PAL.bg);
    scene.fog = new THREE.FogExp2(PAL.bg, 0.028);

    const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 80);

    // lights
    scene.add(new THREE.HemisphereLight(0xfff1e0, 0x241a12, 0.55));
    const sun = new THREE.DirectionalLight(0xffe6c4, 0.9);
    sun.position.set(3.2, 5.2, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -4; sun.shadow.camera.right = 4;
    sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4;
    scene.add(sun);
    const emberLight = new THREE.PointLight(0xff8a3c, 0.0, 2.6, 2);
    scene.add(emberLight);

    // outside ground
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(8, 48),
      new THREE.MeshStandardMaterial({ color: PAL.ground, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    ground.receiveShadow = true;
    scene.add(ground);

    // Room coordinates keep the door wall at z = 0; the group is mirrored front-to-back so the
    // door wall faces the viewer (bottom of the floor plan) and left/right read as when walking in.
    // three.js flips face winding for negative scale, so shading and shadows stay correct.
    const roomGroup = new THREE.Group();
    roomGroup.scale.z = -1;
    scene.add(roomGroup);

    const st = {
      renderer, scene, camera, roomGroup, emberLight,
      walls: [], // { obj, center: Vector3, normal: Vector3 } inward normals
      sph: { theta: 0.62, phi: 1.07, r: 4.8 },
      target: new THREE.Vector3(0, 0.95, 0),
      raf: 0,
    };
    threeRef.current = st;

    // ----- custom controls -----
    const el = renderer.domElement;
    const pointers = new Map();
    let lastPinch = 0, lastCx = 0, lastCy = 0;

    const onDown = (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
        lastCx = (a.x + b.x) / 2; lastCy = (a.y + b.y) / 2;
      }
    };
    const pan = (dx, dy) => {
      const s = st.sph.r * 0.0011;
      const fwd = new THREE.Vector3().subVectors(st.target, camera.position).setY(0).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      st.target.addScaledVector(right, dx * s);
      st.target.y = clamp(st.target.y + dy * s, 0.1, 3.0);
    };
    const onMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { ...prev, x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        if (prev.button === 2 || prev.shift) pan(dx, dy);
        else {
          st.sph.theta -= dx * 0.0055;
          st.sph.phi = clamp(st.sph.phi - dy * 0.0045, 0.12, 1.6);
        }
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const pinch = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        if (lastPinch > 0) st.sph.r = clamp((st.sph.r * lastPinch) / pinch, 1.1, 14);
        pan(cx - lastCx, cy - lastCy);
        lastPinch = pinch; lastCx = cx; lastCy = cy;
      }
    };
    const onUp = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) lastPinch = 0; };
    const onWheel = (e) => {
      e.preventDefault();
      st.sph.r = clamp(st.sph.r * (1 + e.deltaY * 0.0011), 1.1, 14);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    // ----- resize -----
    const fit = () => {
      const w = mountEl.clientWidth, h = mountEl.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(mountEl);

    // ----- loop -----
    const camDir = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const loop = () => {
      const { sph, target } = st;
      camera.position.set(
        target.x + sph.r * Math.sin(sph.phi) * Math.sin(sph.theta),
        target.y + sph.r * Math.cos(sph.phi),
        target.z + sph.r * Math.sin(sph.phi) * Math.cos(sph.theta)
      );
      camera.lookAt(target);
      // dollhouse wall culling: hide walls between camera and room
      for (const w of st.walls) {
        tmp.copy(camera.position).sub(w.center);
        w.obj.visible = tmp.dot(w.normal) > 0;
      }
      if (viewRef.current === "3d") renderer.render(scene, camera);
      st.raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(st.raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      disposeObject(scene);
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  // ------------------------------------------------------------------
  // rebuild room whenever params change
  // ------------------------------------------------------------------
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;
    const { roomGroup } = st;
    while (roomGroup.children.length) {
      const c = roomGroup.children.pop();
      disposeObject(c);
      roomGroup.remove(c);
    }
    st.walls = [];

    const { W, D, H } = p;
    const ox = -W / 2, oz = -D / 2; // center the room on the origin
    const t = 0.045; // wall thickness
    const place = (m, x, y, z) => { m.position.set(ox + x, y, oz + z); return m; };
    const addWall = (obj, center, normal) => {
      roomGroup.add(obj);
      // culling runs in world space, so apply the group's front-to-back mirror here
      const c = center.clone().add(new THREE.Vector3(ox, 0, oz));
      c.z = -c.z;
      st.walls.push({ obj, center: c, normal: new THREE.Vector3(normal.x, normal.y, -normal.z) });
    };

    // ---- floor ----
    const floor = box(W, 0.04, D, mat(PAL.floor, { roughness: 0.95 }), false);
    place(floor, W / 2, -0.02, D / 2);
    floor.receiveShadow = true;
    roomGroup.add(floor);
    // plank seams
    {
      const pts = [];
      for (let x = 0.12; x < W; x += 0.12) pts.push(new THREE.Vector3(x, 0.002, 0), new THREE.Vector3(x, 0.002, D));
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const seams = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x4d3a26, transparent: true, opacity: 0.5 }));
      seams.position.set(ox, 0, oz);
      roomGroup.add(seams);
    }

    // ---- walls (paneling tint per wall) ----
    const wallMat = () => mat(PAL.wall, { roughness: 0.9 });
    // left
    addWall(place(box(t, H, D, wallMat()), -t / 2, H / 2, D / 2), new THREE.Vector3(0, H / 2, D / 2), new THREE.Vector3(1, 0, 0));
    // right
    addWall(place(box(t, H, D, wallMat()), W + t / 2, H / 2, D / 2), new THREE.Vector3(W, H / 2, D / 2), new THREE.Vector3(-1, 0, 0));
    // back
    addWall(place(box(W, H, t, wallMat()), W / 2, H / 2, D + t / 2), new THREE.Vector3(W / 2, H / 2, D), new THREE.Vector3(0, 0, -1));
    // ceiling
    addWall(place(box(W + 2 * t, t, D + 2 * t, mat(PAL.ceil, { roughness: 0.92 })), W / 2, H + t / 2, D / 2), new THREE.Vector3(W / 2, H, D / 2), new THREE.Vector3(0, -1, 0));

    // front wall, with a door opening
    const doorH = Math.min(1.95, H - 0.05);
    const dX0 = clamp(p.doorX, 0.02, W - p.doorW - 0.02);
    const front = new THREE.Group();
    const seg = (x0, x1, y0, y1) => {
      if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return;
      const b = box(x1 - x0, y1 - y0, t, wallMat());
      b.position.set(ox + (x0 + x1) / 2, (y0 + y1) / 2, oz - t / 2);
      front.add(b);
    };
    seg(0, dX0, 0, H);
    seg(dX0 + p.doorW, W, 0, H);
    seg(dX0, dX0 + p.doorW, doorH, H);
    addWall(front, new THREE.Vector3(W / 2, H / 2, 0), new THREE.Vector3(0, 0, 1));

    // door: frame + glass (always visible so the opening reads from inside too)
    {
      const door = new THREE.Group();
      const fm = mat(PAL.frame, { roughness: 0.7 });
      const jamb = (x) => { const b = box(0.05, doorH, 0.07, fm); b.position.set(x, doorH / 2, 0); door.add(b); };
      jamb(dX0 + 0.025); jamb(dX0 + p.doorW - 0.025);
      const head = box(p.doorW, 0.05, 0.07, fm);
      head.position.set(dX0 + p.doorW / 2, doorH - 0.025, 0);
      door.add(head);
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(p.doorW - 0.13, doorH - 0.1),
        new THREE.MeshStandardMaterial({ color: PAL.glass, transparent: true, opacity: 0.22, roughness: 0.15, metalness: 0.1, side: THREE.DoubleSide })
      );
      glass.position.set(dX0 + p.doorW / 2, doorH / 2 - 0.02, 0);
      door.add(glass);
      const handle = box(0.03, 0.5, 0.03, mat(0x2d2a27, { roughness: 0.4, metalness: 0.4 }));
      handle.position.set(dX0 + p.doorW - 0.12, 1.05, 0.05);
      door.add(handle);
      door.position.set(ox, 0, oz);
      roomGroup.add(door);
    }

    // ---- benches: three tiers, any wall combination — seat planks only (no legs or front boards) ----
    const thick = 0.04;
    const mkBench = (depth, hTop, length) => buildBenchTop(length, depth, thick, hTop);
    const addBackWing = (depth, hTop, offset) => {
      const g = buildBenchTop(W, depth, thick, hTop);
      g.rotation.y = -Math.PI / 2;
      g.position.set(ox + W, 0, oz + D - offset - depth);
      roomGroup.add(g);
    };
    LEVELS.forEach((L, i) => {
      const d = lvD(i), h = lvH(i);
      const z0i = lvZ0(i);
      const len = Math.max(0.05, zE[i] - z0i);
      if (lvOn(i, "left")) {
        const g = mkBench(d, h, len);
        g.position.set(ox + lvOffset(i, "left"), 0, oz + z0i);
        roomGroup.add(g);
      }
      if (lvOn(i, "right")) {
        const g = mkBench(d, h, len);
        g.rotation.y = Math.PI;
        g.position.set(ox + W - lvOffset(i, "right"), 0, oz + zE[i]);
        roomGroup.add(g);
      }
      if (lvOn(i, "back")) addBackWing(d, h, lvOffset(i, "back"));
    });

    // ---- guard rails on exposed upper bench ends ----
    if (p.showRails) {
      const railMat = mat(PAL.benchDark, { roughness: 0.7 });
      const addRail = (side, zPos, dir) => {
        const g = new THREE.Group();
        const topY = p.upH + 0.45;
        const post = box(0.045, topY, 0.045, railMat);
        post.position.set(p.upD - 0.04, topY / 2, 0);
        g.add(post);
        [p.upH + 0.2, p.upH + 0.42].forEach((y) => {
          const bar = box(p.upD - 0.015, 0.055, 0.028, railMat);
          bar.position.set((p.upD - 0.015) / 2, y, 0);
          g.add(bar);
        });
        if (side === "left") g.position.set(ox, 0, oz + zPos + dir * 0.03);
        else { g.rotation.y = Math.PI; g.position.set(ox + W, 0, oz + zPos + dir * 0.03); }
        roomGroup.add(g);
      };
      const railEnds = (side) => {
        const z0u = lvZ0(0);
        if (z0u > 0.03) addRail(side, z0u, 1);
        if (!p.bBack && zE[0] < D - 0.03) addRail(side, zE[0], -1);
      };
      if (p.bLeft) railEnds("left");
      if (p.bRight) railEnds("right");
    }

    // ---- seated figures on the upper level ----
    if (p.showPeople && people.length) {
      const pm = mat(0x9aa7b8, { roughness: 0.95 });
      for (const q of people) {
        const fig = buildPerson(p.upH, pm);
        fig.rotation.y = q.ry;
        fig.position.set(ox + q.x, 0, oz + q.z);
        roomGroup.add(fig);
      }
    }

    // ---- seat width volumes (one per occupant, exactly seatW wide) ----
    if (p.showSeatW && people.length) {
      const sw = clamp(p.seatW, 0.4, 0.9);
      const hgt = 1.0;
      for (const q of people) {
        const wx = q.along === "x" ? sw : p.upD;
        const dz = q.along === "x" ? p.upD : sw;
        const geo = new THREE.BoxGeometry(wx, hgt, dz);
        const m = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ color: 0x9aa7b8, transparent: true, opacity: 0.07, depthWrite: false })
        );
        m.position.set(ox + q.sx, p.upH + hgt / 2, oz + q.sz);
        roomGroup.add(m);
        const e = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x9aa7b8, transparent: true, opacity: 0.55 })
        );
        e.position.copy(m.position);
        roomGroup.add(e);
      }
    }

    // ---- heater ----
    const heater = new THREE.Group();
    if (p.heater === "cilindro") {
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(heaterR, heaterR, 0.93, 28, 1, true),
        mat(PAL.steel, { roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide })
      );
      shell.position.y = 0.465 + 0.04;
      shell.castShadow = true;
      heater.add(shell);
      const base = box(0.26, 0.04, 0.26, mat(PAL.black, { metalness: 0.3, roughness: 0.5 }), false);
      base.position.y = 0.02;
      heater.add(base);
      for (let i = 0; i < 9; i++) {
        const r = 0.035 + Math.random() * 0.022;
        const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat(PAL.stoneC, { roughness: 1 }));
        const a = (i / 9) * Math.PI * 2;
        const rad = i === 0 ? 0 : 0.085;
        s.position.set(Math.cos(a) * rad, 0.97 + (i % 3) * 0.018, Math.sin(a) * rad);
        s.castShadow = true;
        heater.add(s);
      }
      const glow = new THREE.Mesh(
        new THREE.CylinderGeometry(heaterR - 0.02, heaterR - 0.02, 0.02, 24),
        new THREE.MeshBasicMaterial({ color: PAL.ember })
      );
      glow.position.y = 0.95;
      heater.add(glow);
    } else if (isSpirit) {
      // Harvia Spirit (see hShape): width along the wall (local x), depth out from it (local +z faces the room);
      // a rounded block from hBottom up to bodyTop, its outer footprint exactly hW × hD
      const { bev, rF, rB, sr, bodyTop } = hShape;
      const geo = roundedBlockGeometry(p.hW / 2, p.hD / 2, rF, rB, bodyTop - heaterBottom, bev);
      const body = new THREE.Mesh(geo, mat(PAL.black, { roughness: 0.4, metalness: 0.35, side: THREE.DoubleSide }));
      body.position.y = heaterBottom;
      body.castShadow = true;
      heater.add(body);
      // safety railing: one black birch band round the top, its back ends at the wall (local z = −hD/2)
      if (railOn) {
        const shp = new THREE.Shape(railContour(railW, railD, railR, RAIL.t).map(([a, d]) => new THREE.Vector2(a, -d)));
        const rg = new THREE.ExtrudeGeometry(shp, { depth: RAIL.h, bevelEnabled: false });
        rg.rotateX(-Math.PI / 2); // extrusion → up, shape y (−depth) → local z (depth)
        const rail = new THREE.Mesh(rg, mat(0x1b1918, { roughness: 0.8, side: THREE.DoubleSide }));
        rail.position.set(0, heaterTop - RAIL.h, -p.hD / 2);
        rail.castShadow = true;
        heater.add(rail);
      }
      // stones on the top, inside the rounded outline; their highest points stay at or below the set height
      const inside = (x, z, m) => {
        const ax = Math.abs(x), r = z > 0 ? Math.max(0, rF - m) : Math.max(0, rB - m);
        const ex = p.hW / 2 - m, ez = p.hD / 2 - m;
        if (ax > ex || Math.abs(z) > ez) return false;
        const cx = ex - r, cz = ez - r;
        return ax <= cx || Math.abs(z) <= cz || Math.hypot(ax - cx, Math.abs(z) - cz) <= r;
      };
      const step = sr * 2.1, margin = sr + bev * 0.6;
      let si = 0;
      for (let x = -p.hW / 2 + margin; x <= p.hW / 2 - margin + 1e-6; x += step) {
        for (let z = -p.hD / 2 + margin; z <= p.hD / 2 - margin + 1e-6; z += step) {
          if (!inside(x, z, margin)) continue;
          const r = sr * (0.8 + Math.random() * 0.2);
          // most stones sit a few mm lower for a natural pile; every third touches the top, which keeps the
          // heater's highest point exactly at its set height
          const sink = si++ % 3 === 0 ? 0 : Math.random() * 0.006;
          const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat(PAL.stoneC, { roughness: 1 }));
          s.position.set(x + (Math.random() - 0.5) * sr * 0.3, heaterTop - r - sink, z + (Math.random() - 0.5) * sr * 0.3);
          s.castShadow = true;
          heater.add(s);
        }
      }
    } else {
      // HUUM Drop — wall-mounted teardrop, approximated
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.16, 0.7, 24),
        mat(PAL.black, { roughness: 0.35, metalness: 0.3 })
      );
      body.scale.z = 0.62;
      body.position.y = 0.26 + 0.35;
      body.castShadow = true;
      heater.add(body);
      for (let i = 0; i < 6; i++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.035 + Math.random() * 0.015, 8, 6), mat(PAL.stoneC, { roughness: 1 }));
        const a = (i / 6) * Math.PI * 2;
        s.position.set(Math.cos(a) * 0.08, 0.99, Math.sin(a) * 0.05);
        heater.add(s);
      }
    }
    heater.position.set(ox + hx, 0, oz + hz);
    // turn the heater so its local +z (front) faces into the room and local x runs along its wall
    heater.rotation.y = { front: 0, back: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[p.heaterWall];
    roomGroup.add(heater);


    // temperature sensor: a small housing on the heater's wall
    {
      const sb = box(SENSOR.w, SENSOR.h, SENSOR.d, mat(0xece6da, { roughness: 0.5 }), true, 0x2b2118, 0.6);
      const inset = SENSOR.d / 2 + 0.002; // just off the wall's inner face
      if (p.heaterWall === "front") sb.position.set(ox + sensorAlong, sensorY, oz + inset);
      else if (p.heaterWall === "back") sb.position.set(ox + sensorAlong, sensorY, oz + D - inset);
      else if (p.heaterWall === "left") { sb.position.set(ox + inset, sensorY, oz + sensorAlong); sb.rotation.y = Math.PI / 2; }
      else { sb.position.set(ox + W - inset, sensorY, oz + sensorAlong); sb.rotation.y = -Math.PI / 2; }
      roomGroup.add(sb);
    }

    // control panel: a small dark keypad with a lit display; its local +z faces into the room
    {
      const cp = box(CP.w, CP.h, CP.d, mat(0x2b2829, { roughness: 0.4, metalness: 0.2 }), true, 0x6a625a, 0.6);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(CP.w * 0.7, CP.h * 0.32), new THREE.MeshBasicMaterial({ color: PAL.ember }));
      screen.position.set(0, CP.h * 0.18, CP.d / 2 + 0.001);
      cp.add(screen);
      const inset = CP.d / 2 + 0.002;
      if (p.cpWall === "front") cp.position.set(ox + cpAlong, cpY, oz + inset);
      else if (p.cpWall === "back") { cp.position.set(ox + cpAlong, cpY, oz + D - inset); cp.rotation.y = Math.PI; }
      else if (p.cpWall === "left") { cp.position.set(ox + inset, cpY, oz + cpAlong); cp.rotation.y = Math.PI / 2; }
      else { cp.position.set(ox + W - inset, cpY, oz + cpAlong); cp.rotation.y = -Math.PI / 2; }
      roomGroup.add(cp);
    }
    st.emberLight.position.set(ox + hx, heaterTop + 0.18, -(oz + hz)); // world space: mirrored like roomGroup
    st.emberLight.intensity = 0.55;

    // safety clearance: box heater → its footprint grown by the clearance, from its bottom up to
    // the ceiling distance (pokes through the ceiling when that is too low); round heaters → cylinder
    if (p.showClear && isSpirit) {
      const c = p.clearance;
      const hgt = p.hH + p.ceilClear;
      // footprint grown by c, kept inside the room (no zone behind the heater, inside its own wall)
      const x0 = Math.max(0, hx - hbx - c), x1 = Math.min(W, hx + hbx + c);
      const z0 = Math.max(0, hz - hbz - c), z1 = Math.min(D, hz + hbz + c);
      const vol = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.01, x1 - x0), hgt, Math.max(0.01, z1 - z0)),
        new THREE.MeshBasicMaterial({ color: PAL.ember, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })
      );
      vol.position.set(ox + (x0 + x1) / 2, heaterBottom + hgt / 2, oz + (z0 + z1) / 2);
      roomGroup.add(vol);
      // outline on the floor: the exact keep-out (rounded corners of radius c)
      const pts = [];
      const corners = [[hbx, hbz, 0], [-hbx, hbz, Math.PI / 2], [-hbx, -hbz, Math.PI], [hbx, -hbz, (3 * Math.PI) / 2]];
      for (const [cx, cz, a0] of corners) {
        for (let i = 0; i <= 8; i++) {
          const a = a0 + (i / 8) * (Math.PI / 2);
          // clamped to the room, so the outline runs along the wall face behind the heater
          pts.push(new THREE.Vector3(
            clamp(hx + cx + Math.cos(a) * c, 0, W) - hx, 0.006, clamp(hz + cz + Math.sin(a) * c, 0, D) - hz
          ));
        }
      }
      pts.push(pts[0].clone());
      const outline = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: PAL.ember, transparent: true, opacity: 0.9 })
      );
      outline.position.set(ox + hx, 0, oz + hz);
      roomGroup.add(outline);
    } else if (p.showClear) {
      const hgt = 1.15;
      const vol = new THREE.Mesh(
        new THREE.CylinderGeometry(ringR, ringR, hgt, 40, 1, true),
        new THREE.MeshBasicMaterial({ color: PAL.ember, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false })
      );
      vol.position.set(ox + hx, hgt / 2, oz + hz);
      roomGroup.add(vol);
      const ringPts = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        ringPts.push(new THREE.Vector3(Math.cos(a) * ringR, 0.006, Math.sin(a) * ringR));
      }
      const ring = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(ringPts),
        new THREE.LineBasicMaterial({ color: PAL.ember, transparent: true, opacity: 0.9 })
      );
      ring.position.set(ox + hx, 0, oz + hz);
      roomGroup.add(ring);
    }

    // ---- vents ----
    if (p.showVents) {
      // round vents: a coloured disc with a dark rim, the given diameter
      ventSpecs.forEach((v, idx) => {
        const plate = new THREE.Mesh(
          new THREE.CircleGeometry(v.r, 36),
          new THREE.MeshStandardMaterial({ color: v.c, roughness: 0.6, side: THREE.DoubleSide, emissive: v.c, emissiveIntensity: 0.25 })
        );
        const rim = new THREE.Mesh(
          new THREE.RingGeometry(v.r, v.r + 0.01, 36),
          new THREE.MeshBasicMaterial({ color: 0x171210, side: THREE.DoubleSide })
        );
        plate.add(rim);
        const inset = 0.012;
        if (v.wall === "front") { plate.position.set(ox + v.along, v.y, oz + inset); }
        else if (v.wall === "back") { plate.position.set(ox + v.along, v.y, oz + D - inset); plate.rotation.y = Math.PI; }
        else if (v.wall === "left") { plate.position.set(ox + inset, v.y, oz + v.along); plate.rotation.y = Math.PI / 2; }
        else { plate.position.set(ox + W - inset, v.y, oz + v.along); plate.rotation.y = -Math.PI / 2; }
        roomGroup.add(plate);

        // supply: duct through the wall to the outside opening. Both sit in / behind the wall, so they are
        // drawn X-ray style (faint, through everything) rather than as solid parts of the room
        if (idx === 0) {
          // airflow arrow on the inside opening: along the wall, away from the sensor. The disc's local x axis
          // is room +x / −x / −z / +z on the front / back / left / right wall; its local y is up
          const aLocal = v.wall === "front" || v.wall === "right" ? supplyFlow.a : -supplyFlow.a;
          const shp = new THREE.Shape();
          ARROW_PTS.forEach(([x, y], i) => (i ? shp.lineTo(x * v.r, y * v.r) : shp.moveTo(x * v.r, y * v.r)));
          shp.closePath();
          const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shp), new THREE.MeshBasicMaterial({ color: 0xf4efe6, side: THREE.DoubleSide }));
          arrow.rotation.z = Math.atan2(supplyFlow.u, aLocal);
          arrow.position.z = 0.003; // just in front of the disc, on the room side
          plate.add(arrow);

          const o = supplyOut;
          // a point on the vent's wall: along the wall, height, and depth outward from the inner face
          const wp = (along, y, depth) =>
            v.wall === "front" ? new THREE.Vector3(ox + along, y, oz - depth)
            : v.wall === "back" ? new THREE.Vector3(ox + along, y, oz + D + depth)
            : v.wall === "left" ? new THREE.Vector3(ox - depth, y, oz + along)
            : new THREE.Vector3(ox + W + depth, y, oz + along);
          const k = (v.y - o.y) / 2; // vertical tangents at both openings → a soft S
          const curve = new THREE.CubicBezierCurve3(
            wp(v.along, v.y, 0), wp(v.along, v.y - k, t / 2), wp(o.along, o.y + k, t / 2), wp(o.along, o.y, t)
          );
          const ghost = (opacity) => new THREE.MeshBasicMaterial({
            color: v.c, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
          });
          const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, v.r * 0.92, 16, false), ghost(0.3));
          tube.renderOrder = 10;
          roomGroup.add(tube);
          const outDisc = new THREE.Mesh(new THREE.CircleGeometry(v.r, 36), ghost(0.35));
          const outRing = new THREE.Mesh(new THREE.RingGeometry(v.r, v.r + 0.012, 36), ghost(0.95));
          outDisc.add(outRing);
          outDisc.position.copy(wp(o.along, o.y, t + 0.003));
          outDisc.rotation.y = plate.rotation.y;
          outDisc.renderOrder = 11;
          outRing.renderOrder = 11;
          roomGroup.add(outDisc);
        }
      });
    }
  }, [p, hx, hz, ringR, bz1, heaterR]);

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------
  const ventLegend = [
    ["#5aa7d6", "Supply (near heater)"],
    ["#d95f4a", "Exhaust (low, under bench)"],
    ["#a39581", "Drying vent (high)"],
  ];
  const wallOpts = [["front", "Door wall"], ["back", "Back"], ["left", "Left"], ["right", "Right"]];
  const sideLenUi = Math.max(0, zE[0] - lvZ0(0));
  const benchRun = (p.bLeft ? sideLenUi : 0) + (p.bRight ? sideLenUi : 0) + (p.bBack ? p.W : 0);
  const planZoomed = pz.z > 1.001 || Math.abs(pz.cx) > 1e-4 || Math.abs(pz.cy) > 1e-4;

  // measurements in the chosen units, as text lines: one, or with "both" a second, imperial line.
  // unitLines(m, name) for a single value; ut`floor ${uSgn(y)}` for a label with values in it —
  // uLen(m) a length, uSgn(m) a signed length, uDia(mm) a vent diameter
  const unitLines = (m, name = "") => (units === "both" ? [name + fmtMetric(m), fmtImperial(m)]
    : [name + (units === "imperial" ? fmtImperial(m) : fmtMetric(m))]);
  const uLen = (m) => ({ m: fmtMetric(m), i: fmtImperial(m) });
  const uSgn = (m) => { const sg = m < 0 ? "−" : "+", v = uLen(m); return { m: sg + v.m, i: sg + v.i }; };
  const uDia = (mm) => ({ m: `${Math.round(mm)} mm`, i: fmtImperial(mm / 1000) });
  const ut = (strs, ...vals) => {
    const val = (v, k) => (v && typeof v === "object" ? v[k] : v ?? "");
    const line = (k) => strs.reduce((acc, t, i) => acc + t + (i < vals.length ? val(vals[i], k) : ""), "");
    return units === "metric" ? [line("m")] : units === "imperial" ? [line("i")] : [line("m"), line("i")];
  };
  // inline, for the legend: 0.90 m · 2'-11 1/2" · 0.90 m (2'-11 1/2")
  const uInl = (m) => (units === "metric" ? fmtMetric(m) : units === "imperial" ? fmtImperial(m) : `${fmtMetric(m)} (${fmtImperial(m)})`);

  // vents in the 2D views' colours (the 3D view keeps its own), labelled in the chosen units
  const vents2D = ventSpecs.map((v, i) => {
    const rel = v.ref === "heater" ? v.y - heaterTop : v.ref === "floor" ? v.y : v.y - p.H;
    return { ...v, c: C.vents[i], label: ut`Ø${uDia(v.dmm)} · ${v.ref} ${uSgn(rel)}` };
  });

  // ----- shared 2D drawing helpers (floor plan + side view) -----
  // fit-to-view box: metric extent [x0..x1] × [y0..y1] plus fixed pixel margins for labels/dims
  const fitBase = (x0, x1, y0, y1, PL, PR, PT, PB) => {
    const ew = x1 - x0, eh = y1 - y0;
    const k = Math.max(5, Math.min((planSize.w - PL - PR) / ew, (planSize.h - PT - PB) / eh));
    const bW = ew + (PL + PR) / k, bH = eh + (PT + PB) / k;
    return { bW, bH, w: planSize.w, h: planSize.h, bcx: x0 - PL / k + bW / 2, bcy: y0 - PT / k + bH / 2 };
  };
  // pm: screen pixels → metres at the current zoom, so text and strokes keep their size
  const drawKit = (pm) => {
    const halo = (bg) => ({ stroke: bg, strokeWidth: pm(3), strokeLinejoin: "round", style: { paintOrder: "stroke" } });
    // dimension of length m (metres) with an optional name: the text sits above (horizontal) / left of
    // (vertical) the line; with both units, the imperial value goes on the other side of the line. Where that
    // is crowded, side −1 / +1 puts all of it above / left of or below / right of the line (stacked)
    const dim = (x1, y1, x2, y2, m, color, haloBg, key, at = 0.5, name = "", side = 0) => {
      const horiz = Math.abs(y2 - y1) < 1e-9;
      const d = pm(3.5);
      const mx = x1 + (x2 - x1) * at, my = y1 + (y2 - y1) * at; // label position along the line
      return (
        <g key={key}>
          <g stroke={color} strokeWidth={pm(1)}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} />
            <line x1={x1 - d} y1={y1 + d} x2={x1 + d} y2={y1 - d} />
            <line x1={x2 - d} y1={y2 + d} x2={x2 + d} y2={y2 - d} />
          </g>
          {unitLines(m, name).map((t, k, all) => {
            const off = !side ? (k ? pm(13) : -pm(5))
              : side < 0 ? (all.length < 2 || k ? -pm(5) : -pm(17)) : (k ? pm(25) : pm(13));
            const tx = horiz ? mx : mx + off, ty = horiz ? my + off : my;
            return (
              <text key={k} x={tx} y={ty} textAnchor="middle" fontSize={pm(k ? 10 : 11)} fontFamily={MONO} fill={color}
                transform={horiz ? undefined : `rotate(-90 ${tx} ${ty})`} {...halo(haloBg)}>
                {t}
              </text>
            );
          })}
        </g>
      );
    };
    // a label of one or two lines (the second, imperial one a size smaller); first baseline at y
    const textLines = (lines, x, y, props, key) => (
      <text key={key} x={x} y={y} {...props}>
        {lines.map((t, k) => (
          <tspan key={k} x={x} y={y + k * pm(12)} fontSize={k ? "90%" : undefined}>{t}</tspan>
        ))}
      </text>
    );
    // background grid: 10 cm, stronger every 50 cm and 1 m — in imperial 3", stronger every foot and 5 ft
    const imp = units === "imperial";
    const gridN = (extent) => Math.floor((imp ? extent / (3 * M_PER_IN) : extent * 10) - 1e-6);
    const gridAt = (i) => (imp ? i * 3 * M_PER_IN : i / 10);
    const gridCol = (i) => (imp ? (i % 20 === 0 ? C.grid10 : i % 4 === 0 ? C.grid5 : C.grid)
      : i % 10 === 0 ? C.grid10 : i % 5 === 0 ? C.grid5 : C.grid);
    return { halo, dim, textLines, gridN, gridAt, gridCol };
  };

  // ------------------------------------------------------------------
  // floor plan (2D): a true top-down view of the 3D model — room x → right,
  // door wall (room z = 0) at the bottom, back wall at the top; Y() maps room z to screen y
  // ------------------------------------------------------------------
  const renderPlan = () => {
    const W = p.W, D = p.D, T = 0.045; // wall thickness as in 3D
    const Y = (z) => D - z;
    const dX0 = clamp(p.doorX, 0.02, W - p.doorW - 0.02);
    // extent: the room, the outward door swing below the door wall, and the door-wall chain dimension below that.
    // The DOOR WALL label goes beside the wall in the wider wall segment when it fits there at the fit-to-view
    // scale (so it doesn't jump while zooming); otherwise it goes below the chain, which needs a bigger margin.
    const sideL = dX0, sideR = W - dX0 - p.doorW;
    const lblRight = sideR >= sideL;
    const two = units === "both"; // second (imperial) text lines below the dimension lines
    let base = fitBase(-T, W + T, -T, D + T + p.doorW, 72, 30, 72, two ? 48 : 40);
    const kFit = Math.min(base.w / base.bW, base.h / base.bH);
    const lblBeside = Math.max(sideL, sideR) * kFit >= 84; // label ≈ 70 px, plus room for the extension lines
    if (!lblBeside) base = fitBase(-T, W + T, -T, D + T + p.doorW, 72, 30, 72, two ? 68 : 56);
    planBaseRef.current = base;
    const vg = viewGeom(base, pz);
    const pm = (n) => n / vg.s;
    const { halo, dim, textLines, gridN, gridAt, gridCol } = drawKit(pm);

    // floor grid (10 cm, or 3" in imperial)
    const grid = [];
    for (let i = 1; i <= gridN(W); i++)
      grid.push(<line key={"gx" + i} x1={gridAt(i)} y1={0} x2={gridAt(i)} y2={D} stroke={gridCol(i)} strokeWidth={pm(1)} />);
    for (let i = 1; i <= gridN(D); i++)
      grid.push(<line key={"gz" + i} x1={0} y1={Y(gridAt(i))} x2={W} y2={Y(gridAt(i))} stroke={gridCol(i)} strokeWidth={pm(1)} />);

    // benches, lowest tier first so higher tiers cover the tucked-under edge — as seen from above
    const benches = [...planRects].sort((a, b) => b.tier - a.tier).map((r, idx) => {
      const side = r.wall !== "back";
      const depth = side ? r.x1 - r.x0 : r.z1 - r.z0;
      const board = 0.062, gap = 0.012;
      const n = Math.max(2, Math.floor((depth + gap) / (board + gap)));
      const start = (depth - (n * board + (n - 1) * gap)) / 2;
      const seams = [];
      for (let k = 1; k < n; k++) {
        const o = start + k * (board + gap) - gap / 2;
        seams.push(side
          ? <line key={k} x1={r.x0 + o} y1={Y(r.z1)} x2={r.x0 + o} y2={Y(r.z0)} />
          : <line key={k} x1={r.x0} y1={Y(r.z0 + o)} x2={r.x1} y2={Y(r.z0 + o)} />);
      }
      return (
        <g key={"b" + idx}>
          <rect x={r.x0} y={Y(r.z1)} width={Math.max(0, r.x1 - r.x0)} height={Math.max(0, r.z1 - r.z0)}
            fill={C.tiers[r.tier]} stroke={C.benchEdge} strokeWidth={pm(1)} />
          <g stroke={C.slat} strokeWidth={pm(1)}>{seams}</g>
        </g>
      );
    });

    const rails = railMarks.map((m, idx) => {
      const x0 = m.side === "left" ? 0 : W, dir = m.side === "left" ? 1 : -1;
      const bar = p.upD - 0.015, post = p.upD - 0.04;
      return (
        <g key={"r" + idx} fill={C.rail} stroke={C.benchEdge} strokeWidth={pm(1)}>
          <rect x={Math.min(x0, x0 + dir * bar)} y={Y(m.z) - 0.014} width={bar} height={0.028} />
          <rect x={x0 + dir * post - 0.0225} y={Y(m.z) - 0.0225} width={0.045} height={0.045} />
        </g>
      );
    });

    const sw = clamp(p.seatW, 0.4, 0.9);
    const seats = p.showSeatW ? people.map((q, idx) => {
      const w = q.along === "x" ? sw : p.upD, h = q.along === "x" ? p.upD : sw;
      return (
        <rect key={"s" + idx} x={q.sx - w / 2} y={Y(q.sz) - h / 2} width={w} height={h}
          fill={C.person} fillOpacity={0.08} stroke={C.slot} strokeOpacity={0.85}
          strokeWidth={pm(1)} strokeDasharray={`${pm(4)} ${pm(3)}`} />
      );
    }) : null;

    // seated figure seen from above: thighs forward, shoulders, head (local +y = facing).
    // 3D facing (sin ry, cos ry) in room x/z becomes (sin ry, −cos ry) on screen → rotate by ry + 180°
    const figures = p.showPeople ? people.map((q, idx) => (
      <g key={"p" + idx} transform={`translate(${q.x} ${Y(q.z)}) rotate(${((q.ry + Math.PI) * 180) / Math.PI})`}
        stroke={C.personDark} strokeWidth={pm(1)}>
        <rect x={-0.14} y={0} width={0.28} height={0.4} rx={0.06} fill={C.person} />
        <ellipse cx={0} cy={-0.02} rx={0.18} ry={0.1} fill={C.person} />
        <circle cx={0} cy={0.01} r={0.09} fill={C.head} />
      </g>
    )) : null;

    const ringCol = conflicts.length ? C.warn : C.ember;
    const heater = (
      <g clipPath="url(#plan-room-clip)">
        {p.showClear && !isSpirit && (
          <circle cx={hx} cy={Y(hz)} r={ringR} fill={ringCol} fillOpacity={0.1} stroke={ringCol}
            strokeWidth={pm(1.5)} strokeDasharray={`${pm(6)} ${pm(4)}`} />
        )}
        {p.showClear && isSpirit && (
          // everything within the clearance of the box: a rounded rectangle
          <rect x={hx - hbx - p.clearance} y={Y(hz + hbz + p.clearance)} width={2 * (hbx + p.clearance)} height={2 * (hbz + p.clearance)}
            rx={p.clearance} ry={p.clearance} fill={ringCol} fillOpacity={0.1} stroke={ringCol}
            strokeWidth={pm(1.5)} strokeDasharray={`${pm(6)} ${pm(4)}`} />
        )}
        {isSpirit ? (() => {
          // rounded outline seen from above: the front corners (facing into the room) are the rounder ones
          const { rF, rB, sr, bev } = hShape;
          const front = { front: ["tl", "tr"], back: ["bl", "br"], left: ["tr", "br"], right: ["tl", "bl"] }[p.heaterWall];
          const radii = (f, b) => Object.fromEntries(["tl", "tr", "br", "bl"].map((c) => [c, front.includes(c) ? f : b]));
          const x0 = hx - hbx, x1 = hx + hbx, y0 = Y(hz + hbz), y1 = Y(hz - hbz), m = sr * 0.6 + bev * 0.6; // stones inset
          return (
            <>
              <path d={roundedRectPath(x0, y0, x1, y1, radii(rF, rB))} fill={C.heaterFill} stroke={C.heaterEdge} strokeWidth={pm(1.5)} />
              <path d={roundedRectPath(x0 + m, y0 + m, x1 - m, y1 - m, radii(Math.max(0.002, rF - m), Math.max(0.002, rB - m)))} fill={C.heaterInner} />
            </>
          );
        })() : p.heater === "cilindro" ? (
          <>
            <circle cx={hx} cy={Y(hz)} r={heaterR} fill={C.cilFill} stroke={C.heaterEdge} strokeWidth={pm(1.5)} />
            <circle cx={hx} cy={Y(hz)} r={heaterR * 0.66} fill={C.heaterInner} />
          </>
        ) : (
          <ellipse cx={hx} cy={Y(hz)} rx={onSideWall ? 0.124 : 0.2} ry={onSideWall ? 0.2 : 0.124}
            fill={C.heaterFill} stroke={C.heaterEdge} strokeWidth={pm(1.5)} />
        )}
        <circle cx={hx} cy={Y(hz)} r={pm(3)} fill={C.ember} />
      </g>
    );

    const walls = (
      <g fill={C.wall}>
        <rect x={-T} y={-T} width={T} height={D + 2 * T} />
        <rect x={W} y={-T} width={T} height={D + 2 * T} />
        <rect x={0} y={-T} width={W} height={T} />
        <rect x={0} y={D} width={Math.max(0, dX0)} height={T} />
        <rect x={dX0 + p.doorW} y={D} width={Math.max(0, W - dX0 - p.doorW)} height={T} />
      </g>
    );

    // sauna doors open outward; hinge on the left jamb (handle is on the right in 3D)
    const door = (
      <g>
        <line x1={dX0} y1={D + T} x2={dX0} y2={D + T + p.doorW} stroke={C.wall} strokeWidth={pm(2.5)} />
        <path d={`M ${dX0 + p.doorW} ${D + T} A ${p.doorW} ${p.doorW} 0 0 1 ${dX0} ${D + T + p.doorW}`}
          fill="none" stroke={C.wall} strokeOpacity={0.55} strokeWidth={pm(1)} strokeDasharray={`${pm(4)} ${pm(3)}`} />
      </g>
    );

    // round vents at their true diameter, centred on the wall's inner face — no labels in the plan
    // (diameter and height are shown in the side view)
    const vents = p.showVents ? vents2D.map((v, idx) => {
      const cx = v.wall === "left" ? 0 : v.wall === "right" ? W : v.along;
      const cy = v.wall === "front" ? D : v.wall === "back" ? 0 : Y(v.along);
      const inside = <circle cx={cx} cy={cy} r={v.r} fill={v.c} stroke={C.ink} strokeWidth={pm(1)} />;
      if (idx !== 0) return <g key={"v" + idx}>{inside}</g>;
      // supply: the duct runs inside the wall (dashed, mid-wall) to the outside opening on the outer face
      const o = supplyOut;
      const at = (along, depth) => // a point along the wall, depth outward from the inner face
        v.wall === "front" ? [along, D + depth] : v.wall === "back" ? [along, -depth]
        : v.wall === "left" ? [-depth, Y(along)] : [W + depth, Y(along)];
      const [m0x, m0y] = at(v.along, T / 2), [m1x, m1y] = at(o.along, T / 2), [oxp, oyp] = at(o.along, T);
      return (
        <g key={"v" + idx}>
          <line x1={m0x} y1={m0y} x2={m1x} y2={m1y} stroke={v.c} strokeOpacity={0.85} strokeWidth={pm(1.5)}
            strokeDasharray={`${pm(4)} ${pm(3)}`} />
          <circle cx={oxp} cy={oyp} r={v.r} fill={v.c} fillOpacity={0.15} stroke={v.c} strokeWidth={pm(1.5)} />
          {inside}
          {/* airflow arrow, seen from above: only its along-the-wall part shows, so skip it when that's small */}
          {Math.abs(supplyFlow.a) > 0.3 && arrowGlyph(cx, cy, v.r,
            v.endWall ? (supplyFlow.a > 0 ? 0 : Math.PI) : (supplyFlow.a > 0 ? -Math.PI / 2 : Math.PI / 2), C.arrow)}
        </g>
      );
    }) : null;

    // temperature sensor: on the heater wall's inner face, no labels (a little larger than life so it reads)
    const sLen = Math.max(SENSOR.w, pm(9)), sDep = Math.max(SENSOR.d, pm(5));
    const sSide = p.heaterWall === "left" || p.heaterWall === "right";
    const sensorMark = (
      <rect
        x={p.heaterWall === "left" ? 0 : p.heaterWall === "right" ? W - sDep : sensorAlong - sLen / 2}
        y={p.heaterWall === "front" ? D - sDep : p.heaterWall === "back" ? 0 : Y(sensorAlong) - sLen / 2}
        width={sSide ? sDep : sLen} height={sSide ? sLen : sDep} rx={pm(1.5)}
        fill={C.sensor} stroke={C.ink} strokeWidth={pm(1)} />
    );

    // control panel: on its wall's inner face, dark with an ember rim, no labels
    const cpLen = Math.max(CP.w, pm(10)), cpDep = Math.max(CP.d, pm(5));
    const cpSide = p.cpWall === "left" || p.cpWall === "right";
    const cpMark = (
      <rect
        x={p.cpWall === "left" ? 0 : p.cpWall === "right" ? W - cpDep : cpAlong - cpLen / 2}
        y={p.cpWall === "front" ? D - cpDep : p.cpWall === "back" ? 0 : Y(cpAlong) - cpLen / 2}
        width={cpSide ? cpDep : cpLen} height={cpSide ? cpLen : cpDep} rx={pm(1.5)}
        fill={C.cp} stroke={C.ember} strokeWidth={pm(1.2)} />
    );

    // dimensions: overall (outside), free floor (green), heater centre to nearest walls (ember)
    const dims = [];
    const yW = -T - pm(40), xD = -T - pm(42); // overall width above the back wall, depth left of the left wall
    dims.push(
      <g key="ext" stroke={C.dim} strokeWidth={pm(1)}>
        <line x1={0} y1={-T - pm(4)} x2={0} y2={yW - pm(5)} />
        <line x1={W} y1={-T - pm(4)} x2={W} y2={yW - pm(5)} />
        <line x1={-T - pm(4)} y1={0} x2={xD - pm(5)} y2={0} />
        <line x1={-T - pm(4)} y1={D} x2={xD - pm(5)} y2={D} />
      </g>,
      dim(0, yW, W, yW, W, C.dim, C.bg, "dw"),
      dim(xD, 0, xD, D, D, C.dim, C.bg, "dd"),
    );
    // door wall: chain dimension below the door swing — left wall | door opening | right wall, between the
    // same inside faces as the overall width, so the three add up to it
    const yC = D + T + p.doorW + pm(24);
    // whole centimetres (quarter inches), the right segment taking the remainder, so the shown numbers always
    // sum to the shown width
    // (the total is rounded like the width's own label: 2.335 shows as 2.33, though 2.335 × 100 rounds to 234)
    const cmL = Math.round(dX0 * 100), cmD = Math.round(p.doorW * 100), cmR = Math.round(+toCm2(W) * 100) - cmL - cmD;
    const qL = quarterInches(dX0), qD = quarterInches(p.doorW), qR = quarterInches(W) - qL - qD;
    const chainSegs = [
      { x0: 0, x1: dX0, cm: cmL, q: qL, side: "left" },
      { x0: dX0, x1: dX0 + p.doorW, cm: cmD, q: qD, side: "door" },
      { x0: dX0 + p.doorW, x1: W, cm: cmR, q: qR, side: "right" },
    ];
    dims.push(
      <g key="chain">
        <g stroke={C.dim} strokeWidth={pm(1)}>
          {/* extension lines start just below the wall; on the hinge side, just below the door leaf */}
          <line x1={0} y1={D + T + pm(4)} x2={0} y2={yC + pm(5)} />
          <line x1={W} y1={D + T + pm(4)} x2={W} y2={yC + pm(5)} />
          <line x1={dX0} y1={D + T + p.doorW + pm(4)} x2={dX0} y2={yC + pm(5)} />
          <line x1={dX0 + p.doorW} y1={D + T + pm(4)} x2={dX0 + p.doorW} y2={yC + pm(5)} />
          <line x1={0} y1={yC} x2={W} y2={yC} />
          {[0, dX0, dX0 + p.doorW, W].map((x, i) => (
            <line key={i} x1={x - pm(3.5)} y1={yC + pm(3.5)} x2={x + pm(3.5)} y2={yC - pm(3.5)} />
          ))}
        </g>
        {chainSegs.map((s) => {
          const met = `${(s.cm / 100).toFixed(2)} m`, imp = fmtQuarter(Math.max(0, s.q));
          const lines = two ? [met, imp] : [units === "imperial" ? imp : met];
          // a wall segment too short for its number gets the number just outside the end of the chain
          const fits = s.side === "door" || Math.max(...lines.map((t) => t.length)) * pm(6.7) + pm(8) <= s.x1 - s.x0;
          const tx = fits ? (s.x0 + s.x1) / 2 : s.side === "left" ? -pm(5) : W + pm(5);
          const anchor = fits ? "middle" : s.side === "left" ? "end" : "start";
          // above the chain; the imperial line (both) below it
          return lines.map((t, k) => (
            <text key={s.side + k} x={tx} y={k ? yC + pm(13) : yC - pm(5)} textAnchor={anchor} fontSize={pm(k ? 10 : 11)} fontFamily={MONO}
              fill={C.dim} {...halo(C.bg)}>
              {t}
            </text>
          ));
        })}
      </g>
    );
    // heater centre to the nearest walls (a wall-hung heater's own mounting wall is skipped)
    const hxWall = hx <= W / 2 ? 0 : W, hzWall = hz <= D / 2 ? 0 : D;
    const skipWall = p.heater === "drop" || isSpirit ? p.heaterWall : null; // wall-hung: own wall is trivial
    const hxWallName = hxWall === 0 ? "left" : "right", hzWallName = hzWall === 0 ? "front" : "back";
    const hxOn = Math.abs(hx - hxWall) > 0.02 && skipWall !== hxWallName;
    const hzOn = Math.abs(hz - hzWall) > 0.02 && skipWall !== hzWallName;
    // free floor across the room: bench front → heater on each side with a bench level with it, else the aisle
    const across = heaterGaps.length ? heaterGaps : aisle ? [aisle] : [];
    const acrossSpans = []; // x-range covered by each line or its number, for the free-depth label to avoid
    across.forEach((g, i) => {
      const L = g.x1 - g.x0;
      // sharing its stretch with the heater-to-wall dimension, its number goes on the other side of the line
      const shared = heaterGaps.length && hxOn && g.x1 > Math.min(hx, hxWall) + 1e-6 && g.x0 < Math.max(hx, hxWall) - 1e-6;
      const side = !shared ? 0 : two ? (hzWall === 0 ? 1 : -1) : 1;
      // a bench → heater number stays off the heater and the heater's own dimension beside its centre: centred,
      // or shifted toward the bench when the gap is too short for it
      const textLen = pm(Math.max(...unitLines(L, "free ").map((t) => t.length)) * 6.7);
      const mid = (g.x0 + g.x1) / 2;
      let c = mid; // label centre
      if (heaterGaps.length) {
        const heaterAtEnd = g.x1 <= hx; // the left-hand gap: the heater is at its far end
        const stop = heaterAtEnd ? Math.min(g.x1, hx - pm(28)) - pm(2) : Math.max(g.x0, hx + pm(28)) + pm(2);
        c = heaterAtEnd ? Math.min(mid, stop - textLen / 2) : Math.max(mid, stop + textLen / 2);
      }
      acrossSpans.push([g.z, Math.min(g.x0, c - textLen / 2), Math.max(g.x1, c + textLen / 2)]);
      dims.push(dim(g.x0, Y(g.z), g.x1, Y(g.z), L, C.free, C.floor, "fa" + i, (c - g.x0) / L, "free ", side));
    });
    if (depthFree) {
      // runs from the back benches' front (top) down to the door wall. Its label stays mid-line unless that
      // meets the label of a line crossing it — the free floor across, the heater-to-side-wall one; then it goes
      // to the middle of the longest stretch clear of them (z: distance from the door wall)
      const z1 = depthFree.z1;
      const half = pm(Math.max(...unitLines(z1, "free ").map((t) => t.length)) * 3.35 + 2);
      const bands = []; // [z, half-height of the crossing line's label]
      acrossSpans.filter(([, a, b]) => depthFree.x > a - pm(14) && depthFree.x < b + pm(14)).forEach(([z]) => bands.push([z, pm(two ? 30 : 16)]));
      if (hxOn && depthFree.x > Math.min(hx, hxWall) && depthFree.x < Math.max(hx, hxWall)) bands.push([hz, pm(two ? 30 : 16)]);
      let c = z1 / 2;
      if (!bands.every(([z, b]) => Math.abs(c - z) >= half + b)) {
        const cuts = bands.map(([z, b]) => [z - b, z + b]).sort((u, v) => u[0] - v[0]);
        const free = [];
        let from = 0;
        for (const [u, v] of cuts) { if (u > from) free.push([from, u]); from = Math.max(from, v); }
        if (z1 > from) free.push([from, z1]);
        const fits = free.filter(([u, v]) => v - u >= 2 * half);
        if (fits.length) { const [u, v] = fits.reduce((m, f) => (f[1] - f[0] > m[1] - m[0] ? f : m)); c = (u + v) / 2; }
      }
      dims.push(dim(depthFree.x, Y(z1), depthFree.x, D, z1, C.free, C.floor, "fd", 1 - c / z1, "free "));
    }
    // the heater's numbers sit mid-line, or — when that would put them over the heater — just clear of its
    // edge, as far as the line allows: at = position along the line from its start
    const freeAt = (L, half, heaterAtStart) => {
      const textLen = pm(Math.max(...unitLines(L).map((t) => t.length)) * 6.7 + 4);
      const want = Math.max(L / 2, half + textLen / 2 + pm(2)), cap = L - textLen / 2 - pm(2);
      const u = Math.max(L / 2, Math.min(want, cap)); // label centre, from the heater centre
      return heaterAtStart ? u / L : 1 - u / L;
    };
    // with both units each stacks its two lines on the side away from the other dimension
    if (hxOn)
      dims.push(dim(Math.min(hx, hxWall), Y(hz), Math.max(hx, hxWall), Y(hz), Math.abs(hx - hxWall), C.ember, C.floor, "hx",
        freeAt(Math.abs(hx - hxWall), hPlanX, hxWall > hx), "", two ? (hzWall === 0 ? -1 : 1) : 0));
    if (hzOn)
      dims.push(dim(hx, Math.min(Y(hz), Y(hzWall)), hx, Math.max(Y(hz), Y(hzWall)), Math.abs(hz - hzWall), C.ember, C.floor, "hz",
        freeAt(Math.abs(hz - hzWall), hPlanZ, hzWall === 0), "", two ? (hxWall > hx ? -1 : 1) : 0));

    // wall names; DOOR WALL sits just below the wall in the wider wall segment (clear of the extension
    // lines), or centred below the chain when neither segment has room
    const lbl = { fontSize: pm(10), fontFamily: "system-ui, sans-serif", fill: C.text, letterSpacing: pm(1.2) };
    const labels = (
      <g>
        {lblBeside
          ? <text x={lblRight ? W - pm(6) : pm(6)} y={D + T + pm(14)} textAnchor={lblRight ? "end" : "start"} {...lbl}>DOOR WALL</text>
          : <text x={W / 2} y={yC + pm(two ? 32 : 20)} textAnchor="middle" {...lbl}>DOOR WALL</text>}
        <text x={W / 2} y={-T - pm(6)} textAnchor="middle" {...lbl}>BACK WALL</text>
        <text x={-T - pm(6)} y={D / 2} textAnchor="middle" transform={`rotate(-90 ${-T - pm(6)} ${D / 2})`} {...lbl}>LEFT WALL</text>
        <text x={W + T + pm(6)} y={D / 2} textAnchor="middle" transform={`rotate(90 ${W + T + pm(6)} ${D / 2})`} {...lbl}>RIGHT WALL</text>
      </g>
    );

    return (
      <svg width="100%" height="100%" viewBox={`${vg.minX} ${vg.minY} ${vg.vw} ${vg.vh}`}
        preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
        {/* keep-out zones are drawn inside the room only (a wall-hung heater's zone would poke through its wall) */}
        <defs><clipPath id="plan-room-clip"><rect x={0} y={0} width={W} height={D} /></clipPath></defs>
        <rect x={0} y={0} width={W} height={D} fill={C.floor} />
        {grid}
        {benches}
        {rails}
        {seats}
        {figures}
        {heater}
        {/* safety railing (rounded band): lighter than its real black so it reads against the dark floor */}
        {railOn && (
          <path fill={C.railPlan} stroke={C.railPlanEdge} strokeWidth={pm(1)} strokeLinejoin="round"
            d={railContour(railW, railD, railR, RAIL.t).map(([a, dd], i) => {
              const [x, z] = wallXZ(hAlong + a, dd);
              return `${i ? "L" : "M"} ${x} ${Y(z)}`;
            }).join(" ") + " Z"} />
        )}
        {walls}
        {vents}
        {sensorMark}
        {cpMark}
        {door}
        {dims}
        {labels}
      </svg>
    );
  };

  // ------------------------------------------------------------------
  // side view (2D section): standing at the left wall, looking toward the right wall.
  // Back wall on the left, door wall on the right, heights upward from the floor.
  // screen x = D − z (room z measured from the door wall), screen y = H − height
  // ------------------------------------------------------------------
  const renderSide = () => {
    const D = p.D, H = p.H, T = 0.045, FL = 0.04; // wall / floor thickness
    const X = (z) => D - z, Yh = (y) => H - y;
    // margins: top for the wall title; left for the bench-level + ceiling heights, right for the headroom +
    // heater heights — sized to their widest text in the chosen units; bottom for the overall depth
    const levelOn = (i) => lvOn(i, "left") || lvOn(i, "back") || lvOn(i, "right");
    const widest = (vals) => Math.max(...vals.flatMap((v) => unitLines(v)).map((t) => t.length));
    const ordVals = LEVELS.map((L, i) => (levelOn(i) ? lvH(i) : null)).filter((v) => v !== null).concat([H]);
    const hsVals = [heaterTop].concat(isSpirit ? [heaterBottom] : []);
    const base = fitBase(-T, D + T, -T, H + FL, 38 + widest(ordVals) * 6.7, 65 + widest(hsVals) * 6.7, 30, units === "both" ? 68 : 56);
    planBaseRef.current = base;
    const vg = viewGeom(base, pz);
    const pm = (n) => n / vg.s;
    const { halo, dim, textLines, gridN, gridAt, gridCol } = drawKit(pm);
    const lbl = { fontSize: pm(10), fontFamily: "system-ui, sans-serif", fill: C.text, letterSpacing: pm(1.2) };

    // grid on the far (right) wall (10 cm, or 3" in imperial): lengths from the door wall, heights from the floor
    const grid = [];
    for (let i = 1; i <= gridN(D); i++)
      grid.push(<line key={"gz" + i} x1={X(gridAt(i))} y1={0} x2={X(gridAt(i))} y2={H} stroke={gridCol(i)} strokeWidth={pm(1)} />);
    for (let i = 1; i <= gridN(H); i++)
      grid.push(<line key={"gy" + i} x1={0} y1={Yh(gridAt(i))} x2={D} y2={Yh(gridAt(i))} stroke={gridCol(i)} strokeWidth={pm(1)} />);

    // benches are seat planks only (no legs or front boards), as in 3D.
    // side-wall bench seen along its length: the edge of the 4 cm plank layer
    const longBench = (r, key, far) => {
      const h = lvH(r.tier), xa = X(r.z1), len = Math.max(0, r.z1 - r.z0);
      return (
        <rect key={key} x={xa} y={Yh(h)} width={len} height={0.04}
          fill={C.tiers[r.tier]} fillOpacity={far ? 0.5 : 1} stroke={C.benchEdge} strokeWidth={pm(1)} />
      );
    };
    // back-wall bench in cross-section: the plank ends
    const benchProfile = (r, key) => {
      const h = lvH(r.tier), xa = X(r.z1), xb = X(r.z0), depth = xb - xa;
      const board = 0.062, gap = 0.012;
      const n = Math.max(2, Math.floor((depth + gap) / (board + gap)));
      const start = (depth - (n * board + (n - 1) * gap)) / 2;
      return (
        <g key={key} fill={C.tiers[r.tier]} stroke={C.benchEdge} strokeWidth={pm(1)}>
          {Array.from({ length: n }, (_, k) => (
            <rect key={k} x={xa + start + k * (board + gap)} y={Yh(h)} width={board} height={0.04} />
          ))}
        </g>
      );
    };
    // far (right-wall) tiers are drawn farthest-first, near (left-wall) tiers nearest-last
    const wallTiers = (wall, order) => planRects.filter((r) => r.wall === wall && r.z1 > r.z0).sort((a, b) => order * (a.tier - b.tier));
    const farBenches = wallTiers("right", 1).map((r, i) => longBench(r, "fb" + i, true));
    const nearBenches = wallTiers("left", -1).map((r, i) => longBench(r, "nb" + i, false));
    const backProfiles = planRects.filter((r) => r.wall === "back").map((r, i) => benchProfile(r, "bp" + i));

    const railPosts = (side, far) => railMarks.filter((m) => m.side === side).map((m, i) => (
      <rect key={side + i} x={X(m.z) - 0.0225} y={Yh(p.upH + 0.45)} width={0.045} height={p.upH + 0.45}
        fill={C.rail} fillOpacity={far ? 0.6 : 1} stroke={C.benchEdge} strokeWidth={pm(1)} />
    ));

    // seated figures: side-bench sitters face-on, back-bench sitters in profile facing the door
    const ys = p.upH, shinH = Math.min(0.5, ys + 0.04);
    const frontal = (xc, key, far) => (
      <g key={key} fill={C.person} fillOpacity={far ? 0.45 : 0.8} stroke={C.personDark} strokeWidth={pm(1)}>
        <rect x={xc - 0.17} y={Yh(ys + 0.56)} width={0.34} height={0.56} rx={0.06} />
        <circle cx={xc} cy={Yh(ys + 0.67)} r={0.1} fill={C.head} />
      </g>
    );
    const sideSitters = (left) => people.filter((q) => q.along === "z" && (left ? q.x < p.W / 2 : q.x > p.W / 2));
    const farPeople = p.showPeople ? sideSitters(false).map((q, i) => frontal(X(q.z), "fp" + i, true)) : null;
    const nearPeople = p.showPeople ? sideSitters(true).map((q, i) => frontal(X(q.z), "np" + i, false)) : null;
    const backRow = people.find((q) => q.along === "x");
    const backSitter = p.showPeople && backRow ? (() => {
      const hip = X(backRow.z); // one profile stands for the whole row
      return (
        <g key="pf" fill={C.person} stroke={C.personDark} strokeWidth={pm(1)}>
          <rect x={hip + 0.28} y={Yh(ys + 0.06)} width={0.12} height={shinH} rx={0.03} />
          <rect x={hip - 0.07} y={Yh(ys + 0.13)} width={0.44} height={0.13} rx={0.04} />
          <rect x={hip - 0.12} y={Yh(ys + 0.56)} width={0.2} height={0.56} rx={0.05} />
          <circle cx={hip} cy={Yh(ys + 0.67)} r={0.1} fill={C.head} />
        </g>
      );
    })() : null;

    const sw = clamp(p.seatW, 0.4, 0.9);
    const slotStyle = {
      fill: C.person, fillOpacity: 0.07, stroke: C.slot, strokeOpacity: 0.85,
      strokeWidth: pm(1), strokeDasharray: `${pm(4)} ${pm(3)}`,
    };
    const slots = p.showSeatW ? [
      ...people.filter((q) => q.along === "z").map((q, i) => (
        <rect key={"ss" + i} x={X(q.sz) - sw / 2} y={Yh(ys + 1)} width={sw} height={1} {...slotStyle} />
      )),
      ...(backRow ? [<rect key="sb" x={0} y={Yh(ys + 1)} width={p.upD} height={1} {...slotStyle} />] : []),
    ] : null;

    // heater + clearance volume (a cylinder in 3D → a rectangle from the side)
    const xh = X(hz);
    const ringCol = conflicts.length ? C.warn : C.ember;
    const stones = (yTop, half) => [-0.55, -0.18, 0.18, 0.55].map((f, k) => (
      <circle key={"st" + k} cx={xh + f * half * 1.6} cy={Yh(yTop + 0.03)} r={0.035}
        fill={C.stone} stroke={C.personDark} strokeWidth={pm(1)} />
    ));
    const dropTop = onSideWall ? 0.2 : 0.124, dropBot = onSideWall ? 0.16 : 0.099; // half-widths along the view
    // keep-out seen from the side: round heaters → 1.15 m tall as in 3D; box heater → from its bottom up to
    // its ceiling distance. Clipped to the room sideways (a wall-hung zone otherwise pokes through its own wall)
    const koHalf = isSpirit ? hbz + p.clearance : ringR;
    const koBottom = isSpirit ? heaterBottom : 0, koTop = isSpirit ? heaterTop + p.ceilClear : 1.15;
    // safety railing seen from the side: a band at the heater's top spanning the bars' extent along the view
    const railBand = railOn ? (() => {
      const z0 = railFoot.z0, z1 = railFoot.z1;
      return (
        <rect x={X(z1)} y={Yh(heaterTop)} width={z1 - z0} height={RAIL.h}
          fill={C.railSide} stroke={C.dim} strokeWidth={pm(1)} />
      );
    })() : null;
    // on the left wall the heater is nearest you and hides the railing's front bar; elsewhere the railing is in front
    const railBehind = p.heaterWall === "left";
    const heaterEl = (
      <g key="heater">
        {railBehind && railBand}
        {p.showClear && (
          <rect x={Math.max(0, xh - koHalf)} y={Yh(koTop)} width={Math.max(0, Math.min(D, xh + koHalf) - Math.max(0, xh - koHalf))}
            height={koTop - koBottom} fill={ringCol} fillOpacity={0.09}
            stroke={ringCol} strokeWidth={pm(1.5)} strokeDasharray={`${pm(6)} ${pm(4)}`} />
        )}
        {isSpirit ? (() => {
          // seen from the side or the front: rounded top and bottom edges, with the stones on top reaching
          // exactly the heater's top
          const { bev, sr, bodyTop } = hShape;
          const n = Math.max(2, Math.floor((2 * hbz - 2 * bev) / (sr * 2.1)));
          const span = (n - 1) * sr * 2.1;
          return (
            <>
              {Array.from({ length: n }, (_, k) => (
                <circle key={"st" + k} cx={xh - span / 2 + k * sr * 2.1} cy={Yh(heaterTop - sr)} r={sr}
                  fill={C.stone} stroke={C.personDark} strokeWidth={pm(1)} />
              ))}
              <rect x={xh - hbz} y={Yh(bodyTop)} width={2 * hbz} height={bodyTop - heaterBottom} rx={bev} ry={bev}
                fill={C.heaterFill} stroke={C.heaterEdge} strokeWidth={pm(1.5)} />
            </>
          );
        })() : p.heater === "cilindro" ? (
          <>
            <rect x={xh - 0.13} y={Yh(0.04)} width={0.26} height={0.04} fill={C.cilBase} />
            <rect x={xh - heaterR} y={Yh(0.97)} width={2 * heaterR} height={0.93} fill={C.cilFill} stroke={C.heaterEdge} strokeWidth={pm(1.5)} />
            {stones(0.97, heaterR)}
          </>
        ) : (
          <>
            <polygon points={`${xh - dropBot},${Yh(0.26)} ${xh + dropBot},${Yh(0.26)} ${xh + dropTop},${Yh(0.96)} ${xh - dropTop},${Yh(0.96)}`}
              fill={C.heaterFill} stroke={C.heaterEdge} strokeWidth={pm(1.5)} />
            {stones(0.96, dropTop)}
          </>
        )}
        {!railBehind && railBand}
      </g>
    );

    // cut walls (back, door), ceiling and floor
    const walls = (
      <g fill={C.wall}>
        <rect x={-T} y={-T} width={T} height={H + T + FL} />
        <rect x={D} y={-T} width={T} height={H + T + FL} />
        <rect x={0} y={-T} width={D} height={T} />
        <rect x={0} y={H} width={D} height={FL} />
      </g>
    );

    // round vents: right wall face-on, left wall (behind the viewer) dashed, back/door walls on the wall face.
    // A dashed leader runs from each vent to its reference: heater top (supply), floor (exhaust), ceiling (drying).
    const heaterHalfView = isSpirit ? hbz : p.heater === "cilindro" ? heaterR : dropTop;
    // labels beside wall items (vents, sensor) are collected first, then nudged apart where they would overlap
    const wallLabels = [];
    const labW = (lines) => Math.max(...lines.map((t) => t.length)) * pm(6.1);
    const addLabel = (key, x, y, anchor, lines, color) =>
      wallLabels.push({ key, x, y, anchor, lines, color, w: labW(lines), h: lines.length * pm(12) });
    // which side of an item (centre x, half-width r) its label goes: right on the back wall, left on the door
    // wall; on a face-on wall right when it fits there, else left — or the roomier side when neither fits
    const sideOf = (wall, x, r, lines) => {
      if (wall === "back") return true;
      if (wall === "front") return false;
      const w = labW(lines) + pm(4);
      const fitsR = x + r + w < D, fitsL = x - r - w > 0;
      return fitsR || (!fitsL && D - x > x);
    };
    const vents = p.showVents ? vents2D.map((v, idx) => {
      const { r } = v;
      const near = v.wall === "left";
      const xc = v.endWall ? (v.wall === "back" ? 0 : D) : X(v.along), yc = Yh(v.y);
      const refY = v.ref === "heater" ? Yh(heaterTop) : v.ref === "floor" ? Yh(0) : Yh(H);
      const leadFrom = refY > yc ? yc + r : yc - r; // circle edge facing the reference
      const leaderOn = Math.abs(refY - yc) > r + 0.005;
      const lead = { stroke: v.c, strokeOpacity: 0.75, strokeWidth: pm(1), strokeDasharray: `${pm(3)} ${pm(3)}` };
      // supply: carry the heater-top level over to the vent when it isn't right above the heater
      const apart = Math.abs(xc - xh) > heaterHalfView;
      const levelFromX = xc < xh ? xh - heaterHalfView : xh + heaterHalfView;
      const toRight = sideOf(v.wall, xc, r, v.label);
      const tx = toRight ? xc + r + pm(4) : xc - r - pm(4);
      addLabel("vl" + idx, tx, yc + pm(3.5), toRight ? "start" : "end", v.label, v.c);
      // supply: airflow arrow inside the opening (away from the sensor), as seen from here — screen x = D − z,
      // screen y points down. A vent on the back / door wall runs across the view, so only its up/down part
      // shows; skip the arrow when what shows is small
      let flowArrow = null;
      if (idx === 0) {
        const sxF = v.endWall ? 0 : -supplyFlow.a, syF = -supplyFlow.u;
        if (Math.hypot(sxF, syF) > 0.3) flowArrow = arrowGlyph(xc, yc, r, Math.atan2(syF, sxF), near ? v.c : C.arrow);
      }
      // supply: the duct (translucent band, solid centre line) runs inside the wall in a soft S down to the
      // outside opening (ringed), which has its own dashed leader to the floor, its reference
      let duct = null;
      if (idx === 0) {
        const o = supplyOut;
        const xo = v.endWall ? (v.wall === "back" ? -T : D + T) : X(o.along), yo = Yh(o.y);
        const kS = (yo - yc) / 2; // vertical tangents at both openings
        const path = `M ${xc} ${yc} C ${xc} ${yc + kS}, ${xo} ${yo - kS}, ${xo} ${yo}`;
        const oLines = ut`outside · floor ${uSgn(o.y)}`;
        const oRight = sideOf(v.wall, xo, r, oLines);
        addLabel("vo", oRight ? xo + r + pm(4) : xo - r - pm(4), yo + pm(3.5), oRight ? "start" : "end", oLines, v.c);
        duct = (
          <g>
            <path d={path} fill="none" stroke={v.c} strokeOpacity={0.2} strokeWidth={v.d} strokeLinecap="round" />
            <path d={path} fill="none" stroke={v.c} strokeOpacity={0.6} strokeWidth={pm(1)} />
            {yo + r < Yh(0) - 0.005 && (
              <g>
                <line x1={xo} y1={yo + r} x2={xo} y2={Yh(0)} {...lead} />
                <line x1={xo - pm(5)} y1={Yh(0)} x2={xo + pm(5)} y2={Yh(0)} stroke={v.c} strokeWidth={pm(1.5)} />
              </g>
            )}
            <circle cx={xo} cy={yo} r={r} fill={v.c} fillOpacity={0.15} stroke={v.c} strokeWidth={pm(1.5)} />
          </g>
        );
      }
      return (
        <g key={"v" + idx}>
          {duct}
          {leaderOn && (
            <g>
              <line x1={xc} y1={leadFrom} x2={xc} y2={refY} {...lead} />
              <line x1={xc - pm(5)} y1={refY} x2={xc + pm(5)} y2={refY} stroke={v.c} strokeWidth={pm(1.5)} />
            </g>
          )}
          {v.ref === "heater" && apart && <line x1={levelFromX} y1={refY} x2={xc} y2={refY} {...lead} />}
          <circle cx={xc} cy={yc} r={r} fill={v.c} fillOpacity={near ? 0.15 : 1}
            stroke={near ? v.c : C.ink} strokeWidth={pm(near ? 1.5 : 1)}
            strokeDasharray={near ? `${pm(3)} ${pm(2)}` : undefined} />
          {flowArrow}
        </g>
      );
    }) : null;

    // temperature sensor on the heater's wall: face-on (right wall), behind you (left wall, dashed) or edge-on
    // (back / door wall). Dashed leaders show both of its references: up to the ceiling, and across to the
    // heater's centre line (when that wall is seen face-on)
    const sensorEl = (() => {
      const edge = p.heaterWall === "front" || p.heaterWall === "back";
      const behind = p.heaterWall === "left";
      const sw2 = Math.max(edge ? SENSOR.d : SENSOR.w, pm(edge ? 4 : 8)), sh2 = Math.max(SENSOR.h, pm(10));
      const sx = edge ? (p.heaterWall === "back" ? sw2 / 2 : D - sw2 / 2) : X(sensorAlong), sy = Yh(sensorY);
      const lead = { stroke: C.sensorInk, strokeOpacity: 0.7, strokeWidth: pm(1), strokeDasharray: `${pm(3)} ${pm(3)}` };
      const off = Math.abs(sensorAlong - hAlong);
      const across = !edge && off > 0.01; // the sideways offset is visible
      const lines = edge ? ut`sensor · ceiling ${uSgn(sensorY - H)} · ${uLen(off)} from heater centre`
        : ut`sensor · ceiling ${uSgn(sensorY - H)}`;
      // label on the side away from the heater's centre line, flipped if it would leave the room
      const w = labW(lines);
      let toRight = edge ? p.heaterWall === "back" : sx >= xh;
      if (!edge && toRight && sx + sw2 / 2 + pm(4) + w > D) toRight = false;
      else if (!edge && !toRight && sx - sw2 / 2 - pm(4) - w < 0) toRight = true;
      addLabel("sl", toRight ? sx + sw2 / 2 + pm(4) : sx - sw2 / 2 - pm(4), sy + pm(3.5), toRight ? "start" : "end", lines, C.sensorInk);
      const nearX = sx < xh ? sx + sw2 / 2 : sx - sw2 / 2; // sensor edge facing the heater's centre line
      return (
        <g key="sensor">
          {sy - sh2 / 2 > 0.005 && (
            <g>
              <line x1={sx} y1={sy - sh2 / 2} x2={sx} y2={0} {...lead} />
              <line x1={sx - pm(5)} y1={0} x2={sx + pm(5)} y2={0} stroke={C.sensorInk} strokeWidth={pm(1.5)} />
            </g>
          )}
          {across && (
            <g>
              <line x1={xh} y1={Yh(heaterTop)} x2={xh} y2={sy} {...lead} />
              <line x1={xh} y1={sy} x2={nearX} y2={sy} {...lead} />
              {/* above its leader (the strip up to the ceiling is otherwise free); below it if too close to the ceiling */}
              {(() => {
                const ol = unitLines(off), extra = pm(12) * (ol.length - 1), up = sy - pm(11) - extra > 0;
                return textLines(ol, (xh + nearX) / 2, up ? sy - pm(3) - extra : sy + pm(11),
                  { textAnchor: "middle", fontSize: pm(10), fontFamily: MONO, fill: C.sensorInk, ...halo(C.floor) });
              })()}
            </g>
          )}
          <rect x={sx - sw2 / 2} y={sy - sh2 / 2} width={sw2} height={sh2} rx={pm(1.5)}
            fill={C.sensor} fillOpacity={behind ? 0.15 : 1} stroke={behind ? C.sensorInk : C.ink}
            strokeWidth={pm(behind ? 1.5 : 1)} strokeDasharray={behind ? `${pm(3)} ${pm(2)}` : undefined} />
        </g>
      );
    })();

    // control panel: face-on (right wall) with its display, behind you (left wall, dashed) or edge-on
    // (back / door wall); a dashed leader runs down to the floor, its height reference
    const cpEl = (() => {
      const edge = cpEndWall, behind = p.cpWall === "left";
      const w2 = Math.max(edge ? CP.d : CP.w, pm(edge ? 4 : 9)), h2 = Math.max(CP.h, pm(12));
      const cx = edge ? (p.cpWall === "back" ? w2 / 2 : D - w2 / 2) : X(cpAlong), cy = Yh(cpY);
      const cpLines = ut`control panel · floor ${uSgn(cpY)}`;
      const toRight = sideOf(p.cpWall, cx, w2 / 2, cpLines);
      addLabel("cp", toRight ? cx + w2 / 2 + pm(4) : cx - w2 / 2 - pm(4), cy + pm(3.5), toRight ? "start" : "end", cpLines, C.ember);
      return (
        <g key="cp">
          <line x1={cx} y1={cy + h2 / 2} x2={cx} y2={Yh(0)} stroke={C.ember} strokeOpacity={0.7} strokeWidth={pm(1)}
            strokeDasharray={`${pm(3)} ${pm(3)}`} />
          <line x1={cx - pm(5)} y1={Yh(0)} x2={cx + pm(5)} y2={Yh(0)} stroke={C.ember} strokeWidth={pm(1.5)} />
          <rect x={cx - w2 / 2} y={cy - h2 / 2} width={w2} height={h2} rx={pm(1.5)}
            fill={C.cp} fillOpacity={behind ? 0.25 : 1} stroke={C.ember} strokeWidth={pm(behind ? 1.5 : 1.2)}
            strokeDasharray={behind ? `${pm(3)} ${pm(2)}` : undefined} />
          {!edge && !behind && (
            <rect x={cx - w2 * 0.35} y={cy - h2 * 0.34} width={w2 * 0.7} height={h2 * 0.32} fill={C.ember} />
          )}
        </g>
      );
    })();

    // nudge overlapping labels apart, top to bottom
    const span = (l) => (l.anchor === "start" ? [l.x, l.x + l.w] : [l.x - l.w, l.x]);
    wallLabels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < wallLabels.length; i++) {
      for (let j = 0; j < i; j++) {
        const [a0, a1] = span(wallLabels[i]), [b0, b1] = span(wallLabels[j]);
        if (a0 < b1 + pm(4) && b0 < a1 + pm(4) && wallLabels[i].y < wallLabels[j].y + wallLabels[j].h) wallLabels[i].y = wallLabels[j].y + wallLabels[j].h;
      }
    }
    const wallLabelEls = wallLabels.map((l) => textLines(l.lines, l.x, l.y,
      { textAnchor: l.anchor, fontSize: pm(10), fontFamily: MONO, fill: l.color, ...halo(C.floor) }, l.key));

    // height scale on the left: each bench level + the ceiling (labels nudged apart when levels are close)
    const levels = LEVELS.map((L, i) => (levelOn(i) ? { y: lvH(i), c: C.tierInk[i], t: unitLines(lvH(i)) } : null))
      .filter(Boolean).concat([{ y: H, c: C.dim, t: unitLines(H) }]);
    const xO = -T - pm(16);
    const gapL = pm(units === "both" ? 25 : 13); // label spacing: one or two lines
    const lab = levels.map((l) => ({ ...l, ly: Yh(l.y) })).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < lab.length; i++) if (lab[i].ly < lab[i - 1].ly + gapL) lab[i].ly = lab[i - 1].ly + gapL;
    const midY = (l) => l.ly + pm(3.5) - pm(6) * (l.t.length - 1); // first baseline, the lines centred on ly
    const ordinates = (
      <g key="ord">
        <g stroke={C.dim} strokeWidth={pm(1)}>
          <line x1={xO} y1={Yh(0)} x2={xO} y2={Yh(H)} />
          <line x1={xO - pm(4)} y1={Yh(0)} x2={xO + pm(4)} y2={Yh(0)} />
          {lab.map((l, i) => (
            <g key={i}>
              <line x1={-T - pm(3)} y1={Yh(l.y)} x2={xO - pm(4)} y2={Yh(l.y)} />
              <line x1={xO - pm(4)} y1={Yh(l.y)} x2={xO - pm(8)} y2={l.ly} />
            </g>
          ))}
        </g>
        {lab.map((l, i) => textLines(l.t, xO - pm(10), midY(l),
          { textAnchor: "end", fontSize: pm(11), fontFamily: MONO, fill: l.c, ...halo(C.bg) }, "t" + i))}
      </g>
    );

    // headroom above the upper bench, on the right outside the door wall
    const xR = D + T + pm(24);
    const headroom = p.bLeft || p.bBack || p.bRight ? (
      <g key="hr">
        <g stroke={C.free} strokeWidth={pm(1)} strokeOpacity={0.7}>
          <line x1={D + T + pm(3)} y1={Yh(p.upH)} x2={xR + pm(4)} y2={Yh(p.upH)} />
          <line x1={D + T + pm(3)} y1={Yh(H)} x2={xR + pm(4)} y2={Yh(H)} />
        </g>
        {dim(xR, Yh(H), xR, Yh(p.upH), H - p.upH, C.free, C.bg, "hrd", 0.5, "headroom ")}
      </g>
    ) : null;

    // heater heights on the right, past the headroom dimension: its top (the supply vent's reference) and,
    // for a wall-hung box heater, its bottom — an axis from the floor like the scale on the left
    const heaterLevels = hsVals.map((y) => ({ y, t: unitLines(y) }));
    const xHs = D + T + pm(48);
    const hLab = heaterLevels.map((l) => ({ ...l, ly: Yh(l.y) })).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < hLab.length; i++) if (hLab[i].ly < hLab[i - 1].ly + gapL) hLab[i].ly = hLab[i - 1].ly + gapL;
    const heaterScale = (
      <g key="hs">
        <g stroke={C.ember} strokeOpacity={0.75} strokeWidth={pm(1)}>
          <line x1={xHs} y1={Yh(0)} x2={xHs} y2={Yh(heaterTop)} />
          <line x1={xHs - pm(4)} y1={Yh(0)} x2={xHs + pm(4)} y2={Yh(0)} />
          {hLab.map((l, i) => (
            <g key={i}>
              <line x1={D + T + pm(3)} y1={Yh(l.y)} x2={xHs + pm(4)} y2={Yh(l.y)} />
              <line x1={xHs + pm(4)} y1={Yh(l.y)} x2={xHs + pm(8)} y2={l.ly} />
            </g>
          ))}
        </g>
        {hLab.map((l, i) => textLines(l.t, xHs + pm(10), midY(l),
          { textAnchor: "start", fontSize: pm(11), fontFamily: MONO, fill: C.ember, ...halo(C.bg) }, "t" + i))}
      </g>
    );

    // wall names + overall depth below the floor
    const yB = H + FL, yDd = yB + pm(40);
    const bottom = (
      <g key="bot">
        <text x={0} y={yB + pm(14)} textAnchor="start" {...lbl}>BACK WALL</text>
        <text x={D} y={yB + pm(14)} textAnchor="end" {...lbl}>DOOR WALL</text>
        <g stroke={C.dim} strokeWidth={pm(1)}>
          <line x1={0} y1={yB + pm(4)} x2={0} y2={yDd + pm(5)} />
          <line x1={D} y1={yB + pm(4)} x2={D} y2={yDd + pm(5)} />
        </g>
        {dim(0, yDd, D, yDd, D, C.dim, C.bg, "dd")}
      </g>
    );

    return (
      <svg width="100%" height="100%" viewBox={`${vg.minX} ${vg.minY} ${vg.vw} ${vg.vh}`}
        preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
        <rect x={0} y={0} width={D} height={H} fill={C.floor} />
        {grid}
        {/* title above the ceiling: the wall you are looking at (inside the room it would sit among ceiling-height items) */}
        <text x={D / 2} y={-T - pm(8)} textAnchor="middle" {...lbl}>RIGHT WALL</text>
        {farBenches}
        {railPosts("right", true)}
        {farPeople}
        {backProfiles}
        {backSitter}
        {p.heaterWall !== "left" && heaterEl}
        {nearBenches}
        {railPosts("left", false)}
        {nearPeople}
        {p.heaterWall === "left" && heaterEl}
        {slots}
        {walls}
        {vents}
        {sensorEl}
        {cpEl}
        {wallLabelEls}
        {ordinates}
        {headroom}
        {heaterScale}
        {bottom}
      </svg>
    );
  };

  return (
    <div style={{ background: UI.bg, color: UI.text, fontFamily: "system-ui, -apple-system, sans-serif" }}
      className="w-full h-screen flex flex-col">
      <style>{`summary::-webkit-details-marker{display:none} summary::marker{content:''}
        input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
        input[type=number]{-moz-appearance:textfield}
        button:hover{filter:brightness(1.2)}
        summary:hover{color:#fff}
        @media (pointer: coarse){
          input[type=range]{height:30px !important}
          summary{padding:15px 16px !important}
          button{padding:8px 14px !important}
        }`}</style>
      {/* header */}
      <div style={{ borderBottom: `1px solid ${UI.line}` }} className="flex items-baseline gap-4 px-4 py-3 flex-wrap">
        <div style={{ fontSize: 11, letterSpacing: "0.22em", color: UI.ember, fontWeight: 700 }}>SAUNA PLANNER</div>
        <div style={{ fontFamily: MONO, fontSize: 14 }}>
          {p.W.toFixed(2)} × {p.D.toFixed(2)} × {p.H.toFixed(2)} m
        </div>
        <div style={{ fontFamily: MONO, fontSize: 12, color: UI.dim }}>
          {(p.W * p.D).toFixed(2)} m² · bench run {benchRun.toFixed(2)} m · ~{people.length} seated
        </div>
      </div>

      <div className={isPhone ? "flex flex-col flex-1 min-h-0" : "flex flex-1 min-h-0"}>
        {/* viewport */}
        <div className="min-h-0 flex flex-col" style={isPhone ? { flex: "0 0 52%" } : { flex: "1 1 0%" }}>
          {/* toolbar: view switch + clearance status */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", borderBottom: `1px solid ${UI.line}`, flexWrap: "wrap" }}>
            <Seg value={view} options={[["3d", "3D view"], ["plan", "Floor plan"], ["side", "Side view"]]}
              onChange={(v) => { setView(v); resetPlanView(); }} />
            {view !== "3d" && <Seg value={planTheme} options={[["dark", "Dark"], ["light", "Light"]]} onChange={setPlanTheme} />}
            {view !== "3d" && <Seg value={units} options={[["metric", "Metric"], ["imperial", "Imperial"], ["both", "Both"]]} onChange={setUnits} />}
            {view !== "3d" && planZoomed && <Btn onClick={resetPlanView}>Fit</Btn>}
            {/* status: heater clearance (pass/fail), and the supply vent's distance to the sensor (information only:
                the minimum depends on which way the vent blows) */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "6px 0 6px auto" }}>
              <Badge tone={conflicts.length || railHits.length ? "warn" : "ok"}>
                {conflicts.length || railHits.length
                  ? "⚠ " + [
                    conflicts.length ? `${conflicts.join(" + ")} inside heater clearance` : null,
                    railHits.length ? `${railHits.join(" + ")} overlaps the safety railing` : null,
                  ].filter(Boolean).join(" · ")
                  : "✓ heater clearance OK"}
              </Badge>
              <Badge tone="info">supply vent {supplyMm} mm from sensor</Badge>
              <Badge tone={cpOk ? "ok" : "warn"}>
                {cpOk ? `✓ control panel ${cpMm} mm from heater edge` : `⚠ control panel only ${cpMm} mm from heater edge (min 1000 mm)`}
              </Badge>
            </div>
          </div>

          <div className="relative flex-1 min-h-0">
            <div ref={mountRef} className="absolute inset-0" />
            {view === "3d" && (
              <div style={{
                position: "absolute", left: 12, bottom: 12, fontSize: 11, color: UI.dim,
                background: "rgba(23,18,14,0.72)", border: `1px solid ${UI.line}`,
                padding: "6px 10px", borderRadius: 8, pointerEvents: "none",
              }}>
                {isPhone ? "drag rotate · pinch zoom · two-finger pan" : "left-drag rotate · scroll zoom · right-drag / shift-drag pan"}
              </div>
            )}
            {view !== "3d" && (
              <div className="absolute inset-0 flex flex-col" style={{ background: C.bg }}>
                <div ref={planRef} className="relative flex-1 min-h-0 overflow-hidden" style={{ touchAction: "none", cursor: "grab", userSelect: "none", WebkitUserSelect: "none" }}>
                  {view === "plan" ? renderPlan() : renderSide()}
                </div>
                {/* legend */}
                <div style={{
                  display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", padding: "7px 12px",
                  borderTop: `1px solid ${C.line}`, background: C.legendBg, fontSize: 11, color: C.legendText,
                }}>
                  {view === "side" && <span style={{ color: C.legendStrong }}>From the left wall, looking at the right wall</span>}
                  {LEVELS.map((L, i) => (lvOn(i, "left") || lvOn(i, "back") || lvOn(i, "right") ? (
                    <span key={L.name}>
                      <Swatch color={C.tiers[i]} frame={planTheme === "light" ? C.benchEdge : undefined} />{L.name}{" "}
                      <span style={{ fontFamily: MONO, color: C.legendStrong }}>h {uInl(lvH(i))} · d {uInl(lvD(i))}</span>
                    </span>
                  ) : null))}
                  {p.showClear && (
                    <span>
                      <Swatch color={conflicts.length ? C.warn : C.ember} ring />clearance{" "}
                      <span style={{ fontFamily: MONO, color: C.legendStrong }}>{uInl(p.clearance)}</span>
                    </span>
                  )}
                  {p.showVents && ventLegend.map(([, lab], i) => (
                    <span key={lab}><Swatch color={C.vents[i]} dot />{lab.split(" (")[0]}</span>
                  ))}
                  {p.showVents && <span><Swatch color={C.vents[0]} outline />supply outside opening + duct</span>}
                  {view === "side" && p.showVents && <span><Swatch color={C.text} ring />vent on the left wall (behind you)</span>}
                  <span><Swatch color={C.sensor} frame={planTheme === "light" ? C.ink : undefined} />sensor</span>
                  <span><Swatch color={C.cp} frame={C.ember} />control panel</span>
                  {railOn && <span><Swatch color={view === "plan" ? C.railPlan : C.railSide} frame={view === "plan" ? C.railPlanEdge : C.dim} />safety railing</span>}
                  <span><Swatch color={C.free} />{view === "plan" ? "free floor" : "headroom"}</span>
                  <span>grid {units === "imperial" ? '3"' : "10 cm"}</span>
                  <span style={{ marginLeft: "auto" }}>
                    {isPhone ? "drag pan · pinch zoom" : "drag pan · scroll zoom · double-click fit"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* control panel */}
        <div key={isPhone ? "phone" : "desk"}
          style={isPhone
            ? { background: UI.panel, borderTop: `1px solid ${UI.line}` }
            : { background: UI.panel, borderLeft: `1px solid ${UI.line}`, width: 340 }}
          className={isPhone ? "w-full flex-1 min-h-0 overflow-y-auto" : "shrink-0 min-h-0 overflow-y-auto"} >
          <Section title="Room" defaultOpen>
            <Row label="Width" value={p.W} unit="m" min={1.2} max={4} step={0.05} onChange={(v) => set("W", v)} />
            <Row label="Depth" value={p.D} unit="m" min={1.2} max={5} step={0.05} onChange={(v) => set("D", v)} />
            <Row label="Ceiling height" value={p.H} unit="m" min={1.9} max={2.6} step={0.05} onChange={(v) => set("H", v)} />
          </Section>

          <Section title="Benches" defaultOpen={!isPhone}>
            {LEVELS.map((L, i) => (
              <React.Fragment key={L.name}>
                <div style={{ fontSize: 11, letterSpacing: "0.1em", color: UI.ember, margin: i === 0 ? "6px 0 0" : "14px 0 0" }}>
                  {L.name.toUpperCase()} — {L.hint}
                </div>
                <WallToggles
                  options={[[L.keys.left, "Left wall"], [L.keys.back, "Back wall"], [L.keys.right, "Right wall"]]}
                  state={p} onToggle={set}
                />
                {/* heights: upper from the ceiling, middle from the upper bench, step from the floor */}
                {i === 0 ? (
                  <Row label="Upper: below ceiling" value={s.upCeil} unit="m" min={0.6} max={Math.max(0.7, p.H - 0.3)} step={0.05} onChange={(v) => set("upCeil", v)} />
                ) : i === 1 ? (
                  <Row label="Middle: below upper bench" value={s.loDrop} unit="m" min={0.15} max={Math.max(0.2, p.upH - 0.1)} step={0.05} onChange={(v) => set("loDrop", v)} />
                ) : (
                  <Row label={`${L.name} height`} value={p[L.keys.h]} unit="m" min={L.hMin} max={L.hMax} step={0.05} onChange={(v) => set(L.keys.h, v)} />
                )}
                <Row label={`${L.name} depth`} value={p[L.keys.d]} unit="m" min={L.dMin} max={L.dMax} step={0.05} onChange={(v) => set(L.keys.d, v)} />
                <Row label={`${L.name} starts at`} value={p[L.keys.z0]} unit="m" min={0} max={p.D} step={0.05} onChange={(v) => set(L.keys.z0, v)} />
              </React.Fragment>
            ))}
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: UI.ember, margin: "14px 0 0" }}>SHARED</div>
            <Row label="Side benches end at" value={p.bz1} unit="m" min={0} max={p.D} step={0.05} onChange={(v) => set("bz1", v)} />
            <div style={{ fontSize: 11, color: UI.dim, lineHeight: 1.5, marginBottom: 4 }}>
              Each tier tucks 5 cm under the one above on shared walls, and side wings stop where that tier's back bench begins.
            </div>
            <Toggle label="Rails on exposed upper bench ends" value={p.showRails} onChange={(v) => set("showRails", v)} />
            <div style={{ fontSize: 11, color: UI.dim, lineHeight: 1.5 }}>
              Heights above the floor: upper <span style={{ fontFamily: MONO, color: UI.text }}>{p.upH.toFixed(2)} m</span>,
              middle <span style={{ fontFamily: MONO, color: UI.text }}>{p.loH.toFixed(2)} m</span>,
              step <span style={{ fontFamily: MONO, color: UI.text }}>{p.stH.toFixed(2)} m</span>.
              Rule of thumb: keep ~1.1 m between the upper bench and the ceiling, head clearance included.
            </div>
          </Section>

          <Section title="Capacity" defaultOpen={!isPhone}>
            <Toggle label="Show seated people (upper level)" value={p.showPeople} onChange={(v) => set("showPeople", v)} />
            <Toggle label="Show seat width volumes" value={p.showSeatW} onChange={(v) => set("showSeatW", v)} />
            <Row label="Seat width per person" value={p.seatW} unit="m" min={0.45} max={0.8} step={0.05} onChange={(v) => set("seatW", v)} />
            <div style={{ fontSize: 12, color: UI.text, margin: "8px 0 4px" }}>
              Fits <span style={{ fontFamily: MONO, color: UI.ember }}>{people.length}</span> seated on the upper benches
            </div>
            <div style={{ fontSize: 11, color: UI.dim, lineHeight: 1.5 }}>
              0.60 m per person is the usual planning figure — drop to 0.50 m for a cosy squeeze, 0.70 m for lounging.
              For lying down, plan ~1.80–2.00 m of clear bench length.
            </div>
          </Section>

          <Section title="Heater" defaultOpen={!isPhone}>
            <Seg value={p.heater} options={[["cilindro", "Harvia Cilindro"], ["drop", "HUUM Drop"], ["spirit", "Harvia Spirit"]]} onChange={(v) => set("heater", v)} />
            {isSpirit && (
              <>
                <div style={{ fontSize: 11, color: UI.dim, margin: "2px 0 4px" }}>
                  Wall-mounted, <span style={{ fontFamily: MONO, color: UI.text }}>385 × 335 × 750 mm</span> (width × depth × height)
                </div>
                <Row label="Bottom above floor" value={p.hBottom} unit="m" min={0} max={1.2} step={0.01} onChange={(v) => set("hBottom", v)} />
                <Row label="Min. distance to ceiling" value={p.ceilClear} unit="m" min={0} max={1.5} step={0.01} onChange={(v) => set("ceilClear", v)} />
                <div style={{ fontSize: 11, color: UI.dim, lineHeight: 1.5, marginBottom: 4 }}>
                  Top at <span style={{ fontFamily: MONO, color: UI.text }}>{heaterTop.toFixed(2)} m</span> ·{" "}
                  <span style={{ fontFamily: MONO, color: heaterTop + p.ceilClear > p.H + 0.001 ? UI.warn : UI.ok }}>
                    {(p.H - heaterTop).toFixed(2)} m
                  </span>{" "}
                  to the ceiling (needs {p.ceilClear.toFixed(2)})
                </div>
                <Toggle label="Safety railing (Harvia SP60/90)" value={p.railing} onChange={(v) => set("railing", v)} />
                {p.railing && (
                  <div style={{ fontSize: 11, color: UI.dim, lineHeight: 1.5, marginBottom: 4 }}>
                    545 × 450 × 130 mm around the top of the heater: it reaches{" "}
                    <span style={{ fontFamily: MONO, color: UI.text }}>{((railW - p.hW) / 2 * 1000).toFixed(0)} mm</span> past each side and{" "}
                    <span style={{ fontFamily: MONO, color: UI.text }}>{((railD - p.hD) * 1000).toFixed(0)} mm</span> in front.
                  </div>
                )}
              </>
            )}
            <Seg value={p.heaterWall} options={wallOpts} onChange={(v) => set("heaterWall", v)} />
            <Row label="Position along wall" value={p.heaterX} unit="m" min={0.15} max={hWallLen - 0.15} step={0.05} onChange={(v) => set("heaterX", v)} />
            <Row label={isSpirit ? "Front / side clearance" : "Safety clearance"} value={p.clearance} unit="m" min={0.02} max={0.6} step={0.01} onChange={(v) => set("clearance", v)} />
            <Toggle label="Show clearance volume" value={p.showClear} onChange={(v) => set("showClear", v)} />
            <div style={{ fontSize: 11, color: UI.dim, lineHeight: 1.5 }}>
              {isSpirit
                ? "Harvia lists 60 mm (6 kW) or 80 mm (9 kW) to front and sides, 100 mm to the floor and 900 mm to the ceiling for the Spirit — check the manual for your model."
                : "0.25 m is a placeholder — set the exact clearance from your heater manual before you fix the bench frame."}
            </div>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: UI.ember, margin: "14px 0 2px" }}>TEMPERATURE SENSOR</div>
            <Row label="Below ceiling" value={p.sensorCeil} unit="m" min={0.02} max={Math.max(0.1, p.H - 0.1)} step={0.01} decimals={3} onChange={(v) => set("sensorCeil", v)} />
            <Row label="From centre (+ away from door)" value={p.sensorSide} unit="m" min={-1} max={1} step={0.01} decimals={3} onChange={(v) => set("sensorSide", v)} />
            <div style={{ fontSize: 11, color: UI.dim, lineHeight: 1.5 }}>
              On the heater's wall, measured to the sensor centre. The supply vent is{" "}
              <span style={{ fontFamily: MONO, color: UI.text }}>{supplyMm} mm</span>{" "}
              away; the minimum is 1000, 500 or 350 mm depending on which way the vent blows. The arrow on the vent
              points away from the sensor.
            </div>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: UI.ember, margin: "14px 0 2px" }}>CONTROL PANEL</div>
            <Seg value={p.cpWall} options={wallOpts} onChange={(v) => set("cpWall", v)} />
            <Row label="Offset along wall" value={p.cpX} unit="m" min={0.05} max={Math.max(p.W, p.D)} step={0.05} onChange={(v) => set("cpX", v)} />
            <Row label="Above floor (max 1.20)" value={p.cpH} unit="m" min={0.1} max={CP_MAX_HEIGHT} step={0.01} onChange={(v) => set("cpH", v)} />
            <div style={{ fontSize: 11, color: UI.dim, lineHeight: 1.5 }}>
              Height is to the panel centre. At its closest point it is{" "}
              <span style={{ fontFamily: MONO, color: cpOk ? UI.ok : UI.warn }}>{cpMm} mm</span>{" "}
              from the heater's outer edge (not its centre); it needs at least 1000 mm.
            </div>
          </Section>

          <Section title="Ventilation" defaultOpen={!isPhone}>
            {ventLegend.map(([c, lab]) => (
              <div key={lab} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: UI.dim, margin: "6px 0" }}>
                <span style={{ width: 10, height: 10, background: c, borderRadius: 999, display: "inline-block" }} />
                {lab}
              </div>
            ))}
            <Toggle label="Show vents" value={p.showVents} onChange={(v) => set("showVents", v)} />
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: UI.ember, margin: "10px 0 2px" }}>SUPPLY</div>
            <Seg value={p.v1wall} options={wallOpts} onChange={(v) => set("v1wall", v)} />
            <Row label="Offset along wall" value={p.v1x} unit="m" min={0.1} max={Math.max(p.W, p.D)} step={0.05} onChange={(v) => set("v1x", v)} />
            <Row label="Above heater top (− = below)" value={p.v1top} unit="m" min={-1} max={1.5} step={0.01} onChange={(v) => set("v1top", v)} />
            <Row label="Diameter" value={p.v1d} unit="mm" min={40} max={250} step={5} decimals={0} onChange={(v) => set("v1d", v)} />
            <div style={{ fontSize: 11, color: UI.dim, margin: "10px 0 0" }}>Outside opening — same wall and Ø, joined by a duct</div>
            <Row label="Outside: offset along wall" value={p.v1oX} unit="m" min={0.1} max={Math.max(p.W, p.D)} step={0.05} onChange={(v) => set("v1oX", v)} />
            <Row label="Outside: above floor" value={p.v1oH} unit="m" min={0.05} max={p.H - 0.05} step={0.01} onChange={(v) => set("v1oH", v)} />
            <div style={{ fontSize: 11, color: UI.dim, lineHeight: 1.5 }}>
              The duct drops{" "}
              <span style={{ fontFamily: MONO, color: supplyOut.drop > 0 ? UI.ok : UI.warn }}>{supplyOut.drop.toFixed(2)} m</span>{" "}
              from the inside opening{supplyOut.drop > 0 ? "." : " — the outside opening should be lower, so warm air can't escape."}
            </div>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: UI.ember, margin: "10px 0 2px" }}>EXHAUST</div>
            <Seg value={p.v2wall} options={wallOpts} onChange={(v) => set("v2wall", v)} />
            <Row label="Offset along wall" value={p.v2x} unit="m" min={0.1} max={Math.max(p.W, p.D)} step={0.05} onChange={(v) => set("v2x", v)} />
            <Row label="Above floor" value={p.v2h} unit="m" min={0.05} max={p.H - 0.05} step={0.01} onChange={(v) => set("v2h", v)} />
            <Row label="Diameter" value={p.v2d} unit="mm" min={40} max={250} step={5} decimals={0} onChange={(v) => set("v2d", v)} />
            <div style={{ fontSize: 11, letterSpacing: "0.1em", color: UI.ember, margin: "10px 0 2px" }}>DRYING</div>
            <Seg value={p.v3wall} options={wallOpts} onChange={(v) => set("v3wall", v)} />
            <Row label="Offset along wall" value={p.v3x} unit="m" min={0.1} max={Math.max(p.W, p.D)} step={0.05} onChange={(v) => set("v3x", v)} />
            <Row label="Below ceiling" value={p.v3ceil} unit="m" min={0.05} max={p.H - 0.05} step={0.01} onChange={(v) => set("v3ceil", v)} />
            <Row label="Diameter" value={p.v3d} unit="mm" min={40} max={250} step={5} decimals={0} onChange={(v) => set("v3d", v)} />
            <div style={{ fontSize: 11, color: UI.dim, lineHeight: 1.5 }}>
              Heights are to the vent centre. The supply follows the heater top when you move or resize the heater.
            </div>
          </Section>

          <Section title="Door" defaultOpen={!isPhone}>
            <Row label="Door position" value={p.doorX} unit="m" min={0.05} max={Math.max(0.05, p.W - p.doorW - 0.05)} step={0.05} onChange={(v) => set("doorX", v)} />
            <Row label="Door width" value={p.doorW} unit="m" min={0.5} max={0.9} step={0.05} onChange={(v) => set("doorW", v)} />
            <div style={{ fontSize: 11, color: UI.dim, lineHeight: 1.5 }}>
              The door sits in the front wall, which fades out when you orbit past it — the room is always open toward you.
            </div>
          </Section>

          <Section title="Save / Load" defaultOpen={!isPhone}>
            <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
              <Btn primary onClick={exportSettings}>Export settings</Btn>
              <Btn onClick={importSettings}>Load from text</Btn>
            </div>
            <textarea
              value={ioText} onChange={(e) => setIoText(e.target.value)} rows={5} spellCheck={false}
              placeholder={'Click "Export settings" to fill this box with a settings text you can save anywhere.\nPaste a saved text here and click "Load from text" to restore it.'}
              style={{
                width: "100%", boxSizing: "border-box", fontFamily: MONO, fontSize: 11,
                color: UI.text, background: UI.panel2, border: `1px solid ${UI.line}`,
                borderRadius: 8, padding: 8, resize: "vertical", outline: "none",
              }}
            />
            {ioMsg && (
              <div style={{ fontSize: 11, marginTop: 6, color: ioMsg.startsWith("Couldn") ? UI.warn : UI.ok }}>
                {ioMsg}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
