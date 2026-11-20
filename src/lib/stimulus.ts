import { Chapter, Manga, StimulusSettings } from '../types/manga';

export const DEFAULT_STIMULUS_SETTINGS: StimulusSettings = {
  id: 'stimulus',
  enabled: true,
  minViews: 1,
  maxViews: 1000,
  durationHours: 72,
  updatedBy: 'system',
};

export function toMillisValue(ts: unknown): number {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (
    ts &&
    typeof ts === 'object' &&
    'toMillis' in ts &&
    typeof (ts as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function deterministicUnitRandom(seed: number, step: number): number {
  let x = (Math.imul(seed | 0, 1664525) + Math.imul((step + 1) | 0, 1013904223)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x45d9f3b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function hashStringSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 999983) + 1;
}

/**
 * Picks the single work-level stimulus budget (1..1000) and deterministic seed
 * on the very first publication of a work.
 */
export function pickWorkStimulusBudgetAndSeed(params: {
  minViews: number;
  maxViews: number;
  hasMotion?: boolean;
}): { budget: number; seed: number } {
  const safeMin = Math.max(1, Math.min(1000, Math.round(params.minViews)));
  const safeMax = Math.max(safeMin, Math.min(1000, Math.round(params.maxViews)));
  const raw = safeMin + Math.floor(Math.random() * (safeMax - safeMin + 1));
  const adjusted = params.hasMotion ? Math.round(raw * 1.15) : raw;
  const budget = Math.max(safeMin, Math.min(safeMax, adjusted));
  const seed = 1 + Math.floor(Math.random() * 999998);
  return { budget, seed };
}

/**
 * Computes monotonic organic stimulus views delivered over `durationHours` (default 72h).
 * Starts at 0 on publication and grows naturally hour-by-hour with seeded hourly variation.
 */
export function computeStimulusProgressAtTime(
  startedAtMs: number,
  budget: number,
  seed: number,
  durationHours = 72,
  nowMs = Date.now()
): number {
  if (!startedAtMs || budget <= 0 || durationHours <= 0 || nowMs <= startedAtMs) {
    return 0;
  }

  const totalMs = durationHours * 3600000;
  const elapsedMs = nowMs - startedAtMs;
  if (elapsedMs >= totalMs) {
    return Math.round(budget);
  }

  const buckets = Math.max(1, Math.min(168, Math.round(durationHours)));
  const weights: number[] = [];
  let weightSum = 0;

  for (let h = 0; h < buckets; h++) {
    const warmup = h === 0 ? 0.25 : h === 1 ? 0.55 : 1.0;
    const decay = Math.pow(1 - h / (buckets + 6), 1.35);
    const jitter = 0.55 + 0.9 * deterministicUnitRandom(seed || 1, h);
    const w = warmup * decay * jitter;
    weights.push(w);
    weightSum += w;
  }

  if (weightSum <= 0) return 0;

  const exactBucket = (elapsedMs / totalMs) * buckets;
  const fullBuckets = Math.min(buckets, Math.floor(exactBucket));
  const partialFraction = Math.max(0, exactBucket - fullBuckets);

  let cumulativeWeight = 0;
  for (let i = 0; i < fullBuckets; i++) {
    cumulativeWeight += weights[i];
  }
  if (fullBuckets < buckets) {
    cumulativeWeight += weights[fullBuckets] * partialFraction;
  }

  const ratio = Math.min(1, Math.max(0, cumulativeWeight / weightSum));
  return Math.min(Math.round(budget), Math.max(0, Math.floor(budget * ratio)));
}

/**
 * Computes the total work-level stimulus views already delivered by `nowMs`.
 * New works hold a single budget in `stimulusWindows[0]`; if legacy works have
 * historical entries in `stimulusWindows[1..]`, all persisted windows are summed
 * so historical views and likes are preserved without modifying Firestore.
 */
export function computeMangaStimulusViews(manga: Manga, nowMs = Date.now()): number {
  const settled = Math.max(0, manga.stimulusSettledViews ?? 0);
  const windows = Array.isArray(manga.stimulusWindows) ? manga.stimulusWindows : [];
  if (windows.length === 0) {
    return settled;
  }
  let activeViews = 0;
  for (const win of windows) {
    if (!win || (win.budget ?? 0) <= 0 || !win.startedAtMs) continue;
    activeViews += computeStimulusProgressAtTime(
      win.startedAtMs,
      win.budget,
      win.seed,
      win.durationHours || 72,
      nowMs
    );
  }
  return settled + activeViews;
}

export function computeMangaRecent24hStimulusViews(manga: Manga, nowMs = Date.now()): number {
  const current = computeMangaStimulusViews(manga, nowMs);
  const previous = computeMangaStimulusViews(manga, nowMs - 24 * 3600000);
  return Math.max(0, current - previous);
}

/**
 * Computes organic stimulus likes strictly smaller than delivered stimulus views (2.5% - 6.2%).
 * Kept strictly separated from realFavoritesCount in `stimulusLikesCount`.
 */
export function computeStimulusLikesForViews(
  views: number,
  seed: number,
  hasMotion = false
): number {
  const safeViews = Math.max(0, Math.floor(views));
  if (safeViews < 12) return 0;
  const baseRate = hasMotion ? 0.035 : 0.025;
  const spread = hasMotion ? 0.027 : 0.023;
  const rate = baseRate + spread * deterministicUnitRandom((seed || 1) + 7919, 1);
  const rawLikes = Math.floor(safeViews * rate);
  const hardCeiling = Math.min(Math.floor(safeViews * 0.08), Math.max(0, safeViews - 1));
  return Math.max(0, Math.min(rawLikes, hardCeiling));
}

export function computeMangaStimulusLikes(manga: Manga, nowMs = Date.now()): number {
  const deliveredViews = computeMangaStimulusViews(manga, nowMs);
  if (deliveredViews < 12) return 0;
  const windows = Array.isArray(manga.stimulusWindows) ? manga.stimulusWindows : [];
  const seed =
    windows.find((w) => (w?.seed ?? 0) > 0)?.seed ?? hashStringSeed(manga.id || 'manga');
  return computeStimulusLikesForViews(deliveredViews, seed, Boolean(manga.hasMotion));
}

/**
 * Computes UTC YYYY-MM-DD key for daily 24h real engagement bucketing.
 */
export function getUtcDayKey(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function computeRecent24hFromDailyBuckets(
  dayKey: string | undefined,
  todayCount: number | undefined,
  prevDayKey: string | undefined,
  prevDayCount: number | undefined,
  nowMs = Date.now()
): number {
  const currentKey = getUtcDayKey(nowMs);
  const yesterdayKey = getUtcDayKey(nowMs - 24 * 3600000);
  let total = 0;

  if (dayKey === currentKey) {
    total += Math.max(0, todayCount ?? 0);
    if (prevDayKey === yesterdayKey) {
      total += Math.max(0, prevDayCount ?? 0);
    }
  } else if (dayKey === yesterdayKey) {
    // Today has no hits yet, so yesterday's bucket still falls inside sliding ~24-48h recent window weighted by remaining hours
    const hourOfDay = new Date(nowMs).getUTCHours();
    const yesterdayWeight = Math.max(0, (24 - hourOfDay) / 24);
    total += Math.round(Math.max(0, todayCount ?? 0) * yesterdayWeight);
  }

  return Math.max(0, total);
}

export function buildNextDailyBucketPatch(params: {
  prefix: 'realViews' | 'realFavs';
  currentDayKey?: string;
  currentTodayCount?: number;
  currentPrevDayKey?: string;
  currentPrevDayCount?: number;
  delta: 1 | -1;
  nowMs?: number;
}): Record<string, string | number> {
  const { prefix, delta } = params;
  const todayKey = getUtcDayKey(params.nowMs ?? Date.now());
  const curKey = params.currentDayKey || '';
  const curToday = Math.max(0, params.currentTodayCount ?? 0);
  const curPrevKey = params.currentPrevDayKey || '';
  const curPrev = Math.max(0, params.currentPrevDayCount ?? 0);

  if (curKey === todayKey) {
    return {
      [`${prefix}DayKey`]: todayKey,
      [`${prefix}TodayCount`]: Math.max(0, curToday + delta),
      [`${prefix}PrevDayKey`]: curPrevKey,
      [`${prefix}PrevDayCount`]: curPrev,
    };
  }

  if (!curKey) {
    return {
      [`${prefix}DayKey`]: todayKey,
      [`${prefix}TodayCount`]: delta > 0 ? 1 : 0,
      [`${prefix}PrevDayKey`]: '',
      [`${prefix}PrevDayCount`]: 0,
    };
  }

  return {
    [`${prefix}DayKey`]: todayKey,
    [`${prefix}TodayCount`]: delta > 0 ? 1 : 0,
    [`${prefix}PrevDayKey`]: curKey.slice(0, 12),
    [`${prefix}PrevDayCount`]: curToday,
  };
}

/**
 * Distributes a work's ALREADY-EARNED stimulus views (`workStimulusViews`) across its
 * currently published chapters using a progressive retention funnel:
 * - Uses Chapter 1 as initial reference.
 * - Progressively distributes across subsequent published chapters, adapting to observed real retention.
 * - Draft/unpublished/deleted/0-page chapters receive 0 stimulus.
 * - Never generates extra budgets beyond `workStimulusViews`.
 * - Preserves `realViewsCount` on every chapter so real reads always prevail (Cap N+1 can exceed Cap N).
 */
export function distributeWorkStimulusAcrossChapters(params: {
  manga: Manga;
  chapters: Chapter[];
  nowMs?: number;
}): Chapter[] {
  const nowMs = params.nowMs ?? Date.now();
  const totalWorkStimulus = computeMangaStimulusViews(params.manga, nowMs);
  const workSeed =
    params.manga.stimulusWindows?.[0]?.seed ?? hashStringSeed(params.manga.id || 'manga');

  const eligible = params.chapters
    .filter((ch) => ch.status === 'published' && (ch.pagesCount ?? 1) > 0)
    .sort((a, b) => a.chapterNumber - b.chapterNumber);

  if (eligible.length === 0 || totalWorkStimulus <= 0) {
    return params.chapters.map((ch) => {
      const realViewsCount = Math.max(0, ch.realViewsCount ?? ch.viewsCount ?? 0);
      return {
        ...ch,
        realViewsCount,
        stimulusViewsCount: 0,
        viewsCount: realViewsCount,
      };
    });
  }

  const rawWeights: number[] = [];
  for (let i = 0; i < eligible.length; i++) {
    const ch = eligible[i];
    let baseWeight: number;

    if (i === 0) {
      baseWeight = 1.0;
    } else {
      const prevCh = eligible[i - 1];
      const prevWeight = rawWeights[i - 1];
      const funnelBase =
        i === 1
          ? 0.58 + 0.14 * deterministicUnitRandom(workSeed, 10 + i)
          : 0.72 + 0.14 * deterministicUnitRandom(workSeed, 10 + i);

      const prevReal = Math.max(0, prevCh.realViewsCount ?? prevCh.viewsCount ?? 0);
      const currReal = Math.max(0, ch.realViewsCount ?? ch.viewsCount ?? 0);

      let retentionFactor = funnelBase;
      if (prevReal >= 5) {
        const observedRatio = Math.min(1.25, Math.max(0.25, currReal / prevReal));
        const obsConfidence = Math.min(0.65, prevReal / 50);
        retentionFactor = (1 - obsConfidence) * funnelBase + obsConfidence * observedRatio;
      }

      const motionFactor = ch.hasMotion ? 1.08 : 1.0;
      baseWeight = prevWeight * retentionFactor * motionFactor;
    }

    // Smooth initial ramp if a subsequent chapter was just published minutes ago
    const chPubMs = toMillisValue(ch.firstPublishedAt);
    let rampFactor = 1.0;
    if (i > 0 && chPubMs > 0 && nowMs >= chPubMs) {
      const elapsedHours = (nowMs - chPubMs) / 3600000;
      if (elapsedHours < 6) {
        rampFactor = Math.max(0.08, elapsedHours / 6);
      }
    }

    rawWeights.push(Math.max(0.01, baseWeight * rampFactor));
  }

  const weightSum = rawWeights.reduce((acc, w) => acc + w, 0);
  const allocations = new Map<string, number>();

  if (weightSum <= 0) {
    allocations.set(eligible[0].id, totalWorkStimulus);
  } else {
    const exacts = rawWeights.map((w) => (w / weightSum) * totalWorkStimulus);
    const floors = exacts.map((v) => Math.floor(v));
    let remainder = totalWorkStimulus - floors.reduce((a, b) => a + b, 0);

    const byFraction = exacts
      .map((val, idx) => ({ idx, frac: val - floors[idx] }))
      .sort((a, b) => b.frac - a.frac);

    for (let k = 0; k < byFraction.length && remainder > 0; k++) {
      floors[byFraction[k].idx] += 1;
      remainder -= 1;
    }

    eligible.forEach((ch, idx) => {
      allocations.set(ch.id, floors[idx]);
    });
  }

  return params.chapters.map((ch) => {
    const realViewsCount = Math.max(0, ch.realViewsCount ?? ch.viewsCount ?? 0);
    const stimulusViewsCount = allocations.get(ch.id) ?? 0;
    return {
      ...ch,
      realViewsCount,
      stimulusViewsCount,
      viewsCount: realViewsCount + stimulusViewsCount,
    };
  });
}

export function computeChapterStimulusViews(chapter: Chapter, nowMs = Date.now()): number {
  if (chapter.status !== 'published') return 0;
  const startedAtMs = toMillisValue(chapter.firstPublishedAt);
  const budget = chapter.stimulusBudget ?? 0;
  const seed = chapter.stimulusSeed ?? 1;
  const durationHours = chapter.stimulusDurationHours ?? 72;
  return computeStimulusProgressAtTime(startedAtMs, budget, seed, durationHours, nowMs);
}

export function computeViewsLikesRatioPercent(views: number, likes: number): number {
  if (!views || views <= 0 || !likes || likes <= 0) return 0;
  return Math.round((likes / views) * 1000) / 10;
}

export interface MilestoneStorageAdapter {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const VIEW_MILESTONES = [50, 100, 250, 500, 1000];
const FAVORITE_MILESTONES = [10, 25, 50];
const FOLLOWER_MILESTONES = [10, 25, 50];

export function evaluateNewStimulusMilestones(params: {
  userId: string;
  mangas: Manga[];
  totalFollowers: number;
  storage?: MilestoneStorageAdapter | null;
}): string | null {
  const storage =
    params.storage !== undefined
      ? params.storage
      : typeof window !== 'undefined'
        ? window.localStorage
        : null;
  if (!params.userId || !storage) return null;

  const key = `manga_motion_milestones_${params.userId}`;
  let seen = new Set<string>();
  try {
    const raw = storage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        seen = new Set(parsed.filter((item): item is string => typeof item === 'string'));
      }
    }
  } catch {
    seen = new Set<string>();
  }

  const newlyAchieved: Array<{ weight: number; message: string }> = [];

  for (const m of params.mangas) {
    const views = m.viewsCount || 0;
    for (const threshold of VIEW_MILESTONES) {
      if (views >= threshold) {
        const token = `v:${m.id}:${threshold}`;
        if (!seen.has(token)) {
          seen.add(token);
          newlyAchieved.push({
            weight: threshold,
            message: `Marco alcançado! "${m.title}" atingiu ${threshold.toLocaleString('pt-BR')} visualizações.`,
          });
        }
      }
    }

    const realFavorites = m.realFavoritesCount ?? m.favoritesCount ?? 0;
    for (const threshold of FAVORITE_MILESTONES) {
      if (realFavorites >= threshold) {
        const token = `l:${m.id}:${threshold}`;
        if (!seen.has(token)) {
          seen.add(token);
          newlyAchieved.push({
            weight: threshold * 15,
            message: `Marco alcançado! "${m.title}" chegou a ${threshold.toLocaleString('pt-BR')} favoritos reais.`,
          });
        }
      }
    }
  }

  for (const threshold of FOLLOWER_MILESTONES) {
    if (params.totalFollowers >= threshold) {
      const token = `f:${threshold}`;
      if (!seen.has(token)) {
        seen.add(token);
        newlyAchieved.push({
          weight: threshold * 20,
          message: `Marco no perfil! Você alcançou ${threshold.toLocaleString('pt-BR')} seguidores.`,
        });
      }
    }
  }

  if (newlyAchieved.length === 0) return null;

  try {
    storage.setItem(key, JSON.stringify(Array.from(seen).slice(-200)));
  } catch {
    // Ignore storage quota errors
  }

  newlyAchieved.sort((a, b) => b.weight - a.weight);
  return newlyAchieved[0].message;
}

export function enrichMangaWithViews(manga: Manga, nowMs = Date.now()): Manga {
  const realViewsCount = Math.max(0, manga.realViewsCount ?? manga.viewsCount ?? 0);
  const stimulusViewsCount = computeMangaStimulusViews(manga, nowMs);
  const recentStimulusViews24h = computeMangaRecent24hStimulusViews(manga, nowMs);
  const recentRealViews24h = computeRecent24hFromDailyBuckets(
    manga.realViewsDayKey,
    manga.realViewsTodayCount,
    manga.realViewsPrevDayKey,
    manga.realViewsPrevDayCount,
    nowMs
  );
  const recentRealFavorites24h = computeRecent24hFromDailyBuckets(
    manga.realFavsDayKey,
    manga.realFavsTodayCount,
    manga.realFavsPrevDayKey,
    manga.realFavsPrevDayCount,
    nowMs
  );

  // Internal separation: real vs stimulated likes remain isolated in `realFavoritesCount`
  // and `stimulusLikesCount`, while `favoritesCount` combines both for public/studio display.
  const realFavoritesCount = Math.max(0, manga.realFavoritesCount ?? manga.favoritesCount ?? 0);
  const stimulusLikesCount = computeMangaStimulusLikes(manga, nowMs);

  const realRatingCount = Math.max(0, manga.realRatingCount ?? manga.ratingCount ?? 0);
  const realRatingAverage = Math.min(5, Math.max(0, manga.realRatingAverage ?? manga.ratingAverage ?? 0));

  return {
    ...manga,
    realViewsCount,
    stimulusViewsCount,
    viewsCount: realViewsCount + stimulusViewsCount,
    recentStimulusViews24h,
    recentRealViews24h,
    recentRealFavorites24h,
    realFavoritesCount,
    stimulusLikesCount,
    favoritesCount: realFavoritesCount + stimulusLikesCount,
    realRatingCount,
    realRatingAverage,
    ratingCount: realRatingCount,
    ratingAverage: realRatingAverage,
  };
}

export function enrichChapterWithViews(chapter: Chapter, nowMs = Date.now()): Chapter {
  const realViewsCount = Math.max(0, chapter.realViewsCount ?? chapter.viewsCount ?? 0);
  const stimulusViewsCount = computeChapterStimulusViews(chapter, nowMs);
  return {
    ...chapter,
    realViewsCount,
    stimulusViewsCount,
    viewsCount: realViewsCount + stimulusViewsCount,
  };
}
