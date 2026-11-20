import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RANKING_CONSTANTS,
  computeBayesianRating,
  computeMangaChapterStats,
  computeMangaRankingScore,
  computeRecentTraction,
  hasAllPagesMotion,
  isChapterMotionEligible,
  isPageMotionValid,
  rankMangas,
  selectFeaturedManga,
  selectLatestReleases,
  selectMotionSpotlight,
  selectPopularMangas,
  selectRecommendedMangas,
  sortExploreMangas,
} from '../src/lib/ranking.ts';
import {
  distributeWorkStimulusAcrossChapters,
  enrichMangaWithViews,
  getUtcDayKey,
} from '../src/lib/stimulus.ts';
import type { Chapter, ChapterPage, Manga } from '../src/types/manga.ts';

function makeManga(overrides: Partial<Manga> = {}): Manga {
  return {
    id: 'manga-1',
    authorId: 'author-1',
    authorName: 'Autor',
    title: 'Obra Base',
    slug: 'obra-base',
    synopsis: 'Sinopse padrão',
    coverUrl: '',
    bannerUrl: '',
    genres: ['Ação'],
    ageRating: '14+',
    status: 'ongoing',
    moderationStatus: 'approved',
    isFeatured: false,
    hasMotion: false,
    chaptersCount: 1,
    viewsCount: 0,
    realViewsCount: 0,
    ratingAverage: 0,
    ratingCount: 0,
    realRatingAverage: 0,
    realRatingCount: 0,
    ...overrides,
  };
}

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1',
    mangaId: 'manga-1',
    authorId: 'author-1',
    chapterNumber: 1,
    title: 'Capítulo 1',
    status: 'published',
    hasMotion: false,
    pagesCount: 5,
    viewsCount: 0,
    realViewsCount: 0,
    ...overrides,
  };
}

function makePage(pageNumber: number, withMotion: boolean): ChapterPage {
  return {
    id: `p-${pageNumber}`,
    mangaId: 'manga-1',
    chapterId: 'ch-1',
    authorId: 'author-1',
    chapterStatus: 'published',
    pageNumber,
    originalUrl: `/media/orig-${pageNumber}.jpg`,
    originalMime: 'image/jpeg',
    motionUrl: withMotion ? `/media/motion-${pageNumber}.mp4` : '',
    motionMime: withMotion ? 'video/mp4' : '',
  };
}

test('1. Regra estrita de elegibilidade Motion: 100% das páginas animadas é obrigatório', () => {
  // 5 páginas, todas animadas -> Motion
  const all5 = [1, 2, 3, 4, 5].map((n) => makePage(n, true));
  assert.equal(hasAllPagesMotion(all5), true);

  // 5 páginas, 4 animadas e 1 estática -> NÃO é Motion
  const fourOfFive = [
    makePage(1, true),
    makePage(2, true),
    makePage(3, true),
    makePage(4, true),
    makePage(5, false),
  ];
  assert.equal(hasAllPagesMotion(fourOfFive), false);

  // 10 páginas, 9 animadas e 1 estática -> NÃO é Motion
  const nineOfTen = Array.from({ length: 10 }, (_, idx) => makePage(idx + 1, idx < 9));
  assert.equal(hasAllPagesMotion(nineOfTen), false);

  // 10 páginas, todas animadas -> Motion
  const all10 = Array.from({ length: 10 }, (_, idx) => makePage(idx + 1, true));
  assert.equal(hasAllPagesMotion(all10), true);

  // Página sem motionMime não é válida mesmo se tiver URL
  assert.equal(isPageMotionValid({ motionUrl: '/a.mp4', motionMime: '' }), false);

  // Capítulo rascunho não é elegível mesmo com todas páginas animadas
  const draftCh = makeChapter({ status: 'draft', hasMotion: true, pagesCount: 5 });
  assert.equal(isChapterMotionEligible(draftCh, all5), false);
});

test('2. Obra mista (capítulo Motion + capítulo Tradicional) recebe bônus proporcional e nunca é classificada como 100% Motion', () => {
  const ch1 = makeChapter({ id: 'ch-1', chapterNumber: 1, hasMotion: true, realViewsCount: 50 });
  const ch2 = makeChapter({ id: 'ch-2', chapterNumber: 2, hasMotion: false, realViewsCount: 40 });
  const mangaMixed = makeManga({ id: 'mixed', hasMotion: true, realViewsCount: 90, viewsCount: 90 });

  const chFull1 = makeChapter({ id: 'f-1', chapterNumber: 1, hasMotion: true, realViewsCount: 50 });
  const chFull2 = makeChapter({ id: 'f-2', chapterNumber: 2, hasMotion: true, realViewsCount: 40 });
  const mangaFullMotion = makeManga({
    id: 'full',
    hasMotion: true,
    realViewsCount: 90,
    viewsCount: 90,
  });

  const mixedRes = computeMangaRankingScore({ manga: mangaMixed, chapters: [ch1, ch2] });
  const fullRes = computeMangaRankingScore({ manga: mangaFullMotion, chapters: [chFull1, chFull2] });

  assert.equal(mixedRes.stats.validMotionChaptersCount, 1);
  assert.equal(mixedRes.stats.publishedChaptersCount, 2);
  assert.equal(mixedRes.stats.motionChapterRatio, 0.5);

  assert.equal(fullRes.stats.validMotionChaptersCount, 2);
  assert.equal(fullRes.stats.motionChapterRatio, 1);

  assert.ok(fullRes.components.motionBonus > mixedRes.components.motionBonus);
  assert.ok(fullRes.components.motionBonus <= RANKING_CONSTANTS.MAX_MOTION_BONUS);
});

test('3. Prioridade competitiva: em engajamento igual, obra Motion vence Tradicional', () => {
  const baseParams = {
    realViewsCount: 150,
    viewsCount: 150,
    realRatingAverage: 4.6,
    realRatingCount: 10,
    ratingAverage: 4.6,
    ratingCount: 10,
  };

  const motionManga = makeManga({ id: 'motion', hasMotion: true, ...baseParams });
  const tradManga = makeManga({ id: 'trad', hasMotion: false, ...baseParams });

  const chaptersByMangaId = {
    motion: [
      makeChapter({ id: 'm1', mangaId: 'motion', chapterNumber: 1, hasMotion: true, realViewsCount: 90 }),
      makeChapter({ id: 'm2', mangaId: 'motion', chapterNumber: 2, hasMotion: true, realViewsCount: 60 }),
    ],
    trad: [
      makeChapter({ id: 't1', mangaId: 'trad', chapterNumber: 1, hasMotion: false, realViewsCount: 90 }),
      makeChapter({ id: 't2', mangaId: 'trad', chapterNumber: 2, hasMotion: false, realViewsCount: 60 }),
    ],
  };

  const ranked = rankMangas([tradManga, motionManga], chaptersByMangaId);
  assert.equal(ranked[0].manga.id, 'motion');
  assert.equal(ranked[1].manga.id, 'trad');
});

test('4. Engajamento verdadeiro prevalece: mangá Tradicional muito superior ultrapassa mangá Motion fraco', () => {
  const weakMotion = makeManga({
    id: 'weak-motion',
    hasMotion: true,
    realViewsCount: 25,
    viewsCount: 25,
    realRatingAverage: 4.0,
    realRatingCount: 2,
    ratingAverage: 4.0,
    ratingCount: 2,
  });

  const hitTraditional = makeManga({
    id: 'hit-trad',
    hasMotion: false,
    realViewsCount: 3200,
    viewsCount: 3200,
    realRatingAverage: 4.9,
    realRatingCount: 85,
    ratingAverage: 4.9,
    ratingCount: 85,
  });

  const chaptersByMangaId = {
    'weak-motion': [
      makeChapter({ id: 'wm-1', mangaId: 'weak-motion', chapterNumber: 1, hasMotion: true, realViewsCount: 25 }),
    ],
    'hit-trad': [
      makeChapter({ id: 'ht-1', mangaId: 'hit-trad', chapterNumber: 1, hasMotion: false, realViewsCount: 1200 }),
      makeChapter({ id: 'ht-2', mangaId: 'hit-trad', chapterNumber: 2, hasMotion: false, realViewsCount: 1050 }),
      makeChapter({ id: 'ht-3', mangaId: 'hit-trad', chapterNumber: 3, hasMotion: false, realViewsCount: 950 }),
    ],
  };

  const ranked = rankMangas([weakMotion, hitTraditional], chaptersByMangaId);
  assert.equal(ranked[0].manga.id, 'hit-trad');
  assert.ok(ranked[0].ranking.score > ranked[1].ranking.score + 20);
});

test('5. Engajamento real vs estimulado: estímulo máximo não vence engajamento real comprovado e não gera notas fictícias', () => {
  const startedAtMs = 1_700_000_000_000;
  const nowMs = startedAtMs + 72 * 3600 * 1000;

  const stimulatedOnly = enrichMangaWithViews(
    makeManga({
      id: 'stim-only',
      realViewsCount: 5,
      viewsCount: 5,
      stimulusWindows: [{ chapterId: 'ch-1', startedAtMs, budget: 1000, seed: 99, durationHours: 72 }],
    }),
    nowMs
  );

  // Views reais e notas reais preservados internamente
  assert.equal(stimulatedOnly.realViewsCount, 5);
  assert.equal(stimulatedOnly.ratingCount, 0);
  assert.equal(stimulatedOnly.ratingAverage, 0);
  assert.equal(stimulatedOnly.stimulusViewsCount, 1000);

  const realEngagementWork = enrichMangaWithViews(
    makeManga({
      id: 'real-work',
      realViewsCount: 220,
      viewsCount: 220,
      realRatingAverage: 4.8,
      realRatingCount: 14,
      ratingAverage: 4.8,
      ratingCount: 14,
    }),
    nowMs
  );

  const ranked = rankMangas([stimulatedOnly, realEngagementWork], {}, { nowMs });
  assert.equal(ranked[0].manga.id, 'real-work');
  // trueEngagement de stimulatedOnly ignora stimulusViewsCount (baseado apenas em realViewsCount = 5)
  const baselineOnlyRealViews = computeMangaRankingScore(
    { manga: { ...stimulatedOnly, viewsCount: 5, stimulusViewsCount: 0 } },
    nowMs
  );
  assert.equal(ranked[1].ranking.components.trueEngagement, baselineOnlyRealViews.components.trueEngagement);
  assert.ok(
    ranked[1].ranking.components.stimulusDiscovery <=
      RANKING_CONSTANTS.MAX_STIMULUS_DISCOVERY_BONUS
  );
});

test('6. Preservação do orçamento único: novas publicações de capítulos não geram orçamento extra além de 1..1000', () => {
  const startedAtMs = 1_700_000_000_000;
  const nowMs = startedAtMs + 72 * 3600 * 1000;
  const manga = enrichMangaWithViews(
    makeManga({
      stimulusSettledViews: 0,
      stimulusWindows: [{ chapterId: 'ch-1', startedAtMs, budget: 700, seed: 44, durationHours: 72 }],
    }),
    nowMs
  );

  const threeChapters = [
    makeChapter({ id: 'ch-1', chapterNumber: 1, firstPublishedAt: startedAtMs }),
    makeChapter({ id: 'ch-2', chapterNumber: 2, firstPublishedAt: startedAtMs + 10 * 3600 * 1000 }),
    makeChapter({ id: 'ch-3', chapterNumber: 3, firstPublishedAt: startedAtMs + 20 * 3600 * 1000 }),
  ];

  const distributed = distributeWorkStimulusAcrossChapters({ manga, chapters: threeChapters, nowMs });
  const sumStimulus = distributed.reduce((s, c) => s + (c.stimulusViewsCount ?? 0), 0);
  assert.equal(sumStimulus, 700);
});

test('7. Funil entre capítulos ignora rascunhos/0 páginas e permite capítulo posterior com maior interesse real superar anteriores', () => {
  const startedAtMs = 1_700_000_000_000;
  const nowMs = startedAtMs + 72 * 3600 * 1000;
  const manga = makeManga({
    stimulusWindows: [{ chapterId: 'ch-1', startedAtMs, budget: 300, seed: 11, durationHours: 72 }],
  });

  const chapters = [
    makeChapter({ id: 'c1', chapterNumber: 1, status: 'published', pagesCount: 8, realViewsCount: 30 }),
    makeChapter({ id: 'c2', chapterNumber: 2, status: 'published', pagesCount: 8, realViewsCount: 180 }),
    makeChapter({ id: 'c3', chapterNumber: 3, status: 'draft', pagesCount: 8, realViewsCount: 0 }),
    makeChapter({ id: 'c4', chapterNumber: 4, status: 'published', pagesCount: 0, realViewsCount: 0 }),
  ];

  const out = distributeWorkStimulusAcrossChapters({ manga, chapters, nowMs });
  const c1 = out.find((c) => c.id === 'c1')!;
  const c2 = out.find((c) => c.id === 'c2')!;
  const c3 = out.find((c) => c.id === 'c3')!;
  const c4 = out.find((c) => c.id === 'c4')!;

  assert.equal(c3.stimulusViewsCount, 0);
  assert.equal(c4.stimulusViewsCount, 0);
  assert.ok(c2.viewsCount > c1.viewsCount);
});

test('8. Crescimento logarítmico de capítulos impede que obra antiga com 30 capítulos fracos vença obra nova forte', () => {
  const oldSpamManga = makeManga({
    id: 'old-30-weak',
    realViewsCount: 60,
    viewsCount: 60,
  });
  const old30Chapters = Array.from({ length: 30 }, (_, idx) =>
    makeChapter({
      id: `old-${idx + 1}`,
      mangaId: 'old-30-weak',
      chapterNumber: idx + 1,
      realViewsCount: idx === 0 ? 30 : 1,
    })
  );

  const newStrongManga = makeManga({
    id: 'new-3-strong',
    realViewsCount: 450,
    viewsCount: 450,
    realRatingAverage: 4.8,
    realRatingCount: 16,
    ratingAverage: 4.8,
    ratingCount: 16,
  });
  const new3Chapters = [1, 2, 3].map((n) =>
    makeChapter({
      id: `new-${n}`,
      mangaId: 'new-3-strong',
      chapterNumber: n,
      realViewsCount: 160 - n * 10,
    })
  );

  const ranked = rankMangas([oldSpamManga, newStrongManga], {
    'old-30-weak': old30Chapters,
    'new-3-strong': new3Chapters,
  });

  assert.equal(ranked[0].manga.id, 'new-3-strong');
  assert.ok(
    ranked[1].ranking.components.chapterDepth <= RANKING_CONSTANTS.MAX_CHAPTER_DEPTH_BONUS
  );
});

test('9. Retenção individual (Cap 1->2, Cap 2->3, demais) e suavização Bayesiana protegem obras com poucas leituras', () => {
  // Obra com poucas observações (2 leituras no cap 1, 0 no cap 2) não despenca para 0%
  const tinyWork = makeManga({ id: 'tiny' });
  const tinyStats = computeMangaChapterStats(tinyWork, [
    makeChapter({ id: 't1', chapterNumber: 1, realViewsCount: 2 }),
    makeChapter({ id: 't2', chapterNumber: 2, realViewsCount: 0 }),
  ]);
  assert.ok(tinyStats.retentionCap1To2 !== null && tinyStats.retentionCap1To2 > 0.45);
  assert.ok(tinyStats.retentionScore >= 5);

  // Obra grande com alta retenção vs obra com forte queda
  const highRetention = computeMangaChapterStats(makeManga({ id: 'high' }), [
    makeChapter({ id: 'h1', chapterNumber: 1, realViewsCount: 200 }),
    makeChapter({ id: 'h2', chapterNumber: 2, realViewsCount: 185 }),
    makeChapter({ id: 'h3', chapterNumber: 3, realViewsCount: 175 }),
    makeChapter({ id: 'h4', chapterNumber: 4, realViewsCount: 170 }),
  ]);
  const lowRetention = computeMangaChapterStats(makeManga({ id: 'low' }), [
    makeChapter({ id: 'l1', chapterNumber: 1, realViewsCount: 200 }),
    makeChapter({ id: 'l2', chapterNumber: 2, realViewsCount: 10 }),
    makeChapter({ id: 'l3', chapterNumber: 3, realViewsCount: 5 }),
    makeChapter({ id: 'l4', chapterNumber: 4, realViewsCount: 2 }),
  ]);

  assert.ok(highRetention.retentionCap1To2! > lowRetention.retentionCap1To2!);
  assert.ok(highRetention.retentionCap2To3! > lowRetention.retentionCap2To3!);
  assert.ok(highRetention.retentionSubsequentAvg! > lowRetention.retentionSubsequentAvg!);
  assert.ok(highRetention.retentionScore > lowRetention.retentionScore);
});

test('10. Nota Bayesiana impede que 1 avaliação 5.0★ supere 30 avaliações 4.8★', () => {
  const oneFiveStar = computeBayesianRating(5.0, 1);
  const thirtyFourPointEight = computeBayesianRating(4.8, 30);
  assert.ok(thirtyFourPointEight > oneFiveStar);
});

test('11. Tração recente classifica corretamente Em alta agora, Em ascensão, Aquecendo e Estável', () => {
  const nowMs = Date.UTC(2026, 10, 18, 18, 0, 0);
  const todayKey = getUtcDayKey(nowMs);

  const emAltaManga = makeManga({
    id: 'em-alta',
    realViewsDayKey: todayKey,
    realViewsTodayCount: 28,
    lastChapterPublishedAt: nowMs - 2 * 3600 * 1000,
  });
  const emAlta = computeRecentTraction(
    emAltaManga,
    computeMangaChapterStats(emAltaManga),
    nowMs
  );
  assert.equal(emAlta.classification, 'em_alta');
  assert.equal(emAlta.label, 'Em alta agora');

  const ascensaoManga = makeManga({
    id: 'ascensao',
    realViewsDayKey: todayKey,
    realViewsTodayCount: 7,
    lastChapterPublishedAt: nowMs - 400 * 3600 * 1000,
  });
  const ascensao = computeRecentTraction(
    ascensaoManga,
    computeMangaChapterStats(ascensaoManga),
    nowMs
  );
  assert.equal(ascensao.classification, 'em_ascensao');
  assert.equal(ascensao.label, 'Em ascensão');

  const aquecendoManga = makeManga({
    id: 'aquecendo',
    realViewsDayKey: todayKey,
    realViewsTodayCount: 2,
    lastChapterPublishedAt: nowMs - 400 * 3600 * 1000,
  });
  const aquecendo = computeRecentTraction(
    aquecendoManga,
    computeMangaChapterStats(aquecendoManga),
    nowMs
  );
  assert.equal(aquecendo.classification, 'aquecendo');

  const estavelManga = makeManga({
    id: 'estavel',
    lastChapterPublishedAt: nowMs - 500 * 3600 * 1000,
  });
  const estavel = computeRecentTraction(
    estavelManga,
    computeMangaChapterStats(estavelManga),
    nowMs
  );
  assert.equal(estavel.classification, 'estavel');
});

test('12. Anti-manipulação: alterar sinopse ou updatedAt NÃO sobe a obra no ranking nem nos Lançamentos Recentes', () => {
  const pubMs = Date.UTC(2026, 10, 10, 12, 0, 0);
  const recentPubMs = Date.UTC(2026, 10, 18, 12, 0, 0);

  const editedOlderMangaBefore = makeManga({
    id: 'older-edited',
    realViewsCount: 50,
    viewsCount: 50,
    lastChapterPublishedAt: pubMs,
    createdAt: pubMs,
    updatedAt: pubMs,
  });

  const editedOlderMangaAfter = makeManga({
    ...editedOlderMangaBefore,
    synopsis: 'Sinopse editada apenas para tentar ganhar posição',
    updatedAt: recentPubMs + 1000 * 3600,
  });

  const newerRelease = makeManga({
    id: 'newer-release',
    realViewsCount: 50,
    viewsCount: 50,
    lastChapterPublishedAt: recentPubMs,
    createdAt: recentPubMs,
    updatedAt: recentPubMs,
  });

  const scoreBefore = computeMangaRankingScore({ manga: editedOlderMangaBefore }, recentPubMs);
  const scoreAfter = computeMangaRankingScore({ manga: editedOlderMangaAfter }, recentPubMs);
  assert.equal(scoreAfter.score, scoreBefore.score);

  const latest = selectLatestReleases([editedOlderMangaAfter, newerRelease], {}, recentPubMs, 10);
  assert.equal(latest[0].id, 'newer-release');

  const exploreRecent = sortExploreMangas(
    [editedOlderMangaAfter, newerRelease],
    {},
    'recent',
    recentPubMs
  );
  assert.equal(exploreRecent[0].id, 'newer-release');
});

test('13. Vitrines especializadas: Motion Spotlight exclui obras sem capítulo 100% Motion e Recomendados aplica afinidade por gênero', () => {
  const partialPages: Record<string, ChapterPage[]> = {
    'p-ch-1': [makePage(1, true), makePage(2, false)],
  };

  const fakeMotionManga = makeManga({ id: 'partial', hasMotion: true, genres: ['Fantasia'] });
  const partialChapter = makeChapter({
    id: 'p-ch-1',
    mangaId: 'partial',
    hasMotion: true,
    pagesCount: 2,
  });

  const strictMotionStats = computeMangaChapterStats(
    fakeMotionManga,
    [partialChapter],
    partialPages
  );
  assert.equal(strictMotionStats.hasStrictMotion, false);
  assert.equal(strictMotionStats.validMotionChaptersCount, 0);

  const realMotionManga = makeManga({
    id: 'real-motion',
    hasMotion: true,
    genres: ['Ação'],
    realViewsCount: 100,
    viewsCount: 100,
  });
  const realMotionChapter = makeChapter({
    id: 'r-ch-1',
    mangaId: 'real-motion',
    hasMotion: true,
    pagesCount: 5,
    realViewsCount: 100,
  });

  const tradFantasy = makeManga({
    id: 'trad-fantasy',
    hasMotion: false,
    genres: ['Fantasia'],
    realViewsCount: 100,
    viewsCount: 100,
  });

  const spotlight = selectMotionSpotlight(
    [fakeMotionManga, realMotionManga, tradFantasy],
    {
      partial: [makeChapter({ id: 'p-ch-1', mangaId: 'partial', hasMotion: false, pagesCount: 2 })],
      'real-motion': [realMotionChapter],
      'trad-fantasy': [makeChapter({ id: 'tf-1', mangaId: 'trad-fantasy', hasMotion: false })],
    }
  );
  assert.deepEqual(
    spotlight.map((m) => m.id),
    ['real-motion']
  );

  const recommended = selectRecommendedMangas(
    [realMotionManga, tradFantasy],
    {},
    { preferredGenres: new Set(['Fantasia']) }
  );
  assert.equal(recommended[0].id, 'trad-fantasy');
});

test('14. Seletores Featured e Popular respeitam status público e editorial', () => {
  const preLaunch = makeManga({
    id: 'pre',
    status: 'pre_launch',
    realViewsCount: 900,
    viewsCount: 900,
  });
  const editorial = makeManga({
    id: 'ed',
    status: 'ongoing',
    isFeatured: true,
    realViewsCount: 20,
    viewsCount: 20,
  });
  const popularHit = makeManga({
    id: 'hit',
    status: 'ongoing',
    realViewsCount: 800,
    viewsCount: 800,
  });

  const featured = selectFeaturedManga([preLaunch, editorial, popularHit]);
  assert.equal(featured?.id, 'ed');

  const popular = selectPopularMangas([preLaunch, editorial, popularHit]);
  assert.equal(popular[0].id, 'hit');
  assert.ok(!popular.some((m) => m.id === 'pre'));
});

test('15. Pré-lançamento recebe penalidade multiplicativa frente a obras já publicadas com engajamento semelhante', () => {
  const preLaunch = makeManga({
    id: 'pre-work',
    status: 'pre_launch',
    realViewsCount: 30,
    viewsCount: 30,
  });
  const published = makeManga({
    id: 'pub-work',
    status: 'ongoing',
    realViewsCount: 30,
    viewsCount: 30,
  });

  const ranked = rankMangas([preLaunch, published]);
  assert.equal(ranked[0].manga.id, 'pub-work');
});
