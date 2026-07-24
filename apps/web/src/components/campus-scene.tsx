"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/**
 * The animated backdrop of the public landing page: students walking across
 * the foot of the hero, school things drifting up behind them, and a gentle
 * pointer parallax over the whole thing.
 *
 * Everything is inline SVG driven by CSS keyframes (see the "campus scene"
 * section of globals.css) — no images, no animation library, nothing to
 * download. It is decorative only, hidden from assistive technology, and
 * `prefers-reduced-motion` stops all of it.
 */

// Walkers are placed back-to-front: the far ones are smaller, dimmer and
// slower, which is what sells the depth. `hue` picks the silhouette tint so
// the group doesn't read as clones of one figure.
const WALKERS = [
  { left: "4%",  scale: 0.52, duration: 46, delay: -6,  opacity: 0.16, hue: "#a5b4fc", depth: 6,  toLeft: false },
  { left: "62%", scale: 0.6,  duration: 54, delay: -28, opacity: 0.18, hue: "#c4b5fd", depth: 7,  toLeft: true },
  { left: "24%", scale: 0.78, duration: 38, delay: -14, opacity: 0.26, hue: "#818cf8", depth: 11, toLeft: false },
  { left: "80%", scale: 0.86, duration: 43, delay: -33, opacity: 0.24, hue: "#e879f9", depth: 13, toLeft: true },
  { left: "40%", scale: 1,    duration: 32, delay: -20, opacity: 0.34, hue: "#6366f1", depth: 18, toLeft: false },
] as const;

// Bottom is where each one rests; the drift keyframe carries it up from there.
const GLYPHS = [
  { glyph: "book",   left: "8%",  bottom: "6vh",  size: 34, duration: 26, delay: -4,  hue: "#818cf8", depth: 9 },
  { glyph: "cap",    left: "26%", bottom: "2vh",  size: 40, duration: 34, delay: -18, hue: "#c084fc", depth: 12 },
  { glyph: "pencil", left: "47%", bottom: "10vh", size: 30, duration: 29, delay: -9,  hue: "#f0abfc", depth: 10 },
  { glyph: "atom",   left: "68%", bottom: "4vh",  size: 36, duration: 38, delay: -24, hue: "#a5b4fc", depth: 14 },
  { glyph: "globe",  left: "86%", bottom: "8vh",  size: 32, duration: 31, delay: -13, hue: "#d8b4fe", depth: 8 },
  { glyph: "cap",    left: "16%", bottom: "16vh", size: 26, duration: 42, delay: -31, hue: "#f0abfc", depth: 6 },
  { glyph: "book",   left: "58%", bottom: "14vh", size: 28, duration: 36, delay: -21, hue: "#a78bfa", depth: 7 },
] as const;

export function CampusScene() {
  const root = useRef<HTMLDivElement>(null);

  // Pointer parallax. The two coordinates are written once per frame as CSS
  // custom properties on the container; each layer multiplies them by its own
  // depth in CSS, so this costs one style write per frame no matter how many
  // pieces are on screen. Skipped entirely for reduced-motion and touch.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return; // one update per animation frame, not per event
      frame = requestAnimationFrame(() => {
        frame = 0;
        el.style.setProperty("--v-px", ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3));
        el.style.setProperty("--v-py", ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    // Bounded to the first screenful, not the whole page: the scene belongs
    // to the hero, so the walkers' baseline lands on the fold instead of
    // drifting down behind the feature grid and footer.
    <div ref={root} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-screen overflow-hidden">
      {GLYPHS.map((g, i) => (
        <span
          key={`glyph-${i}`}
          className="v-glyph"
          style={{
            left: g.left,
            bottom: g.bottom,
            animationDuration: `${g.duration}s`,
            animationDelay: `${g.delay}s`,
          }}
        >
          <span className="v-parallax block" style={{ "--v-depth": g.depth } as CSSProperties}>
            <SchoolGlyph name={g.glyph} size={g.size} color={g.hue} />
          </span>
        </span>
      ))}

      {/* The walking band sits on the hero's baseline, behind the content. */}
      <div className="absolute inset-x-0 bottom-0 h-56 sm:h-72">
        {WALKERS.map((w, i) => (
          <div
            key={`walker-${i}`}
            className={`v-walker${w.toLeft ? " v-walker-left" : ""}`}
            style={{
              left: w.left,
              animationDuration: `${w.duration}s`,
              animationDelay: `${w.delay}s`,
            }}
          >
            <div className="v-parallax" style={{ "--v-depth": w.depth } as CSSProperties}>
              <Student
                scale={w.scale}
                opacity={w.opacity}
                color={w.hue}
                // Legs cycle roughly twice per second at full size; the
                // smaller (further) figures step a little slower.
                stepSeconds={0.72 / w.scale}
              />
            </div>
          </div>
        ))}
        {/* A horizon for them to walk on. Tinted with white rather than a
            backdrop colour so it works wherever the hero gradient has got to
            by the fold. */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      </div>
    </div>
  );
}

/**
 * One walking student: head, backpack, torso, and limbs that swing in
 * opposite phase around their shoulder/hip. Drawn tall in a 60×150 viewBox
 * and scaled by the caller, so a single figure serves every depth.
 */
function Student({ scale, opacity, color, stepSeconds }: {
  scale: number;
  opacity: number;
  color: string;
  stepSeconds: number;
}) {
  const limb = { stroke: color, strokeLinecap: "round" as const, fill: "none" };
  const swing = { animationDuration: `${stepSeconds}s` };
  return (
    <svg
      width={60 * scale}
      height={150 * scale}
      viewBox="0 0 60 150"
      fill="none"
      className="v-body"
      style={{ opacity, animationDuration: `${stepSeconds}s` }}
    >
      {/* far-side limbs first so the near ones overlap them */}
      <path className="v-limb v-arm-back" style={swing} d="M30 58 L22 92" strokeWidth={7} {...limb} opacity={0.65} />
      <path className="v-limb v-leg-back" style={swing} d="M30 96 L24 143" strokeWidth={8} {...limb} opacity={0.65} />

      {/* backpack, worn on the back of the walk direction */}
      <rect x="8" y="52" width="16" height="34" rx="7" fill={color} opacity={0.55} />
      <path d="M22 56 q8 6 8 14" stroke={color} strokeWidth={3} fill="none" opacity={0.5} />

      {/* torso */}
      <path d="M30 46 q13 4 13 20 l-2 32 h-22 l-2 -32 q0 -16 13 -20 z" fill={color} />

      {/* head + hair tuft */}
      <circle cx="30" cy="26" r="15" fill={color} />
      <path d="M16 22 q6 -14 22 -10 q6 2 6 8 q-10 -6 -28 2 z" fill={color} opacity={0.75} />

      {/* near-side limbs */}
      <path className="v-limb v-arm" style={swing} d="M30 58 L38 92" strokeWidth={7} {...limb} />
      <path className="v-limb v-leg" style={swing} d="M30 96 L36 143" strokeWidth={8} {...limb} />
    </svg>
  );
}

/** The school things drifting up behind the walkers. */
function SchoolGlyph({ name, size, color }: { name: "book" | "cap" | "pencil" | "atom" | "globe"; size: number; color: string }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    opacity: 0.55,
  };
  switch (name) {
    case "cap":
      return (
        <svg {...common}>
          <path d="M12 4 22 9l-10 5L2 9z" />
          <path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
        </svg>
      );
    case "pencil":
      return (
        <svg {...common}>
          <path d="M4 20l1-4L16 5l3 3L8 19z" />
          <path d="M14 7l3 3" />
        </svg>
      );
    case "atom":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="2.2" />
          <ellipse cx="12" cy="12" rx="10" ry="4.5" />
          <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(120 12 12)" />
        </svg>
      );
    case "globe":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c2.6 3 2.6 15 0 18-2.6-3-2.6-15 0-18z" />
        </svg>
      );
    case "book":
    default:
      return (
        <svg {...common}>
          <path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z" />
          <path d="M4 17.5A2.5 2.5 0 016.5 15H20" />
        </svg>
      );
  }
}
