import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Columns,
  Film,
  Flag,
  Image as ImageIcon,
  Maximize,
  MessageSquare,
  Minimize,
  Pause,
  Pencil,
  Play,
  Reply,
  Rows,
  Send,
  SlidersHorizontal,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { AppRoute } from '../components/Navbar';
import { ReportModal } from '../components/ReportModal';
import { useAuth } from '../context/AuthContext';
import {
  deleteChapterComment,
  fetchChapterComments,
  fetchChapterPages,
  fetchChaptersForManga,
  fetchMangaById,
  fetchMangaPreviewByKey,
  fetchPreviewChapterPages,
  fetchReadingProgressForManga,
  incrementMangaAndChapterViews,
  postChapterComment,
  saveReadingProgress,
  updateChapterCommentContent,
} from '../services/mangaService';
import {
  Chapter,
  ChapterComment,
  ChapterPage,
  Manga,
  MAX_LIMITS,
  ReaderFitMode,
  ReaderLayoutMode,
  ReaderMode,
  ReaderNightTheme,
  UserPrivateInfo,
} from '../types/manga';

interface ReaderPageProps {
  mangaId?: string;
  previewKey?: string;
  chapterId: string;
  initialPage?: number;
  initialCommentsOpen?: boolean;
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
}

const PRELOAD_AHEAD = 5;
const KEEP_BEHIND = 5;
const VIDEO_KEEP_BEHIND = 2;
const VIDEO_PRELOAD_AHEAD = 3;
const LOCAL_PREFS_KEY = 'mm_reader_prefs';

interface LocalReaderPrefs {
  preferredMode?: ReaderMode;
  layoutMode?: ReaderLayoutMode;
  fitMode?: ReaderFitMode;
  nightTheme?: ReaderNightTheme;
  brightness?: number;
  zoom?: number;
}

function readLocalPrefs(): LocalReaderPrefs {
  try {
    const raw = localStorage.getItem(LOCAL_PREFS_KEY);
    return raw ? (JSON.parse(raw) as LocalReaderPrefs) : {};
  } catch {
    return {};
  }
}

function writeLocalPrefs(patch: LocalReaderPrefs) {
  try {
    const current = readLocalPrefs();
    localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // Ignore storage errors
  }
}

function isVideoMimeOrUrl(mime: string, url: string): boolean {
  if (mime.startsWith('video/')) return true;
  return /\.(mp4|webm)(\?.*)?$/i.test(url);
}

function getCommentTimestampMillis(ts: unknown): number {
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

function formatCommentTime(ts: unknown): string {
  const millis = getCommentTimestampMillis(ts);
  if (millis <= 0) return 'Agora';
  return new Date(millis).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function wasCommentEdited(c: ChapterComment): boolean {
  if (c.isHidden) return false;
  const created = getCommentTimestampMillis(c.createdAt);
  const updated = getCommentTimestampMillis(c.updatedAt);
  return created > 0 && updated > created + 1500;
}

export function ReaderPage({
  mangaId,
  previewKey,
  chapterId,
  initialPage,
  initialCommentsOpen,
  onNavigate,
  onOpenAuth,
}: ReaderPageProps) {
  const isPreviewMode = Boolean(previewKey);
  const { user, loading: authLoading, profile, privateInfo, isAdmin, updateReaderPreferences } = useAuth();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const measuredHeightsRef = useRef<Record<string, number>>({});
  const renderedImagesRef = useRef<Set<string>>(new Set());
  const preloadedImagesRef = useRef<Set<string>>(new Set());
  const preloadedVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const hydratedUidRef = useRef<string | null>(null);
  const pendingResumeIndexRef = useRef<number | null>(null);
  const autoScrollUntilRef = useRef<number>(0);
  const userInteractedRef = useRef(false);
  const loadedMediaRef = useRef<Set<string>>(new Set());
  const suppressScrollSpyUntilRef = useRef(0);
  const prevLayoutModeRef = useRef<ReaderLayoutMode>('single');
  const alignReleaseTimerRef = useRef<number | null>(null);
  const prefSyncTimerRef = useRef<number | null>(null);
  const pendingPrefPatchRef = useRef<
    Partial<
      Pick<
        UserPrivateInfo,
        'preferredMode' | 'nightMode' | 'layoutMode' | 'fitMode' | 'nightTheme' | 'brightness' | 'zoom'
      >
    >
  >({});

  const [manga, setManga] = useState<Manga | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [pages, setPages] = useState<ChapterPage[]>([]);
  const [comments, setComments] = useState<ChapterComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [resumeSettled, setResumeSettled] = useState(false);

  const initialLocal = useMemo(() => readLocalPrefs(), []);

  // Reader state (hydrated from Firestore privateInfo once available)
  const [mode, setMode] = useState<ReaderMode>(
    privateInfo?.preferredMode || initialLocal.preferredMode || 'motion'
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlayingMotion, setIsPlayingMotion] = useState(true);
  const [layoutMode, setLayoutMode] = useState<ReaderLayoutMode>(
    privateInfo?.layoutMode || initialLocal.layoutMode || 'single'
  );
  const [fitMode, setFitMode] = useState<ReaderFitMode>(
    privateInfo?.fitMode || initialLocal.fitMode || 'fit-width'
  );
  const [zoom, setZoom] = useState(privateInfo?.zoom ?? initialLocal.zoom ?? 100);
  const [nightTheme, setNightTheme] = useState<ReaderNightTheme>(
    privateInfo?.nightTheme || initialLocal.nightTheme || 'oled'
  );
  const [brightness, setBrightness] = useState(
    privateInfo?.brightness ?? initialLocal.brightness ?? 100
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(Boolean(initialCommentsOpen));
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChapterComment | null>(null);
  const [postingComment, setPostingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentDraft, setEditCommentDraft] = useState('');
  const [savingEditComment, setSavingEditComment] = useState(false);
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [expandedReplyThreads, setExpandedReplyThreads] = useState<Record<string, boolean>>({});
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    if (initialCommentsOpen) {
      setSettingsOpen(false);
      setCommentsOpen(true);
    }
  }, [initialCommentsOpen, chapterId]);

  // Hydrate saved online reading style once per user session when privateInfo loads
  useEffect(() => {
    if (!privateInfo) return;
    if (hydratedUidRef.current === privateInfo.uid) return;
    hydratedUidRef.current = privateInfo.uid;
    if (privateInfo.preferredMode) setMode(privateInfo.preferredMode);
    if (privateInfo.layoutMode) setLayoutMode(privateInfo.layoutMode);
    if (privateInfo.fitMode) setFitMode(privateInfo.fitMode);
    if (privateInfo.nightTheme) setNightTheme(privateInfo.nightTheme);
    if (typeof privateInfo.brightness === 'number') setBrightness(privateInfo.brightness);
    if (typeof privateInfo.zoom === 'number') setZoom(privateInfo.zoom);
  }, [privateInfo]);

  useEffect(() => {
    if (!user) {
      hydratedUidRef.current = null;
    }
  }, [user]);

  useEffect(() => {
    return () => {
      if (prefSyncTimerRef.current !== null) {
        window.clearTimeout(prefSyncTimerRef.current);
      }
      if (alignReleaseTimerRef.current !== null) {
        window.clearTimeout(alignReleaseTimerRef.current);
      }
    };
  }, []);

  const persistReaderPrefs = useCallback(
    (
      patch: Partial<
        Pick<
          UserPrivateInfo,
          'preferredMode' | 'layoutMode' | 'fitMode' | 'nightTheme' | 'brightness' | 'zoom'
        >
      >,
      debounce = false
    ) => {
      writeLocalPrefs(patch);
      if (!user || !user.emailVerified) return;

      if (!debounce) {
        void updateReaderPreferences(patch).catch(() => {});
        return;
      }

      pendingPrefPatchRef.current = { ...pendingPrefPatchRef.current, ...patch };
      if (prefSyncTimerRef.current !== null) {
        window.clearTimeout(prefSyncTimerRef.current);
      }
      prefSyncTimerRef.current = window.setTimeout(() => {
        const merged = pendingPrefPatchRef.current;
        pendingPrefPatchRef.current = {};
        prefSyncTimerRef.current = null;
        void updateReaderPreferences(merged).catch(() => {});
      }, 400);
    },
    [user, updateReaderPreferences]
  );

  // Clear preload buffers when switching chapters
  useEffect(() => {
    pageRefs.current = {};
    measuredHeightsRef.current = {};
    renderedImagesRef.current.clear();
    loadedMediaRef.current.clear();
    pendingResumeIndexRef.current = null;
    autoScrollUntilRef.current = 0;
    userInteractedRef.current = false;
    suppressScrollSpyUntilRef.current = 0;
    setResumeSettled(false);
    setReplyingTo(null);
    setEditingCommentId(null);
    setEditCommentDraft('');
    setConfirmDeleteCommentId(null);
    preloadedImagesRef.current.clear();
    preloadedVideosRef.current.forEach((vid) => {
      vid.pause();
      vid.removeAttribute('src');
      vid.load();
    });
    preloadedVideosRef.current.clear();
  }, [mangaId, previewKey, chapterId]);

  // Load manga, isolated chapter, isolated pages, comments, and auto-resume position
  useEffect(() => {
    if (!previewKey && authLoading) {
      return;
    }
    if (!previewKey && !user) {
      setManga(null);
      setChapters([]);
      setChapter(null);
      setPages([]);
      setComments([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setToastMsg(null);

    const load = async () => {
      try {
        if (previewKey) {
          const pvRes = await fetchMangaPreviewByKey(previewKey);
          if (!active || !pvRes) {
            setManga(null);
            setChapters([]);
            setChapter(null);
            setPages([]);
            setComments([]);
            setLoading(false);
            return;
          }

          const mappedManga: Manga = {
            id: pvRes.preview.mangaId,
            authorId: '',
            authorName: pvRes.preview.authorName,
            title: pvRes.preview.title,
            slug: pvRes.preview.previewSlug,
            synopsis: pvRes.preview.synopsis,
            coverUrl: pvRes.preview.coverUrl,
            bannerUrl: pvRes.preview.bannerUrl,
            genres: pvRes.preview.genres,
            ageRating: pvRes.preview.ageRating,
            status: pvRes.preview.status,
            moderationStatus: 'approved',
            isFeatured: false,
            hasMotion: pvRes.preview.hasMotion,
            chaptersCount: pvRes.preview.chaptersCount,
            viewsCount: 0,
            ratingAverage: pvRes.preview.ratingAverage,
            ratingCount: pvRes.preview.ratingCount,
          };

          const mappedChapters: Chapter[] = pvRes.chapters.map((ch) => ({
            id: ch.id,
            mangaId: ch.mangaId,
            authorId: '',
            chapterNumber: ch.chapterNumber,
            title: ch.title,
            status: ch.status,
            hasMotion: ch.hasMotion,
            pagesCount: ch.pagesCount,
            viewsCount: 0,
          }));

          const pvPages = await fetchPreviewChapterPages(previewKey, chapterId);
          if (!active) return;

          const mappedPages: ChapterPage[] = pvPages.map((p) => ({
            id: p.id,
            mangaId: p.mangaId,
            chapterId: p.chapterId,
            authorId: '',
            chapterStatus: 'draft',
            pageNumber: p.pageNumber,
            originalUrl: p.originalUrl,
            originalMime: p.originalMime,
            motionUrl: p.motionUrl,
            motionMime: p.motionMime,
          }));

          const currentCh = mappedChapters.find((c) => c.id === chapterId) || null;
          setManga(mappedManga);
          setChapters(mappedChapters);
          setChapter(currentCh);
          setPages(mappedPages);
          setComments([]);

          const targetIdx =
            initialPage && initialPage >= 1 && initialPage <= mappedPages.length
              ? initialPage - 1
              : 0;
          const hasResumeTarget = targetIdx > 0;
          pendingResumeIndexRef.current = hasResumeTarget ? targetIdx : null;
          if (hasResumeTarget) {
            autoScrollUntilRef.current = Date.now() + 450;
            userInteractedRef.current = false;
            setResumeSettled(false);
          } else {
            autoScrollUntilRef.current = 0;
            setResumeSettled(true);
          }
          setCurrentIndex(Math.max(0, targetIdx));
          return;
        }

        if (!mangaId) {
          setLoading(false);
          return;
        }

        const m = await fetchMangaById(mangaId);
        if (!active || !m) {
          setLoading(false);
          return;
        }
        setManga(m);
        const isAuthor = user?.uid === m.authorId;
        const [chList, pageList, commentList] = await Promise.all([
          fetchChaptersForManga(m.id, isAuthor, isAdmin),
          fetchChapterPages(m.id, chapterId, isAuthor, isAdmin),
          fetchChapterComments(m.id, chapterId),
        ]);
        if (!active) return;

        const currentCh = chList.find((c) => c.id === chapterId) || null;
        setChapters(chList);
        setChapter(currentCh);
        setPages(pageList);
        setComments(commentList);

        let targetIdx = 0;
        let hasResumeTarget = false;
        if (initialPage && initialPage >= 1 && initialPage <= pageList.length) {
          targetIdx = initialPage - 1;
          hasResumeTarget = targetIdx > 0;
        } else if (user && currentCh) {
          const hist = await fetchReadingProgressForManga(user.uid, m.id);
          if (hist && hist.chapterId === chapterId && hist.pageNumber >= 1) {
            targetIdx = Math.min(pageList.length - 1, hist.pageNumber - 1);
            hasResumeTarget = targetIdx > 0;
            if (!privateInfo?.preferredMode && hist.preferredMode) {
              setMode(hist.preferredMode);
            }
            if (hist.pageNumber > 1) {
              setToastMsg(`Retomado na página ${hist.pageNumber}`);
            }
          }
        }
        const finalIdx = Math.max(0, targetIdx);
        pendingResumeIndexRef.current = hasResumeTarget ? finalIdx : null;
        if (hasResumeTarget) {
          autoScrollUntilRef.current = Date.now() + 450;
          userInteractedRef.current = false;
          setResumeSettled(false);
        } else {
          autoScrollUntilRef.current = 0;
          setResumeSettled(true);
        }
        setCurrentIndex(finalIdx);
        void incrementMangaAndChapterViews(m.id, chapterId);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [mangaId, previewKey, chapterId, initialPage, user?.uid, authLoading, isAdmin]);

  // Dismiss toast automatically
  useEffect(() => {
    if (!toastMsg) return;
    const t = window.setTimeout(() => setToastMsg(null), 1800);
    return () => window.clearTimeout(t);
  }, [toastMsg]);

  const windowStart = Math.max(0, currentIndex - KEEP_BEHIND);
  const windowEnd = Math.min(pages.length - 1, currentIndex + PRELOAD_AHEAD);

  // Staged Sliding-Window Preloading: load pages within active window [windowStart .. windowEnd]
  useEffect(() => {
    if (pages.length === 0) return;

    const activeMotionUrls = new Set<string>();
    const preloadIndices: number[] = [];
    for (let i = windowStart; i <= windowEnd; i++) {
      preloadIndices.push(i);
    }

    preloadIndices.forEach((idx) => {
      const p = pages[idx];
      if (!p) return;

      if (p.originalUrl && !preloadedImagesRef.current.has(p.originalUrl)) {
        preloadedImagesRef.current.add(p.originalUrl);
        const img = new Image();
        img.decoding = 'async';
        img.src = p.originalUrl;
      }

      if (p.motionUrl) {
        if (isVideoMimeOrUrl(p.motionMime, p.motionUrl)) {
          activeMotionUrls.add(p.motionUrl);
          if (!preloadedVideosRef.current.has(p.motionUrl)) {
            const vid = document.createElement('video');
            vid.preload = 'auto';
            vid.muted = true;
            vid.playsInline = true;
            vid.src = p.motionUrl;
            vid.load();
            preloadedVideosRef.current.set(p.motionUrl, vid);
          }
        } else if (!preloadedImagesRef.current.has(p.motionUrl)) {
          preloadedImagesRef.current.add(p.motionUrl);
          const img = new Image();
          img.decoding = 'async';
          img.src = p.motionUrl;
        }
      }
    });

    // Release off-window buffered videos so chapters with many pages stay lightweight
    preloadedVideosRef.current.forEach((vid, url) => {
      const keepInBehind = pages
        .slice(windowStart, currentIndex)
        .some((p) => p.motionUrl === url);
      if (!activeMotionUrls.has(url) && !keepInBehind) {
        vid.pause();
        vid.removeAttribute('src');
        vid.load();
        preloadedVideosRef.current.delete(url);
      }
    });
  }, [currentIndex, windowStart, windowEnd, pages]);

  // Cleanup all preloaded videos on unmount
  useEffect(() => {
    return () => {
      preloadedVideosRef.current.forEach((vid) => {
        vid.pause();
        vid.removeAttribute('src');
        vid.load();
      });
      preloadedVideosRef.current.clear();
    };
  }, []);

  // Auto-save reading progress (debounced)
  useEffect(() => {
    if (isPreviewMode || !user || !user.emailVerified || !manga || !chapter || pages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveReadingProgress({
        userId: user.uid,
        manga,
        chapter,
        pageNumber: currentIndex + 1,
        totalPages: pages.length,
        preferredMode: mode,
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [isPreviewMode, user, manga, chapter, pages.length, currentIndex, mode]);

  // Sync play/pause on mounted video elements
  useEffect(() => {
    Object.values(videoRefs.current).forEach((vid) => {
      if (!vid) return;
      if (isPlayingMotion && mode === 'motion') {
        void vid.play().catch(() => {});
      } else {
        vid.pause();
      }
    });
  }, [isPlayingMotion, mode, currentIndex, layoutMode]);

  const alignToResumedPage = useCallback((idx: number) => {
    if (userInteractedRef.current) return;
    const el = pageRefs.current[idx];
    if (!el) return;
    el.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, []);

  const computeMostVisiblePageIndex = useCallback((): number | null => {
    if (pages.length === 0) return null;
    const viewportHeight = Math.min(
      window.innerHeight || 800,
      document.documentElement.clientHeight || 800
    );
    const viewportMid = viewportHeight * 0.45;
    let bestIdx: number | null = null;
    let bestDist = Infinity;

    for (let i = 0; i < pages.length; i++) {
      const el = pageRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) continue;
      if (rect.top <= viewportMid && rect.bottom >= viewportMid) {
        return i;
      }
      const center = rect.top + rect.height / 2;
      const dist = Math.abs(center - viewportMid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }, [pages.length]);

  // Scroll directly to resumed page in continuous vertical mode once chapter finishes loading or layout switches from single -> vertical
  useEffect(() => {
    const prevLayout = prevLayoutModeRef.current;
    prevLayoutModeRef.current = layoutMode;

    if (loading || layoutMode !== 'vertical' || pages.length === 0) {
      if (layoutMode === 'single') {
        pendingResumeIndexRef.current = null;
        autoScrollUntilRef.current = 0;
        setResumeSettled(true);
      }
      return;
    }

    if (pendingResumeIndexRef.current === null && prevLayout === 'single' && currentIndex > 0) {
      pendingResumeIndexRef.current = currentIndex;
    }

    const targetIdx = pendingResumeIndexRef.current;
    if (targetIdx === null) {
      autoScrollUntilRef.current = 0;
      setResumeSettled(true);
      return;
    }

    const clamped = Math.min(pages.length - 1, Math.max(0, targetIdx));
    autoScrollUntilRef.current = Date.now() + 450;
    userInteractedRef.current = false;

    const finishAutoScroll = (syncPage: boolean) => {
      autoScrollUntilRef.current = 0;
      pendingResumeIndexRef.current = null;
      setResumeSettled(true);
      if (alignReleaseTimerRef.current !== null) {
        window.clearTimeout(alignReleaseTimerRef.current);
        alignReleaseTimerRef.current = null;
      }
      if (syncPage) {
        const visibleIdx = computeMostVisiblePageIndex();
        if (visibleIdx !== null) setCurrentIndex(visibleIdx);
      }
    };

    const cancelAutoScroll = () => {
      userInteractedRef.current = true;
      finishAutoScroll(true);
    };

    document.addEventListener('wheel', cancelAutoScroll, { passive: true, capture: true, once: true });
    document.addEventListener('touchstart', cancelAutoScroll, { passive: true, capture: true, once: true });
    document.addEventListener('touchmove', cancelAutoScroll, { passive: true, capture: true, once: true });
    document.addEventListener('pointerdown', cancelAutoScroll, { passive: true, capture: true, once: true });

    const raf = requestAnimationFrame(() => {
      alignToResumedPage(clamped);
      requestAnimationFrame(() => {
        alignToResumedPage(clamped);
      });
    });

    if (alignReleaseTimerRef.current !== null) {
      window.clearTimeout(alignReleaseTimerRef.current);
    }
    alignReleaseTimerRef.current = window.setTimeout(() => {
      alignToResumedPage(clamped);
      finishAutoScroll(false);
    }, 450);

    return () => {
      cancelAnimationFrame(raf);
      if (alignReleaseTimerRef.current !== null) {
        window.clearTimeout(alignReleaseTimerRef.current);
        alignReleaseTimerRef.current = null;
      }
      autoScrollUntilRef.current = 0;
      document.removeEventListener('wheel', cancelAutoScroll, { capture: true });
      document.removeEventListener('touchstart', cancelAutoScroll, { capture: true });
      document.removeEventListener('touchmove', cancelAutoScroll, { capture: true });
      document.removeEventListener('pointerdown', cancelAutoScroll, { capture: true });
    };
  }, [loading, layoutMode, pages.length, alignToResumedPage, computeMostVisiblePageIndex]);

  // Unified Vertical Scroll-Spy (capture-phase document scroll + touchmove + fullscreen container + IntersectionObserver)
  useEffect(() => {
    if (loading || layoutMode !== 'vertical' || pages.length === 0) return;

    let rafId: number | null = null;
    const syncActivePage = () => {
      rafId = null;
      const now = Date.now();
      if (now < autoScrollUntilRef.current || now < suppressScrollSpyUntilRef.current) {
        return;
      }
      const nextIdx = computeMostVisiblePageIndex();
      if (nextIdx !== null) {
        setCurrentIndex((prev) => (prev === nextIdx ? prev : nextIdx));
      }
    };

    const scheduleSync = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(syncActivePage);
    };

    const containerEl = containerRef.current;
    window.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync, { passive: true });
    document.addEventListener('scroll', scheduleSync, { passive: true, capture: true });
    document.addEventListener('scrollend', scheduleSync, { passive: true, capture: true });
    document.addEventListener('touchmove', scheduleSync, { passive: true });
    document.addEventListener('touchend', scheduleSync, { passive: true });
    containerEl?.addEventListener('scroll', scheduleSync, { passive: true });

    const observer = new IntersectionObserver(
      () => {
        scheduleSync();
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 0.9] }
    );

    Object.values(pageRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    // Guarantee a post-resume sync check once initial auto-alignment window finishes
    const postResumeTimer = window.setTimeout(scheduleSync, 500);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.clearTimeout(postResumeTimer);
      window.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
      document.removeEventListener('scroll', scheduleSync, { capture: true });
      document.removeEventListener('scrollend', scheduleSync, { capture: true });
      document.removeEventListener('touchmove', scheduleSync);
      document.removeEventListener('touchend', scheduleSync);
      containerEl?.removeEventListener('scroll', scheduleSync);
      observer.disconnect();
    };
  }, [loading, layoutMode, pages.length, isFullscreen, computeMostVisiblePageIndex]);

  const currentChapterIndex = chapters.findIndex((c) => c.id === chapterId);
  const prevChapter = currentChapterIndex > 0 ? chapters[currentChapterIndex - 1] : null;
  const nextChapter =
    currentChapterIndex >= 0 && currentChapterIndex < chapters.length - 1
      ? chapters[currentChapterIndex + 1]
      : null;

  const goToPage = useCallback(
    (nextIdx: number) => {
      if (pages.length === 0) return;
      const clamped = Math.max(0, Math.min(pages.length - 1, nextIdx));
      pendingResumeIndexRef.current = null;
      autoScrollUntilRef.current = 0;
      userInteractedRef.current = true;
      setResumeSettled(true);
      setCurrentIndex(clamped);
      if (layoutMode === 'vertical') {
        suppressScrollSpyUntilRef.current = Date.now() + 450;
        pageRefs.current[clamped]?.scrollIntoView({ behavior: 'auto', block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior: 'auto' });
        containerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
      }
    },
    [pages.length, layoutMode]
  );

  // Switch between Original and Motion while preserving exact same page index & saving online
  const handleToggleMode = useCallback(
    (nextMode: ReaderMode) => {
      setMode(nextMode);
      persistReaderPrefs({ preferredMode: nextMode });
      if (layoutMode === 'vertical') {
        suppressScrollSpyUntilRef.current = Date.now() + 300;
        requestAnimationFrame(() => {
          pageRefs.current[currentIndex]?.scrollIntoView({ behavior: 'auto', block: 'start' });
        });
      }
    },
    [layoutMode, currentIndex, persistReaderPrefs]
  );

  const handleSetLayoutMode = useCallback(
    (nextLayout: ReaderLayoutMode) => {
      setLayoutMode(nextLayout);
      persistReaderPrefs({ layoutMode: nextLayout });
      if (nextLayout === 'vertical') {
        suppressScrollSpyUntilRef.current = Date.now() + 350;
        requestAnimationFrame(() => {
          pageRefs.current[currentIndex]?.scrollIntoView({ behavior: 'auto', block: 'start' });
        });
      } else {
        window.scrollTo({ top: 0, behavior: 'auto' });
        containerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
      }
    },
    [currentIndex, persistReaderPrefs]
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    if (layoutMode === 'vertical') {
      suppressScrollSpyUntilRef.current = Date.now() + 350;
      const targetIdx = currentIndex;
      requestAnimationFrame(() => {
        pageRefs.current[targetIdx]?.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    }
    setIsFullscreen((prev) => {
      const next = !prev;
      setControlsVisible(!next);
      setSettingsOpen(false);
      if (next) {
        setCommentsOpen(false);
        setToastMsg('Modo imersivo · Toque no centro para controles');
      } else {
        setToastMsg(null);
      }
      return next;
    });
  }, [layoutMode, currentIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') {
        goToPage(currentIndex + 1);
      } else if (e.key === 'ArrowLeft') {
        goToPage(currentIndex - 1);
      } else if (e.key === 'm' || e.key === 'M') {
        handleToggleMode(mode === 'motion' ? 'original' : 'motion');
      } else if (e.key === ' ') {
        if (mode === 'motion') {
          e.preventDefault();
          setIsPlayingMotion((p) => !p);
        }
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        setControlsVisible(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentIndex, goToPage, mode, handleToggleMode, toggleFullscreen, isFullscreen]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, select, input, textarea, [data-reader-ui]')) return;

    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }

    if (layoutMode === 'vertical') {
      setControlsVisible((v) => !v);
      return;
    }

    // Single-page mode: tap left 35% -> previous page, right 35% -> next page, center -> toggle controls
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);

    if (ratio < 0.35) {
      if (currentIndex > 0) {
        goToPage(currentIndex - 1);
      } else {
        setControlsVisible((v) => !v);
      }
    } else if (ratio > 0.65) {
      if (currentIndex < pages.length - 1) {
        goToPage(currentIndex + 1);
      } else {
        setControlsVisible((v) => !v);
      }
    } else {
      setControlsVisible((v) => !v);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !manga || !chapter) {
      onOpenAuth();
      return;
    }
    if (!newComment.trim()) return;
    setPostingComment(true);
    try {
      const targetReply = replyingTo;
      const created = await postChapterComment({
        manga,
        chapter,
        userId: user.uid,
        userName: profile?.displayName || user.displayName || 'Leitor',
        userAvatar: profile?.avatarUrl || '',
        content: newComment,
        parentComment: targetReply,
      });
      setComments((prev) => [created, ...prev]);
      if (targetReply) {
        const rootThreadId = targetReply.parentId || targetReply.id;
        setExpandedReplyThreads((prev) => ({ ...prev, [rootThreadId]: true }));
      }
      setNewComment('');
      setReplyingTo(null);
    } catch (err) {
      setToastMsg(err instanceof Error ? err.message : 'Erro ao publicar comentário.');
    } finally {
      setPostingComment(false);
    }
  };

  const handleSaveEditComment = async (e: React.FormEvent, commentId: string) => {
    e.preventDefault();
    if (!user || !manga || !chapter || !editCommentDraft.trim() || savingEditComment) return;
    setSavingEditComment(true);
    try {
      const trimmed = await updateChapterCommentContent(
        manga.id,
        chapter.id,
        commentId,
        editCommentDraft
      );
      const editedAtMs = Date.now();
      setComments((prev) =>
        prev.map((item) => {
          if (item.id !== commentId) return item;
          const existingCreatedMs = getCommentTimestampMillis(item.createdAt);
          return {
            ...item,
            content: trimmed,
            createdAt:
              existingCreatedMs > 0 ? item.createdAt : { toMillis: () => editedAtMs - 3000 },
            updatedAt: { toMillis: () => editedAtMs },
          };
        })
      );
      setEditingCommentId(null);
      setEditCommentDraft('');
      setToastMsg('Comentário editado.');
    } catch (err) {
      setToastMsg(err instanceof Error ? err.message : 'Não foi possível editar o comentário.');
    } finally {
      setSavingEditComment(false);
    }
  };

  const handleConfirmDeleteComment = async (target: ChapterComment) => {
    if (!user || !manga || !chapter || deletingCommentId) return;
    setDeletingCommentId(target.id);
    try {
      const canDeleteThreadReplies =
        !target.parentId && (user.uid === manga.authorId || isAdmin);
      await deleteChapterComment(manga.id, chapter.id, target.id, canDeleteThreadReplies);
      setComments((prev) =>
        prev.filter((item) => {
          if (item.id === target.id) return false;
          if (!target.parentId && item.parentId === target.id) return false;
          return true;
        })
      );
      if (replyingTo?.id === target.id) setReplyingTo(null);
      if (editingCommentId === target.id) {
        setEditingCommentId(null);
        setEditCommentDraft('');
      }
      setConfirmDeleteCommentId(null);
      setToastMsg('Comentário excluído.');
    } catch (err) {
      setToastMsg(err instanceof Error ? err.message : 'Não foi possível excluir o comentário.');
    } finally {
      setDeletingCommentId(null);
    }
  };

  const { topComments, repliesByParentId } = useMemo(() => {
    const top: ChapterComment[] = [];
    const repliesMap = new Map<string, ChapterComment[]>();
    comments.forEach((c) => {
      if (c.parentId) {
        const list = repliesMap.get(c.parentId) || [];
        list.push(c);
        repliesMap.set(c.parentId, list);
      } else {
        top.push(c);
      }
    });
    repliesMap.forEach((list) => list.reverse());
    return { topComments: top, repliesByParentId: repliesMap };
  }, [comments]);

  const themeBg =
    nightTheme === 'oled'
      ? 'bg-[#000000]'
      : nightTheme === 'slate'
      ? 'bg-[#101116]'
      : 'bg-[#161311]';

  const currentPage = pages[currentIndex] || null;
  const hasAnyMotionInChapter = useMemo(() => pages.some((p) => Boolean(p.motionUrl)), [pages]);

  const imageStyleClass = useMemo(() => {
    if (fitMode === 'fit-height') return 'max-h-[96vh] w-auto mx-auto object-contain';
    if (fitMode === 'actual') return 'max-w-none mx-auto';
    return 'w-full max-w-4xl mx-auto h-auto';
  }, [fitMode]);

  const renderPageAsset = (p: ChapterPage, idx: number) => {
    const inWindow = layoutMode === 'single' || (idx >= windowStart && idx <= windowEnd);
    const inVideoWindow =
      layoutMode === 'single' ||
      (idx >= Math.max(0, currentIndex - VIDEO_KEEP_BEHIND) &&
        idx <= Math.min(pages.length - 1, currentIndex + VIDEO_PRELOAD_AHEAD));
    if (inWindow) {
      renderedImagesRef.current.add(p.id);
    }
    // During initial resume jump, keep distant off-screen pages lightweight so resumed page loads first.
    // Once resume settles (or immediately on user scroll), mount native lazy <img> for every page so
    // fast forward/backward scrolling never lands on stuck gray placeholders.
    const shouldRenderMedia = resumeSettled || inWindow || renderedImagesRef.current.has(p.id);
    const showMotion = mode === 'motion' && Boolean(p.motionUrl);
    const isVideo = showMotion && isVideoMimeOrUrl(p.motionMime, p.motionUrl);
    const reservedHeight = measuredHeightsRef.current[p.id] || 560;
    const isMediaLoaded = loadedMediaRef.current.has(p.id);

    const handleAssetLoaded = (height: number) => {
      loadedMediaRef.current.add(p.id);
      if (height > 100) measuredHeightsRef.current[p.id] = height;
      const wrapper = pageRefs.current[idx];
      if (wrapper) {
        wrapper.style.minHeight = '';
      }
      const resumeIdx = pendingResumeIndexRef.current;
      if (
        layoutMode === 'vertical' &&
        resumeIdx !== null &&
        idx <= resumeIdx &&
        !userInteractedRef.current &&
        Date.now() < autoScrollUntilRef.current
      ) {
        requestAnimationFrame(() => alignToResumedPage(resumeIdx));
      }
    };

    return (
      <div
        key={p.id}
        ref={(el) => {
          pageRefs.current[idx] = el;
          if (el && shouldRenderMedia && el.offsetHeight > 200) {
            measuredHeightsRef.current[p.id] = el.offsetHeight;
          }
        }}
        data-page-index={idx}
        className={`relative flex flex-col items-center justify-center w-full ${
          controlsVisible && !isFullscreen ? 'scroll-mt-16' : 'scroll-mt-0'
        }`}
        style={{
          filter: brightness !== 100 ? `brightness(${brightness}%)` : undefined,
          transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
          transformOrigin: 'top center',
          minHeight: !shouldRenderMedia || !isMediaLoaded ? `${reservedHeight}px` : undefined,
        }}
      >
        {!shouldRenderMedia ? (
          <div
            className="w-full max-w-4xl mx-auto rounded-lg bg-[#0D0D12] border border-white/5 flex items-center justify-center text-zinc-600 font-mono-tabular text-xs"
            style={{ height: `${reservedHeight}px` }}
          >
            Página {p.pageNumber}
          </div>
        ) : showMotion && inVideoWindow ? (
          isVideo ? (
            <video
              ref={(el) => {
                videoRefs.current[p.id] = el;
              }}
              src={p.motionUrl}
              poster={p.originalUrl}
              autoPlay={isPlayingMotion}
              loop
              muted
              playsInline
              preload="auto"
              onLoadedData={(e) => handleAssetLoaded(e.currentTarget.offsetHeight)}
              className={`${imageStyleClass} select-none`}
            />
          ) : (
            <img
              src={p.motionUrl}
              alt={`Página ${p.pageNumber} Motion`}
              loading={inWindow ? 'eager' : 'lazy'}
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={(e) => handleAssetLoaded(e.currentTarget.offsetHeight)}
              className={`${imageStyleClass} select-none`}
            />
          )
        ) : (
          <img
            src={p.originalUrl}
            alt={`Página ${p.pageNumber}`}
            loading={inWindow ? 'eager' : 'lazy'}
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={(e) => handleAssetLoaded(e.currentTarget.offsetHeight)}
            className={`${imageStyleClass} select-none`}
          />
        )}
      </div>
    );
  };

  if (!isPreviewMode && authLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-zinc-400 text-sm">
        Verificando acesso...
      </div>
    );
  }

  if (!isPreviewMode && !user) {
    return (
      <div className="min-h-screen bg-[#08080A] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <p className="font-display text-xl text-white">Login obrigatório para ler</p>
        <p className="text-sm text-zinc-400 max-w-md">
          Você precisa estar logado em uma conta para acessar a página de leitura.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenAuth}
            className="px-5 py-2.5 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold transition-colors"
          >
            Entrar ou Criar conta
          </button>
          <button
            type="button"
            onClick={() =>
              mangaId ? onNavigate({ name: 'manga', mangaId }) : onNavigate({ name: 'home' })
            }
            className="px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-200 hover:bg-white/10 text-sm font-semibold transition-colors"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-zinc-400 text-sm">
        Carregando capítulo...
      </div>
    );
  }

  if (!manga || !chapter) {
    return (
      <div className="min-h-screen bg-[#08080A] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <p className="font-display text-xl text-white">Capítulo não encontrado.</p>
        <button
          type="button"
          onClick={() => {
            if (isPreviewMode && previewKey) {
              onNavigate({ name: 'preview', previewKey });
            } else if (mangaId) {
              onNavigate({ name: 'manga', mangaId });
            } else {
              onNavigate({ name: 'home' });
            }
          }}
          className="px-5 py-2.5 rounded-xl bg-[#E11D48] text-white text-sm font-semibold"
        >
          Voltar para a obra
        </button>
      </div>
    );
  }

  const navigateBackToWork = () => {
    if (isPreviewMode && previewKey) {
      onNavigate({ name: 'preview', previewKey });
    } else {
      onNavigate({ name: 'manga', mangaId: manga.id });
    }
  };

  const navigateToChapter = (targetChapterId: string) => {
    if (isPreviewMode && previewKey) {
      onNavigate({
        name: 'preview_reader',
        previewKey,
        chapterId: targetChapterId,
        initialPage: 1,
      });
    } else {
      onNavigate({
        name: 'reader',
        mangaId: manga.id,
        chapterId: targetChapterId,
        initialPage: 1,
      });
    }
  };

  return (
    <div
      ref={containerRef}
      className={`${
        isFullscreen ? 'fixed inset-0 z-50 h-[100dvh] w-screen overflow-y-auto' : 'min-h-screen relative'
      } ${themeBg} text-[#F4F4F6] flex flex-col`}
    >
      {/* Minimal Single-Row Top Overlay */}
      {controlsVisible && (
        <header
          data-reader-ui
          className="fixed top-0 inset-x-0 z-40 h-14 bg-[#08080A]/85 backdrop-blur-md border-b border-white/8 px-3 sm:px-5 flex items-center justify-between gap-2"
        >
          {/* Left: Back + Title */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={navigateBackToWork}
              aria-label="Voltar à obra"
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-white/10 text-zinc-300 shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="font-display text-xs sm:text-sm font-semibold text-white truncate max-w-[110px] sm:max-w-[220px]">
                {manga.title}
              </div>
              <div className="text-[11px] text-zinc-400 font-mono-tabular truncate">
                Cap. {chapter.chapterNumber}
              </div>
            </div>
          </div>

          {/* Right: Compact Switchers + Settings + Fullscreen */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex items-center p-0.5 rounded-lg bg-[#16161C] border border-white/10">
              <button
                type="button"
                onClick={() => handleToggleMode('original')}
                className={`min-h-[30px] inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                  mode === 'original'
                    ? 'bg-white text-zinc-950'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <ImageIcon className="w-3 h-3" />
                <span className="hidden xs:inline sm:inline">Original</span>
              </button>
              <button
                type="button"
                onClick={() => handleToggleMode('motion')}
                className={`min-h-[30px] inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                  mode === 'motion'
                    ? 'bg-[#E11D48] text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Film className="w-3 h-3" />
                <span className="hidden xs:inline sm:inline">Motion</span>
              </button>
            </div>

            {mode === 'motion' && hasAnyMotionInChapter && (
              <button
                type="button"
                onClick={() => setIsPlayingMotion((p) => !p)}
                title={isPlayingMotion ? 'Pausar Motion' : 'Reproduzir Motion'}
                aria-label={isPlayingMotion ? 'Pausar Motion' : 'Reproduzir Motion'}
                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg bg-white/6 hover:bg-white/12 text-zinc-200"
              >
                {isPlayingMotion ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
            )}

            <button
              type="button"
              onClick={() => handleSetLayoutMode(layoutMode === 'single' ? 'vertical' : 'single')}
              title={
                layoutMode === 'vertical'
                  ? 'Modo Contínuo (Toque para mudar para Páginas)'
                  : 'Modo Páginas por Toque (Toque para mudar para Contínuo)'
              }
              className="min-h-[34px] inline-flex items-center gap-1.5 px-2.5 rounded-lg bg-white/6 hover:bg-white/12 text-[11px] font-medium text-zinc-200"
            >
              {layoutMode === 'vertical' ? (
                <>
                  <Rows className="w-3.5 h-3.5 text-[#E11D48]" />
                  <span className="hidden sm:inline">Contínuo</span>
                </>
              ) : (
                <>
                  <Columns className="w-3.5 h-3.5 text-[#E11D48]" />
                  <span className="hidden sm:inline">Páginas</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen((s) => !s)}
              title="Configurações de Leitura"
              aria-label="Configurações de Leitura"
              className={`min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg transition-colors ${
                settingsOpen ? 'bg-[#E11D48] text-white' : 'bg-white/6 hover:bg-white/12 text-zinc-200'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>

            {!isPreviewMode && (
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  setCommentsOpen((c) => !c);
                }}
                title="Comentários"
                aria-label="Comentários"
                className="min-h-[34px] inline-flex items-center gap-1 px-2 rounded-lg bg-white/6 hover:bg-white/12 text-[11px] text-zinc-200"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="font-mono-tabular">{comments.length}</span>
              </button>
            )}

            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia (F)'}
              aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg bg-white/6 hover:bg-white/12 text-zinc-200"
            >
              {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
            </button>
          </div>
        </header>
      )}

      {/* Compact Settings Popover */}
      {controlsVisible && settingsOpen && (
        <div
          data-reader-ui
          className="fixed top-16 right-3 sm:right-5 z-50 w-72 rounded-2xl bg-[#111116]/95 backdrop-blur-md border border-white/12 shadow-2xl p-4 space-y-4 text-xs"
        >
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-zinc-400">Estilo de Leitura</span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => handleSetLayoutMode('vertical')}
                className={`py-2 px-2.5 rounded-xl border text-center font-medium transition-colors ${
                  layoutMode === 'vertical'
                    ? 'bg-[#E11D48]/15 border-[#E11D48]/50 text-white'
                    : 'bg-white/5 border-white/8 text-zinc-300'
                }`}
              >
                Contínuo
              </button>
              <button
                type="button"
                onClick={() => handleSetLayoutMode('single')}
                className={`py-2 px-2.5 rounded-xl border text-center font-medium transition-colors ${
                  layoutMode === 'single'
                    ? 'bg-[#E11D48]/15 border-[#E11D48]/50 text-white'
                    : 'bg-white/5 border-white/8 text-zinc-300'
                }`}
              >
                Toque Esq/Dir
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-zinc-400">Ajuste à Tela</label>
            <select
              value={fitMode}
              onChange={(e) => {
                const next = e.target.value as ReaderFitMode;
                setFitMode(next);
                persistReaderPrefs({ fitMode: next });
              }}
              className="w-full px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
            >
              <option value="fit-width">Ajustar Largura</option>
              <option value="fit-height">Ajustar Altura</option>
              <option value="actual">Tamanho Real</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-zinc-400">Zoom</span>
            <div className="flex items-center gap-1 bg-[#08080A] border border-white/10 rounded-xl px-1 py-0.5">
              <button
                type="button"
                onClick={() => {
                  const next = Math.max(50, zoom - 15);
                  setZoom(next);
                  persistReaderPrefs({ zoom: next }, true);
                }}
                aria-label="Diminuir zoom"
                className="p-1.5 text-zinc-300 hover:text-white"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono-tabular text-[11px] text-zinc-200 w-10 text-center">
                {zoom}%
              </span>
              <button
                type="button"
                onClick={() => {
                  const next = Math.min(250, zoom + 15);
                  setZoom(next);
                  persistReaderPrefs({ zoom: next }, true);
                }}
                aria-label="Aumentar zoom"
                className="p-1.5 text-zinc-300 hover:text-white"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-zinc-400">Fundo da Tela</span>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: 'oled', label: 'OLED' },
                { id: 'slate', label: 'Ardósia' },
                { id: 'warm-dark', label: 'Suave' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    const next = t.id as ReaderNightTheme;
                    setNightTheme(next);
                    persistReaderPrefs({ nightTheme: next });
                  }}
                  className={`py-1.5 rounded-lg border text-[11px] font-medium ${
                    nightTheme === t.id
                      ? 'bg-white text-zinc-950 border-white'
                      : 'bg-white/5 border-white/8 text-zinc-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>Brilho</span>
              <span className="font-mono-tabular text-zinc-200">{brightness}%</span>
            </div>
            <input
              type="range"
              min={40}
              max={100}
              value={brightness}
              onChange={(e) => {
                const next = Number(e.target.value);
                setBrightness(next);
                persistReaderPrefs({ brightness: next }, true);
              }}
              className="w-full accent-[#E11D48]"
            />
          </div>

          {!isPreviewMode && (
            <button
              type="button"
              onClick={() => {
                setSettingsOpen(false);
                if (user) setReportOpen(true);
                else onOpenAuth();
              }}
              className="w-full py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/8 text-zinc-300 flex items-center justify-center gap-1.5"
            >
              <Flag className="w-3.5 h-3.5" />
              Reportar Capítulo
            </button>
          )}
        </div>
      )}

      {/* Subtle floating exit-fullscreen button only when fullscreen controls are hidden */}
      {isFullscreen && !controlsVisible && (
        <button
          type="button"
          data-reader-ui
          onClick={toggleFullscreen}
          aria-label="Sair da tela cheia"
          className="fixed top-3 right-3 z-30 w-9 h-9 rounded-full bg-black/35 hover:bg-black/75 text-white/50 hover:text-white backdrop-blur-sm flex items-center justify-center transition-colors"
        >
          <Minimize className="w-4 h-4" />
        </button>
      )}

      {/* Discreet Transient Toast */}
      {toastMsg && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] px-3.5 py-1.5 rounded-full bg-zinc-950/75 backdrop-blur-md border border-white/10 text-[11px] font-normal tracking-wide text-zinc-200/90 shadow-lg pointer-events-none text-center">
          {toastMsg}
        </div>
      )}

      {/* Pure Clean Main Reading Canvas */}
      <main
        onClick={handleCanvasClick}
        className={`flex-1 relative flex flex-col items-center overflow-x-clip ${
          controlsVisible && !isFullscreen ? 'pt-16 pb-16 px-1 sm:px-4' : 'p-0'
        }`}
      >
        {pages.length === 0 ? (
          <div className="py-24 text-center space-y-2 px-4">
            <p className="font-display text-lg text-white">Capítulo sem páginas enviadas</p>
            <p className="text-sm text-zinc-400">
              O autor ainda está enviando as páginas deste capítulo.
            </p>
          </div>
        ) : layoutMode === 'single' && currentPage ? (
          <div className="w-full max-w-5xl flex-1 flex items-center justify-center min-h-[calc(100vh-2rem)] cursor-pointer">
            {renderPageAsset(currentPage, currentIndex)}
          </div>
        ) : (
          <div className="w-full max-w-4xl space-y-1">
            {pages.map((p, idx) => renderPageAsset(p, idx))}
          </div>
        )}
      </main>

      {/* Slim Single-Row Bottom Bar (hidden in fullscreen / immersive mode) */}
      {controlsVisible && (
        <footer
          data-reader-ui
          className="fixed bottom-0 inset-x-0 z-30 h-12 bg-[#08080A]/85 backdrop-blur-md border-t border-white/8 px-3 sm:px-5 flex items-center"
        >
          <div className="w-full max-w-4xl mx-auto flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={!prevChapter}
              onClick={() => prevChapter && navigateToChapter(prevChapter.id)}
              className="min-h-[34px] px-3 py-1 rounded-lg bg-white/6 hover:bg-white/12 text-[11px] font-medium text-zinc-200 disabled:opacity-30 whitespace-nowrap"
            >
              Cap. Anterior
            </button>

            {pages.length > 0 && (
              <select
                value={currentIndex}
                onChange={(e) => goToPage(Number(e.target.value))}
                aria-label="Ir para página"
                className="min-h-[34px] px-2.5 rounded-lg bg-[#16161C] border border-white/10 text-[11px] font-mono-tabular text-white"
              >
                {pages.map((p, idx) => (
                  <option key={p.id} value={idx}>
                    Pág. {p.pageNumber}/{pages.length}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              disabled={!nextChapter}
              onClick={() => nextChapter && navigateToChapter(nextChapter.id)}
              className="min-h-[34px] px-3 py-1 rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-[11px] font-semibold text-white disabled:opacity-30 whitespace-nowrap"
            >
              Próx. Cap.
            </button>
          </div>
        </footer>
      )}

      {/* Chapter Comments Drawer (TikTok-style flat threads) */}
      {commentsOpen && (
        <aside
          data-reader-ui
          className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#111116] border-l border-white/12 flex flex-col shadow-2xl"
        >
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
            <h3 className="font-display text-base font-bold text-white">
              Comentários do Capítulo ({comments.length})
            </h3>
            <button
              type="button"
              onClick={() => setCommentsOpen(false)}
              aria-label="Fechar comentários"
              className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/8 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/8 px-4 sm:px-5">
            {comments.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-12">
                Nenhum comentário neste capítulo ainda. Seja o primeiro!
              </p>
            ) : (
              topComments.map((c) => {
                const replies = repliesByParentId.get(c.id) || [];
                const isTopAuthor = Boolean(c.isAuthorReply || c.userId === manga.authorId);
                const hasAuthorReply = replies.some(
                  (r) => r.isAuthorReply || r.userId === manga.authorId
                );
                const canEditTop = Boolean(user?.uid === c.userId && !c.isHidden);
                const canDeleteTop = Boolean(
                  user?.uid === c.userId || user?.uid === manga.authorId || isAdmin
                );
                const isExpanded =
                  expandedReplyThreads[c.id] ?? (hasAuthorReply || replies.length <= 2);
                const visibleReplies = isExpanded ? replies : replies.slice(0, 1);
                const hiddenRepliesCount = Math.max(0, replies.length - visibleReplies.length);

                return (
                  <div key={c.id} className="py-4 space-y-2.5">
                    {/* Root Comment */}
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="font-semibold text-white truncate">{c.userName}</span>
                            {isTopAuthor && (
                              <span className="text-[11px] font-semibold text-[#FB7185] shrink-0">
                                Autor
                              </span>
                            )}
                            <span className="text-[11px] font-mono-tabular text-zinc-500">
                              · {formatCommentTime(c.createdAt)}
                              {wasCommentEdited(c) ? ' · editado' : ''}
                            </span>
                          </div>
                          {hasAuthorReply && (
                            <p className="text-[11px] font-medium text-[#FB7185]">
                              O autor respondeu
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {canEditTop && (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteCommentId(null);
                                if (editingCommentId === c.id) {
                                  setEditingCommentId(null);
                                  setEditCommentDraft('');
                                } else {
                                  setEditingCommentId(c.id);
                                  setEditCommentDraft(c.content);
                                }
                              }}
                              aria-label="Editar comentário"
                              title="Editar comentário"
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/6 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {canDeleteTop &&
                            (confirmDeleteCommentId === c.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={deletingCommentId === c.id}
                                  onClick={() => void handleConfirmDeleteComment(c)}
                                  className="px-2 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold disabled:opacity-40"
                                >
                                  Excluir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteCommentId(null)}
                                  className="px-2 py-1 rounded-md bg-white/8 text-[11px] text-zinc-300"
                                >
                                  Não
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCommentId(null);
                                  setConfirmDeleteCommentId(c.id);
                                }}
                                aria-label="Excluir comentário"
                                title="Excluir comentário"
                                className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ))}
                        </div>
                      </div>

                      {editingCommentId === c.id ? (
                        <form
                          onSubmit={(e) => void handleSaveEditComment(e, c.id)}
                          className="space-y-2 pt-1"
                        >
                          <input
                            type="text"
                            maxLength={MAX_LIMITS.COMMENT_CONTENT}
                            value={editCommentDraft}
                            onChange={(e) => setEditCommentDraft(e.target.value)}
                            autoFocus
                            className="w-full min-h-[38px] px-3 rounded-xl bg-[#08080A] border border-white/15 text-xs text-white focus:outline-none focus:border-[#E11D48]"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              disabled={savingEditComment || !editCommentDraft.trim()}
                              className="px-3 py-1.5 rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white text-[11px] font-semibold disabled:opacity-40"
                            >
                              {savingEditComment ? 'Salvando...' : 'Salvar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCommentId(null);
                                setEditCommentDraft('');
                              }}
                              className="px-3 py-1.5 rounded-lg bg-white/8 text-[11px] text-zinc-300"
                            >
                              Cancelar
                            </button>
                          </div>
                        </form>
                      ) : (
                        <p className="text-[13px] text-zinc-200 leading-relaxed whitespace-pre-wrap">
                          {c.content}
                        </p>
                      )}

                      <div className="flex items-center gap-3 pt-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (!user) {
                              onOpenAuth();
                              return;
                            }
                            setEditingCommentId(null);
                            setReplyingTo(c);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-white transition-colors"
                        >
                          <Reply className="w-3 h-3" />
                          Responder
                        </button>
                      </div>
                    </div>

                    {/* Flat TikTok-style Replies Stack (one below another, no cascade borders) */}
                    {replies.length > 0 && (
                      <div className="pl-5 pt-1 space-y-3">
                        {visibleReplies.map((r) => {
                          const isReplyAuthor = Boolean(
                            r.isAuthorReply || r.userId === manga.authorId
                          );
                          const canEditReply = Boolean(user?.uid === r.userId && !r.isHidden);
                          const canDeleteReply = Boolean(
                            user?.uid === r.userId || user?.uid === manga.authorId || isAdmin
                          );

                          return (
                            <div key={r.id} className="space-y-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] min-w-0">
                                  <span className="font-semibold text-white truncate">
                                    {r.userName}
                                  </span>
                                  {isReplyAuthor && (
                                    <span className="font-semibold text-[#FB7185] shrink-0">
                                      Autor
                                    </span>
                                  )}
                                  {r.replyToUserName && (
                                    <span className="text-zinc-400 truncate">
                                      ▸ {r.replyToUserName}
                                    </span>
                                  )}
                                  <span className="font-mono-tabular text-zinc-500">
                                    · {formatCommentTime(r.createdAt)}
                                    {wasCommentEdited(r) ? ' · editado' : ''}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {canEditReply && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmDeleteCommentId(null);
                                        if (editingCommentId === r.id) {
                                          setEditingCommentId(null);
                                          setEditCommentDraft('');
                                        } else {
                                          setEditingCommentId(r.id);
                                          setEditCommentDraft(r.content);
                                        }
                                      }}
                                      aria-label="Editar resposta"
                                      title="Editar resposta"
                                      className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/6 transition-colors"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  )}

                                  {canDeleteReply &&
                                    (confirmDeleteCommentId === r.id ? (
                                      <div className="flex items-center gap-1">
                                        <button
                                          type="button"
                                          disabled={deletingCommentId === r.id}
                                          onClick={() => void handleConfirmDeleteComment(r)}
                                          className="px-2 py-0.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold disabled:opacity-40"
                                        >
                                          Excluir
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmDeleteCommentId(null)}
                                          className="px-2 py-0.5 rounded-md bg-white/8 text-[11px] text-zinc-300"
                                        >
                                          Não
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingCommentId(null);
                                          setConfirmDeleteCommentId(r.id);
                                        }}
                                        aria-label="Excluir resposta"
                                        title="Excluir resposta"
                                        className="p-1 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    ))}
                                </div>
                              </div>

                              {editingCommentId === r.id ? (
                                <form
                                  onSubmit={(e) => void handleSaveEditComment(e, r.id)}
                                  className="space-y-2 pt-1"
                                >
                                  <input
                                    type="text"
                                    maxLength={MAX_LIMITS.COMMENT_CONTENT}
                                    value={editCommentDraft}
                                    onChange={(e) => setEditCommentDraft(e.target.value)}
                                    autoFocus
                                    className="w-full min-h-[36px] px-3 rounded-xl bg-[#08080A] border border-white/15 text-xs text-white focus:outline-none focus:border-[#E11D48]"
                                  />
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="submit"
                                      disabled={savingEditComment || !editCommentDraft.trim()}
                                      className="px-3 py-1 rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white text-[11px] font-semibold disabled:opacity-40"
                                    >
                                      {savingEditComment ? 'Salvando...' : 'Salvar'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingCommentId(null);
                                        setEditCommentDraft('');
                                      }}
                                      className="px-3 py-1 rounded-lg bg-white/8 text-[11px] text-zinc-300"
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                                  {r.content}
                                </p>
                              )}

                              <div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!user) {
                                      onOpenAuth();
                                      return;
                                    }
                                    setEditingCommentId(null);
                                    setReplyingTo(r);
                                  }}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-white transition-colors"
                                >
                                  <Reply className="w-3 h-3" />
                                  Responder
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        {hiddenRepliesCount > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedReplyThreads((prev) => ({ ...prev, [c.id]: true }))
                            }
                            className="text-[11px] font-medium text-zinc-400 hover:text-white transition-colors"
                          >
                            Ver mais {hiddenRepliesCount}{' '}
                            {hiddenRepliesCount === 1 ? 'resposta' : 'respostas'}
                          </button>
                        ) : (
                          replies.length > 2 &&
                          isExpanded && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedReplyThreads((prev) => ({ ...prev, [c.id]: false }))
                              }
                              className="text-[11px] font-medium text-zinc-500 hover:text-zinc-300 transition-colors"
                            >
                              Ocultar respostas
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <form
            onSubmit={handlePostComment}
            className="p-4 border-t border-white/10 bg-[#0C0C10] space-y-2"
          >
            {replyingTo && (
              <div className="flex items-center justify-between gap-2 text-xs text-zinc-300 bg-[#16161C] px-3 py-1.5 rounded-lg">
                <span className="truncate">
                  Respondendo a <strong className="text-white">{replyingTo.userName}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className="text-zinc-400 hover:text-white shrink-0"
                >
                  Cancelar
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={MAX_LIMITS.COMMENT_CONTENT}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder={
                  replyingTo
                    ? `Responder a ${replyingTo.userName}...`
                    : user
                    ? 'Escreva um comentário...'
                    : 'Entre para comentar'
                }
                className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-[#16161C] border border-white/10 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E11D48]"
              />
              <button
                type="submit"
                disabled={postingComment}
                aria-label="Enviar comentário"
                className="min-w-[44px] min-h-[42px] flex items-center justify-center rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </aside>
      )}

      <ReportModal
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="chapter"
        targetId={chapter.id}
        targetLabel={`${manga.title} — Cap. ${chapter.chapterNumber}`}
        mangaId={manga.id}
      />
    </div>
  );
}
