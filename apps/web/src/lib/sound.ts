"use client";

/**
 * Notification chime, synthesized with the Web Audio API — no audio asset
 * to load, works offline. Played when a new message or announcement
 * arrives; a 🔔 toggle in the header persists the user's preference.
 *
 * Browsers only allow audio after a user gesture; by the time someone is
 * inside the portal they have clicked (login/navigation), so playback
 * generally succeeds. Failures are silently ignored.
 */

const KEY = "vertik12.sound";

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(KEY) !== "off";
}

export function setSoundEnabled(enabled: boolean) {
  localStorage.setItem(KEY, enabled ? "on" : "off");
}

let ctx: AudioContext | null = null;

export function playNotificationChime() {
  if (!isSoundEnabled()) return;
  try {
    type AudioContextCtor = typeof AudioContext;
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();

    // A gentle two-note "ding-dong": E6 then G6, soft attack, quick decay.
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.14; // keep it subtle
    master.connect(ctx.destination);

    for (const [freq, start] of [[1318.5, 0], [1568, 0.14]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(1, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.45);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now + start);
      osc.stop(now + start + 0.5);
    }
  } catch {
    /* audio unavailable (no gesture yet / unsupported) — stay silent */
  }
}
