export interface GameAudio {
  readonly enabled: boolean;
  readonly musicEnabled: boolean;
  setEnabled(enabled: boolean): void;
  setMusic(enabled: boolean): void;
  /** 0 is the street map, 1-5 are the nights. The beat keeps the score in step with the lamp ticks. */
  setScene(scene: number, beatSeconds?: number): void;
  unlock(): Promise<void>;
  tick(lamp?: number): void;
  step(): void;
  fall(): void;
  win(stars?: number): void;
  pickup(): void;
  click(): void;
  swap(): void;
  begin(beatSeconds?: number): void;
  record(): void;
  destroy(): void;
}

interface Chord { bass: number; pad: number[] }

// A minor pentatonic, the same five notes the lamp ticks use, so every beat lands inside the score.
const scale = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99];
const chords: Chord[] = [
  { bass: 110, pad: [220, 329.63, 523.25] },
  { bass: 87.31, pad: [174.61, 261.63, 440] },
  { bass: 130.81, pad: [196, 329.63, 523.25] },
  { bass: 98, pad: [196, 293.66, 587.33] },
];
const motifs = [
  [8, -1, 7, -1, 6, -1, 5, -1],
  [5, -1, 6, 7, -1, 8, -1, -1],
  [9, -1, 8, -1, 7, 8, -1, -1],
  [-1, -1, 8, -1, 7, -1, 5, -1],
  [7, -1, -1, 6, -1, 5, -1, -1],
  [5, 7, 8, -1, -1, -1, 9, -1],
  [4, -1, 5, -1, 7, -1, -1, -1],
  [8, -1, -1, -1, 6, -1, -1, -1],
  [-1, -1, -1, -1, -1, -1, -1, -1],
];
const densities = [0.78, 0.8, 0.86, 0.8, 0.86, 0.95];
const rainLevels = [0.02, 0.02, 0.022, 0.032, 0.02, 0.016];

/** Locally synthesized sounds and a generative rain-night score; no downloads and no gameplay timing changes. */
export function createAudio(): GameAudio {
  let enabled = false;
  let music = true;
  let scene = 0;
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let musicBus: GainNode | undefined;
  let wet: GainNode | undefined;
  let rainGain: GainNode | undefined;
  let noiseBuffer: AudioBuffer | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastFootstep = -1;
  let foot = 0;
  let disposed = false;
  let stepSeconds = 0.5;
  let nextStep = 0;
  let stepIndex = 0;
  let motif: number[] = motifs[0];
  let lastMotif = -1;

  function build(Audio: typeof AudioContext): void {
    const ctx = new Audio();
    context = ctx;
    master = ctx.createGain();
    master.gain.value = enabled ? 0.7 : 0;
    master.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = music ? 1 : 0;
    musicBus.connect(master);

    const length = Math.floor(ctx.sampleRate * 2.6);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.8;
    }
    const hall = ctx.createConvolver();
    hall.buffer = impulse;
    wet = ctx.createGain();
    wet.gain.value = 0.42;
    wet.connect(hall);
    hall.connect(musicBus);

    noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

    const rain = ctx.createBufferSource();
    rain.buffer = noiseBuffer;
    rain.loop = true;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 1100;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 6800;
    rainGain = ctx.createGain();
    rainGain.gain.value = rainLevels[scene];
    rain.connect(high);
    high.connect(low);
    low.connect(rainGain);
    rainGain.connect(musicBus);
    rain.start();

    const river = ctx.createBufferSource();
    river.buffer = noiseBuffer;
    river.loop = true;
    river.playbackRate.value = 0.6;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 320;
    band.Q.value = 0.6;
    const riverGain = ctx.createGain();
    riverGain.gain.value = 0.02;
    river.connect(band);
    band.connect(riverGain);
    riverGain.connect(musicBus);
    river.start(0, 0.7);
  }

  async function unlock(): Promise<void> {
    if (disposed) return;
    try {
      const Audio = window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      if (!context || context.state === 'closed') build(Audio);
      if (!timer) timer = setInterval(schedule, 140);
      if (context && context.state === 'suspended') await context.resume();
    } catch {
      // Browsers can defer audio until a later user gesture. Gameplay remains available.
    }
  }

  function tone(frequency: number, duration = 0.16, volume = 0.05,
    delay = 0, endFrequency = frequency, waveform: OscillatorType = 'sine'): void {
    if (!enabled || !context || !master || context.state !== 'running') return;
    const at = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }

  /** A filtered burst of noise: splashes, wet footsteps and the breath of a lamp turning. */
  function noise(duration: number, volume: number, from: number, to: number,
    delay = 0, type: BiquadFilterType = 'lowpass'): void {
    if (!enabled || !context || !master || !noiseBuffer || context.state !== 'running') return;
    const at = context.currentTime + delay;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = type;
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + duration);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(master);
    source.start(at, Math.random() * 1.2, duration + 0.05);
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
  }

  function pluck(frequency: number, at: number, volume: number, duration = 2.1): void {
    const ctx = context;
    if (!ctx || !musicBus || !wet) return;
    const string = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const shimmer = ctx.createGain();
    const envelope = ctx.createGain();
    string.type = 'triangle';
    string.frequency.setValueAtTime(frequency * 1.012, at);
    string.frequency.exponentialRampToValueAtTime(frequency, at + 0.05);
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(frequency * 2, at);
    shimmer.gain.setValueAtTime(0.3, at);
    shimmer.gain.exponentialRampToValueAtTime(0.02, at + duration * 0.5);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    string.connect(envelope);
    overtone.connect(shimmer);
    shimmer.connect(envelope);
    envelope.connect(musicBus);
    envelope.connect(wet);
    string.start(at);
    overtone.start(at);
    string.stop(at + duration + 0.05);
    overtone.stop(at + duration + 0.05);
    string.onended = () => {
      string.disconnect(); overtone.disconnect(); shimmer.disconnect(); envelope.disconnect();
    };
  }

  function pad(chord: Chord, at: number, duration: number): void {
    const ctx = context;
    const bus = musicBus;
    const send = wet;
    if (!ctx || !bus || !send) return;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    filter.connect(bus);
    filter.connect(send);
    chord.pad.forEach((frequency, index) => {
      const voice = ctx.createOscillator();
      const envelope = ctx.createGain();
      voice.type = index === 2 ? 'sine' : 'triangle';
      voice.frequency.value = frequency;
      voice.detune.value = (index - 1) * 5;
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.linearRampToValueAtTime(0.013, at + 1.6);
      envelope.gain.setValueAtTime(0.013, at + duration - 0.8);
      envelope.gain.linearRampToValueAtTime(0.0001, at + duration + 1.4);
      voice.connect(envelope);
      envelope.connect(filter);
      voice.start(at);
      voice.stop(at + duration + 1.5);
      voice.onended = () => {
        voice.disconnect(); envelope.disconnect();
        if (index === chord.pad.length - 1) filter.disconnect();
      };
    });
  }

  function low(frequency: number, at: number, volume: number, duration: number, bend = 1): void {
    const ctx = context;
    if (!ctx || !musicBus) return;
    const voice = ctx.createOscillator();
    const envelope = ctx.createGain();
    voice.type = 'sine';
    voice.frequency.setValueAtTime(frequency, at);
    if (bend !== 1) voice.frequency.exponentialRampToValueAtTime(frequency * bend, at + duration);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + Math.min(0.08, duration * 0.1));
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    voice.connect(envelope);
    envelope.connect(musicBus);
    voice.start(at);
    voice.stop(at + duration + 0.05);
    voice.onended = () => { voice.disconnect(); envelope.disconnect(); };
  }

  function playStep(index: number, at: number): void {
    const position = index % 8;
    const bar = Math.floor(index / 8);
    const chord = chords[Math.floor(bar / 2) % chords.length];
    if (position === 0) {
      if (bar % 2 === 0) {
        pad(chord, at, stepSeconds * 16);
        chord.pad.forEach((frequency, i) => pluck(frequency * 2, at + i * 0.07, 0.013, 2.6));
      }
      low(chord.bass, at, 0.05, 3.2);
      let pick = Math.floor(Math.random() * motifs.length);
      if (pick === lastMotif) pick = (pick + 1) % motifs.length;
      lastMotif = pick;
      motif = motifs[pick];
    }
    const note = motif[position];
    if (note >= 0 && Math.random() < densities[scene]) {
      pluck(scale[note], at + Math.random() * 0.012, 0.034 + Math.random() * 0.012);
      if (Math.random() < 0.16) pluck(scale[note] * 2, at + stepSeconds * 0.5, 0.012, 1.4);
    }
    // The night market keeps a light wooden pulse under the melody.
    if (scene === 5) low(position % 4 === 0 ? 880 : 1320, at, position % 2 === 0 ? 0.012 : 0.006, 0.07, 0.7);
  }

  function schedule(): void {
    if (!context || !musicBus || context.state !== 'running' || !enabled || !music || document.hidden) return;
    const now = context.currentTime;
    if (nextStep < now - 0.2) nextStep = now + 0.08;
    while (nextStep < now + 0.5) {
      playStep(stepIndex, nextStep);
      stepIndex++;
      nextStep += stepSeconds;
    }
  }

  return {
    get enabled() { return enabled; },
    get musicEnabled() { return music; },
    setEnabled(value) {
      enabled = value;
      if (context && master) {
        master.gain.setTargetAtTime(value ? 0.7 : 0, context.currentTime, 0.025);
      }
      if (value) void unlock();
    },
    setMusic(value) {
      music = value;
      if (context && musicBus) musicBus.gain.setTargetAtTime(value ? 1 : 0, context.currentTime, 0.35);
    },
    setScene(value, beatSeconds = 0.5) {
      scene = Math.max(0, Math.min(5, Math.floor(value) || 0));
      stepSeconds = Math.max(0.3, Math.min(0.7, beatSeconds));
      if (context && rainGain) rainGain.gain.setTargetAtTime(rainLevels[scene], context.currentTime, 0.8);
    },
    unlock,
    tick(lamp = 1) {
      const notes = [392, 523.25, 587.33, 659.25, 783.99];
      tone(notes[(Math.max(1, lamp) - 1) % notes.length], 0.17, 0.04);
    },
    step() {
      if (!context || context.currentTime - lastFootstep < 0.22) return;
      lastFootstep = context.currentTime;
      foot ^= 1;
      tone(foot ? 118 : 100, 0.06, 0.02, 0, 62, 'triangle');
      noise(0.05, 0.016, foot ? 1500 : 1250, 700, 0, 'bandpass');
    },
    fall() {
      tone(220, 0.3, 0.06, 0, 92, 'triangle');
      tone(145, 0.3, 0.035, 0.12, 72);
      // The splash lands when the figure reaches the water, a little after the slip.
      noise(0.55, 0.11, 3200, 420, 0.36);
      noise(0.9, 0.035, 900, 260, 0.5);
      tone(92, 0.4, 0.05, 0.36, 48);
    },
    win(stars = 0) {
      [784, 1046.5, 1318.5, 1568].forEach((frequency, index) => {
        tone(frequency, 0.95, 0.055, index * 0.105);
        tone(frequency * 2.002, 0.55, 0.01, index * 0.105);
      });
      const chimes = [1318.5, 1568, 2093];
      for (let i = 0; i < Math.min(3, stars); i++) {
        tone(chimes[i], 0.5, 0.04, 0.6 + i * 0.22);
        tone(chimes[i] * 1.5, 0.3, 0.012, 0.6 + i * 0.22);
      }
    },
    pickup() {
      tone(587.33, 0.2, 0.04);
      tone(783.99, 0.42, 0.045, 0.12);
    },
    click() {
      tone(660, 0.06, 0.02, 0, 520, 'triangle');
    },
    swap() {
      tone(523.25, 0.14, 0.035, 0, 783.99);
      noise(0.18, 0.02, 1800, 5200, 0, 'bandpass');
    },
    begin(beatSeconds) {
      tone(392, 0.18, 0.03);
      tone(587.33, 0.32, 0.03, 0.1);
      if (context && beatSeconds) {
        // Start a fresh bar on the first step, so the score breathes with the lamp beats.
        stepSeconds = Math.max(0.3, Math.min(0.7, beatSeconds));
        stepIndex = Math.ceil(stepIndex / 8) * 8;
        nextStep = context.currentTime + stepSeconds;
      }
    },
    record() {
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
        tone(frequency, 0.28, 0.04, 1.35 + index * 0.09, frequency, 'triangle');
      });
      tone(1568, 0.9, 0.03, 1.71);
    },
    destroy() {
      disposed = true;
      enabled = false;
      if (timer) clearInterval(timer);
      timer = undefined;
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      context = undefined;
      master = undefined;
      musicBus = undefined;
      wet = undefined;
      rainGain = undefined;
      noiseBuffer = undefined;
    },
  };
}
