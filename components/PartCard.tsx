
import React from 'react';
import { PartRecord } from '../types';

interface PartCardProps {
  part: PartRecord;
  similarity?: number;
  reason?: string;
  onClick?: () => void;
  onAddPhoto?: () => void;
  onEdit?: () => void;
  isHighConfidence?: boolean;
}

const PartCard: React.FC<PartCardProps> = ({ part, similarity, reason, onClick, onAddPhoto, onEdit, isHighConfidence }) => {
  const primaryImage = part.imageUrls && part.imageUrls.length > 0 ? part.imageUrls[0] : null;
  const angleCount = part.imageUrls?.length || 0;

  return (
    <div 
      onClick={onClick}
      className={`glass-card rounded-xl shadow-xl overflow-hidden hover:border-zinc-500 transition-all duration-300 cursor-pointer group relative ${
        isHighConfidence ? 'ring-1 ring-amber-500/50 border-amber-500/30' : ''
      }`}
    >
      <div className="relative aspect-square overflow-hidden bg-zinc-900/50">
        {primaryImage ? (
          <img 
            src={primaryImage} 
            alt={part.partName} 
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 opacity-80 group-hover:opacity-100"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600 p-4 text-center">
            <svg className="h-8 w-8 mb-2 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" strokeWidth="2"/></svg>
            <span className="text-[8px] font-bold uppercase tracking-widest">No Photos (无照片)</span>
          </div>
        )}
        
        {/* Info Overlay on Photo */}
        <div className="absolute inset-x-0 bottom-0 bg-black/80 backdrop-blur-sm p-2 text-[8px] leading-tight flex flex-col gap-0.5 border-t border-white/10 group-hover:bg-black transition-all">
          <div className="flex justify-between font-bold">
             <span className="text-amber-500 truncate mr-1 uppercase">{part.partName}</span>
             <span className="text-zinc-400">#{part.partNumber}</span>
          </div>
          <div className="flex flex-col text-zinc-500 font-medium">
             <div className="flex flex-wrap gap-1 text-amber-500/70">
                {part.models?.map(m => <span key={m} className="bg-white/5 px-1 rounded-sm">{m}</span>)}
             </div>
             <div className="flex justify-between mt-1">
               <span>{part.color}</span>
               <span className="text-zinc-400">WS: {part.workstation}</span>
             </div>
          </div>
        </div>

        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {angleCount > 0 && (
            <div className="bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded text-[8px] font-bold text-white border border-white/10 uppercase tracking-tighter">
              {angleCount} Angles (角度)
            </div>
          )}
          <div className="flex gap-1">
            <button 
              onClick={(e) => { e.stopPropagation(); onAddPhoto?.(); }}
              className="bg-amber-500 hover:bg-amber-400 text-black px-1.5 py-0.5 rounded text-[8px] font-bold border border-black/10 uppercase tracking-tighter transition-colors flex items-center gap-1"
            >
              <svg className="h-2 w-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 4v16m8-8H4" strokeWidth="3"/></svg>
              Photo (照片)
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
              className="bg-zinc-700 hover:bg-zinc-600 text-white px-1.5 py-0.5 rounded text-[8px] font-bold border border-white/10 uppercase tracking-tighter transition-colors flex items-center gap-1"
            >
              Edit (编辑)
            </button>
          </div>
        </div>

        {similarity !== undefined && (
          <div className={`absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-bold tracking-widest uppercase ${
            similarity >= 70 ? 'bg-amber-500 text-black' : 'bg-zinc-700 text-white'
          }`}>
            {similarity}% Match (匹配)
          </div>
        )}
      </div>
      <div className="p-4 hidden group-hover:block transition-all animate-in fade-in slide-in-from-top-1 duration-200">
        {reason && (
          <p className="text-[11px] text-zinc-400 italic line-clamp-2 leading-tight">
            "{reason}"
          </p>
        )}
      </div>
    </div>
  );
};

export default PartCard;
