'use client';
import { motion } from 'framer-motion';
import { Sparkles, Activity, TrendingUp, Play } from 'lucide-react';

export default function Intro({ onStart }: { onStart: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-[#0B0B0E] text-white overflow-y-auto"
    >
      {/* 배경 은은한 보라색 광원 효과 */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#6B4BF6] rounded-full blur-[200px] opacity-15 pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center max-w-4xl px-8 py-12 text-center">
        
        {/* 상단 로고 및 타이틀 */}
        <motion.div
          initial={{ scale: 0.8, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="w-20 h-20 bg-[#6B4BF6] rounded-3xl flex items-center justify-center shadow-[0_0_50px_rgba(107,75,246,0.4)] mb-8"
        >
          <Sparkles className="text-white w-10 h-10" />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-5xl md:text-6xl font-black tracking-tight mb-4"
        >
          4K Cinema
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-[#A78BFA] font-bold tracking-[0.3em] uppercase text-sm md:text-base mb-16"
        >
          Climax-Based Recommendation
        </motion.p>

        {/* 3가지 핵심 기능 설명 카드 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16 w-full"
        >
          <div className="flex flex-col items-center p-8 bg-[#15151A] border border-white/10 rounded-3xl shadow-xl">
            <div className="w-14 h-14 bg-[#2A1B54] rounded-full flex items-center justify-center mb-6 border border-[#6B4BF6]/30">
              <Activity className="text-[#8B5CF6] w-6 h-6" />
            </div>
            <h3 className="font-bold text-lg mb-3 text-white">도파민 흐름 분석</h3>
            <p className="text-sm text-gray-400 leading-relaxed">자막 데이터를 AI로 분석하여 영화의 긴장감 곡선과 클라이맥스를 시각화합니다.</p>
          </div>

          <div className="flex flex-col items-center p-8 bg-[#15151A] border border-white/10 rounded-3xl shadow-xl">
            <div className="w-14 h-14 bg-[#2A1B54] rounded-full flex items-center justify-center mb-6 border border-[#6B4BF6]/30">
              <TrendingUp className="text-[#8B5CF6] w-6 h-6" />
            </div>
            <h3 className="font-bold text-lg mb-3 text-white">클라이맥스 매칭</h3>
            <p className="text-sm text-gray-400 leading-relaxed">당신의 현재 기분과 완벽하게 맞아떨어지는 가장 짜릿한 절정의 영화를 찾아냅니다.</p>
          </div>

          <div className="flex flex-col items-center p-8 bg-[#15151A] border border-white/10 rounded-3xl shadow-xl">
            <div className="w-14 h-14 bg-[#2A1B54] rounded-full flex items-center justify-center mb-6 border border-[#6B4BF6]/30">
              <Play className="text-[#8B5CF6] w-6 h-6" />
            </div>
            <h3 className="font-bold text-lg mb-3 text-white">즉시 몰입 셔플</h3>
            <p className="text-sm text-gray-400 leading-relaxed">무엇을 볼지 고민되나요? 애니메이션과 함께 최적의 영화를 단 1초 만에 픽해드립니다.</p>
          </div>
        </motion.div>

        {/* 시작 버튼 */}
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 }}
          onClick={onStart}
          className="px-12 py-5 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-2xl text-lg font-bold transition-all shadow-[0_0_30px_rgba(139,92,246,0.3)] hover:shadow-[0_0_50px_rgba(139,92,246,0.5)] flex items-center gap-3 active:scale-95"
        >
          시작하기 <Sparkles size={20} />
        </motion.button>
        
      </div>
    </motion.div>
  );
}