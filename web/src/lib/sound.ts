type SoundName = 'hit' | 'crit' | 'super' | 'faint' | 'heal' | 'status' | 'switch' | 'win' | 'lose' | 'click' | 'protect';

let ctx: AudioContext | null = null;
let enabled = true;
try {
  enabled = localStorage.getItem('poke-arena-sound') !== 'off';
} catch {
  enabled = true;
}

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem('poke-arena-sound', on ? 'on' : 'off');
  } catch {
    /* private mode */
  }
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(ac: AudioContext, at: number, freq: number, duration: number, type: OscillatorType, gain = 0.08, slideTo?: number): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

function noise(ac: AudioContext, at: number, duration: number, gain = 0.1): void {
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * duration), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  src.connect(g).connect(ac.destination);
  src.start(at);
}

export function play(name: SoundName): void {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  switch (name) {
    case 'hit':
      noise(ac, t, 0.12, 0.12);
      tone(ac, t, 220, 0.12, 'square', 0.05, 110);
      break;
    case 'crit':
      noise(ac, t, 0.2, 0.18);
      tone(ac, t, 300, 0.2, 'sawtooth', 0.08, 80);
      tone(ac, t + 0.05, 600, 0.15, 'square', 0.05, 150);
      break;
    case 'super':
      tone(ac, t, 880, 0.08, 'square', 0.06);
      tone(ac, t + 0.08, 1175, 0.08, 'square', 0.06);
      tone(ac, t + 0.16, 1568, 0.14, 'square', 0.06);
      break;
    case 'faint':
      tone(ac, t, 440, 0.5, 'triangle', 0.08, 55);
      break;
    case 'heal':
      tone(ac, t, 660, 0.1, 'sine', 0.06);
      tone(ac, t + 0.1, 880, 0.1, 'sine', 0.06);
      tone(ac, t + 0.2, 1320, 0.18, 'sine', 0.06);
      break;
    case 'status':
      tone(ac, t, 200, 0.18, 'sawtooth', 0.05, 160);
      tone(ac, t + 0.18, 160, 0.18, 'sawtooth', 0.05, 120);
      break;
    case 'switch':
      tone(ac, t, 523, 0.08, 'square', 0.05);
      tone(ac, t + 0.09, 784, 0.12, 'square', 0.05);
      break;
    case 'protect':
      tone(ac, t, 1200, 0.2, 'sine', 0.05, 1600);
      break;
    case 'click':
      tone(ac, t, 900, 0.04, 'square', 0.03);
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(ac, t + i * 0.12, f, 0.2, 'square', 0.07));
      tone(ac, t + 0.5, 1047, 0.5, 'square', 0.07);
      break;
    case 'lose':
      [392, 349, 311, 262].forEach((f, i) => tone(ac, t + i * 0.16, f, 0.25, 'triangle', 0.07));
      break;
  }
}
