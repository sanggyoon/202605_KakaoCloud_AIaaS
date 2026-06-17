// PWA 아이콘 생성기 — public/peakly-gradient-bg.svg → PNG 4종.
// 실행: node scripts/gen-pwa-icons.mjs  (4K_FE 디렉터리에서)
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const svg = readFileSync(join(pub, 'peakly-gradient-bg.svg'));

async function render(size, out) {
  await sharp(svg).resize(size, size).png().toFile(join(pub, out));
  console.log('written', out);
}

async function renderMaskable(out) {
  // 512 캔버스를 앱 배경색으로 채우고 로고를 80%(410px) 중앙 합성 → maskable 안전영역 확보
  const logo = await sharp(svg).resize(410, 410).png().toBuffer();
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: '#0f0a24' },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(join(pub, out));
  console.log('written', out);
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(180, 'apple-touch-icon.png');
await renderMaskable('icon-maskable-512.png');
console.log('done');
