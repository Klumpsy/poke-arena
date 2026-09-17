export function seedRng(seed: number): number {
  return (seed >>> 0) || 0x9e3779b9;
}

export function nextRng(state: number): { state: number; value: number } {
  let t = (state + 0x6d2b79f5) >>> 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return { state: t, value };
}

export class Rng {
  constructor(public state: number) {}

  next(): number {
    const r = nextRng(this.state);
    this.state = r.state;
    return r.value;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(percent: number): boolean {
    return this.next() * 100 < percent;
  }
}
