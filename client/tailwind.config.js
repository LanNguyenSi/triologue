/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'triologue': {
          'ice': '#60a5fa',    // Ice blue
          'lava': '#f97316',   // Lava orange
          'human': '#10b981',  // Human green
        }
      }
    },
  },
  plugins: [],
}