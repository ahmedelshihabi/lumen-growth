/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef4ff', 100: '#dbe6ff', 200: '#bfd2ff', 300: '#93b4ff', 400: '#608bff',
          500: '#3b66f5', 600: '#2549e0', 700: '#1e3ab8', 800: '#1e3494', 900: '#1d3075',
        },
      },
    },
  },
  plugins: [],
};
