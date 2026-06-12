import type { Metadata } from "next";
import { Inter_Tight, Playfair_Display, JetBrains_Mono, Nanum_Myeongjo } from "next/font/google";
import "./globals.css";

const interTight = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["700", "800", "900"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const nanumMyeongjo = Nanum_Myeongjo({
  variable: "--font-serif-ko",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Peakly — Climax-based Movie Recommendation",
  description: "클라이맥스 그래프를 분석해 비슷한 영화를 추천하는 서비스",
  icons: { icon: "/peakly-black-bg.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${interTight.variable} ${playfair.variable} ${jetbrainsMono.variable} ${nanumMyeongjo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
