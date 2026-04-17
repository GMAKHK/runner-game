// ── Sound Effects (Web Audio API — no external files) ────────────────────────

let ctx = null;
let masterVolume = parseFloat(localStorage.getItem('sfxVolume') ?? '1.0');
let sfxEnabled   = localStorage.getItem('sfxEnabled') !== 'false';

export function setVolume(v) {
  masterVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem('sfxVolume', masterVolume);
}
export function getVolume() { return masterVolume; }

export function setSfxEnabled(v) {
  sfxEnabled = v;
  localStorage.setItem('sfxEnabled', v);
}
export function getSfxEnabled() { return sfxEnabled; }

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// 汎用: サイン波 + なめらかエンベロープ
function tone(freq, attack, sustain, release, gainPeak = 0.18) {
  if (!sfxEnabled || masterVolume === 0) return;
  const c   = getCtx();
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.connect(g);
  g.connect(c.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, c.currentTime);
  const peak = gainPeak * masterVolume;
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(peak, c.currentTime + attack);
  g.gain.setValueAtTime(peak, c.currentTime + attack + sustain);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + attack + sustain + release);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + attack + sustain + release + 0.05);
}

// 低域ノイズバースト (揚げ音)
function noiseBurst(duration, gainPeak = 0.12) {
  if (!sfxEnabled || masterVolume === 0) return;
  const c      = getCtx();
  const bufLen = Math.floor(c.sampleRate * duration);
  const buf    = c.createBuffer(1, bufLen, c.sampleRate);
  const data   = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1);
  const src = c.createBufferSource();
  src.buffer = buf;
  const lp  = c.createBiquadFilter();
  lp.type   = 'lowpass';
  lp.frequency.value = 600;
  const g   = c.createGain();
  src.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  const peak = gainPeak * masterVolume;
  g.gain.setValueAtTime(peak, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  src.start(c.currentTime);
  src.stop(c.currentTime + duration);
}

// ── 個別 SE ──────────────────────────────────────────────────────────────────

// ポテト揚がり完了: 低い油音 → 柔らかいチャイム2音
export function sfxPotatoDone() {
  noiseBurst(0.5, 0.1);
  setTimeout(() => {
    tone(330, 0.02, 0.1, 0.5, 0.18);
    setTimeout(() => tone(440, 0.02, 0.08, 0.55, 0.15), 180);
  }, 350);
}

// PRESENT: 柔らかい上昇2音
export function sfxPresent() {
  tone(330, 0.02, 0.1, 0.4, 0.18);
  setTimeout(() => tone(440, 0.02, 0.1, 0.5, 0.16), 160);
}

// MGRを呼ぶ: 低い2音コール
export function sfxCallMgr() {
  tone(220, 0.02, 0.1, 0.3, 0.2);
  setTimeout(() => tone(220, 0.02, 0.1, 0.3, 0.2), 250);
  setTimeout(() => tone(277, 0.02, 0.1, 0.45, 0.18), 520);
}

// WAIT: 短い下降2音
export function sfxWait() {
  tone(330, 0.02, 0.06, 0.25, 0.15);
  setTimeout(() => tone(262, 0.02, 0.06, 0.3, 0.13), 160);
}

// チェイサー発動: 低めの下降3音
export function sfxChaser() {
  tone(370, 0.02, 0.05, 0.2, 0.17);
  setTimeout(() => tone(311, 0.02, 0.05, 0.2, 0.17), 130);
  setTimeout(() => tone(247, 0.02, 0.06, 0.3, 0.16), 260);
}

// クイズ正解: 柔らかい上昇3音
export function sfxCorrect() {
  tone(262, 0.02, 0.08, 0.25, 0.16);
  setTimeout(() => tone(330, 0.02, 0.08, 0.25, 0.16), 140);
  setTimeout(() => tone(392, 0.02, 0.1,  0.45, 0.16), 280);
}

// クイズ不正解/時間切れ: 低い下降2音
export function sfxWrong() {
  tone(247, 0.02, 0.1, 0.35, 0.16);
  setTimeout(() => tone(196, 0.02, 0.1, 0.45, 0.14), 220);
}
