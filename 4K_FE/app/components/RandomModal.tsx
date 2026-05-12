'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { X, RotateCcw, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function RandomModal({ onClose, movies }: { onClose: () => void, movies: any[] }) {
  const [result, setResult] = useState(movies[0]);
  const [isSpinning, setIsSpinning] = useState(true);

  const startShuffle = () => {
    setIsSpinning(true);
    let interval = setInterval(() => setResult(movies[Math.floor(Math.random() * movies.length)]), 60);
    setTimeout(() => { clearInterval(interval); setIsSpinning(false); }, 1800);
    return interval;
  };

  useEffect(() => {
    const interval = startShuffle();
    return () => clearInterval(interval);
  }, [movies]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-[600px] bg-[#111115] border border-[#6B4BF6]/30 rounded-3xl p-8 shadow-[0_0_80px_rgba(107,75,246,0.15)] overflow-hidden">
        {isSpinning && <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#8B5CF6]/10 to-transparent w-full h-[20%] animate-[scan_1s_ease-in-out_infinite]" />}
        <button onClick={onClose} className="absolute top-5 right-5 text-gray-500 hover:text-white z-10"><X size={20} /></button>
        <div className="mb-8 relative z-10">
          <p className="text-[#A78BFA] font-bold text-[10px] tracking-widest uppercase mb-1 animate-pulse">4K Cinema AI 분석 중</p>
          <h2 className="text-3xl font-bold text-white tracking-tight">당신을 위한 랜덤 추천</h2>
        </div>
        <div className="flex gap-8 mb-8 h-[280px] relative z-10">
          <div className={`w-[180px] h-full rounded-2xl overflow-hidden relative bg-gradient-to-br ${result.gradient} border border-white/10 shadow-2xl`}>
             <h3 className="absolute bottom-4 left-4 text-2xl font-serif font-bold text-[#F7E1B5] z-10">{result.engTitle || result.title}</h3>
          </div>
          <div className="flex-1 flex flex-col justify-center">
            <h3 className={`text-[32px] font-black tracking-tight mb-2 ${isSpinning ? 'text-gray-600 blur-[2px]' : 'text-white'}`}>{result.title}</h3>
            {!isSpinning && (
              <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
                <p className="text-sm text-gray-400 mb-5">{result.year} · {result.genre.split(' · ')[0]}</p>
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex items-center bg-white/5 border border-white/10 rounded-full"><span className="px-3 py-1.5 text-[10px] text-gray-400 bg-white/5">D-SCORE</span><span className="px-3 py-1.5 text-xs font-black text-[#A78BFA]">92</span></div>
                </div>
                <div className="w-full h-20 border-b border-white/10">
                   <svg viewBox="0 0 100 40" className="w-full h-full" preserveAspectRatio="none">
                      <path d="M0,40 Q10,38 20,35 T40,30 T50,25 T60,28 T70,15 T80,10 T90,20 L100,25 L100,40 L0,40 Z" fill="#8B5CF6" opacity="0.2" />
                      <path d="M0,40 Q10,38 20,35 T40,30 T50,25 T60,28 T70,15 T80,10 T90,20 L100,25" fill="none" stroke="#8B5CF6" strokeWidth="1.5" />
                   </svg>
                </div>
              </motion.div>
            )}
          </div>
        </div>
        <div className="flex gap-3 relative z-10">
          <button onClick={startShuffle} className="flex-1 py-3.5 flex items-center justify-center gap-2 border border-white/10 hover:bg-white/5 text-gray-300 rounded-xl text-sm font-medium"><RotateCcw size={16} /> 다시 뽑기</button>
          
          {/* 상세보기 클릭 시 징표 남기기 */}
          <Link 
            href={`/movie/${result.id}`} 
            onClick={() => sessionStorage.setItem('back_to_dashboard', 'true')}
            className="flex-1"
          >
            <button disabled={isSpinning} className={`w-full py-3.5 flex items-center justify-center gap-2 rounded-xl text-sm font-bold ${isSpinning ? 'bg-white/5 text-gray-500 pointer-events-none' : 'bg-[#8B5CF6] hover:bg-[#7C3AED] text-white'}`}>상세보기 <ArrowRight size={16} /></button>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}