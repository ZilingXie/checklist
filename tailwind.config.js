/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca'
        },
        slate: {
          925: '#0f1729'
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'agent-speaking-ring': 'agent-speaking-ring 1.8s ease-out infinite',
        'agent-speaking-core': 'agent-speaking-core 1.8s ease-in-out infinite',
        'agent-idle-ring': 'agent-idle-ring 3.5s ease-in-out infinite',
        'agent-idle-core': 'agent-idle-core 4s ease-in-out infinite'
      },
      keyframes: {
        'agent-speaking-ring': {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '70%': { opacity: '0.15' },
          '100%': { transform: 'scale(1.55)', opacity: '0' }
        },
        'agent-speaking-core': {
          '0%, 100%': { transform: 'scale(0.95)', opacity: '0.9' },
          '50%': { transform: 'scale(1.05)', opacity: '1' }
        },
        'agent-idle-ring': {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.25' },
          '50%': { transform: 'scale(1.1)', opacity: '0.4' }
        },
        'agent-idle-core': {
          '0%, 100%': { transform: 'scale(0.98)', opacity: '0.75' },
          '50%': { transform: 'scale(1.02)', opacity: '0.85' }
        }
      }
    }
  },
  plugins: []
};
