import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Film,
  Image as ImageIcon,
  Layers,
  Link2,
  MessageSquare,
  PenTool,
  Plus,
  RefreshCw,
  Search,
  ShieldOff,
  Star,
  Trash2,
  Upload,
  Users,
  Wallet,
} from 'lucide-react';
import { MotionAlignment } from '../../shared/motionMedia';
import { CreatorInteractionsPanel } from '../components/CreatorInteractionsPanel';
import { CreatorMonetizationPanel } from '../components/CreatorMonetizationPanel';
import { MotionCropPreview } from '../components/MotionCropPreview';
import { AppRoute } from '../components/Navbar';
import { ToastPopup } from '../components/ToastPopup';
import { useAuth } from '../context/AuthContext';
import { deleteMediaAsset, fetchStorageStatus, StorageStatusResponse, uploadMediaAsset } from '../lib/api';
import {
  getImageDimensionsInBrowser,
  inspectMotionFileInBrowser,
  MotionInspectionResult,
} from '../lib/motionValidation';
import { evaluateNewStimulusMilestones } from '../lib/stimulus';
import { downloadChapterPagesZip } from '../lib/zipArchive';
import {
  addPageToChapter,
  createChapter,
  createManga,
  CreatorStudioCommentItem,
  CreatorStudioRatingItem,
  deleteAllChapterPages,
  deleteChapterAndSync,
  deleteChapterPage,
  deleteManga,
  fetchChapterPages,
  fetchChaptersForManga,
  fetchCreatorInteractions,
  fetchCreatorMangas,
  normalizePreviewSlug,
  reorderChapterPages,
  updateChapterStatusAndSync,
  updateManga,
  updateMangaPreviewLink,
  updatePageAssets,
} from '../services/mangaService';
import { fetchCreatorMonetizationDashboard } from '../services/monetizationService';
import {
  AGE_RATINGS,
  AgeRating,
  Chapter,
  ChapterPage,
  GENRE_OPTIONS,
  Manga,
  MangaStatus,
} from '../types/manga';
import { CreatorMonetizationDashboard, formatBRL } from '../types/monetization';

interface CreatorStudioPageProps {
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
}

export function CreatorStudioPage({ onNavigate, onOpenAuth }: CreatorStudioPageProps) {
  const { user, profile, resendVerificationEmail, refreshProfile } = useAuth();
  const [studioTab, setStudioTab] = useState<'works' | 'interactions' | 'monetization'>('works');
  const [interactionsMangaFilter, setInteractionsMangaFilter] = useState<string>('all');
  const [storageStatus, setStorageStatus] = useState<StorageStatusResponse | null>(null);
  const [mangas, setMangas] = useState<Manga[]>([]);
  const [selectedManga, setSelectedManga] = useState<Manga | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [pages, setPages] = useState<ChapterPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Highlighted balance & engagement overview state
  const [monetizationDashboard, setMonetizationDashboard] =
    useState<CreatorMonetizationDashboard | null>(null);
  const [studioComments, setStudioComments] = useState<CreatorStudioCommentItem[]>([]);
  const [studioRatings, setStudioRatings] = useState<CreatorStudioRatingItem[]>([]);
  const [commentCountsByChapter, setCommentCountsByChapter] = useState<Record<string, number>>({});
  const [interactionsLoading, setInteractionsLoading] = useState(false);

  // Works list filters & inline delete confirmation
  const [workSearch, setWorkSearch] = useState('');
  const [workStatusFilter, setWorkStatusFilter] = useState<'all' | 'published' | 'pre_launch' | 'draft'>('all');
  const [confirmDeleteMangaId, setConfirmDeleteMangaId] = useState<string | null>(null);
  const [confirmDeleteChapterId, setConfirmDeleteChapterId] = useState<string | null>(null);

  // Manga Form state (create or edit)
  const [editingMangaId, setEditingMangaId] = useState<string | null>(null);
  const [showMangaForm, setShowMangaForm] = useState(false);
  const [title, setTitle] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [genres, setGenres] = useState<string[]>(['Ação']);
  const [ageRating, setAgeRating] = useState<AgeRating>('14+');
  const [status, setStatus] = useState<MangaStatus>('draft');
  const [coverUrl, setCoverUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [savedCoverUrl, setSavedCoverUrl] = useState('');
  const [savedBannerUrl, setSavedBannerUrl] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [savingManga, setSavingManga] = useState(false);

  // Chapter Form state
  const [newChapterNum, setNewChapterNum] = useState(1);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [creatingChapter, setCreatingChapter] = useState(false);

  // New Page Paired Upload & Motion Crop Preview state
  const [origFile, setOrigFile] = useState<File | null>(null);
  const [origDims, setOrigDims] = useState<{ width: number; height: number } | null>(null);
  const [motionFile, setMotionFile] = useState<File | null>(null);
  const [motionInspection, setMotionInspection] = useState<MotionInspectionResult | null>(null);
  const [motionAlignment, setMotionAlignment] = useState<MotionAlignment>('center');
  const [pendingMotionReplace, setPendingMotionReplace] = useState<{
    page: ChapterPage;
    inspection: MotionInspectionResult;
    pageWidth: number | null;
    pageHeight: number | null;
    alignment: MotionAlignment;
  } | null>(null);
  const [applyingMotionReplace, setApplyingMotionReplace] = useState(false);
  const [uploadingPage, setUploadingPage] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [publishingChapterId, setPublishingChapterId] = useState<string | null>(null);
  const [downloadingPages, setDownloadingPages] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);
  const [downloadMotionPromptOpen, setDownloadMotionPromptOpen] = useState(false);
  const [confirmDeleteAllPages, setConfirmDeleteAllPages] = useState(false);
  const [deletingAllPages, setDeletingAllPages] = useState(false);

  // Private preview link management state
  const [previewSlugInput, setPreviewSlugInput] = useState('');
  const [previewActionLoading, setPreviewActionLoading] = useState<
    'update_slug' | 'regenerate' | 'revoke' | null
  >(null);
  const [copiedPreviewLink, setCopiedPreviewLink] = useState(false);

  useEffect(() => {
    fetchStorageStatus().then(setStorageStatus).catch(() => {});
  }, []);

  const loadInteractions = async (worksList: Manga[]) => {
    if (worksList.length === 0) {
      setStudioComments([]);
      setStudioRatings([]);
      setCommentCountsByChapter({});
      return;
    }
    setInteractionsLoading(true);
    try {
      const data = await fetchCreatorInteractions(worksList);
      setStudioComments(data.comments);
      setStudioRatings(data.ratings);
      setCommentCountsByChapter(data.commentCountsByChapter);
    } catch {
      // Non-blocking metrics refresh
    } finally {
      setInteractionsLoading(false);
    }
  };

  const loadMonetizationSummary = async () => {
    try {
      const dash = await fetchCreatorMonetizationDashboard();
      setMonetizationDashboard(dash);
    } catch {
      // Non-blocking balance summary
    }
  };

  const loadCreatorWorks = async () => {
    if (!user || !user.emailVerified) return;
    setLoading(true);
    try {
      const list = await fetchCreatorMangas(user.uid);
      setMangas(list);
      if (selectedManga) {
        const refreshed = list.find((m) => m.id === selectedManga.id) || null;
        setSelectedManga(refreshed);
      }
      void loadInteractions(list);
      void loadMonetizationSummary();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCreatorWorks();
  }, [user?.uid, user?.emailVerified]);

  const studioOverview = useMemo(() => {
    const totalViews = mangas.reduce((sum, m) => sum + (m.viewsCount || 0), 0);
    const totalRatingsCount = mangas.reduce((sum, m) => sum + (m.ratingCount || 0), 0);
    const weightedScoreSum = mangas.reduce(
      (sum, m) => sum + (m.ratingAverage || 0) * (m.ratingCount || 0),
      0
    );
    const avgRating = totalRatingsCount > 0 ? weightedScoreSum / totalRatingsCount : 0;
    const totalVisibleComments = studioComments.filter((c) => !c.comment.isHidden).length;
    const totalFollowers = Math.max(0, profile?.followersCount ?? 0);
    return {
      totalViews,
      totalRatingsCount,
      avgRating,
      totalVisibleComments,
      totalFollowers,
    };
  }, [mangas, studioComments, profile?.followersCount]);

  useEffect(() => {
    if (!user?.uid || loading || mangas.length === 0) return;
    const milestoneMsg = evaluateNewStimulusMilestones({
      userId: user.uid,
      mangas,
      totalFollowers: studioOverview.totalFollowers,
    });
    if (milestoneMsg) {
      setFeedback((prev) => prev || milestoneMsg);
    }
  }, [user?.uid, loading, mangas, studioOverview.totalFollowers]);

  const filteredMangas = useMemo(() => {
    const q = workSearch.trim().toLowerCase();
    return mangas.filter((m) => {
      if (workStatusFilter === 'draft' && m.status !== 'draft') return false;
      if (workStatusFilter === 'pre_launch' && m.status !== 'pre_launch') return false;
      if (
        workStatusFilter === 'published' &&
        m.status !== 'ongoing' &&
        m.status !== 'completed' &&
        m.status !== 'hiatus'
      ) {
        return false;
      }
      if (q && !m.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [mangas, workSearch, workStatusFilter]);

  const selectedWorkPerformance = useMemo(() => {
    if (!selectedManga || !monetizationDashboard) return null;
    return (
      monetizationDashboard.workPerformance.find((w) => w.mangaId === selectedManga.id) || null
    );
  }, [selectedManga, monetizationDashboard]);

  const selectedMangaCommentsCount = useMemo(() => {
    return chapters.reduce((sum, ch) => sum + (commentCountsByChapter[ch.id] ?? 0), 0);
  }, [chapters, commentCountsByChapter]);

  const loadChapters = async (mangaId: string, parentManga?: Manga | null) => {
    const chs = await fetchChaptersForManga(
      mangaId,
      true,
      false,
      parentManga ?? (selectedManga?.id === mangaId ? selectedManga : null)
    );
    setChapters(chs);
    setNewChapterNum(chs.length > 0 ? Math.max(...chs.map((c) => c.chapterNumber)) + 1 : 1);
    if (selectedChapter) {
      const updated = chs.find((c) => c.id === selectedChapter.id) || null;
      setSelectedChapter(updated);
    }
  };

  const loadPages = async (mangaId: string, chapterId: string) => {
    const pList = await fetchChapterPages(mangaId, chapterId, true);
    setPages(pList);
  };

  useEffect(() => {
    if (selectedManga) {
      void loadChapters(selectedManga.id, selectedManga);
      setSelectedChapter(null);
      setPages([]);
    }
  }, [selectedManga?.id]);

  useEffect(() => {
    setOrigFile(null);
    setOrigDims(null);
    setMotionFile(null);
    setMotionInspection(null);
    setMotionAlignment('center');
    setPendingMotionReplace(null);
    setDownloadMotionPromptOpen(false);
    setConfirmDeleteAllPages(false);
    setDownloadProgress(null);
    if (selectedManga && selectedChapter) {
      void loadPages(selectedManga.id, selectedChapter.id);
    }
  }, [selectedChapter?.id]);

  useEffect(() => {
    if (selectedManga) {
      setPreviewSlugInput(
        selectedManga.previewSlug || normalizePreviewSlug(selectedManga.title)
      );
      setCopiedPreviewLink(false);
    } else {
      setPreviewSlugInput('');
      setCopiedPreviewLink(false);
    }
  }, [selectedManga?.id, selectedManga?.previewSlug, selectedManga?.title]);

  const openCreateManga = () => {
    setEditingMangaId(null);
    setTitle('');
    setAuthorName(profile?.displayName || user?.displayName || '');
    setSynopsis('');
    setGenres(['Ação']);
    setAgeRating('14+');
    setStatus('draft');
    setCoverUrl('');
    setBannerUrl('');
    setSavedCoverUrl('');
    setSavedBannerUrl('');
    setShowMangaForm(true);
    setError(null);
  };

  const openEditManga = (m: Manga) => {
    setEditingMangaId(m.id);
    setTitle(m.title);
    setAuthorName(m.authorName);
    setSynopsis(m.synopsis);
    setGenres(m.genres);
    setAgeRating(m.ageRating);
    setStatus(m.status);
    setCoverUrl(m.coverUrl);
    setBannerUrl(m.bannerUrl);
    setSavedCoverUrl(m.coverUrl);
    setSavedBannerUrl(m.bannerUrl);
    setShowMangaForm(true);
    setError(null);
  };

  const handleCoverUpload = async (file: File, kind: 'cover' | 'banner') => {
    setError(null);
    try {
      setUploadProgress(0);
      const previousFormUrl = kind === 'cover' ? coverUrl : bannerUrl;
      const savedUrl = kind === 'cover' ? savedCoverUrl : savedBannerUrl;
      const res = await uploadMediaAsset({
        file,
        kind,
        mangaId: editingMangaId || 'draft',
        onProgress: setUploadProgress,
      });
      if (kind === 'cover') setCoverUrl(res.url);
      else setBannerUrl(res.url);

      if (previousFormUrl && previousFormUrl !== savedUrl && previousFormUrl !== res.url) {
        void deleteMediaAsset(previousFormUrl).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no upload da imagem.');
    } finally {
      setUploadProgress(null);
    }
  };

  const handleSaveManga = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSavingManga(true);
    try {
      if (editingMangaId) {
        await updateManga(editingMangaId, {
          title,
          authorName,
          synopsis,
          genres,
          ageRating,
          status,
          coverUrl,
          bannerUrl,
        });
        if (savedCoverUrl && savedCoverUrl !== coverUrl) {
          void deleteMediaAsset(savedCoverUrl).catch(() => {});
        }
        if (savedBannerUrl && savedBannerUrl !== bannerUrl) {
          void deleteMediaAsset(savedBannerUrl).catch(() => {});
        }
        setFeedback('Obra atualizada com sucesso.');
      } else {
        const created = await createManga({
          authorId: user.uid,
          authorName: authorName || profile?.displayName || 'Autor',
          title,
          synopsis,
          coverUrl,
          bannerUrl,
          genres,
          ageRating,
          status,
        });
        setSelectedManga(created);
        setFeedback('Obra criada com sucesso! Agora crie capítulos e envie suas páginas.');
      }
      setShowMangaForm(false);
      await loadCreatorWorks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar obra.');
    } finally {
      setSavingManga(false);
    }
  };

  const handleCreateChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedManga) return;
    setCreatingChapter(true);
    setError(null);
    try {
      const ch = await createChapter({
        mangaId: selectedManga.id,
        authorId: user.uid,
        chapterNumber: newChapterNum,
        title: newChapterTitle || `Capítulo ${newChapterNum}`,
      });
      setNewChapterTitle('');
      await loadChapters(selectedManga.id);
      setSelectedChapter(ch);
      setFeedback(`Capítulo ${ch.chapterNumber} criado como rascunho.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar capítulo.');
    } finally {
      setCreatingChapter(false);
    }
  };

  const handleToggleChapterPublish = async (ch: Chapter) => {
    if (!selectedManga || publishingChapterId === ch.id) return;
    const nextStatus = ch.status === 'published' ? 'draft' : 'published';
    const wasPreLaunch = selectedManga.status === 'pre_launch';
    const isPrivateWork = selectedManga.status === 'draft';
    setPublishingChapterId(ch.id);
    setError(null);
    try {
      await updateChapterStatusAndSync({
        manga: selectedManga,
        chapter: ch,
        newStatus: nextStatus,
      });
      await loadChapters(selectedManga.id);
      await loadCreatorWorks();
      if (selectedChapter?.id === ch.id) {
        await loadPages(selectedManga.id, ch.id);
      }
      if (nextStatus === 'published') {
        if (wasPreLaunch) {
          setFeedback(
            `Capítulo ${ch.chapterNumber} publicado! A obra saiu de Pré-lançamento para Lançada automaticamente e os seguidores foram notificados.`
          );
        } else if (isPrivateWork) {
          setFeedback(
            `Capítulo ${ch.chapterNumber} preparado! A obra continua Privada no catálogo e só pode ser lida por você ou pelo link exclusivo de prévia.`
          );
        } else {
          setFeedback(`Capítulo ${ch.chapterNumber} publicado! Seguidores foram notificados.`);
        }
      } else {
        setFeedback(`Capítulo ${ch.chapterNumber} movido para rascunho.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao alterar status do capítulo.');
    } finally {
      setPublishingChapterId((prev) => (prev === ch.id ? null : prev));
    }
  };

  const handlePreviewLinkAction = async (
    action: 'update_slug' | 'regenerate' | 'revoke'
  ) => {
    if (!selectedManga || previewActionLoading) return;
    setPreviewActionLoading(action);
    setError(null);
    try {
      const updated = await updateMangaPreviewLink({
        manga: selectedManga,
        action,
        customSlug: previewSlugInput,
      });
      setSelectedManga(updated);
      setMangas((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setPreviewSlugInput(updated.previewSlug || '');
      setCopiedPreviewLink(false);
      if (action === 'revoke') {
        setFeedback('Link privado de prévia revogado. O endereço anterior não funciona mais.');
      } else if (action === 'regenerate') {
        setFeedback('Novo link privado gerado! O link anterior foi revogado automaticamente.');
      } else {
        setFeedback('Slug personalizado do link de prévia atualizado com sucesso.');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Falha ao atualizar link privado de prévia.'
      );
    } finally {
      setPreviewActionLoading(null);
    }
  };

  const handleSelectPairedOriginalFile = async (file: File | null) => {
    setOrigFile(file);
    setOrigDims(null);
    if (!file) return;
    try {
      const dims = await getImageDimensionsInBrowser(file);
      setOrigDims(dims);
    } catch {
      // Non-fatal fallback; server will inspect uploaded original image directly
    }
  };

  const handleSelectPairedMotionFile = async (file: File | null) => {
    setError(null);
    if (!file) {
      setMotionFile(null);
      setMotionInspection(null);
      setMotionAlignment('center');
      return;
    }
    try {
      const inspection = await inspectMotionFileInBrowser(file);
      setMotionFile(file);
      setMotionInspection(inspection);
      setMotionAlignment('center');
    } catch (err) {
      setMotionFile(null);
      setMotionInspection(null);
      setMotionAlignment('center');
      setError(
        err instanceof Error
          ? err.message
          : 'Arquivo Motion inválido. Verifique formato, duração (máx. 10s) e tamanho (máx. 20 MB).'
      );
    }
  };

  const handleSelectMotionForPage = async (page: ChapterPage, file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const inspection = await inspectMotionFileInBrowser(file);
      const dims = await getImageDimensionsInBrowser(page.originalUrl).catch(() => null);
      setPendingMotionReplace({
        page,
        inspection,
        pageWidth: dims?.width ?? null,
        pageHeight: dims?.height ?? null,
        alignment: 'center',
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Arquivo Motion inválido. Verifique formato, duração (máx. 10s) e tamanho (máx. 20 MB).'
      );
    }
  };

  const handleUploadPairedPage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedManga || !selectedChapter || !origFile) {
      setError('Selecione pelo menos o arquivo da imagem original da página.');
      return;
    }
    setUploadingPage(true);
    setError(null);
    let uploadedOrigUrl: string | null = null;
    try {
      let validatedMotion: MotionInspectionResult | null = motionInspection;
      if (motionFile && !validatedMotion) {
        validatedMotion = await inspectMotionFileInBrowser(motionFile);
      }

      setUploadProgress(0);
      const origRes = await uploadMediaAsset({
        file: origFile,
        kind: 'original',
        mangaId: selectedManga.id,
        chapterId: selectedChapter.id,
        onProgress: setUploadProgress,
      });
      uploadedOrigUrl = origRes.url;

      let motionRes: { url: string; mimeType: string } | null = null;
      if (motionFile && validatedMotion) {
        setUploadProgress(0);
        const uploadedMotion = await uploadMediaAsset({
          file: motionFile,
          kind: 'motion',
          mangaId: selectedManga.id,
          chapterId: selectedChapter.id,
          motionOptions: {
            alignment: motionAlignment,
            originalUrl: origRes.url,
            targetWidth: origDims?.width,
            targetHeight: origDims?.height,
          },
          onProgress: setUploadProgress,
        });
        motionRes = { url: uploadedMotion.url, mimeType: uploadedMotion.mimeType };
      }

      await addPageToChapter({
        mangaId: selectedManga.id,
        chapter: selectedChapter,
        authorId: user.uid,
        pageNumber: pages.length + 1,
        originalUrl: origRes.url,
        originalMime: origRes.mimeType,
        motionUrl: motionRes?.url || '',
        motionMime: motionRes?.mimeType || '',
      });

      setOrigFile(null);
      setOrigDims(null);
      setMotionFile(null);
      setMotionInspection(null);
      setMotionAlignment('center');
      await loadPages(selectedManga.id, selectedChapter.id);
      await loadChapters(selectedManga.id);
      setFeedback('Página vinculada adicionada ao capítulo!');
    } catch (err) {
      if (uploadedOrigUrl) {
        void deleteMediaAsset(uploadedOrigUrl).catch(() => {});
      }
      setError(err instanceof Error ? err.message : 'Falha ao enviar página.');
    } finally {
      setUploadingPage(false);
      setUploadProgress(null);
    }
  };

  const handleBulkOriginalUpload = async (fileList: FileList | null) => {
    if (
      !fileList ||
      fileList.length === 0 ||
      !user ||
      !selectedManga ||
      !selectedChapter ||
      uploadingPage
    ) {
      return;
    }
    const sorted = Array.from(fileList).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    const mangaId = selectedManga.id;
    const chapterSnapshot = selectedChapter;
    setUploadingPage(true);
    setError(null);
    setFeedback(null);
    let uploadedCount = 0;
    try {
      let nextPageNum =
        pages.length > 0 ? Math.max(...pages.map((p) => p.pageNumber)) + 1 : 1;
      for (let i = 0; i < sorted.length; i++) {
        const file = sorted[i];
        setUploadProgress(0);
        setBulkProgress(`Enviando página ${i + 1} de ${sorted.length}: ${file.name}`);
        const res = await uploadMediaAsset({
          file,
          kind: 'original',
          mangaId,
          chapterId: chapterSnapshot.id,
          onProgress: setUploadProgress,
        });
        const createdPage = await addPageToChapter({
          mangaId,
          chapter: chapterSnapshot,
          authorId: user.uid,
          pageNumber: nextPageNum++,
          originalUrl: res.url,
          originalMime: res.mimeType,
        });
        uploadedCount++;
        setPages((prev) =>
          [...prev.filter((p) => p.id !== createdPage.id), createdPage].sort(
            (a, b) => a.pageNumber - b.pageNumber
          )
        );
        setSelectedChapter((prev) =>
          prev && prev.id === chapterSnapshot.id
            ? { ...prev, pagesCount: prev.pagesCount + 1 }
            : prev
        );
        setChapters((prev) =>
          prev.map((c) =>
            c.id === chapterSnapshot.id ? { ...c, pagesCount: c.pagesCount + 1 } : c
          )
        );
      }
      setFeedback(
        `${uploadedCount} ${uploadedCount === 1 ? 'página adicionada' : 'páginas adicionadas'} ao Capítulo ${chapterSnapshot.chapterNumber}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro no envio em lote.');
    } finally {
      if (uploadedCount > 0) {
        await loadPages(mangaId, chapterSnapshot.id).catch(() => {});
        await loadChapters(mangaId).catch(() => {});
      }
      setBulkProgress(null);
      setUploadProgress(null);
      setUploadingPage(false);
    }
  };

  const handleReplacePageAsset = async (
    page: ChapterPage,
    kind: 'original' | 'motion',
    file: File,
    motionOptions?: {
      alignment?: MotionAlignment;
      originalUrl?: string;
      targetWidth?: number;
      targetHeight?: number;
    }
  ): Promise<boolean> => {
    if (!selectedManga || !selectedChapter) return false;
    setError(null);
    const oldUrl = kind === 'original' ? page.originalUrl : page.motionUrl;
    try {
      setUploadProgress(0);
      const res = await uploadMediaAsset({
        file,
        kind,
        mangaId: selectedManga.id,
        chapterId: selectedChapter.id,
        ...(kind === 'motion' ? { motionOptions } : {}),
        onProgress: setUploadProgress,
      });
      await updatePageAssets({
        mangaId: selectedManga.id,
        chapterId: selectedChapter.id,
        pageId: page.id,
        ...(kind === 'original'
          ? { originalUrl: res.url, originalMime: res.mimeType }
          : { motionUrl: res.url, motionMime: res.mimeType }),
      });
      if (oldUrl && oldUrl !== res.url) {
        void deleteMediaAsset(oldUrl).catch(() => {});
      }
      await loadPages(selectedManga.id, selectedChapter.id);
      await loadChapters(selectedManga.id);
      setFeedback(
        kind === 'motion'
          ? `Versão Motion vinculada à Página ${page.pageNumber}.`
          : `Imagem Original atualizada na Página ${page.pageNumber}.`
      );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar arquivo da página.');
      return false;
    } finally {
      setUploadProgress(null);
    }
  };

  const handleConfirmMotionReplace = async () => {
    if (!pendingMotionReplace || applyingMotionReplace) return;
    setApplyingMotionReplace(true);
    try {
      const ok = await handleReplacePageAsset(
        pendingMotionReplace.page,
        'motion',
        pendingMotionReplace.inspection.file,
        {
          alignment: pendingMotionReplace.alignment,
          originalUrl: pendingMotionReplace.page.originalUrl,
          targetWidth: pendingMotionReplace.pageWidth ?? undefined,
          targetHeight: pendingMotionReplace.pageHeight ?? undefined,
        }
      );
      if (ok) {
        setPendingMotionReplace(null);
      }
    } finally {
      setApplyingMotionReplace(false);
    }
  };

  const handleMovePage = async (index: number, direction: -1 | 1) => {
    if (!selectedManga || !selectedChapter) return;
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= pages.length) return;
    const copy = [...pages];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, moved);
    setPages(copy);
    await reorderChapterPages(selectedManga.id, selectedChapter.id, copy);
    await loadPages(selectedManga.id, selectedChapter.id);
  };

  const motionPagesCount = useMemo(
    () => pages.filter((p) => Boolean(p.motionUrl)).length,
    [pages]
  );

  const chapterOrMangaHasMotion = motionPagesCount > 0;

  const handleDownloadChapterZip = async (includeMotion: boolean) => {
    if (!selectedManga || !selectedChapter || pages.length === 0 || downloadingPages) return;
    setDownloadingPages(true);
    setDownloadMotionPromptOpen(false);
    setError(null);
    setFeedback(null);
    try {
      const result = await downloadChapterPagesZip({
        mangaTitle: selectedManga.title,
        chapterNumber: selectedChapter.chapterNumber,
        pages,
        includeMotion,
        onProgress: ({ completed, total, currentFilename }) => {
          setDownloadProgress(
            `Preparando ZIP (${completed}/${total}): ${currentFilename}`
          );
        },
      });
      setFeedback(
        `Download iniciado: ${result.zipFilename} (${result.filesCount} ${
          result.filesCount === 1 ? 'arquivo' : 'arquivos'
        }).`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível gerar o arquivo ZIP das páginas.'
      );
    } finally {
      setDownloadingPages(false);
      setDownloadProgress(null);
    }
  };

  const handleStartDownloadAllPages = () => {
    if (pages.length === 0 || downloadingPages || deletingAllPages) return;
    setConfirmDeleteAllPages(false);
    if (chapterOrMangaHasMotion) {
      setDownloadMotionPromptOpen((prev) => !prev);
      return;
    }
    void handleDownloadChapterZip(false);
  };

  const handleDeleteAllPages = async () => {
    if (!selectedManga || !selectedChapter || pages.length === 0 || deletingAllPages) return;
    const chapterSnapshot = selectedChapter;
    const mangaId = selectedManga.id;
    setDeletingAllPages(true);
    setError(null);
    setFeedback(null);
    try {
      const removedCount = await deleteAllChapterPages(mangaId, chapterSnapshot.id);
      setConfirmDeleteAllPages(false);
      setDownloadMotionPromptOpen(false);
      await loadPages(mangaId, chapterSnapshot.id);
      await loadChapters(mangaId);
      await loadCreatorWorks();
      setFeedback(
        `Todas as ${removedCount} ${
          removedCount === 1 ? 'página' : 'páginas'
        } do Capítulo ${chapterSnapshot.chapterNumber} foram excluídas.`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível excluir todas as páginas do capítulo.'
      );
    } finally {
      setDeletingAllPages(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center space-y-5">
        <PenTool className="w-10 h-10 text-[#E11D48] mx-auto" />
        <h1 className="font-display text-3xl font-bold text-white">Estúdio do Criador</h1>
        <p className="text-sm text-zinc-400">
          Faça login para cadastrar suas séries, gerenciar capítulos em rascunho e enviar arquivos
          originais e Motion Manga.
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="px-6 py-3 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold"
        >
          Entrar ou Cadastrar-se
        </button>
      </div>
    );
  }

  if (!user.emailVerified) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
        <h1 className="font-display text-2xl font-bold text-white">Confirme seu e-mail</h1>
        <p className="text-sm text-zinc-400">
          Para segurança contra publicações não autorizadas, confirme o link enviado para{' '}
          <strong className="text-white">{user.email}</strong> antes de publicar obras.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={resendVerificationEmail}
            className="px-4 py-2.5 rounded-xl bg-white/8 hover:bg-white/15 text-sm text-white"
          >
            Reenviar E-mail
          </button>
          <button
            type="button"
            onClick={refreshProfile}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E11D48] text-white text-sm font-semibold"
          >
            <RefreshCw className="w-4 h-4" />
            Já confirmei
          </button>
        </div>
      </div>
    );
  }

  if (profile?.isSuspended) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-3">
        <h1 className="font-display text-2xl font-bold text-rose-400">Conta Suspensa</h1>
        <p className="text-sm text-zinc-400">
          Sua conta está temporariamente suspensa pela moderação e não pode criar ou editar obras.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 md:pb-16 space-y-8">
      <ToastPopup
        feedback={feedback}
        error={error}
        onClearFeedback={() => setFeedback(null)}
        onClearError={() => setError(null)}
      />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/8 pb-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
            Estúdio do Criador
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Gerencie séries, capítulos isolados e páginas pareadas (Original + Motion).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#111115] border border-white/8 overflow-x-auto max-w-full">
            <button
              type="button"
              onClick={() => setStudioTab('works')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                studioTab === 'works'
                  ? 'bg-[#E11D48] text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Obras &amp; Capítulos
            </button>
            <button
              type="button"
              onClick={() => {
                setInteractionsMangaFilter('all');
                setStudioTab('interactions');
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                studioTab === 'interactions'
                  ? 'bg-[#E11D48] text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Comentários &amp; Avaliações ({studioOverview.totalVisibleComments})
            </button>
            <button
              type="button"
              onClick={() => setStudioTab('monetization')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                studioTab === 'monetization'
                  ? 'bg-[#E11D48] text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              Monetização &amp; Ganhos
            </button>
          </div>
          {storageStatus && studioTab === 'works' && (
            <span className="text-xs text-zinc-400">
              Armazenamento:{' '}
              <strong className="text-zinc-200">
                {storageStatus.driver === 's3' ? 'Bucket S3/R2 Externo' : 'Servidor Gerenciado'}
              </strong>
            </span>
          )}
          {studioTab === 'works' && (
            <button
              type="button"
              onClick={openCreateManga}
              className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nova Obra
            </button>
          )}
        </div>
      </div>

      {/* Highlighted Balance Panel + Creator Overview Strip */}
      <section className="bg-[#111115] border border-white/10 rounded-2xl p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
        <div className="lg:col-span-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 lg:border-r lg:border-white/8 lg:pr-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Wallet className="w-3.5 h-3.5 text-[#E11D48]" />
              Saldo Disponível para Saque
            </div>
            <div className="font-mono-tabular text-2xl sm:text-3xl font-bold text-white">
              {formatBRL(monetizationDashboard?.balance.availableCents ?? 0)}
            </div>
            <div className="text-[11px] font-mono-tabular text-zinc-400 flex flex-wrap gap-x-3 gap-y-0.5">
              <span>
                Pendente:{' '}
                <strong className="text-zinc-200">
                  {formatBRL(monetizationDashboard?.balance.pendingCents ?? 0)}
                </strong>
              </span>
              <span>
                Em análise:{' '}
                <strong className="text-zinc-200">
                  {formatBRL(monetizationDashboard?.balance.withdrawalPendingCents ?? 0)}
                </strong>
              </span>
              <span>
                Recebido:{' '}
                <strong className="text-emerald-400">
                  {formatBRL(monetizationDashboard?.balance.totalPaidCents ?? 0)}
                </strong>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStudioTab('monetization')}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
          >
            {monetizationDashboard &&
            monetizationDashboard.balance.availableCents >=
              monetizationDashboard.settings.minWithdrawalCents
              ? 'Sacar via Pix'
              : 'Ver Monetização'}
          </button>
        </div>

        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Eye className="w-3.5 h-3.5 text-zinc-500" />
              Visualizações
            </div>
            <div className="font-mono-tabular text-lg font-bold text-white">
              {studioOverview.totalViews.toLocaleString('pt-BR')}
            </div>
            <div className="text-[11px] text-zinc-500">Nas {mangas.length} obras</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Users className="w-3.5 h-3.5 text-zinc-500" />
              Seguidores
            </div>
            <div className="font-mono-tabular text-lg font-bold text-white">
              {studioOverview.totalFollowers.toLocaleString('pt-BR')}
            </div>
            <div className="text-[11px] text-zinc-500">Do seu perfil</div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Star className="w-3.5 h-3.5 text-amber-400" />
              Nota Média
            </div>
            <div className="font-mono-tabular text-lg font-bold text-white">
              {studioOverview.totalRatingsCount > 0 ? studioOverview.avgRating.toFixed(1) : '—'}
            </div>
            <div className="text-[11px] font-mono-tabular text-zinc-500">
              {studioOverview.totalRatingsCount} avaliações
            </div>
          </div>
        </div>
      </section>

      {studioTab === 'monetization' ? (
        <CreatorMonetizationPanel />
      ) : studioTab === 'interactions' ? (
        <CreatorInteractionsPanel
          mangas={mangas}
          comments={studioComments}
          ratings={studioRatings}
          loading={interactionsLoading}
          initialMangaFilter={interactionsMangaFilter}
          userId={user.uid}
          userName={profile?.displayName || user.displayName || 'Autor'}
          userAvatar={profile?.avatarUrl || ''}
          onRefresh={() => loadInteractions(mangas)}
          onNavigate={onNavigate}
        />
      ) : (
        <>

      {/* Manga Create / Edit Form */}
      {showMangaForm && (
        <form
          onSubmit={handleSaveManga}
          className="bg-[#111115] border border-white/12 rounded-2xl p-5 sm:p-7 space-y-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-white">
              {editingMangaId ? 'Editar Obra' : 'Cadastrar Nova Obra'}
            </h2>
            <button
              type="button"
              onClick={() => setShowMangaForm(false)}
              className="text-xs text-zinc-400 hover:text-white"
            >
              Cancelar
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Título da Obra *
              </label>
              <input
                type="text"
                required
                maxLength={140}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Crônicas de Kurogane"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white focus:outline-none focus:border-[#E11D48]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Nome do Autor / Estúdio *
              </label>
              <input
                type="text"
                required
                maxLength={80}
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white focus:outline-none focus:border-[#E11D48]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Classificação Indicativa
              </label>
              <select
                value={ageRating}
                onChange={(e) => setAgeRating(e.target.value as AgeRating)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white focus:outline-none focus:border-[#E11D48]"
              >
                {AGE_RATINGS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Status da Publicação
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as MangaStatus)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white focus:outline-none focus:border-[#E11D48]"
              >
                <option value="draft">Privado (Padrão — Só você vê no Estúdio)</option>
                <option value="pre_launch">Pré-lançamento (Capa e Sinopse visíveis)</option>
                <option value="ongoing">Lançado (Público no catálogo)</option>
                <option value="completed">Concluído (Público)</option>
                <option value="hiatus">Hiato (Público)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Sinopse *</label>
            <textarea
              rows={4}
              required
              maxLength={3000}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              placeholder="Apresente a história, premissa e atmosfera da obra..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white focus:outline-none focus:border-[#E11D48]"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-zinc-300 mb-2">
              Gêneros (selecione até 6)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {GENRE_OPTIONS.map((g) => {
                const selected = genres.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      if (selected) {
                        if (genres.length > 1) setGenres(genres.filter((item) => item !== g));
                      } else if (genres.length < 6) {
                        setGenres([...genres, g]);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      selected
                        ? 'bg-[#E11D48] text-white'
                        : 'bg-[#08080A] text-zinc-400 border border-white/10 hover:text-white'
                    }`}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-[#08080A] border border-white/10 space-y-2.5">
              <div className="text-xs font-medium text-zinc-300">Capa Vertical (3:4)</div>
              {coverUrl && (
                <img
                  src={coverUrl}
                  alt="Prévia da capa"
                  className="w-24 h-32 object-cover rounded-lg border border-white/10"
                />
              )}
              <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/8 hover:bg-white/15 text-xs font-medium text-white cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                {coverUrl ? 'Trocar Capa' : 'Enviar Capa (JPG/PNG/WebP)'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleCoverUpload(f, 'cover');
                  }}
                />
              </label>
            </div>

            <div className="p-4 rounded-xl bg-[#08080A] border border-white/10 space-y-2.5">
              <div className="text-xs font-medium text-zinc-300">Banner Horizontal (Opcional)</div>
              {bannerUrl && (
                <img
                  src={bannerUrl}
                  alt="Prévia do banner"
                  className="w-full h-24 object-cover rounded-lg border border-white/10"
                />
              )}
              <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/8 hover:bg-white/15 text-xs font-medium text-white cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                {bannerUrl ? 'Trocar Banner' : 'Enviar Banner'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleCoverUpload(f, 'banner');
                  }}
                />
              </label>
            </div>
          </div>

          {uploadProgress !== null && (
            <div className="text-xs text-zinc-300 font-mono-tabular">
              Enviando arquivo: {uploadProgress}%
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowMangaForm(false)}
              className="px-4 py-2.5 rounded-xl text-sm text-zinc-300 hover:bg-white/5"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingManga}
              className="px-6 py-2.5 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold disabled:opacity-50"
            >
              {savingManga ? 'Salvando...' : editingMangaId ? 'Salvar Alterações' : 'Criar Obra'}
            </button>
          </div>
        </form>
      )}

      {/* Main Studio Workspace: Works -> Chapters -> Isolated Chapter Pages */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Column 1: Creator's Mangas */}
        <section className="lg:col-span-4 bg-[#111115] border border-white/8 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="font-display text-base font-bold text-white">Minhas Obras</h2>
            <span className="text-xs font-mono-tabular text-zinc-400">
              {filteredMangas.length}/{mangas.length}
            </span>
          </div>

          {mangas.length > 0 && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={workSearch}
                  onChange={(e) => setWorkSearch(e.target.value)}
                  placeholder="Buscar obra pelo título..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E11D48]"
                />
              </div>

              <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#08080A] border border-white/8">
                {(
                  [
                    { id: 'all', label: 'Todas' },
                    { id: 'published', label: 'Públicas' },
                    { id: 'pre_launch', label: 'Pré-lanç.' },
                    { id: 'draft', label: 'Privadas' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setWorkStatusFilter(tab.id)}
                    className={`py-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
                      workStatusFilter === tab.id
                        ? 'bg-white/12 text-white'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-xs text-zinc-500 py-6 text-center">Carregando obras...</p>
          ) : mangas.length === 0 ? (
            <p className="text-xs text-zinc-400 py-8 text-center">
              Você ainda não cadastrou nenhuma obra. Clique em &ldquo;Nova Obra&rdquo; para
              começar.
            </p>
          ) : filteredMangas.length === 0 ? (
            <p className="text-xs text-zinc-400 py-8 text-center">
              Nenhuma obra corresponde à busca ou ao filtro selecionado.
            </p>
          ) : (
            <div className="space-y-2">
              {filteredMangas.map((m) => {
                const active = selectedManga?.id === m.id;
                const confirmingDelete = confirmDeleteMangaId === m.id;
                return (
                  <div
                    key={m.id}
                    className={`p-3 rounded-xl border transition-colors ${
                      active
                        ? 'bg-[#191922] border-[#E11D48]/60'
                        : 'bg-[#0B0B0E] border-white/8 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteMangaId(null);
                          setSelectedManga(m);
                        }}
                        className="flex items-start gap-3 flex-1 min-w-0 text-left"
                      >
                        <div className="w-12 h-16 rounded-lg overflow-hidden bg-[#181820] shrink-0">
                          {m.coverUrl && (
                            <img
                              src={m.coverUrl}
                              alt={m.title}
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-display text-sm font-semibold text-white truncate">
                            {m.title}
                          </div>
                          <div className="text-[11px] text-zinc-400 mt-0.5">
                            {m.status === 'draft'
                              ? 'Privado'
                              : m.status === 'pre_launch'
                                ? 'Pré-lançamento'
                                : m.status === 'completed'
                                  ? 'Concluído'
                                  : m.status === 'hiatus'
                                    ? 'Hiato'
                                    : 'Lançado'}{' '}
                            · {m.chaptersCount} cap.
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-mono-tabular text-zinc-400 mt-1.5">
                            <span className="inline-flex items-center gap-1" title="Visualizações">
                              <Eye className="w-3 h-3 text-zinc-500" />
                              {(m.viewsCount || 0).toLocaleString('pt-BR')}
                            </span>
                            <span className="inline-flex items-center gap-1" title="Avaliação">
                              <Star className="w-3 h-3 text-amber-400" />
                              {m.ratingCount > 0 ? m.ratingAverage.toFixed(1) : '—'} (
                              {m.ratingCount || 0})
                            </span>
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onNavigate({ name: 'manga', mangaId: m.id })}
                          title="Visualizar página da obra"
                          className="p-1.5 text-zinc-400 hover:text-white rounded"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditManga(m)}
                          title="Editar obra"
                          className="p-1.5 text-zinc-400 hover:text-white rounded"
                        >
                          <PenTool className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDeleteMangaId(confirmingDelete ? null : m.id)
                          }
                          title="Excluir obra"
                          className="p-1.5 text-zinc-500 hover:text-rose-400 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {confirmingDelete && (
                      <div className="mt-2.5 pt-2.5 border-t border-white/8 flex items-center justify-between gap-2 text-xs">
                        <span className="text-rose-300">Excluir obra e capítulos?</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={deletingId === m.id}
                            onClick={async () => {
                              if (deletingId) return;
                              setDeletingId(m.id);
                              setError(null);
                              try {
                                await deleteManga(m.id, user.uid);
                                if (selectedManga?.id === m.id) setSelectedManga(null);
                                setConfirmDeleteMangaId(null);
                                await loadCreatorWorks();
                                setFeedback(`Obra "${m.title}" excluída com sucesso.`);
                              } catch (err) {
                                setError(
                                  err instanceof Error ? err.message : 'Falha ao excluir obra.'
                                );
                              } finally {
                                setDeletingId(null);
                              }
                            }}
                            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold disabled:opacity-40"
                          >
                            {deletingId === m.id ? 'Excluindo...' : 'Confirmar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteMangaId(null)}
                            className="px-2 py-1 rounded-lg bg-white/8 text-zinc-300"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Column 2 & 3: Selected Manga Chapters + Strictly Isolated Chapter Pages */}
        <section className="lg:col-span-8 space-y-6">
          {!selectedManga ? (
            <div className="bg-[#111115] border border-white/8 rounded-2xl p-12 text-center space-y-2">
              <Layers className="w-8 h-8 text-zinc-500 mx-auto" />
              <p className="font-display text-base font-semibold text-white">
                Selecione uma obra ao lado
              </p>
              <p className="text-xs text-zinc-400">
                Cada capítulo mantém suas páginas originais e animações Motion estritamente
                isoladas.
              </p>
            </div>
          ) : (
            <>
              {/* Private Preview Link & Visibility Card */}
              {(() => {
                const previewUrl =
                  selectedManga.previewEnabled && selectedManga.previewKey
                    ? `${window.location.origin}${
                        window.location.pathname === '/' ? '' : window.location.pathname
                      }#/preview/${selectedManga.previewKey}`
                    : '';
                const statusInfo =
                  selectedManga.status === 'draft'
                    ? {
                        label: 'Privado (Padrão)',
                        badgeClass: 'bg-zinc-800 text-zinc-200 border-white/10',
                        hint: 'Visível apenas para você no Estúdio. Capítulos preparados ficam ocultos no catálogo público, mas podem ser lidos por quem tiver o link privado abaixo.',
                      }
                    : selectedManga.status === 'pre_launch'
                      ? {
                          label: 'Pré-lançamento',
                          badgeClass: 'bg-amber-400/15 text-amber-300 border-amber-400/30',
                          hint: 'Capa e sinopse visíveis no catálogo antes do lançamento oficial. Ao publicar o primeiro capítulo, a obra será lançada automaticamente.',
                        }
                      : selectedManga.status === 'hiatus'
                        ? {
                            label: 'Hiato (Público)',
                            badgeClass: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
                            hint: 'Obra pública no catálogo e no leitor.',
                          }
                        : selectedManga.status === 'completed'
                          ? {
                              label: 'Concluído (Público)',
                              badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                              hint: 'Obra pública no catálogo e no leitor.',
                            }
                          : {
                              label: 'Lançado (Público)',
                              badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                              hint: 'Obra pública no catálogo e no leitor.',
                            };

                return (
                  <div className="bg-[#111115] border border-white/8 rounded-2xl p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 text-sm font-display font-bold text-white">
                            <Link2 className="w-4 h-4 text-[#E11D48]" />
                            Visibilidade &amp; Link Privado de Prévia
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${statusInfo.badgeClass}`}
                          >
                            {statusInfo.label}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed max-w-2xl">
                          {statusInfo.hint}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => openEditManga(selectedManga)}
                        className="px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 text-xs font-medium text-white shrink-0"
                      >
                        Alterar Status
                      </button>
                    </div>

                    {previewUrl ? (
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 rounded-xl bg-[#08080A] border border-white/10">
                        <input
                          type="text"
                          readOnly
                          value={previewUrl}
                          aria-label="URL do link privado de prévia"
                          className="flex-1 bg-transparent text-xs font-mono-tabular text-zinc-200 px-2 py-1 focus:outline-none truncate"
                        />
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(previewUrl).then(() => {
                                setCopiedPreviewLink(true);
                                setTimeout(() => setCopiedPreviewLink(false), 2000);
                              });
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-semibold transition-colors"
                          >
                            {copiedPreviewLink ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                Copiado!
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                Copiar Link
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onNavigate({
                                name: 'preview',
                                previewKey: selectedManga.previewKey || '',
                              })
                            }
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 text-zinc-200 text-xs font-medium transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Abrir Prévia
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 rounded-xl bg-[#08080A] border border-dashed border-white/12 text-xs text-zinc-400">
                        Link privado revogado. Clique em &ldquo;Gerar Novo Link&rdquo; abaixo para
                        criar um novo acesso exclusivo.
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
                      <div className="flex-1 min-w-0">
                        <label className="block text-[11px] text-zinc-400 mb-1">
                          Slug personalizado do link (isolado nesta obra)
                        </label>
                        <input
                          type="text"
                          value={previewSlugInput}
                          maxLength={48}
                          onChange={(e) => setPreviewSlugInput(e.target.value)}
                          placeholder="ex: minha-obra-previa"
                          className="w-full px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs font-mono-tabular text-white focus:outline-none focus:border-[#E11D48]"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {selectedManga.previewEnabled && selectedManga.previewKey && (
                          <button
                            type="button"
                            disabled={previewActionLoading !== null}
                            onClick={() => void handlePreviewLinkAction('update_slug')}
                            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/18 text-white text-xs font-semibold disabled:opacity-50"
                          >
                            {previewActionLoading === 'update_slug' ? 'Salvando...' : 'Salvar Slug'}
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={previewActionLoading !== null}
                          onClick={() => void handlePreviewLinkAction('regenerate')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/15 text-zinc-100 text-xs font-semibold disabled:opacity-50"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          {previewActionLoading === 'regenerate'
                            ? 'Gerando...'
                            : 'Gerar Novo Link'}
                        </button>

                        {selectedManga.previewEnabled && selectedManga.previewKey && (
                          <button
                            type="button"
                            disabled={previewActionLoading !== null}
                            onClick={() => void handlePreviewLinkAction('revoke')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/12 hover:bg-rose-500/22 border border-rose-500/25 text-rose-300 text-xs font-semibold disabled:opacity-50"
                          >
                            <ShieldOff className="w-3.5 h-3.5" />
                            {previewActionLoading === 'revoke' ? 'Revogando...' : 'Revogar Link'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Chapters Manager */}
              <div className="bg-[#111115] border border-white/8 rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-white">
                      Capítulos de {selectedManga.title}
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Salve em rascunho enquanto envia as páginas ou publique quando estiver pronto.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setInteractionsMangaFilter(selectedManga.id);
                      setStudioTab('interactions');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/8 hover:bg-white/14 text-xs font-semibold text-white transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#E11D48]" />
                    Ver Comentários da Obra ({selectedMangaCommentsCount})
                  </button>
                </div>

                {/* Selected Work Performance Strip */}
                {(() => {
                  const totalViews = selectedManga.viewsCount || 0;
                  return (
                    <div className="px-3.5 py-3 rounded-xl bg-[#0B0B0E] border border-white/8">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <div className="text-[11px] text-zinc-400">Visualizações</div>
                          <div className="font-mono-tabular text-sm font-bold text-white mt-0.5">
                            {totalViews.toLocaleString('pt-BR')}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-zinc-400">Avaliação</div>
                          <div className="font-mono-tabular text-sm font-bold text-white mt-0.5">
                            {selectedManga.ratingCount > 0
                              ? `${selectedManga.ratingAverage.toFixed(1)} (${selectedManga.ratingCount})`
                              : 'Sem notas'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-zinc-400">Comentários</div>
                          <div className="font-mono-tabular text-sm font-bold text-white mt-0.5">
                            {selectedMangaCommentsCount.toLocaleString('pt-BR')}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-zinc-400">Sua Receita</div>
                          <div className="font-mono-tabular text-sm font-bold text-emerald-400 mt-0.5">
                            {formatBRL(selectedWorkPerformance?.artistShareCents ?? 0)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <form onSubmit={handleCreateChapter} className="grid grid-cols-12 gap-2.5 items-stretch">
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    required
                    aria-label="Número do capítulo"
                    value={newChapterNum}
                    onChange={(e) => setNewChapterNum(Number(e.target.value))}
                    placeholder="Nº"
                    className="col-span-3 sm:col-span-2 min-h-[42px] px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 focus:border-[#E11D48]/60 focus:outline-none text-sm font-mono-tabular text-white text-center sm:text-left"
                  />
                  <input
                    type="text"
                    required
                    maxLength={140}
                    aria-label="Título do capítulo"
                    value={newChapterTitle}
                    onChange={(e) => setNewChapterTitle(e.target.value)}
                    placeholder="Título do capítulo (ex: O Despertar)"
                    className="col-span-9 sm:col-span-7 min-h-[42px] px-3.5 py-2 rounded-xl bg-[#08080A] border border-white/10 focus:border-[#E11D48]/60 focus:outline-none text-sm text-white placeholder:text-zinc-500"
                  />
                  <button
                    type="submit"
                    disabled={creatingChapter}
                    className="col-span-12 sm:col-span-3 min-h-[42px] px-4 py-2 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] active:bg-[#9F1239] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm shadow-rose-950/40 transition-colors disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>{creatingChapter ? 'Criando...' : 'Criar Capítulo'}</span>
                  </button>
                </form>

                <div className="divide-y divide-white/8 border border-white/8 rounded-xl overflow-hidden bg-[#0B0B0E]">
                  {chapters.length === 0 ? (
                    <p className="text-xs text-zinc-500 py-6 text-center">
                      Nenhum capítulo criado para esta obra.
                    </p>
                  ) : (
                    chapters.map((ch) => {
                      const active = selectedChapter?.id === ch.id;
                      const chCommentsCount = commentCountsByChapter[ch.id] ?? 0;
                      const confirmingChapterDelete = confirmDeleteChapterId === ch.id;
                      return (
                        <div
                          key={ch.id}
                          className={`p-3.5 sm:p-4 space-y-2.5 transition-colors ${
                            active ? 'bg-[#191922]' : 'hover:bg-white/[0.02]'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={() => setSelectedChapter(ch)}
                              className="text-left w-full sm:w-auto sm:flex-1 min-w-0 space-y-1.5"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#E11D48]/15 text-[#FB7185] font-mono-tabular text-[11px] font-bold shrink-0 whitespace-nowrap">
                                  Cap. {ch.chapterNumber}
                                </span>
                                <span className="text-sm font-semibold text-white truncate">
                                  {ch.title}
                                </span>
                              </div>
                              <div className="text-[11px] text-zinc-400 font-mono-tabular flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                                    ch.status === 'published'
                                      ? 'bg-emerald-500/15 text-emerald-300'
                                      : 'bg-white/8 text-zinc-300'
                                  }`}
                                >
                                  {ch.status === 'published' ? 'Publicado' : 'Rascunho'}
                                </span>
                                <span className="whitespace-nowrap">
                                  {ch.pagesCount} {ch.pagesCount === 1 ? 'página' : 'páginas'}
                                </span>
                                {ch.hasMotion && (
                                  <span className="px-1.5 py-0.5 rounded bg-[#E11D48]/15 text-[#FB7185] text-[10px] font-semibold whitespace-nowrap">
                                    Motion
                                  </span>
                                )}
                                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                  <Eye className="w-3 h-3 text-zinc-500 shrink-0" />
                                  {(ch.viewsCount || 0).toLocaleString('pt-BR')} views
                                </span>
                                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                  <MessageSquare className="w-3 h-3 text-zinc-500 shrink-0" />
                                  {chCommentsCount} coment.
                                </span>
                              </div>
                            </button>

                            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                              <button
                                type="button"
                                onClick={() => setSelectedChapter(ch)}
                                className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                                  active
                                    ? 'bg-[#E11D48] text-white'
                                    : 'bg-white/8 text-zinc-200 hover:bg-white/15'
                                }`}
                              >
                                Gerenciar Páginas
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleChapterPublish(ch)}
                                disabled={publishingChapterId === ch.id}
                                className="min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-medium bg-white/8 hover:bg-white/15 text-zinc-200 transition-colors whitespace-nowrap disabled:opacity-50"
                              >
                                {publishingChapterId === ch.id
                                  ? 'Salvando...'
                                  : ch.status === 'published'
                                    ? 'Despublicar'
                                    : 'Publicar'}
                              </button>
                              {ch.pagesCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onNavigate({
                                      name: 'reader',
                                      mangaId: selectedManga.id,
                                      chapterId: ch.id,
                                    })
                                  }
                                  title="Abrir no Leitor"
                                  className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center p-1.5 rounded-lg bg-white/6 hover:bg-white/15 text-zinc-300 transition-colors"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDeleteChapterId(confirmingChapterDelete ? null : ch.id)
                                }
                                title="Excluir capítulo"
                                className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {confirmingChapterDelete && (
                            <div className="pt-2 border-t border-white/8 flex items-center justify-between gap-2 text-xs">
                              <span className="text-rose-300">
                                Excluir Cap. {ch.chapterNumber} e todas as suas páginas?
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={deletingId === ch.id}
                                  onClick={async () => {
                                    if (deletingId) return;
                                    setDeletingId(ch.id);
                                    setError(null);
                                    try {
                                      await deleteChapterAndSync(selectedManga, ch.id);
                                      if (selectedChapter?.id === ch.id) {
                                        setSelectedChapter(null);
                                        setPages([]);
                                      }
                                      setConfirmDeleteChapterId(null);
                                      await loadChapters(selectedManga.id);
                                      await loadCreatorWorks();
                                      setFeedback(`Capítulo ${ch.chapterNumber} excluído.`);
                                    } catch (err) {
                                      setError(
                                        err instanceof Error
                                          ? err.message
                                          : 'Falha ao excluir capítulo.'
                                      );
                                    } finally {
                                      setDeletingId(null);
                                    }
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold disabled:opacity-40"
                                >
                                  {deletingId === ch.id ? 'Excluindo...' : 'Confirmar'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteChapterId(null)}
                                  className="px-2 py-1 rounded-lg bg-white/8 text-zinc-300"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Strictly Isolated Chapter Pages Manager */}
              {selectedChapter && (
                <div className="bg-[#111115] border border-white/8 rounded-2xl p-5 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-4">
                    <div>
                      <h3 className="font-display text-lg font-bold text-white">
                        Páginas do Capítulo {selectedChapter.chapterNumber}: {selectedChapter.title}
                      </h3>
                      <p className="text-xs text-zinc-400">
                        Cada página vincula exclusivamente 1 arquivo Original e 1 versão Motion
                        (MP4/WebM/GIF/WebP) isolados neste capítulo.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {pages.length > 0 && (
                        <>
                          <button
                            type="button"
                            disabled={downloadingPages || deletingAllPages || uploadingPage}
                            onClick={handleStartDownloadAllPages}
                            className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/15 text-xs font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {downloadingPages
                              ? 'Baixando...'
                              : `Baixar Todas (${pages.length})`}
                          </button>

                          <button
                            type="button"
                            disabled={deletingAllPages || downloadingPages || uploadingPage}
                            onClick={() => {
                              setDownloadMotionPromptOpen(false);
                              setConfirmDeleteAllPages((prev) => !prev);
                            }}
                            className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-500/12 hover:bg-rose-500/20 border border-rose-500/25 text-xs font-medium text-rose-300 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {deletingAllPages ? 'Excluindo...' : 'Excluir Todas'}
                          </button>
                        </>
                      )}

                      <label
                        className={`min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/8 text-xs font-medium text-white ${
                          uploadingPage || deletingAllPages
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-white/15 cursor-pointer'
                        }`}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {uploadingPage && bulkProgress
                          ? 'Enviando lote...'
                          : 'Envio em Lote (Originais)'}
                        <input
                          type="file"
                          multiple
                          disabled={uploadingPage || deletingAllPages}
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const files = e.target.files;
                            void handleBulkOriginalUpload(files);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  {downloadMotionPromptOpen && chapterOrMangaHasMotion && (
                    <div className="p-3.5 rounded-xl bg-[#181822] border border-white/12 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                          <Film className="w-3.5 h-3.5 text-[#E11D48]" />
                          Este capítulo possui páginas com Motion ({motionPagesCount})
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          Escolha se deseja baixar apenas as imagens normais ou incluir também os
                          arquivos Motion no pacote .zip.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={downloadingPages}
                          onClick={() => void handleDownloadChapterZip(false)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/18 text-xs font-medium text-white disabled:opacity-50"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          Somente Normais ({pages.length})
                        </button>
                        <button
                          type="button"
                          disabled={downloadingPages}
                          onClick={() => void handleDownloadChapterZip(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-xs font-semibold text-white disabled:opacity-50"
                        >
                          <Film className="w-3.5 h-3.5" />
                          Normais + Motion ({pages.length + motionPagesCount})
                        </button>
                        <button
                          type="button"
                          onClick={() => setDownloadMotionPromptOpen(false)}
                          className="px-2.5 py-2 rounded-lg text-xs text-zinc-400 hover:text-white"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {confirmDeleteAllPages && pages.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-rose-950/35 border border-rose-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold text-rose-200">
                          Excluir todas as {pages.length}{' '}
                          {pages.length === 1 ? 'página' : 'páginas'} deste capítulo?
                        </div>
                        <p className="text-[11px] text-rose-200/75">
                          Essa ação remove permanentemente todas as imagens originais
                          {motionPagesCount > 0
                            ? ` e ${motionPagesCount} arquivo(s) Motion vinculados`
                            : ''}{' '}
                          do Capítulo {selectedChapter.chapterNumber}.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={deletingAllPages}
                          onClick={() => void handleDeleteAllPages()}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {deletingAllPages ? 'Excluindo tudo...' : 'Confirmar Exclusão'}
                        </button>
                        <button
                          type="button"
                          disabled={deletingAllPages}
                          onClick={() => setConfirmDeleteAllPages(false)}
                          className="px-3 py-2 rounded-lg bg-white/8 hover:bg-white/15 text-xs text-zinc-200 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {downloadProgress && (
                    <div className="p-3 rounded-xl bg-[#181822] border border-white/10 text-xs font-mono-tabular text-zinc-200 truncate">
                      {downloadProgress}
                    </div>
                  )}

                  {bulkProgress && (
                    <div className="p-3 rounded-xl bg-[#181822] border border-white/10 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs font-mono-tabular text-zinc-200">
                        <span className="truncate">{bulkProgress}</span>
                        {uploadProgress !== null && (
                          <span className="shrink-0 text-[#E11D48] font-semibold">
                            {uploadProgress}%
                          </span>
                        )}
                      </div>
                      {uploadProgress !== null && (
                        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-[#E11D48] transition-all duration-150"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Add Paired Page Form */}
                  <form
                    onSubmit={handleUploadPairedPage}
                    className="p-4 rounded-xl bg-[#0B0B0E] border border-white/10 space-y-4"
                  >
                    <div className="text-xs font-semibold text-white">
                      Adicionar Nova Página (Par Original + Motion)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1.5 p-3 rounded-xl border border-dashed border-white/15 hover:border-white/30 cursor-pointer">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                          <ImageIcon className="w-4 h-4 text-zinc-400" />
                          1. Imagem Original *
                        </span>
                        <span className="text-[11px] text-zinc-400 truncate">
                          {origFile
                            ? `${origFile.name}${origDims ? ` (${origDims.width}×${origDims.height})` : ''}`
                            : 'Selecionar JPG, PNG ou WebP'}
                        </span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0] || null;
                            void handleSelectPairedOriginalFile(f);
                            e.target.value = '';
                          }}
                        />
                      </label>

                      <label className="flex flex-col gap-1.5 p-3 rounded-xl border border-dashed border-white/15 hover:border-[#E11D48]/60 cursor-pointer">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                          <Film className="w-4 h-4 text-[#E11D48]" />
                          2. Versão Motion (Opcional)
                        </span>
                        <span className="text-[11px] text-zinc-400 truncate">
                          {motionFile
                            ? motionFile.name
                            : 'MP4, WebM, GIF, WebP ou APNG (máx. 10s e 20 MB)'}
                        </span>
                        <input
                          type="file"
                          accept="video/mp4,video/webm,image/gif,image/webp,image/apng"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0] || null;
                            void handleSelectPairedMotionFile(f);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>

                    {motionInspection && (
                      <MotionCropPreview
                        inspection={motionInspection}
                        pageWidth={origDims?.width ?? null}
                        pageHeight={origDims?.height ?? null}
                        alignment={motionAlignment}
                        onAlignmentChange={setMotionAlignment}
                        onClear={() => {
                          setMotionFile(null);
                          setMotionInspection(null);
                          setMotionAlignment('center');
                        }}
                      />
                    )}

                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-mono-tabular text-zinc-400">
                        {uploadProgress !== null ? `Progresso: ${uploadProgress}%` : ''}
                      </span>
                      <button
                        type="submit"
                        disabled={uploadingPage || !origFile}
                        className="px-5 py-2 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-semibold disabled:opacity-40"
                      >
                        {uploadingPage ? 'Enviando...' : 'Adicionar Página ao Capítulo'}
                      </button>
                    </div>
                  </form>

                  {/* Pages List */}
                  <div className="space-y-3">
                    {pages.length === 0 ? (
                      <p className="text-xs text-zinc-500 py-6 text-center">
                        Nenhuma página enviada neste capítulo ainda.
                      </p>
                    ) : (
                      pages.map((p, idx) => (
                        <div
                          key={p.id}
                          className="p-3.5 rounded-xl bg-[#0B0B0E] border border-white/8 space-y-3"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                              <span className="font-mono-tabular text-xs font-bold text-zinc-400 w-10">
                                #{p.pageNumber}
                              </span>

                              {/* Original Thumbnail */}
                              <div className="space-y-1">
                                <div className="w-16 h-22 rounded-lg overflow-hidden bg-[#16161C] border border-white/10">
                                  <img
                                    src={p.originalUrl}
                                    alt={`Pág. ${p.pageNumber} original`}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                <label className="block text-[10px] text-zinc-400 hover:text-white cursor-pointer text-center">
                                  Trocar Orig.
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    className="hidden"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) void handleReplacePageAsset(p, 'original', f);
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                              </div>

                              {/* Motion Thumbnail */}
                              <div className="space-y-1">
                                <div className="w-16 h-22 rounded-lg overflow-hidden bg-[#16161C] border border-white/10 flex items-center justify-center">
                                  {p.motionUrl ? (
                                    p.motionMime.startsWith('video/') ? (
                                      <video
                                        src={p.motionUrl}
                                        muted
                                        loop
                                        autoPlay
                                        playsInline
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <img
                                        src={p.motionUrl}
                                        alt={`Pág. ${p.pageNumber} motion`}
                                        className="w-full h-full object-cover"
                                      />
                                    )
                                  ) : (
                                    <Film className="w-4 h-4 text-zinc-600" />
                                  )}
                                </div>
                                <label className="block text-[10px] text-[#E11D48] hover:underline cursor-pointer text-center">
                                  {p.motionUrl ? 'Trocar Motion' : '+ Motion'}
                                  <input
                                    type="file"
                                    accept="video/mp4,video/webm,image/gif,image/webp,image/apng"
                                    className="hidden"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) void handleSelectMotionForPage(p, f);
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 self-end sm:self-center">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => void handleMovePage(idx, -1)}
                                aria-label="Mover para cima"
                                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 disabled:opacity-30"
                              >
                                <ArrowUp className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === pages.length - 1}
                                onClick={() => void handleMovePage(idx, 1)}
                                aria-label="Mover para baixo"
                                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 disabled:opacity-30"
                              >
                                <ArrowDown className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                disabled={deletingId === p.id}
                                onClick={async () => {
                                  if (deletingId) return;
                                  setDeletingId(p.id);
                                  setError(null);
                                  try {
                                    await deleteChapterPage(selectedManga.id, selectedChapter.id, p.id);
                                    await loadPages(selectedManga.id, selectedChapter.id);
                                    await loadChapters(selectedManga.id);
                                    setFeedback(`Página #${p.pageNumber} removida.`);
                                  } catch (err) {
                                    setError(
                                      err instanceof Error ? err.message : 'Falha ao remover página.'
                                    );
                                  } finally {
                                    setDeletingId(null);
                                  }
                                }}
                                aria-label="Remover página"
                                className="p-2 rounded-lg bg-white/5 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 disabled:opacity-40"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {pendingMotionReplace?.page.id === p.id && (
                            <div className="pt-2 border-t border-white/10 space-y-2.5">
                              <MotionCropPreview
                                inspection={pendingMotionReplace.inspection}
                                pageWidth={pendingMotionReplace.pageWidth}
                                pageHeight={pendingMotionReplace.pageHeight}
                                alignment={pendingMotionReplace.alignment}
                                onAlignmentChange={(alignment) =>
                                  setPendingMotionReplace((prev) =>
                                    prev ? { ...prev, alignment } : null
                                  )
                                }
                                onClear={() => setPendingMotionReplace(null)}
                              />
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <button
                                  type="button"
                                  disabled={applyingMotionReplace}
                                  onClick={() => setPendingMotionReplace(null)}
                                  className="px-3.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 text-xs text-zinc-300 disabled:opacity-40"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  disabled={applyingMotionReplace}
                                  onClick={() => void handleConfirmMotionReplace()}
                                  className="px-4 py-1.5 rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-semibold disabled:opacity-40"
                                >
                                  {applyingMotionReplace
                                    ? `Enviando${uploadProgress !== null ? ` (${uploadProgress}%)` : '...'}`
                                    : p.motionUrl
                                      ? 'Confirmar Troca de Motion'
                                      : 'Confirmar e Adicionar Motion'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
        </>
      )}
    </div>
  );
}
