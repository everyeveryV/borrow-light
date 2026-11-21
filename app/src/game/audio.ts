export interface GameAudio {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
  unlock(): Promise<void>;
  tick(lamp?: number): void;
  step(): void;
  fall(): void;
  win(): void;
  pickup(): void;
  destroy(): void;
}

/** Small, locally synthesized sounds; no downloads and no gameplay timing changes. */
export function createAudio(): GameAudio {
  let enabled = false;
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let lastFootstep = -1;
  let disposed = false;

  async function unlock(): Promise<void> {
    if (disposed) return;
    try {
      const Audio = window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      if (!context || context.state === 'closed') {
        context = new Audio();
        master = context.createGain();
        master.gain.value = enabled ? 0.7 : 0;
        master.connect(context.destination);
      }
      if (context.state === 'suspended') await context.resume();
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

  return {
    get enabled() { return enabled; },
    setEnabled(value) {
      enabled = value;
      if (context && master) {
        master.gain.setTargetAtTime(value ? 0.7 : 0, context.currentTime, 0.025);
      }
      if (value) void unlock();
    },
    unlock,
    tick(lamp = 1) {
      const notes = [392, 523.25, 587.33, 659.25, 783.99];
      tone(notes[(Math.max(1, lamp) - 1) % notes.length], 0.17, 0.04);
    },
    step() {
      if (!context || context.currentTime - lastFootstep < 0.18) return;
      lastFootstep = context.currentTime;
      tone(105, 0.055, 0.014, 0, 65, 'triangle');
    },
    fall() {
      tone(220, 0.3, 0.06, 0, 92, 'triangle');
      tone(145, 0.3, 0.035, 0.12, 72);
    },
    win() {
      [784, 1046.5, 1318.5, 1568].forEach((frequency, index) => {
        tone(frequency, 0.95, 0.055, index * 0.105);
        tone(frequency * 2.002, 0.55, 0.01, index * 0.105);
      });
    },
    pickup() {
      tone(587.33, 0.2, 0.04);
      tone(783.99, 0.42, 0.045, 0.12);
    },
    destroy() {
      disposed = true;
      enabled = false;
      if (context && context.state !== 'closed') void context.close().catch(() => {});
      context = undefined;
      master = undefined;
    },
  };
}
