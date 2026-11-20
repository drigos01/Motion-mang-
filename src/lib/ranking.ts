import { Chapter, ChapterPage, Manga, TractionClassification } from '../types/manga';
import {
  computeMangaRecent24hStimulusViews,
  computeMangaStimulusLikes,
  computeMangaStimulusViews,
  computeRecent24hFromDailyBuckets,
  toMillisValue,
} from './stimulus';

export const RANKING_CONSTANTS = {
  BAYESIAN_PRIOR_MEAN: 3.8,
  BAYESIAN_PRIOR_WEIGHT: 5,
  RETENTION_PRIOR_RATE: 0.68,
  RETENTION_PRIOR_SAMPLE: 8,
  MAX_MOTION_BONUS: 15,
  MAX_CHAPTER_DEPTH_BONUS: 12,
  MAX_RETENTION_BONUS: 14,
  MAX_STIMULUS_DISCOVERY_BONUS: 3.5,
  MAX_RECENT_REAL_TRACTION_BONUS: 12,
  MAX_RECENT_STIMULUS_TRACTION_BONUS: 2,
  MAX_CHAPTER_FRESHNESS_BONUS: 4,
  PRE_LAUNCH_RANKING_MULTIPLIER: 0.45,
} as const;

export interface ChapterRetentionBreakdown {
  fromChapterNumber: number;
  toChapterNumber: number;
  fromRealViews: number;
  toRealViews: number;
  smoothedRate: number;
}

export interface MangaChapterStats {
  publishedChaptersCount: number;
  validMotionChaptersCount: number;
  motionChapterRatio: number;
  hasStrictMotion: boolean;
  lastChapterPublishedAtMs: number;
  totalRealChapterViews: number;
  retentionCap1To2: number | null;
  retentionCap2To3: number | null;
  retentionSubsequentAvg: number | null;
  retentionTransitions: ChapterRetentionBreakdown[];
  retentionScore: number;
  engagementSpread: number;
  chapterDepthScore: number;
  publishedChapters: Chapter[];
}

export interface RecentTractionResult {
  recentRealViews24h: number;
  recentRealFavorites24h: number;
  recentStimulusViews24h: number;
  real24hScore: number;
  stimulus24hScore: number;
  freshnessScore: number;
  totalTractionScore: number;
  classification: TractionClassification;
  label: string;
}

export interface RankingComponents {
  trueEngagement: number;
  retention: number;
  chapterDepth: number;
  motionBonus: number;
  recentTraction: number;
  stimulusDiscovery: number;
  bayesianRatingScore: number;
  genreMatchBonus: number;
}

export interface MangaRankingResult {
  mangaId: string;
  score: number;
  bayesianRating: number;
  stats: MangaChapterStats;
  traction: RecentTractionResult;
  components: RankingComponents;
  reasons: string[];
  reasonSummary: string;
}

export interface RankingInput {
  manga: Manga;
  chapters?: Chapter[];
  pagesByChapterId?: Record<string, ChapterPage[]>;
  preferredGenres?: Set<string>;
}

/**
 * A page has valid Motion ONLY when both non-empty motionUrl and motionMime exist.
 */
export function isPageMotionValid(
  page: Pick<ChapterPage, 'motionUrl' | 'motionMime'> | null | undefined
): boolean {
  return Boolean(
    page &&
      typeof page.motionUrl === 'string' &&
      page.motionUrl.trim().length > 0 &&
      typeof page.motionMime === 'string' &&
      page.motionMime.trim().length > 0
  );
}

/**
 * STRICT CHAPTER MOTION ELIGIBILITY (§1):
 * Returns true ONLY if the chapter has at least 1 page AND ALL registered pages have valid Motion.
 */
export function hasAllPagesMotion(
  pages: Array<Pick<ChapterPage, 'motionUrl' | 'motionMime'>>
): boolean {
  return Array.isArray(pages) && pages.length > 0 && pages.every((p) => isPageMotionValid(p));
}

/**
 * Checks if a chapter qualifies as Motion for public ranking & showcases:
 * - Chapter MUST be published
 * - Chapter MUST have >= 1 readable page
 * - If pages are passed, EVERY page must pass `isPageMotionValid`; otherwise relies on strict persisted `chapter.hasMotion`.
 */
export function isChapterMotionEligible(chapter: Chapter, pages?: ChapterPage[]): boolean {
  if (!chapter || chapter.status !== 'published') return false;
  if (pages !== undefined) {
    return hasAllPagesMotion(pages);
  }
  return chapter.pagesCount > 0 && Boolean(chapter.hasMotion);
}

/**
 * Bayesian-smoothed rating average so small sample sizes (e.g., 1x 5.0★)
 * do not defeat consistently well-rated works (e.g., 30x 4.8★).
 */
export function computeBayesianRating(
  average: number,
  count: number,
  priorMean = RANKING_CONSTANTS.BAYESIAN_PRIOR_MEAN,
  priorWeight = RANKING_CONSTANTS.BAYESIAN_PRIOR_WEIGHT
): number {
  const safeCount = Math.max(0, Number.isFinite(count) ? count : 0);
  if (safeCount === 0) return priorMean;
  const safeAvg = Math.min(5, Math.max(0, Number.isFinite(average) ? average : 0));
  return (safeAvg * safeCount + priorMean * priorWeight) / (safeCount + priorWeight);
}

export function computeMangaChapterStats(
  manga: Manga,
  chapters?: Chapter[],
  pagesByChapterId?: Record<string, ChapterPage[]>
): MangaChapterStats {
  const hasExplicitChapters = chapters !== undefined || manga.publishedChapters !== undefined;
  const sourceChapters = chapters ?? manga.publishedChapters ?? [];

  const publishedChapters = sourceChapters
    .filter((ch) => {
      if (!ch || ch.status !== 'published') return false;
      if (pagesByChapterId && pagesByChapterId[ch.id] !== undefined) {
        return pagesByChapterId[ch.id].length > 0;
      }
      return (ch.pagesCount ?? 0) > 0;
    })
    .sort((a, b) => a.chapterNumber - b.chapterNumber);

  const publishedChaptersCount = hasExplicitChapters
    ? publishedChapters.length
    : Math.max(0, manga.chaptersCount || 0);

  let validMotionChaptersCount = 0;
  let lastChapterPublishedAtMs = 0;
  let totalRealChapterViews = 0;

  for (const ch of publishedChapters) {
    const chPages = pagesByChapterId?.[ch.id];
    if (isChapterMotionEligible(ch, chPages)) {
      validMotionChaptersCount += 1;
    }
    const chPubMs = Math.max(
      toMillisValue(ch.firstPublishedAt),
      toMillisValue(ch.createdAt)
    );
    if (chPubMs > lastChapterPublishedAtMs) {
      lastChapterPublishedAtMs = chPubMs;
    }
    totalRealChapterViews += Math.max(0, ch.realViewsCount ?? ch.viewsCount ?? 0);
  }

  // Fallback for works that don't yet have explicit chapter list attached or pre-launch
  if (!hasExplicitChapters && publishedChaptersCount > 0 && manga.hasMotion) {
    validMotionChaptersCount = Math.min(
      publishedChaptersCount,
      manga.validMotionChaptersCount ?? 1
    );
  }

  if (lastChapterPublishedAtMs === 0) {
    lastChapterPublishedAtMs = Math.max(
      toMillisValue(manga.lastChapterPublishedAt),
      toMillisValue(manga.launchedAt),
      toMillisValue(manga.createdAt)
    );
  }

  const motionChapterRatio =
    publishedChaptersCount > 0
      ? Math.min(1, Math.max(0, validMotionChaptersCount / publishedChaptersCount))
      : 0;
  const hasStrictMotion = validMotionChaptersCount > 0;

  // Chapter-to-chapter retention using Bayesian smoothing for low-sample protection (§6)
  const retentionTransitions: ChapterRetentionBreakdown[] = [];
  for (let i = 0; i < publishedChapters.length - 1; i++) {
    const prev = publishedChapters[i];
    const next = publishedChapters[i + 1];
    const prevReal = Math.max(0, prev.realViewsCount ?? prev.viewsCount ?? 0);
    const nextReal = Math.max(0, next.realViewsCount ?? next.viewsCount ?? 0);

    // Bayesian smoothed retention avoids penalizing new chapters/works with 0-5 readers
    const smoothed = Math.min(
      1.15,
      Math.max(
        0,
        (nextReal +
          RANKING_CONSTANTS.RETENTION_PRIOR_SAMPLE * RANKING_CONSTANTS.RETENTION_PRIOR_RATE) /
          (prevReal + RANKING_CONSTANTS.RETENTION_PRIOR_SAMPLE)
      )
    );

    retentionTransitions.push({
      fromChapterNumber: prev.chapterNumber,
      toChapterNumber: next.chapterNumber,
      fromRealViews: prevReal,
      toRealViews: nextReal,
      smoothedRate: smoothed,
    });
  }

  const retentionCap1To2 =
    retentionTransitions.length >= 1 ? retentionTransitions[0].smoothedRate : null;
  const retentionCap2To3 =
    retentionTransitions.length >= 2 ? retentionTransitions[1].smoothedRate : null;
  const retentionSubsequentAvg =
    retentionTransitions.length >= 3
      ? retentionTransitions
          .slice(2)
          .reduce((sum, item) => sum + item.smoothedRate, 0) /
        (retentionTransitions.length - 2)
      : null;

  // Compute spread/consistency of real reads across chapters (0..1)
  let engagementSpread = 0.5;
  if (publishedChapters.length >= 2) {
    const chapterRealCounts = publishedChapters.map((c) =>
      Math.max(0, c.realViewsCount ?? c.viewsCount ?? 0)
    );
    const maxReads = Math.max(...chapterRealCounts);
    if (maxReads === 0) {
      // Neutral prior for works without real chapter reads yet
      engagementSpread = 0.5;
    } else {
      const avgReads =
        chapterRealCounts.reduce((acc, v) => acc + v, 0) / chapterRealCounts.length;
      engagementSpread = Math.min(1, Math.max(0, avgReads / maxReads));
    }
  }

  // Retention score (0..14)
  let retentionScore = 5.0; // Neutral baseline for single-chapter or brand-new works
  if (retentionTransitions.length > 0) {
    let weightedSum = 0;
    let totalWeight = 0;
    if (retentionCap1To2 !== null) {
      weightedSum += Math.min(1, retentionCap1To2) * 0.45;
      totalWeight += 0.45;
    }
    if (retentionCap2To3 !== null) {
      weightedSum += Math.min(1, retentionCap2To3) * 0.3;
      totalWeight += 0.3;
    }
    if (retentionSubsequentAvg !== null) {
      weightedSum += Math.min(1, retentionSubsequentAvg) * 0.25;
      totalWeight += 0.25;
    }
    const avgRetentionQuality = totalWeight > 0 ? weightedSum / totalWeight : 0.65;
    // Blend retention rate (11 max) + spread consistency (3 max)
    retentionScore = Math.min(
      RANKING_CONSTANTS.MAX_RETENTION_BONUS,
      avgRetentionQuality * 11 + engagementSpread * 3
    );
  } else if (publishedChaptersCount === 0) {
    retentionScore = 0;
  }

  // Logarithmic public chapter depth (0..12), quality-gated by real engagement per chapter (§5)
  let chapterDepthScore = 0;
  if (publishedChaptersCount > 0) {
    const rawLogDepth = Math.min(
      RANKING_CONSTANTS.MAX_CHAPTER_DEPTH_BONUS,
      Math.log2(publishedChaptersCount + 1) * 2.4
    );
    const realViews = Math.max(0, manga.realViewsCount ?? manga.viewsCount ?? 0);
    const realFavs = Math.max(0, manga.realFavoritesCount ?? manga.favoritesCount ?? 0);
    const viewsPerChapter = realViews / publishedChaptersCount;
    // Works with many chapters but near-zero real engagement receive only a small depth factor
    const qualityGate = Math.min(
      1,
      0.22 +
        Math.min(0.55, (viewsPerChapter / 15) * 0.55) +
        Math.min(0.23, (Math.log10(realFavs + 1) / 1.5) * 0.23)
    );
    chapterDepthScore = rawLogDepth * qualityGate;
  }

  return {
    publishedChaptersCount,
    validMotionChaptersCount,
    motionChapterRatio,
    hasStrictMotion,
    lastChapterPublishedAtMs,
    totalRealChapterViews,
    retentionCap1To2,
    retentionCap2To3,
    retentionSubsequentAvg,
    retentionTransitions,
    retentionScore,
    engagementSpread,
    chapterDepthScore,
    publishedChapters,
  };
}

export function getTractionLabelText(classification: TractionClassification): string {
  switch (classification) {
    case 'em_alta':
      return 'Em alta agora';
    case 'em_ascensao':
      return 'Em ascensão';
    case 'aquecendo':
      return 'Aquecendo';
    default:
      return 'Estável';
  }
}

export function computeRecentTraction(
  manga: Manga,
  stats: MangaChapterStats,
  nowMs = Date.now()
): RecentTractionResult {
  const recentRealViews24h =
    manga.recentRealViews24h ??
    computeRecent24hFromDailyBuckets(
      manga.realViewsDayKey,
      manga.realViewsTodayCount,
      manga.realViewsPrevDayKey,
      manga.realViewsPrevDayCount,
      nowMs
    );
  const recentRealFavorites24h =
    manga.recentRealFavorites24h ??
    computeRecent24hFromDailyBuckets(
      manga.realFavsDayKey,
      manga.realFavsTodayCount,
      manga.realFavsPrevDayKey,
      manga.realFavsPrevDayCount,
      nowMs
    );
  const recentStimulusViews24h =
    manga.recentStimulusViews24h ?? computeMangaRecent24hStimulusViews(manga, nowMs);

  const real24hScore = Math.min(
    RANKING_CONSTANTS.MAX_RECENT_REAL_TRACTION_BONUS,
    Math.log10(recentRealViews24h + 1) * 4.2 + Math.log10(recentRealFavorites24h + 1) * 5.0
  );

  const stimulus24hScore = Math.min(
    RANKING_CONSTANTS.MAX_RECENT_STIMULUS_TRACTION_BONUS,
    Math.log10(recentStimulusViews24h + 1) * 0.9
  );

  // ONLY real chapter publication date contributes to freshness (NEVER updatedAt / synopsis edits)
  let freshnessScore = 0;
  let ageHours = Number.POSITIVE_INFINITY;
  if (stats.lastChapterPublishedAtMs > 0 && nowMs >= stats.lastChapterPublishedAtMs) {
    ageHours = (nowMs - stats.lastChapterPublishedAtMs) / 3600000;
    if (ageHours <= 168 && stats.publishedChaptersCount > 0) {
      freshnessScore = Math.max(
        0,
        RANKING_CONSTANTS.MAX_CHAPTER_FRESHNESS_BONUS * (1 - ageHours / 168)
      );
    }
  }

  const totalTractionScore = real24hScore + stimulus24hScore + freshnessScore;

  const isFreshChapter72h = stats.publishedChaptersCount > 0 && ageHours <= 72;
  const momentumIndex =
    recentRealViews24h * 1.5 +
    recentRealFavorites24h * 8 +
    recentStimulusViews24h * 0.35 +
    (isFreshChapter72h ? 6 : 0);

  let classification: TractionClassification = 'estavel';
  if (
    manga.status !== 'pre_launch' &&
    (recentRealViews24h >= 20 || recentRealFavorites24h >= 4 || momentumIndex >= 35)
  ) {
    classification = 'em_alta';
  } else if (
    manga.status !== 'pre_launch' &&
    (recentRealViews24h >= 5 || recentRealFavorites24h >= 1 || recentStimulusViews24h >= 15)
  ) {
    classification = 'em_ascensao';
  } else if (
    recentRealViews24h >= 1 ||
    recentStimulusViews24h >= 5 ||
    (stats.publishedChaptersCount > 0 && ageHours <= 168)
  ) {
    classification = 'aquecendo';
  }

  return {
    recentRealViews24h,
    recentRealFavorites24h,
    recentStimulusViews24h,
    real24hScore,
    stimulus24hScore,
    freshnessScore,
    totalTractionScore,
    classification,
    label: getTractionLabelText(classification),
  };
}

/**
 * Centralized Ranking Score Engine (§8):
 * Integrates true engagement, Bayesian ratings, logarithmic published chapter depth,
 * small-sample-safe chapter retention, proportional capped Motion priority, recent 24h traction,
 * and modest stimulated discovery nudge.
 */
export function computeMangaRankingScore(
  input: RankingInput,
  nowMs = Date.now()
): MangaRankingResult {
  const { manga, chapters, pagesByChapterId, preferredGenres } = input;
  const stats = computeMangaChapterStats(manga, chapters, pagesByChapterId);
  const traction = computeRecentTraction(manga, stats, nowMs);

  const realViews = Math.max(0, manga.realViewsCount ?? manga.viewsCount ?? 0);
  const realFavorites = Math.max(0, manga.realFavoritesCount ?? manga.favoritesCount ?? 0);
  const realRatingCount = Math.max(0, manga.realRatingCount ?? manga.ratingCount ?? 0);
  const realRatingAverage = Math.min(
    5,
    Math.max(0, manga.realRatingAverage ?? manga.ratingAverage ?? 0)
  );

  const stimulusViews =
    manga.stimulusViewsCount ?? computeMangaStimulusViews(manga, nowMs);
  const stimulusLikes =
    manga.stimulusLikesCount ?? computeMangaStimulusLikes(manga, nowMs);

  const bayesianRating = computeBayesianRating(realRatingAverage, realRatingCount);
  // Real ratings lift quality when rated; unrated gets neutral prior score
  const bayesianRatingScore =
    realRatingCount > 0
      ? Math.max(0, (bayesianRating - 3.0) * 6.5)
      : Math.max(0, (RANKING_CONSTANTS.BAYESIAN_PRIOR_MEAN - 3.0) * 5.0);

  const realViewsScore = Math.log10(realViews + 1) * 12;
  const realFavoritesScore = Math.log10(realFavorites + 1) * 18;
  const trueEngagement = realViewsScore + realFavoritesScore + bayesianRatingScore;

  // Capped proportional + volume Motion bonus (§1)
  const motionBonus = stats.hasStrictMotion
    ? Math.min(
        RANKING_CONSTANTS.MAX_MOTION_BONUS,
        RANKING_CONSTANTS.MAX_MOTION_BONUS *
          (0.65 * stats.motionChapterRatio +
            0.35 *
              Math.min(
                1,
                Math.log2(stats.validMotionChaptersCount + 1) / Math.log2(6)
              ))
      )
    : 0;

  // Modest stimulus discovery boost that can never override real proven hits (§2 & §3)
  const stimulusDiscovery = Math.min(
    RANKING_CONSTANTS.MAX_STIMULUS_DISCOVERY_BONUS,
    Math.log10(stimulusViews + 1) * 0.9 + Math.min(0.8, stimulusLikes * 0.03)
  );

  const genreMatchBonus =
    preferredGenres &&
    preferredGenres.size > 0 &&
    manga.genres.some((g) => preferredGenres.has(g))
      ? 16
      : 0;

  const rawScore =
    trueEngagement +
    stats.retentionScore +
    stats.chapterDepthScore +
    motionBonus +
    traction.totalTractionScore +
    stimulusDiscovery +
    genreMatchBonus;

  const multiplier =
    manga.status === 'pre_launch' ? RANKING_CONSTANTS.PRE_LAUNCH_RANKING_MULTIPLIER : 1;
  const score = Math.round(rawScore * multiplier * 100) / 100;

  const reasons: string[] = [];
  if (stats.hasStrictMotion) {
    const pct = Math.round(stats.motionChapterRatio * 100);
    reasons.push(
      `Motion válido (${stats.validMotionChaptersCount}/${stats.publishedChaptersCount} cap., ${pct}%)`
    );
  }
  if (trueEngagement >= 40) {
    reasons.push('Alto engajamento real');
  } else if (realViews > 0 || realFavorites > 0) {
    reasons.push('Engajamento real ativo');
  }
  if (stats.retentionTransitions.length > 0 && stats.retentionScore >= 9) {
    reasons.push('Boa retenção entre capítulos');
  }
  if (traction.classification === 'em_alta' || traction.classification === 'em_ascensao') {
    reasons.push(traction.label);
  }
  if (reasons.length === 0) {
    reasons.push(
      stimulusDiscovery > 0 ? 'Descoberta inicial com estímulo' : 'Catálogo público'
    );
  }

  return {
    mangaId: manga.id,
    score,
    bayesianRating,
    stats,
    traction,
    components: {
      trueEngagement,
      retention: stats.retentionScore,
      chapterDepth: stats.chapterDepthScore,
      motionBonus,
      recentTraction: traction.totalTractionScore,
      stimulusDiscovery,
      bayesianRatingScore,
      genreMatchBonus,
    },
    reasons,
    reasonSummary: reasons.join(' · '),
  };
}

export interface RankedMangaItem {
  manga: Manga;
  ranking: MangaRankingResult;
}

export function rankMangas(
  mangas: Manga[],
  chaptersByMangaId: Record<string, Chapter[]> = {},
  options: {
    pagesByChapterId?: Record<string, ChapterPage[]>;
    preferredGenres?: Set<string>;
    nowMs?: number;
  } = {}
): RankedMangaItem[] {
  const nowMs = options.nowMs ?? Date.now();
  return mangas
    .map((manga) => {
      const chapters = chaptersByMangaId[manga.id] ?? manga.publishedChapters;
      const ranking = computeMangaRankingScore(
        {
          manga,
          chapters,
          pagesByChapterId: options.pagesByChapterId,
          preferredGenres: options.preferredGenres,
        },
        nowMs
      );
      return { manga, ranking };
    })
    .sort((a, b) => {
      if (b.ranking.score !== a.ranking.score) {
        return b.ranking.score - a.ranking.score;
      }
      return a.manga.id.localeCompare(b.manga.id);
    });
}

export function selectFeaturedManga(
  mangas: Manga[],
  chaptersByMangaId: Record<string, Chapter[]> = {},
  nowMs = Date.now()
): Manga | null {
  if (mangas.length === 0) return null;
  const ranked = rankMangas(mangas, chaptersByMangaId, { nowMs });
  const editorial = ranked.find((r) => r.manga.isFeatured);
  if (editorial) return editorial.manga;
  const readable = ranked.find(
    (r) => r.manga.status !== 'pre_launch' && r.ranking.stats.publishedChaptersCount > 0
  );
  if (readable) return readable.manga;
  return ranked[0]?.manga ?? null;
}

export function selectPopularMangas(
  mangas: Manga[],
  chaptersByMangaId: Record<string, Chapter[]> = {},
  nowMs = Date.now(),
  limit = 10
): Manga[] {
  const readable = mangas.filter((m) => m.status !== 'pre_launch');
  const pool = readable.length > 0 ? readable : mangas;
  return rankMangas(pool, chaptersByMangaId, { nowMs })
    .slice(0, limit)
    .map((item) => item.manga);
}

/**
 * Recent Releases showcase (§7 & §11):
 * Strictly ordered by last chapter publication date (or official launch/creation fallback).
 * Administrative or synopsis edits (updatedAt) are NEVER used here.
 */
export function selectLatestReleases(
  mangas: Manga[],
  chaptersByMangaId: Record<string, Chapter[]> = {},
  nowMs = Date.now(),
  limit = 10
): Manga[] {
  const ranked = rankMangas(mangas, chaptersByMangaId, { nowMs });
  return ranked
    .sort((a, b) => {
      const aDate = a.ranking.stats.lastChapterPublishedAtMs;
      const bDate = b.ranking.stats.lastChapterPublishedAtMs;
      if (bDate !== aDate) return bDate - aDate;
      return b.ranking.score - a.ranking.score;
    })
    .slice(0, limit)
    .map((item) => item.manga);
}

/**
 * Motion Spotlight (§1):
 * Only includes works with at least one strictly verified Motion published chapter
 * (ALL pages of that chapter have valid Motion assets).
 */
export function selectMotionSpotlight(
  mangas: Manga[],
  chaptersByMangaId: Record<string, Chapter[]> = {},
  nowMs = Date.now(),
  limit = 6
): Manga[] {
  return rankMangas(mangas, chaptersByMangaId, { nowMs })
    .filter((item) => item.ranking.stats.hasStrictMotion)
    .sort((a, b) => {
      if (b.ranking.score !== a.ranking.score) {
        return b.ranking.score - a.ranking.score;
      }
      return b.ranking.stats.motionChapterRatio - a.ranking.stats.motionChapterRatio;
    })
    .slice(0, limit)
    .map((item) => item.manga);
}

export function selectRecommendedMangas(
  mangas: Manga[],
  chaptersByMangaId: Record<string, Chapter[]> = {},
  options: {
    preferredGenres?: Set<string>;
    selectedGenre?: string;
    limit?: number;
    nowMs?: number;
  } = {}
): Manga[] {
  const { preferredGenres, selectedGenre = 'Todos', limit = 10, nowMs = Date.now() } = options;
  const filtered = mangas.filter((m) =>
    selectedGenre !== 'Todos' ? m.genres.includes(selectedGenre) : true
  );
  return rankMangas(filtered, chaptersByMangaId, { preferredGenres, nowMs })
    .slice(0, limit)
    .map((item) => item.manga);
}

export type ExploreSortOption = 'relevance' | 'popular' | 'rating' | 'recent';

export function sortExploreMangas(
  mangas: Manga[],
  chaptersByMangaId: Record<string, Chapter[]> = {},
  sortBy: ExploreSortOption = 'relevance',
  nowMs = Date.now()
): Manga[] {
  const ranked = rankMangas(mangas, chaptersByMangaId, { nowMs });

  if (sortBy === 'recent') {
    return ranked
      .sort((a, b) => {
        const diff = b.ranking.stats.lastChapterPublishedAtMs - a.ranking.stats.lastChapterPublishedAtMs;
        return diff !== 0 ? diff : b.ranking.score - a.ranking.score;
      })
      .map((item) => item.manga);
  }

  if (sortBy === 'rating') {
    return ranked
      .sort((a, b) => {
        const ratingDiff = b.ranking.bayesianRating - a.ranking.bayesianRating;
        if (Math.abs(ratingDiff) > 0.001) return ratingDiff;
        const countDiff = (b.manga.realRatingCount ?? b.manga.ratingCount ?? 0) - (a.manga.realRatingCount ?? a.manga.ratingCount ?? 0);
        if (countDiff !== 0) return countDiff;
        return b.ranking.score - a.ranking.score;
      })
      .map((item) => item.manga);
  }

  if (sortBy === 'popular') {
    return ranked
      .sort((a, b) => {
        const aPop =
          a.ranking.components.trueEngagement * 1.15 +
          a.ranking.components.retention +
          a.ranking.components.motionBonus * 0.7;
        const bPop =
          b.ranking.components.trueEngagement * 1.15 +
          b.ranking.components.retention +
          b.ranking.components.motionBonus * 0.7;
        if (bPop !== aPop) return bPop - aPop;
        return b.ranking.score - a.ranking.score;
      })
      .map((item) => item.manga);
  }

  return ranked.map((item) => item.manga);
}
