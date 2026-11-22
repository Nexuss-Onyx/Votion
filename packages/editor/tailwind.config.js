/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-noto-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-noto-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        notion: {
          gray: '#fafafa',
          border: '#e6e6e6',
          hover: '#f2f2f2',
          selected: '#e8f5ff',
        },
      },
    },
  },
  plugins: [],
};
