export type AccountType = 'reader' | 'creator';
export type ReaderMode = 'original' | 'motion';
export type ReaderLayoutMode = 'single' | 'vertical';
export type ReaderFitMode = 'fit-width' | 'fit-height' | 'actual';
export type ReaderNightTheme = 'oled' | 'slate' | 'warm-dark';
export type AgeRating = 'Livre' | '12+' | '14+' | '16+' | '18+';
export type MangaStatus = 'draft' | 'pre_launch' | 'ongoing' | 'completed' | 'hiatus' | 'archived';
export type ModerationStatus = 'approved' | 'pending' | 'flagged' | 'removed';
export type ChapterStatus = 'draft' | 'published';

export const GENRE_OPTIONS = [
  'Ação',
  'Fantasia',
  'Ficção Científica',
  'Suspense',
  'Horror',
  'Drama',
  'Romance',
  'Mistério',
  'Aventura',
  'Slice of Life',
  'Histórico',
  'Esportes',
] as const;

export const AGE_RATINGS: AgeRating[] = ['Livre', '12+', '14+', '16+', '18+'];

export const REPORT_REASONS = [
  { value: 'copyright', label: 'Violação de Direitos Autorais' },
  { value: 'explicit_unmarked', label: 'Conteúdo Sensível sem Classificação' },
  { value: 'broken_media', label: 'Páginas ou Animações Corrompidas' },
  { value: 'spam', label: 'Spam ou Publicação Enganosa' },
  { value: 'harassment', label: 'Assédio ou Discurso de Ódio' },
  { value: 'other', label: 'Outro Motivo' },
] as const;

export const MAX_LIMITS = {
  DISPLAY_NAME: 80,
  HANDLE: 40,
  BIO: 400,
  MANGA_TITLE: 140,
  MANGA_SYNOPSIS: 3000,
  CHAPTER_TITLE: 140,
  COMMENT_CONTENT: 1500,
  REVIEW_CONTENT: 600,
  REPORT_DETAILS: 1000,
};

export type TractionClassification = 'em_alta' | 'em_ascensao' | 'aquecendo' | 'estavel';

export interface UserProfile {
  uid: string;
  displayName: string;
  handle: string;
  avatarUrl: string;
  bio: string;
  accountType: AccountType;
  followersCount: number;
  worksCount: number;
  isSuspended: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  preferredMode: ReaderMode;
  nightMode: boolean;
  layoutMode?: ReaderLayoutMode;
  fitMode?: ReaderFitMode;
  nightTheme?: ReaderNightTheme;
  brightness?: number;
  zoom?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StimulusWindow {
  chapterId: string;
  startedAtMs: number;
  budget: number;
  seed: number;
  durationHours: number;
}

export interface StimulusSettings {
  id: string;
  enabled: boolean;
  minViews: number;
  maxViews: number;
  durationHours: number;
  updatedBy: string;
  updatedAt?: unknown;
}

export interface Manga {
  id: string;
  authorId: string;
  authorName: string;
  title: string;
  slug: string;
  synopsis: string;
  coverUrl: string;
  bannerUrl: string;
  genres: string[];
  ageRating: AgeRating;
  status: MangaStatus;
  moderationStatus: ModerationStatus;
  isFeatured: boolean;
  hasMotion: boolean;
  chaptersCount: number;
  viewsCount: number;
  realViewsCount?: number;
  stimulusViewsCount?: number;
  stimulusSettledViews?: number;
  stimulusWindows?: StimulusWindow[];
  recentStimulusViews24h?: number;
  recentRealViews24h?: number;
  recentRealFavorites24h?: number;
  realViewsDayKey?: string;
  realViewsTodayCount?: number;
  realViewsPrevDayKey?: string;
  realViewsPrevDayCount?: number;
  realFavsDayKey?: string;
  realFavsTodayCount?: number;
  realFavsPrevDayKey?: string;
  realFavsPrevDayCount?: number;
  favoritesCount: number;
  realFavoritesCount?: number;
  stimulusLikesCount?: number;
  ratingAverage: number;
  ratingCount: number;
  realRatingAverage?: number;
  realRatingCount?: number;
  lastChapterPublishedAt?: unknown;
  launchedAt?: unknown;
  launchedFromPreLaunch?: boolean;
  previewEnabled?: boolean;
  previewSlug?: string;
  previewToken?: string;
  previewKey?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  // Runtime-computed catalog analytics (not persisted directly to Firestore)
  publishedChapters?: Chapter[];
  validMotionChaptersCount?: number;
  motionChapterRatio?: number;
  rankingScore?: number;
  tractionLabel?: TractionClassification;
}

export interface Chapter {
  id: string;
  mangaId: string;
  authorId: string;
  chapterNumber: number;
  title: string;
  status: ChapterStatus;
  hasMotion: boolean;
  pagesCount: number;
  viewsCount: number;
  realViewsCount?: number;
  stimulusViewsCount?: number;
  firstPublishedAt?: unknown;
  stimulusBudget?: number;
  stimulusSeed?: number;
  stimulusDurationHours?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChapterPage {
  id: string;
  mangaId: string;
  chapterId: string;
  authorId: string;
  chapterStatus: ChapterStatus;
  pageNumber: number;
  originalUrl: string;
  originalMime: string;
  motionUrl: string;
  motionMime: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChapterComment {
  id: string;
  mangaId: string;
  chapterId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  content: string;
  parentId?: string;
  replyToUserId?: string;
  replyToUserName?: string;
  isAuthorReply?: boolean;
  isHidden: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MangaRating {
  userId: string;
  mangaId: string;
  score: number;
  review: string;
  userName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FavoriteItem {
  userId: string;
  mangaId: string;
  mangaTitle: string;
  coverUrl: string;
  authorName: string;
  addedDuringPreLaunch?: boolean;
  previewKey?: string;
  createdAt?: unknown;
}

export interface ReadingHistoryItem {
  userId: string;
  mangaId: string;
  mangaTitle: string;
  coverUrl: string;
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  pageNumber: number;
  totalPages: number;
  preferredMode: ReaderMode;
  updatedAt?: unknown;
}

export interface FollowRelation {
  id: string;
  followerId: string;
  authorId: string;
  authorName: string;
  createdAt?: unknown;
}

export interface AppNotification {
  id: string;
  recipientId: string;
  actorId: string;
  actorName: string;
  type:
    | 'new_chapter'
    | 'pre_launch_release'
    | 'new_comment'
    | 'new_follower'
    | 'moderation'
    | 'manga_deleted'
    | 'account_removed'
    | 'monetization';
  title: string;
  message: string;
  linkMangaId: string;
  linkChapterId: string;
  isRead: boolean;
  createdAt?: unknown;
}

export interface MangaWishlistItem {
  userId: string;
  mangaId: string;
  authorId: string;
  addedDuringPreLaunch: boolean;
  previewKey?: string;
  createdAt?: unknown;
}

export interface MangaPreview {
  previewKey: string;
  previewSlug: string;
  mangaId: string;
  authorName: string;
  title: string;
  synopsis: string;
  coverUrl: string;
  bannerUrl: string;
  genres: string[];
  ageRating: AgeRating;
  status: MangaStatus;
  hasMotion: boolean;
  chaptersCount: number;
  favoritesCount: number;
  ratingAverage: number;
  ratingCount: number;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MangaPreviewChapter {
  id: string;
  mangaId: string;
  previewKey: string;
  chapterNumber: number;
  title: string;
  status: ChapterStatus;
  hasMotion: boolean;
  pagesCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MangaPreviewPage {
  id: string;
  mangaId: string;
  chapterId: string;
  previewKey: string;
  pageNumber: number;
  originalUrl: string;
  originalMime: string;
  motionUrl: string;
  motionMime: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ModerationReport {
  id: string;
  reporterId: string;
  reporterName: string;
  targetType: 'manga' | 'chapter' | 'comment' | 'user';
  targetId: string;
  mangaId: string;
  targetLabel: string;
  reason: 'copyright' | 'explicit_unmarked' | 'spam' | 'harassment' | 'broken_media' | 'other';
  details: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  resolutionNote: string;
  resolvedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
