import type { Config } from 'tailwindcss';

// 设计令牌:机务平台冷色系。ink 主文字/深底,steel 主按钮,sky 强调,mist 浅底。
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1a2230',
        steel: '#3b5470',
        sky: '#2b8fd6',
        mist: '#eef2f7',
        brand: '#1F7A52',
        'brand-deep': '#145C3C',
        'brand-tint': '#E8F3EC',
        'design-border': '#E2E8E4',
      },
    },
  },
  plugins: [],
};

export default config;
