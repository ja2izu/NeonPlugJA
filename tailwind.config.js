/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // NeonPlugJA: 値は src/styles/jaThemes.css の変数（<html data-theme> で配色を切り替える）。
      // 英語表示の値は上流と同じ（#00FFF7 など）。
      colors: {
        'neon-cyan': 'rgb(var(--np-cyan) / <alpha-value>)',
        'neon-cyan-bright': 'rgb(var(--np-cyan-bright) / <alpha-value>)',
        'neon-magenta': 'rgb(var(--np-magenta) / <alpha-value>)',
        'neon-magenta-bright': 'rgb(var(--np-magenta-bright) / <alpha-value>)',
        'neon-yellow': 'rgb(var(--np-yellow) / <alpha-value>)',
        'dark-charcoal': 'rgb(var(--np-charcoal) / <alpha-value>)',
        'deep-gray': 'rgb(var(--np-deep-gray) / <alpha-value>)',
        'cool-gray': 'rgb(var(--np-cool-gray) / <alpha-value>)',
      },
      boxShadow: {
        'glow-cyan': '0 0 6px rgb(var(--np-cyan)), 0 0 15px rgb(var(--np-cyan))',
        'glow-magenta': '0 0 6px rgb(var(--np-magenta)), 0 0 15px rgb(var(--np-magenta))',
      },
      textShadow: {
        'glow-cyan': '0 0 4px rgb(var(--np-cyan)), 0 0 10px rgb(var(--np-cyan))',
        'glow-magenta': '0 0 4px rgb(var(--np-magenta)), 0 0 10px rgb(var(--np-magenta))',
      },
    },
  },
  plugins: [],
}

