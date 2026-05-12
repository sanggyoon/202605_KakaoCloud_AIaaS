'use client';
import { X, Search, RotateCcw } from 'lucide-react';

interface FilterBarProps {
  activeGenre: string; setActiveGenre: (val: string) => void;
  activeSituation: string; setActiveSituation: (val: string) => void;
  yearRange: [number, number]; setYearRange: (val: [number, number]) => void;
  likedMovies: string[]; dislikedMovies: string[];
  onRemoveLike: (title: string) => void; 
  onRemoveDislike: (title: string) => void;
  onReset: () => void;
  onSearch: () => void;
}

export default function FilterBar({ 
  activeGenre, setActiveGenre, 
  activeSituation, setActiveSituation, 
  yearRange, setYearRange, 
  likedMovies, dislikedMovies, 
  onRemoveLike, onRemoveDislike, 
  onReset, onSearch 
}: FilterBarProps) {
  
  const genres = ['SF', '드라마', '스릴러', '액션', '코미디', '미스터리', '음악', '어드벤처'];
  // 
  const situations = ['몰입이 필요한 밤', '잠 안 오는 새벽', '연인과 함께', '가족과 오순도순', '함께 웃고 싶을 때', '스트레스 해소'];
  
  const MIN_YEAR = 2010;
  const MAX_YEAR = 2024;
  const leftPercent = ((yearRange[0] - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)) * 100;
  const rightPercent = ((yearRange[1] - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)) * 100;

  return (
    <div id="filter-bar" className="w-full mb-12 space-y-7 animate-in slide-in-from-top-4 fade-in duration-300 bg-[#111115] p-8 rounded-3xl border border-white/5 shadow-2xl relative z-40">
      
      {/* 1. 연도 설정 */}
      <div className="flex items-center gap-8">
        <span className="text-sm font-bold text-gray-500 w-12 shrink-0">연도</span>
        <div className="flex-1 relative h-1 max-w-[600px] ml-2 flex items-center">
          <div className="absolute w-full flex justify-between -top-7 text-sm font-bold text-[#A78BFA]">
            <span>{yearRange[0]}</span><span>{yearRange[1]}</span>
          </div>
          <div className="absolute w-full h-1 bg-gray-800 rounded-full" />
          <div className="absolute h-1 bg-[#8B5CF6] rounded-full shadow-[0_0_10px_rgba(107,75,246,0.5)]" style={{ left: `${leftPercent}%`, right: `${100 - rightPercent}%` }} />
          <input type="range" min={MIN_YEAR} max={MAX_YEAR} value={yearRange[0]} onChange={(e) => setYearRange([Math.min(Number(e.target.value), yearRange[1] - 1), yearRange[1]])} className="absolute w-full h-1 opacity-0 cursor-pointer pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 z-30" />
          <input type="range" min={MIN_YEAR} max={MAX_YEAR} value={yearRange[1]} onChange={(e) => setYearRange([yearRange[0], Math.max(Number(e.target.value), yearRange[0] + 1)])} className="absolute w-full h-1 opacity-0 cursor-pointer pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 z-30" />
          <div className="absolute w-4 h-4 bg-[#0B0B0E] rounded-full border-[3px] border-[#A78BFA] pointer-events-none z-20" style={{ left: `calc(${leftPercent}% - 8px)` }} />
          <div className="absolute w-4 h-4 bg-[#0B0B0E] rounded-full border-[3px] border-[#A78BFA] pointer-events-none z-20" style={{ left: `calc(${rightPercent}% - 8px)` }} />
        </div>
      </div>

      {/* 2. 장르 */}
      <div className="flex items-center gap-8 border-t border-white/5 pt-7">
        <span className="text-sm font-bold text-gray-500 w-12">장르</span>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setActiveGenre('전체')} className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${activeGenre === '전체' ? 'bg-[#8B5CF6] text-white shadow-[0_0_10px_rgba(139,92,246,0.4)]' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>전체</button>
          {genres.map(g => (
            <button key={g} onClick={() => setActiveGenre(g)} className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${activeGenre === g ? 'bg-[#8B5CF6] text-white shadow-[0_0_10px_rgba(139,92,246,0.4)]' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>{g}</button>
          ))}
        </div>
      </div>

      {/* 3. 상황 (감성적으로 교체됨) */}
      <div className="flex items-center gap-8 border-t border-white/5 pt-7">
        <span className="text-sm font-bold text-gray-500 w-12">상황</span>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setActiveSituation('전체')} className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${activeSituation === '전체' ? 'bg-[#8B5CF6] text-white shadow-[0_0_10px_rgba(139,92,246,0.4)]' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>전체</button>
          {situations.map(s => (
            <button key={s} onClick={() => setActiveSituation(s)} className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${activeSituation === s ? 'bg-[#8B5CF6] text-white shadow-[0_0_10px_rgba(139,92,246,0.4)]' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>{s}</button>
          ))}
        </div>
      </div>

      {/* 4. 선호 기록 */}
      <div className="flex items-center gap-8 border-t border-white/5 pt-7">
        <span className="text-sm font-bold text-[#A78BFA] w-12">선호</span>
        <div className="flex gap-2 flex-wrap min-h-[40px] items-center">
          {likedMovies.length > 0 ? likedMovies.map(title => (
            <button key={title} onClick={() => onRemoveLike(title)} className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#2A1B54] border border-[#6B4BF6] text-white text-xs hover:bg-red-900/50 hover:border-red-500 group animate-in zoom-in duration-200">
              {title} <X size={12} className="text-gray-400 group-hover:text-red-400" />
            </button>
          )) : <span className="text-gray-700 text-xs flex items-center italic">선택된 영화가 없습니다</span>}
        </div>
      </div>

      {/* 5. 비선호 기록 */}
      <div className="flex items-center gap-8 border-t border-white/5 pt-7">
        <span className="text-sm font-bold text-red-500/70 w-12">비선호</span>
        <div className="flex gap-2 flex-wrap min-h-[40px] items-center">
          {dislikedMovies.length > 0 ? dislikedMovies.map(title => (
            <button key={title} onClick={() => onRemoveDislike(title)} className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-red-950/20 border border-red-500/30 text-white text-xs hover:bg-red-900/50 hover:border-red-500 group animate-in zoom-in duration-200">
              {title} <X size={12} className="text-gray-400 group-hover:text-red-400" />
            </button>
          )) : <span className="text-gray-700 text-xs flex items-center italic">제외된 영화가 없습니다</span>}
        </div>
      </div>

      {/* 6. 초기화 및 검색 버튼 */}
      <div className="flex justify-end pt-8 border-t border-white/5 mt-7">
        <div className="flex gap-3">
          <button onClick={onReset} className="px-6 py-2.5 border border-white/10 text-gray-400 rounded-xl text-sm font-bold hover:bg-white/5 hover:text-white transition-all flex items-center gap-2 active:scale-95">
            <RotateCcw size={14} /> 필터 초기화
          </button>
          <button onClick={onSearch} className="px-8 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(139,92,246,0.4)] active:scale-95 group">
            <Search size={16} className="group-hover:animate-bounce" /> 조건 검색
          </button>
        </div>
      </div>
    </div>
  );
}