import { callKey, nextRing, QUIET, RING_MS, silence, type Call, type RingState } from './ring';
import { report } from './diagnostics';
import { errorText } from './format';

/**
 * Plays the ringtone (public/ringtone.wav, a soft kalimba phrase, CC0 by Joseph Sardin via BigSoundBank) while a DM
 * call rings, following lib/ring.ts. Browsers only play sound a tap started, so the first tap anywhere unlocks it;
 * a call before any tap still shows, it just can't sound.
 */
class Ringer {
  private state: RingState = QUIET;
  private calls: readonly Call[] = [];
  private joined: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<() => void>();
  private unlocked = false;

  /** The calls going on and the one I'm in; call on every change. */
  update(calls: readonly Call[], joined: string | null) {
    this.calls = calls;
    this.joined = joined;
    this.apply(nextRing(this.state, calls, joined, Date.now()));
  }

  silence() {
    this.apply(silence(this.state));
  }

  readonly current = (): Call | null => this.state.ringing;

  /** Whether the ringtone is sounding (playing and not muted). */
  readonly playing = () => !!this.audio && !this.audio.paused && !this.audio.muted;

  readonly subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };

  /** Prepares the sound inside a tap, which is what lets it play later without one (iOS needs the same element). */
  readonly unlock = () => {
    if (this.unlocked) return;
    const a = this.sound();
    a.muted = true;
    void a.play().then(
      () => {
        this.unlocked = true;
        if (this.state.ringing) a.muted = false;
        else this.quiet(a);
      },
      () => {}, // not allowed yet: the next tap tries again
    );
  };

  private sound(): HTMLAudioElement {
    this.audio ??= Object.assign(new Audio(import.meta.env.BASE_URL + 'ringtone.wav'), { loop: true });
    return this.audio;
  }

  private quiet(a: HTMLAudioElement) {
    a.pause();
    a.currentTime = 0;
    a.muted = false;
  }

  private apply(next: RingState) {
    const was = this.state.ringing;
    this.state = next;
    clearTimeout(this.timer);
    // Re-checked when the ring times out, since nothing else changes then.
    if (next.ringing) this.timer = setTimeout(() => this.update(this.calls, this.joined), Math.max(0, next.since + RING_MS - Date.now()));
    if ((was && callKey(was)) === (next.ringing && callKey(next.ringing))) return;
    const a = this.sound();
    if (next.ringing) {
      a.muted = false;
      a.play().catch((err: unknown) => report('ring', 'error', 'Couldn’t play the ringtone: ' + errorText(err)));
    } else this.quiet(a);
    for (const f of this.listeners) f();
  }
}

export const ringer = new Ringer();
