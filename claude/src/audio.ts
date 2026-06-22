// Synthesized SFX — no audio assets. Every sound is a short WebAudio envelope so
// the prototype stays a single self-contained build. Muteable + persisted.
//
// Lives in the presentation layer only: world.ts stays DOM/Audio-free and
// deterministic, so the headless sim is unaffected. game.ts calls these on input
// (build/sell/upgrade) and on per-frame state deltas (kill, leak, collapse, …).

const MUTE_KEY = 'amtd.muted';

type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;
  private lastShot = 0; // throttles the rapid-fire shoot tick

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // localStorage may be unavailable (private mode); default to audible.
    }
  }

  // Must be called from a user gesture (click/keydown) — browsers block audio
  // until then. Safe to call repeatedly; it only creates/resumes as needed.
  resume() {
    if (this.muted) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (m && this.ctx) void this.ctx.suspend();
    else this.resume();
  }

  // --- low-level: one enveloped oscillator (optionally pitch-swept) ----------
  private blip(opts: {
    type?: Wave;
    freq: number;
    freqTo?: number;
    dur: number;
    gain?: number;
    delay?: number;
    attack?: number;
  }) {
    if (this.muted || !this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqTo), t0 + opts.dur);
    const peak = opts.gain ?? 0.3;
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  // Filtered white-noise burst — used for impacts/collapse texture.
  private noise(opts: { dur: number; gain?: number; type?: BiquadFilterType; freq?: number; delay?: number }) {
    if (this.muted || !this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * opts.dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Deterministic-enough pseudo-noise (no Math.random dependency needed here,
    // but this layer isn't part of the sim so it doesn't matter either way).
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.type ?? 'bandpass';
    filter.frequency.value = opts.freq ?? 1200;
    const g = this.ctx.createGain();
    g.gain.value = opts.gain ?? 0.3;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.02);
  }

  // --- game sounds -----------------------------------------------------------
  shoot() {
    if (!this.ctx) return;
    // Throttle so a wall of towers doesn't machine-gun the speakers.
    if (this.ctx.currentTime - this.lastShot < 0.05) return;
    this.lastShot = this.ctx.currentTime;
    this.blip({ type: 'square', freq: 720, freqTo: 360, dur: 0.06, gain: 0.08 });
  }

  hit() {
    this.noise({ dur: 0.04, gain: 0.05, type: 'highpass', freq: 2600 });
  }

  kill() {
    this.blip({ type: 'triangle', freq: 300, freqTo: 90, dur: 0.16, gain: 0.16 });
    this.noise({ dur: 0.1, gain: 0.08, type: 'lowpass', freq: 900 });
  }

  leak() {
    // Ominous descending tone — you lost a life.
    this.blip({ type: 'sawtooth', freq: 220, freqTo: 70, dur: 0.32, gain: 0.18 });
  }

  build() {
    this.blip({ type: 'square', freq: 440, dur: 0.05, gain: 0.14 });
    this.blip({ type: 'square', freq: 660, dur: 0.07, gain: 0.14, delay: 0.05 });
  }

  sell() {
    this.blip({ type: 'square', freq: 520, freqTo: 300, dur: 0.1, gain: 0.12 });
  }

  upgrade() {
    this.blip({ type: 'triangle', freq: 520, dur: 0.07, gain: 0.16 });
    this.blip({ type: 'triangle', freq: 780, dur: 0.09, gain: 0.16, delay: 0.07 });
    this.blip({ type: 'triangle', freq: 1040, dur: 0.11, gain: 0.16, delay: 0.14 });
  }

  collapse() {
    this.noise({ dur: 0.5, gain: 0.32, type: 'lowpass', freq: 420 });
    this.blip({ type: 'sawtooth', freq: 130, freqTo: 40, dur: 0.5, gain: 0.22 });
  }

  levelUp() {
    const notes = [523, 659, 784, 1047]; // C E G C — bright arpeggio
    notes.forEach((f, i) => this.blip({ type: 'triangle', freq: f, dur: 0.16, gain: 0.18, delay: i * 0.08 }));
  }

  evolve() {
    // Menacing two-tone alarm for "the swarm learned/hardened".
    this.blip({ type: 'sawtooth', freq: 180, dur: 0.2, gain: 0.2 });
    this.blip({ type: 'sawtooth', freq: 140, dur: 0.3, gain: 0.2, delay: 0.18 });
  }

  win() {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => this.blip({ type: 'triangle', freq: f, dur: 0.22, gain: 0.2, delay: i * 0.12 }));
  }

  lose() {
    const notes = [392, 311, 247, 175];
    notes.forEach((f, i) => this.blip({ type: 'sawtooth', freq: f, dur: 0.3, gain: 0.2, delay: i * 0.16 }));
  }
}

export const audio = new Audio();
