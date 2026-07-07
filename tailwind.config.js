/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6f1',
          100: '#d3e9dc',
          200: '#a7d3b9',
          300: '#79bc96',
          400: '#4d9e72',
          500: '#357a58',
          600: '#2a6047',
          700: '#204a37',
          800: '#183828',
          900: '#112a1e',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
