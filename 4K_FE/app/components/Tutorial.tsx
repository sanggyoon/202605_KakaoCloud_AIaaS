'use client';

// Peakly 온보딩 튜토리얼 — 중앙 모달 캐러셀(5단계) + 단계별 자체 완결형 데모.
// 데모는 라이브 데이터를 fetch하지 않고 정적 더미/SVG로 구성한다.
import { useState } from 'react';
import MiniGraph from './MiniGraph';

interface TutorialProps {
  step: number;
  onNext: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

// 클라이맥스 곡선 더미 (arousal). 촘촘한 굴곡으로 실제 곡선 느낌.
const DEMO_AROUSAL = [
  6, 30, 14, 40, 20, 46, 26, 52, 18, 44, 33, 58, 12, 48, 30, 54,
  22, 64, 40, 78, 30, 60, 44, 88, 28, 56, 70, 95, 38, 62, 26, 50,
];
// 분위기 더미 (valence). 0~1 정규화 전 임의 스케일 — 색 흐름 표현용.
const DEMO_VALENCE = [
  2, 3, 2, 5, 3, 6, 4, 7, 3, 6, 5, 8, 3, 7, 5, 9,
  4, 8, 6, 9, 5, 7, 6, 9, 4, 7, 8, 9, 5, 7, 4, 6,
];

// 단계 메타. demo는 step 인덱스로 스위치한다(아래 렌더).
const STEPS = [
  {
    label: 'STEP 1 / 5',
    title: 'Peakly에 오신 걸 환영합니다',
    desc: '영화의 감정 흐름을 선으로 그려, 당신의 클라이맥스에 맞는 영화를 찾아드려요.',
    action: '시작하기',
  },
  {
    label: 'STEP 2 / 5',
    title: '감정을 선으로 읽다',
    desc: '높이는 감정의 고조, 색은 분위기를 나타냅니다. 어두운 분위기에서 밝은 분위기까지.',
    action: '다음',
  },
  {
    label: 'STEP 3 / 5',
    title: '원하는 조건으로 좁히기',
    desc: '제목 검색, 연도 범위, 선호·비선호 장르, 선호·비선호 영화로 추천 풀을 좁힙니다.',
    action: '다음',
  },
  {
    label: 'STEP 4 / 5',
    title: '고민될 땐 랜덤픽',
    desc: '무엇을 볼지 모르겠다면, 전체 DB에서 무작위로 한 편을 골라드려요.',
    action: '다음',
  },
  {
    label: 'STEP 5 / 5',
    title: '더 깊이: 클라이맥스 커브',
    desc: '포스터를 누르면 전체 감정 곡선과 비슷한 패턴의 영화까지 볼 수 있어요.',
    action: '시작하기',
  },
];

export default function Tutorial({ step, onNext, onSkip, onComplete }: TutorialProps) {
  const current = STEPS[step];
  // 임시 렌더 — Task 3에서 교체
  return (
    <div data-tutorial-placeholder style={{ position: 'fixed', inset: 0, zIndex: 41 }}>
      {current.title}
      <button onClick={step === STEPS.length - 1 ? onComplete : onNext}>{current.action}</button>
      <button onClick={onSkip}>스킵</button>
    </div>
  );
}
