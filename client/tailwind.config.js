/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // Enable class-based dark mode
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      colors: {
        'triologue': {
          'ice': '#60a5fa',
          'lava': '#f97316',
          'human': '#10b981',
        },
        'dark': {
          'base': '#0a0e1a',
          'surface': '#111827',
          'elevated': '#1a1f2e',
        },
      },
      boxShadow: {
        'subtle': '0 1px 2px 0 rgb(0 0 0 / 0.03), 0 1px 3px 0 rgb(0 0 0 / 0.06)',
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 2px 8px 0 rgb(0 0 0 / 0.04)',
        'card-hover': '0 2px 6px 0 rgb(0 0 0 / 0.06), 0 4px 12px 0 rgb(0 0 0 / 0.05)',
        'elevated': '0 4px 12px 0 rgb(0 0 0 / 0.08), 0 1px 3px 0 rgb(0 0 0 / 0.04)',
      },
    },
  },
  plugins: [],
}