// Firestore Security Rules TDD Suite for MANGA MOTION (Phase 0 Dirty Dozen)
// Intended for execution against the Firebase Emulator Suite (@firebase/rules-unit-testing).

export interface DirtyDozenCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'create' | 'update' | 'get' | 'list';
  authUid: string | null;
  emailVerified: boolean;
  email?: string;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Spoofed Manga Author',
    collectionPath: '/mangas/manga_1',
    operation: 'create',
    authUid: 'attacker_uid',
    emailVerified: true,
    payload: { id: 'manga_1', authorId: 'victim_uid', title: 'Hijacked' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Ghost Field Injection on User Profile',
    collectionPath: '/users/attacker_uid',
    operation: 'create',
    authUid: 'attacker_uid',
    emailVerified: true,
    payload: { uid: 'attacker_uid', displayName: 'Hacker', isAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Self-Suspension Bypass',
    collectionPath: '/users/suspended_uid',
    operation: 'update',
    authUid: 'suspended_uid',
    emailVerified: true,
    payload: { isSuspended: false },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-Chapter Page Poisoning',
    collectionPath: '/mangas/m1/chapters/c1/pages/p1',
    operation: 'create',
    authUid: 'creator_uid',
    emailVerified: true,
    payload: { id: 'p1', mangaId: 'm1', chapterId: 'c2', pageNumber: 1 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Unverified Admin Email Spoof',
    collectionPath: '/reports/r1',
    operation: 'update',
    authUid: 'spoof_uid',
    emailVerified: false,
    email: 'helciorodri@gmail.com',
    payload: { status: 'resolved' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'PII Leak Attempt on Private Info',
    collectionPath: '/users/victim_uid/private/info',
    operation: 'get',
    authUid: 'attacker_uid',
    emailVerified: true,
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Draft Manga Scraping',
    collectionPath: '/mangas/draft_manga_1',
    operation: 'get',
    authUid: 'other_user',
    emailVerified: true,
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Path Variable ID Poisoning',
    collectionPath: `/mangas/${'a'.repeat(300)}`,
    operation: 'create',
    authUid: 'creator_uid',
    emailVerified: true,
    payload: { id: 'a'.repeat(300) },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Client Timestamp Forgery',
    collectionPath: '/mangas/m_time',
    operation: 'create',
    authUid: 'creator_uid',
    emailVerified: true,
    payload: { id: 'm_time', authorId: 'creator_uid', createdAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Self-Moderation Override',
    collectionPath: '/mangas/m_flagged',
    operation: 'update',
    authUid: 'creator_uid',
    emailVerified: true,
    payload: { moderationStatus: 'approved', isFeatured: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Reporter Resolving Own Report',
    collectionPath: '/reports/r1',
    operation: 'update',
    authUid: 'reporter_uid',
    emailVerified: true,
    payload: { status: 'resolved' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Comment Impersonation',
    collectionPath: '/mangas/m1/chapters/c1/comments/cm1',
    operation: 'create',
    authUid: 'attacker_uid',
    emailVerified: true,
    payload: { id: 'cm1', mangaId: 'm1', chapterId: 'c1', userId: 'victim_uid', content: 'Fake' },
    expectedResult: 'PERMISSION_DENIED',
  },
];
