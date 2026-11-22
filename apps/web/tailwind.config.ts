import type { Config } from 'tailwindcss';

/**
 * Notion-inspired palette: warm neutrals, soft gray tints, subtle slate text.
 * Every token exists so the shell never falls back to raw hex values in JSX.
 */
const notion: Record<string, string> = {
  text: '#37352f',
  muted: '#787774',
  disabled: '#a39e97',
  border: '#e9e9e7',
  hover: '#f5f4f2',
  active: '#f0efec',
  sidebar: '#faf9f7',
  accent: '#2383e2',
  accentOn: '#1b6fc7',
};

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { notion },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          "'Segoe UI'",
          'Roboto',
          'Helvetica Neue',
          'Helvetica',
          'sans-serif',
        ],
      },
      boxShadow: {
        pop: '0 8px 28px rgba(15, 27, 38, 0.12)',
        popLg: '0 16px 48px rgba(15, 27, 38, 0.2)',
      },
      borderRadius: {
        shell: '10px',
      },
    },
  },
  plugins: [],
} satisfies Config;
