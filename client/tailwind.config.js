/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        'surface-light': '#f1f5f9',
        'surface-dark': '#0f172a',
      },
    },
  },
  plugins: [],
};

export default config;
