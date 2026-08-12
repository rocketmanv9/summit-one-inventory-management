/**
 * Shared scan feedback for the mobile flows (/m/count, /m/receive).
 *
 * Short beep + vibration so operators get scan feedback without looking at
 * the screen (880Hz ok / 200Hz fail). Both are best-effort — iOS may block
 * audio until a user gesture, and vibration support varies by browser.
 */

let sharedAudioCtx: AudioContext | null = null;

export function scanFx(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 40 : [70, 50, 70]);
  } catch { /* unsupported */ }
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    if (!sharedAudioCtx) sharedAudioCtx = new Ctor();
    const ctx = sharedAudioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 200;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.09 : 0.2));
  } catch { /* unsupported */ }
}
