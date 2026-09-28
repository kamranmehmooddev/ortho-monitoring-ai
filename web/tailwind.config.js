/** Meridian design system tokens (Ortho Monitoring AI). Colours are CSS variables so light/dark themes swap cleanly. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: v('canvas'), surface: v('surface'), raised: v('raised'), sunken: v('sunken'),
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3'), 4: v('ink-4') },
        line: { DEFAULT: v('line'), strong: v('line-strong') },
        navy: { DEFAULT: '#10133A', 2: '#181C4A', 3: '#23285E', 900: '#0B0D29' },
        ember: { DEFAULT: v('ember'), soft: v('ember-soft'), ink: v('ember-ink') },
        amber: { brand: '#F5B400' },
        urgent: { DEFAULT: v('urgent'), soft: v('urgent-soft') },
        attention: { DEFAULT: v('attention'), soft: v('attention-soft') },
        stable: { DEFAULT: v('stable'), soft: v('stable-soft') },
        info: { DEFAULT: v('info'), soft: v('info-soft') },
        uncertain: { DEFAULT: v('uncertain'), soft: v('uncertain-soft') },
        lightbox: '#0B0C10',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Crimson Pro"', 'ui-serif', 'Georgia', 'serif'],
      },
      fontSize: { '2xs': ['11px', '14px'], xs: ['12px', '16px'], sm: ['13px', '18px'], base: ['14px', '20px'], md: ['15px', '22px'] },
      borderRadius: { lg: '10px', xl: '14px', '2xl': '18px' },
      boxShadow: {
        card: '0 1px 0 rgb(16 19 58 / 0.04), 0 1px 2px rgb(16 19 58 / 0.04)',
        pop: '0 12px 32px -8px rgb(16 19 58 / 0.22), 0 2px 6px rgb(16 19 58 / 0.08)',
        focus: '0 0 0 3px rgb(var(--ember) / 0.25)',
      },
      backgroundImage: { 'brand-gradient': 'linear-gradient(90deg, #E8590C 0%, #F29A0F 55%, #F5B400 100%)' },
      keyframes: { in: { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } }, pulseDot: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } } },
      animation: { in: 'in .18s ease-out both', pulseDot: 'pulseDot 1.6s ease-in-out infinite' },
    },
  },
  plugins: [],
};
