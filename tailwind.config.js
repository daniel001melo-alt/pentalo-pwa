/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        surface2: 'rgb(var(--surface2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        accentInk: 'rgb(var(--accent-ink) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
        m: {
          corrida: 'rgb(var(--m-corrida) / <alpha-value>)',
          natacao: 'rgb(var(--m-natacao) / <alpha-value>)',
          forca: 'rgb(var(--m-forca) / <alpha-value>)',
          granada: 'rgb(var(--m-granada) / <alpha-value>)',
          tiro: 'rgb(var(--m-tiro) / <alpha-value>)',
          ppm: 'rgb(var(--m-ppm) / <alpha-value>)',
          pnu: 'rgb(var(--m-pnu) / <alpha-value>)',
          mobilidade: 'rgb(var(--m-mobilidade) / <alpha-value>)',
          competicao: 'rgb(var(--m-competicao) / <alpha-value>)',
          outro: 'rgb(var(--m-outro) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
};
