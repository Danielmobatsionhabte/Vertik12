import type { Config } from "tailwindcss";

/**
 * Brand palette. `brand` is the primary indigo used for actions and accents;
 * `accent` is the violet used as the far end of the signature gradient
 * (indigo → violet → fuchsia). Swap these values to re-skin the whole app.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
        accent: {
          50: "#faf5ff",
          100: "#f3e8ff",
          200: "#e9d5ff",
          300: "#d8b4fe",
          400: "#c084fc",
          500: "#a855f7",
          600: "#9333ea",
          700: "#7e22ce",
          800: "#6b21a8",
          900: "#581c87",
          950: "#3b0764",
        },
      },
      backgroundImage: {
        // The signature brand gradient — indigo → violet → fuchsia.
        "brand-gradient": "linear-gradient(135deg, #4f46e5 0%, #7c3aed 55%, #c026d3 100%)",
        "brand-gradient-soft": "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
        "brand-sheen": "linear-gradient(135deg, rgba(99,102,241,0.14) 0%, rgba(168,85,247,0.12) 100%)",
        // Deep blue-black hero backdrop — matches the app chrome framing.
        "brand-night": "linear-gradient(140deg, #070b17 0%, #0b1226 40%, #1e1b4b 75%, #4c1d95 100%)",
      },
      boxShadow: {
        "brand-glow": "0 10px 30px -10px rgba(99, 102, 241, 0.45)",
      },
      keyframes: {
        "gradient-pan": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(18px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-18px)" },
        },
      },
      animation: {
        "gradient-pan": "gradient-pan 12s ease infinite",
        // `both` keeps delayed elements hidden until their turn — used for
        // the landing page's staggered entrances (delay set inline).
        "fade-up": "fade-up 0.7s ease-out both",
        float: "float 9s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
