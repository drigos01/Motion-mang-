import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { MangaCard } from '../components/MangaCard';
import { AppRoute } from '../components/Navbar';
import { ExploreSortOption, sortExploreMangas } from '../lib/ranking';
import { fetchPublishedCatalogWithRankingData } from '../services/mangaService';
import { AGE_RATINGS, Chapter, GENRE_OPTIONS, Manga } from '../types/manga';

export interface ExploreFiltersState {
  search: string;
  genre: string;
  format: 'all' | 'motion' | 'traditional';
  ageRating: string;
  sortBy: ExploreSortOption;
}

interface ExplorePageProps {
  initialGenre?: string;
  initialQuery?: string;
  savedFilters?: ExploreFiltersState;
  onFiltersChange?: (filters: ExploreFiltersState) => void;
  onNavigate: (route: AppRoute) => void;
}

export function ExplorePage({
  initialGenre,
  initialQuery,
  savedFilters,
  onFiltersChange,
  onNavigate,
}: ExplorePageProps) {
  const [mangas, setMangas] = useState<Manga[]>([]);
  const [chaptersByMangaId, setChaptersByMangaId] = useState<Record<string, Chapter[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(savedFilters?.search ?? initialQuery ?? '');
  const [genre, setGenre] = useState(savedFilters?.genre ?? initialGenre ?? 'Todos');
  const [format, setFormat] = useState<'all' | 'motion' | 'traditional'>(
    savedFilters?.format ?? 'all'
  );
  const [ageRating, setAgeRating] = useState<string>(savedFilters?.ageRating ?? 'Todas');
  const [sortBy, setSortBy] = useState<ExploreSortOption>(savedFilters?.sortBy ?? 'relevance');

  useEffect(() => {
    if (savedFilters) return;
    setSearch(initialQuery || '');
    setGenre(initialGenre || 'Todos');
    setFormat('all');
    setAgeRating('Todas');
    setSortBy('relevance');
  }, [initialGenre, initialQuery, savedFilters]);

  useEffect(() => {
    onFiltersChange?.({ search, genre, format, ageRating, sortBy });
  }, [search, genre, format, ageRating, sortBy, onFiltersChange]);

  useEffect(() => {
    setLoading(true);
    fetchPublishedCatalogWithRankingData()
      .then((data) => {
        setMangas(data.mangas);
        setChaptersByMangaId(data.chaptersByMangaId);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = mangas.filter((m) => {
      if (q) {
        const hay = `${m.title} ${m.authorName} ${m.synopsis} ${m.genres.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (genre !== 'Todos' && !m.genres.includes(genre)) return false;
      if (format === 'motion' && !m.hasMotion) return false;
      if (format === 'traditional' && m.hasMotion) return false;
      if (ageRating !== 'Todas' && m.ageRating !== ageRating) return false;
      return true;
    });

    return sortExploreMangas(list, chaptersByMangaId, sortBy);
  }, [mangas, chaptersByMangaId, search, genre, format, ageRating, sortBy]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 md:pb-16 space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
          Explorar Biblioteca
        </h1>
        <p className="text-sm text-zinc-400">
          Filtre por gênero, modalidade Motion Manga, classificação indicativa e relevância.
        </p>
      </div>

      {/* Filters Toolbar */}
      <div className="space-y-4 bg-[#111115] border border-white/8 rounded-2xl p-4 sm:p-5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título, autor ou sinopse..."
              className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E11D48]"
            />
          </div>

          <div className="md:col-span-3 flex items-center gap-1 p-1 rounded-xl bg-[#08080A] border border-white/10">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'motion', label: 'Motion' },
              { id: 'traditional', label: 'Tradicional' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFormat(opt.id as 'all' | 'motion' | 'traditional')}
                className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  format === opt.id
                    ? 'bg-[#E11D48] text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="md:col-span-2">
            <select
              value={ageRating}
              onChange={(e) => setAgeRating(e.target.value)}
              aria-label="Classificação indicativa"
              className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs sm:text-sm text-white focus:outline-none focus:border-[#E11D48]"
            >
              <option value="Todas">Classificação: Todas</option>
              {AGE_RATINGS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ExploreSortOption)}
              aria-label="Ordenação"
              className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs sm:text-sm text-white focus:outline-none focus:border-[#E11D48]"
            >
              <option value="relevance">Relevância Inteligente</option>
              <option value="popular">Mais Populares</option>
              <option value="rating">Melhor Avaliados</option>
              <option value="recent">Mais Recentes</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
          {['Todos', ...GENRE_OPTIONS].map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGenre(g)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                genre === g
                  ? 'bg-white text-zinc-950 font-semibold'
                  : 'bg-[#18181F] text-zinc-400 hover:text-white'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="space-y-2 animate-pulse">
              <div className="aspect-[3/4] rounded-xl bg-[#141419]" />
              <div className="h-4 w-3/4 rounded bg-[#141419]" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-[#111115] border border-white/8 p-12 text-center space-y-2">
          <p className="font-display text-lg font-semibold text-white">
            Nenhuma obra encontrada
          </p>
          <p className="text-sm text-zinc-400">
            Ajuste os filtros de pesquisa ou publique uma nova série no Estúdio do Criador.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5">
          {filtered.map((manga) => (
            <MangaCard
              key={manga.id}
              manga={manga}
              onSelect={(id) => onNavigate({ name: 'manga', mangaId: id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
