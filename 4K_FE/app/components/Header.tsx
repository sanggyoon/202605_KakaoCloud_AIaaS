'use client';
import { Search, Sparkles, SlidersHorizontal } from 'lucide-react';

interface HeaderProps {
  onRandomClick: () => void;
  onFilterToggle: () => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
}

export default function Header({ onRandomClick, onFilterToggle, searchQuery, setSearchQuery }: HeaderProps) {
  return (
    <header className="w-full h-20 px-8 flex items-center justify-between border-b border-white/5 bg-[#0B0B0E] sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <Sparkles className="text-[#6B4BF6] w-8 h-8" />
        <h1 className="text-xl font-bold text-white">4K Cinema</h1>
      </div>

      <div className="flex-1 max-w-2xl mx-10 relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
        <input 
          type="text" 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="영화 제목 또는 장르(SF, 드라마 등)를 입력하세요..." 
          className="w-full h-11 bg-[#15151A] border border-white/10 rounded-xl pl-11 pr-4 text-sm focus:border-[#6B4BF6] text-white outline-none transition-all"
        />
      </div>

      <div className="flex items-center gap-3">
        {/* id="filter-toggle-btn" 확실하게 부여 */}
        <button id="filter-toggle-btn" onClick={onFilterToggle} className="flex items-center gap-2 px-5 py-2.5 bg-[#15151A] border border-white/10 text-white rounded-xl text-sm font-medium hover:bg-white/5 transition-all">
          <SlidersHorizontal size={16} /> 필터
        </button>
        <button onClick={onRandomClick} className="flex items-center gap-2 px-5 py-2.5 bg-[#8B5CF6] text-white rounded-xl text-sm font-bold shadow-[0_0_20px_rgba(139,92,246,0.3)]">
          랜덤 추천
        </button>
      </div>
    </header>
  );
}