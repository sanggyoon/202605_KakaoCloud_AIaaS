'use client';
import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import Header from './components/Header';
import FilterBar from './components/FilterBar';
import MovieCard from './components/MovieCard';
import RandomModal from './components/RandomModal';
import Onboarding from './components/Onboarding';
import Intro from './components/Intro';
import { CheckCircle2, Zap, PlayCircle } from 'lucide-react';

// 데이터 불러오는 경로 (수정 완료)
import { mockMovies } from './lib/data';

const CinematicAmbient = () => (
  <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-[#0B0B0E]">
    <div className="absolute inset-0 opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]" />
    <motion.div animate={{ x: [0, 50, 0], y: [0, 30, 0] }} transition={{ duration: 15, repeat: Infinity, ease: "linear" }} className="absolute -top-[20%] -left-[10%] w-[70vw] h-[70vw] bg-[#6B4BF6]/10 rounded-full blur-[150px]" />
    <motion.div animate={{ x: [0, -40, 0], y: [0, -50, 0] }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }} className="absolute -bottom-[20%] -right-[10%] w-[60vw] h-[60vw] bg-[#A78BFA]/10 rounded-full blur-[130px]" />
  </div>
);

export default function Home() {
  const [appState, setAppState] = useState<'loading' | 'intro' | 'onboarding' | 'dashboard'>('loading');
  const [showRandom, setShowRandom] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeGenre, setActiveGenre] = useState("전체");
  const [activeSituation, setActiveSituation] = useState("전체");
  const [yearRange, setYearRange] = useState<[number, number]>([2010, 2024]);
  const [likedMovies, setLikedMovies] = useState<string[]>([]);
  const [dislikedMovies, setDislikedMovies] = useState<string[]>([]);
  const [toastMsg, setToastMsg] = useState("");

  // 훅(Hook) 1: 초기 설정
  useEffect(() => {
    setShowRandom(false);
    
    // 브라우저 뒤로가기 로직
    const hasSeenIntro = sessionStorage.getItem('has_seen_intro');
    if (hasSeenIntro === 'true') {
      setAppState('dashboard');
    } else {
      setAppState('intro');
    }

    const savedLikes = localStorage.getItem('4k_likes');
    const savedDislikes = localStorage.getItem('4k_dislikes');
    if (savedLikes) setLikedMovies(JSON.parse(savedLikes));
    if (savedDislikes) setDislikedMovies(JSON.parse(savedDislikes));
  }, []);

  // 훅(Hook) 2: 좋아요 상태 저장
  useEffect(() => {
    localStorage.setItem('4k_likes', JSON.stringify(likedMovies));
    localStorage.setItem('4k_dislikes', JSON.stringify(dislikedMovies));
  }, [likedMovies, dislikedMovies]);

  const handleResetFilters = () => {
    setSearchQuery(""); setActiveGenre("전체"); setActiveSituation("전체"); setYearRange([2010, 2024]);
    setLikedMovies([]); dislikedMovies.length > 0 && setDislikedMovies([]);
    setToastMsg("모든 필터가 초기화되었습니다.");
    setTimeout(() => setToastMsg(""), 2000);
  };

  const handleStartApp = () => setAppState('onboarding');
  
  const handleFinishOnboarding = () => {
    sessionStorage.setItem('has_seen_intro', 'true');
    setAppState('dashboard');
  };

  // 훅(Hook) 3: 영화 필터링
  const filteredMovies = useMemo(() => {
    return mockMovies.filter((movie) => {
      const q = searchQuery.toLowerCase();
      const matchSearch = movie.title.includes(q) || movie.engTitle.toLowerCase().includes(q) || movie.genre.includes(q);
      const matchGenre = activeGenre === '전체' ? true : movie.genre.includes(activeGenre);
      const matchYear = parseInt(movie.year) >= yearRange[0] && parseInt(movie.year) <= yearRange[1];
      return matchSearch && matchGenre && matchYear;
    });
  }, [searchQuery, activeGenre, yearRange]);

  const isFiltering = searchQuery !== "" || activeGenre !== "전체" || activeSituation !== "전체" || yearRange[0] !== 2010 || yearRange[1] !== 2024;

  
  if (appState === 'loading') return <main className="min-h-screen bg-[#0B0B0E]"></main>;

  return (
    <main className="min-h-screen bg-[#0B0B0E] pb-32 selection:bg-[#8B5CF6] overflow-x-hidden relative">
      <CinematicAmbient />
      <AnimatePresence>{appState === 'intro' && <Intro onStart={handleStartApp} key="intro" />}</AnimatePresence>

      <div className="relative z-10 w-full" id="header-area">
        <Header onRandomClick={() => setShowRandom(true)} onFilterToggle={() => setIsFilterOpen(!isFilterOpen)} searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
        <div className="max-w-[1400px] mx-auto px-8 pt-8">
          <AnimatePresence>
            {isFilterOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                <FilterBar 
                  activeGenre={activeGenre} setActiveGenre={setActiveGenre} activeSituation={activeSituation} setActiveSituation={setActiveSituation}
                  yearRange={yearRange} setYearRange={setYearRange} likedMovies={likedMovies} dislikedMovies={dislikedMovies}
                  onRemoveLike={(t)=>setLikedMovies(l=>l.filter(x=>x!==t))} onRemoveDislike={(t)=>setDislikedMovies(d=>d.filter(x=>x!==t))}
                  onReset={handleResetFilters} onSearch={() => { setToastMsg("조건에 맞는 영화를 검색합니다."); setTimeout(()=>setToastMsg(""), 2000); }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="relative z-10 max-w-[1400px] mx-auto px-8 mt-12">
        <div className="mb-10 flex items-end justify-between border-b border-white/5 pb-6">
          <div className="flex flex-col gap-1">
             <div className="flex items-center gap-2 text-[#A78BFA] text-[12px] font-bold tracking-wide">
               <Zap size={14} fill="currentColor" /> {isFiltering ? "맞춤 검색 결과" : "전체 목록"}
             </div>
             <h2 className="text-3xl font-black text-white tracking-tight">{isFiltering ? "취향 저격 영화 리스트" : "오늘의 추천 영화"}</h2>
          </div>
          <button onClick={() => setAppState('onboarding')} className="text-xs text-gray-500 hover:text-white transition-colors flex items-center gap-2 border-b border-transparent hover:border-white pb-1">
            <PlayCircle size={14} /> 가이드 다시보기
          </button>
        </div>
        
        <motion.div layout className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-12" id="movie-list">
          <AnimatePresence>
            {filteredMovies.map((m, index) => (
              <motion.div 
                key={m.id} layout 
                initial={{ opacity: 0, y: 30, scale: 0.95 }} 
                animate={{ opacity: 1, y: 0, scale: 1 }} 
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.4, delay: index * 0.05 }}
              >
                <MovieCard 
                  {...m} 
                  isLiked={likedMovies.includes(m.title)}
                  isDisliked={dislikedMovies.includes(m.title)}
                  onToggleLike={(t)=>setLikedMovies(l=>l.includes(t)?l.filter(x=>x!==t):[...l,t])}
                  onToggleDislike={(t)=>setDislikedMovies(d=>d.includes(t)?d.filter(x=>x!==t):[...d,t])}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      </div>

      {appState === 'onboarding' && <Onboarding onFinish={handleFinishOnboarding} />}
      <AnimatePresence>{showRandom && <RandomModal onClose={() => setShowRandom(false)} movies={filteredMovies.length > 0 ? filteredMovies : mockMovies} />}</AnimatePresence>
      <AnimatePresence>
        {toastMsg && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }} className="fixed bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-[#1A1A1E] border border-[#6B4BF6]/50 text-white px-8 py-4 rounded-2xl shadow-2xl z-[100] font-bold text-sm">
            <CheckCircle2 className="text-[#8B5CF6] w-5 h-5" /> {toastMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}