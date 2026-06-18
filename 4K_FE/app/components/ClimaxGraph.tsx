'use client';

import { useEffect, useRef, useState } from 'react';
import { toDisplayScale } from '@/app/lib/climax';
import { valenceGradientStops, valenceToUnit, valenceColorAt } from '@/app/lib/color';
import { catmullRomPath } from '@/app/lib/svgPath';

// arousal=높이, valence=색(있을 때).
// 데스크탑: 호버로 십자선+툴팁. 모바일: 높이 축소 + 하단 스크럽 슬라이더(동일 정보).
interface ClimaxGraphProps {
  data: number[];        // arousal
  valence?: number[];    // valence (색)
  height?: number;
}

export default function ClimaxGraph({ data, valence, height = 380 }: ClimaxGraphProps) {
  // 모바일 감지 — 모바일은 높이를 줄이고 하단 슬라이더로 스크럽한다.
  // ClimaxGraph는 vector 로드 후 클라이언트에서만 마운트되므로 초기값을 window에서
  // 바로 읽어도 안전(SSR/하이드레이션 불일치 없음). effect는 변경 구독만 — setState를
  // effect 본문에서 동기 호출하지 않아 set-state-in-effect 규칙에 걸리지 않는다.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const W = 600;
  const H = isMobile ? 210 : height;
  const padX = 8;
  const padY = isMobile ? 40 : 64;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const toY = (val: number) => padY + innerH - ((val - min) / range) * innerH;
  const toX = (i: number) => padX + (i / (data.length - 1)) * innerW;

  const pts = data.map((val, i) => [toX(i), toY(val)]);
  const d = catmullRomPath(pts);
  const fillD = `${d} L${padX + innerW},${H} L${padX},${H} Z`;

  const stops = valence ? valenceGradientStops(valence) : [];
  const vUnit = valence ? valenceToUnit(valence) : [];
  const stroke = stops.length ? 'url(#cgValence)' : 'var(--accent)';

  const graphRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [thumbRatio, setThumbRatio] = useState(0);
  const [fading, setFading] = useState(false);
  const [drawn, setDrawn] = useState(false);

  // 데스크탑 호버 (모바일에선 슬라이더가 제어하므로 미사용)
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = graphRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(fx * (data.length - 1)));
  };

  // 모바일 스크럽: 슬라이더 트랙 기준 위치 → scene 인덱스. 손 뗌 후 1.2s 유지 + 0.4s 페이드.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const clearTimers = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    hideTimer.current = null;
    fadeTimer.current = null;
  };
  useEffect(() => () => clearTimers(), []);

  const scrubTo = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setThumbRatio(f);
    setHover(Math.round(f * (data.length - 1)));
  };
  const onScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    clearTimers();
    setFading(false);
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubTo(e.clientX);
  };
  const onScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    scrubTo(e.clientX);
  };
  const onScrubUp = () => {
    dragging.current = false;
    clearTimers();
    hideTimer.current = setTimeout(() => {
      setFading(true);
      fadeTimer.current = setTimeout(() => {
        setHover(null);
        setFading(false);
      }, 400);
    }, 1200);
  };

  const hx = hover !== null ? (toX(hover) / W) * 100 : 0;
  const hy = hover !== null ? (toY(data[hover]) / H) * 100 : 0;
  const progress = hover !== null ? Math.round((hover / (data.length - 1)) * 100) : 0;
  const peakPct = hover !== null ? Math.round(toDisplayScale(data)[hover]) : 0;
  const moodU = hover !== null && vUnit.length ? vUnit[hover] : null;
  const moodColor = moodU !== null ? valenceColorAt(moodU) : '#fff';
  const moodLabel = moodU === null ? '' : moodU < 0.33 ? '어두움' : moodU < 0.66 ? '중립' : '밝음';
  const tipLeft = Math.min(86, Math.max(14, hx));
  const tipBelow = hy < 16;

  return (
    <div style={{ width: '100%' }}>
      <div
        ref={graphRef}
        onMouseMove={isMobile ? undefined : onMove}
        onMouseLeave={isMobile ? undefined : () => setHover(null)}
        style={{ position: 'relative', width: '100%', height: H, cursor: isMobile ? 'default' : 'crosshair' }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className={drawn ? undefined : 'cg-draw'}
          onAnimationEnd={() => setDrawn(true)}
          style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id="cgFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.015" />
            </linearGradient>
            {stops.length > 0 && (
              <linearGradient id="cgValence" x1="0" y1="0" x2="1" y2="0">
                {stops.map((s, i) => (
                  <stop key={i} offset={`${(s.offset * 100).toFixed(1)}%`} stopColor={s.color} />
                ))}
              </linearGradient>
            )}
            <filter id="cgGlow" x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <path d={fillD} fill="url(#cgFill)" />
          <path
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            filter="url(#cgGlow)"
          />
        </svg>

        {hover !== null && (
          <div
            style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              opacity: fading ? 0 : 1, transition: 'opacity 0.4s ease',
            }}
          >
            <div style={{ position: 'absolute', left: `${hx}%`, top: 0, bottom: 0, width: 1, background: 'rgba(123,97,255,0.45)' }} />
            <div style={{ position: 'absolute', top: `${hy}%`, left: 0, right: 0, height: 1, background: 'rgba(123,97,255,0.45)' }} />
            <div style={{ position: 'absolute', left: `${hx}%`, top: `${hy}%`, transform: 'translate(-50%, -50%)', width: 11, height: 11, borderRadius: '50%', background: moodColor, boxShadow: `0 0 14px 4px ${moodColor}` }} />
            <div
              style={{
                position: 'absolute', left: `${tipLeft}%`, top: `${hy}%`,
                transform: tipBelow ? 'translate(-50%, 16px)' : 'translate(-50%, calc(-100% - 16px))',
                whiteSpace: 'nowrap',
                background: 'rgba(15,14,22,0.92)', border: '1px solid rgba(123,97,255,0.4)',
                borderRadius: 8, padding: '8px 12px', backdropFilter: 'blur(4px)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              }}
            >
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)' }}>진행도</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>{progress}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--accent)' }}>피크</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.2 }}>{peakPct}%</div>
                </div>
                {moodU !== null && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)' }}>분위기</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                      <span style={{ width: 11, height: 11, borderRadius: '50%', background: moodColor }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{moodLabel}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {isMobile && (
        <div
          ref={trackRef}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          style={{
            position: 'relative', height: 40, marginTop: 8,
            display: 'flex', alignItems: 'center',
            touchAction: 'none', cursor: 'pointer', userSelect: 'none',
          }}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.12)' }} />
          <div style={{ position: 'absolute', left: 0, width: `${thumbRatio * 100}%`, height: 4, borderRadius: 999, background: 'rgba(123,97,255,0.5)' }} />
          <div
            style={{
              position: 'absolute', left: `${thumbRatio * 100}%`, transform: 'translateX(-50%)',
              width: 18, height: 18, borderRadius: '50%',
              background: hover !== null ? moodColor : '#fff',
              boxShadow: `0 0 10px 2px ${hover !== null ? moodColor : 'rgba(255,255,255,0.45)'}`,
              border: '2px solid rgba(255,255,255,0.85)',
            }}
          />
        </div>
      )}
    </div>
  );
}
