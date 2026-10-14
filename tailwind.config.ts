import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic UI tokens: use these (text-ink, bg-canvas, border-line...) instead of raw hex.
        ink: '#14301f',
        muted: '#6b7a70',
        subtle: '#8a968e',
        line: '#e3e9e4',
        canvas: '#f4f6f4',
        frame: '#e4e7e5',
        primary: { DEFAULT: '#14613f', hover: '#0f4d32' },
        tint: '#eef4ef',
        rowhover: '#f4f8f5',
        gold: '#f59e0b',
        danger: { DEFAULT: '#b91c1c', bg: '#fde8e6', line: '#f6c9c4' },
        success: { DEFAULT: '#15803d', bg: '#e3f1e8' },
        warn: { DEFAULT: '#8a5a00', bg: '#fdf3dc', line: '#f1dc9d' },
      },
    },
  },
  plugins: [],
};

export default config;
