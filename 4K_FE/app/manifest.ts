import type { MetadataRoute } from 'next';

// 웹 앱 manifest — Next가 /manifest.webmanifest와 <link rel="manifest">를 자동 생성.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Peakly — Climax-based Movie Recommendation',
    short_name: 'Peakly',
    description: '클라이맥스 그래프를 분석해 비슷한 영화를 추천하는 서비스',
    start_url: '/',
    display: 'standalone',
    background_color: '#08090d',
    theme_color: '#08090d',
    lang: 'ko',
    categories: ['entertainment'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
