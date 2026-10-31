/* ============================================================
 * sfx.js — 真实音频文件播放器（bgm/*.wav）
 *
 * 与 audio.js 的分工：
 *   · audio.js —— WebAudio 程序化合成（提示音、点击声、环境嗡鸣），零素材依赖；
 *   · sfx.js   —— 播放真实的录音素材（炒菜声、倒奶声、下锅声、蒸煮声、出锅音乐）。
 *
 * 为什么用 HTMLAudioElement 而不是 decodeAudioData：
 *   file:// 下浏览器禁掉 fetch / XHR，fetch 拿不到 ArrayBuffer，
 *   而 <audio src="bgm/xxx.wav"> 是普通资源加载，file:// 与 http:// 都能直接播。
 *
 * 隐私：全部为本地素材，只在本机播放，不上传、不录制。
 * ============================================================ */
"use strict";

const Sfx = (() => {
  /* 素材库：名字 → 文件与播放参数
   * vol 是「归一化响度」后的经验值：各素材源电平差异很大
   * （火锅下料放冰块 99.9% 满幅、炒菜只有 23.1%），
   * 这里按各自峰值折算，让听起来大致在同一档：
   *   火锅下料 0.50、蒸煮 0.55、倒牛奶 0.80、成功出锅 0.80 → 有效峰值都落在 45~50%
   *   炒菜 0.95 → 源文件本身就轻，是环境底噪，不宜再压
   */
  const BANK = {
    fry:  { src: "bgm/炒菜.wav",            loop: true,  vol: 0.95 }, // 炒饭：下料→出锅前的持续炒菜声
    milk: { src: "bgm/倒牛奶.wav",          loop: false, vol: 0.80 }, // 奶茶：牛奶倒入杯中
    drop: { src: "bgm/火锅下料放冰块.wav",  loop: false, vol: 0.50 }, // 下料 / 放冰块
    boil: { src: "bgm/蒸煮.wav",            loop: true,  vol: 0.55 }, // 蒸煮 / 涮煮环境声
    done: { src: "bgm/成功出锅.wav",        loop: false, vol: 0.80 }, // 成果卡：出锅音乐
  };

  const els = new Map();     // name -> HTMLAudioElement
  const playing = new Set(); // 正在发声的名字
  let muted = false;
  let warned = false;

  /** 取（并缓存）一个音频元素 */
  function el(name) {
    let a = els.get(name);
    if (a) return a;
    const cfg = BANK[name];
    if (!cfg) return null;
    a = new Audio();
    a.preload = "auto";
    a.src = cfg.src;
    a.loop = false;
    a.volume = cfg.vol;
    a.addEventListener("error", () => {
      if (warned) return;
      warned = true;
      console.warn("[sfx] 音频加载失败：", cfg.src);
    });
    els.set(name, a);
    return a;
  }

  /** play() 可能被自动播放策略拒绝，这里吞掉异常不让它冒泡到控制台 */
  function safePlay(a) {
    try {
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) { /* 忽略 */ }
  }

  /** 单次播放：正在播就从头再来一次（用于「拖一个放一次」） */
  function play(name) {
    if (muted) return false;
    const a = el(name);
    if (!a) return false;
    a.loop = false;
    if (!a.paused) { try { a.currentTime = 0; } catch (e) {} }
    safePlay(a);
    playing.add(name);
    return true;
  }

  /** 循环播放：已经在循环就保持现状（不从头来），避免重复调用把进度打回 */
  function loop(name) {
    if (muted) return false;
    const a = el(name);
    if (!a) return false;
    a.loop = true;
    if (!a.paused) { playing.add(name); return true; }
    try { a.currentTime = 0; } catch (e) {}
    safePlay(a);
    playing.add(name);
    return true;
  }

  /** 停止并复位 */
  function stop(name) {
    const a = els.get(name);
    playing.delete(name);
    if (!a) return;
    try { a.pause(); a.currentTime = 0; } catch (e) {}
  }

  function stopAll() {
    playing.clear();
    els.forEach((a) => { try { a.pause(); a.currentTime = 0; } catch (e) {} });
  }

  /** 暂停（游戏暂停时保留进度，恢复时接着播） */
  function pauseAll() {
    els.forEach((a) => { if (!a.paused) { try { a.pause(); } catch (e) {} } });
  }

  function resumeAll() {
    if (muted) return;
    playing.forEach((name) => {
      const a = els.get(name);
      if (a && a.paused) safePlay(a);
    });
  }

  /** 预热：提前把素材加载进来，避免第一次播有延迟 */
  function warm(names) {
    (names || []).forEach((name) => {
      const a = el(name);
      if (!a) return;
      try { a.load(); } catch (e) {}
    });
  }

  function setMuted(v) {
    muted = !!v;
    if (muted) stopAll();
  }

  return {
    play, loop, stop, stopAll, pauseAll, resumeAll, warm, setMuted,
    BANK,
    get muted() { return muted; },
    get playing() { return [...playing]; },
    isPlaying(name) {
      const a = els.get(name);
      return !!(a && !a.paused);
    },
    element(name) { return els.get(name) || null; },
  };
})();

window.Sfx = Sfx;
