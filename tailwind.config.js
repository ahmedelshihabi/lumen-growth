/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: { '4xl': '2rem' },
      colors: {
        // Electric blue (primary). 600 is the brand colour.
        brand: {
          50: '#efefff', 100: '#e1e0ff', 200: '#c6c5ff', 300: '#a3a0ff', 400: '#7b77ff',
          500: '#5752fb', 600: '#3d3bf5', 700: '#2e2bd9', 800: '#2624ae', 900: '#221f86', 950: '#14124f',
        },
        // Accents. Lime only on blue/dark backgrounds (it fails contrast on white).
        zap: { 200: '#efffc2', 300: '#e2ff8a', 400: '#d4ff4d', 500: '#c3f02a', 600: '#9ccc0d', 700: '#6f930a' },
        flamingo: { 100: '#fde4f5', 200: '#fbc6ea', 300: '#f9a3de', 400: '#f77fd2', 500: '#f56ccb', 600: '#e042b0', 700: '#b92a8d' },
        lilac: { 100: '#f4ecfe', 200: '#e9dafc', 300: '#d8b8f8', 400: '#c49af2', 500: '#a874e8' },
      },
    },
  },
  plugins: [],
};
