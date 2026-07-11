/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand)',
          dark: 'var(--brand-dark)',
          tint: 'var(--brand-tint)',
        },
        ground: 'var(--ground)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        hair: 'var(--hair)',
        line: 'var(--line)',
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
        },
        slate: 'var(--slate)',
        navy: {
          DEFAULT: 'var(--navy)',
          light: 'var(--navy-light)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          soft: 'var(--accent-soft)',
          dark: 'var(--accent-dark)',
        },
        saffron: {
          DEFAULT: 'var(--saffron)',
          soft: 'var(--saffron-soft)',
        },
        green: {
          DEFAULT: 'var(--green)',
          soft: 'var(--green-soft)',
        },
        gold: {
          DEFAULT: 'var(--gold)',
          soft: 'var(--gold-soft)',
        },
        good: 'var(--good)',
        'good-soft': 'var(--good-soft)',
        warn: 'var(--warn)',
        'warn-soft': 'var(--warn-soft)',
        danger: 'var(--danger)',
        'danger-soft': 'var(--danger-soft)',
        success: {
          DEFAULT: 'var(--success)',
          bg: 'var(--success-bg)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          bg: 'var(--warning-bg)',
        },
        info: {
          DEFAULT: 'var(--info)',
          bg: 'var(--info-bg)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans Tamil', 'system-ui', 'sans-serif'],
        display: ['Inter', 'Noto Sans Tamil', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      borderRadius: {
        card: 'var(--radius-card)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        header: 'var(--shadow-header)',
      },
      maxWidth: {
        portal: '76rem',
      },
    },
  },
  plugins: [],
};
