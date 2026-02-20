// Copyright (c) 2025 Dean Taylor
// Licensed under the MIT License. See LICENSE file for details.

/* global React, window, document */
const { useEffect, useMemo, useRef, useState } = React;
const Icon = window.Icons;

function App() {
  const WIDTH = 27, HEIGHT = 9, CELL = 18, GAP = 8;
  const MAX_OFFSET_X = WIDTH + 64, MAX_OFFSET_Y = HEIGHT + 64;

  const [framesCount, setFramesCount] = useState(8);
  const [fps, setFps] = useState(4);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);

  const emptyGrid = () => Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => false));
  const makeFrames = (n) => Array.from({ length: n }, () => emptyGrid());
  const mkLayer = (name, kind) => ({
    id: `${name}-${Math.random().toString(36).slice(2)}`,
    name, kind, visible: true,
    frames: makeFrames(framesCount),
    framesExt: Array.from({ length: framesCount }, () => []),
    offsets: Array.from({ length: framesCount }, () => ({ x: 0, y: 0 })),
    keyframes: []
  });

  const [layers, setLayers] = useState([
    mkLayer("Draw Layer", "draw"),
    mkLayer("Text Layer", "text"),
    mkLayer("Number Layer", "number")
  ]);
  const [selectedLayerId, setSelectedLayerId] = useState(null);

  const isDownRef = useRef(false);
  const drawStateRef = useRef(null);
  const gridRef = useRef(null);
  const fileInputRef = useRef(null);

  const getLayer = (id) => layers.find((l) => l.id === id) || null;
  const setLayer = (id, up) => setLayers((prev) => prev.map((l) => (l.id === id ? up(l) : l)));

  useEffect(() => { if (!selectedLayerId && layers[0]) setSelectedLayerId(layers[0].id); }, [layers, selectedLayerId]);

  useEffect(() => {
    setLayers((prev) =>
      prev.map((l) => {
        let f = l.frames;
        if (f.length < framesCount) f = [...f, ...makeFrames(framesCount - f.length)];
        else if (f.length > framesCount) f = f.slice(0, framesCount);

        let o = l.offsets;
        if (o.length < framesCount) o = [...o, ...Array.from({ length: framesCount - o.length }, () => ({ x: 0, y: 0 }))];
        else if (o.length > framesCount) o = o.slice(0, framesCount);

        let fx = l.framesExt || [];
        if (fx.length < framesCount) fx = [...fx, ...Array.from({ length: framesCount - fx.length }, () => [])];
        else if (fx.length > framesCount) fx = fx.slice(0, framesCount);

        return { ...l, frames: f, offsets: o, framesExt: fx };
      })
    );
    setCurrent((c) => Math.min(c, Math.max(0, framesCount - 1)));
  }, [framesCount]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setCurrent((c) => (c + 1) % Math.max(framesCount, 1)), Math.max(20, 1000 / Math.max(1, fps)));
    return () => clearInterval(t);
  }, [playing, fps, framesCount]);

  const kfs = (l) => (l ? [...l.keyframes].sort((a, b) => a.f - b.f) : []);
  const upsertKF = (id, f, x, y) => setLayer(id, (L) => ({ ...L, keyframes: [...kfs(L).filter((k) => k.f !== f), { f, x, y }].sort((a, b) => a.f - b.f) }));
  const removeKF = (id, f) => setLayer(id, (L) => ({ ...L, keyframes: kfs(L).filter((k) => k.f !== f) }));
  const interp = (a, b, t) => Math.round(a + (b - a) * t);
  const getOffsetAt = (l, f) => {
    if (!l) return { x: 0, y: 0 };
    const list = kfs(l);
    if (!list.length) return l.offsets[f] || { x: 0, y: 0 };
    const ex = list.find((k) => k.f === f);
    if (ex) return { x: ex.x, y: ex.y };
    const before = [...list].filter((k) => k.f < f).pop();
    const after = list.find((k) => k.f > f);
    if (!before && after) return { x: after.x, y: after.y };
    if (before && !after) return { x: before.x, y: before.y };
    if (before && after) {
      const t = (f - before.f) / (after.f - before.f);
      return { x: interp(before.x, after.x, t), y: interp(before.y, after.y, t) };
    }
    return { x: 0, y: 0 };
  };

  const gridPx = useMemo(() => WIDTH * CELL + (WIDTH - 1) * GAP, []);
  const safeSet = (g, x, y, v) => { if (x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT) g[y][x] = v; };

  const mergeFrame = (fi) => {
    const out = emptyGrid();
    const place = (src, off) => {
      for (let y=0;y<HEIGHT;y++) for (let x=0;x<WIDTH;x++)
        if (src[y][x]) safeSet(out, x + off.x, y + off.y, true);
    };
    layers.forEach((l) => {
      if (!l.visible) return;
      const off = getOffsetAt(l, fi);
      place(l.frames[fi], off);
      const ext = (l.framesExt?.[fi] || []);
      for (const key of ext) {
        const [lx, ly] = key.split(',').map((n)=>parseInt(n,10));
        if (Number.isFinite(lx) && Number.isFinite(ly)) safeSet(out, lx + off.x, ly + off.y, true);
      }
    });
    return out;
  };

  const clientToCell = (clientX, clientY) => {
    const el = gridRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const cw = CELL + GAP, ch = CELL + GAP;
    const gx = Math.floor((clientX - r.left) / cw);
    const gy = Math.floor((clientY - r.top) / ch);
    if (gx < 0 || gy < 0 || gx >= WIDTH || gy >= HEIGHT) return null;
    return { x: gx, y: gy };
  };

  const paintAtGlobal = (layerId, gx, gy, value) => {
    setLayer(layerId, (L) => {
      const off = getOffsetAt(L, current);
      const lx = gx - off.x, ly = gy - off.y;
      const frames = L.frames.slice();
      const g = frames[current].map((r) => [...r]);
      if (lx >= 0 && ly >= 0 && lx < WIDTH && ly < HEIGHT) {
        safeSet(g, lx, ly, value);
        frames[current] = g;
        return { ...L, frames };
      }
      const framesExt = (L.framesExt || []).slice();
      const ext = (framesExt[current] ? [...framesExt[current]] : []);
      const key = `${lx},${ly}`;
      const idx = ext.indexOf(key);
      if (value) { if (idx === -1) ext.push(key); } else { if (idx !== -1) ext.splice(idx, 1); }
      framesExt[current] = ext;
      frames[current] = g;
      return { ...L, frames, framesExt };
    });
  };

  const onGridMove = (e) => {
    if (!isDownRef.current) return;
    const l = getLayer(selectedLayerId);
    if (!l || !l.visible) return;
    const cell = clientToCell(e.clientX, e.clientY); if (!cell) return;
    paintAtGlobal(l.id, cell.x, cell.y, (drawStateRef.current ?? true));
  };

  const onCellDown = (idx, e) => {
    const l = getLayer(selectedLayerId); if (!l || !l.visible) return;
    const y = Math.floor(idx / WIDTH), x = idx % WIDTH;
    const right = e.button === 2;
    if (l.kind === "draw") {
      paintAtGlobal(l.id, x, y, !right);
      isDownRef.current = true; drawStateRef.current = !right; return;
    }
    if (l.kind === "text") { setShowTextModal(true); return; }
    if (l.kind === "number") { setShowNumberModal(true); return; }
  };

  const addKeyframe = () => {
    const l = getLayer(selectedLayerId); if (!l) return;
    const off = getOffsetAt(l, current);
    upsertKF(l.id, current, off.x, off.y);
  };

  const nudgeSelected = (dx, dy) => {
    const l = getLayer(selectedLayerId); if (!l) return;
    const off = getOffsetAt(l, current);
    if (l.keyframes.length > 0) {
      const nx = Math.max(-MAX_OFFSET_X, Math.min(MAX_OFFSET_X, off.x + dx));
      const ny = Math.max(-MAX_OFFSET_Y, Math.min(MAX_OFFSET_Y, off.y + dy));
      upsertKF(l.id, current, nx, ny);
    } else {
      setLayer(l.id, (L) => {
        const offs = L.offsets.slice();
        const cx = (offs[current]?.x || 0) + dx;
        const cy = (offs[current]?.y || 0) + dy;
        offs[current] = {
          x: Math.max(-MAX_OFFSET_X, Math.min(MAX_OFFSET_X, cx)),
          y: Math.max(-MAX_OFFSET_Y, Math.min(MAX_OFFSET_Y, cy))
        };
        return { ...L, offsets: offs };
      });
    }
  };

  const duplicateToNext = () => {
    if (current >= framesCount - 1) return;
    setLayers((prev) =>
      prev.map((l) => ({
        ...l,
        frames: l.frames.map((g, i) => (i === current + 1 ? l.frames[current].map((r) => [...r]) : g)),
        framesExt: (l.framesExt || []).map((arr, i) => (i === current + 1 ? [...(l.framesExt?.[current] || [])] : arr)),
        offsets: l.offsets.map((o, i) => (i === current + 1 ? { ...l.offsets[current] } : o))
      }))
    );
    setCurrent((c) => Math.min(framesCount - 1, c + 1));
  };

const deleteCurrentFrame = () => {
  if (framesCount <= 1) return; // always keep at least 1 frame

  setLayers(prev =>
    prev.map(l => {
      const frames = l.frames.slice();
      frames.splice(current, 1);

      const framesExt = (l.framesExt || []).slice();
      framesExt.splice(current, 1);

      const offsets = l.offsets.slice();
      offsets.splice(current, 1);

      const keyframes = (l.keyframes || [])
        .filter(k => k.f !== current)
        .map(k => (k.f > current ? { ...k, f: k.f - 1 } : k));

      return { ...l, frames, framesExt, offsets, keyframes };
    })
  );

  setFramesCount(framesCount - 1);
  setCurrent(c => Math.max(0, Math.min(c, framesCount - 2)));
};
  const [clip, setClip] = useState(null);
  const copyFrame = () => {
    const byName = {};
    layers.forEach((l) => (byName[l.name] = {
      grid: l.frames[current].map((r) => [...r]),
      ext: [...(l.framesExt?.[current] || [])],
      offset: { ...l.offsets[current] }
    }));
    setClip({ byName });
  };
  const pasteFrame = () => {
    if (!clip) return;
    setLayers((prev) =>
      prev.map((l) => {
        const e = clip.byName[l.name]; if (!e) return l;
        const frames = l.frames.slice(); frames[current] = e.grid.map((r) => [...r]);
        const offsets = l.offsets.slice(); offsets[current] = { ...e.offset };
        const framesExt = (l.framesExt || []).slice(); framesExt[current] = [...(e.ext || [])];
        return { ...l, frames, offsets, framesExt };
      })
    );
  };

  const FONT5x7 = {
    ' ': ['00000','00000','00000','00000','00000','00000','00000'],
    'A': ['01110','10001','10001','11111','10001','10001','10001'],
    'B': ['11110','10001','10001','11110','10001','10001','11110'],
    'C': ['01110','10001','10000','10000','10000','10001','01110'],
    'D': ['11110','10001','10001','10001','10001','10001','11110'],
    'E': ['11111','10000','10000','11110','10000','10000','11111'],
    'F': ['11111','10000','10000','11110','10000','10000','10000'],
    'G': ['01110','10001','10000','10111','10001','10001','01110'],
    'H': ['10001','10001','10001','11111','10001','10001','10001'],
    'I': ['01110','00100','00100','00100','00100','00100','01110'],
    'J': ['00001','00001','00001','00001','10001','10001','01110'],
    'K': ['10001','10010','10100','11000','10100','10010','10001'],
    'L': ['10000','10000','10000','10000','10000','10000','11111'],
    'M': ['10001','11011','10101','10101','10001','10001','10001'],
    'N': ['10001','10001','11001','10101','10011','10001','10001'],
    'O': ['01110','10001','10001','10001','10001','10001','01110'],
    'P': ['11110','10001','10001','11110','10000','10000','10000'],
    'Q': ['01110','10001','10001','10001','10101','10010','01101'],
    'R': ['11110','10001','10001','11110','10100','10010','10001'],
    'S': ['01111','10000','10000','01110','00001','00001','11110'],
    'T': ['11111','00100','00100','00100','00100','00100','00100'],
    'U': ['10001','10001','10001','10001','10001','10001','01110'],
    'V': ['10001','10001','10001','10001','10001','01010','00100'],
    'W': ['10001','10001','10001','10101','10101','11011','10001'],
    'X': ['10001','01010','00100','00100','01010','10001','10001'],
    'Y': ['10001','01010','00100','00100','00100','00100','00100'],
    'Z': ['11111','00001','00010','00100','01000','10000','11111'],
    'a': ['00000','00000','01110','00001','01111','10001','01111'],
    'b': ['10000','10000','11110','10001','10001','10001','11110'],
    'c': ['00000','00000','01110','10001','10000','10001','01110'],
    'd': ['00001','00001','01111','10001','10001','10001','01111'],
    'e': ['00000','00000','01110','10001','11111','10000','01110'],
    'f': ['00110','01001','01000','11100','01000','01000','01000'],
    'g': ['00000','00000','01111','10001','10001','01111','00001'],
    'h': ['10000','10000','11110','10001','10001','10001','10001'],
    'i': ['00100','00000','01100','00100','00100','00100','01110'],
    'j': ['00010','00000','00110','00010','00010','10010','01100'],
    'k': ['10000','10000','10010','10100','11000','10100','10010'],
    'l': ['01100','00100','00100','00100','00100','00100','01110'],
    'm': ['00000','00000','11010','10101','10101','10101','10101'],
    'n': ['00000','00000','11110','10001','10001','10001','10001'],
    'o': ['00000','00000','01110','10001','10001','10001','01110'],
    'p': ['00000','00000','11110','10001','10001','11110','10000'],
    'q': ['00000','00000','01111','10001','10001','01111','00001'],
    'r': ['00000','00000','10110','11001','10000','10000','10000'],
    's': ['00000','00000','01111','10000','01110','00001','11110'],
    't': ['01000','01000','11100','01000','01000','01001','00110'],
    'u': ['00000','00000','10001','10001','10001','10001','01111'],
    'v': ['00000','00000','10001','10001','10001','01010','00100'],
    'w': ['00000','00000','10001','10001','10101','10101','01010'],
    'x': ['00000','00000','10001','01010','00100','01010','10001'],
    'y': ['00000','00000','10001','10001','10001','01111','00001'],
    'z': ['00000','00000','11111','00010','00100','01000','11111'],
    '0': ['01110','10001','10011','10101','11001','10001','01110'],
    '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00010','00100','01000','11111'],
    '3': ['11110','00001','00001','01110','00001','00001','11110'],
    '4': ['00010','00110','01010','10010','11111','00010','00010'],
    '5': ['11111','10000','11110','00001','00001','10001','01110'],
    '6': ['01110','10000','11110','10001','10001','10001','01110'],
    '7': ['11111','00001','00010','00100','01000','10000','10000'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'],
    '9': ['01110','10001','10001','01111','00001','00001','01110']
  };

  const digits = {
    "0": ["111","101","101","101","101","111"],
    "1": ["010","110","010","010","010","111"],
    "2": ["111","001","001","111","100","111"],
    "3": ["111","001","001","111","001","111"],
    "4": ["101","101","101","111","001","001"],
    "5": ["111","100","111","001","001","111"],
    "6": ["111","100","111","101","101","111"],
    "7": ["111","001","010","010","010","010"],
    "8": ["111","101","111","101","101","111"],
    "9": ["111","101","111","001","001","111"]
  };

  const applyText = (text) => {
    const l = getLayer(selectedLayerId);
    if (!l || l.kind !== "text" || !text) return;
    const CHAR_W = 5, CHAR_H = 7, SPACING = 1, startY = 1, GRID_W = WIDTH;
    setLayer(l.id, (L) => {
      const next = { ...L };
      const grid = next.frames[current].map((r) => [...r]);
      let cursorX = 0;
      for (const ch of text) {
        const bm = FONT5x7[ch] || FONT5x7[ch.toUpperCase()];
        if (ch === ' ') { cursorX += 3; continue; }
        if (!bm) { cursorX += CHAR_W + SPACING; continue; }
        if (cursorX + CHAR_W > GRID_W) break;
        for (let y=0;y<CHAR_H;y++) for (let x=0;x<CHAR_W;x++)
          if (bm[y][x] === '1') safeSet(grid, cursorX + x, startY + y, true);
        cursorX += CHAR_W + SPACING;
      }
      next.frames[current] = grid;
      return next;
    });
  };

  const stampNumber = (d) => {
    const l = getLayer(selectedLayerId); if (!l || l.kind !== "number") return;
    const p = digits[d]; if (!p) return;
    const cols = 3, rows = 6, startX = WIDTH - cols, startY = 1;
    setLayer(l.id, (L) => {
      const n = { ...L };
      const g = n.frames[current].map((r) => [...r]);
      for (let y=0;y<rows;y++) for (let x=0;x<cols;x++){
        const on = p[y][x] === "1";
        const gx = startX + x, gy = startY + y;
        if (gx>=0 && gy>=0 && gx<WIDTH && gy<HEIGHT) g[gy][gx] = on;
      }
      n.frames[current] = g;
      return n;
    });
  };

  // EXACT visual mapping packers (no mirror, no alignment offset)
  const packFrameToBytes = (g) => {
    const totalBits = WIDTH * HEIGHT;
    const bytes = new Uint8Array(Math.ceil(totalBits / 8));
    let bitIndex = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const on = g[y][x] ? 1 : 0;     // x=0 (left) -> bit 0
        const bi = bitIndex >> 3, bo = bitIndex & 7;
        bytes[bi] |= on << bo;
        bitIndex++;
      }
    }
    return bytes;
  };

  const packFrameToWords = (g) => {
    const words = new Uint32Array(HEIGHT);
    for (let y = 0; y < HEIGHT; y++) {
      let v = 0 >>> 0;
      for (let x = 0; x < Math.min(WIDTH, 32); x++) {
        if (g[y][x]) v |= (1 << (31 - x));    // x=0 (left) -> bit 0
      }
      words[y] = v >>> 0;
    }
    return words;
  };

    // --- .h IMPORT ------------------------------------------------------------

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const unpackWordsToGrid = (words, srcW, srcH) => {
    const g = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => false));
    const useW = clamp(srcW, 1, WIDTH);
    const useH = clamp(srcH, 1, HEIGHT);

    for (let y = 0; y < useH; y++) {
      const row = (words[y] >>> 0) || 0;
      for (let x = 0; x < useW; x++) {
        const on = ((row >>> (31 - x)) & 1) === 1; // x=0 (left) -> bit 31
        g[y][x] = on;
      }
    }
    return g;
  };

  const parseLedHeader = (text) => {
    const mW = text.match(/#define\s+LED_W\s+(\d+)/);
    const mH = text.match(/#define\s+LED_H\s+(\d+)/);
    const mF = text.match(/#define\s+LED_FRAMES\s+(\d+)/);
    const mFPS = text.match(/#define\s+LED_FPS\s+(\d+)/);

    const srcW = mW ? parseInt(mW[1], 10) : WIDTH;
    const srcH = mH ? parseInt(mH[1], 10) : HEIGHT;
    const srcFrames = mF ? parseInt(mF[1], 10) : null;
    const srcFps = mFPS ? parseInt(mFPS[1], 10) : fps;

    // tries to match: const uint32_t led_anim[LED_FRAMES][H] ... = { ... };
    const mArr = text.match(/led_anim\s*\[[^\]]*\]\s*\[[^\]]*\][^{]*=\s*\{([\s\S]*?)\}\s*;/);
    if (!mArr) throw new Error("No led_anim initializer found");

    const body = mArr[1];
    const nums = body.match(/0x[0-9a-fA-F]+|\b\d+\b/g);
    if (!nums || nums.length === 0) throw new Error("No values found in led_anim");

    const values = nums.map((s) => {
      const v = (s.startsWith("0x") || s.startsWith("0X")) ? parseInt(s, 16) : parseInt(s, 10);
      return (v >>> 0);
    });

    const rowsPerFrame = clamp(srcH, 1, 1024);
    const inferredFrames = Math.floor(values.length / rowsPerFrame);
    const framesCountOut = srcFrames ?? inferredFrames;

    if (!Number.isFinite(framesCountOut) || framesCountOut <= 0) throw new Error("Bad frame count");
    if (values.length < framesCountOut * rowsPerFrame) throw new Error("Not enough values for frames");

    const framesWords = [];
    for (let i = 0; i < framesCountOut; i++) {
      const start = i * rowsPerFrame;
      framesWords.push(values.slice(start, start + rowsPerFrame));
    }

    return { srcW, srcH, framesCountOut, srcFps, framesWords };
  };

  const importFromHeaderRaw = (raw) => {
    const parsed = parseLedHeader(raw);

    setFramesCount(parsed.framesCountOut);
    setFps(Math.max(1, parsed.srcFps | 0));

    // .h is merged -> import as a single draw layer
    const L = mkLayer("Imported .h", "draw");
    L.frames = makeFrames(parsed.framesCountOut);
    L.framesExt = Array.from({ length: parsed.framesCountOut }, () => []);
    L.offsets = Array.from({ length: parsed.framesCountOut }, () => ({ x: 0, y: 0 }));
    L.keyframes = [];

    for (let fi = 0; fi < parsed.framesCountOut; fi++) {
      L.frames[fi] = unpackWordsToGrid(parsed.framesWords[fi], parsed.srcW, parsed.srcH);
    }

    setLayers([L, mkLayer("Text Layer", "text"), mkLayer("Number Layer", "number")]);
    setSelectedLayerId(L.id);
    setCurrent(0);
    setPlaying(false);
  };

  
  const serializeProject = () => ({
    schema: 1,
    meta: { width: WIDTH, height: HEIGHT, framesCount, fps },
    layers: layers.map((l) => ({
      id: l.id, name: l.name, kind: l.kind, visible: l.visible,
      offsets: l.offsets, keyframes: l.keyframes,
      frames: l.frames.map((g)=>g.map((row)=>row.map((v)=>v?1:0))),
      framesExt: (l.framesExt||[]).map((arr)=>[...arr])
    })),
    selectedLayerId
  });

  const applyProject = (p) => {
    if (!p) return;
    const meta = p.meta || {};
    const fc = meta.framesCount || p.framesCount || 1;
    setFramesCount(fc);
    setFps(meta.fps || p.fps || 4);
    const restored = (p.layers || []).map((l) => ({
      id: l.id || `${l.name}-${Math.random().toString(36).slice(2)}`,
      name: l.name || "Layer",
      kind: l.kind || "draw",
      visible: l.visible !== false,
      offsets: Array.isArray(l.offsets) ? l.offsets.slice(0, fc) : Array.from({length: fc},()=>({x:0,y:0})),
      keyframes: Array.isArray(l.keyframes) ? l.keyframes : [],
      frames: (l.frames||[]).slice(0, fc).map((g)=>g.map((row)=>row.map((v)=>!!v))),
      framesExt: (l.framesExt||[]).slice(0, fc).map((arr)=>Array.isArray(arr)?[...arr]:[])
    }));
    setLayers(restored);
    setSelectedLayerId(p.selectedLayerId || restored[0]?.id || null);
    setCurrent(0);
  };

  const saveFile = async (name, blob, mime = 'application/octet-stream') => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 0);
  };

  const exportProjectJSON = async () => {
    try {
      const data = JSON.stringify(serializeProject());
      await saveFile('project.ledproj', new Blob([data], { type: 'application/json' }), 'application/json');
    } catch {}
  };

  const onUploadProject = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const name = (f.name || "").toLowerCase();
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";

    const r = new FileReader();
    r.onload = () => {
      const raw = String(r.result || "");

      const looksLikeHeader = (s) =>
        /led_anim\s*\[/.test(s) &&
        /#define\s+LED_W/.test(s) &&
        /#define\s+LED_H/.test(s);

      try {
        if (ext === "h") {
          importFromHeaderRaw(raw);
        } else if (ext === "json" || ext === "ledproj") {
          const data = JSON.parse(raw);

          if (data && (Array.isArray(data.layers) || data.schema === 1)) {
            applyProject(data);
          } else if (data && Array.isArray(data.frames) && Number.isFinite(data.width) && Number.isFinite(data.height)) {
            const W = Math.max(1, Math.floor(data.width));
            const H = Math.max(1, Math.floor(data.height));
            const FC = Math.max(1, Math.floor(data.framesCount || data.frames.length));

            const toGrid = (bytes) => {
              const g = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => false));
              let bitIndex = 0;
              for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                  const bi = bitIndex >> 3, bo = bitIndex & 7;
                  const b = bytes[bi] ?? 0;
                  const on = (b >> bo) & 1;
                  if (x < WIDTH && y < HEIGHT) g[y][x] = !!on;
                  bitIndex++;
                  if (bi >= bytes.length) break;
                }
              }
              return g;
            };

            setFramesCount(FC);
            const L = mkLayer("Imported Draw", "draw");
            L.frames = makeFrames(FC);
            for (let fidx = 0; fidx < FC; fidx++) {
              const b = data.frames[fidx] || [];
              L.frames[fidx] = toGrid(b);
            }
            setLayers([L, mkLayer("Text Layer", "text"), mkLayer("Number Layer", "number")]);
            setSelectedLayerId(L.id);
            setCurrent(0);
            setFps(Math.max(1, Math.floor(data.fps || fps)));
          }
        } else {
          // Unknown extension: sniff content
          if (looksLikeHeader(raw)) {
            importFromHeaderRaw(raw);
          } else {
            const data = JSON.parse(raw);
            applyProject(data);
          }
        }
      } catch {
        // optional: alert("Import failed (unsupported or corrupted file).");
      }
    };

    r.readAsText(f);
    e.target.value = "";
  };

  // Export current frame as PNG
  const exportImage = async () => {
    try {
      // Dot matrix style: add spacing between pixels
      const scale = 10; // pixel size
      const spacing = 3; // space between dots
      const dot = scale - spacing;
      const imgW = WIDTH * scale;
      const imgH = HEIGHT * scale;
      const canvas = document.createElement('canvas');
      canvas.width = imgW;
      canvas.height = imgH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#555';
      ctx.fillRect(0, 0, imgW, imgH);
      const frame = mergeFrame(current);
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          // Draw all dots: grey for off, white for on
          ctx.beginPath();
          ctx.arc(x * scale + scale / 2, y * scale + scale / 2, dot / 2, 0, 2 * Math.PI);
          ctx.fillStyle = frame[y][x] ? '#fff' : '#222';
          ctx.fill();
        }
      }
      // Export as PNG (synchronous, to avoid save dialog)
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = `frame_${current}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {}
  };
  const exportHeader = () => {
    const frames = [];
    for (let f=0; f<framesCount; f++) frames.push(packFrameToWords(mergeFrame(f)));
    const body = frames
      .map((frame) => '{' + Array.from(frame).map((v) => '0x' + v.toString(16)).join(', ') + '}')
      .join(',\n  ');
    const header =
`#pragma once
#include <stdint.h>
#include <avr/pgmspace.h>
#define LED_W ${WIDTH}
#define LED_H ${HEIGHT}
#define LED_FRAMES ${framesCount}
#define LED_FPS ${fps}
const uint32_t led_anim[LED_FRAMES][${HEIGHT}] PROGMEM = {
  ${body}
};`;
    const blob = new Blob([header], { type: 'text/x-c' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'led_animation.h';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const [showTextModal, setShowTextModal] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [showNumberModal, setShowNumberModal] = useState(false);
  const [numberDraft, setNumberDraft] = useState("0");

  // Export the entire animation as an animated GIF
  const exportGif = async () => {
    function makeGif() {
      const scale = 10;
      const spacing = 3;
      const dot = scale - spacing;
      const imgW = WIDTH * scale;
      const imgH = HEIGHT * scale;
      const gif = new window.GIF({
        workers: 2,
        quality: 10,
        width: imgW,
        height: imgH,
        workerScript: 'gif/gif.worker.js', // You may need to provide this file
      });
      for (let f = 0; f < framesCount; f++) {
        const frame = mergeFrame(f);
        const canvas = document.createElement('canvas');
        canvas.width = imgW;
        canvas.height = imgH;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, imgW, imgH);
        for (let y = 0; y < HEIGHT; y++) {
          for (let x = 0; x < WIDTH; x++) {
            ctx.beginPath();
            ctx.arc(x * scale + scale / 2, y * scale + scale / 2, dot / 2, 0, 2 * Math.PI);
            ctx.fillStyle = frame[y][x] ? '#fff' : '#888';
            ctx.fill();
          }
        }
        gif.addFrame(canvas, {copy: true, delay: 1000 / Math.max(1, fps)});
      }
      gif.on('finished', function(blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'animation.gif'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      });
      gif.render();
    }
    if (!window.GIF) {
      const script = document.createElement('script');
      script.src = 'gif/gif.js';
      script.onload = makeGif;
      document.body.appendChild(script);
    } else {
      makeGif();
    }
  };

  return (
    <div className="container" onContextMenu={(e)=>e.preventDefault()}
         onPointerUp={() => { isDownRef.current=false; drawStateRef.current=null; }}>
      <div className="app">
        <div className="title">LED ANIMATION CREATOR</div>

        <div style={{ width: gridPx, margin: "0 0 16px" }}>
          <div style={{ display:"flex", gap:16, alignItems:"end", flexWrap:"wrap" }}>
            <div style={{ flex:1, minWidth:220, maxWidth:360 }}>
              <div style={{ fontSize:15, marginBottom:8 }}>Length</div>
              <input className="input" value={framesCount}
                onChange={(e)=>{ const v=parseInt(e.target.value||""); setFramesCount(Number.isFinite(v)&&v>0?v:8); }} />
            </div>
            <div style={{ flex:1, minWidth:220, maxWidth:360 }}>
              <div style={{ fontSize:15, marginBottom:8 }}>FPS</div>
              <input className="input" value={fps}
                onChange={(e)=>{ const v=parseInt(e.target.value||""); setFps(Number.isFinite(v)&&v>0?v:4); }} />
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:'center' }}>
              <button className="btn" onClick={exportProjectJSON}>Export Project</button>
              <button className="btn" onClick={()=>fileInputRef.current?.click()}>Import</button>
<input
  ref={fileInputRef}
  type="file"
  style={{display:'none'}}
  accept="application/json,.json,.ledproj,.h,text/plain,text/x-c"
  onChange={onUploadProject}
/>

              <button className="btn" onClick={exportHeader}>Export .h</button>
              <button className="btn" onClick={() => exportImage('png')}>Export PNG</button>
              <button className="btn" onClick={exportGif}>Export GIF</button>
              <button className="btn" onClick={()=>{
                try {
                  const frames=[];
                  for (let f=0; f<framesCount; f++){
                    frames.push(Array.from(packFrameToBytes(mergeFrame(f))));
                  }
                  const json=JSON.stringify({ width: WIDTH, height: HEIGHT, fps, framesCount, bytesPerFrame: Math.ceil((WIDTH*HEIGHT)/8), frames });
                  const blob=new Blob([json],{type:'application/json'});
                  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='frames.json'; a.click();
                  setTimeout(()=>URL.revokeObjectURL(url),0);
                } catch {}
              }}>Export Frames JSON</button>
            </div>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"3fr 1fr", gap:24 }}>
          <div>
            <div style={{ width: gridPx, margin:"0 0 8px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                {getLayer(selectedLayerId)?.kind === 'draw' &&
                  <button className="btn active">Draw</button>}
                {getLayer(selectedLayerId)?.kind === 'text' &&
                  <button className="btn" onClick={()=>setShowTextModal(true)}>Text</button>}
                {getLayer(selectedLayerId)?.kind === 'number' &&
                  <button className="btn" onClick={()=>setShowNumberModal(true)}>Number</button>}
                <span style={{marginLeft:16, opacity:.8}}>Move</span>
                <button className="btn icon" title="Up" onClick={()=>nudgeSelected(0,-1)}>↑</button>
                <button className="btn icon" title="Down" onClick={()=>nudgeSelected(0,1)}>↓</button>
                <button className="btn icon" title="Left" onClick={()=>nudgeSelected(-1,0)}>←</button>
                <button className="btn icon" title="Right" onClick={()=>nudgeSelected(1,0)}>→</button>
              </div>
              <button className="btn" title="Clear Frame"
                onClick={()=>setLayers((prev)=>prev.map((l)=>({
                  ...l,
                  frames: l.frames.map((g,i)=>(i===current? emptyGrid(): g)),
                  framesExt: (l.framesExt||[]).map((arr,i)=>(i===current?[]:arr))
                })))}
              ><Icon.Clear /> Clear</button>
            </div>

            <div style={{ width: gridPx }}>
              <div
                ref={gridRef}
                className="grid"
                style={{ gridTemplateColumns:`repeat(${WIDTH}, ${CELL}px)`, gridAutoRows:`${CELL}px`, gap:GAP }}
                onPointerMove={onGridMove}
                onPointerLeave={()=>{ isDownRef.current=false; drawStateRef.current=null; }}
              >
                {mergeFrame(current).flat().map((on,i)=>(
                  <div
                    key={i}
                    onPointerDown={(e)=>onCellDown(i,e)}
                    onPointerEnter={()=>{
                      if (!isDownRef.current) return;
                      const y=Math.floor(i/WIDTH), x=i%WIDTH;
                      const L=getLayer(selectedLayerId); if (!L) return;
                      paintAtGlobal(L.id, x, y, (drawStateRef.current ?? true));
                    }}
                    style={{
                      width: CELL, height: CELL, borderRadius: CELL/2,
                      background: on ? "#fff" : "rgba(0,0,0,.2)"
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={{ width: gridPx, margin:"16px 0 0", display:"flex", alignItems:"center", gap:8 }}>
              <button className="btn icon" title="Stop" onClick={()=>{ setCurrent(0); setPlaying(false); }}>
                <Icon.Stop />
              </button>
              <button className="btn" title={playing?"Pause":"Play"} onClick={()=>setPlaying((p)=>!p)}>
                {playing ? <Icon.Pause/> : <Icon.Play/>}
              </button>
              <button className="btn icon" title="Add Keyframe" onClick={addKeyframe}><Icon.Diamond/></button>
              <button className="btn icon" title="Prev Frame" onClick={()=>setCurrent((c)=>Math.max(0,c-1))}><Icon.Left/></button>
              <button className="btn icon" title="Next Frame" onClick={()=>setCurrent((c)=>Math.min(framesCount-1,c+1))}><Icon.Right/></button>
              <button className="btn icon" title="Copy Frame" onClick={copyFrame}><Icon.Copy/></button>
              <button className="btn icon" title="Paste Frame" onClick={pasteFrame}><Icon.Paste/></button>
              <button className="btn icon" title="Duplicate → Next" onClick={duplicateToNext}><Icon.Duplicate/></button>
              <button className="btn icon" title="Delete Current Frame" onClick={deleteCurrentFrame}><Icon.Clear/></button>
              <div style={{ marginLeft:"auto", fontSize:28, fontWeight:700, color:"#fff" }}>{current}</div>
            </div>

            <div style={{ width: gridPx, margin:"16px 0 0" }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:15, marginBottom:8 }}>
                <span>Keyframes</span>
                <div style={{ display:"flex", gap:24 }}>
                  <span>0</span><span style={{ color:"#fff" }}>{framesCount}</span>
                </div>
              </div>
              <div
                className="timeline"
                onPointerDown={(e)=>{
                  const rect=e.currentTarget.getBoundingClientRect();
                  const t=Math.min(1,Math.max(0,(e.clientX-rect.left)/rect.width));
                  setCurrent(Math.round(t*(framesCount-1)));
                }}
                onPointerMove={(e)=>{
                  if (e.buttons===1){
                    const rect=e.currentTarget.getBoundingClientRect();
                    const t=Math.min(1,Math.max(0,(e.clientX-rect.left)/rect.width));
                    setCurrent(Math.round(t*(framesCount-1)));
                  }
                }}
              >
                {kfs(getLayer(selectedLayerId)).map(({f})=>{
                  const left=(f/(framesCount-1))*100;
                  return (
                    <div key={`${getLayer(selectedLayerId)?.id||"none"}-${f}`}
                         className="kf"
                         style={{ left:`${left}%` }}
                         onClick={(e)=>{ e.stopPropagation(); setCurrent(f); }}
                         onContextMenu={(e)=>{ e.preventDefault(); const L=getLayer(selectedLayerId); if (L) removeKF(L.id,f); }}
                    />
                  );
                })}
                <div className="playhead" style={{ left:`${(current/Math.max(1,framesCount-1))*100}%` }} />
              </div>
              <div style={{ textAlign:"center", marginTop:8, fontSize:15, color:"#fff" }}>{current}</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize:16, fontWeight:600, marginBottom:8, color:"#fff" }}>Scene</div>
            <div className="scene">
              {layers.map((l)=>(
                <div key={l.id}
                     className={`scene-row ${selectedLayerId===l.id?"selected":""}`}
                     onClick={()=>setSelectedLayerId(l.id)}>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <span style={{ fontWeight:700, textTransform:"capitalize" }}>{l.name}</span>
                    <span style={{ fontSize:12, letterSpacing:".08em", opacity:.7 }}>{l.kind}</span>
                  </div>
                  <div className="scene-actions">
                    <button className="btn icon" title={l.visible?"Hide":"Show"}
                      onClick={(e)=>{ e.stopPropagation(); setLayers((v)=>v.map((x)=>x.id===l.id?{...x,visible:!x.visible}:x)); }}>
                      {l.visible ? "👁" : "🙈"}
                    </button>
                    <button className="btn icon" title="Delete Layer"
                      onClick={(e)=>{ e.stopPropagation(); setLayers((v)=>v.filter((x)=>x.id!==l.id)); }}>
                      🗑
                    </button>


                  </div>
                </div>
              ))}
              <button className="btn" onClick={()=>{
                const name = prompt('Layer name');
                if (!name) return;
                const kindSel = prompt('Type: draw | text | number','draw');
                const kind = (kindSel==='text'||kindSel==='number')?kindSel:'draw';
                const L = mkLayer(name, kind);
                setLayers((p)=>[...p, L]);
                setSelectedLayerId(L.id);
              }}>Add Layer</button>

              {getLayer(selectedLayerId)?.kind==='text' &&
                <button className="btn" onClick={()=>setShowTextModal(true)}>Add Text</button>}
              {getLayer(selectedLayerId)?.kind==='number' &&
                <button className="btn" onClick={()=>setShowNumberModal(true)}>Add Number</button>}
            </div>
          </div>
        </div>
      </div>

      {showTextModal && (
        <div className="modal-backdrop" onClick={()=>setShowTextModal(false)}>
          <div className="modal" onClick={(e)=>e.stopPropagation()}>
            <div style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>Add Text</div>
            <input className="input" autoFocus value={textDraft} onChange={(e)=>setTextDraft(e.target.value)} />
            <div className="row">
              <button className="btn" onClick={()=>setShowTextModal(false)}>Cancel</button>
              <button className="btn" onClick={()=>{
                applyText(textDraft||""); setTextDraft(""); setShowTextModal(false);
              }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {showNumberModal && (
        <div className="modal-backdrop" onClick={()=>setShowNumberModal(false)}>
          <div className="modal" style={{ maxWidth:360 }} onClick={(e)=>e.stopPropagation()}>
            <div style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>Add Number (0–9)</div>
            <input className="input" autoFocus value={numberDraft}
              onChange={(e)=>setNumberDraft((e.target.value||"").replace(/[^0-9]/g,"").slice(0,1))} />
            <div className="row">
              <button className="btn" onClick={()=>setShowNumberModal(false)}>Cancel</button>
              <button className="btn" onClick={()=>{ stampNumber(numberDraft); setShowNumberModal(false); }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.App = App;
