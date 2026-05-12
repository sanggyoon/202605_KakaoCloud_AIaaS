'use client';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Play, Info, Star, Users, Film, Zap, Sparkles } from 'lucide-react';
import Link from 'next/link';


import { mockMovies } from '../../lib/data';
export default function MovieDetail() {
  const params = useParams();
  const router = useRouter();
  const movie = mockMovies.find(m => m.id === params.id);

  if (!movie) return <div className="min-h-screen bg-[#0B0B0E] flex items-center justify-center text-white font-bold">영화를 찾을 수 없어요. 😅</div>;

  // 비슷한 장르 추천 (현재 영화 제외)
  const primaryGenre = movie.genre.split('·')[0].trim();
  const similarMovies = mockMovies.filter(m => m.id !== movie.id && m.genre.includes(primaryGenre)).slice(0, 4);

  const handleBack = () => {
    // 뒤로가기 전 대시보드로 바로 가라는 징표 남기기
    sessionStorage.setItem('4k_cinema_pass', 'true');
    router.push('/');
  };

  return (
    <main className="min-h-screen bg-[#0B0B0E] text-white pb-32 overflow-x-hidden selection:bg-[#8B5CF6]">
      {/* 히어로 배경 */}
      <div className="relative h-[60vh] w-full overflow-hidden">
        <div className={`absolute inset-0 bg-gradient-to-b ${movie.gradient} opacity-60`} />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0E] via-transparent to-transparent" />
        
        <div className="relative z-10 max-w-[1200px] mx-auto px-8 h-full flex flex-col justify-end pb-12">
          <motion.button 
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
            onClick={handleBack}
            className="absolute top-12 left-8 flex items-center gap-2 text-gray-400 hover:text-white transition-colors group px-5 py-2.5 bg-white/5 rounded-full backdrop-blur-xl border border-white/10"
          >
            <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" /> 돌아가기
          </motion.button>

          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
            <span className="text-[#8B5CF6] font-black tracking-widest text-xs mb-3 block uppercase">{movie.genre}</span>
            <h1 className="text-7xl font-black mb-6 tracking-tighter leading-[0.9]">{movie.title}</h1>
            <div className="flex items-center gap-8 text-sm text-gray-400 font-bold bg-black/30 w-fit px-6 py-3 rounded-2xl backdrop-blur-md border border-white/5">
              <span>{movie.year}</span>
              <span className="flex items-center gap-1.5 text-[#F7E1B5]"><Star size={16} fill="currentColor" /> 도파민 95%</span>
              <span className="text-gray-600">|</span>
              <span>감독: {movie.dir}</span>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-8 grid grid-cols-1 lg:grid-cols-3 gap-16 mt-16">
        {/* 좌측: 줄거리 & 그래프 */}
        <div className="lg:col-span-2 space-y-16">
          <section>
            <div className="flex items-center gap-2 mb-6 text-[#A78BFA]">
              <Info size={22} />
              <h2 className="text-2xl font-bold">줄거리</h2>
            </div>
            <p className="text-gray-300 leading-relaxed text-xl break-keep font-medium opacity-90">
              {movie.desc}
            </p>
          </section>

          <section className="bg-[#111115] p-10 rounded-[40px] border border-white/5 shadow-2xl relative overflow-hidden group">
            <div className="flex items-center justify-between mb-10 relative z-10">
              <div className="flex items-center gap-3 text-[#8B5CF6]">
                <Zap size={24} fill="currentColor" />
                <h2 className="text-2xl font-bold italic">CLIMAX ANALYSIS</h2>
              </div>
              <span className="text-[10px] font-black text-gray-500 tracking-widest uppercase bg-white/5 px-3 py-1.5 rounded-lg">Real-time Data</span>
            </div>
            <div className="w-full h-48 bg-black/40 rounded-3xl relative overflow-hidden flex items-end px-6 border border-white/5">
               <svg viewBox="0 0 100 40" className="w-full h-full drop-shadow-[0_0_15px_rgba(139,92,246,0.4)]" preserveAspectRatio="none">
                 <path d="M0,40 Q10,38 20,35 T40,30 T50,25 T60,28 T70,15 T80,10 T90,20 L100,25 L100,40 L0,40 Z" fill="#8B5CF6" opacity="0.15" />
                 <path d="M0,40 Q10,38 20,35 T40,30 T50,25 T60,28 T70,15 T80,10 T90,20 L100,25" fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" />
               </svg>
            </div>
          </section>
        </div>

        {/*우측: 예고편(상단) & 출연진 */}
        <div className="space-y-12">
          {/* 공식 예고편 위로 이동*/}
          <section>
            <div className="flex items-center gap-2 mb-5 text-gray-300">
              <Play size={18} fill="currentColor" />
              <h2 className="text-lg font-bold">공식 예고편</h2>
            </div>
            <div className="aspect-video w-full bg-[#111115] rounded-3xl flex items-center justify-center border border-white/10 group cursor-pointer overflow-hidden relative shadow-2xl">
               <div className="absolute inset-0 bg-black/50 group-hover:bg-black/20 transition-colors" />
               <div className="w-16 h-16 bg-[#8B5CF6] rounded-full flex items-center justify-center shadow-2xl relative z-10 group-hover:scale-110 transition-transform duration-500">
                 <Play fill="white" size={24} className="ml-1" />
               </div>
            </div>
          </section>

          <div className="bg-[#111115] p-8 rounded-[32px] border border-white/5">
            <h3 className="flex items-center gap-2 text-xs font-black text-gray-500 mb-6 border-b border-white/5 pb-4 uppercase tracking-widest">
              <Users size={16} /> 출연진
            </h3>
            <div className="space-y-5">
              {movie.cast.split(',').map((name, i) => (
                <div key={i} className="flex items-center gap-4 group">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-700 group-hover:bg-[#8B5CF6] transition-colors" />
                  <span className="font-bold text-gray-300 group-hover:text-white transition-colors">{name.trim()}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#111115] p-8 rounded-[32px] border border-white/5">
            <h3 className="flex items-center gap-2 text-xs font-black text-gray-500 mb-6 border-b border-white/5 pb-4 uppercase tracking-widest">
              <Film size={16} /> 제작 정보
            </h3>
            <dl className="space-y-4">
              <div>
                <dt className="text-[10px] text-gray-600 mb-1 font-bold">감독</dt>
                <dd className="text-sm font-bold text-gray-200">{movie.dir}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-gray-600 mb-1 font-bold">장르</dt>
                <dd className="text-sm font-bold text-gray-200">{movie.genre}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {/* 비슷한 영화 추천 영역 부활! */}
      {similarMovies.length > 0 && (
        <div className="max-w-[1200px] mx-auto px-8 mt-24 border-t border-white/10 pt-20">
          <div className="flex items-center gap-3 mb-10">
            <Sparkles className="text-yellow-400" size={24} />
            <h2 className="text-3xl font-black text-white tracking-tight">이런 분위기의 영화는 어떠세요?</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {similarMovies.map((sm) => (
              <Link key={sm.id} href={`/movie/${sm.id}`} onClick={() => sessionStorage.setItem('4k_cinema_pass', 'true')}>
                <div className="group cursor-pointer">
                  <div className={`aspect-[2/3] w-full rounded-[32px] bg-gradient-to-br ${sm.gradient} border border-white/5 group-hover:border-[#8B5CF6]/50 group-hover:-translate-y-3 transition-all duration-500 p-6 flex flex-col justify-end shadow-2xl relative overflow-hidden`}>
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <h3 className="text-xl font-serif font-bold text-[#F7E1B5] drop-shadow-lg relative z-10 leading-tight">{sm.title}</h3>
                  </div>
                  <div className="mt-5 px-2">
                    <h4 className="font-bold text-base text-gray-200 truncate">{sm.title}</h4>
                    <p className="text-xs text-gray-500 font-bold mt-1">{sm.year} · {sm.genre.split('·')[0]}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}