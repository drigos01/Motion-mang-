import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Compass, Film, Heart, PenTool, Play, Sparkles } from 'lucide-react';
import { MangaCard } from '../components/MangaCard';
import { AppRoute } from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import {
  selectFeaturedManga,
  selectLatestReleases,
  selectMotionSpotlight,
  selectPopularMangas,
  selectRecommendedMangas,
} from '../lib/ranking';
import {
  fetchPublishedCatalogWithRankingData,
  fetchReadingHistoryForUser,
  fetchUserFavorites,
} from '../services/mangaService';
import { Chapter, FavoriteItem, GENRE_OPTIONS, Manga, ReadingHistoryItem } from '../types/manga';

const HERO_BACKDROP = '/src/assets/images/hero_ink_atmosphere_1794869519725.jpg';

function tsMillis(ts: unknown): number {
  if (ts && typeof ts === 'object' && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

interface HomePageProps {
  onNavigate: (route: AppRoute) => void;
}

export function HomePage({ onNavigate }: HomePageProps) {
  const { user, notifications } = useAuth();
  const [mangas, setMangas] = useState<Manga[]>([]);
  const [chaptersByMangaId, setChaptersByMangaId] = useState<Record<string, Chapter[]>>({});
  const [history, setHistory] = useState<ReadingHistoryItem[]>([]);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>('Todos');
  const [loading, setLoading] = useState(true);

  const deletedNotifsCount = useMemo(
    () => notifications.filter((n) => n.type === 'manga_deleted').length,
    [notifications]
  );

  const releaseNotifsCount = useMemo(
    () => notifications.filter((n) => n.type === 'pre_launch_release').length,
    [notifications]
  );

  useEffect(() => {
    let active = true;
    fetchPublishedCatalogWithRankingData()
      .then((data) => {
        if (active) {
          setMangas(data.mangas);
          setChaptersByMangaId(data.chaptersByMangaId);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [deletedNotifsCount, releaseNotifsCount]);

  useEffect(() => {
    if (!user) {
      setHistory([]);
      setFavorites([]);
      return;
    }
    fetchReadingHistoryForUser(user.uid)
      .then(setHistory)
      .catch(() => setHistory([]));
    fetchUserFavorites(user.uid)
      .then(setFavorites)
      .catch(() => setFavorites([]));
  }, [user, deletedNotifsCount, releaseNotifsCount]);

  const featuredManga = useMemo(
    () => selectFeaturedManga(mangas, chaptersByMangaId),
    [mangas, chaptersByMangaId]
  );

  const wishlistLaunchedMangas = useMemo(() => {
    if (!user || favorites.length === 0 || mangas.length === 0) return [];
    const favMap = new Map(favorites.map((f) => [f.mangaId, f]));
    return mangas
      .filter((m) => {
        if (m.status !== 'ongoing' && m.status !== 'completed' && m.status !== 'hiatus') {
          return false;
        }
        const fav = favMap.get(m.id);
        if (!fav) return false;
        return fav.addedDuringPreLaunch === true || m.launchedFromPreLaunch === true;
      })
      .sort(
        (a, b) =>
          (tsMillis(b.launchedAt) || tsMillis(b.lastChapterPublishedAt) || tsMillis(b.createdAt)) -
          (tsMillis(a.launchedAt) || tsMillis(a.lastChapterPublishedAt) || tsMillis(a.createdAt))
      );
  }, [user, favorites, mangas]);

  const latestMangas = useMemo(
    () => selectLatestReleases(mangas, chaptersByMangaId, undefined, 10),
    [mangas, chaptersByMangaId]
  );

  const popularMangas = useMemo(
    () => selectPopularMangas(mangas, chaptersByMangaId, undefined, 10),
    [mangas, chaptersByMangaId]
  );

  const motionSpotlight = useMemo(
    () => selectMotionSpotlight(mangas, chaptersByMangaId, undefined, 6),
    [mangas, chaptersByMangaId]
  );

  const recommendedMangas = useMemo(() => {
    if (mangas.length === 0) return [];
    const readIds = new Set(history.map((h) => h.mangaId));
    const preferredGenres = new Set<string>();
    mangas.forEach((m) => {
      if (readIds.has(m.id)) {
        m.genres.forEach((g) => preferredGenres.add(g));
      }
    });

    return selectRecommendedMangas(mangas, chaptersByMangaId, {
      preferredGenres,
      selectedGenre,
      limit: 10,
    });
  }, [mangas, chaptersByMangaId, history, selectedGenre]);

  return (
    <div className="pb-24 md:pb-16">
      {/* Cinematic Hero */}
      <section className="relative overflow-hidden border-b border-white/8 bg-[#08080A]">
        {/* Atmospheric backdrop */}
        <div className="absolute inset-0 pointer-events-none">
          <img
            src={featuredManga?.bannerUrl || featuredManga?.coverUrl || HERO_BACKDROP}
            alt=""
            referrerPolicy="no-referrer"
            className={`w-full h-full object-cover ${
              featuredManga?.bannerUrl || featuredManga?.coverUrl
                ? 'opacity-30 scale-105 blur-[2px]'
                : 'opacity-25 invert mix-blend-screen'
            }`}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#08080A] via-[#08080A]/85 to-[#08080A]/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#08080A] via-transparent to-[#08080A]/60" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20">
          {featuredManga ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
              <div className="lg:col-span-8 flex flex-col justify-center space-y-5">
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-400">
                  <span>
                    {featuredManga.status === 'pre_launch'
                      ? 'Pré-lançamento'
                      : featuredManga.isFeatured
                        ? 'Destaque Editorial'
                        : 'Publicação Recente'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{featuredManga.genres.slice(0, 3).join(' / ')}</span>
                  {featuredManga.hasMotion && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#E11D48] font-semibold">Motion Manga Disponível</span>
                    </>
                  )}
                </div>

                <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-white [text-wrap:balance]">
                  {featuredManga.title}
                </h1>

                <p className="text-sm sm:text-base text-zinc-300 max-w-2xl leading-relaxed line-clamp-3">
                  {featuredManga.synopsis}
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => onNavigate({ name: 'manga', mangaId: featuredManga.id })}
                    className="min-h-[44px] inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold transition-colors"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    {featuredManga.status === 'pre_launch' ? 'Ver Pré-lançamento' : 'Ler Agora'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate({ name: 'explore' })}
                    className="min-h-[44px] inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/6 hover:bg-white/10 border border-white/10 text-zinc-100 text-sm font-medium transition-colors"
                  >
                    Explorar Catálogo
                  </button>
                </div>
              </div>

              <div className="lg:col-span-4 flex justify-start lg:justify-end">
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'manga', mangaId: featuredManga.id })}
                  className="group relative w-48 sm:w-60 lg:w-64 aspect-[3/4] rounded-2xl overflow-hidden border border-white/15 shadow-2xl shrink-0"
                >
                  {featuredManga.coverUrl ? (
                    <img
                      src={featuredManga.coverUrl}
                      alt={featuredManga.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full bg-[#141419] flex items-center justify-center p-4">
                      <span className="font-display text-lg font-semibold text-zinc-300 text-center">
                        {featuredManga.title}
                      </span>
                    </div>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl space-y-5 py-4">
              <p className="text-xs font-medium text-zinc-400">
                Publicação Digital · Mangá Tradicional &amp; Motion Manga
              </p>
              <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-white [text-wrap:balance]">
                Leitura cinematográfica para obras em quadro fixo e movimento contínuo.
              </h1>
              <p className="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-2xl">
                Armazene capítulos organizados por página, publique versões originais e animadas em
                loop e ofereça aos leitores alternância instantânea sem perder a página.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'creator' })}
                  className="min-h-[44px] inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold transition-colors"
                >
                  <PenTool className="w-4 h-4" />
                  Publicar Primeira Obra
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'explore' })}
                  className="min-h-[44px] inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/6 hover:bg-white/10 border border-white/10 text-zinc-100 text-sm font-medium transition-colors"
                >
                  <Compass className="w-4 h-4" />
                  Explorar Biblioteca
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12 pt-10">
        {/* Continue Reading Shelf */}
        {history.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-white">
                Continuar Lendo
              </h2>
              <button
                type="button"
                onClick={() => onNavigate({ name: 'library' })}
                className="text-xs sm:text-sm text-zinc-400 hover:text-white inline-flex items-center gap-1 transition-colors"
              >
                Ver histórico
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {history.slice(0, 3).map((item) => {
                const progressPct = Math.min(
                  100,
                  Math.round((item.pageNumber / Math.max(1, item.totalPages)) * 100)
                );
                return (
                  <button
                    key={item.mangaId}
                    type="button"
                    onClick={() =>
                      onNavigate({
                        name: 'reader',
                        mangaId: item.mangaId,
                        chapterId: item.chapterId,
                        initialPage: item.pageNumber,
                      })
                    }
                    className="flex items-center gap-4 p-3 rounded-xl bg-[#121216] hover:bg-[#191920] border border-white/8 text-left transition-colors group"
                  >
                    <div className="w-14 h-20 rounded-lg overflow-hidden bg-[#1B1B22] shrink-0">
                      {item.coverUrl ? (
                        <img
                          src={item.coverUrl}
                          alt={item.mangaTitle}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-600">
                          <BookOpen className="w-5 h-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="font-display text-sm font-semibold text-white truncate group-hover:text-[#E11D48] transition-colors">
                        {item.mangaTitle}
                      </div>
                      <div className="text-xs text-zinc-400 font-mono-tabular truncate">
                        Cap. {item.chapterNumber} · Pág. {item.pageNumber}/{item.totalPages}
                      </div>
                      <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#E11D48]"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Wishlist Launched Highlight Section */}
        {wishlistLaunchedMangas.length > 0 && (
          <section className="space-y-5 rounded-2xl bg-gradient-to-br from-[#E11D48]/10 via-[#121216] to-[#111115] border border-[#E11D48]/25 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Heart className="w-5 h-5 text-[#E11D48] fill-[#E11D48]" />
                <h2 className="font-display text-xl sm:text-2xl font-bold text-white">
                  Lançamento em Destaque — Da sua lista de favoritos
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate({ name: 'library' })}
                className="text-xs sm:text-sm text-zinc-300 hover:text-white inline-flex items-center gap-1 transition-colors"
              >
                Minha lista
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5">
              {wishlistLaunchedMangas.map((manga) => (
                <MangaCard
                  key={manga.id}
                  manga={manga}
                  subtitle="Lançado da sua lista de desejos"
                  onSelect={(id) => onNavigate({ name: 'manga', mangaId: id })}
                />
              ))}
            </div>
          </section>
        )}

        {/* Loading or Empty Catalog State */}
        {loading ? (
          <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2.5 animate-pulse">
                <div className="aspect-[3/4] rounded-xl bg-[#141419]" />
                <div className="h-4 w-3/4 rounded bg-[#141419]" />
                <div className="h-3 w-1/2 rounded bg-[#141419]" />
              </div>
            ))}
          </section>
        ) : mangas.length === 0 ? (
          <section className="rounded-2xl bg-[#111115] border border-white/8 p-8 sm:p-12 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-[#1A1A22] border border-white/10 mx-auto flex items-center justify-center text-[#E11D48]">
              <Sparkles className="w-6 h-6" />
            </div>
            <h2 className="font-display text-2xl font-bold text-white">
              O catálogo está pronto para novas publicações
            </h2>
            <p className="text-sm text-zinc-400 max-w-xl mx-auto leading-relaxed">
              Não há obras fictícias ou demonstrativas pré-carregadas. Acesse o Estúdio do Criador
              para cadastrar uma série, enviar capas, organizar capítulos e vincular páginas
              originais e Motion.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onNavigate({ name: 'creator' })}
                className="min-h-[44px] inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold transition-colors"
              >
                <PenTool className="w-4 h-4" />
                Abrir Estúdio do Criador
              </button>
            </div>
          </section>
        ) : (
          <>
            {/* Lançamentos */}
            <section className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl sm:text-2xl font-bold text-white">
                  Lançamentos Recentes
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'explore' })}
                  className="text-xs sm:text-sm text-zinc-400 hover:text-white inline-flex items-center gap-1 transition-colors"
                >
                  Explorar todos
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5">
                {latestMangas.map((manga) => (
                  <MangaCard
                    key={manga.id}
                    manga={manga}
                    onSelect={(id) => onNavigate({ name: 'manga', mangaId: id })}
                  />
                ))}
              </div>
            </section>

            {/* Motion Manga Spotlight */}
            {motionSpotlight.length > 0 && (
              <section className="space-y-5">
                <div className="flex items-center gap-2.5">
                  <Film className="w-5 h-5 text-[#E11D48]" />
                  <h2 className="font-display text-xl sm:text-2xl font-bold text-white">
                    Especial Motion Manga
                  </h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5">
                  {motionSpotlight.map((manga) => (
                    <MangaCard
                      key={manga.id}
                      manga={manga}
                      onSelect={(id) => onNavigate({ name: 'manga', mangaId: id })}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Populares */}
            <section className="space-y-5">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-white">
                Mais Populares
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5">
                {popularMangas.map((manga) => (
                  <MangaCard
                    key={manga.id}
                    manga={manga}
                    onSelect={(id) => onNavigate({ name: 'manga', mangaId: id })}
                  />
                ))}
              </div>
            </section>

            {/* Categorias & Recomendações */}
            <section className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="font-display text-xl sm:text-2xl font-bold text-white">
                  Categorias e Recomendações
                </h2>
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  {['Todos', ...GENRE_OPTIONS.slice(0, 8)].map((genre) => (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => setSelectedGenre(genre)}
                      className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                        selectedGenre === genre
                          ? 'bg-[#E11D48] text-white'
                          : 'bg-[#141419] text-zinc-400 hover:text-white border border-white/8'
                      }`}
                    >
                      {genre}
                    </button>
                  ))}
                </div>
              </div>

              {recommendedMangas.length === 0 ? (
                <p className="text-sm text-zinc-400 py-8">
                  Nenhuma obra publicada nesta categoria ainda.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5">
                  {recommendedMangas.slice(0, 10).map((manga) => (
                    <MangaCard
                      key={manga.id}
                      manga={manga}
                      onSelect={(id) => onNavigate({ name: 'manga', mangaId: id })}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
