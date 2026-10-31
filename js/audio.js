/* ============================================================
 * audio.js — WebAudio 合成音效（PRD F9.2 / 第 8 节：按事件播放短音效）
 * 无音频素材依赖，全部程序化合成；首次用户手势后解锁。
 * ============================================================ */
"use strict";

const Sound = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  const loops = new Map();

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function noiseBuffer(seconds = 1) {
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function env(gainNode, t0, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  function beep({ type = "sine", from = 440, to = null, dur = 0.2, vol = 0.4, delay = 0 }) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    env(g, t0, 0.01, vol, dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise({ dur = 0.3, vol = 0.3, filterType = "bandpass", freq = 2000, q = 1, sweepTo = null, delay = 0 }) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.1);
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const g = ctx.createGain();
    env(g, t0, 0.01, vol, dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.1);
  }

  const effects = {
    click:   () => beep({ type: "triangle", from: 660, dur: 0.07, vol: 0.25 }),
    confirm: () => { beep({ from: 523, dur: 0.12, vol: 0.3 }); beep({ from: 784, dur: 0.18, vol: 0.3, delay: 0.09 }); },
    ding:    () => beep({ from: 1046, dur: 0.5, vol: 0.3 }),
    drop:    () => { beep({ type: "sine", from: 220, to: 90, dur: 0.12, vol: 0.45 }); noise({ dur: 0.08, vol: 0.15, freq: 900 }); },
    pour:    () => noise({ dur: 0.7, vol: 0.25, filterType: "bandpass", freq: 1200, sweepTo: 500, q: 2 }),
    rustle:  () => noise({ dur: 0.28, vol: 0.3, filterType: "highpass", freq: 3200 }),
    fold:    () => { noise({ dur: 0.2, vol: 0.28, filterType: "highpass", freq: 2400 }); beep({ type: "sine", from: 160, to: 100, dur: 0.12, vol: 0.3, delay: 0.05 }); },
    stir:    () => noise({ dur: 0.16, vol: 0.2, freq: 1500, q: 0.8 }),
    success: () => { [523, 659, 784, 1046].forEach((f, i) => beep({ from: f, dur: 0.22, vol: 0.3, delay: i * 0.1 })); },
    fail:    () => { beep({ type: "sawtooth", from: 240, to: 90, dur: 0.55, vol: 0.28 }); noise({ dur: 0.4, vol: 0.12, freq: 300, filterType: "lowpass" }); },
    warn:    () => beep({ type: "square", from: 330, dur: 0.16, vol: 0.18 }),
    steam:   () => noise({ dur: 1.2, vol: 0.16, filterType: "bandpass", freq: 800, q: 0.6 }),
  };

  function startLoop(name) {
    if (!ensure() || muted || loops.has(name)) return;
    let src, f, g, lfo, lfoG;
    if (name === "sizzle") {
      src = ctx.createBufferSource();
      src.buffer = noiseBuffer(2); src.loop = true;
      f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 3800; f.Q.value = 0.7;
      g = ctx.createGain(); g.gain.value = 0.12;
      lfo = ctx.createOscillator(); lfo.frequency.value = 7;
      lfoG = ctx.createGain(); lfoG.gain.value = 0.05;
      lfo.connect(lfoG).connect(g.gain);
      src.connect(f).connect(g).connect(master);
      src.start(); lfo.start();
    } else if (name === "boil") {
      src = ctx.createBufferSource();
      src.buffer = noiseBuffer(2); src.loop = true;
      f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 420;
      g = ctx.createGain(); g.gain.value = 0.16;
      lfo = ctx.createOscillator(); lfo.frequency.value = 3.2;
      lfoG = ctx.createGain(); lfoG.gain.value = 0.07;
      lfo.connect(lfoG).connect(g.gain);
      src.connect(f).connect(g).connect(master);
      src.start(); lfo.start();
    } else {
      return;
    }
    loops.set(name, { src, lfo, g });
  }

  function stopLoop(name) {
    const h = loops.get(name);
    if (!h) return;
    try {
      h.g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
      setTimeout(() => { try { h.src.stop(); h.lfo && h.lfo.stop(); } catch (e) {} }, 200);
    } catch (e) {}
    loops.delete(name);
  }

  function stopAllLoops() { [...loops.keys()].forEach(stopLoop); }

  return {
    unlock: ensure,
    play(name) { const fn = effects[name]; if (fn && !muted) fn(); },
    startLoop, stopLoop, stopAllLoops,
    setMuted(v) { muted = v; if (v) stopAllLoops(); if (window.Sfx) window.Sfx.setMuted(v); },
    get muted() { return muted; },
  };
})();
