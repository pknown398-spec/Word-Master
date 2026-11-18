class GameAudioEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    volume = 0.08,
    delay = 0
  ) {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playSpinTick() {
    this.playTone(540, 0.045, 'triangle', 0.045);
  }

  playLetterLocked() {
    this.playTone(523.25, 0.14, 'triangle', 0.09, 0);
    this.playTone(659.25, 0.18, 'triangle', 0.09, 0.08);
    this.playTone(783.99, 0.28, 'sine', 0.1, 0.16);
  }

  playStopPressed() {
    this.playTone(880, 0.12, 'sawtooth', 0.06, 0);
    this.playTone(698.46, 0.24, 'triangle', 0.09, 0.1);
  }

  playCountdownTick(urgent = false) {
    this.playTone(urgent ? 987.77 : 740, 0.06, 'sine', urgent ? 0.07 : 0.04);
  }

  playRoundReveal(hasPerfectCategory: boolean) {
    this.playTone(440, 0.14, 'sine', 0.07, 0);
    this.playTone(554.37, 0.14, 'sine', 0.07, 0.07);
    this.playTone(659.25, 0.22, 'sine', 0.08, 0.14);
    if (hasPerfectCategory) {
      this.playTone(880, 0.3, 'triangle', 0.08, 0.22);
    }
  }

  playGameOver() {
    this.playTone(523.25, 0.14, 'triangle', 0.08, 0);
    this.playTone(659.25, 0.14, 'triangle', 0.08, 0.11);
    this.playTone(783.99, 0.14, 'triangle', 0.08, 0.22);
    this.playTone(1046.5, 0.4, 'sine', 0.1, 0.34);
  }
}

export const soundFX = new GameAudioEngine();
