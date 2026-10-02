import { chimeDue } from './alerts';

let ctx: AudioContext | undefined;
let last = Number.NEGATIVE_INFINITY;

/** Two soft rising notes (Hz), each fading out: generated, so there's no sound file to load. */
const NOTES = [880, 1320] as const;
const STEP = 0.09;
const FADE = 0.25;

/**
 * Plays the new-message chime unless one played under CHIME_GAP_MS ago. True when it played. Browsers start audio
 * only after the page was interacted with; until then the context stays suspended and nothing is heard.
 */
export function chime(now = Date.now()): boolean {
  if (!chimeDue(now, last)) return false;
  last = now;
  ctx ??= new AudioContext();
  const ac = ctx;
  void ac.resume();
  const t = ac.currentTime;
  NOTES.forEach((freq, i) => {
    const at = t + i * STEP;
    const osc = new OscillatorNode(ac, { type: 'sine', frequency: freq });
    const gain = new GainNode(ac, { gain: 0.0001 });
    gain.gain.setValueAtTime(0.0001, at); // the ramps start here, not when the chime was asked for
    gain.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + FADE);
    osc.connect(gain).connect(ac.destination);
    osc.start(at);
    osc.stop(at + FADE + 0.05);
  });
  return true;
}
