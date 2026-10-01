// The music: Erik Satie's first Gymnopédie, played by Robin Alciatore and given
// to the public domain by Musopen (from Wikimedia Commons). It loops, off until
// the visitor turns it on, and runs through Web Audio so it can fade in and out
// everywhere (iOS ignores a media element's own volume).

// The recording is quiet (peaks at -9.6 dBFS); this lifts it to a calm level.
export const LEVEL = 1.8;
// It opens with two seconds of silence; the first play starts at the first chord.
const FIRST_NOTE = 1.9;

export class Music {
  constructor(src) {
    this.src = src;
    this.on = false;
    this.ctx = null;
  }

  // Whether the recording is there to play.
  async available() {
    try {
      const r = await fetch(this.src, { method: 'HEAD' });
      return r.ok && (r.headers.get('content-type') || '').startsWith('audio');
    } catch {
      return false;
    }
  }

  // Turn the sound on (must follow a click or tap) or off.
  async toggle(on = !this.on) {
    this.on = on;
    if (on) {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'playback' });
        this.audio = new Audio(`${this.src}#t=${FIRST_NOTE}`);
        this.audio.loop = true;
        this.fresh = true;
        this.audio.preload = 'auto';
        this.audio.crossOrigin = 'anonymous';
        this.gain = this.ctx.createGain();
        this.gain.gain.value = 0;
        this.ctx.createMediaElementSource(this.audio).connect(this.gain);
        this.gain.connect(this.ctx.destination);
      }
      await this.ctx.resume();
      await this.audio.play();
      // From the top, the first chord comes in as written; resumed, it fades in.
      this._fade(LEVEL, this.fresh ? 0.25 : 2.5);
      this.fresh = false;
    } else if (this.ctx) {
      this._fade(0, 1.2);
      clearTimeout(this.sleep);
      this.sleep = setTimeout(() => {
        if (this.on) return;
        this.audio.pause();
      }, 1300);
    }
    return this.on;
  }

  _fade(to, seconds) {
    const t = this.ctx.currentTime;
    const g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(to, t + seconds);
  }
}

// Part of the recording for a clip, with fades, as an AudioBuffer.
export async function trackExcerpt(src, { from = 0, seconds, fadeIn = 1.5, fadeOut = 2.5, level = 1, sampleRate = 48000 }) {
  const data = await (await fetch(src)).arrayBuffer();
  const decoded = await new OfflineAudioContext(2, 1, sampleRate).decodeAudioData(data);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = decoded;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(level, fadeIn);
  g.gain.setValueAtTime(level, Math.max(fadeIn, seconds - fadeOut));
  g.gain.linearRampToValueAtTime(0, seconds);
  source.connect(g);
  g.connect(ctx.destination);
  source.start(0, from);
  return ctx.startRendering();
}
