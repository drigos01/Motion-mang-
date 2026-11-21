import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteMediaAssets } from '../lib/api';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  DEFAULT_STIMULUS_SETTINGS,
  buildNextDailyBucketPatch,
  distributeWorkStimulusAcrossChapters,
  enrichChapterWithViews,
  enrichMangaWithViews,
  pickWorkStimulusBudgetAndSeed,
} from '../lib/stimulus';
import {
  computeMangaChapterStats,
  computeMangaRankingScore,
  hasAllPagesMotion,
  isChapterMotionEligible,
  selectLatestReleases,
} from '../lib/ranking';
import {
  AgeRating,
  AppNotification,
  Chapter,
  ChapterComment,
  ChapterPage,
  ChapterStatus,
  FollowRelation,
  MAX_LIMITS,
  Manga,
  MangaPreview,
  MangaPreviewChapter,
  MangaPreviewPage,
  MangaRating,
  MangaStatus,
  MangaWishlistItem,
  ModerationReport,
  ModerationStatus,
  ReaderMode,
  ReadingHistoryItem,
  StimulusSettings,
  StimulusWindow,
  UserProfile,
} from '../types/manga';

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function makeSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 140) || 'manga'
  );
}

export function normalizePreviewSlug(raw: string): string {
  return (
    raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'obra'
  );
}

export function makePreviewToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'pv';
  for (let i = 0; i < 10; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export function buildPreviewKey(slug: string, token: string): string {
  const safeSlug = normalizePreviewSlug(slug).slice(0, 80);
  const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || makePreviewToken();
  return `${safeSlug}-${safeToken}`.slice(0, 128);
}

function toMillis(ts: unknown): number {
  if (ts && typeof ts === 'object' && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

const inFlightHistory = new Map<string, Promise<ReadingHistoryItem[]>>();
const inFlightFollows = new Map<string, Promise<FollowRelation[]>>();

export interface PublishedCatalogRankingData {
  mangas: Manga[];
  chaptersByMangaId: Record<string, Chapter[]>;
}

const CATALOG_CACHE_TTL_MS = 30_000;
let catalogCache: { data: PublishedCatalogRankingData; expiresAtMs: number } | null = null;
let inFlightCatalog: Promise<PublishedCatalogRankingData> | null = null;

export function invalidateCatalogCache(): void {
  catalogCache = null;
}

async function verifyPublishedChaptersMotionAndDistribute(
  manga: Manga,
  rawChapters: Chapter[],
  nowMs: number,
  verifyPages = true
): Promise<Chapter[]> {
  const verifiedChapters = await Promise.all(
    rawChapters.map(async (ch) => {
      if (ch.status !== 'published' || ch.pagesCount <= 0) {
        return { ...ch, hasMotion: false };
      }
      if (!ch.hasMotion || !verifyPages) {
        return ch;
      }
      try {
        const pages = await fetchChapterPages(manga.id, ch.id, false);
        const strictMotion = hasAllPagesMotion(pages);
        return { ...ch, pagesCount: pages.length, hasMotion: strictMotion };
      } catch {
        return ch;
      }
    })
  );

  return distributeWorkStimulusAcrossChapters({
    manga,
    chapters: verifiedChapters,
    nowMs,
  });
}

// --- PUBLIC CATALOG QUERIES ---

export async function fetchPublishedCatalogWithRankingData(
  forceRefresh = false
): Promise<PublishedCatalogRankingData> {
  const nowMs = Date.now();
  if (!forceRefresh && catalogCache && catalogCache.expiresAtMs > nowMs) {
    return catalogCache.data;
  }
  if (!forceRefresh && inFlightCatalog) {
    return inFlightCatalog;
  }

  const run = async (): Promise<PublishedCatalogRankingData> => {
    try {
      const q = query(
        collection(db, 'mangas'),
        where('moderationStatus', '==', 'approved'),
        where('status', 'in', ['pre_launch', 'ongoing', 'completed', 'hiatus'])
      );
      const snap = await getDocs(q);
      const tsNow = Date.now();
      const baseMangas = snap.docs.map((d) => enrichMangaWithViews(d.data() as Manga, tsNow));

      const chaptersByMangaId: Record<string, Chapter[]> = {};
      const enrichedMangas = await Promise.all(
        baseMangas.map(async (manga) => {
          let rawChapters: Chapter[] = [];
          try {
            const chSnap = await getDocs(
              query(collection(db, 'mangas', manga.id, 'chapters'), where('status', '==', 'published'))
            );
            rawChapters = chSnap.docs
              .map((d) => d.data() as Chapter)
              .sort((a, b) => a.chapterNumber - b.chapterNumber);
          } catch {
            rawChapters = [];
          }

          const distributedChapters = await verifyPublishedChaptersMotionAndDistribute(
            manga,
            rawChapters,
            tsNow,
            true
          );

          chaptersByMangaId[manga.id] = distributedChapters;
          const stats = computeMangaChapterStats(manga, distributedChapters);
          const ranking = computeMangaRankingScore(
            { manga, chapters: distributedChapters },
            tsNow
          );

          return {
            ...manga,
            hasMotion: stats.hasStrictMotion,
            chaptersCount: stats.publishedChaptersCount,
            publishedChapters: distributedChapters,
            validMotionChaptersCount: stats.validMotionChaptersCount,
            motionChapterRatio: stats.motionChapterRatio,
            rankingScore: ranking.score,
            tractionLabel: ranking.traction.classification,
          };
        })
      );

      const ordered = selectLatestReleases(enrichedMangas, chaptersByMangaId, tsNow, enrichedMangas.length);
      const data: PublishedCatalogRankingData = {
        mangas: ordered,
        chaptersByMangaId,
      };
      catalogCache = { data, expiresAtMs: Date.now() + CATALOG_CACHE_TTL_MS };
      return data;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'mangas');
    }
  };

  inFlightCatalog = run().finally(() => {
    inFlightCatalog = null;
  });
  return inFlightCatalog;
}

export async function fetchPublishedMangas(): Promise<Manga[]> {
  const { mangas } = await fetchPublishedCatalogWithRankingData();
  return mangas;
}

export async function fetchMangaById(mangaId: string): Promise<Manga | null> {
  const path = `mangas/${mangaId}`;
  try {
    const snap = await getDoc(doc(db, 'mangas', mangaId));
    if (!snap.exists()) return null;
    const nowMs = Date.now();
    const enriched = enrichMangaWithViews(snap.data() as Manga, nowMs);
    try {
      const chSnap = await getDocs(
        query(collection(db, 'mangas', mangaId, 'chapters'), where('status', '==', 'published'))
      );
      const rawChapters = chSnap.docs
        .map((d) => d.data() as Chapter)
        .sort((a, b) => a.chapterNumber - b.chapterNumber);
      const distributed = await verifyPublishedChaptersMotionAndDistribute(
        enriched,
        rawChapters,
        nowMs,
        false
      );
      const stats = computeMangaChapterStats(enriched, distributed);
      const ranking = computeMangaRankingScore({ manga: enriched, chapters: distributed }, nowMs);
      return {
        ...enriched,
        hasMotion: stats.hasStrictMotion,
        chaptersCount: stats.publishedChaptersCount,
        publishedChapters: distributed,
        validMotionChaptersCount: stats.validMotionChaptersCount,
        motionChapterRatio: stats.motionChapterRatio,
        rankingScore: ranking.score,
        tractionLabel: ranking.traction.classification,
      };
    } catch {
      return enriched;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function isMangaPubliclyAccessible(mangaId: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'mangas', mangaId));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function fetchChaptersForManga(
  mangaId: string,
  includeDrafts = false,
  asAdmin = false,
  parentManga?: Manga | null
): Promise<Chapter[]> {
  const path = `mangas/${mangaId}/chapters`;
  try {
    const uid = auth.currentUser?.uid;
    const q = asAdmin
      ? collection(db, 'mangas', mangaId, 'chapters')
      : includeDrafts && uid
        ? query(collection(db, 'mangas', mangaId, 'chapters'), where('authorId', '==', uid))
        : query(collection(db, 'mangas', mangaId, 'chapters'), where('status', '==', 'published'));
    const snap = await getDocs(q);
    const nowMs = Date.now();
    const rawChapters = snap.docs
      .map((d) => d.data() as Chapter)
      .sort((a, b) => a.chapterNumber - b.chapterNumber);

    let resolvedManga = parentManga ?? null;
    if (!resolvedManga && rawChapters.length > 0) {
      try {
        const mSnap = await getDoc(doc(db, 'mangas', mangaId));
        if (mSnap.exists()) {
          resolvedManga = enrichMangaWithViews(mSnap.data() as Manga, nowMs);
        }
      } catch {
        resolvedManga = null;
      }
    }

    if (resolvedManga) {
      return distributeWorkStimulusAcrossChapters({
        manga: resolvedManga,
        chapters: rawChapters,
        nowMs,
      });
    }

    return rawChapters.map((c) => enrichChapterWithViews(c, nowMs));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchChapterPages(
  mangaId: string,
  chapterId: string,
  asAuthor = false,
  asAdmin = false
): Promise<ChapterPage[]> {
  const path = `mangas/${mangaId}/chapters/${chapterId}/pages`;
  try {
    const uid = auth.currentUser?.uid;
    const q = asAdmin
      ? collection(db, 'mangas', mangaId, 'chapters', chapterId, 'pages')
      : asAuthor && uid
        ? query(
            collection(db, 'mangas', mangaId, 'chapters', chapterId, 'pages'),
            where('authorId', '==', uid)
          )
        : query(
            collection(db, 'mangas', mangaId, 'chapters', chapterId, 'pages'),
            where('chapterStatus', '==', 'published')
          );
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => d.data() as ChapterPage);
    items.sort((a, b) => a.pageNumber - b.pageNumber);
    return items;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchCreatorMangas(authorId: string): Promise<Manga[]> {
  try {
    const q = query(collection(db, 'mangas'), where('authorId', '==', authorId));
    const snap = await getDocs(q);
    const nowMs = Date.now();
    const items = snap.docs.map((d) => enrichMangaWithViews(d.data() as Manga, nowMs));
    items.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
    return items;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'mangas');
  }
}

export async function fetchCreatorPublicProfile(uid: string): Promise<UserProfile | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

// --- PRIVATE PREVIEW LINK ISOLATED SNAPSHOTS ---

async function deletePreviewDocs(previewKey: string): Promise<void> {
  if (!previewKey) return;
  try {
    const chSnap = await getDocs(
      query(
        collection(db, 'manga_previews', previewKey, 'chapters'),
        where('previewKey', '==', previewKey)
      )
    );
    for (const chDoc of chSnap.docs) {
      const pSnap = await getDocs(
        query(
          collection(db, 'manga_previews', previewKey, 'chapters', chDoc.id, 'pages'),
          where('chapterId', '==', chDoc.id)
        )
      );
      for (let i = 0; i < pSnap.docs.length; i += 400) {
        const chunk = pSnap.docs.slice(i, i + 400);
        const pBatch = writeBatch(db);
        chunk.forEach((pd) => pBatch.delete(pd.ref));
        await pBatch.commit();
      }
      await deleteDoc(chDoc.ref);
    }
    const rootRef = doc(db, 'manga_previews', previewKey);
    const rootSnap = await getDoc(rootRef);
    if (rootSnap.exists()) {
      await deleteDoc(rootRef);
    }
  } catch {
    // Best-effort cleanup for revoked/stale preview snapshots
  }
}

export async function syncPreviewSnapshot(mangaId: string): Promise<void> {
  try {
    const mangaSnap = await getDoc(doc(db, 'mangas', mangaId));
    if (!mangaSnap.exists()) return;
    const m = mangaSnap.data() as Manga;
    if (!m.previewEnabled || !m.previewKey) return;

    const previewKey = m.previewKey;
    const previewSlug = normalizePreviewSlug(m.previewSlug || m.slug || m.title);
    const allChapters = await fetchChaptersForManga(mangaId, true);
    const preparedChapters = allChapters.filter((ch) => ch.pagesCount > 0);

    const previewRef = doc(db, 'manga_previews', previewKey);
    const existingPreviewSnap = await getDoc(previewRef);

    const cleanGenres = (m.genres || []).slice(0, 6).map((g) => g.slice(0, 40));
    if (cleanGenres.length === 0) cleanGenres.push('Ação');

    const preparedChapterEntries = await Promise.all(
      preparedChapters.map(async (ch) => {
        const chPages = await fetchChapterPages(mangaId, ch.id, true);
        return { ch, chPages, chHasMotion: hasAllPagesMotion(chPages) };
      })
    );

    const previewPayload: MangaPreview = {
      previewKey,
      previewSlug,
      mangaId: m.id,
      authorName: (m.authorName || 'Autor').trim().slice(0, MAX_LIMITS.DISPLAY_NAME) || 'Autor',
      title: (m.title || 'Obra').trim().slice(0, MAX_LIMITS.MANGA_TITLE) || 'Obra',
      synopsis: (m.synopsis || '...').trim().slice(0, MAX_LIMITS.MANGA_SYNOPSIS) || '...',
      coverUrl: (m.coverUrl || '').slice(0, 600),
      bannerUrl: (m.bannerUrl || '').slice(0, 600),
      genres: cleanGenres,
      ageRating: m.ageRating || '14+',
      status: m.status,
      hasMotion: preparedChapterEntries.some((entry) => entry.chHasMotion),
      chaptersCount: preparedChapters.length,
      ratingAverage: Math.min(5, Math.max(0, m.ratingAverage || 0)),
      ratingCount: Math.max(0, m.ratingCount || 0),
      isActive: true,
      createdAt: existingPreviewSnap.exists()
        ? existingPreviewSnap.data().createdAt
        : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(previewRef, previewPayload);

    // Reconcile chapters and pages inside manga_previews/{previewKey}
    const existingChSnap = await getDocs(
      query(
        collection(db, 'manga_previews', previewKey, 'chapters'),
        where('previewKey', '==', previewKey)
      )
    );
    const preparedSet = new Set(preparedChapters.map((c) => c.id));

    for (const staleChDoc of existingChSnap.docs) {
      if (!preparedSet.has(staleChDoc.id)) {
        const stalePagesSnap = await getDocs(
          query(
            collection(db, 'manga_previews', previewKey, 'chapters', staleChDoc.id, 'pages'),
            where('chapterId', '==', staleChDoc.id)
          )
        );
        for (let i = 0; i < stalePagesSnap.docs.length; i += 400) {
          const batch = writeBatch(db);
          stalePagesSnap.docs.slice(i, i + 400).forEach((pd) => batch.delete(pd.ref));
          await batch.commit();
        }
        await deleteDoc(staleChDoc.ref);
      }
    }

    for (const { ch, chPages, chHasMotion } of preparedChapterEntries) {
      const previewChRef = doc(db, 'manga_previews', previewKey, 'chapters', ch.id);
      const existingChSnapDoc = await getDoc(previewChRef);

      const previewChPayload: MangaPreviewChapter = {
        id: ch.id,
        mangaId: m.id,
        previewKey,
        chapterNumber: ch.chapterNumber,
        title: ch.title.trim().slice(0, MAX_LIMITS.CHAPTER_TITLE),
        status: ch.status,
        hasMotion: chHasMotion,
        pagesCount: chPages.length,
        createdAt: existingChSnapDoc.exists() ? existingChSnapDoc.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(previewChRef, previewChPayload);

      const existingPagesSnap = await getDocs(
        query(
          collection(db, 'manga_previews', previewKey, 'chapters', ch.id, 'pages'),
          where('chapterId', '==', ch.id)
        )
      );
      const livePageIds = new Set(chPages.map((p) => p.id));
      const existingCreatedMap = new Map<string, unknown>();
      existingPagesSnap.docs.forEach((pd) => {
        existingCreatedMap.set(pd.id, pd.data().createdAt);
      });

      let batch = writeBatch(db);
      let ops = 0;
      const commitIfFull = async () => {
        if (ops >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          ops = 0;
        }
      };

      for (const stalePageDoc of existingPagesSnap.docs) {
        if (!livePageIds.has(stalePageDoc.id)) {
          batch.delete(stalePageDoc.ref);
          ops++;
          await commitIfFull();
        }
      }

      for (const p of chPages) {
        const previewPagePayload: MangaPreviewPage = {
          id: p.id,
          mangaId: m.id,
          chapterId: ch.id,
          previewKey,
          pageNumber: p.pageNumber,
          originalUrl: p.originalUrl.slice(0, 600),
          originalMime: p.originalMime.slice(0, 80),
          motionUrl: (p.motionUrl || '').slice(0, 600),
          motionMime: (p.motionMime || '').slice(0, 80),
          createdAt: existingCreatedMap.get(p.id) || serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        batch.set(
          doc(db, 'manga_previews', previewKey, 'chapters', ch.id, 'pages', p.id),
          previewPagePayload
        );
        ops++;
        await commitIfFull();
      }

      if (ops > 0) {
        await batch.commit();
      }
    }
  } catch {
    // Non-blocking sync of preview snapshot
  }
}

export async function updateMangaPreviewLink(params: {
  manga: Manga;
  action: 'update_slug' | 'regenerate' | 'revoke';
  customSlug?: string;
}): Promise<Manga> {
  const { manga, action } = params;
  const path = `mangas/${manga.id}`;
  try {
    const oldKey = manga.previewKey || '';

    if (action === 'revoke') {
      if (oldKey) {
        await deletePreviewDocs(oldKey);
      }
      const nextSlug = normalizePreviewSlug(manga.previewSlug || manga.slug || manga.title);
      await updateDoc(doc(db, 'mangas', manga.id), {
        previewEnabled: false,
        previewSlug: nextSlug,
        previewToken: '',
        previewKey: '',
        updatedAt: serverTimestamp(),
      });
      return {
        ...manga,
        previewEnabled: false,
        previewSlug: nextSlug,
        previewToken: '',
        previewKey: '',
      };
    }

    const nextSlug = normalizePreviewSlug(
      params.customSlug !== undefined ? params.customSlug : manga.previewSlug || manga.slug || manga.title
    );
    const nextToken =
      action === 'regenerate' || !manga.previewToken ? makePreviewToken() : manga.previewToken;
    const nextKey = buildPreviewKey(nextSlug, nextToken);

    await updateDoc(doc(db, 'mangas', manga.id), {
      previewEnabled: true,
      previewSlug: nextSlug,
      previewToken: nextToken,
      previewKey: nextKey,
      updatedAt: serverTimestamp(),
    });

    if (oldKey && oldKey !== nextKey) {
      await deletePreviewDocs(oldKey);
    }

    await syncPreviewSnapshot(manga.id);

    return {
      ...manga,
      previewEnabled: true,
      previewSlug: nextSlug,
      previewToken: nextToken,
      previewKey: nextKey,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function fetchMangaPreviewByKey(previewKey: string): Promise<{
  preview: MangaPreview;
  chapters: MangaPreviewChapter[];
} | null> {
  const rootPath = `manga_previews/${previewKey}`;
  let preview: MangaPreview | null = null;
  try {
    const snap = await getDoc(doc(db, 'manga_previews', previewKey));
    if (!snap.exists()) return null;
    const data = snap.data() as MangaPreview;
    if (!data.isActive) return null;
    preview = data;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, rootPath);
  }

  const chaptersPath = `manga_previews/${previewKey}/chapters`;
  try {
    const chSnap = await getDocs(
      query(
        collection(db, 'manga_previews', previewKey, 'chapters'),
        where('previewKey', '==', previewKey)
      )
    );
    const chapters = chSnap.docs.map((d) => d.data() as MangaPreviewChapter);
    chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
    return { preview, chapters };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, chaptersPath);
  }
}

export async function fetchPreviewChapterPages(
  previewKey: string,
  chapterId: string
): Promise<MangaPreviewPage[]> {
  const path = `manga_previews/${previewKey}/chapters/${chapterId}/pages`;
  try {
    const snap = await getDocs(
      query(
        collection(db, 'manga_previews', previewKey, 'chapters', chapterId, 'pages'),
        where('chapterId', '==', chapterId)
      )
    );
    const list = snap.docs.map((d) => d.data() as MangaPreviewPage);
    list.sort((a, b) => a.pageNumber - b.pageNumber);
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

// --- CREATOR CRUD MUTATIONS ---

export async function createManga(params: {
  authorId: string;
  authorName: string;
  title: string;
  synopsis: string;
  coverUrl: string;
  bannerUrl: string;
  genres: string[];
  ageRating: AgeRating;
  status: MangaStatus;
}): Promise<Manga> {
  const id = makeId('manga');
  const path = `mangas/${id}`;
  const cleanGenres = params.genres.slice(0, 6).map((g) => g.slice(0, 40));
  if (cleanGenres.length === 0) cleanGenres.push('Ação');

  const previewSlug = normalizePreviewSlug(params.title);
  const previewToken = makePreviewToken();
  const previewKey = buildPreviewKey(previewSlug, previewToken);

  const mangaDoc: Manga = {
    id,
    authorId: params.authorId,
    authorName: params.authorName.trim().slice(0, MAX_LIMITS.DISPLAY_NAME) || 'Autor',
    title: params.title.trim().slice(0, MAX_LIMITS.MANGA_TITLE),
    slug: makeSlug(params.title),
    synopsis: params.synopsis.trim().slice(0, MAX_LIMITS.MANGA_SYNOPSIS),
    coverUrl: params.coverUrl.slice(0, 600),
    bannerUrl: params.bannerUrl.slice(0, 600),
    genres: cleanGenres,
    ageRating: params.ageRating,
    status: params.status,
    moderationStatus: 'approved',
    isFeatured: false,
    hasMotion: false,
    chaptersCount: 0,
    viewsCount: 0,
    ratingAverage: 0,
    ratingCount: 0,
    launchedFromPreLaunch: false,
    previewEnabled: true,
    previewSlug,
    previewToken,
    previewKey,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const previewDoc: MangaPreview = {
    previewKey,
    previewSlug,
    mangaId: id,
    authorName: mangaDoc.authorName,
    title: mangaDoc.title,
    synopsis: mangaDoc.synopsis,
    coverUrl: mangaDoc.coverUrl,
    bannerUrl: mangaDoc.bannerUrl,
    genres: mangaDoc.genres,
    ageRating: mangaDoc.ageRating,
    status: mangaDoc.status,
    hasMotion: false,
    chaptersCount: 0,
    ratingAverage: 0,
    ratingCount: 0,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'mangas', id), mangaDoc);
    batch.set(doc(db, 'manga_previews', previewKey), previewDoc);
    batch.update(doc(db, 'users', params.authorId), {
      worksCount: increment(1),
      accountType: 'creator',
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    invalidateCatalogCache();
    return mangaDoc;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateManga(
  mangaId: string,
  patch: Partial<
    Pick<
      Manga,
      'title' | 'synopsis' | 'coverUrl' | 'bannerUrl' | 'genres' | 'ageRating' | 'status' | 'authorName'
    >
  >
): Promise<void> {
  const path = `mangas/${mangaId}`;
  try {
    const existingSnap = await getDoc(doc(db, 'mangas', mangaId));
    const existingManga = existingSnap.exists() ? (existingSnap.data() as Manga) : null;

    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (patch.title !== undefined) {
      payload.title = patch.title.trim().slice(0, MAX_LIMITS.MANGA_TITLE);
      payload.slug = makeSlug(patch.title);
    }
    if (patch.synopsis !== undefined) {
      payload.synopsis = patch.synopsis.trim().slice(0, MAX_LIMITS.MANGA_SYNOPSIS);
    }
    if (patch.coverUrl !== undefined) payload.coverUrl = patch.coverUrl.slice(0, 600);
    if (patch.bannerUrl !== undefined) payload.bannerUrl = patch.bannerUrl.slice(0, 600);
    if (patch.genres !== undefined) {
      payload.genres = patch.genres.slice(0, 6).map((g) => g.slice(0, 40));
    }
    if (patch.ageRating !== undefined) payload.ageRating = patch.ageRating;
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.authorName !== undefined) {
      payload.authorName = patch.authorName.trim().slice(0, MAX_LIMITS.DISPLAY_NAME);
    }

    const isManualLaunchWithChapters =
      existingManga &&
      (existingManga.status === 'pre_launch' || existingManga.status === 'draft') &&
      patch.status === 'ongoing' &&
      (existingManga.chaptersCount || 0) > 0;

    if (isManualLaunchWithChapters && existingManga && !existingManga.launchedAt) {
      payload.launchedAt = serverTimestamp();
      if (existingManga.status === 'pre_launch') {
        payload.launchedFromPreLaunch = true;
      }
    }

    await updateDoc(doc(db, 'mangas', mangaId), payload);
    invalidateCatalogCache();

    if (isManualLaunchWithChapters && existingManga?.status === 'pre_launch') {
      const chapters = await fetchChaptersForManga(mangaId, true);
      const firstPub = chapters.find((c) => c.status === 'published');
      if (firstPub) {
        await notifySubscribersOfChapterOrLaunch({
          authorId: existingManga.authorId,
          authorName: (patch.authorName ?? existingManga.authorName) || 'Autor',
          manga: { ...existingManga, ...patch, title: (patch.title ?? existingManga.title) },
          chapterNumber: firstPub.chapterNumber,
          chapterId: firstPub.id,
          isPreLaunchRelease: true,
        });
      }
    }

    if (existingManga?.previewEnabled && existingManga.previewKey) {
      void syncPreviewSnapshot(mangaId);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteManga(
  mangaId: string,
  authorId: string,
  asAdmin = false
): Promise<void> {
  const path = `mangas/${mangaId}`;
  try {
    const mediaUrlsToDelete: string[] = [];
    const mangaSnap = await getDoc(doc(db, 'mangas', mangaId));
    if (!mangaSnap.exists()) {
      return;
    }

    const m = mangaSnap.data() as Manga;
    const effectiveAuthorId = m.authorId || authorId;
    const actorUid = auth.currentUser?.uid || effectiveAuthorId;
    const safeTitle = (m.title || 'Obra').trim().slice(0, MAX_LIMITS.MANGA_TITLE) || 'Obra';
    const safeAuthorName =
      (m.authorName || 'Autor').trim().slice(0, MAX_LIMITS.DISPLAY_NAME) || 'Autor';
    if (m.coverUrl) mediaUrlsToDelete.push(m.coverUrl);
    if (m.bannerUrl) mediaUrlsToDelete.push(m.bannerUrl);

    // Notify everyone who had this manga in "Continuar Lendo" and remove reader tracking docs
    try {
      const readersQuery = asAdmin
        ? collection(db, 'mangas', mangaId, 'readers')
        : query(
            collection(db, 'mangas', mangaId, 'readers'),
            where('authorId', '==', effectiveAuthorId)
          );
      const readersSnap = await getDocs(readersQuery);
      const readersList = readersSnap.docs.map((d) => d.data() as { userId: string });
      for (let i = 0; i < readersList.length; i += 200) {
        const chunk = readersList.slice(i, i + 200);
        const readerBatch = writeBatch(db);
        for (const r of chunk) {
          if (!r.userId) continue;
          readerBatch.delete(doc(db, 'mangas', mangaId, 'readers', r.userId));
          if (r.userId !== actorUid) {
            const notifId = makeId('notif');
            readerBatch.set(doc(db, 'notifications', notifId), {
              id: notifId,
              recipientId: r.userId,
              actorId: actorUid,
              actorName: safeAuthorName,
              type: 'manga_deleted',
              title: `Obra excluída: ${safeTitle}`.slice(0, 140),
              message: `A obra "${safeTitle}" foi excluída pelo autor (${safeAuthorName}) e removida do seu Continuar Lendo.`.slice(
                0,
                300
              ),
              linkMangaId: '',
              linkChapterId: '',
              isRead: false,
              createdAt: serverTimestamp(),
            });
          }
        }
        await readerBatch.commit();
      }
    } catch {
      // Non-blocking fallback: fetchReadingHistoryForUser also cleans up & notifies on load
    }

    const chapters = await fetchChaptersForManga(mangaId, true, asAdmin);
    for (const ch of chapters) {
      const pages = await fetchChapterPages(mangaId, ch.id, true, asAdmin);
      for (let i = 0; i < pages.length; i += 450) {
        const chunk = pages.slice(i, i + 450);
        const pageBatch = writeBatch(db);
        for (const p of chunk) {
          if (p.originalUrl) mediaUrlsToDelete.push(p.originalUrl);
          if (p.motionUrl) mediaUrlsToDelete.push(p.motionUrl);
          pageBatch.delete(doc(db, 'mangas', mangaId, 'chapters', ch.id, 'pages', p.id));
        }
        await pageBatch.commit();
      }
      await deleteDoc(doc(db, 'mangas', mangaId, 'chapters', ch.id));
    }

    // Delete active preview snapshot + subcollections BEFORE deleting parent manga doc (rules check parent manga exists)
    if (m.previewKey) {
      await deletePreviewDocs(m.previewKey);
    }

    // Delete wishlist tracking docs (including entries created via draft preview without authorId)
    try {
      const wishlistQuery = collection(db, 'mangas', mangaId, 'wishlist');
      const wishlistSnap = await getDocs(wishlistQuery);
      for (let i = 0; i < wishlistSnap.docs.length; i += 400) {
        const wBatch = writeBatch(db);
        wishlistSnap.docs.slice(i, i + 400).forEach((wd) => wBatch.delete(wd.ref));
        await wBatch.commit();
      }
    } catch {
      // Non-blocking wishlist cleanup
    }

    await deleteDoc(doc(db, 'mangas', mangaId));
    invalidateCatalogCache();

    try {
      const ownHistRef = doc(db, 'users', actorUid, 'history', mangaId);
      const ownHistSnap = await getDoc(ownHistRef);
      if (ownHistSnap.exists()) {
        await deleteDoc(ownHistRef);
      }
    } catch {
      // Ignore if caller has no history record for this manga
    }

    try {
      await updateDoc(doc(db, 'users', effectiveAuthorId), {
        worksCount: increment(-1),
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Ignore counter sync if profile already removed or caller is admin
    }

    if (mediaUrlsToDelete.length > 0) {
      await deleteMediaAssets(mediaUrlsToDelete).catch((err) => {
        console.warn('Falha parcial ao excluir arquivos da obra no servidor:', err);
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function createChapter(params: {
  mangaId: string;
  authorId: string;
  chapterNumber: number;
  title: string;
}): Promise<Chapter> {
  const id = makeId('chap');
  const path = `mangas/${params.mangaId}/chapters/${id}`;
  const chapterDoc: Chapter = {
    id,
    mangaId: params.mangaId,
    authorId: params.authorId,
    chapterNumber: Number(params.chapterNumber) || 1,
    title: params.title.trim().slice(0, MAX_LIMITS.CHAPTER_TITLE),
    status: 'draft',
    hasMotion: false,
    pagesCount: 0,
    viewsCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'mangas', params.mangaId, 'chapters', id), chapterDoc);
    return chapterDoc;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function fetchStimulusSettings(): Promise<StimulusSettings> {
  try {
    const snap = await getDoc(doc(db, 'app_settings', 'stimulus'));
    if (!snap.exists()) {
      return DEFAULT_STIMULUS_SETTINGS;
    }
    const raw = snap.data() as Partial<StimulusSettings>;
    const minViews = Math.max(1, Math.min(1000, Math.round(raw.minViews ?? 1)));
    const maxViews = Math.max(minViews, Math.min(1000, Math.round(raw.maxViews ?? 1000)));
    const durationHours = Math.max(1, Math.min(168, Math.round(raw.durationHours ?? 72)));
    return {
      id: 'stimulus',
      enabled: raw.enabled ?? true,
      minViews,
      maxViews,
      durationHours,
      updatedBy: raw.updatedBy || 'system',
      updatedAt: raw.updatedAt,
    };
  } catch {
    return DEFAULT_STIMULUS_SETTINGS;
  }
}

export async function updateStimulusSettings(params: {
  enabled: boolean;
  minViews: number;
  maxViews: number;
  durationHours: number;
  updatedBy: string;
}): Promise<StimulusSettings> {
  const path = 'app_settings/stimulus';
  const minViews = Math.max(1, Math.min(1000, Math.round(params.minViews)));
  const maxViews = Math.max(minViews, Math.min(1000, Math.round(params.maxViews)));
  const durationHours = Math.max(1, Math.min(168, Math.round(params.durationHours)));
  const payload: StimulusSettings = {
    id: 'stimulus',
    enabled: Boolean(params.enabled),
    minViews,
    maxViews,
    durationHours,
    updatedBy: params.updatedBy,
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'app_settings', 'stimulus'), payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

async function syncMangaChapterAggregates(mangaId: string): Promise<void> {
  try {
    const allChapters = await fetchChaptersForManga(mangaId, true);
    const publishedCount = allChapters.filter(
      (c) => c.status === 'published' && c.pagesCount > 0
    ).length;
    const mangaHasMotion = allChapters.some((c) => isChapterMotionEligible(c));
    await updateDoc(doc(db, 'mangas', mangaId), {
      chaptersCount: publishedCount,
      hasMotion: mangaHasMotion,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking aggregate sync
  }
}

export async function updateChapterStatusAndSync(params: {
  manga: Manga;
  chapter: Chapter;
  newStatus: ChapterStatus;
  title?: string;
  chapterNumber?: number;
}): Promise<void> {
  const path = `mangas/${params.manga.id}/chapters/${params.chapter.id}`;
  const readFresh = async (ref: ReturnType<typeof doc>) => {
    try {
      return await getDocFromServer(ref);
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
      if (code === 'unavailable' || code === 'failed-precondition') {
        return await getDoc(ref);
      }
      throw err;
    }
  };

  try {
    const chapterRef = doc(db, 'mangas', params.manga.id, 'chapters', params.chapter.id);
    const mangaRef = doc(db, 'mangas', params.manga.id);
    const [pages, chapterSnap, mangaSnap] = await Promise.all([
      fetchChapterPages(params.manga.id, params.chapter.id, true),
      readFresh(chapterRef),
      readFresh(mangaRef),
    ]);

    const freshChapter = chapterSnap.exists() ? (chapterSnap.data() as Chapter) : params.chapter;
    const freshManga = mangaSnap.exists() ? (mangaSnap.data() as Manga) : params.manga;

    // Strict Motion eligibility: EVERY page in the chapter must have valid Motion
    const hasMotion = hasAllPagesMotion(pages);
    const rawChapterNumber = Number(params.chapterNumber ?? freshChapter.chapterNumber ?? params.chapter.chapterNumber);
    const safeChapterNumber = Number.isFinite(rawChapterNumber)
      ? Math.max(0, Math.min(10000, rawChapterNumber))
      : 1;
    const safeTitle =
      (params.title ?? freshChapter.title ?? params.chapter.title ?? '')
        .trim()
        .slice(0, MAX_LIMITS.CHAPTER_TITLE) || `Capítulo ${safeChapterNumber}`;

    const chapterUpdate: Record<string, unknown> = {
      status: params.newStatus,
      title: safeTitle,
      chapterNumber: safeChapterNumber,
      hasMotion,
      pagesCount: Math.min(500, pages.length),
      updatedAt: serverTimestamp(),
    };

    const allChapters = await fetchChaptersForManga(params.manga.id, true);
    const isPublishingWithPages = params.newStatus === 'published' && pages.length >= 1;
    const isFirstEverPublish = isPublishingWithPages && !freshChapter.firstPublishedAt;

    let firstWorkWindow: StimulusWindow | null = null;
    if (isFirstEverPublish) {
      const settings = await fetchStimulusSettings();
      const safeDurationHours = Math.max(1, Math.min(168, Math.round(settings.durationHours || 72)));
      const existingWorkHasBudget =
        (freshManga.stimulusSettledViews ?? 0) > 0 ||
        (Array.isArray(freshManga.stimulusWindows) && freshManga.stimulusWindows.length > 0) ||
        allChapters.some(
          (c) =>
            c.id !== params.chapter.id &&
            ((c.stimulusBudget ?? 0) > 0 || Boolean(c.firstPublishedAt))
        );

      chapterUpdate.firstPublishedAt = serverTimestamp();

      if (settings.enabled && !existingWorkHasBudget) {
        // Single work-level stimulus budget rolled ONCE (1..1000) on the work's very first publication
        const { budget, seed } = pickWorkStimulusBudgetAndSeed({
          minViews: settings.minViews,
          maxViews: settings.maxViews,
          hasMotion,
        });
        const safeBudget = Math.max(0, Math.min(1000, Math.round(budget)));
        const safeSeed = Math.max(1, Math.min(999999, Math.round(seed)));
        const nowMs = Math.max(1, Date.now());
        chapterUpdate.stimulusBudget = safeBudget;
        chapterUpdate.stimulusSeed = safeSeed;
        chapterUpdate.stimulusDurationHours = safeDurationHours;
        firstWorkWindow = {
          chapterId: params.chapter.id,
          startedAtMs: nowMs,
          budget: safeBudget,
          seed: safeSeed,
          durationHours: safeDurationHours,
        };
      } else {
        // Subsequent published chapters share the work's existing funnel budget without rolling new budgets
        const existingSeed = Number(freshManga.stimulusWindows?.[0]?.seed ?? 1);
        const safeSeed = Number.isFinite(existingSeed)
          ? Math.max(1, Math.min(999999, Math.round(existingSeed)))
          : 1;
        chapterUpdate.stimulusBudget = 0;
        chapterUpdate.stimulusSeed = safeSeed;
        chapterUpdate.stimulusDurationHours = safeDurationHours;
      }
    }

    // Recompute published chaptersCount & strict manga.hasMotion
    const updatedChapters = allChapters.map((c) =>
      c.id === params.chapter.id
        ? { ...c, status: params.newStatus, hasMotion, pagesCount: pages.length }
        : c
    );
    const publishedCount = updatedChapters.filter(
      (c) => c.status === 'published' && c.pagesCount > 0
    ).length;
    const mangaHasMotion = updatedChapters.some((c) => isChapterMotionEligible(c));

    const mangaUpdate: Record<string, unknown> = {
      chaptersCount: publishedCount,
      hasMotion: mangaHasMotion,
      updatedAt: serverTimestamp(),
    };

    if (isPublishingWithPages && freshChapter.status !== 'published') {
      mangaUpdate.lastChapterPublishedAt = serverTimestamp();
    }

    const isAutoLaunchFromPreLaunch =
      freshManga.status === 'pre_launch' && isPublishingWithPages;

    if (isAutoLaunchFromPreLaunch) {
      mangaUpdate.status = 'ongoing';
      mangaUpdate.launchedFromPreLaunch = true;
      if (!freshManga.launchedAt) {
        mangaUpdate.launchedAt = serverTimestamp();
      }
    }

    if (firstWorkWindow) {
      mangaUpdate.stimulusSettledViews = Math.max(0, freshManga.stimulusSettledViews ?? 0);
      mangaUpdate.stimulusWindows = [firstWorkWindow];
    }

    if (pages.length <= 450) {
      const batch = writeBatch(db);
      batch.update(chapterRef, chapterUpdate);
      for (const p of pages) {
        batch.update(
          doc(db, 'mangas', params.manga.id, 'chapters', params.chapter.id, 'pages', p.id),
          {
            chapterStatus: params.newStatus,
            updatedAt: serverTimestamp(),
          }
        );
      }
      batch.update(mangaRef, mangaUpdate);
      await batch.commit();
    } else {
      for (let i = 0; i < pages.length; i += 400) {
        const pageBatch = writeBatch(db);
        pages.slice(i, i + 400).forEach((p) => {
          pageBatch.update(
            doc(db, 'mangas', params.manga.id, 'chapters', params.chapter.id, 'pages', p.id),
            {
              chapterStatus: params.newStatus,
              updatedAt: serverTimestamp(),
            }
          );
        });
        await pageBatch.commit();
      }
      const metaBatch = writeBatch(db);
      metaBatch.update(chapterRef, chapterUpdate);
      metaBatch.update(mangaRef, mangaUpdate);
      await metaBatch.commit();
    }
    invalidateCatalogCache();

    if (freshManga.previewEnabled && freshManga.previewKey) {
      void syncPreviewSnapshot(params.manga.id);
    }

    // Notify followers and wishlist users only if work is public (never while work remains private 'draft')
    const effectiveMangaStatus = isAutoLaunchFromPreLaunch ? 'ongoing' : freshManga.status;
    if (
      params.newStatus === 'published' &&
      params.chapter.status !== 'published' &&
      effectiveMangaStatus !== 'draft'
    ) {
      await notifySubscribersOfChapterOrLaunch({
        authorId: freshManga.authorId,
        authorName: freshManga.authorName,
        manga: freshManga,
        chapterNumber: params.chapterNumber ?? params.chapter.chapterNumber,
        chapterId: params.chapter.id,
        isPreLaunchRelease: isAutoLaunchFromPreLaunch,
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteChapterAndSync(manga: Manga, chapterId: string): Promise<void> {
  const path = `mangas/${manga.id}/chapters/${chapterId}`;
  try {
    const [pages, mangaSnap] = await Promise.all([
      fetchChapterPages(manga.id, chapterId, true),
      getDoc(doc(db, 'mangas', manga.id)),
    ]);
    const mediaUrlsToDelete: string[] = [];
    const batch = writeBatch(db);
    for (const p of pages) {
      if (p.originalUrl) mediaUrlsToDelete.push(p.originalUrl);
      if (p.motionUrl) mediaUrlsToDelete.push(p.motionUrl);
      batch.delete(doc(db, 'mangas', manga.id, 'chapters', chapterId, 'pages', p.id));
    }
    batch.delete(doc(db, 'mangas', manga.id, 'chapters', chapterId));
    await batch.commit();

    const remaining = await fetchChaptersForManga(manga.id, true);
    const publishedCount = remaining.filter(
      (c) => c.status === 'published' && c.pagesCount > 0
    ).length;
    const mangaHasMotion = remaining.some((c) => isChapterMotionEligible(c));

    const mangaPatch: Record<string, unknown> = {
      chaptersCount: publishedCount,
      hasMotion: mangaHasMotion,
      updatedAt: serverTimestamp(),
    };

    await updateDoc(doc(db, 'mangas', manga.id), mangaPatch);
    invalidateCatalogCache();

    if (mangaSnap.exists()) {
      const freshManga = mangaSnap.data() as Manga;
      if (freshManga.previewEnabled && freshManga.previewKey) {
        void syncPreviewSnapshot(manga.id);
      }
    }

    if (mediaUrlsToDelete.length > 0) {
      await deleteMediaAssets(mediaUrlsToDelete).catch((err) => {
        console.warn('Falha parcial ao excluir arquivos do capítulo no servidor:', err);
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// --- ISOLATED PAGE PAIR CRUD (Original + Optional Motion) ---

export async function addPageToChapter(params: {
  mangaId: string;
  chapter: Chapter;
  authorId: string;
  pageNumber: number;
  originalUrl: string;
  originalMime: string;
  motionUrl?: string;
  motionMime?: string;
}): Promise<ChapterPage> {
  const id = makeId('page');
  const path = `mangas/${params.mangaId}/chapters/${params.chapter.id}/pages/${id}`;
  const pageDoc: ChapterPage = {
    id,
    mangaId: params.mangaId,
    chapterId: params.chapter.id,
    authorId: params.authorId,
    chapterStatus: params.chapter.status,
    pageNumber: params.pageNumber,
    originalUrl: params.originalUrl.slice(0, 600),
    originalMime: params.originalMime.slice(0, 80),
    motionUrl: (params.motionUrl || '').slice(0, 600),
    motionMime: (params.motionMime || '').slice(0, 80),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'mangas', params.mangaId, 'chapters', params.chapter.id, 'pages', id), pageDoc);

    const existingPages = await fetchChapterPages(params.mangaId, params.chapter.id, true);
    const nextPages = [...existingPages, pageDoc];
    const hasMotion = hasAllPagesMotion(nextPages);
    batch.update(doc(db, 'mangas', params.mangaId, 'chapters', params.chapter.id), {
      pagesCount: nextPages.length,
      hasMotion,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    if (params.chapter.status === 'published') {
      await syncMangaChapterAggregates(params.mangaId);
    }
    invalidateCatalogCache();
    void syncPreviewSnapshot(params.mangaId);
    return pageDoc;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updatePageAssets(params: {
  mangaId: string;
  chapterId: string;
  pageId: string;
  originalUrl?: string;
  originalMime?: string;
  motionUrl?: string;
  motionMime?: string;
  pageNumber?: number;
}): Promise<void> {
  const path = `mangas/${params.mangaId}/chapters/${params.chapterId}/pages/${params.pageId}`;
  try {
    const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (params.originalUrl !== undefined) patch.originalUrl = params.originalUrl.slice(0, 600);
    if (params.originalMime !== undefined) patch.originalMime = params.originalMime.slice(0, 80);
    if (params.motionUrl !== undefined) patch.motionUrl = params.motionUrl.slice(0, 600);
    if (params.motionMime !== undefined) patch.motionMime = params.motionMime.slice(0, 80);
    if (params.pageNumber !== undefined) patch.pageNumber = params.pageNumber;

    await updateDoc(
      doc(db, 'mangas', params.mangaId, 'chapters', params.chapterId, 'pages', params.pageId),
      patch
    );

    const pages = await fetchChapterPages(params.mangaId, params.chapterId, true);
    const hasMotion = hasAllPagesMotion(pages);
    await updateDoc(doc(db, 'mangas', params.mangaId, 'chapters', params.chapterId), {
      hasMotion,
      pagesCount: pages.length,
      updatedAt: serverTimestamp(),
    });
    await syncMangaChapterAggregates(params.mangaId);
    invalidateCatalogCache();
    void syncPreviewSnapshot(params.mangaId);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function reorderChapterPages(
  mangaId: string,
  chapterId: string,
  orderedPages: ChapterPage[]
): Promise<void> {
  const path = `mangas/${mangaId}/chapters/${chapterId}/pages`;
  try {
    const batch = writeBatch(db);
    orderedPages.forEach((p, idx) => {
      batch.update(doc(db, 'mangas', mangaId, 'chapters', chapterId, 'pages', p.id), {
        pageNumber: idx + 1,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
    void syncPreviewSnapshot(mangaId);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteChapterPage(
  mangaId: string,
  chapterId: string,
  pageId: string
): Promise<void> {
  const path = `mangas/${mangaId}/chapters/${chapterId}/pages/${pageId}`;
  try {
    const pageRef = doc(db, 'mangas', mangaId, 'chapters', chapterId, 'pages', pageId);
    const pageSnap = await getDoc(pageRef);
    const mediaUrlsToDelete: string[] = [];
    if (pageSnap.exists()) {
      const p = pageSnap.data() as ChapterPage;
      if (p.originalUrl) mediaUrlsToDelete.push(p.originalUrl);
      if (p.motionUrl) mediaUrlsToDelete.push(p.motionUrl);
    }

    await deleteDoc(pageRef);
    const remaining = await fetchChapterPages(mangaId, chapterId, true);
    const batch = writeBatch(db);
    remaining.forEach((p, idx) => {
      batch.update(doc(db, 'mangas', mangaId, 'chapters', chapterId, 'pages', p.id), {
        pageNumber: idx + 1,
        updatedAt: serverTimestamp(),
      });
    });
    batch.update(doc(db, 'mangas', mangaId, 'chapters', chapterId), {
      pagesCount: remaining.length,
      hasMotion: hasAllPagesMotion(remaining),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await syncMangaChapterAggregates(mangaId);
    invalidateCatalogCache();
    void syncPreviewSnapshot(mangaId);

    if (mediaUrlsToDelete.length > 0) {
      await deleteMediaAssets(mediaUrlsToDelete).catch((err) => {
        console.warn('Falha parcial ao excluir arquivos da página no servidor:', err);
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function deleteAllChapterPages(
  mangaId: string,
  chapterId: string
): Promise<number> {
  const path = `mangas/${mangaId}/chapters/${chapterId}/pages`;
  try {
    const existingPages = await fetchChapterPages(mangaId, chapterId, true);
    const mediaUrlsSet = new Set<string>();
    existingPages.forEach((p) => {
      if (p.originalUrl) mediaUrlsSet.add(p.originalUrl);
      if (p.motionUrl) mediaUrlsSet.add(p.motionUrl);
    });

    if (existingPages.length > 0) {
      for (let i = 0; i < existingPages.length; i += 400) {
        const batch = writeBatch(db);
        existingPages.slice(i, i + 400).forEach((p) => {
          batch.delete(doc(db, 'mangas', mangaId, 'chapters', chapterId, 'pages', p.id));
        });
        await batch.commit();
      }
    }

    await updateDoc(doc(db, 'mangas', mangaId, 'chapters', chapterId), {
      pagesCount: 0,
      hasMotion: false,
      updatedAt: serverTimestamp(),
    });

    await syncMangaChapterAggregates(mangaId);
    invalidateCatalogCache();
    void syncPreviewSnapshot(mangaId);

    const mediaUrlsToDelete = Array.from(mediaUrlsSet);
    if (mediaUrlsToDelete.length > 0) {
      await deleteMediaAssets(mediaUrlsToDelete).catch((err) => {
        console.warn('Falha parcial ao excluir arquivos das páginas no servidor:', err);
      });
    }

    return existingPages.length;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
    return 0;
  }
}

// --- READER & COMMUNITY FEATURES ---

export async function incrementMangaAndChapterViews(mangaId: string, chapterId: string): Promise<void> {
  if (!auth.currentUser?.emailVerified) return;
  try {
    let bucketPatch: Record<string, string | number> = {};
    try {
      const mSnap = await getDoc(doc(db, 'mangas', mangaId));
      if (mSnap.exists()) {
        const m = mSnap.data() as Manga;
        bucketPatch = buildNextDailyBucketPatch({
          prefix: 'realViews',
          currentDayKey: m.realViewsDayKey,
          currentTodayCount: m.realViewsTodayCount,
          currentPrevDayKey: m.realViewsPrevDayKey,
          currentPrevDayCount: m.realViewsPrevDayCount,
          delta: 1,
        });
      }
    } catch {
      bucketPatch = {};
    }

    const batch = writeBatch(db);
    batch.update(doc(db, 'mangas', mangaId), {
      viewsCount: increment(1),
      ...bucketPatch,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'mangas', mangaId, 'chapters', chapterId), {
      viewsCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    invalidateCatalogCache();
  } catch {
    // Non-blocking view telemetry
  }
}

export async function saveReadingProgress(params: {
  userId: string;
  manga: Manga;
  chapter: Chapter;
  pageNumber: number;
  totalPages: number;
  preferredMode: ReaderMode;
}): Promise<void> {
  const path = `users/${params.userId}/history/${params.manga.id}`;
  try {
    const historyItem: ReadingHistoryItem = {
      userId: params.userId,
      mangaId: params.manga.id,
      mangaTitle: params.manga.title.slice(0, MAX_LIMITS.MANGA_TITLE),
      coverUrl: params.manga.coverUrl.slice(0, 600),
      chapterId: params.chapter.id,
      chapterNumber: params.chapter.chapterNumber,
      chapterTitle: params.chapter.title.slice(0, MAX_LIMITS.CHAPTER_TITLE),
      pageNumber: Math.max(1, params.pageNumber),
      totalPages: Math.max(1, params.totalPages),
      preferredMode: params.preferredMode,
      updatedAt: serverTimestamp(),
    };
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', params.userId, 'history', params.manga.id), historyItem);
    batch.set(doc(db, 'mangas', params.manga.id, 'readers', params.userId), {
      userId: params.userId,
      mangaId: params.manga.id,
      authorId: params.manga.authorId,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function fetchReadingHistoryForUser(userId: string): Promise<ReadingHistoryItem[]> {
  const existing = inFlightHistory.get(userId);
  if (existing) return existing;

  const path = `users/${userId}/history`;
  const run = async (): Promise<ReadingHistoryItem[]> => {
    try {
      const snap = await getDocs(collection(db, 'users', userId, 'history'));
      const rawList = snap.docs.map((d) => d.data() as ReadingHistoryItem);

      const verified: ReadingHistoryItem[] = [];
      const deletedItems: ReadingHistoryItem[] = [];

      await Promise.all(
        rawList.map(async (item) => {
          try {
            const mSnap = await getDoc(doc(db, 'mangas', item.mangaId));
            if (mSnap.exists()) {
              verified.push(item);
            } else {
              deletedItems.push(item);
            }
          } catch {
            // Omit temporarily inaccessible works (e.g. reverted to draft) without deleting progress
          }
        })
      );

      if (
        deletedItems.length > 0 &&
        auth.currentUser?.uid === userId &&
        auth.currentUser?.emailVerified
      ) {
        let existingNotifs: AppNotification[] = [];
        try {
          const notifSnap = await getDocs(
            query(collection(db, 'notifications'), where('recipientId', '==', userId))
          );
          existingNotifs = notifSnap.docs.map((d) => d.data() as AppNotification);
        } catch {
          existingNotifs = [];
        }

        for (const item of deletedItems) {
          try {
            await deleteDoc(doc(db, 'users', userId, 'history', item.mangaId));
          } catch {
            // Ignore individual cleanup failure
          }

          const safeTitle = (item.mangaTitle || 'Obra').trim().slice(0, MAX_LIMITS.MANGA_TITLE) || 'Obra';
          const titleSnippet = safeTitle.slice(0, 80);
          const alreadyNotified = existingNotifs.some(
            (n) =>
              (n.type === 'manga_deleted' || n.type === 'moderation') &&
              (n.title.includes(titleSnippet) || n.message.includes(titleSnippet))
          );

          if (!alreadyNotified) {
            try {
              const notifId = makeId('notif');
              const notifDoc: AppNotification = {
                id: notifId,
                recipientId: userId,
                actorId: userId,
                actorName: 'Sistema',
                type: 'manga_deleted',
                title: `Obra excluída: ${safeTitle}`.slice(0, 140),
                message: `A obra "${safeTitle}" foi excluída pelo autor e removida do seu Continuar Lendo.`.slice(
                  0,
                  300
                ),
                linkMangaId: '',
                linkChapterId: '',
                isRead: false,
                createdAt: serverTimestamp(),
              };
              await setDoc(doc(db, 'notifications', notifId), notifDoc);
              existingNotifs.push(notifDoc);
            } catch {
              // Non-blocking notification backfill
            }
          }
        }
      }

      verified.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
      return verified;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  };

  const promise = run().finally(() => {
    inFlightHistory.delete(userId);
  });
  inFlightHistory.set(userId, promise);
  return promise;
}

export async function fetchReadingProgressForManga(
  userId: string,
  mangaId: string
): Promise<ReadingHistoryItem | null> {
  const path = `users/${userId}/history/${mangaId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'history', mangaId));
    return snap.exists() ? (snap.data() as ReadingHistoryItem) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function fetchUserFollows(followerId: string): Promise<FollowRelation[]> {
  const existing = inFlightFollows.get(followerId);
  if (existing) return existing;

  const run = async (): Promise<FollowRelation[]> => {
    try {
      const q = query(collection(db, 'follows'), where('followerId', '==', followerId));
      const snap = await getDocs(q);
      const rawList = snap.docs.map((d) => d.data() as FollowRelation);

      const verified: FollowRelation[] = [];
      const removedList: Array<{ rel: FollowRelation; reason: 'banned' | 'deleted' }> = [];

      await Promise.all(
        rawList.map(async (rel) => {
          try {
            const authorSnap = await getDoc(doc(db, 'users', rel.authorId));
            if (!authorSnap.exists()) {
              removedList.push({ rel, reason: 'deleted' });
            } else {
              const authorData = authorSnap.data() as UserProfile;
              if (authorData.isSuspended) {
                removedList.push({ rel, reason: 'banned' });
              } else {
                verified.push(rel);
              }
            }
          } catch {
            verified.push(rel);
          }
        })
      );

      if (
        removedList.length > 0 &&
        auth.currentUser?.uid === followerId &&
        auth.currentUser?.emailVerified
      ) {
        let existingNotifs: AppNotification[] = [];
        try {
          const notifSnap = await getDocs(
            query(collection(db, 'notifications'), where('recipientId', '==', followerId))
          );
          existingNotifs = notifSnap.docs.map((d) => d.data() as AppNotification);
        } catch {
          existingNotifs = [];
        }

        for (const { rel, reason } of removedList) {
          try {
            await deleteDoc(doc(db, 'follows', rel.id));
          } catch {
            // Ignore follow cleanup failure
          }

          const safeName =
            (rel.authorName || 'Criador').trim().slice(0, MAX_LIMITS.DISPLAY_NAME) || 'Criador';
          const nameSnippet = safeName.slice(0, 60);
          const alreadyNotified = existingNotifs.some(
            (n) =>
              (n.type === 'account_removed' || n.type === 'moderation') &&
              (n.title.includes(nameSnippet) || n.message.includes(nameSnippet))
          );

          if (!alreadyNotified) {
            try {
              const notifId = makeId('notif');
              const notifDoc: AppNotification = {
                id: notifId,
                recipientId: followerId,
                actorId: followerId,
                actorName: safeName,
                type: 'account_removed',
                title: (reason === 'banned'
                  ? `Conta banida: ${safeName}`
                  : `Conta excluída: ${safeName}`
                ).slice(0, 140),
                message: (reason === 'banned'
                  ? `A conta de ${safeName} foi banida/suspensa e removida da sua lista de seguindo.`
                  : `A conta de ${safeName} foi excluída e removida da sua lista de seguindo.`
                ).slice(0, 300),
                linkMangaId: '',
                linkChapterId: '',
                isRead: false,
                createdAt: serverTimestamp(),
              };
              await setDoc(doc(db, 'notifications', notifId), notifDoc);
              existingNotifs.push(notifDoc);
            } catch {
              // Non-blocking notification backfill
            }
          }
        }
      }

      return verified;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'follows');
    }
  };

  const promise = run().finally(() => {
    inFlightFollows.delete(followerId);
  });
  inFlightFollows.set(followerId, promise);
  return promise;
}

export async function toggleFollowAuthor(params: {
  followerId: string;
  followerName: string;
  authorId: string;
  authorName: string;
}): Promise<boolean> {
  const followId = `${params.followerId}_${params.authorId}`;
  const followRef = doc(db, 'follows', followId);
  try {
    const existing = await getDoc(followRef);
    const batch = writeBatch(db);
    if (existing.exists()) {
      batch.delete(followRef);
      batch.update(doc(db, 'users', params.authorId), {
        followersCount: increment(-1),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return false;
    } else {
      const followDoc: FollowRelation = {
        id: followId,
        followerId: params.followerId,
        authorId: params.authorId,
        authorName: params.authorName.slice(0, MAX_LIMITS.DISPLAY_NAME),
        createdAt: serverTimestamp(),
      };
      batch.set(followRef, followDoc);
      batch.update(doc(db, 'users', params.authorId), {
        followersCount: increment(1),
        updatedAt: serverTimestamp(),
      });
      const notifId = makeId('notif');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        recipientId: params.authorId,
        actorId: params.followerId,
        actorName: params.followerName.slice(0, MAX_LIMITS.DISPLAY_NAME),
        type: 'new_follower',
        title: 'Novo seguidor',
        message: `${params.followerName} começou a seguir suas publicações.`,
        linkMangaId: '',
        linkChapterId: '',
        isRead: false,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      return true;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `follows/${followId}`);
  }
}

async function notifySubscribersOfChapterOrLaunch(params: {
  authorId: string;
  authorName: string;
  manga: Manga;
  chapterNumber: number;
  chapterId: string;
  isPreLaunchRelease?: boolean;
}) {
  try {
    const actorUid = auth.currentUser?.uid || params.authorId;
    const safeAuthor = params.authorName.slice(0, MAX_LIMITS.DISPLAY_NAME) || 'Autor';
    const [wishlistSnap, followersSnap] = await Promise.all([
      getDocs(collection(db, 'mangas', params.manga.id, 'wishlist')).catch(() => null),
      getDocs(query(collection(db, 'follows'), where('authorId', '==', params.authorId))).catch(
        () => null
      ),
    ]);

    const notifiedRecipients = new Set<string>();
    const payloads: AppNotification[] = [];

    if (wishlistSnap && !wishlistSnap.empty) {
      wishlistSnap.docs.forEach((d) => {
        const w = d.data() as MangaWishlistItem;
        if (!w.userId || w.userId === actorUid || notifiedRecipients.has(w.userId)) return;
        notifiedRecipients.add(w.userId);
        const notifId = makeId('notif');
        payloads.push({
          id: notifId,
          recipientId: w.userId,
          actorId: actorUid,
          actorName: safeAuthor,
          type: params.isPreLaunchRelease ? 'pre_launch_release' : 'new_chapter',
          title: (params.isPreLaunchRelease
            ? `Lançamento oficial: ${params.manga.title}`
            : `Novo capítulo de ${params.manga.title}`
          ).slice(0, 140),
          message: (params.isPreLaunchRelease
            ? `${params.manga.title} da sua lista de desejos foi lançado! Cap. ${params.chapterNumber} já está disponível.`
            : `Capítulo ${params.chapterNumber} já está disponível para leitura.`
          ).slice(0, 300),
          linkMangaId: params.manga.id,
          linkChapterId: params.chapterId,
          isRead: false,
          createdAt: serverTimestamp(),
        });
      });
    }

    if (followersSnap && !followersSnap.empty) {
      followersSnap.docs.forEach((d) => {
        const rel = d.data() as FollowRelation;
        if (!rel.followerId || rel.followerId === actorUid || notifiedRecipients.has(rel.followerId)) {
          return;
        }
        notifiedRecipients.add(rel.followerId);
        const notifId = makeId('notif');
        payloads.push({
          id: notifId,
          recipientId: rel.followerId,
          actorId: actorUid,
          actorName: safeAuthor,
          type: 'new_chapter',
          title: `Novo capítulo de ${params.manga.title}`.slice(0, 140),
          message: `Capítulo ${params.chapterNumber} já está disponível para leitura.`.slice(0, 300),
          linkMangaId: params.manga.id,
          linkChapterId: params.chapterId,
          isRead: false,
          createdAt: serverTimestamp(),
        });
      });
    }

    for (let i = 0; i < payloads.length; i += 400) {
      const chunk = payloads.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((item) => {
        batch.set(doc(db, 'notifications', item.id), item);
      });
      await batch.commit();
    }
  } catch {
    // Non-blocking notification dispatch
  }
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', notificationId), { isRead: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `notifications/${notificationId}`);
  }
}

export async function deleteNotification(notificationId: string): Promise<void> {
  const path = `notifications/${notificationId}`;
  try {
    const ref = doc(db, 'notifications', notificationId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    await deleteDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function fetchChapterComments(
  mangaId: string,
  chapterId: string,
  includeHidden = false
): Promise<ChapterComment[]> {
  const path = `mangas/${mangaId}/chapters/${chapterId}/comments`;
  try {
    const q = includeHidden
      ? collection(db, 'mangas', mangaId, 'chapters', chapterId, 'comments')
      : query(
          collection(db, 'mangas', mangaId, 'chapters', chapterId, 'comments'),
          where('isHidden', '==', false)
        );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as ChapterComment);
    list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function postChapterComment(params: {
  manga: Manga;
  chapter: Chapter;
  userId: string;
  userName: string;
  userAvatar: string;
  content: string;
  parentComment?: ChapterComment | null;
}): Promise<ChapterComment> {
  const id = makeId('cmt');
  const path = `mangas/${params.manga.id}/chapters/${params.chapter.id}/comments/${id}`;
  const isAuthorReply = params.manga.authorId === params.userId;
  const parent = params.parentComment || null;
  const commentDoc: ChapterComment = {
    id,
    mangaId: params.manga.id,
    chapterId: params.chapter.id,
    userId: params.userId,
    userName: params.userName.slice(0, MAX_LIMITS.DISPLAY_NAME),
    userAvatar: params.userAvatar.slice(0, 600),
    content: params.content.trim().slice(0, MAX_LIMITS.COMMENT_CONTENT),
    ...(parent
      ? {
          parentId: parent.parentId || parent.id,
          replyToUserId: parent.userId,
          replyToUserName: parent.userName.slice(0, MAX_LIMITS.DISPLAY_NAME),
        }
      : {}),
    isAuthorReply,
    isHidden: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'mangas', params.manga.id, 'chapters', params.chapter.id, 'comments', id),
      commentDoc
    );
    if (parent && parent.userId !== params.userId) {
      const notifId = makeId('notif');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        recipientId: parent.userId,
        actorId: params.userId,
        actorName: params.userName.slice(0, MAX_LIMITS.DISPLAY_NAME),
        type: 'new_comment',
        title: isAuthorReply
          ? `Resposta do autor em ${params.manga.title}`
          : `Resposta em ${params.manga.title}`,
        message: `${params.userName} respondeu ao seu comentário no Cap. ${params.chapter.chapterNumber}.`,
        linkMangaId: params.manga.id,
        linkChapterId: params.chapter.id,
        isRead: false,
        createdAt: serverTimestamp(),
      });
    } else if (params.manga.authorId !== params.userId) {
      const notifId = makeId('notif');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        recipientId: params.manga.authorId,
        actorId: params.userId,
        actorName: params.userName.slice(0, MAX_LIMITS.DISPLAY_NAME),
        type: 'new_comment',
        title: `Comentário em ${params.manga.title}`,
        message: `${params.userName} comentou no Cap. ${params.chapter.chapterNumber}.`,
        linkMangaId: params.manga.id,
        linkChapterId: params.chapter.id,
        isRead: false,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
    return commentDoc;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function setChapterCommentHidden(
  mangaId: string,
  chapterId: string,
  commentId: string,
  isHidden: boolean
): Promise<void> {
  const path = `mangas/${mangaId}/chapters/${chapterId}/comments/${commentId}`;
  try {
    await updateDoc(doc(db, 'mangas', mangaId, 'chapters', chapterId, 'comments', commentId), {
      isHidden,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteChapterComment(
  mangaId: string,
  chapterId: string,
  commentId: string
): Promise<void> {
  const path = `mangas/${mangaId}/chapters/${chapterId}/comments/${commentId}`;
  try {
    await deleteDoc(doc(db, 'mangas', mangaId, 'chapters', chapterId, 'comments', commentId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export interface CreatorStudioCommentItem {
  comment: ChapterComment;
  manga: Manga;
  chapter: Chapter;
}

export interface CreatorStudioRatingItem {
  rating: MangaRating;
  manga: Manga;
}

export async function fetchCreatorInteractions(mangas: Manga[]): Promise<{
  comments: CreatorStudioCommentItem[];
  ratings: CreatorStudioRatingItem[];
  commentCountsByChapter: Record<string, number>;
}> {
  const comments: CreatorStudioCommentItem[] = [];
  const ratings: CreatorStudioRatingItem[] = [];
  const commentCountsByChapter: Record<string, number> = {};

  await Promise.all(
    mangas.map(async (manga) => {
      const [chapters, mangaRatings] = await Promise.all([
        fetchChaptersForManga(manga.id, true),
        fetchMangaRatings(manga.id),
      ]);

      mangaRatings.forEach((rating) => {
        ratings.push({ rating, manga });
      });

      await Promise.all(
        chapters.map(async (chapter) => {
          const chComments = await fetchChapterComments(manga.id, chapter.id, true);
          commentCountsByChapter[chapter.id] = chComments.filter((c) => !c.isHidden).length;
          chComments.forEach((comment) => {
            comments.push({ comment, manga, chapter });
          });
        })
      );
    })
  );

  comments.sort((a, b) => toMillis(b.comment.createdAt) - toMillis(a.comment.createdAt));
  ratings.sort((a, b) => toMillis(b.rating.updatedAt) - toMillis(a.rating.updatedAt));

  return { comments, ratings, commentCountsByChapter };
}

export async function fetchMangaRatings(mangaId: string): Promise<MangaRating[]> {
  const path = `mangas/${mangaId}/ratings`;
  try {
    const q = query(collection(db, 'mangas', mangaId, 'ratings'), where('score', '>=', 1));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as MangaRating);
    list.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function submitMangaRating(params: {
  mangaId: string;
  userId: string;
  userName: string;
  score: number;
  review: string;
}): Promise<void> {
  const ratingRef = doc(db, 'mangas', params.mangaId, 'ratings', params.userId);
  const path = `mangas/${params.mangaId}/ratings/${params.userId}`;
  try {
    const existing = await getDoc(ratingRef);
    const clampedScore = Math.min(5, Math.max(1, Math.round(params.score)));
    const payload: MangaRating = {
      userId: params.userId,
      mangaId: params.mangaId,
      score: clampedScore,
      review: params.review.trim().slice(0, MAX_LIMITS.REVIEW_CONTENT),
      userName: params.userName.slice(0, MAX_LIMITS.DISPLAY_NAME),
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ratingRef, payload);

    const allRatings = await fetchMangaRatings(params.mangaId);
    const total = allRatings.reduce((acc, r) => acc + r.score, 0);
    const avg = allRatings.length > 0 ? Number((total / allRatings.length).toFixed(2)) : 0;
    await updateDoc(doc(db, 'mangas', params.mangaId), {
      ratingAverage: avg,
      ratingCount: allRatings.length,
      updatedAt: serverTimestamp(),
    });
    invalidateCatalogCache();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function submitModerationReport(params: {
  reporterId: string;
  reporterName: string;
  targetType: ModerationReport['targetType'];
  targetId: string;
  mangaId?: string;
  targetLabel: string;
  reason: ModerationReport['reason'];
  details: string;
}): Promise<void> {
  const id = makeId('rep');
  const path = `reports/${id}`;
  const reportDoc: ModerationReport = {
    id,
    reporterId: params.reporterId,
    reporterName: params.reporterName.slice(0, MAX_LIMITS.DISPLAY_NAME),
    targetType: params.targetType,
    targetId: params.targetId,
    mangaId: params.mangaId || '',
    targetLabel: params.targetLabel.slice(0, 160),
    reason: params.reason,
    details: params.details.trim().slice(0, MAX_LIMITS.REPORT_DETAILS),
    status: 'open',
    resolutionNote: '',
    resolvedBy: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'reports', id), reportDoc);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

// --- ADMIN OPERATIONS ---

export async function adminFetchAllMangas(): Promise<Manga[]> {
  try {
    const snap = await getDocs(collection(db, 'mangas'));
    const nowMs = Date.now();
    const baseList = snap.docs.map((d) => enrichMangaWithViews(d.data() as Manga, nowMs));
    const enriched = await Promise.all(
      baseList.map(async (manga) => {
        try {
          const chapters = await fetchChaptersForManga(manga.id, true, true, manga);
          const verified = await verifyPublishedChaptersMotionAndDistribute(
            manga,
            chapters,
            nowMs,
            true
          );
          const stats = computeMangaChapterStats(manga, verified);
          const ranking = computeMangaRankingScore({ manga, chapters: verified }, nowMs);
          return {
            ...manga,
            hasMotion: stats.hasStrictMotion,
            chaptersCount: stats.publishedChaptersCount,
            publishedChapters: verified,
            validMotionChaptersCount: stats.validMotionChaptersCount,
            motionChapterRatio: stats.motionChapterRatio,
            rankingScore: ranking.score,
            tractionLabel: ranking.traction.classification,
          };
        } catch {
          return manga;
        }
      })
    );
    enriched.sort((a, b) => (b.rankingScore ?? 0) - (a.rankingScore ?? 0));
    return enriched;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'mangas');
  }
}

export async function adminFetchAllUsers(): Promise<UserProfile[]> {
  try {
    const snap = await getDocs(collection(db, 'users'));
    const list = snap.docs.map((d) => d.data() as UserProfile);
    list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
}

export async function adminFetchAllReports(): Promise<ModerationReport[]> {
  try {
    const snap = await getDocs(collection(db, 'reports'));
    const list = snap.docs.map((d) => d.data() as ModerationReport);
    list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'reports');
  }
}

export async function adminModerateManga(params: {
  mangaId: string;
  moderationStatus?: ModerationStatus;
  isFeatured?: boolean;
}): Promise<void> {
  const path = `mangas/${params.mangaId}`;
  try {
    const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (params.moderationStatus !== undefined) patch.moderationStatus = params.moderationStatus;
    if (params.isFeatured !== undefined) patch.isFeatured = params.isFeatured;
    await updateDoc(doc(db, 'mangas', params.mangaId), patch);
    invalidateCatalogCache();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

async function removeFollowersAndNotify(params: {
  targetUid: string;
  targetName: string;
  reason: 'banned' | 'deleted';
}): Promise<void> {
  const actorUid = auth.currentUser?.uid || params.targetUid;
  const safeTargetName =
    (params.targetName || 'Criador').trim().slice(0, MAX_LIMITS.DISPLAY_NAME) || 'Criador';

  const q = query(collection(db, 'follows'), where('authorId', '==', params.targetUid));
  const snap = await getDocs(q);
  if (snap.empty) return;

  const docsList = snap.docs;
  for (let i = 0; i < docsList.length; i += 200) {
    const chunk = docsList.slice(i, i + 200);
    const batch = writeBatch(db);
    for (const d of chunk) {
      const rel = d.data() as FollowRelation;
      batch.delete(doc(db, 'follows', rel.id));
      if (rel.followerId && rel.followerId !== actorUid) {
        const notifId = makeId('notif');
        batch.set(doc(db, 'notifications', notifId), {
          id: notifId,
          recipientId: rel.followerId,
          actorId: actorUid,
          actorName: safeTargetName,
          type: 'account_removed',
          title: (params.reason === 'banned'
            ? `Conta banida: ${safeTargetName}`
            : `Conta excluída: ${safeTargetName}`
          ).slice(0, 140),
          message: (params.reason === 'banned'
            ? `A conta de ${safeTargetName} foi banida/suspensa e removida da sua lista de seguindo.`
            : `A conta de ${safeTargetName} foi excluída e removida da sua lista de seguindo.`
          ).slice(0, 300),
          linkMangaId: '',
          linkChapterId: '',
          isRead: false,
          createdAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
  }
}

export async function adminToggleUserSuspension(
  uid: string,
  isSuspended: boolean,
  targetDisplayName?: string
): Promise<void> {
  const path = `users/${uid}`;
  try {
    if (isSuspended) {
      let resolvedName = targetDisplayName;
      if (!resolvedName) {
        const userSnap = await getDoc(doc(db, 'users', uid));
        resolvedName = userSnap.exists() ? (userSnap.data() as UserProfile).displayName : 'Criador';
      }
      await removeFollowersAndNotify({
        targetUid: uid,
        targetName: resolvedName || 'Criador',
        reason: 'banned',
      });
      await updateDoc(doc(db, 'users', uid), {
        isSuspended: true,
        followersCount: 0,
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'users', uid), {
        isSuspended: false,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteUserAccount(params: {
  targetUid: string;
  targetName?: string;
  avatarUrl?: string;
  asAdmin?: boolean;
}): Promise<void> {
  const path = `users/${params.targetUid}`;
  try {
    let resolvedName = params.targetName;
    let resolvedAvatar = params.avatarUrl;
    if (resolvedName === undefined || resolvedAvatar === undefined) {
      const userSnap = await getDoc(doc(db, 'users', params.targetUid));
      if (userSnap.exists()) {
        const u = userSnap.data() as UserProfile;
        resolvedName = resolvedName ?? u.displayName;
        resolvedAvatar = resolvedAvatar ?? u.avatarUrl;
      }
    }

    // 1. Remove everyone following this user and notify them
    await removeFollowersAndNotify({
      targetUid: params.targetUid,
      targetName: resolvedName || 'Usuário',
      reason: 'deleted',
    });

    // 2. Remove follows initiated by this user and decrement followed authors' counters safely
    try {
      const followingSnap = await getDocs(
        query(collection(db, 'follows'), where('followerId', '==', params.targetUid))
      );
      for (const d of followingSnap.docs) {
        const rel = d.data() as FollowRelation;
        await deleteDoc(doc(db, 'follows', rel.id));
        try {
          const authorRef = doc(db, 'users', rel.authorId);
          const authorSnap = await getDoc(authorRef);
          if (authorSnap.exists() && ((authorSnap.data() as UserProfile).followersCount || 0) > 0) {
            await updateDoc(authorRef, {
              followersCount: increment(-1),
              updatedAt: serverTimestamp(),
            });
          }
        } catch {
          // Ignore if followed author no longer exists
        }
      }
    } catch {
      // Non-blocking cleanup for outbound follows
    }

    // 3. Delete all mangas authored by this user (cleans chapters, pages, Bunny media, readers & notifies readers)
    const userMangas = await fetchCreatorMangas(params.targetUid);
    for (const m of userMangas) {
      await deleteManga(m.id, params.targetUid, Boolean(params.asAdmin));
    }

    // 4. Clean up user's history subcollection
    const histSnap = await getDocs(collection(db, 'users', params.targetUid, 'history'));
    for (let i = 0; i < histSnap.docs.length; i += 450) {
      const batch = writeBatch(db);
      for (const d of histSnap.docs.slice(i, i + 450)) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }

    // 5. Delete private info and public profile documents
    const privRef = doc(db, 'users', params.targetUid, 'private', 'info');
    const privSnap = await getDoc(privRef);
    if (privSnap.exists()) {
      await deleteDoc(privRef);
    }

    const profileRef = doc(db, 'users', params.targetUid);
    const profileSnap = await getDoc(profileRef);
    if (profileSnap.exists()) {
      await deleteDoc(profileRef);
    }

    if (resolvedAvatar) {
      await deleteMediaAssets([resolvedAvatar]).catch((err) => {
        console.warn('Falha ao excluir foto de perfil do servidor:', err);
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function adminResolveReport(params: {
  reportId: string;
  status: 'reviewing' | 'resolved' | 'dismissed';
  resolutionNote: string;
  adminUid: string;
}): Promise<void> {
  const path = `reports/${params.reportId}`;
  try {
    await updateDoc(doc(db, 'reports', params.reportId), {
      status: params.status,
      resolutionNote: params.resolutionNote.trim().slice(0, 500),
      resolvedBy: params.adminUid,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}
