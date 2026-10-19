/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      colors: {
        // Palette of the Oct 2026 redesign: warm off-white ground, white cards,
        // forest green for action and "on track", coral for urgent, sand for
        // waiting / assumed. One place: every token class follows it.
        ink: { DEFAULT: '#1B2420', soft: '#3D433E', muted: '#6A6F69', faint: '#A9AEA8' },
        surface: { DEFAULT: '#F6F4EF', raised: '#FFFFFF', sunken: '#EFEBE3', border: '#E8E3D9' },
        accent: { DEFAULT: '#1F4D3A', hover: '#163828', soft: '#E3ECE5' },
        coral: { DEFAULT: '#E2553F', deep: '#B23A26', soft: '#FBE3DD' },
        sand: { DEFAULT: '#D69A2D', deep: '#8A5A12', soft: '#F8EBD3' },
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06)',
        'card-hover': '0 4px 12px 0 rgb(0 0 0 / 0.08)',
        modal: '0 24px 48px -12px rgb(0 0 0 / 0.18)',
      },
      animation: {
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fadeIn 0.2s ease-out',
        'scale-in': 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        slideUp: { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        scaleIn: { from: { transform: 'scale(0.95)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
      },
    },
  },
  plugins: [],
};
