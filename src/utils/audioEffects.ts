// Web Audio API Synthesizer for tactile martial sound feedback (Zero external audio files)
// Hand-crafted for Bushido Discipline OS: resonant bronze, wooden clack, katana draw, and temple harmonics.

class SoundFX {
  private ctx: AudioContext | null = null;
  private isUnlocked: boolean = false;

  constructor() {
    this.setupAutoUnlock();
  }

  // Automatic AudioContext unlock on first user interaction
  private setupAutoUnlock() {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.isUnlocked = true;
        }).catch(() => {});
      } else if (this.ctx) {
        this.isUnlocked = true;
      }
      // Remove listeners once activated
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };

    window.addEventListener('click', unlock, { once: true, passive: true });
    window.addEventListener('touchstart', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true, passive: true });
  }

  private init(): boolean {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        try {
          this.ctx = new AudioCtx();
        } catch {
          return false;
        }
      }
    }
    return !!this.ctx;
  }

  // 1. Crisp, tactile wooden clack / bamboo strike (Hyoshigi tactile toggle - 60ms)
  playCheck() {
    try {
      if (!this.init() || !this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      // Sharp resonant wood knock
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.055);

      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.065);
    } catch {
      // ignore audio context restrictions
    }
  }

  // 2. Triumphant Standard Day Temple Singing Bowl (5/5 foundation habits - peaceful resonant chord)
  playStandardDay() {
    try {
      if (!this.init() || !this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const t = this.ctx.currentTime;
      // Japanese Insen Pentatonic Tuning resonance (D4, G4, A4, D5)
      const freqs = [293.66, 392.00, 440.00, 587.33];
      freqs.forEach((f, i) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t + i * 0.03);

        const startGain = 0.05 / (i * 0.4 + 1);
        gain.gain.setValueAtTime(startGain, t + i * 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);

        osc.start(t + i * 0.03);
        osc.stop(t + 0.7);
      });
    } catch {}
  }

  // 3. Mastery (10/10 Score: 5 Habits + Special Mission) - Grand Bronze Bonshō Temple Bell
  playMastery() {
    try {
      if (!this.init() || !this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const t = this.ctx.currentTime;
      // Deep sacred temple bell fundamental & shimmering overtone series (G2 -> D3 -> G3 -> B3 -> D4)
      const harmonics = [98.0, 146.83, 196.0, 246.94, 293.66, 587.33];
      harmonics.forEach((f, i) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(f, t);

        const peakGain = 0.07 / (i * 0.5 + 1);
        gain.gain.setValueAtTime(peakGain, t);
        gain.gain.exponentialRampToValueAtTime(0.00005, t + 1.2);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);

        osc.start(t);
        osc.stop(t + 1.25);
      });
    } catch {}
  }

  // 4. Subtle warning tone for debt or locked day (Deep wooden block warning)
  playWarning() {
    try {
      if (!this.init() || !this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(95, t + 0.18);

      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.19);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.2);
    } catch {}
  }

  // 5. Debt Settled / Autopsy Resolved tone (Calm honor restored release tone)
  playAutopsySave() {
    try {
      if (!this.init() || !this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const t = this.ctx.currentTime;
      const notes = [329.63, 440.0, 587.33]; // E4 -> A4 -> D5 rising honor triad
      notes.forEach((freq, idx) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + idx * 0.04);

        gain.gain.setValueAtTime(0.06 / (idx + 1), t + idx * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);

        osc.start(t + idx * 0.04);
        osc.stop(t + 0.4);
      });
    } catch {}
  }

  // 6. Authentic Katana Steel Draw / Precision Blade Sheath (Brand Signature Sound)
  playSlash() {
    try {
      if (!this.init() || !this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const t = this.ctx.currentTime;
      const sampleRate = this.ctx.sampleRate;
      const length = Math.floor(sampleRate * 0.16); // 160ms
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);

      // Metallic friction impulse
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.05));
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      // High resonant steel ring
      const bandpass = this.ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(3200, t);
      bandpass.frequency.exponentialRampToValueAtTime(750, t + 0.14);
      bandpass.Q.setValueAtTime(5.5, t);

      // Tonal ring harmonic (Katana blade overtone)
      const tone = this.ctx.createOscillator();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(1480, t);
      tone.frequency.exponentialRampToValueAtTime(620, t + 0.12);

      const toneGain = this.ctx.createGain();
      toneGain.gain.setValueAtTime(0.04, t);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

      const mainGain = this.ctx.createGain();
      mainGain.gain.setValueAtTime(0.09, t);
      mainGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);

      noise.connect(bandpass);
      bandpass.connect(mainGain);
      mainGain.connect(this.ctx.destination);

      tone.connect(toneGain);
      toneGain.connect(this.ctx.destination);

      noise.start(t);
      tone.start(t);
      noise.stop(t + 0.16);
      tone.stop(t + 0.16);
    } catch {}
  }
}

export const soundFX = new SoundFX();
