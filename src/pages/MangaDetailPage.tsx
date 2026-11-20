import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Film,
  Flag,
  Heart,
  Lock,
  Play,
  Sparkles,
  Star,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { AppRoute } from '../components/Navbar';
import { ReportModal } from '../components/ReportModal';
import { ToastPopup } from '../components/ToastPopup';
import { useAuth } from '../context/AuthContext';
import {
  fetchChaptersForManga,
  fetchCreatorPublicProfile,
  fetchMangaById,
  fetchMangaPreviewByKey,
  fetchMangaRatings,
  fetchReadingProgressForManga,
  fetchUserFavorites,
  fetchUserFollows,
  submitMangaRating,
  toggleFavoriteManga,
  toggleFollowAuthor,
} from '../services/mangaService';
import {
  Chapter,
  Manga,
  MangaPreview,
  MangaPreviewChapter,
  MangaRating,
  ReadingHistoryItem,
  UserProfile,
} from '../types/manga';

interface MangaDetailPageProps {
  mangaId?: string;
  previewKey?: string;
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Privado',
  pre_launch: 'Pré-lançamento',
  ongoing: 'Lançado',
  completed: 'Concluído',
  hiatus: 'Hiato',
  archived: 'Arquivado',
};

export function MangaDetailPage({ mangaId, previewKey, onNavigate, onOpenAuth }: MangaDetailPageProps) {
  const { user, profile, notifications } = useAuth();
  const isPreviewMode = Boolean(previewKey);
  const accountRemovedCount = notifications.filter((n) => n.type === 'account_removed').length;
  const [manga, setManga] = useState<Manga | null>(null);
  const [previewData, setPreviewData] = useState<MangaPreview | null>(null);
  const [previewChapters, setPreviewChapters] = useState<MangaPreviewChapter[]>([]);
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [ratings, setRatings] = useState<MangaRating[]>([]);
  const [resumeItem, setResumeItem] = useState<ReadingHistoryItem | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

  const [myScore, setMyScore] = useState(5);
  const [myReview, setMyReview] = useState('');
  const [savingRating, setSavingRating] = useState(false);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      if (previewKey) {
        setManga(null);
        setAuthorProfile(null);
        setChapters([]);
        setRatings([]);
        setResumeItem(null);
        setIsFollowing(false);

        const res = await fetchMangaPreviewByKey(previewKey);
        if (!res) {
          setPreviewData(null);
          setPreviewChapters([]);
          return;
        }
        setPreviewData(res.preview);
        setPreviewChapters(res.chapters);

        if (user) {
          const favs = await fetchUserFavorites(user.uid).catch(() => []);
          setIsFavorite(favs.some((f) => f.mangaId === res.preview.mangaId));
        } else {
          setIsFavorite(false);
        }
        return;
      }

      if (!mangaId) {
        setManga(null);
        return;
      }

      setPreviewData(null);
      setPreviewChapters([]);
      const m = await fetchMangaById(mangaId);
      setManga(m);
      if (m) {
        const isAuthor = user?.uid === m.authorId;
        const [chList, ratingList, creator] = await Promise.all([
          fetchChaptersForManga(m.id, isAuthor, false, m),
          fetchMangaRatings(m.id),
          fetchCreatorPublicProfile(m.authorId),
        ]);
        setChapters(chList.filter((c) => c.status === 'published' || isAuthor));
        setRatings(ratingList);
        if (creator) {
          setAuthorProfile({
            ...creator,
            followersCount: Math.max(0, creator.followersCount ?? 0),
          });
        } else {
          setAuthorProfile(null);
        }

        if (user) {
          const [favs, follows, hist] = await Promise.all([
            fetchUserFavorites(user.uid),
            fetchUserFollows(user.uid),
            fetchReadingProgressForManga(user.uid, m.id),
          ]);
          setIsFavorite(favs.some((f) => f.mangaId === m.id));
          setIsFollowing(follows.some((f) => f.authorId === m.authorId));
          setResumeItem(hist);

          const existingMine = ratingList.find((r) => r.userId === user.uid);
          if (existingMine) {
            setMyScore(existingMine.score);
            setMyReview(existingMine.review);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [mangaId, previewKey, user?.uid, accountRemovedCount]);

  const handleToggleFavorite = async () => {
    if (!user) {
      onOpenAuth();
      return;
    }
    if (!user.emailVerified) {
      setActionError('Verifique seu e-mail antes de favoritar obras.');
      return;
    }
    if (savingFavorite) return;

    setActionError(null);
    setSavingFavorite(true);
    try {
      if (isPreviewMode && previewData && previewKey) {
        const next = await toggleFavoriteManga(
          user.uid,
          {
            id: previewData.mangaId,
            title: previewData.title,
            coverUrl: previewData.coverUrl,
            authorName: previewData.authorName,
            status: previewData.status,
            previewKey,
          },
          {
            previewKey,
            isPreviewMode: true,
            knownFavoritesCount: previewData.favoritesCount,
          }
        );
        setIsFavorite(next);
        setPreviewData((prev) =>
          prev ? { ...prev, favoritesCount: Math.max(0, prev.favoritesCount + (next ? 1 : -1)) } : prev
        );
        return;
      }

      if (!manga) return;
      const next = await toggleFavoriteManga(user.uid, manga, {
        isPreviewMode: false,
        knownFavoritesCount: manga.realFavoritesCount ?? manga.favoritesCount,
      });
      setIsFavorite(next);
      setManga((prev) =>
        prev
          ? {
              ...prev,
              favoritesCount: Math.max(0, prev.favoritesCount + (next ? 1 : -1)),
              realFavoritesCount:
                prev.realFavoritesCount !== undefined
                  ? Math.max(0, prev.realFavoritesCount + (next ? 1 : -1))
                  : undefined,
            }
          : prev
      );
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[MangaDetailPage] Erro ao atualizar favorito/lista de desejos:', err);
      }
      setActionError('Não foi possível atualizar seu favorito agora. Tente novamente.');
    } finally {
      setSavingFavorite(false);
    }
  };

  const handleToggleFollow = async () => {
    if (isPreviewMode) return;
    if (!user || !manga) {
      onOpenAuth();
      return;
    }
    if (user.uid === manga.authorId || authorProfile?.isSuspended) return;
    const next = await toggleFollowAuthor({
      followerId: user.uid,
      followerName: profile?.displayName || user.displayName || 'Leitor',
      authorId: manga.authorId,
      authorName: manga.authorName,
    });
    setIsFollowing(next);
    setAuthorProfile((prev) =>
      prev
        ? {
            ...prev,
            followersCount: Math.max(0, prev.followersCount + (next ? 1 : -1)),
          }
        : prev
    );
  };

  const handleRatingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPreviewMode) return;
    if (!user || !manga) {
      onOpenAuth();
      return;
    }
    setSavingRating(true);
    try {
      await submitMangaRating({
        mangaId: manga.id,
        userId: user.uid,
        userName: profile?.displayName || user.displayName || 'Leitor',
        score: myScore,
        review: myReview,
      });
      await loadAll();
    } finally {
      setSavingRating(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 animate-pulse space-y-8">
        <div className="h-8 w-40 rounded bg-[#141419]" />
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          <div className="md:col-span-4 aspect-[3/4] rounded-2xl bg-[#141419]" />
          <div className="md:col-span-8 space-y-4">
            <div className="h-10 w-2/3 rounded bg-[#141419]" />
            <div className="h-24 w-full rounded bg-[#141419]" />
          </div>
        </div>
      </div>
    );
  }

  if (isPreviewMode && !previewData) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center space-y-4">
        <Lock className="w-10 h-10 text-zinc-500 mx-auto" />
        <h2 className="font-display text-2xl font-bold text-white">
          Link de prévia indisponível ou revogado
        </h2>
        <p className="text-sm text-zinc-400">
          Este link privado expirou, foi revogado pelo criador ou não existe mais.
        </p>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'home' })}
          className="px-5 py-2.5 rounded-xl bg-[#E11D48] text-white text-sm font-semibold"
        >
          Voltar ao Início
        </button>
      </div>
    );
  }

  if (!isPreviewMode && !manga) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
        <h2 className="font-display text-2xl font-bold text-white">Obra não encontrada</h2>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'home' })}
          className="px-5 py-2.5 rounded-xl bg-[#E11D48] text-white text-sm font-semibold"
        >
          Voltar ao Início
        </button>
      </div>
    );
  }

  const displayTitle = isPreviewMode ? previewData!.title : manga!.title;
  const displaySynopsis = isPreviewMode ? previewData!.synopsis : manga!.synopsis;
  const displayCoverUrl = isPreviewMode ? previewData!.coverUrl : manga!.coverUrl;
  const displayBannerUrl = isPreviewMode ? previewData!.bannerUrl : manga!.bannerUrl;
  const displayGenres = isPreviewMode ? previewData!.genres : manga!.genres;
  const displayAgeRating = isPreviewMode ? previewData!.ageRating : manga!.ageRating;
  const displayStatus = isPreviewMode ? previewData!.status : manga!.status;
  const displayHasMotion = isPreviewMode ? previewData!.hasMotion : manga!.hasMotion;
  const displayAuthorName = isPreviewMode ? previewData!.authorName : manga!.authorName;
  const displayFavoritesCount = isPreviewMode ? previewData!.favoritesCount : manga!.favoritesCount;
  const displayRatingAverage = isPreviewMode ? previewData!.ratingAverage : manga!.ratingAverage;
  const displayRatingCount = isPreviewMode ? previewData!.ratingCount : manga!.ratingCount;

  const isPreLaunchWork = !isPreviewMode && manga!.status === 'pre_launch';
  const isAuthor = !isPreviewMode && Boolean(manga && user?.uid === manga.authorId);
  const publishedChapters = chapters.filter((c) => c.status === 'published');
  const visiblePublicChapters = isPreLaunchWork ? (isAuthor ? chapters : []) : chapters;
  const firstChapter = isPreviewMode
    ? previewChapters[0] || null
    : isPreLaunchWork && !isAuthor
      ? null
      : publishedChapters[0] || chapters[0];

  return (
    <div className="pb-24 md:pb-16">
      <ToastPopup error={actionError} onClearError={() => setActionError(null)} />
      {/* Header Banner Backdrop */}
      <div className="relative border-b border-white/8 bg-[#0A0A0D]">
        {(displayBannerUrl || displayCoverUrl) && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <img
              src={displayBannerUrl || displayCoverUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover opacity-20 blur-md scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#08080A] via-[#08080A]/80 to-[#08080A]/50" />
          </div>
        )}

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          {!isPreviewMode && (
            <button
              type="button"
              onClick={() => onNavigate({ name: 'explore' })}
              className="inline-flex items-center gap-2 text-xs sm:text-sm text-zinc-400 hover:text-white mb-6 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Voltar ao catálogo
            </button>
          )}

          {isPreviewMode && (
            <div className="mb-6 p-3.5 rounded-xl bg-amber-500/10 border border-amber-400/25 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-200">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  <strong className="text-white">Prévia Privada Exclusiva</strong> — Acesso antecipado
                  restrito somente a esta obra antes do lançamento oficial.
                </span>
              </div>
              <span className="font-mono-tabular text-[11px] text-amber-300">
                {previewChapters.length}{' '}
                {previewChapters.length === 1 ? 'capítulo preparado' : 'capítulos preparados'}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
            {/* Cover */}
            <div className="md:col-span-4 lg:col-span-3">
              <div className="aspect-[3/4] w-48 sm:w-56 md:w-full rounded-2xl overflow-hidden bg-[#141419] border border-white/12 shadow-2xl">
                {displayCoverUrl ? (
                  <img
                    src={displayCoverUrl}
                    alt={`Capa de ${displayTitle}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 text-zinc-500">
                    <BookOpen className="w-10 h-10 mb-2" />
                    <span className="font-display text-sm text-center">{displayTitle}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Info */}
            <div className="md:col-span-8 lg:col-span-9 space-y-5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span
                  className={
                    displayStatus === 'pre_launch'
                      ? 'px-2 py-0.5 rounded bg-amber-400 text-zinc-950 font-bold uppercase tracking-wide text-[10px]'
                      : ''
                  }
                >
                  {STATUS_LABELS[displayStatus] || displayStatus}
                </span>
                <span aria-hidden="true">·</span>
                <span>Classificação {displayAgeRating}</span>
                <span aria-hidden="true">·</span>
                <span>{displayGenres.join(', ')}</span>
                {displayHasMotion && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#E11D48] font-semibold">Suporta Motion Manga</span>
                  </>
                )}
              </div>

              <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-white [text-wrap:balance]">
                {displayTitle}
              </h1>

              {/* Metrics row */}
              <div className="flex flex-wrap items-center gap-5 text-sm font-mono-tabular text-zinc-300">
                {!isPreviewMode && (
                  <span className="inline-flex items-center gap-1.5">
                    <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                    {displayRatingCount > 0
                      ? `${displayRatingAverage.toFixed(1)} (${displayRatingCount})`
                      : 'Sem avaliações'}
                  </span>
                )}
                {!isPreviewMode && manga && (
                  <span className="inline-flex items-center gap-1.5">
                    <span>{manga.viewsCount.toLocaleString('pt-BR')} leituras</span>
                    {((manga.recentRealViews24h ?? 0) + (manga.recentStimulusViews24h ?? 0)) > 0 && (
                      <span className="text-xs text-amber-300 font-medium">
                        (+
                        {(
                          (manga.recentRealViews24h ?? 0) + (manga.recentStimulusViews24h ?? 0)
                        ).toLocaleString('pt-BR')}{' '}
                        hoje)
                      </span>
                    )}
                  </span>
                )}
                <span>{displayFavoritesCount} favoritos</span>
                <span>
                  {isPreviewMode
                    ? `${previewChapters.length} capítulos preparados`
                    : isPreLaunchWork
                      ? 'Em pré-lançamento'
                      : `${publishedChapters.length} capítulos`}
                </span>
              </div>

              <p className="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-3xl whitespace-pre-line">
                {displaySynopsis}
              </p>

              {isPreLaunchWork && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-400/25 flex items-start gap-3 text-xs sm:text-sm text-amber-100">
                  <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white">Obra em Pré-lançamento (Lista de Desejos):</strong>{' '}
                    Favorite agora para receber notificação automática e destaque na página inicial
                    assim que o primeiro capítulo oficial for lançado!
                  </div>
                </div>
              )}

              {/* Author + Actions */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-white/8">
                <div className="flex items-center gap-3">
                  {!isPreviewMode && authorProfile?.avatarUrl ? (
                    <img
                      src={authorProfile.avatarUrl}
                      alt={displayAuthorName}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full object-cover border border-white/15"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[#191922] border border-white/10 flex items-center justify-center text-sm font-bold text-white">
                      {displayAuthorName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-white">{displayAuthorName}</div>
                    {!isPreviewMode && (
                      <div className="text-xs text-zinc-400 font-mono-tabular">
                        {authorProfile?.followersCount ?? 0} seguidores
                      </div>
                    )}
                  </div>
                  {!isPreviewMode && manga && user?.uid !== manga.authorId && (
                    authorProfile?.isSuspended ? (
                      <span className="ml-2 px-3 py-1 rounded-xl text-xs font-medium bg-rose-500/10 text-rose-300 border border-rose-500/20">
                        Conta suspensa
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleToggleFollow}
                        className={`ml-2 min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                          isFollowing
                            ? 'bg-white/10 text-white border border-white/15'
                            : 'bg-white text-zinc-950 hover:bg-zinc-200'
                        }`}
                      >
                        {isFollowing ? (
                          <>
                            <UserCheck className="w-3.5 h-3.5" />
                            Seguindo
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-3.5 h-3.5" />
                            Seguir Autor
                          </>
                        )}
                      </button>
                    )
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {!isPreviewMode && resumeItem && manga && (!isPreLaunchWork || isAuthor) ? (
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate({
                          name: 'reader',
                          mangaId: manga.id,
                          chapterId: resumeItem.chapterId,
                          initialPage: resumeItem.pageNumber,
                        })
                      }
                      className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold transition-colors"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      Continuar Cap. {resumeItem.chapterNumber} (Pág. {resumeItem.pageNumber})
                    </button>
                  ) : (
                    firstChapter && (
                      <button
                        type="button"
                        onClick={() => {
                          if (isPreviewMode && previewKey) {
                            onNavigate({
                              name: 'preview_reader',
                              previewKey,
                              chapterId: firstChapter.id,
                              initialPage: 1,
                            });
                          } else if (manga) {
                            onNavigate({
                              name: 'reader',
                              mangaId: manga.id,
                              chapterId: firstChapter.id,
                              initialPage: 1,
                            });
                          }
                        }}
                        className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold transition-colors"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        {isPreviewMode ? 'Ler Prévia' : 'Começar a Ler'}
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    onClick={handleToggleFavorite}
                    disabled={savingFavorite}
                    className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors disabled:opacity-60 ${
                      isFavorite
                        ? 'bg-[#E11D48]/15 border-[#E11D48]/50 text-[#FB7185]'
                        : 'bg-white/5 border-white/10 text-zinc-200 hover:bg-white/10'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
                    {isFavorite
                      ? isPreLaunchWork
                        ? 'Na Lista de Desejos'
                        : 'Favoritado'
                      : isPreLaunchWork
                        ? 'Adicionar à Lista de Desejos'
                        : 'Favoritar'}
                  </button>

                  {!isPreviewMode && manga && (
                    <button
                      type="button"
                      onClick={() => (user ? setReportOpen(true) : onOpenAuth())}
                      aria-label="Denunciar obra"
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      <Flag className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Chapters + Ratings */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Chapter List */}
        <section className={`${isPreviewMode ? 'lg:col-span-12' : 'lg:col-span-7'} space-y-4`}>
          <h2 className="font-display text-xl font-bold text-white">
            {isPreviewMode ? 'Capítulos Disponíveis na Prévia' : 'Capítulos'}
          </h2>
          {isPreviewMode ? (
            previewChapters.length === 0 ? (
              <div className="rounded-2xl bg-[#111115] border border-white/8 p-8 text-center text-sm text-zinc-400">
                Nenhum capítulo com páginas preparadas para prévia ainda.
              </div>
            ) : (
              <div className="divide-y divide-white/8 bg-[#111115] border border-white/8 rounded-2xl overflow-hidden">
                {previewChapters.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() =>
                      previewKey &&
                      onNavigate({
                        name: 'preview_reader',
                        previewKey,
                        chapterId: ch.id,
                      })
                    }
                    className="w-full min-h-[60px] px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-white/5 text-left transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono-tabular text-xs font-semibold text-[#E11D48]">
                          Cap. {ch.chapterNumber}
                        </span>
                        <span className="font-medium text-sm text-white truncate">{ch.title}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5 font-mono-tabular">
                        <span>{ch.pagesCount} páginas</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {ch.hasMotion && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-200">
                          <Film className="w-3.5 h-3.5 text-[#E11D48]" />
                          Motion
                        </span>
                      )}
                      <span className="text-xs font-semibold text-zinc-300">Ler Prévia</span>
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : visiblePublicChapters.length === 0 ? (
            <div className="rounded-2xl bg-[#111115] border border-white/8 p-8 text-center text-sm text-zinc-400">
              {isPreLaunchWork
                ? 'Esta obra está em pré-lançamento. Os capítulos serão liberados automaticamente no lançamento oficial.'
                : 'Nenhum capítulo publicado nesta obra ainda.'}
            </div>
          ) : (
            <div className="divide-y divide-white/8 bg-[#111115] border border-white/8 rounded-2xl overflow-hidden">
              {visiblePublicChapters.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() =>
                    manga &&
                    onNavigate({
                      name: 'reader',
                      mangaId: manga.id,
                      chapterId: ch.id,
                    })
                  }
                  className="w-full min-h-[60px] px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-white/5 text-left transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono-tabular text-xs font-semibold text-[#E11D48]">
                        Cap. {ch.chapterNumber}
                      </span>
                      <span className="font-medium text-sm text-white truncate">{ch.title}</span>
                      {ch.status === 'draft' && (
                        <span className="text-[11px] text-amber-400">(Rascunho)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5 font-mono-tabular">
                      <span>{ch.pagesCount} páginas</span>
                      <span aria-hidden="true">·</span>
                      <span>{ch.viewsCount} leituras</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {ch.hasMotion && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-200">
                        <Film className="w-3.5 h-3.5 text-[#E11D48]" />
                        Motion
                      </span>
                    )}
                    <span className="text-xs font-semibold text-zinc-300">Ler</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Ratings & Reviews (Public / Pre-launch catalog mode only) */}
        {!isPreviewMode && (
          <section className="lg:col-span-5 space-y-5">
            <h2 className="font-display text-xl font-bold text-white">Avaliações</h2>

            <form
              onSubmit={handleRatingSubmit}
              className="bg-[#111115] border border-white/8 rounded-2xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-200">Sua nota</span>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setMyScore(star)}
                      aria-label={`Dar ${star} estrelas`}
                      className="p-1"
                    >
                      <Star
                        className={`w-5 h-5 transition-colors ${
                          star <= myScore ? 'text-amber-400 fill-amber-400' : 'text-zinc-600'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                rows={3}
                maxLength={600}
                value={myReview}
                onChange={(e) => setMyReview(e.target.value)}
                placeholder="Escreva uma opinião opcional sobre a obra..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E11D48]"
              />

              <button
                type="submit"
                disabled={savingRating}
                className="w-full min-h-[42px] rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {savingRating ? 'Salvando...' : user ? 'Enviar Avaliação' : 'Entrar para Avaliar'}
              </button>
            </form>

            <div className="space-y-3">
              {ratings.length === 0 ? (
                <p className="text-xs text-zinc-500">Nenhuma avaliação registrada ainda.</p>
              ) : (
                ratings.map((r) => (
                  <div
                    key={r.userId}
                    className="bg-[#111115] border border-white/8 rounded-xl p-4 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">{r.userName}</span>
                      <span className="inline-flex items-center gap-1 text-xs font-mono-tabular text-amber-400">
                        <Star className="w-3.5 h-3.5 fill-current" />
                        {r.score}.0
                      </span>
                    </div>
                    {r.review && <p className="text-xs text-zinc-300 leading-relaxed">{r.review}</p>}
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </div>

      {!isPreviewMode && manga && (
        <ReportModal
          isOpen={reportOpen}
          onClose={() => setReportOpen(false)}
          targetType="manga"
          targetId={manga.id}
          targetLabel={manga.title}
          mangaId={manga.id}
        />
      )}
    </div>
  );
}
