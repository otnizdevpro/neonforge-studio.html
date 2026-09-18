/* =========================================================
   NEONFORGE STUDIO — interface & logique projet
   ========================================================= */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = NF.clamp;
  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  const uid = () => Math.random().toString(36).slice(2, 9);

  /* ---------------- modèle ---------------- */
  const DRUM_DEFS = [
    ["kick", "Kick", "Kick"],
    ["snare", "Snare", "Snare"],
    ["clap", "Clap", "Clap"],
    ["hatC", "Hat Closed", "HatC"],
    ["hatO", "Hat Open", "HatO"],
    ["tom", "Tom", "Tom"],
    ["rim", "Rim", "Rim"],
    ["crash", "Crash", "Crash"],
  ];

  function emptyRow(steps) {
    return Array.from({ length: steps }, () => ({ on: false, vel: 0.85 }));
  }
  function newPattern(name, steps, drums) {
    const p = { id: uid(), name: name, steps: steps || 16, drum: {}, notes: [] };
    drums.forEach((d) => (p.drum[d.id] = emptyRow(p.steps)));
    return p;
  }

  function defaultProject() {
    const drums = DRUM_DEFS.map((d) => ({
      id: d[0],
      name: d[1],
      kind: d[0],
      sample: d[2],
      mode: "synth",
      vol: 0.9,
      pan: 0,
      pitch: 0,
      tune: 1,
      decay: 1,
      mute: false,
      solo: false,
    }));
    const proj = {
      version: 1,
      app: "NeonForge Studio",
      name: "Nouveau projet",
      bpm: 128,
      metronome: false,
      drums: drums,
      patterns: [],
      arrangement: [],
      synth: {
        volume: 0.75,
        transpose: 0,
        glide: 0,
        oscs: [
          { on: true, wave: "sawtooth", octave: 0, detune: 0, level: 0.8, pan: -0.15, unison: 3, spread: 0.35 },
          { on: true, wave: "square", octave: -1, detune: 7, level: 0.55, pan: 0.15, unison: 2, spread: 0.25 },
          { on: true, wave: "triangle", octave: 1, detune: -5, level: 0.3, pan: 0, unison: 1, spread: 0 },
        ],
        filterType: "lowpass",
        cutoff: 2600,
        reso: 7,
        fenvAmount: 0.45,
        fa: 0.01,
        fd: 0.35,
        fs: 0.25,
        a: 0.01,
        d: 0.25,
        s: 0.6,
        r: 0.35,
        lfoWave: "sine",
        lfoRate: 5,
        lfoAmount: 0,
        lfoTarget: "filter",
      },
      fx: {
        drive: 0.15,
        chorus: 0.25,
        delay: 0.2,
        delayDiv: 0.75,
        delayFb: 0.32,
        reverb: 0.22,
        reverbSize: 0.4,
        compThreshold: -16,
        compRatio: 4,
      },
      mixer: { master: 0.85, synth: { vol: 0.8, pan: 0, mute: false, solo: false } },
    };
    proj.patterns = [newPattern("Motif 1", 16, drums)];
    proj.arrangement = [];
    return proj;
  }

  let project = defaultProject();
  let curPattern = 0;
  let transport = null;
  let dirty = false;
  let loadedFromFile = false;


  const pat = () => project.patterns[curPattern];

  /* ---------------- knobs ---------------- */
  function knob(parent, opt) {
    const wrap = el("div", "knob " + (opt.color || ""));
    const dial = el("div", "dial");
    const ind = el("i");
    dial.appendChild(ind);
    const lab = el("label", "", opt.label);
    const val = el("div", "v");
    wrap.append(dial, val, lab);
    parent.appendChild(wrap);
    const min = opt.min,
      max = opt.max;
    let v = opt.get();
    const fmt = opt.fmt || ((x) => (Math.abs(x) < 10 ? x.toFixed(2) : Math.round(x)));
    function paint() {
      const n = (v - min) / (max - min);
      dial.style.setProperty("--p", n * 0.75 + "turn");
      ind.style.transform = "rotate(" + (-135 + n * 270) + "deg)";
      val.textContent = fmt(v);
    }
    function set(nv) {
      v = clamp(nv, min, max);
      opt.set(v);
      paint();
      touch();
    }
    paint();
    let sy = 0,
      sv = 0;
    dial.addEventListener("pointerdown", (e) => {
      dial.setPointerCapture(e.pointerId);
      sy = e.clientY;
      sv = v;
      e.preventDefault();
    });
    dial.addEventListener("pointermove", (e) => {
      if (!dial.hasPointerCapture(e.pointerId)) return;
      const range = max - min;
      set(sv + ((sy - e.clientY) / 170) * range * (e.shiftKey ? 0.2 : 1));
    });
    dial.addEventListener("dblclick", () => set(opt.def !== undefined ? opt.def : (min + max) / 2));
    dial.addEventListener("wheel", (e) => {
      e.preventDefault();
      set(v + (e.deltaY < 0 ? 1 : -1) * (max - min) * 0.02);
    }, { passive: false });
    return { refresh: () => ((v = opt.get()), paint()) };
  }

  function touch() {
    dirty = true;
    if (transport) transport.syncParams();
  }

  /* ---------------- ondes ---------------- */
  const WAVE_PATHS = {
    sine: "M1 6 C4 -2 7 14 10 6 C13 -2 16 14 19 6",
    square: "M1 10 L1 2 L7 2 L7 10 L13 10 L13 2 L19 2",
    sawtooth: "M1 10 L7 2 L7 10 L13 2 L13 10 L19 2",
    triangle: "M1 10 L5 2 L10 10 L15 2 L19 10",
    noise: "M1 6 L3 2 L5 9 L7 3 L9 10 L11 4 L13 8 L15 2 L17 9 L19 5",
  };
  function waveBtn(w, active) {
    const b = el("button", active ? "on" : "");
    b.title = w;
    b.innerHTML = '<svg viewBox="0 0 20 12"><path d="' + WAVE_PATHS[w] + '"/></svg>';
    return b;
  }

  /* ---------------- panneau synthé ---------------- */
  function buildSynth() {
    const host = $("#synthBody");
    host.innerHTML = "";
    const s = project.synth;
    s.oscs.forEach((o, i) => {
      const box = el("div", "osc" + (o.on ? "" : " off"));
      const head = el("div", "oh");
      const sw = el("div", "sw" + (o.on ? " on" : ""));
      sw.onclick = () => {
        o.on = !o.on;
        touch();
        buildSynth();
      };
      head.append(sw, el("b", "", "OSC " + (i + 1)));
      box.appendChild(head);
      const waves = el("div", "waves");
      ["sine", "triangle", "sawtooth", "square", "noise"].forEach((w) => {
        const b = waveBtn(w, o.wave === w);
        b.onclick = () => {
          o.wave = w;
          touch();
          buildSynth();
        };
        waves.appendChild(b);
      });
      box.appendChild(waves);
      const k = el("div", "knobs");
      knob(k, { label: "Oct", min: -3, max: 3, def: 0, get: () => o.octave, set: (v) => (o.octave = Math.round(v)), fmt: (v) => Math.round(v) });
      knob(k, { label: "Detune", min: -50, max: 50, def: 0, get: () => o.detune, set: (v) => (o.detune = v), fmt: (v) => Math.round(v) });
      knob(k, { label: "Niveau", min: 0, max: 1, def: 0.8, get: () => o.level, set: (v) => (o.level = v), fmt: (v) => Math.round(v * 100) });
      knob(k, { label: "Pan", min: -1, max: 1, def: 0, color: "mg", get: () => o.pan, set: (v) => (o.pan = v), fmt: (v) => (v === 0 ? "C" : (v > 0 ? "R" : "L") + Math.round(Math.abs(v) * 100)) });
      knob(k, { label: "Unison", min: 1, max: 7, def: 1, color: "lm", get: () => o.unison, set: (v) => (o.unison = Math.round(v)), fmt: (v) => Math.round(v) });
      knob(k, { label: "Spread", min: 0, max: 1, def: 0.3, color: "lm", get: () => o.spread, set: (v) => (o.spread = v), fmt: (v) => Math.round(v * 100) });
      knob(k, { label: "Glide", min: 0, max: 0.4, def: 0, get: () => s.glide, set: (v) => (s.glide = v), fmt: (v) => v.toFixed(2) });
      knob(k, { label: "Transp", min: -24, max: 24, def: 0, get: () => s.transpose, set: (v) => (s.transpose = Math.round(v)), fmt: (v) => Math.round(v) });
      box.appendChild(k);
      host.appendChild(box);
    });
  }

  function buildFilter() {
    const host = $("#filterBody");
    host.innerHTML = "";
    const s = project.synth;
    const sel = el("select");
    [["lowpass", "Passe-bas"], ["highpass", "Passe-haut"], ["bandpass", "Passe-bande"], ["notch", "Notch"]].forEach((t) => {
      const o = el("option", "", t[1]);
      o.value = t[0];
      if (s.filterType === t[0]) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => {
      s.filterType = sel.value;
      touch();
    };
    host.appendChild(sel);
    const k = el("div", "knobs");
    k.style.marginTop = "8px";
    knob(k, { label: "Cutoff", min: 60, max: 16000, def: 2600, get: () => s.cutoff, set: (v) => (s.cutoff = v), fmt: (v) => (v > 999 ? (v / 1000).toFixed(1) + "k" : Math.round(v)) });
    knob(k, { label: "Réso", min: 0.1, max: 24, def: 7, get: () => s.reso, set: (v) => (s.reso = v), fmt: (v) => v.toFixed(1) });
    knob(k, { label: "Env→F", min: 0, max: 1, def: 0.45, color: "mg", get: () => s.fenvAmount, set: (v) => (s.fenvAmount = v), fmt: (v) => Math.round(v * 100) });
    knob(k, { label: "F.Décl", min: 0.01, max: 2, def: 0.35, color: "mg", get: () => s.fd, set: (v) => (s.fd = v), fmt: (v) => v.toFixed(2) });
    host.appendChild(k);
    const k2 = el("div", "knobs");
    k2.style.marginTop = "6px";
    knob(k2, { label: "Attack", min: 0.001, max: 2, def: 0.01, color: "lm", get: () => s.a, set: (v) => (s.a = v), fmt: (v) => v.toFixed(3) });
    knob(k2, { label: "Decay", min: 0.01, max: 3, def: 0.25, color: "lm", get: () => s.d, set: (v) => (s.d = v), fmt: (v) => v.toFixed(2) });
    knob(k2, { label: "Sustain", min: 0, max: 1, def: 0.6, color: "lm", get: () => s.s, set: (v) => (s.s = v), fmt: (v) => Math.round(v * 100) });
    knob(k2, { label: "Release", min: 0.02, max: 4, def: 0.35, color: "lm", get: () => s.r, set: (v) => (s.r = v), fmt: (v) => v.toFixed(2) });
    host.appendChild(k2);
    const row = el("div", "row");
    row.style.margin = "10px 0 0";
    const lsel = el("select");
    [["pitch", "LFO → Hauteur"], ["filter", "LFO → Filtre"], ["volume", "LFO → Volume"]].forEach((t) => {
      const o = el("option", "", t[1]);
      o.value = t[0];
      if (s.lfoTarget === t[0]) o.selected = true;
      lsel.appendChild(o);
    });
    lsel.onchange = () => {
      s.lfoTarget = lsel.value;
      touch();
    };
    row.appendChild(lsel);
    host.appendChild(row);
    const k3 = el("div", "knobs k3");
    k3.style.marginTop = "6px";
    knob(k3, { label: "LFO Rate", min: 0.1, max: 20, def: 5, get: () => s.lfoRate, set: (v) => (s.lfoRate = v), fmt: (v) => v.toFixed(1) });
    knob(k3, { label: "LFO Amt", min: 0, max: 1, def: 0, get: () => s.lfoAmount, set: (v) => (s.lfoAmount = v), fmt: (v) => Math.round(v * 100) });
    knob(k3, { label: "Volume", min: 0, max: 1, def: 0.75, get: () => s.volume, set: (v) => (s.volume = v), fmt: (v) => Math.round(v * 100) });
    host.appendChild(k3);
  }

  function buildFx() {
    const host = $("#fxBody");
    host.innerHTML = "";
    const f = project.fx;
    const k = el("div", "knobs");
    knob(k, { label: "Drive", min: 0, max: 1, def: 0.15, color: "mg", get: () => f.drive, set: (v) => (f.drive = v), fmt: (v) => Math.round(v * 100) });
    knob(k, { label: "Chorus", min: 0, max: 1, def: 0.25, color: "mg", get: () => f.chorus, set: (v) => (f.chorus = v), fmt: (v) => Math.round(v * 100) });
    knob(k, { label: "Delay", min: 0, max: 0.8, def: 0.2, get: () => f.delay, set: (v) => (f.delay = v), fmt: (v) => Math.round(v * 125) });
    knob(k, { label: "Feedback", min: 0, max: 0.85, def: 0.32, get: () => f.delayFb, set: (v) => (f.delayFb = v), fmt: (v) => Math.round(v * 100) });
    knob(k, { label: "Réverbe", min: 0, max: 1, def: 0.22, color: "lm", get: () => f.reverb, set: (v) => (f.reverb = v), fmt: (v) => Math.round(v * 100) });
    knob(k, { label: "Taille", min: 0, max: 1, def: 0.4, color: "lm", get: () => f.reverbSize, set: (v) => (f.reverbSize = v), fmt: (v) => Math.round(v * 100) });
    knob(k, { label: "Comp", min: -60, max: 0, def: -16, get: () => f.compThreshold, set: (v) => (f.compThreshold = v), fmt: (v) => Math.round(v) });
    knob(k, { label: "Ratio", min: 1, max: 20, def: 4, get: () => f.compRatio, set: (v) => (f.compRatio = v), fmt: (v) => Math.round(v) });
    host.appendChild(k);
    const note = el("div", "hint", "Le delay suit le tempo. Double-clic sur un bouton = valeur par défaut.");
    note.style.marginTop = "8px";
    host.appendChild(note);
  }

  /* ---------------- step sequencer / timeline ---------------- */
  let SW = 26;
  const NAMEW = 132;
  function stepX(i) {
    return NAMEW + i * (SW + 3);
  }
  function buildSeq() {
    const host = $("#seqBody");
    host.innerHTML = "";
    host.style.setProperty("--sw", SW + "px");
    const p = pat();
    const tl = el("div", "seqtl");
    tl.style.width = stepX(p.steps) + "px";
    tl.style.minWidth = "100%";
    host.appendChild(tl);
    const info = $("#tlInfo");
    if (info) info.textContent = p.steps / 4 + " mesures · " + p.steps + " pas · " + project.bpm + " BPM";
    const ruler = el("div", "ruler");
    for (let i = 0; i < p.steps; i++) {
      const isBar = i % 16 === 0,
        isBeat = i % 4 === 0;
      const d = el("div", isBar ? "bar" : isBeat ? "b" : "", isBar ? String(i / 16 + 1) : isBeat ? String((i % 16) / 4 + 1) : "·");
      d.title = "Aller au pas " + (i + 1);
      d.onclick = () => {
        if (transport.seek) transport.seek(i);
        moveSeqPlayhead(i);
      };
      ruler.appendChild(d);
    }
    tl.appendChild(ruler);
    const ph = el("div", "seqph");
    ph.id = "seqPlayhead";
    tl.appendChild(ph);
    project.drums.forEach((d) => {

      const row = el("div", "seqrow");
      row.dataset.drum = d.id;
      const nm = el("div", "seqname");
      const name = el("div", "nm", d.name);
      name.onclick = () => {
        transport.previewDrum(d);
        selectDrum(d.id);
      };
      const m = el("button", "mini" + (d.mute ? " on" : ""), "M");
      m.onclick = () => {
        d.mute = !d.mute;
        touch();
        buildSeq();
        buildMixer();
      };
      const s = el("button", "mini s" + (d.solo ? " on" : ""), "S");
      s.onclick = () => {
        d.solo = !d.solo;
        touch();
        buildSeq();
        buildMixer();
      };
      nm.append(name, m, s);
      row.appendChild(nm);
      const steps = el("div", "steps");
      const cls = (i, cell) =>
        "step" + (i % 16 === 0 ? " bar" : "") + (i % 4 === 0 ? " beat" : "") + (cell.on ? " on" : "") + (cell.on && cell.vel > 0.95 ? " acc" : "");
      for (let i = 0; i < p.steps; i++) {
        const cell = p.drum[d.id][i];
        const b = el("button", cls(i, cell));
        b.dataset.i = i;
        b.onclick = (e) => {
          if (e.shiftKey && cell.on) cell.vel = cell.vel > 0.95 ? 0.85 : 1;
          else {
            cell.on = !cell.on;
            if (cell.on) transport.previewDrum(d);
          }
          touch();
          b.className = cls(i, cell);
        };
        b.onpointerenter = (e) => {
          if (e.buttons !== 1 || cell.on) return;
          cell.on = true;
          touch();
          b.className = cls(i, cell);
        };
        b.oncontextmenu = (e) => {
          e.preventDefault();
          cell.on = false;
          touch();
          b.className = cls(i, cell);
        };
        steps.appendChild(b);
      }
      row.appendChild(steps);
      tl.appendChild(row);
    });
  }
  function moveSeqPlayhead(i) {
    const ph = $("#seqPlayhead");
    if (!ph) return;
    ph.style.display = "block";
    ph.style.left = stepX(i) + "px";
  }

  let selectedDrum = "kick";
  function selectDrum(id) {
    selectedDrum = id;
    buildDrumEdit();
  }
  function buildDrumEdit() {
    const host = $("#drumBody");
    host.innerHTML = "";
    const d = project.drums.find((x) => x.id === selectedDrum);
    if (!d) return;
    const pads = el("div", "pads");
    project.drums.forEach((x) => {
      const b = el("button", "pad" + (x.id === selectedDrum ? " sel" : ""), x.name);
      b.onclick = () => {
        transport.previewDrum(x);
        b.classList.remove("hit");
        void b.offsetWidth;
        b.classList.add("hit");
        setTimeout(() => b.classList.remove("hit"), 160);
        selectDrum(x.id);
      };
      pads.appendChild(b);
    });
    host.appendChild(pads);
    const head = el("div", "row");
    head.style.marginBottom = "6px";
    const sel = el("select");
    project.drums.forEach((x) => {
      const o = el("option", "", x.name);
      o.value = x.id;
      if (x.id === d.id) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => selectDrum(sel.value);
    head.appendChild(sel);
    host.appendChild(head);
    const modes = el("div", "seg");
    [["synth", "SYNTHÉTISÉ"], ["sample", "ÉCHANTILLON"]].forEach((m) => {
      const b = el("button", d.mode === m[0] ? "on" : "", m[1]);
      b.onclick = () => {
        d.mode = m[0];
        touch();
        buildDrumEdit();
        transport.previewDrum(d);
      };
      modes.appendChild(b);
    });
    host.appendChild(modes);
    const k = el("div", "knobs");
    k.style.marginTop = "8px";
    knob(k, { label: "Tune", min: 0.4, max: 2, def: 1, get: () => d.tune, set: (v) => (d.tune = v), fmt: (v) => v.toFixed(2) });
    knob(k, { label: "Decay", min: 0.15, max: 2.5, def: 1, get: () => d.decay, set: (v) => (d.decay = v), fmt: (v) => v.toFixed(2) });
    knob(k, { label: "Pitch", min: -12, max: 12, def: 0, color: "mg", get: () => d.pitch, set: (v) => (d.pitch = Math.round(v)), fmt: (v) => Math.round(v) });
    knob(k, { label: "Volume", min: 0, max: 1.4, def: 0.9, color: "lm", get: () => d.vol, set: (v) => (d.vol = v), fmt: (v) => Math.round(v * 100) });
    host.appendChild(k);
    const play = el("button", "act", "▶ ÉCOUTER");
    play.style.marginTop = "10px";
    play.style.width = "100%";
    play.onclick = () => transport.previewDrum(d);
    host.appendChild(play);
  }

  /* ---------------- piano roll ---------------- */
  const LOW = 36,
    HIGH = 84,
    RH = 17,
    CW = 24;
  function buildRoll() {
    const keys = $("#rollKeys"),
      canvas = $("#rollCanvas");
    keys.innerHTML = "";
    canvas.innerHTML = '<div id="rollPlayhead"></div>';
    for (let m = HIGH; m >= LOW; m--) {
      const isBlk = [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
      const k = el("div", "pkey" + (isBlk ? " blk" : ""), NF.noteName(m));
      k.onclick = () => transport.preview(m);
      keys.appendChild(k);
    }
    const p = pat();
    canvas.style.height = (HIGH - LOW + 1) * RH + "px";
    canvas.style.width = p.steps * CW + "px";
    canvas.style.minWidth = "100%";
    (p.notes || []).forEach((n) => canvas.appendChild(noteEl(n)));
  }
  function noteEl(n) {
    const d = el("div", "note");
    d.style.left = n.step * CW + "px";
    d.style.top = (HIGH - n.midi) * RH + 1 + "px";
    d.style.width = n.len * CW - 2 + "px";
    d.style.opacity = 0.45 + n.vel * 0.55;
    d.appendChild(el("div", "rz"));
    d._n = n;
    return d;
  }
  function setupRoll() {
    const canvas = $("#rollCanvas");
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left,
        y = e.clientY - rect.top;
      const target = e.target.closest(".note");
      if (target) {
        const n = target._n;
        if (e.button === 2 || e.altKey) return;
        drag = {
          note: n,
          eln: target,
          mode: e.target.classList.contains("rz") ? "len" : "move",
          x0: x,
          step0: n.step,
          midi0: n.midi,
          len0: n.len,
        };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;
      const step = Math.floor(x / CW),
        midi = HIGH - Math.floor(y / RH);
      const n = { midi: midi, step: clamp(step, 0, pat().steps - 1), len: 2, vel: 0.9 };
      pat().notes.push(n);
      const d = noteEl(n);
      canvas.appendChild(d);
      transport.preview(midi);
      touch();
      drag = { note: n, eln: d, mode: "len", x0: x, step0: n.step, midi0: n.midi, len0: n.len };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left,
        y = e.clientY - rect.top;
      const n = drag.note;
      if (drag.mode === "len") {
        n.len = clamp(Math.round((x - n.step * CW) / CW), 1, pat().steps - n.step);
      } else {
        n.step = clamp(drag.step0 + Math.round((x - drag.x0) / CW), 0, pat().steps - n.len);
        const nm = clamp(HIGH - Math.floor(y / RH), LOW, HIGH);
        if (nm !== n.midi) {
          n.midi = nm;
          transport.preview(nm);
        }
      }
      drag.eln.style.left = n.step * CW + "px";
      drag.eln.style.top = (HIGH - n.midi) * RH + 1 + "px";
      drag.eln.style.width = n.len * CW - 2 + "px";
      touch();
    });
    const end = () => (drag = null);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("contextmenu", (e) => {
      const t = e.target.closest(".note");
      e.preventDefault();
      if (t) {
        pat().notes = pat().notes.filter((x) => x !== t._n);
        t.remove();
        touch();
      }
    });
    $("#rollScroll").addEventListener("scroll", (e) => {
      $("#rollKeys").scrollTop = e.target.scrollTop;
    });
  }

  /* ---------------- mixer ---------------- */
  let meters = {};
  function buildMixer() {
    const host = $("#mixBody");
    host.innerHTML = "";
    meters = {};
    function strip(title, obj, isSynth, drum) {
      const s = el("div", "strip");
      const sn = el("div", "sn");
      sn.appendChild(el("span", "", title));
      const btns = el("div");
      btns.style.display = "flex";
      btns.style.gap = "3px";
      const m = el("button", "mini" + (obj.mute ? " on" : ""), "M");
      m.onclick = () => {
        obj.mute = !obj.mute;
        touch();
        buildMixer();
        buildSeq();
      };
      const so = el("button", "mini s" + (obj.solo ? " on" : ""), "S");
      so.onclick = () => {
        obj.solo = !obj.solo;
        touch();
        buildMixer();
        buildSeq();
      };
      btns.append(m, so);
      sn.appendChild(btns);
      s.appendChild(sn);
      const f = el("input", "fader");
      f.type = "range";
      f.min = 0;
      f.max = 1.4;
      f.step = 0.01;
      f.value = obj.vol;
      f.oninput = () => {
        obj.vol = parseFloat(f.value);
        touch();
      };
      s.appendChild(f);
      const pn = el("input", "fader p");
      pn.type = "range";
      pn.min = -1;
      pn.max = 1;
      pn.step = 0.02;
      pn.value = obj.pan;
      pn.style.marginTop = "6px";
      pn.oninput = () => {
        obj.pan = parseFloat(pn.value);
        touch();
      };
      s.appendChild(pn);
      const mt = el("div", "meter");
      const mi = el("i");
      mt.appendChild(mi);
      s.appendChild(mt);
      meters[isSynth ? "synth" : drum.id] = mi;
      host.appendChild(s);
    }
    strip("SYNTH", project.mixer.synth, true);
    project.drums.forEach((d) => strip(d.name.toUpperCase(), d, false, d));
    const ms = el("div", "strip");
    ms.style.borderColor = "rgba(34,227,255,.5)";
    ms.appendChild(el("div", "sn", "MASTER"));
    const f = el("input", "fader");
    f.type = "range";
    f.min = 0;
    f.max = 1.2;
    f.step = 0.01;
    f.value = project.mixer.master;
    f.oninput = () => {
      project.mixer.master = parseFloat(f.value);
      touch();
    };
    ms.appendChild(f);
    host.appendChild(ms);
  }

  /* ---------------- arrangement ---------------- */
  function buildArr() {
    const host = $("#arrBody");
    host.innerHTML = "";
    for (let i = 0; i < 16; i++) {
      const pid = project.arrangement[i];
      const p = project.patterns.find((x) => x.id === pid);
      const s = el("div", "slot" + (p ? " f" : ""), p ? p.name : "+");
      s.onclick = () => {
        const idx = p ? project.patterns.findIndex((x) => x.id === pid) + 1 : 0;
        project.arrangement[i] = idx >= project.patterns.length ? null : project.patterns[idx].id;
        touch();
        buildArr();
      };
      s.oncontextmenu = (e) => {
        e.preventDefault();
        project.arrangement[i] = null;
        touch();
        buildArr();
      };
      host.appendChild(s);
    }
  }

  function selectPattern(i) {
    curPattern = clamp(i, 0, project.patterns.length - 1);
    transport.pattern = curPattern;
    buildSeq();
    buildRoll();
    buildPatternTabs();
  }
  function patCount(p) {
    let n = (p.notes || []).length;
    Object.keys(p.drum || {}).forEach((k) => (p.drum[k] || []).forEach((c) => c.on && n++));
    return n;
  }
  function renamePattern() {
    const p = pat();
    const n = prompt("Nom du pattern", p.name);
    if (!n) return;
    p.name = n;
    touch();
    buildPatternTabs();
    buildArr();
  }
  function duplicatePattern() {
    const src = pat();
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.name = src.name + " copie";
    project.patterns.splice(curPattern + 1, 0, copy);
    touch();
    selectPattern(curPattern + 1);
    buildArr();
    toast("Pattern dupliqué");
  }
  function deletePattern() {
    if (project.patterns.length <= 1) return toast("Il faut au moins un pattern");
    const p = pat();
    if (!confirm("Supprimer le pattern « " + p.name + " » ?")) return;
    project.patterns.splice(curPattern, 1);
    project.arrangement = project.arrangement.map((x) => (x === p.id ? null : x));
    touch();
    selectPattern(Math.min(curPattern, project.patterns.length - 1));
    buildArr();
    toast("Pattern supprimé");
  }
  function addPattern() {
    const p = newPattern("Pat " + (project.patterns.length + 1), pat().steps, project.drums);
    project.patterns.push(p);
    touch();
    selectPattern(project.patterns.length - 1);
    buildArr();
  }
  function movePattern(from, to) {
    if (to < 0 || to >= project.patterns.length) return;
    const [p] = project.patterns.splice(from, 1);
    project.patterns.splice(to, 0, p);
    touch();
    selectPattern(to);
    buildArr();
  }
  function buildPatternTabs() {
    const host = $("#patTabs");
    host.innerHTML = "";
    project.patterns.forEach((p, i) => {
      const b = el("button", "pt" + (i === curPattern ? " on" : ""));
      b.append(el("span", "", p.name), el("i", "", patCount(p) + " év."));
      b.draggable = true;
      b.title = "Clic = sélectionner · double-clic = renommer · glisser pour réordonner";
      b.onclick = () => selectPattern(i);
      b.ondblclick = () => {
        selectPattern(i);
        renamePattern();
      };
      b.ondragstart = (e) => e.dataTransfer.setData("text/plain", String(i));
      b.ondragover = (e) => e.preventDefault();
      b.ondrop = (e) => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (!isNaN(from) && from !== i) movePattern(from, i);
      };
      host.appendChild(b);
    });
    const add = el("button", "pt", "+");
    add.title = "Nouveau pattern";
    add.onclick = addPattern;
    host.appendChild(add);
  }

  function setSteps(n) {
    const p = pat();
    project.drums.forEach((d) => {
      const row = p.drum[d.id] || [];
      while (row.length < n) row.push({ on: false, vel: 0.85 });
      p.drum[d.id] = row.slice(0, n);
    });
    p.notes = p.notes.filter((x) => x.step < n);
    p.steps = n;
    touch();
    buildSeq();
    buildRoll();
  }

  /* ---------------- projet : sauvegarde / chargement ---------------- */
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function saveProject() {
    const data = JSON.stringify(project, null, 1);
    download(new Blob([data], { type: "application/json" }), (project.name || "projet").replace(/\s+/g, "_") + ".kdaw");
    toast("Projet exporté en .kdaw");
  }
  function migrate(d) {
    if (!d || !d.patterns) throw new Error("Fichier invalide");
    const base = defaultProject();
    const p = Object.assign({}, base, d);
    p.synth = Object.assign({}, base.synth, d.synth || {});
    p.synth.oscs = (d.synth && d.synth.oscs ? d.synth.oscs : base.synth.oscs).map((o, i) =>
      Object.assign({}, base.synth.oscs[i] || base.synth.oscs[0], o)
    );
    p.fx = Object.assign({}, base.fx, d.fx || {});
    p.mixer = Object.assign({}, base.mixer, d.mixer || {});
    p.mixer.synth = Object.assign({}, base.mixer.synth, (d.mixer || {}).synth || {});
    p.drums = base.drums.map((bd) => Object.assign({}, bd, (d.drums || []).find((x) => x.id === bd.id) || {}));
    p.patterns = d.patterns.map((pp) => {
      const np = newPattern(pp.name || "Pat", pp.steps || 16, p.drums);
      np.id = pp.id || np.id;
      Object.keys(np.drum).forEach((k) => {
        const src = (pp.drum || {})[k] || [];
        for (let i = 0; i < np.steps; i++) if (src[i]) np.drum[k][i] = { on: !!src[i].on, vel: src[i].vel || 0.85 };
      });
      np.notes = (pp.notes || []).map((n) => ({ midi: n.midi, step: n.step, len: n.len || 1, vel: n.vel || 0.9 }));
      return np;
    });
    p.arrangement = (d.arrangement || []).map((x) => (p.patterns.some((y) => y.id === x) ? x : null));
    return p;
  }
  function loadProjectData(d) {
    const np = migrate(d);
    loadedFromFile = true;
    // muter l'objet existant : le moteur audio garde une référence dessus
    Object.keys(project).forEach((k) => delete project[k]);
    Object.assign(project, np);

    curPattern = 0;
    transport.stop();
    transport.rebuild();
    transport.pattern = 0;
    refreshAll();
    $("#bpmVal").textContent = project.bpm;
    $("#projName").value = project.name || "";
    toast("Projet chargé : " + (project.name || "sans nom"));
  }
  function openProject() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".kdaw,application/json";
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          loadProjectData(JSON.parse(r.result));
        } catch (e) {
          toast("Fichier illisible : " + e.message);
        }
      };
      r.readAsText(f);
    };
    inp.click();
  }
  function autosave() {
    try {
      localStorage.setItem("neonforge.autosave", JSON.stringify(project));
    } catch (e) {}
  }
  function restoreAutosave() {
    try {
      const raw = localStorage.getItem("neonforge.autosave");
      if (raw) project = migrate(JSON.parse(raw));
    } catch (e) {}
  }

  function refreshAll() {
    buildSynth();
    buildFilter();
    buildFx();
    buildSeq();
    buildRoll();
    buildMixer();
    buildArr();
    buildPatternTabs();
    buildDrumEdit();
  }

  /* ---------------- toast ---------------- */
  let tTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(tTimer);
    tTimer = setTimeout(() => t.classList.remove("on"), 2600);
  }

  /* ---------------- export audio ---------------- */
  function openExport() {
    $("#expOverlay").classList.add("on");
    $("#expIdle").style.display = "block";
    $("#expRun").style.display = "none";
    $("#expDone").style.display = "none";
  }
  function drawWaveProgress(buf, pct) {
    const c = $("#expCanvas"),
      ctx = c.getContext("2d");
    const w = (c.width = c.clientWidth * 2),
      h = (c.height = c.clientHeight * 2);
    ctx.clearRect(0, 0, w, h);
    const data = buf ? buf.getChannelData(0) : null;
    const cols = 220;
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "#22e3ff");
    g.addColorStop(1, "#ff3ea5");
    ctx.fillStyle = g;
    for (let i = 0; i < cols * pct; i++) {
      let amp = 0.25;
      if (data) {
        const st = Math.floor((i / cols) * data.length),
          en = Math.floor(((i + 1) / cols) * data.length);
        let mx = 0;
        for (let j = st; j < en; j += 7) mx = Math.max(mx, Math.abs(data[j]));
        amp = mx;
      } else {
        amp = 0.15 + Math.random() * 0.5;
      }
      const bw = w / cols;
      const bh = Math.max(2, amp * h * 0.92);
      ctx.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh);
    }
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * pct, 0);
    ctx.lineTo(w * pct, h);
    ctx.stroke();
  }
  function confetti() {
    const cv = $("#confetti");
    cv.style.display = "block";
    const ctx = cv.getContext("2d");
    const w = (cv.width = innerWidth),
      h = (cv.height = innerHeight);
    const cols = ["#22e3ff", "#ff3ea5", "#9dff3c", "#ffb03a", "#8b6bff", "#ffffff"];
    const parts = [];
    for (let i = 0; i < 180; i++)
      parts.push({
        x: w / 2 + (Math.random() - 0.5) * 260,
        y: h / 2 + (Math.random() - 0.5) * 90,
        vx: (Math.random() - 0.5) * 15,
        vy: -Math.random() * 15 - 3,
        s: 3 + Math.random() * 7,
        c: cols[(Math.random() * cols.length) | 0],
        r: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.4,
      });
    let f = 0;
    (function loop() {
      ctx.clearRect(0, 0, w, h);
      parts.forEach((p) => {
        p.vy += 0.42;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.globalAlpha = Math.max(0, 1 - f / 130);
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      });
      if (++f < 130) requestAnimationFrame(loop);
      else {
        ctx.clearRect(0, 0, w, h);
        cv.style.display = "none";
      }
    })();
  }
  function successChime() {
    try {
      const c = transport.ctx;
      const t0 = c.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = c.createOscillator(),
          g = c.createGain();
        o.type = "triangle";
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + i * 0.075);
        g.gain.linearRampToValueAtTime(0.16, t0 + i * 0.075 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.075 + 0.6);
        o.connect(g).connect(c.destination);
        o.start(t0 + i * 0.075);
        o.stop(t0 + i * 0.075 + 0.7);
      });
    } catch (e) {}
  }

  async function runExport() {
    const fmt = $("#expFormat").value;
    const loops = parseInt($("#expLoops").value, 10);
    const sr = parseInt($("#expRate").value, 10);
    const kbps = parseInt($("#expKbps").value, 10);
    $("#expIdle").style.display = "none";
    $("#expRun").style.display = "block";
    const bar = $("#expBar");
    const stat = $("#expStat");
    transport.stop();
    setPlayUI(false);
    let fake = 0;
    const anim = setInterval(() => {
      fake = Math.min(0.99, fake + 0.02);
      drawWaveProgress(null, fake);
    }, 60);
    stat.textContent = "RENDU DU MIX…";
    try {
      const buf = await NF.renderOffline(project, loops, sr, (p) => {
        bar.style.width = p * (fmt === "mp3" ? 55 : 82) + "%";
      });
      clearInterval(anim);
      // dessin progressif de la vraie forme d'onde
      for (let i = 0; i <= 1.001; i += 0.05) {
        drawWaveProgress(buf, i);
        await new Promise((r) => setTimeout(r, 16));
      }
      let blob, ext;
      if (fmt === "mp3") {
        stat.textContent = "ENCODAGE MP3 " + kbps + " kbps…";
        blob = await NF.encodeMp3(buf, kbps, (p) => {
          bar.style.width = 55 + p * 45 + "%";
        });
        ext = "mp3";
      } else {
        stat.textContent = "ÉCRITURE DU WAV…";
        blob = NF.encodeWav(buf);
        bar.style.width = "100%";
        ext = "wav";
      }
      bar.style.width = "100%";
      const name = (project.name || "neonforge").replace(/\s+/g, "_") + "." + ext;
      download(blob, name);
      $("#expRun").style.display = "none";
      $("#expDone").style.display = "block";
      $("#expDoneTxt").textContent =
        name + " — " + (blob.size / 1048576).toFixed(2) + " Mo · " + buf.duration.toFixed(1) + " s";
      confetti();
      successChime();
    } catch (e) {
      clearInterval(anim);
      stat.textContent = "Erreur : " + (e.message || e);
    }
  }

  /* ---------------- visualiseurs ---------------- */
  function startViz() {
    const scope = $("#scope"),
      sctx = scope.getContext("2d");
    const spec = $("#spectrum"),
      pctx = spec.getContext("2d");
    const td = new Uint8Array(2048),
      fd = new Uint8Array(1024);
    function frame() {
      requestAnimationFrame(frame);
      const an = transport.analyser;
      if (!an) return;
      an.getByteTimeDomainData(td);
      an.getByteFrequencyData(fd);
      let peak = 0;
      for (let i = 0; i < td.length; i++)
        peak = Math.max(peak, Math.abs(td[i] - 128));
      const silent = peak < 2;
      let w = (scope.width = scope.clientWidth * 2),
        h = (scope.height = scope.clientHeight * 2);
      sctx.clearRect(0, 0, w, h);
      if (!silent) {
        sctx.strokeStyle = "#22e3ff";
        sctx.shadowColor = "#22e3ff";
        sctx.shadowBlur = 12;
        sctx.lineWidth = 2;
        sctx.beginPath();
        for (let i = 0; i < td.length; i += 2) {
          const x = (i / td.length) * w,
            y = (td[i] / 255) * h;
          i === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
        }
        sctx.stroke();
      }
      sctx.shadowBlur = 0;
      w = spec.width = spec.clientWidth * 2;
      h = spec.height = spec.clientHeight * 2;
      pctx.clearRect(0, 0, w, h);
      if (!silent) {
        const bars = 56;
        for (let i = 0; i < bars; i++) {
          const v = fd[Math.floor(Math.pow(i / bars, 1.7) * 380)] / 255;
          const bh = v * h;
          const g = pctx.createLinearGradient(0, h, 0, h - bh);
          g.addColorStop(0, "#9dff3c");
          g.addColorStop(0.6, "#22e3ff");
          g.addColorStop(1, "#ff3ea5");
          pctx.fillStyle = g;
          pctx.fillRect((i * w) / bars + 1, h - bh, w / bars - 2, bh);
        }
      }
      // vumètres
      let rms = 0;
      for (let i = 0; i < td.length; i++) rms += Math.pow(td[i] / 128 - 1, 2);
      rms = Math.sqrt(rms / td.length);
      Object.keys(meters).forEach((k) => {
        meters[k].style.width = Math.min(100, rms * 260) + "%";
      });
    }
    frame();
  }

  /* ---------------- transport UI ---------------- */
  function setPlayUI(on) {
    $("#btnPlay").classList.toggle("on", on);
    $("#btnPlay").innerHTML = on
      ? '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/></svg>'
      : '<svg viewBox="0 0 16 16"><path d="M3 2l11 6-11 6z"/></svg>';
    if (!on) {
      $$(".step.cur").forEach((s) => s.classList.remove("cur"));
      const rp = $("#rollPlayhead");
      if (rp) rp.style.display = "none";
      const sp = $("#seqPlayhead");
      if (sp) sp.style.display = "none";
    }
  }
  function onStep(i, pid) {
    $$(".step.cur").forEach((s) => s.classList.remove("cur"));
    if (pid === pat().id) {
      moveSeqPlayhead(i);
      $$('.step[data-i="' + i + '"]').forEach((s) => s.classList.add("cur"));
      project.drums.forEach((d) => {
        const c = (pat().drum[d.id] || [])[i];
        if (c && c.on) {
          const row = $('.seqrow[data-drum="' + d.id + '"]');
          const cell = row && row.querySelectorAll(".step")[i];
          if (cell) {
            cell.classList.remove("hit");
            void cell.offsetWidth;
            cell.classList.add("hit");
          }
        }
      });
      const ph = $("#rollPlayhead");
      if (ph) {
        ph.style.display = "block";
        ph.style.left = i * CW + "px";
      }
    }
    $$("#arrBody .slot").forEach((s) => s.classList.remove("cur"));
  }

  /* ---------------- clavier ---------------- */
  const KEYMAP = {
    KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
    KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
  };
  let octave = 4;
  function bindKeys() {
    const down = {};
    addEventListener("keydown", (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.code === "ArrowLeft") octave = Math.max(1, octave - 1);
      if (e.code === "ArrowRight") octave = Math.min(7, octave + 1);
      if (KEYMAP[e.code] !== undefined && !down[e.code]) {
        down[e.code] = true;
        transport.preview(12 * (octave + 1) + KEYMAP[e.code]);
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
        e.preventDefault();
        saveProject();
      }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyE") {
        e.preventDefault();
        openExport();
      }
    });
    addEventListener("keyup", (e) => (down[e.code] = false));
  }

  function togglePlay() {
    if (transport.playing) {
      transport.stop();
      setPlayUI(false);
    } else {
      transport.start();
      setPlayUI(true);
    }
  }

  /* ---------------- splash ---------------- */
  function splash() {
    const logo = $("#logo");
    const text = "NEONFORGE";
    logo.innerHTML = "";
    text.split("").forEach((ch, i) => {
      const s = el("span", "", ch);
      s.style.animationDelay = i * 0.06 + "s";
      logo.appendChild(s);
    });
    const cv = $("#splashCanvas"),
      ctx = cv.getContext("2d");
    let t = 0,
      running = true;
    function loop() {
      if (!running) return;
      requestAnimationFrame(loop);
      const w = (cv.width = innerWidth),
        h = (cv.height = innerHeight);
      ctx.clearRect(0, 0, w, h);
      t += 0.02;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.strokeStyle = ["rgba(34,227,255,.45)", "rgba(255,62,165,.35)", "rgba(157,255,60,.22)"][k];
        ctx.lineWidth = 2;
        for (let x = 0; x <= w; x += 6) {
          const y =
            h / 2 +
            Math.sin(x * 0.006 + t * (1 + k * 0.4)) * (48 + k * 26) * Math.sin(t * 0.6 + k) +
            Math.sin(x * 0.02 - t * 2) * 12;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    loop();
    const steps = [
      "INITIALISATION DU MOTEUR AUDIO",
      "CHARGEMENT DES OSCILLATEURS",
      "DÉCODAGE DES ÉCHANTILLONS",
      "CALIBRAGE DES FILTRES",
      "STUDIO PRÊT",
    ];
    let i = 0;
    const bar = $("#bootbar");
    const log = $("#bootlog");
    const iv = setInterval(() => {
      log.textContent = steps[i];
      bar.style.width = ((i + 1) / steps.length) * 100 + "%";
      if (++i >= steps.length) {
        clearInterval(iv);
        const eb = $("#enterBtn");
        if (eb) eb.classList.add("on");
      }
    }, 420);
    $("#enterBtn").onclick = () => {
      running = false;
      $("#splash").classList.add("hide");
      $("#app").classList.add("on");
      transport.ensure();
      transport.syncParams();
      startViz();
      setTimeout(() => $("#splash").remove(), 900);
      autoNewOnStart();
    };
  }

  /* animation : le bouton NOUVEAU se clique tout seul au lancement,
     sauf si un projet .kdaw vient d'être chargé */
  function autoNewOnStart() {
    if (loadedFromFile) return;
    const b = $("#btnNew");
    if (!b) return;
    setTimeout(() => {
      if (loadedFromFile) return;
      b.classList.add("autopress");
      resetProject();
      toast("Nouveau projet");
      setTimeout(() => b.classList.remove("autopress"), 700);
    }, 700);
  }

  function resetProject() {
    const np = defaultProject();
    Object.keys(project).forEach((k) => delete project[k]);
    Object.assign(project, np);
    curPattern = 0;
    transport.stop();
    transport.rebuild();
    transport.pattern = 0;
    refreshAll();
    $("#bpmVal").textContent = project.bpm;
    $("#projName").value = project.name;
  }


  /* ---------------- init ---------------- */
  /* ---------------- plein écran des fenêtres ---------------- */
  function setupFullscreen() {
    $$(".panel").forEach((panel) => {
      const head = panel.querySelector(".ph");
      if (!head || head.querySelector(".fsbtn")) return;
      const b = el("button", "fsbtn", "⛶");
      b.title = "Plein écran (Échap pour sortir)";
      b.onclick = () => toggleMax(panel, b);
      head.appendChild(b);
      if (!head.querySelector(".spacer")) head.insertBefore(el("div", "spacer"), b);
    });
    addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const m = $(".panel.maxed");
        if (m) toggleMax(m, m.querySelector(".fsbtn"));
      }
    });
  }
  function toggleMax(panel, btn) {
    const was = panel.classList.contains("maxed");
    const cur = $(".panel.maxed");
    if (cur && cur !== panel) {
      cur.classList.remove("maxed");
      const cb = cur.querySelector(".fsbtn");
      if (cb) cb.textContent = "⛶";
    }
    panel.classList.toggle("maxed", !was);
    if (btn) btn.textContent = was ? "⛶" : "✕";
    buildSeq();
    buildRoll();
  }

  function init() {
    NF.initSamples(window.__SAMPLES__ || {});
    restoreAutosave();
    transport = NF.Transport(project, onStep);
    transport.pattern = curPattern;
    refreshAll();
    setupRoll();
    bindKeys();
    setupFullscreen();
    $("#btnPatAdd").onclick = addPattern;
    $("#btnPatDup").onclick = duplicatePattern;
    $("#btnPatRen").onclick = renamePattern;
    $("#btnPatDel").onclick = deletePattern;
    $$("#zoomSeg button").forEach((b) => {
      b.onclick = () => {
        SW = clamp(SW + parseInt(b.dataset.zoom, 10) * 6, 14, 64);
        buildSeq();
      };
    });
    splash();

    $("#projName").value = project.name;
    $("#projName").oninput = (e) => {
      project.name = e.target.value;
      dirty = true;
    };
    $("#bpmVal").textContent = project.bpm;
    const bv = $("#bpmVal");
    let sy = 0,
      sb = 0;
    bv.addEventListener("pointerdown", (e) => {
      bv.setPointerCapture(e.pointerId);
      sy = e.clientY;
      sb = project.bpm;
    });
    bv.addEventListener("pointermove", (e) => {
      if (!bv.hasPointerCapture(e.pointerId)) return;
      project.bpm = Math.round(clamp(sb + (sy - e.clientY) / 3, 40, 240));
      bv.textContent = project.bpm;
      touch();
    });
    bv.addEventListener("wheel", (e) => {
      e.preventDefault();
      project.bpm = Math.round(clamp(project.bpm + (e.deltaY < 0 ? 1 : -1), 40, 240));
      bv.textContent = project.bpm;
      touch();
    }, { passive: false });

    $("#btnPlay").onclick = togglePlay;
    $("#btnStop").onclick = () => {
      transport.stop();
      setPlayUI(false);
    };
    $("#btnMetro").onclick = (e) => {
      project.metronome = !project.metronome;
      e.currentTarget.classList.toggle("on", project.metronome);
    };
    $$("#modeSeg button").forEach((b) => {
      b.onclick = () => {
        $$("#modeSeg button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        transport.mode = b.dataset.mode;
        if (transport.playing) transport.start();
      };
    });
    $$("#stepSeg button").forEach((b) => {
      b.onclick = () => {
        $$("#stepSeg button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        setSteps(parseInt(b.dataset.steps, 10));
      };
    });
    $$("#viewTabs button").forEach((b) => {
      b.onclick = () => {
        $$("#viewTabs button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        $("#seqView").style.display = b.dataset.view === "seq" ? "flex" : "none";
        $("#rollView").style.display = b.dataset.view === "roll" ? "flex" : "none";
      };
    });
    $("#btnSave").onclick = saveProject;
    $("#btnOpen").onclick = openProject;
    $("#btnNew").onclick = () => {
      if (!confirm("Effacer le projet en cours ?")) return;
      loadedFromFile = false;
      resetProject();
    };

    $("#btnExport").onclick = openExport;
    $("#expGo").onclick = runExport;
    $("#expClose").onclick = () => $("#expOverlay").classList.remove("on");
    $("#expClose2").onclick = () => $("#expOverlay").classList.remove("on");
    $("#expFormat").onchange = () => {
      $("#kbpsRow").style.display = $("#expFormat").value === "mp3" ? "flex" : "none";
    };
    $("#btnClear").onclick = () => {
      const p = pat();
      project.drums.forEach((d) => (p.drum[d.id] = emptyRow(p.steps)));
      p.notes = [];
      touch();
      buildSeq();
      buildRoll();
    };
    $("#btnRand").onclick = () => {
      const p = pat();
      project.drums.forEach((d) => {
        const dens = { kick: 0.22, snare: 0.12, clap: 0.08, hatC: 0.45, hatO: 0.08, tom: 0.06, rim: 0.08, crash: 0.03 }[d.id] || 0.15;
        p.drum[d.id] = emptyRow(p.steps).map((c, i) => ({
          on: d.id === "kick" && i % 4 === 0 ? true : Math.random() < dens,
          vel: Math.random() < 0.2 ? 1 : 0.85,
        }));
      });
      touch();
      buildSeq();
      toast("Groove aléatoire généré");
    };

    setInterval(() => {
      if (dirty) {
        autosave();
        dirty = false;
      }
    }, 4000);
    addEventListener("beforeunload", autosave);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
