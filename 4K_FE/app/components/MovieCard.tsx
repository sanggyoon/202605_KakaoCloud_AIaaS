'use client';
import { Heart, ThumbsDown } from 'lucide-react';
import Link from 'next/link';

interface MovieCardProps {
  id: string; title: string; genre: string; year: string; gradient: string;
  isLiked: boolean; isDisliked: boolean;
  onToggleLike: (title: string) => void; onToggleDislike: (title: string) => void;
}

export default function MovieCard({ id, title, genre, year, gradient, isLiked, isDisliked, onToggleLike, onToggleDislike }: MovieCardProps) {
  
  const handleLike = (e: React.MouseEvent) => { e.preventDefault(); onToggleLike(title); };
  const handleDislike = (e: React.MouseEvent) => { e.preventDefault(); onToggleDislike(title); };

  return (
    <Link 
      href={`/movie/${id}`} 
      
      onClick={() => sessionStorage.setItem('4k_cinema_pass', 'true')}
    >
      <div className="flex flex-col gap-3 group cursor-pointer hover:-translate-y-2 transition-all duration-500">
        <div className={`relative aspect-[2/3] w-full rounded-2xl overflow-hidden bg-gradient-to-br ${gradient} p-4 flex flex-col justify-between border border-white/5 group-hover:border-[#8B5CF6]/50 transition-all shadow-2xl`}>
          <div className="self-start px-2 py-1 bg-black/40 backdrop-blur-md rounded text-[10px] font-black text-gray-400 z-10">{year}</div>
          <h3 className="text-2xl font-serif font-bold text-[#F7E1B5] leading-tight drop-shadow-lg z-10 group-hover:scale-105 transition-transform duration-500">{title}</h3>
          
          {}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
          
          <div className="absolute bottom-0 left-0 w-full h-[60%] opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-end">
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0E] via-[#0B0B0E]/80 to-transparent"></div>
            <svg viewBox="0 0 100 40" className="w-full h-full relative z-0 drop-shadow-[0_0_10px_rgba(139,92,246,0.6)]" preserveAspectRatio="none">
               <path d="M0,40 Q10,35 20,38 T40,25 T60,15 T80,20 T100,5 L100,40 L0,40 Z" fill="#8B5CF6" opacity="0.3" />
               <path d="M0,40 Q10,35 20,38 T40,25 T60,15 T80,20 T100,5" fill="none" stroke="#A78BFA" strokeWidth="1.5" />
            </svg>
          </div>
        </div>
        
        <div className="px-1">
          <h4 className="text-sm font-bold text-gray-200 mb-1 truncate group-hover:text-white">{title}</h4>
          <p className="text-[10px] text-gray-500 font-medium mb-3">{genre}</p>
          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
            <button onClick={handleLike} className={`flex-1 h-8 flex items-center justify-center gap-1.5 rounded-lg border transition-all text-[11px] ${isLiked ? 'bg-[#2A1B54] border-[#8B5CF6] text-[#A78BFA]' : 'border-white/10 hover:bg-white/5 text-gray-500'}`}>
              <Heart size={12} className={isLiked ? "fill-current" : ""} /> 선호
            </button>
            <button onClick={handleDislike} className={`flex-1 h-8 flex items-center justify-center gap-1.5 rounded-lg border transition-all text-[11px] ${isDisliked ? 'bg-red-950/30 border-red-500/30 text-red-400' : 'border-white/10 hover:bg-white/5 text-gray-500'}`}>
              <ThumbsDown size={12} className={isDisliked ? "fill-current" : ""} /> 제외
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}