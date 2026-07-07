import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '维修之翼',
  description: '航空机务培训 · 交流 · App 下载 · 学历提升',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
