import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNextDailyBucketPatch,
  computeMangaRecent24hStimulusViews,
  computeMangaStimulusViews,
  computeRecent24hFromDailyBuckets,
  distributeWorkStimulusAcrossChapters,
  enrichMangaWithViews,
  evaluateNewStimulusMilestones,
  getUtcDayKey,
  pickWorkStimulusBudgetAndSeed,
} from '../src/lib/stimulus.ts';
import type { Chapter, Manga } from '../src/types/manga.ts';

function buildBaseManga(overrides: Partial<Manga> = {}): Manga {
  return {
    id: 'manga-test-1',
    authorId: 'author-1',
    authorName: 'Autor Teste',
    title: 'Obra Teste',
    slug: 'obra-teste',
    synopsis: 'Sinopse',
    coverUrl: '',
    bannerUrl: '',
    genres: ['Ação'],
    ageRating: '14+',
    status: 'ongoing',
    moderationStatus: 'approved',
    isFeatured: false,
    hasMotion: false,
    chaptersCount: 1,
    viewsCount: 15,
    realViewsCount: 15,
    ratingAverage: 0,
    ratingCount: 0,
    ...overrides,
  };
}

function buildChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1',
    mangaId: 'manga-test-1',
    authorId: 'author-1',
    chapterNumber: 1,
    title: 'Capítulo 1',
    status: 'published',
    hasMotion: false,
    pagesCount: 10,
    viewsCount: 0,
    realViewsCount: 0,
    ...overrides,
  };
}

test('1. Single work-level stimulus budget rolls within [1, 1000] and grows monotonically over 72h', () => {
  for (let i = 0; i < 40; i++) {
    const picked = pickWorkStimulusBudgetAndSeed({
      minViews: 1,
      maxViews: 1000,
      hasMotion: i % 2 === 0,
    });
    assert.ok(picked.budget >= 1 && picked.budget <= 1000);
    assert.ok(picked.seed >= 1);
  }

  const startedAtMs = 1_700_000_000_000;
  const manga = buildBaseManga({
    stimulusSettledViews: 0,
    stimulusWindows: [
      {
        chapterId: 'ch-1',
        startedAtMs,
        budget: 600,
        seed: 77123,
        durationHours: 72,
      },
    ],
  });

  let prevViews = -1;

  for (let h = 0; h <= 72; h += 4) {
    const now = startedAtMs + h * 3600 * 1000;
    const views = computeMangaStimulusViews(manga, now);

    assert.ok(views >= prevViews);

    prevViews = views;
  }

  assert.equal(prevViews, 600);
});

test('2. enrichMangaWithViews keeps real views & real ratings untouched (zero fake ratings)', () => {
  const startedAtMs = 1_700_000_000_000;
  const raw = buildBaseManga({
    hasMotion: true,
    viewsCount: 25,
    realViewsCount: 25,
    ratingAverage: 4.8,
    ratingCount: 2,
    realRatingAverage: 4.8,
    realRatingCount: 2,
    stimulusSettledViews: 0,
    stimulusWindows: [
      {
        chapterId: 'ch-1',
        startedAtMs,
        budget: 400,
        seed: 334455,
        durationHours: 72,
      },
    ],
  });

  const now72h = startedAtMs + 72 * 3600 * 1000;
  const enrichedOnce = enrichMangaWithViews(raw, now72h);
  const enrichedTwice = enrichMangaWithViews(enrichedOnce, now72h);

  assert.deepEqual(enrichedTwice, enrichedOnce);
  assert.equal(enrichedOnce.realViewsCount, 25);
  assert.equal(enrichedOnce.stimulusViewsCount, 400);
  assert.equal(enrichedOnce.viewsCount, 425);

  assert.equal(enrichedOnce.realRatingCount, 2);
  assert.equal(enrichedOnce.ratingCount, 2);
  assert.equal(enrichedOnce.realRatingAverage, 4.8);
  assert.equal(enrichedOnce.ratingAverage, 4.8);
});

test('3. Chapter stimulus funnel distributes original budget without creating new budgets, skips drafts, and lets real views prevail', () => {
  const startedAtMs = 1_700_000_000_000;
  const now72h = startedAtMs + 72 * 3600 * 1000;
  const manga = buildBaseManga({
    stimulusSettledViews: 0,
    stimulusWindows: [
      {
        chapterId: 'ch-1',
        startedAtMs,
        budget: 500,
        seed: 12345,
        durationHours: 72,
      },
    ],
  });

  const ch1 = buildChapter({ id: 'ch-1', chapterNumber: 1, realViewsCount: 40, viewsCount: 40 });
  const ch2 = buildChapter({ id: 'ch-2', chapterNumber: 2, realViewsCount: 28, viewsCount: 28 });
  const ch3 = buildChapter({ id: 'ch-3', chapterNumber: 3, realViewsCount: 150, viewsCount: 150 });
  const draftCh = buildChapter({
    id: 'ch-4',
    chapterNumber: 4,
    status: 'draft',
    realViewsCount: 0,
    viewsCount: 0,
  });
  const emptyCh = buildChapter({
    id: 'ch-5',
    chapterNumber: 5,
    status: 'published',
    pagesCount: 0,
    realViewsCount: 0,
    viewsCount: 0,
  });

  const distributed = distributeWorkStimulusAcrossChapters({
    manga,
    chapters: [ch1, ch2, ch3, draftCh, emptyCh],
    nowMs: now72h,
  });

  const totalStimulusAllocated = distributed.reduce(
    (sum, c) => sum + (c.stimulusViewsCount ?? 0),
    0
  );
  assert.equal(totalStimulusAllocated, 500);

  const d1 = distributed.find((c) => c.id === 'ch-1')!;
  const d2 = distributed.find((c) => c.id === 'ch-2')!;
  const d3 = distributed.find((c) => c.id === 'ch-3')!;
  const dDraft = distributed.find((c) => c.id === 'ch-4')!;
  const dEmpty = distributed.find((c) => c.id === 'ch-5')!;

  assert.equal(dDraft.stimulusViewsCount, 0);
  assert.equal(dEmpty.stimulusViewsCount, 0);
  assert.ok((d1.stimulusViewsCount ?? 0) >= (d2.stimulusViewsCount ?? 0));
  // Real views prevail: Chapter 3 has strong real interest (150 real reads), so total views reflect reality
  assert.equal(d3.realViewsCount, 150);
  assert.equal(d3.viewsCount, 150 + (d3.stimulusViewsCount ?? 0));
});

test('4. UTC daily 24h buckets, 24h stimulus delta, and creator milestones operate deterministically', () => {
  const dayMs = Date.UTC(2026, 10, 18, 12, 0, 0);
  const todayKey = getUtcDayKey(dayMs);
  assert.equal(todayKey, '2026-11-18');

  const patch1 = buildNextDailyBucketPatch({
    prefix: 'realViews',
    delta: 1,
    nowMs: dayMs,
  });
  assert.equal(patch1.realViewsDayKey, '2026-11-18');
  assert.equal(patch1.realViewsTodayCount, 1);

  const patch2 = buildNextDailyBucketPatch({
    prefix: 'realViews',
    currentDayKey: String(patch1.realViewsDayKey),
    currentTodayCount: Number(patch1.realViewsTodayCount),
    currentPrevDayKey: String(patch1.realViewsPrevDayKey),
    currentPrevDayCount: Number(patch1.realViewsPrevDayCount),
    delta: 1,
    nowMs: dayMs + 24 * 3600 * 1000,
  });
  assert.equal(patch2.realViewsDayKey, '2026-11-19');
  assert.equal(patch2.realViewsTodayCount, 1);
  assert.equal(patch2.realViewsPrevDayKey, '2026-11-18');
  assert.equal(patch2.realViewsPrevDayCount, 1);

  const recent24hReal = computeRecent24hFromDailyBuckets(
    String(patch2.realViewsDayKey),
    Number(patch2.realViewsTodayCount),
    String(patch2.realViewsPrevDayKey),
    Number(patch2.realViewsPrevDayCount),
    dayMs + 24 * 3600 * 1000
  );
  assert.equal(recent24hReal, 2);

  const startedAtMs = 1_700_000_000_000;
  const raw = buildBaseManga({
    stimulusWindows: [
      {
        chapterId: 'ch-1',
        startedAtMs,
        budget: 400,
        seed: 334455,
        durationHours: 72,
      },
    ],
  });
  const recentStim = computeMangaRecent24hStimulusViews(raw, startedAtMs + 24 * 3600 * 1000);
  assert.ok(recentStim > 0 && recentStim <= 400);

  const enriched = enrichMangaWithViews(raw, startedAtMs + 72 * 3600 * 1000);
  const memStore = new Map<string, string>();
  const storageAdapter = {
    getItem: (k: string) => memStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memStore.set(k, v);
    },
  };
  const firstMsg = evaluateNewStimulusMilestones({
    userId: 'author-1',
    mangas: [enriched],
    totalFollowers: 12,
    storage: storageAdapter,
  });
  assert.ok(firstMsg && firstMsg.includes('Marco'));

  const secondMsg = evaluateNewStimulusMilestones({
    userId: 'author-1',
    mangas: [enriched],
    totalFollowers: 12,
    storage: storageAdapter,
  });
  assert.equal(secondMsg, null);
});

test('5. Legacy stimulusWindows[1..] are preserved for views without altering real counts', () => {
  const startedAtMs = 1_700_000_000_000;
  const nowAfterAll = startedAtMs + 120 * 3600 * 1000;

  const legacyManga = buildBaseManga({
    id: 'legacy-multi-window',
    viewsCount: 10,
    realViewsCount: 10,
    stimulusSettledViews: 50,
    stimulusWindows: [
      {
        chapterId: 'ch-1',
        startedAtMs,
        budget: 15,
        seed: 101,
        durationHours: 72,
      },
      {
        chapterId: 'ch-2',
        startedAtMs: startedAtMs + 24 * 3600 * 1000,
        budget: 300,
        seed: 202,
        durationHours: 72,
      },
    ],
  });

  const totalStimulusViews = computeMangaStimulusViews(legacyManga, nowAfterAll);
  assert.equal(totalStimulusViews, 50 + 15 + 300);

  const enriched = enrichMangaWithViews(legacyManga, nowAfterAll);
  assert.equal(enriched.realViewsCount, 10);
  assert.equal(enriched.stimulusViewsCount, 365);
  assert.equal(enriched.viewsCount, 375);
});

