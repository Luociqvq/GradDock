/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F0F2F5',
        ink: {
          DEFAULT: '#1E293B',
          soft: '#334155',
          mute: '#64748B',
          faint: '#94A3B8'
        }
      },
      fontFamily: {
        dock: ['system-ui', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'sans-serif']
      },
      boxShadow: {
        dock: '0 18px 45px -18px rgba(15, 23, 42, 0.35)',
        orb: '0 10px 28px -12px rgba(79, 70, 229, 0.55)'
      }
    }
  },
  plugins: []
}
