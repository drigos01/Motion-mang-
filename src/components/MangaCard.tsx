import { BookOpen, Film, Star, TrendingUp } from 'lucide-react';
import { computeMangaChapterStats, computeRecentTraction } from '../lib/ranking';
import { Manga } from '../types/manga';

interface MangaCardProps {
  manga: Manga;
  onSelect: (mangaId: string) => void;
  subtitle?: string;
}

export function MangaCard({ manga, onSelect, subtitle }: MangaCardProps) {
  const primaryGenre = manga.genres?.[0] || 'Mangá';
  const ratingText = manga.ratingCount > 0 ? manga.ratingAverage.toFixed(1) : 'Novo';
  const tractionClass =
    manga.tractionLabel ??
    computeRecentTraction(manga, computeMangaChapterStats(manga, manga.publishedChapters))
      .classification;
  const tractionBadgeText =
    manga.status !== 'pre_launch'
      ? tractionClass === 'em_alta'
        ? 'Em alta'
        : tractionClass === 'em_ascensao'
          ? 'Em ascensão'
          : null
      : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(manga.id)}
      className="group text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48] rounded-xl"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-[#141419] border border-white/8">
        {manga.coverUrl ? (
          <img
            src={manga.coverUrl}
            alt={`Capa de ${manga.title}`}
            referrerPolicy="no-referrer"
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center p-5 bg-gradient-to-br from-[#191921] via-[#121217] to-[#0A0A0D] text-zinc-500">
            <BookOpen className="w-8 h-8 mb-3 text-zinc-600" />
            <span className="font-display text-sm font-semibold text-zinc-300 text-center line-clamp-2">
              {manga.title}
            </span>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

        <div className="absolute bottom-2.5 left-2.5 right-2.5 space-y-1.5">
          {(manga.hasMotion || tractionBadgeText || manga.status === 'pre_launch') && (
            <div className="flex flex-wrap items-center gap-1">
              {manga.hasMotion && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/65 backdrop-blur-sm border border-white/15 text-[10px] font-medium text-white">
                  <Film className="w-2.5 h-2.5 text-[#E11D48] shrink-0" />
                  <span>Motion</span>
                </span>
              )}
              {manga.status === 'pre_launch' ? (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-black/65 backdrop-blur-sm border border-amber-400/40 text-[10px] font-semibold text-amber-300">
                  Pré-lançamento
                </span>
              ) : (
                tractionBadgeText && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/65 backdrop-blur-sm border border-amber-400/35 text-[10px] font-medium text-amber-300">
                    <TrendingUp className="w-2.5 h-2.5 shrink-0" />
                    <span>{tractionBadgeText}</span>
                  </span>
                )
              )}
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] sm:text-[12px] text-zinc-200 font-mono-tabular">
            <span>
              {manga.status === 'pre_launch' ? 'Em breve' : `${manga.chaptersCount} cap.`}
            </span>
            <span className="inline-flex items-center gap-1">
              <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
              {ratingText}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2.5 space-y-1">
        <h3 className="font-display text-[15px] font-semibold text-[#F4F4F6] group-hover:text-white transition-colors line-clamp-1">
          {manga.title}
        </h3>
        <div className="flex items-center gap-1.5 text-xs text-zinc-400 truncate">
          <span className="truncate">{subtitle || manga.authorName}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{primaryGenre}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{manga.ageRating}</span>
        </div>
      </div>
    </button>
  );
}
