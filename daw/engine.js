/* =========================================================
   NEONFORGE STUDIO — moteur audio (Web Audio API pur)
   ========================================================= */
(function (global) {
  "use strict";

  /* ---------- utilitaires ---------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }
  function noteName(m) {
    return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  /* ---------- décodage des échantillons WAV embarqués ---------- */
  const SAMPLE_CACHE = {}; // name -> {data:Float32Array, sr:Number}
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function parseWav(bytes) {
    const dv = new DataView(bytes.buffer);
    let pos = 12,
      sr = 44100,
      channels = 1,
      bits = 16,
      dataOff = 0,
      dataLen = 0;
    while (pos < bytes.length - 8) {
      const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
      const size = dv.getUint32(pos + 4, true);
      if (id === "fmt ") {
        channels = dv.getUint16(pos + 10, true);
        sr = dv.getUint32(pos + 12, true);
        bits = dv.getUint16(pos + 22, true);
      } else if (id === "data") {
        dataOff = pos + 8;
        dataLen = size;
        break;
      }
      pos += 8 + size + (size % 2);
    }
    const n = Math.floor(dataLen / (bits / 8) / channels);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = dv.getInt16(dataOff + i * 2 * channels, true) / 32768;
    return { data: out, sr: sr };
  }
  function initSamples(raw) {
    Object.keys(raw).forEach((k) => {
      SAMPLE_CACHE[k] = parseWav(b64ToBytes(raw[k]));
    });
  }
  const bufCache = new WeakMap();
  function sampleBuffer(ctx, name) {
    let m = bufCache.get(ctx);
    if (!m) {
      m = {};
      bufCache.set(ctx, m);
    }
    if (m[name]) return m[name];
    const s = SAMPLE_CACHE[name];
    if (!s) return null;
    const b = ctx.createBuffer(1, s.data.length, s.sr);
    b.copyToChannel(s.data, 0);
    m[name] = b;
    return b;
  }

  /* ---------- bruit blanc ---------- */
  function noiseBuffer(ctx) {
    let m = bufCache.get(ctx);
    if (!m) {
      m = {};
      bufCache.set(ctx, m);
    }
    if (m.__noise) return m.__noise;
    const len = Math.floor(ctx.sampleRate * 2);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    m.__noise = b;
    return b;
  }

  /* ---------- réverbe procédurale ---------- */
  function impulse(ctx, seconds, decay) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return b;
  }

  function driveCurve(amount) {
    const k = amount * 25;
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return c;
  }

  /* =========================================================
     GRAPHE : construit une chaîne complète sur n'importe quel
     contexte (temps réel ou hors ligne).
     ========================================================= */
  function buildGraph(ctx, project) {
    const fx = project.fx;
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = fx.compThreshold;
    comp.ratio.value = fx.compRatio;
    comp.attack.value = 0.006;
    comp.release.value = 0.18;

    // saturation en parallèle (dry/wet) pour éviter d'écraser tout le signal
    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(fx.drive);
    shaper.oversample = "4x";
    const driveDry = ctx.createGain();
    const driveWet = ctx.createGain();
    driveDry.gain.value = 1 - fx.drive * 0.8;
    driveWet.gain.value = fx.drive * 0.8;
    const sum = ctx.createGain();
    sum.gain.value = 1;

    // marge de sécurité avant la chaîne de sortie
    const trim = ctx.createGain();
    trim.gain.value = 0.42;

    // bus d'entrée des instruments
    const bus = ctx.createGain();
    bus.gain.value = 1;

    // chorus
    const chorusIn = ctx.createGain();
    const chorusDry = ctx.createGain();
    const chorusWet = ctx.createGain();
    chorusDry.gain.value = 1 - fx.chorus * 0.5;
    chorusWet.gain.value = fx.chorus;
    const cd = ctx.createDelay(0.05);
    cd.delayTime.value = 0.018;
    const clfo = ctx.createOscillator();
    const clfoG = ctx.createGain();
    clfo.frequency.value = 0.6;
    clfoG.gain.value = 0.006;
    clfo.connect(clfoG).connect(cd.delayTime);
    clfo.start(0);
    chorusIn.connect(chorusDry);
    chorusIn.connect(cd).connect(chorusWet);

    // delay synchronisé
    const delaySend = ctx.createGain();
    delaySend.gain.value = fx.delay;
    const dly = ctx.createDelay(2);
    dly.delayTime.value = (60 / project.bpm) * fx.delayDiv;
    const fb = ctx.createGain();
    fb.gain.value = fx.delayFb;
    const dlyFilter = ctx.createBiquadFilter();
    dlyFilter.type = "lowpass";
    dlyFilter.frequency.value = 3800;
    dly.connect(dlyFilter).connect(fb).connect(dly);

    // reverb
    const revSend = ctx.createGain();
    revSend.gain.value = fx.reverb;
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 1.2 + fx.reverbSize * 3, 2.6);

    bus.connect(chorusIn);
    chorusDry.connect(trim);
    chorusWet.connect(trim);
    bus.connect(delaySend);
    bus.connect(revSend);
    delaySend.connect(dly);
    revSend.connect(conv);
    dly.connect(trim);
    conv.connect(trim);

    trim.connect(driveDry).connect(sum);
    trim.connect(shaper);
    shaper.connect(driveWet).connect(sum);
    sum.connect(comp).connect(limiter).connect(master);
    master.gain.value = project.mixer.master;
    master.connect(ctx.destination);

    // sous-bus par piste (synth + chaque instrument de batterie)
    const channels = {};
    function chan(id, vol, pan) {
      const g = ctx.createGain();
      g.gain.value = vol;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(bus);
      channels[id] = { gain: g, pan: p, input: g };
      return channels[id];
    }
    const m = project.mixer;
    chan("synth", m.synth.vol, m.synth.pan);
    project.drums.forEach((d) => chan("drum:" + d.id, d.vol, d.pan));

    return {
      ctx,
      master,
      bus,
      channels,
      fx: { dly, revSend, delaySend, shaper, comp, fbNode: fb, driveDry, driveWet },
    };
  }

  /* =========================================================
     SYNTHÉ 3 OSCILLATEURS
     ========================================================= */
  function playNote(graph, project, midi, time, dur, vel) {
    const ctx = graph.ctx;
    const s = project.synth;
    const out = graph.channels.synth.input;
    const v = clamp(vel, 0, 1);

    const amp = ctx.createGain();
    amp.gain.value = 0;

    const filter = ctx.createBiquadFilter();
    filter.type = s.filterType;
    filter.Q.value = s.reso;
    filter.connect(amp);
    amp.connect(out);

    const baseFreq = midiToFreq(midi + s.transpose);
    const nodes = [];

    // LFO
    let lfo = null,
      lfoGain = null;
    if (s.lfoAmount > 0) {
      lfo = ctx.createOscillator();
      lfo.type = s.lfoWave;
      lfo.frequency.value = s.lfoRate;
      lfoGain = ctx.createGain();
      lfo.connect(lfoGain);
      lfo.start(time);
      nodes.push(lfo);
    }

    s.oscs.forEach((o, idx) => {
      if (!o.on || o.level <= 0) return;
      const voices = Math.max(1, o.unison | 0);
      const oscGain = ctx.createGain();
      oscGain.gain.value = (o.level * 0.5) / Math.sqrt(voices);
      const panner = ctx.createStereoPanner();
      panner.pan.value = o.pan;
      oscGain.connect(panner).connect(filter);

      for (let u = 0; u < voices; u++) {
        const spread = voices === 1 ? 0 : (u / (voices - 1) - 0.5) * 2 * o.spread;
        const det = o.detune + spread * 22;
        let node;
        if (o.wave === "noise") {
          node = ctx.createBufferSource();
          node.buffer = noiseBuffer(ctx);
          node.loop = true;
          node.playbackRate.value = 1;
        } else {
          node = ctx.createOscillator();
          node.type = o.wave;
          const f = baseFreq * Math.pow(2, o.octave);
          node.frequency.setValueAtTime(f, time);
          node.detune.setValueAtTime(det, time);
          if (s.glide > 0) {
            node.frequency.setValueAtTime(f * 0.5, time);
            node.frequency.exponentialRampToValueAtTime(f, time + s.glide);
          }
          if (lfoGain && s.lfoTarget === "pitch") {
            const g = ctx.createGain();
            g.gain.value = s.lfoAmount * 100;
            lfoGain.connect(g).connect(node.detune);
          }
        }
        const vg = ctx.createGain();
        vg.gain.value = 1;
        node.connect(vg).connect(oscGain);
        node.start(time);
        nodes.push(node);
      }
      if (voices > 1) {
        // léger décalage stéréo pour l'unison
        panner.pan.value = clamp(o.pan + (idx - 1) * 0.06, -1, 1);
      }
    });

    // enveloppe de filtre
    const fBase = clamp(s.cutoff, 30, 18000);
    const fPeak = clamp(fBase * (1 + s.fenvAmount * 12), 30, 19000);
    filter.frequency.setValueAtTime(fBase, time);
    if (s.fenvAmount > 0.001) {
      filter.frequency.linearRampToValueAtTime(fPeak, time + Math.max(0.001, s.fa));
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, fBase + (fPeak - fBase) * s.fs),
        time + s.fa + Math.max(0.01, s.fd)
      );
    }
    if (lfoGain && s.lfoTarget === "filter") {
      const g = ctx.createGain();
      g.gain.value = s.lfoAmount * fBase * 0.8;
      lfoGain.connect(g).connect(filter.frequency);
    }
    if (lfoGain && s.lfoTarget === "volume") {
      const g = ctx.createGain();
      g.gain.value = s.lfoAmount * 0.4;
      lfoGain.connect(g).connect(amp.gain);
    }

    // ADSR
    const peak = v * s.volume;
    const a = Math.max(0.002, s.a),
      d = Math.max(0.005, s.d),
      sus = s.s,
      r = Math.max(0.02, s.r);
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peak, time + a);
    amp.gain.linearRampToValueAtTime(Math.max(0.0001, peak * sus), time + a + d);
    const off = Math.max(time + a + 0.01, time + dur);
    amp.gain.setValueAtTime(Math.max(0.0001, peak * sus), off);
    amp.gain.exponentialRampToValueAtTime(0.0001, off + r);

    const stop = off + r + 0.05;
    nodes.forEach((n) => {
      try {
        n.stop(stop);
      } catch (e) {}
    });
    return stop;
  }

  /* =========================================================
     BATTERIE
     ========================================================= */
  function playDrum(graph, project, drum, time, vel) {
    const ctx = graph.ctx;
    const ch = graph.channels["drum:" + drum.id];
    if (!ch) return;
    const out = ch.input;
    const v = clamp(vel, 0, 1.2);
    const rate = Math.pow(2, (drum.pitch || 0) / 12);

    if (drum.mode === "sample" && SAMPLE_CACHE[drum.sample]) {
      const src = ctx.createBufferSource();
      src.buffer = sampleBuffer(ctx, drum.sample);
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = v;
      src.connect(g).connect(out);
      src.start(time);
      return;
    }

    const g = ctx.createGain();
    g.connect(out);
    const kind = drum.kind;

    function tone(freq, endFreq, dur, type, level) {
      const o = ctx.createOscillator();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq * rate, time);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq * rate), time + dur);
      const eg = ctx.createGain();
      eg.gain.setValueAtTime(level * v, time);
      eg.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(eg).connect(g);
      o.start(time);
      o.stop(time + dur + 0.02);
    }
    function noise(dur, hp, level, lp) {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx);
      n.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = hp;
      let last = f;
      if (lp) {
        const l = ctx.createBiquadFilter();
        l.type = "lowpass";
        l.frequency.value = lp;
        f.connect(l);
        last = l;
      }
      const eg = ctx.createGain();
      eg.gain.setValueAtTime(level * v, time);
      eg.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      n.connect(f);
      last.connect(eg).connect(g);
      n.start(time);
      n.stop(time + dur + 0.02);
    }

    g.gain.value = 1;
    const tune = drum.tune === undefined ? 1 : drum.tune;
    const dec = drum.decay === undefined ? 1 : drum.decay;

    switch (kind) {
      case "kick":
        tone(150 * tune, 42 * tune, 0.1 * dec, "sine", 1);
        tone(58 * tune, 32 * tune, 0.55 * dec, "sine", 1);
        noise(0.012, 1200, 0.35);
        break;
      case "snare":
        tone(200 * tune, 140 * tune, 0.14 * dec, "triangle", 0.6);
        noise(0.22 * dec, 900, 0.85);
        break;
      case "clap":
        [0, 0.011, 0.022].forEach((o, i) => {
          const n = ctx.createBufferSource();
          n.buffer = noiseBuffer(ctx);
          n.loop = true;
          const f = ctx.createBiquadFilter();
          f.type = "bandpass";
          f.frequency.value = 1400 * tune;
          f.Q.value = 1.1;
          const eg = ctx.createGain();
          eg.gain.setValueAtTime(0, time + o);
          eg.gain.linearRampToValueAtTime(0.9 * v * (0.6 + i * 0.2), time + o + 0.001);
          eg.gain.exponentialRampToValueAtTime(0.0001, time + o + (i === 2 ? 0.2 * dec : 0.03));
          n.connect(f).connect(eg).connect(g);
          n.start(time + o);
          n.stop(time + o + 0.3 * dec + 0.05);
        });
        break;
      case "hatC":
        noise(0.05 * dec, 7000 * tune, 0.5);
        break;
      case "hatO":
        noise(0.36 * dec, 6200 * tune, 0.45);
        break;
      case "tom":
        tone(210 * tune, 90 * tune, 0.35 * dec, "sine", 0.9);
        noise(0.03, 500, 0.2);
        break;
      case "rim":
        tone(1700 * tune, 1500 * tune, 0.03 * dec, "square", 0.35);
        tone(520 * tune, 480 * tune, 0.05 * dec, "triangle", 0.3);
        break;
      case "crash":
        noise(1.3 * dec, 3600 * tune, 0.4);
        break;
      default:
        noise(0.1, 1000, 0.4);
    }
  }

  /* =========================================================
     SÉQUENCEUR : liste des événements d'un pattern
     ========================================================= */
  function patternEvents(project, pattern) {
    const spb = 60 / project.bpm / 4; // durée d'un pas (double-croche)
    const events = [];
    project.drums.forEach((d) => {
      const row = pattern.drum[d.id] || [];
      for (let i = 0; i < pattern.steps; i++) {
        const cell = row[i];
        if (cell && cell.on) events.push({ t: i * spb, type: "drum", drum: d, vel: cell.vel });
      }
    });
    (pattern.notes || []).forEach((n) => {
      events.push({
        t: n.step * spb,
        type: "note",
        midi: n.midi,
        dur: Math.max(1, n.len) * spb * 0.98,
        vel: n.vel,
      });
    });
    return { events, length: pattern.steps * spb };
  }

  function scheduleSong(graph, project, startTime, loops) {
    // renvoie la durée totale programmée
    const order = songOrder(project);
    let t = startTime;
    for (let l = 0; l < loops; l++) {
      order.forEach((pid) => {
        const p = project.patterns.find((x) => x.id === pid);
        if (!p) return;
        const { events, length } = patternEvents(project, p);
        events.forEach((e) => {
          if (e.type === "drum") {
            if (isAudible(project, e.drum)) playDrum(graph, project, e.drum, t + e.t, e.vel);
          } else if (!project.mixer.synth.mute) {
            playNote(graph, project, e.midi, t + e.t, e.dur, e.vel);
          }
        });
        t += length;
      });
    }
    return t - startTime;
  }

  function songOrder(project) {
    const arr = project.arrangement.filter((x) => x !== null && x !== undefined);
    if (arr.length) return arr;
    return [project.patterns[0].id];
  }

  function isAudible(project, drum) {
    const anySolo = project.drums.some((d) => d.solo) || project.mixer.synth.solo;
    if (drum.mute) return false;
    if (anySolo && !drum.solo) return false;
    return true;
  }

  /* =========================================================
     TRANSPORT TEMPS RÉEL
     ========================================================= */
  function Transport(project, onStep) {
    let ctx = null,
      graph = null,
      analyser = null,
      timer = null;
    let playing = false,
      mode = "pattern",
      curPattern = 0;
    let stepIndex = 0,
      nextStepTime = 0,
      songSlot = 0;
    const LOOKAHEAD = 0.1;

    function ensure() {
      if (!ctx) {
        ctx = new (global.AudioContext || global.webkitAudioContext)();
      }
      if (ctx.state === "suspended") ctx.resume();
      if (!graph) {
        graph = buildGraph(ctx, project);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        graph.master.connect(analyser);
      }
      return graph;
    }

    function rebuild() {
      if (!ctx) return;
      graph = null;
      ensure();
    }

    function syncParams() {
      if (!graph) return;
      const f = project.fx;
      graph.master.gain.value = project.mixer.master;
      graph.fx.dly.delayTime.value = (60 / project.bpm) * f.delayDiv;
      graph.fx.fbNode.gain.value = f.delayFb;
      graph.fx.delaySend.gain.value = f.delay;
      graph.fx.revSend.gain.value = f.reverb;
      graph.fx.shaper.curve = driveCurve(f.drive);
      graph.fx.driveDry.gain.value = 1 - f.drive * 0.8;
      graph.fx.driveWet.gain.value = f.drive * 0.8;
      graph.fx.comp.threshold.value = f.compThreshold;
      graph.fx.comp.ratio.value = f.compRatio;
      const anySolo = project.drums.some((d) => d.solo) || project.mixer.synth.solo;
      const sc = graph.channels.synth;
      if (sc) {
        sc.gain.gain.value =
          project.mixer.synth.mute || (anySolo && !project.mixer.synth.solo)
            ? 0
            : project.mixer.synth.vol;
        sc.pan.pan.value = project.mixer.synth.pan;
      }
      project.drums.forEach((d) => {
        const c = graph.channels["drum:" + d.id];
        if (c) {
          c.gain.gain.value = isAudible(project, d) ? d.vol : 0;
          c.pan.pan.value = d.pan;
        }
      });
    }

    function currentPatternObj() {
      if (mode === "song") {
        const order = songOrder(project);
        const pid = order[songSlot % order.length];
        return project.patterns.find((p) => p.id === pid) || project.patterns[0];
      }
      return project.patterns[curPattern] || project.patterns[0];
    }

    function scheduleStep(p, i, time) {
      project.drums.forEach((d) => {
        const cell = (p.drum[d.id] || [])[i];
        if (cell && cell.on && isAudible(project, d)) playDrum(graph, project, d, time, cell.vel);
      });
      if (!project.mixer.synth.mute) {
        const spb = 60 / project.bpm / 4;
        (p.notes || []).forEach((n) => {
          if (n.step === i)
            playNote(graph, project, n.midi, time, Math.max(1, n.len) * spb * 0.98, n.vel);
        });
      }
      if (project.metronome && i % 4 === 0) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = i === 0 ? 1600 : 1100;
        g.gain.setValueAtTime(0.14, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
        o.connect(g).connect(graph.master);
        o.start(time);
        o.stop(time + 0.06);
      }
    }

    function tick() {
      const spb = 60 / project.bpm / 4;
      while (nextStepTime < ctx.currentTime + LOOKAHEAD) {
        const p = currentPatternObj();
        scheduleStep(p, stepIndex, nextStepTime);
        const when = nextStepTime,
          si = stepIndex,
          pid = p.id;
        setTimeout(
          () => onStep && onStep(si, pid, songSlot),
          Math.max(0, (when - ctx.currentTime) * 1000)
        );
        nextStepTime += spb;
        stepIndex++;
        if (stepIndex >= p.steps) {
          stepIndex = 0;
          if (mode === "song") songSlot = (songSlot + 1) % songOrder(project).length;
        }
      }
    }

    return {
      get ctx() {
        return ctx;
      },
      get analyser() {
        return analyser;
      },
      get playing() {
        return playing;
      },
      get mode() {
        return mode;
      },
      set mode(m) {
        mode = m;
      },
      set pattern(i) {
        curPattern = i;
      },
      get pattern() {
        return curPattern;
      },
      ensure,
      rebuild,
      syncParams,
      preview(midi) {
        ensure();
        syncParams();
        playNote(graph, project, midi, ctx.currentTime + 0.01, 0.35, 0.9);
      },
      previewDrum(d) {
        ensure();
        syncParams();
        playDrum(graph, project, d, ctx.currentTime + 0.01, 1);
      },
      start() {
        ensure();
        syncParams();
        playing = true;
        stepIndex = 0;
        songSlot = 0;
        nextStepTime = ctx.currentTime + 0.08;
        clearInterval(timer);
        timer = setInterval(tick, 25);
        tick();
      },
      stop() {
        playing = false;
        clearInterval(timer);
        stepIndex = 0;
        songSlot = 0;
      },
    };
  }

  /* =========================================================
     RENDU HORS LIGNE + ENCODAGE
     ========================================================= */
  function renderOffline(project, loops, sampleRate, onProgress) {
    const order = songOrder(project);
    const spb = 60 / project.bpm / 4;
    let dur = 0;
    order.forEach((pid) => {
      const p = project.patterns.find((x) => x.id === pid);
      if (p) dur += p.steps * spb;
    });
    const total = dur * loops + 2.5; // queue de réverbe
    const OC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const ctx = new OC(2, Math.ceil(total * sampleRate), sampleRate);
    const graph = buildGraph(ctx, project);
    scheduleSong(graph, project, 0.05, loops);
    if (onProgress) {
      let p = 0;
      const iv = setInterval(() => {
        p = Math.min(0.92, p + 0.03 + Math.random() * 0.02);
        onProgress(p);
      }, 90);
      return ctx.startRendering().then((buf) => {
        clearInterval(iv);
        onProgress(1);
        return buf;
      });
    }
    return ctx.startRendering();
  }

  function encodeWav(buffer) {
    const numCh = buffer.numberOfChannels,
      len = buffer.length;
    const bytes = 44 + len * numCh * 2;
    const ab = new ArrayBuffer(bytes);
    const dv = new DataView(ab);
    const w = (o, s) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
    };
    w(0, "RIFF");
    dv.setUint32(4, bytes - 8, true);
    w(8, "WAVE");
    w(12, "fmt ");
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, numCh, true);
    dv.setUint32(24, buffer.sampleRate, true);
    dv.setUint32(28, buffer.sampleRate * numCh * 2, true);
    dv.setUint16(32, numCh * 2, true);
    dv.setUint16(34, 16, true);
    w(36, "data");
    dv.setUint32(40, len * numCh * 2, true);
    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = Math.max(-1, Math.min(1, chans[c][i]));
        dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([ab], { type: "audio/wav" });
  }

  function toInt16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  /* Encodage MP3 sur le thread principal (repli quand les Workers blob sont
     bloqués, par exemple quand le fichier est ouvert en file://). */
  function encodeMp3Main(left, right, sr, kbps, onProgress) {
    if (!global.lamejs) {
      // eslint-disable-next-line no-new-func
      new Function(global.__LAME_SOURCE__ + "\nself.lamejs=lamejs;")();
    }
    const enc = new global.lamejs.Mp3Encoder(2, sr, kbps);
    const chunk = 1152,
      out = [],
      n = left.length;
    let i = 0;
    return new Promise((resolve) => {
      function step() {
        const until = Math.min(n, i + chunk * 400);
        for (; i < until; i += chunk) {
          const b = enc.encodeBuffer(left.subarray(i, i + chunk), right.subarray(i, i + chunk));
          if (b.length > 0) out.push(new Int8Array(b));
        }
        onProgress && onProgress(Math.min(1, i / n));
        if (i < n) setTimeout(step, 0);
        else {
          const f = enc.flush();
          if (f.length > 0) out.push(new Int8Array(f));
          onProgress && onProgress(1);
          resolve(new Blob(out, { type: "audio/mpeg" }));
        }
      }
      step();
    });
  }

  function encodeMp3(buffer, kbps, onProgress) {
    const left = toInt16(buffer.getChannelData(0));
    const right = toInt16(
      buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)
    );
    const sr = buffer.sampleRate;
    const rate = kbps || 192;
    return new Promise((resolve, reject) => {
      let url = null,
        w = null,
        settled = false;
      const fallback = () => {
        if (settled) return;
        settled = true;
        try {
          if (w) w.terminate();
        } catch (e) {
          /* ignore */
        }
        if (url) URL.revokeObjectURL(url);
        encodeMp3Main(left, right, sr, rate, onProgress).then(resolve, reject);
      };
      try {
        const workerSrc =
          global.__LAME_SOURCE__ +
          "\nself.onmessage=function(e){var d=e.data;var enc=new lamejs.Mp3Encoder(2,d.sr,d.kbps);" +
          "var chunk=1152,out=[],n=d.left.length;" +
          "for(var i=0;i<n;i+=chunk){var l=d.left.subarray(i,i+chunk),r=d.right.subarray(i,i+chunk);" +
          "var b=enc.encodeBuffer(l,r);if(b.length>0)out.push(new Int8Array(b));" +
          "if((i/chunk)%80===0)self.postMessage({p:i/n});}" +
          "var f=enc.flush();if(f.length>0)out.push(new Int8Array(f));" +
          "self.postMessage({done:true,data:out});};";
        url = URL.createObjectURL(new Blob([workerSrc], { type: "text/javascript" }));
        w = new Worker(url);
      } catch (e) {
        fallback();
        return;
      }
      w.onmessage = (e) => {
        if (settled) return;
        if (e.data.p !== undefined) {
          onProgress && onProgress(e.data.p);
        } else if (e.data.done) {
          settled = true;
          onProgress && onProgress(1);
          w.terminate();
          URL.revokeObjectURL(url);
          resolve(new Blob(e.data.data, { type: "audio/mpeg" }));
        }
      };
      w.onerror = fallback;
      w.postMessage({ left, right, sr: sr, kbps: rate });
    });
  }

  global.NF = {
    clamp,
    midiToFreq,
    noteName,
    NOTE_NAMES,
    initSamples,
    SAMPLE_CACHE,
    buildGraph,
    playNote,
    playDrum,
    Transport,
    renderOffline,
    encodeWav,
    encodeMp3,
    songOrder,
  };
})(window);
