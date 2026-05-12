'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Sparkles, SlidersHorizontal, Heart, Search, MousePointer2 } from 'lucide-react';

const GUIDE_STEPS = [
  { target: null, icon: Sparkles, title: '4K Cinema 시작하기', description: '영화의 클라이맥스 흐름을 분석하는 새로운 추천 엔진을 경험해 보세요.', buttonText: '튜토리얼 시작' },
  { target: '#header-area', icon: Search, title: '1. 맞춤 필터링', description: '검색창과 필터 버튼으로 연도, 장르를 자유롭게 조절하세요.', buttonText: '다음' },
  { target: '#random-pick-btn', icon: SlidersHorizontal, title: '2. 랜덤 추천', description: '무엇을 볼지 고민될 땐 랜덤 픽 버튼을 눌러보세요.', buttonText: '다음' },
  { target: null, icon: Heart, title: '3. 클라이맥스 그래프', description: '아래 포스터에 마우스를 올려 그래프가 나타나는지 확인해 보세요!', buttonText: '체험 완료, 시작하기' },
];

export default function Onboarding({ onFinish }: { onFinish: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const step = GUIDE_STEPS[currentStep];
      if (step.target) {
        const el = document.querySelector(step.target);
        if (el) setRect(el.getBoundingClientRect());
      } else {
        setRect(null);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [currentStep]);

  
  const step = GUIDE_STEPS[currentStep];
  const StepIcon = step.icon;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center pointer-events-none">
      <svg className="absolute inset-0 w-full h-full transition-all duration-500">
        <mask id="mask">
          <rect width="100%" height="100%" fill="white" />
          {rect && <rect x={rect.x - 10} y={rect.y - 10} width={rect.width + 20} height={rect.height + 20} rx="12" fill="black" />}
        </mask>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.85)" mask="url(#mask)" className="pointer-events-auto" />
      </svg>

      <AnimatePresence mode="wait">
        <motion.div key={currentStep} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-[420px] p-8 bg-[#111115] border border-[#6B4BF6]/50 rounded-3xl shadow-2xl relative pointer-events-auto">
          <div className="text-center">
            <p className="text-xs font-black text-[#A78BFA] tracking-widest uppercase mb-3">
               Tutorial {currentStep + 1} / {GUIDE_STEPS.length}
            </p>
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center justify-center gap-2">
              
              <StepIcon className="w-6 h-6 text-[#8B5CF6]" /> {step.title}
            </h2>
            <p className="text-sm text-gray-400 mb-6 leading-relaxed break-keep">{step.description}</p>

            
            {currentStep === 3 && (
              <div className="mb-8 flex justify-center">
                <div className="relative w-[160px] aspect-[2/3] rounded-xl bg-gradient-to-br from-[#4a148c] to-black overflow-hidden group border border-white/20 shadow-lg cursor-pointer">
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-[#F7E1B5] font-serif font-bold text-xl group-hover:opacity-0 transition-opacity duration-300">
                    <MousePointer2 className="w-8 h-8 mb-2 animate-bounce text-[#A78BFA]" />
                    Hover Me!
                  </div>
                  <div className="absolute bottom-0 left-0 w-full h-[60%] opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-end">
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0E] via-[#0B0B0E]/80 to-transparent" />
                    <svg viewBox="0 0 100 40" className="w-full h-full relative z-0 drop-shadow-[0_0_8px_rgba(139,92,246,0.8)]" preserveAspectRatio="none">
                       <path d="M0,40 Q10,35 20,38 T40,25 T60,15 T80,20 T100,5 L100,40 L0,40 Z" fill="#8B5CF6" opacity="0.3" />
                       <path d="M0,40 Q10,35 20,38 T40,25 T60,15 T80,20 T100,5" fill="none" stroke="#A78BFA" strokeWidth="2" />
                    </svg>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-4">
              <button onClick={onFinish} className="px-4 py-4 text-sm font-bold text-gray-500 hover:text-white transition-colors">스킵</button>
              <button onClick={() => currentStep < GUIDE_STEPS.length - 1 ? setCurrentStep(c => c + 1) : onFinish()} className="flex-1 py-4 bg-[#8B5CF6] text-white rounded-xl font-bold hover:bg-[#7C3AED] transition-all active:scale-95">
                {step.buttonText}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}