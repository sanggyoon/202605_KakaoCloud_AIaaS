import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '4K Cinema',
  description: '클라이맥스 맞춤 영화 큐레이션',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="antialiased bg-[#0B0B0E] text-white">
        {children}
      </body>
    </html>
  );
}