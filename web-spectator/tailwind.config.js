/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Mantém o mesmo design system do app
        bg: '#08080C',
        surface: '#101018',
        surfaceHigh: '#16161F',
        border: '#22222E',
        primary: '#D4FF3A',
        success: '#00FF88',
        danger: '#FF4757',
        warning: '#FFA502',
        magenta: '#FF3DCB',
        cyan: '#3DDCFF',
        purple: '#9D5BFF',
        textPrimary: '#FFFFFF',
        textSecondary: '#A0A0B0',
        textMuted: '#5A5A68',
      },
      fontFamily: {
        mono: ['SF Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
