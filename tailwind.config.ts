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
        brand: {
          green: '#065f46',
          hover: '#047857',
          gold: '#f59e0b',
          bg: '#f5f5f4',
          surface: '#ffffff',
          text: '#292524',
          muted: '#78716c',
          positive: '#15803d',
          negative: '#b91c1c',
          border: '#e7e5e4',
        },
      },
    },
  },
  plugins: [],
};

export default config;
