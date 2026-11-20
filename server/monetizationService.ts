import crypto from 'crypto';
import {
  AdminCreatorOption,
  AdminMangaOption,
  AdminMonetizationDashboard,
  AdminMonetizationOverview,
  CreatorMonetizationDashboard,
  MonetizationAttributionType,
  MonetizationConfirmationStatus,
  MonetizationCreatorBalance,
  MonetizationCreditReleaseBucket,
  MonetizationLedgerEntry,
  MonetizationPayoutPayment,
  MonetizationPayoutProfile,
  MonetizationPayoutRequest,
  MonetizationPixKeyType,
  MonetizationRevenue,
  MonetizationSettings,
  WorkPerformanceSummary,
} from '../src/types/monetization.ts';
import {
  CommitWriteOp,
  FirestoreRestError,
  FirestoreTimestamp,
  StoredDocSnapshot,
  commitFirestoreWrites,
  getFirestoreDocument,
  runFirestoreQuery,
} from './firestoreRest.ts';

export class MonetizationError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'MonetizationError';
    this.statusCode = statusCode;
  }
}

export interface ActorIdentity {
  uid: string;
  email: string;
  displayName?: string;
}

export interface MangaSummaryRecord {
  id: string;
  title: string;
  authorId: string;
  authorName: string;
  status: string;
  chaptersCount: number;
}

export interface ChapterSummaryRecord {
  id: string;
  mangaId: string;
  chapterNumber: number;
  title: string;
}

export interface UserSummaryRecord {
  uid: string;
  displayName: string;
  handle: string;
  accountType: string;
  worksCount: number;
}

export interface IdempotencyRecord {
  key: string;
  action: 'register_revenue' | 'confirm_revenue' | 'withdrawal' | 'pay_payout' | 'adjustment';
  actorId: string;
  createdAt?: string;
}

export interface MonetizationRepository {
  getSettings(): Promise<StoredDocSnapshot<MonetizationSettings> | null>;
  getPayoutProfile(creatorId: string): Promise<StoredDocSnapshot<MonetizationPayoutProfile> | null>;
  getBalance(creatorId: string): Promise<StoredDocSnapshot<MonetizationCreatorBalance> | null>;
  getRevenue(revenueId: string): Promise<StoredDocSnapshot<MonetizationRevenue> | null>;
  getLedgerEntry(entryId: string): Promise<StoredDocSnapshot<MonetizationLedgerEntry> | null>;
  getPayoutRequest(requestId: string): Promise<StoredDocSnapshot<MonetizationPayoutRequest> | null>;
  getIdempotency(key: string): Promise<StoredDocSnapshot<IdempotencyRecord> | null>;
  getManga(mangaId: string): Promise<StoredDocSnapshot<MangaSummaryRecord> | null>;
  getChapter(mangaId: string, chapterId: string): Promise<StoredDocSnapshot<ChapterSummaryRecord> | null>;
  getUserProfile(uid: string): Promise<StoredDocSnapshot<UserSummaryRecord> | null>;
  listRevenues(creatorId?: string): Promise<Array<StoredDocSnapshot<MonetizationRevenue>>>;
  listLedgerEntries(creatorId?: string): Promise<Array<StoredDocSnapshot<MonetizationLedgerEntry>>>;
  listPayoutRequests(creatorId?: string): Promise<Array<StoredDocSnapshot<MonetizationPayoutRequest>>>;
  listPayoutPayments(creatorId?: string): Promise<Array<StoredDocSnapshot<MonetizationPayoutPayment>>>;
  listBalances(): Promise<Array<StoredDocSnapshot<MonetizationCreatorBalance>>>;
  listAllUsers(): Promise<Array<StoredDocSnapshot<UserSummaryRecord>>>;
  listAllMangas(): Promise<Array<StoredDocSnapshot<MangaSummaryRecord>>>;
  commit(ops: CommitWriteOp[]): Promise<void>;
}

export class FirestoreMonetizationRepository implements MonetizationRepository {
  private readonly idToken: string;

  constructor(idToken: string) {
    this.idToken = idToken;
  }

  getSettings() {
    return getFirestoreDocument<MonetizationSettings>('monetization_settings', 'global', this.idToken);
  }

  getPayoutProfile(creatorId: string) {
    return getFirestoreDocument<MonetizationPayoutProfile>(
      'monetization_payout_profiles',
      creatorId,
      this.idToken
    );
  }

  getBalance(creatorId: string) {
    return getFirestoreDocument<MonetizationCreatorBalance>(
      'monetization_creator_balances',
      creatorId,
      this.idToken
    );
  }

  getRevenue(revenueId: string) {
    return getFirestoreDocument<MonetizationRevenue>(
      'monetization_revenues',
      revenueId,
      this.idToken
    );
  }

  getLedgerEntry(entryId: string) {
    return getFirestoreDocument<MonetizationLedgerEntry>(
      'monetization_ledger',
      entryId,
      this.idToken
    );
  }

  getPayoutRequest(requestId: string) {
    return getFirestoreDocument<MonetizationPayoutRequest>(
      'monetization_payout_requests',
      requestId,
      this.idToken
    );
  }

  getIdempotency(key: string) {
    return getFirestoreDocument<IdempotencyRecord>('monetization_idempotency', key, this.idToken);
  }

  getManga(mangaId: string) {
    return getFirestoreDocument<MangaSummaryRecord>('mangas', mangaId, this.idToken);
  }

  getChapter(mangaId: string, chapterId: string) {
    return getFirestoreDocument<ChapterSummaryRecord>(
      `mangas/${mangaId}/chapters`,
      chapterId,
      this.idToken
    );
  }

  getUserProfile(uid: string) {
    return getFirestoreDocument<UserSummaryRecord>('users', uid, this.idToken);
  }

  listRevenues(creatorId?: string) {
    return runFirestoreQuery<MonetizationRevenue>(
      'monetization_revenues',
      this.idToken,
      creatorId ? { field: 'creatorId', value: creatorId } : undefined
    );
  }

  listLedgerEntries(creatorId?: string) {
    return runFirestoreQuery<MonetizationLedgerEntry>(
      'monetization_ledger',
      this.idToken,
      creatorId ? { field: 'creatorId', value: creatorId } : undefined
    );
  }

  listPayoutRequests(creatorId?: string) {
    return runFirestoreQuery<MonetizationPayoutRequest>(
      'monetization_payout_requests',
      this.idToken,
      creatorId ? { field: 'creatorId', value: creatorId } : undefined
    );
  }

  listPayoutPayments(creatorId?: string) {
    return runFirestoreQuery<MonetizationPayoutPayment>(
      'monetization_payout_payments',
      this.idToken,
      creatorId ? { field: 'creatorId', value: creatorId } : undefined
    );
  }

  listBalances() {
    return runFirestoreQuery<MonetizationCreatorBalance>(
      'monetization_creator_balances',
      this.idToken
    );
  }

  listAllUsers() {
    return runFirestoreQuery<UserSummaryRecord>('users', this.idToken);
  }

  listAllMangas() {
    return runFirestoreQuery<MangaSummaryRecord>('mangas', this.idToken);
  }

  async commit(ops: CommitWriteOp[]) {
    try {
      await commitFirestoreWrites(ops, this.idToken);
    } catch (err) {
      if (err instanceof FirestoreRestError) {
        throw new MonetizationError(err.message, err.statusCode);
      }
      throw err;
    }
  }
}

// Per-key in-memory async mutex to prevent concurrent double-spend or duplicate requests on the Node instance
const keyLocks = new Map<string, Promise<void>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = keyLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  keyLocks.set(key, prev.then(() => current));

  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (keyLocks.get(key) === current) {
      keyLocks.delete(key);
    }
  }
}

export function generateMonetizationId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

export function sanitizeFirestoreId(raw: string): string {
  const clean = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 128);
  if (!clean) {
    throw new MonetizationError('Identificador inválido.', 400);
  }
  return clean;
}

export function computeRevenueSplit(
  netRevenueCents: number,
  artistPercent: number,
  attributionType: MonetizationAttributionType
): {
  artistPercentApplied: number;
  platformPercentApplied: number;
  artistShareCents: number;
  platformShareCents: number;
} {
  if (!Number.isInteger(netRevenueCents) || netRevenueCents <= 0) {
    throw new MonetizationError(
      'A receita líquida confirmada deve ser um valor inteiro em centavos maior que zero.',
      400
    );
  }

  if (attributionType === 'unattributed') {
    return {
      artistPercentApplied: 0,
      platformPercentApplied: 100,
      artistShareCents: 0,
      platformShareCents: netRevenueCents,
    };
  }

  if (!Number.isFinite(artistPercent) || artistPercent < 0 || artistPercent > 100) {
    throw new MonetizationError('Percentual de divisão do artista inválido.', 400);
  }

  const platformPercentApplied = Number((100 - artistPercent).toFixed(4));
  const artistShareCents = Math.round((netRevenueCents * artistPercent) / 100);
  const platformShareCents = netRevenueCents - artistShareCents;

  if (artistShareCents + platformShareCents !== netRevenueCents) {
    throw new MonetizationError('Falha na invariante da divisão monetária.', 500);
  }

  return {
    artistPercentApplied: artistPercent,
    platformPercentApplied,
    artistShareCents,
    platformShareCents,
  };
}

export function assertAccountingInvariant(balance: MonetizationCreatorBalance): void {
  const fields = [
    balance.totalEarnedCents,
    balance.pendingCents,
    balance.availableCents,
    balance.withdrawalPendingCents,
    balance.totalPaidCents,
  ];
  for (const val of fields) {
    if (!Number.isInteger(val) || val < 0) {
      throw new MonetizationError('Saldo financeiro inválido ou negativo detectado.', 409);
    }
  }
  const sum =
    balance.pendingCents +
    balance.availableCents +
    balance.withdrawalPendingCents +
    balance.totalPaidCents;
  if (balance.totalEarnedCents !== sum) {
    throw new MonetizationError(
      `Violação de invariante contábil: total acumulado (${balance.totalEarnedCents}) difere da soma dos saldos (${sum}).`,
      409
    );
  }
}

export function createEmptyBalance(creatorId: string): MonetizationCreatorBalance {
  return {
    creatorId,
    totalEarnedCents: 0,
    pendingCents: 0,
    availableCents: 0,
    withdrawalPendingCents: 0,
    totalPaidCents: 0,
    lastOperationId: '',
  };
}

export function getDefaultSettings(): MonetizationSettings {
  return {
    id: 'global',
    artistSharePercent: 70,
    platformSharePercent: 30,
    minWithdrawalCents: 5000,
    updatedBy: 'system',
    updatedAt: new Date(0).toISOString(),
  };
}

function sortByNewest<T extends { createdAt?: string; updatedAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const da = Date.parse(a.createdAt || a.updatedAt || '') || 0;
    const db = Date.parse(b.createdAt || b.updatedAt || '') || 0;
    return db - da;
  });
}

function buildNotificationWrite(params: {
  recipientId: string;
  actorId: string;
  actorName: string;
  title: string;
  message: string;
  linkMangaId?: string;
}): CommitWriteOp {
  const notifId = generateMonetizationId('notif_mon');
  return {
    collection: 'notifications',
    docId: notifId,
    serverTimestampFields: ['createdAt'],
    precondition: { exists: false },
    fields: {
      id: notifId,
      recipientId: params.recipientId,
      actorId: params.actorId,
      actorName: (params.actorName || 'MANGA MOTION').slice(0, 80),
      type: 'monetization',
      title: params.title.slice(0, 140),
      message: params.message.slice(0, 300),
      linkMangaId: (params.linkMangaId || '').slice(0, 128),
      linkChapterId: '',
      isRead: false,
    },
  };
}

export async function getSettingsOrDefault(
  repo: MonetizationRepository
): Promise<{ settings: MonetizationSettings; snapshot: StoredDocSnapshot<MonetizationSettings> | null }> {
  const snap = await repo.getSettings();
  return {
    settings: snap ? snap.data : getDefaultSettings(),
    snapshot: snap,
  };
}

export async function updateMonetizationSettings(
  repo: MonetizationRepository,
  admin: ActorIdentity,
  input: {
    artistSharePercent: number;
    minWithdrawalCents: number;
  }
): Promise<MonetizationSettings> {
  const artistPercent = Number(input.artistSharePercent);
  const minWithdrawalCents = Number(input.minWithdrawalCents);

  if (!Number.isInteger(artistPercent) || artistPercent < 0 || artistPercent > 100) {
    throw new MonetizationError(
      'O percentual do artista deve ser um número inteiro entre 0 e 100.',
      400
    );
  }
  if (
    !Number.isInteger(minWithdrawalCents) ||
    minWithdrawalCents < 100 ||
    minWithdrawalCents > 10000000
  ) {
    throw new MonetizationError(
      'O valor mínimo de saque deve estar entre R$ 1,00 (100 centavos) e R$ 100.000,00.',
      400
    );
  }

  return withLock('settings:global', async () => {
    const existing = await repo.getSettings();
    const platformSharePercent = 100 - artistPercent;
    const next: MonetizationSettings = {
      id: 'global',
      artistSharePercent: artistPercent,
      platformSharePercent,
      minWithdrawalCents,
      updatedBy: admin.uid,
    };

    await repo.commit([
      {
        collection: 'monetization_settings',
        docId: 'global',
        fields: next as unknown as Record<string, unknown>,
        serverTimestampFields: ['updatedAt'],
        precondition: existing?.updateTime ? { updateTime: existing.updateTime } : { exists: false },
      },
    ]);

    const refreshed = await repo.getSettings();
    return refreshed?.data || next;
  });
}

export async function saveCreatorPayoutProfile(
  repo: MonetizationRepository,
  creatorId: string,
  input: {
    beneficiaryName: string;
    pixKeyType: MonetizationPixKeyType;
    pixKey: string;
    pixBankName?: string;
  }
): Promise<MonetizationPayoutProfile> {
  const beneficiaryName = String(input.beneficiaryName || '').trim();
  const pixKey = String(input.pixKey || '').trim();
  const pixBankName = String(input.pixBankName || '').trim();
  const pixKeyType = input.pixKeyType;

  const allowedTypes: MonetizationPixKeyType[] = ['cpf', 'cnpj', 'email', 'phone', 'random'];
  if (!allowedTypes.includes(pixKeyType)) {
    throw new MonetizationError('Tipo de chave Pix inválido.', 400);
  }
  if (beneficiaryName.length < 2 || beneficiaryName.length > 120) {
    throw new MonetizationError('Nome completo do favorecido é obrigatório (2 a 120 caracteres).', 400);
  }
  if (pixKey.length < 3 || pixKey.length > 140) {
    throw new MonetizationError('Chave Pix inválida (3 a 140 caracteres).', 400);
  }
  if (pixBankName.length > 80) {
    throw new MonetizationError('Nome da instituição financeira deve ter até 80 caracteres.', 400);
  }

  const profile: MonetizationPayoutProfile = {
    creatorId,
    beneficiaryName,
    pixKeyType,
    pixKey,
    pixBankName,
  };

  const existing = await repo.getPayoutProfile(creatorId);
  await repo.commit([
    {
      collection: 'monetization_payout_profiles',
      docId: creatorId,
      fields: profile as unknown as Record<string, unknown>,
      serverTimestampFields: ['updatedAt'],
      precondition: existing?.updateTime ? { updateTime: existing.updateTime } : { exists: false },
    },
  ]);

  const refreshed = await repo.getPayoutProfile(creatorId);
  return refreshed?.data || profile;
}

export async function getCreatorMonetizationDashboard(
  repo: MonetizationRepository,
  creatorId: string
): Promise<CreatorMonetizationDashboard> {
  const [settingsRes, balanceSnap, profileSnap, revSnaps, ledgerSnaps, reqSnaps, paySnaps] =
    await Promise.all([
      getSettingsOrDefault(repo),
      repo.getBalance(creatorId),
      repo.getPayoutProfile(creatorId),
      repo.listRevenues(creatorId),
      repo.listLedgerEntries(creatorId),
      repo.listPayoutRequests(creatorId),
      repo.listPayoutPayments(creatorId),
    ]);

  const balance = balanceSnap?.data || createEmptyBalance(creatorId);
  const revenues = sortByNewest(revSnaps.map((s) => s.data));
  const ledger = sortByNewest(ledgerSnaps.map((s) => s.data));
  const payoutRequests = sortByNewest(reqSnaps.map((s) => s.data));
  const payments = sortByNewest(paySnaps.map((s) => s.data));

  // Pending artist credits from ledger (so creator sees which works have credits awaiting release)
  const pendingCreditByManga = new Map<string, number>();
  for (const entry of ledger) {
    if (entry.type === 'revenue_credit' && entry.status === 'pending' && entry.mangaId) {
      pendingCreditByManga.set(
        entry.mangaId,
        (pendingCreditByManga.get(entry.mangaId) || 0) + entry.amountCents
      );
    }
  }

  const workMap = new Map<string, WorkPerformanceSummary>();
  for (const rev of revenues) {
    if (rev.attributionType !== 'work' || !rev.mangaId) continue;
    const current = workMap.get(rev.mangaId) || {
      mangaId: rev.mangaId,
      mangaTitle: rev.mangaTitle || rev.mangaId,
      confirmedNetRevenueCents: 0,
      artistShareCents: 0,
      pendingArtistShareCents: pendingCreditByManga.get(rev.mangaId) || 0,
      unconfirmedRevenueCents: 0,
      entriesCount: 0,
    };
    current.entriesCount += 1;
    if (rev.confirmationStatus === 'confirmed') {
      current.confirmedNetRevenueCents += rev.netRevenueCents;
      current.artistShareCents += rev.artistShareCents;
    } else if (rev.confirmationStatus === 'pending') {
      current.unconfirmedRevenueCents += rev.netRevenueCents;
    }
    workMap.set(rev.mangaId, current);
  }

  const workPerformance = Array.from(workMap.values()).sort(
    (a, b) => b.artistShareCents - a.artistShareCents
  );

  return {
    settings: settingsRes.settings,
    balance,
    payoutProfile: profileSnap?.data || null,
    workPerformance,
    revenues,
    ledger,
    payoutRequests,
    payments,
  };
}

export async function requestCreatorWithdrawal(
  repo: MonetizationRepository,
  creator: ActorIdentity,
  input: {
    amountCents: number;
    idempotencyKey?: string;
  }
): Promise<MonetizationPayoutRequest> {
  const amountCents = Number(input.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new MonetizationError('Informe um valor válido para saque.', 400);
  }

  const cleanIdemp = input.idempotencyKey ? sanitizeFirestoreId(input.idempotencyKey) : '';

  return withLock(`creator:${creator.uid}`, async () => {
    if (cleanIdemp) {
      const existingIdemp = await repo.getIdempotency(cleanIdemp);
      if (existingIdemp) {
        throw new MonetizationError('Solicitação de saque duplicada bloqueada (idempotência).', 409);
      }
    }

    const [settingsRes, profileSnap, balanceSnap, userSnap] = await Promise.all([
      getSettingsOrDefault(repo),
      repo.getPayoutProfile(creator.uid),
      repo.getBalance(creator.uid),
      repo.getUserProfile(creator.uid),
    ]);

    if (!profileSnap) {
      throw new MonetizationError(
        'Cadastre seus dados e chave Pix antes de solicitar um saque.',
        400
      );
    }

    if (!balanceSnap) {
      throw new MonetizationError('Saldo disponível insuficiente para saque.', 400);
    }

    const balance = balanceSnap.data;
    assertAccountingInvariant(balance);

    const minCents = settingsRes.settings.minWithdrawalCents;
    if (amountCents < minCents) {
      throw new MonetizationError(
        `O valor mínimo para solicitação de saque é de R$ ${(minCents / 100).toFixed(2).replace('.', ',')}.`,
        400
      );
    }

    if (amountCents > balance.availableCents) {
      throw new MonetizationError(
        'Valor solicitado excede o seu saldo disponível para saque.',
        400
      );
    }

    const requestId = generateMonetizationId('req');
    const ledgerEntryId = generateMonetizationId('led');
    const creatorName = (
      userSnap?.data.displayName ||
      creator.displayName ||
      profileSnap.data.beneficiaryName ||
      'Criador'
    ).slice(0, 80);

    const nextBalance: MonetizationCreatorBalance = {
      creatorId: creator.uid,
      totalEarnedCents: balance.totalEarnedCents,
      pendingCents: balance.pendingCents,
      availableCents: balance.availableCents - amountCents,
      withdrawalPendingCents: balance.withdrawalPendingCents + amountCents,
      totalPaidCents: balance.totalPaidCents,
      lastOperationId: requestId,
    };
    assertAccountingInvariant(nextBalance);

    const payoutRequest: MonetizationPayoutRequest = {
      id: requestId,
      creatorId: creator.uid,
      creatorName,
      amountCents,
      beneficiaryNameSnapshot: profileSnap.data.beneficiaryName,
      pixKeyTypeSnapshot: profileSnap.data.pixKeyType,
      pixKeySnapshot: profileSnap.data.pixKey,
      pixBankNameSnapshot: profileSnap.data.pixBankName || '',
      status: 'pending',
      ledgerEntryId,
      reviewedBy: '',
      reviewNote: '',
      reviewedAt: '',
      paidAt: '',
      paymentId: '',
    };

    const ledgerEntry: MonetizationLedgerEntry = {
      id: ledgerEntryId,
      type: 'withdrawal_hold',
      creatorId: creator.uid,
      creatorName,
      mangaId: '',
      mangaTitle: '',
      chapterId: '',
      amountCents: -amountCents,
      artistPercentApplied: 0,
      platformPercentApplied: 0,
      origin: 'Solicitação de saque Pix',
      status: 'pending',
      originalEntryId: '',
      relatedRevenueId: '',
      relatedRequestId: requestId,
      relatedPaymentId: '',
      justification: `Reserva de saldo para saque Pix (${profileSnap.data.pixKeyType.toUpperCase()})`,
      createdBy: creator.uid,
    };

    const writes: CommitWriteOp[] = [];
    if (cleanIdemp) {
      writes.push({
        collection: 'monetization_idempotency',
        docId: cleanIdemp,
        serverTimestampFields: ['createdAt'],
        precondition: { exists: false },
        fields: {
          key: cleanIdemp,
          action: 'withdrawal',
          actorId: creator.uid,
        },
      });
    }

    writes.push(
      {
        collection: 'monetization_creator_balances',
        docId: creator.uid,
        fields: nextBalance as unknown as Record<string, unknown>,
        serverTimestampFields: ['updatedAt'],
        precondition: balanceSnap.updateTime ? { updateTime: balanceSnap.updateTime } : { exists: true },
      },
      {
        collection: 'monetization_payout_requests',
        docId: requestId,
        fields: payoutRequest as unknown as Record<string, unknown>,
        serverTimestampFields: ['createdAt', 'updatedAt'],
        precondition: { exists: false },
      },
      {
        collection: 'monetization_ledger',
        docId: ledgerEntryId,
        fields: ledgerEntry as unknown as Record<string, unknown>,
        serverTimestampFields: ['createdAt'],
        precondition: { exists: false },
      }
    );

    await repo.commit(writes);
    const created = await repo.getPayoutRequest(requestId);
    return created?.data || payoutRequest;
  });
}

export interface RegisterRevenueInput {
  attributionType: MonetizationAttributionType;
  mangaId?: string;
  chapterId?: string;
  referencePeriod: string;
  adImpressions?: number | null;
  grossRevenueCents?: number | null;
  networkDeductionsCents?: number | null;
  netRevenueCents: number;
  releaseBucket?: MonetizationCreditReleaseBucket;
  source: string;
  externalRef?: string;
  notes?: string;
  confirmImmediately?: boolean;
  idempotencyKey?: string;
}

export async function registerAdRevenue(
  repo: MonetizationRepository,
  admin: ActorIdentity,
  input: RegisterRevenueInput
): Promise<MonetizationRevenue> {
  const attributionType: MonetizationAttributionType =
    input.attributionType === 'unattributed' ? 'unattributed' : 'work';
  const referencePeriod = String(input.referencePeriod || '').trim();
  const source = String(input.source || '').trim();
  const externalRef = String(input.externalRef || '').trim();
  const notes = String(input.notes || '').trim();
  const netRevenueCents = Number(input.netRevenueCents);
  const releaseBucket: MonetizationCreditReleaseBucket =
    input.releaseBucket === 'pending' ? 'pending' : 'available';
  const confirmImmediately = input.confirmImmediately !== false;

  if (!referencePeriod || referencePeriod.length > 64) {
    throw new MonetizationError('Informe o período de referência (ex.: 2026-11).', 400);
  }
  if (!source || source.length > 80) {
    throw new MonetizationError('Informe a fonte dos dados publicitários.', 400);
  }
  if (!Number.isInteger(netRevenueCents) || netRevenueCents <= 0) {
    throw new MonetizationError(
      'A receita líquida real recebida deve ser maior que zero (em centavos inteiros). Não converta visualizações em receita fictícia.',
      400
    );
  }

  const hasAdImpressions =
    input.adImpressions !== undefined &&
    input.adImpressions !== null &&
    Number.isFinite(Number(input.adImpressions));
  const adImpressions = hasAdImpressions ? Math.max(0, Math.round(Number(input.adImpressions))) : 0;

  const hasGrossRevenue =
    input.grossRevenueCents !== undefined &&
    input.grossRevenueCents !== null &&
    Number.isFinite(Number(input.grossRevenueCents));
  const grossRevenueCents = hasGrossRevenue ? Math.max(0, Math.round(Number(input.grossRevenueCents))) : 0;

  const hasNetworkDeductions =
    input.networkDeductionsCents !== undefined &&
    input.networkDeductionsCents !== null &&
    Number.isFinite(Number(input.networkDeductionsCents));
  const networkDeductionsCents = hasNetworkDeductions
    ? Math.max(0, Math.round(Number(input.networkDeductionsCents)))
    : 0;

  const cleanIdemp = input.idempotencyKey ? sanitizeFirestoreId(input.idempotencyKey) : '';
  const mangaIdInput = attributionType === 'work' ? String(input.mangaId || '').trim() : '';
  const chapterIdInput = attributionType === 'work' ? String(input.chapterId || '').trim() : '';

  if (attributionType === 'work' && !mangaIdInput) {
    throw new MonetizationError(
      'Selecione uma obra para atribuir a receita ou marque como receita não atribuída.',
      400
    );
  }

  let mangaTitle = '';
  let creatorId = '';
  let creatorName = '';
  let chapterNumber = 0;

  if (attributionType === 'work') {
    const mangaSnap = await repo.getManga(mangaIdInput);
    if (!mangaSnap) {
      throw new MonetizationError('Obra selecionada não encontrada.', 404);
    }
    mangaTitle = mangaSnap.data.title;
    creatorId = mangaSnap.data.authorId;
    creatorName = mangaSnap.data.authorName;

    if (chapterIdInput) {
      const chSnap = await repo.getChapter(mangaIdInput, chapterIdInput);
      if (!chSnap) {
        throw new MonetizationError('Capítulo selecionado não pertence à obra informada.', 404);
      }
      chapterNumber = chSnap.data.chapterNumber;
    }
  }

  const lockKey = creatorId ? `creator:${creatorId}` : 'revenue:unattributed';

  return withLock(lockKey, async () => {
    if (cleanIdemp) {
      const existingIdemp = await repo.getIdempotency(cleanIdemp);
      if (existingIdemp) {
        throw new MonetizationError('Lançamento duplicado bloqueado por chave de idempotência.', 409);
      }
    }

    if (externalRef) {
      const existingRevs = await repo.listRevenues();
      const dup = existingRevs.find(
        (r) =>
          r.data.confirmationStatus !== 'cancelled' &&
          r.data.externalRef === externalRef &&
          r.data.source === source
      );
      if (dup) {
        throw new MonetizationError(
          `Já existe lançamento ativo com a referência externa "${externalRef}" para a fonte "${source}".`,
          409
        );
      }
    }

    const { settings } = await getSettingsOrDefault(repo);
    const revenueId = generateMonetizationId('rev');
    const nowIso = new Date().toISOString();

    const split = confirmImmediately
      ? computeRevenueSplit(netRevenueCents, settings.artistSharePercent, attributionType)
      : {
          artistPercentApplied: 0,
          platformPercentApplied: 0,
          artistShareCents: 0,
          platformShareCents: 0,
        };

    const revenueDoc: MonetizationRevenue = {
      id: revenueId,
      attributionType,
      mangaId: mangaIdInput,
      mangaTitle: mangaTitle.slice(0, 140),
      creatorId,
      creatorName: creatorName.slice(0, 80),
      chapterId: chapterIdInput,
      chapterNumber,
      referencePeriod,
      adImpressions,
      hasAdImpressions,
      grossRevenueCents,
      hasGrossRevenue,
      networkDeductionsCents,
      hasNetworkDeductions,
      netRevenueCents,
      artistPercentApplied: split.artistPercentApplied,
      platformPercentApplied: split.platformPercentApplied,
      artistShareCents: split.artistShareCents,
      platformShareCents: split.platformShareCents,
      releaseBucket,
      source,
      externalRef: externalRef.slice(0, 120),
      notes: notes.slice(0, 500),
      confirmationStatus: confirmImmediately ? 'confirmed' : 'pending',
      recordedBy: admin.uid,
      confirmedBy: confirmImmediately ? admin.uid : '',
      confirmedAt: confirmImmediately ? nowIso : '',
    };

    const writes: CommitWriteOp[] = [];
    if (cleanIdemp) {
      writes.push({
        collection: 'monetization_idempotency',
        docId: cleanIdemp,
        serverTimestampFields: ['createdAt'],
        precondition: { exists: false },
        fields: {
          key: cleanIdemp,
          action: 'register_revenue',
          actorId: admin.uid,
        },
      });
    }

    writes.push({
      collection: 'monetization_revenues',
      docId: revenueId,
      fields: revenueDoc as unknown as Record<string, unknown>,
      serverTimestampFields: ['importedAt', 'createdAt', 'updatedAt'],
      precondition: { exists: false },
    });

    if (confirmImmediately) {
      await appendConfirmedSplitWrites({
        repo,
        writes,
        revenue: revenueDoc,
        split,
        releaseBucket,
        admin,
      });
    }

    await repo.commit(writes);
    const saved = await repo.getRevenue(revenueId);
    return saved?.data || revenueDoc;
  });
}

async function appendConfirmedSplitWrites(params: {
  repo: MonetizationRepository;
  writes: CommitWriteOp[];
  revenue: MonetizationRevenue;
  split: {
    artistPercentApplied: number;
    platformPercentApplied: number;
    artistShareCents: number;
    platformShareCents: number;
  };
  releaseBucket: MonetizationCreditReleaseBucket;
  admin: ActorIdentity;
}): Promise<void> {
  const { repo, writes, revenue, split, releaseBucket, admin } = params;

  if (revenue.attributionType === 'unattributed' || !revenue.creatorId) {
    const ledId = generateMonetizationId('led');
    const unattributedEntry: MonetizationLedgerEntry = {
      id: ledId,
      type: 'unattributed_revenue',
      creatorId: '',
      creatorName: '',
      mangaId: '',
      mangaTitle: 'Receita não atribuída',
      chapterId: '',
      amountCents: revenue.netRevenueCents,
      artistPercentApplied: 0,
      platformPercentApplied: 100,
      origin: `${revenue.source} (${revenue.referencePeriod})`,
      status: 'completed',
      originalEntryId: '',
      relatedRevenueId: revenue.id,
      relatedRequestId: '',
      relatedPaymentId: '',
      justification:
        revenue.notes ||
        'Receita publicitária sem atribuição confiável por obra nesta importação.',
      createdBy: admin.uid,
    };
    writes.push({
      collection: 'monetization_ledger',
      docId: ledId,
      fields: unattributedEntry as unknown as Record<string, unknown>,
      serverTimestampFields: ['createdAt'],
      precondition: { exists: false },
    });
    return;
  }

  const balanceSnap = await repo.getBalance(revenue.creatorId);
  const currentBalance = balanceSnap?.data || createEmptyBalance(revenue.creatorId);
  assertAccountingInvariant(currentBalance);

  const artistLedId = generateMonetizationId('led');
  const platformLedId = generateMonetizationId('led');

  const nextBalance: MonetizationCreatorBalance = {
    creatorId: revenue.creatorId,
    totalEarnedCents: currentBalance.totalEarnedCents + split.artistShareCents,
    pendingCents:
      currentBalance.pendingCents + (releaseBucket === 'pending' ? split.artistShareCents : 0),
    availableCents:
      currentBalance.availableCents + (releaseBucket === 'available' ? split.artistShareCents : 0),
    withdrawalPendingCents: currentBalance.withdrawalPendingCents,
    totalPaidCents: currentBalance.totalPaidCents,
    lastOperationId: artistLedId,
  };
  assertAccountingInvariant(nextBalance);

  const artistEntry: MonetizationLedgerEntry = {
    id: artistLedId,
    type: 'revenue_credit',
    creatorId: revenue.creatorId,
    creatorName: revenue.creatorName,
    mangaId: revenue.mangaId,
    mangaTitle: revenue.mangaTitle,
    chapterId: revenue.chapterId,
    amountCents: split.artistShareCents,
    artistPercentApplied: split.artistPercentApplied,
    platformPercentApplied: split.platformPercentApplied,
    origin: `${revenue.source} (${revenue.referencePeriod})`,
    status: releaseBucket === 'pending' ? 'pending' : 'available',
    originalEntryId: '',
    relatedRevenueId: revenue.id,
    relatedRequestId: '',
    relatedPaymentId: '',
    justification: `Repasse ${split.artistPercentApplied}% sobre receita confirmada de "${revenue.mangaTitle}"`,
    createdBy: admin.uid,
  };

  const platformEntry: MonetizationLedgerEntry = {
    id: platformLedId,
    type: 'platform_fee',
    creatorId: revenue.creatorId,
    creatorName: revenue.creatorName,
    mangaId: revenue.mangaId,
    mangaTitle: revenue.mangaTitle,
    chapterId: revenue.chapterId,
    amountCents: split.platformShareCents,
    artistPercentApplied: split.artistPercentApplied,
    platformPercentApplied: split.platformPercentApplied,
    origin: `${revenue.source} (${revenue.referencePeriod})`,
    status: 'completed',
    originalEntryId: '',
    relatedRevenueId: revenue.id,
    relatedRequestId: '',
    relatedPaymentId: '',
    justification: `Taxa da plataforma ${split.platformPercentApplied}% sobre receita confirmada de "${revenue.mangaTitle}"`,
    createdBy: admin.uid,
  };

  writes.push(
    {
      collection: 'monetization_creator_balances',
      docId: revenue.creatorId,
      fields: nextBalance as unknown as Record<string, unknown>,
      serverTimestampFields: ['updatedAt'],
      precondition: balanceSnap?.updateTime
        ? { updateTime: balanceSnap.updateTime }
        : { exists: false },
    },
    {
      collection: 'monetization_ledger',
      docId: artistLedId,
      fields: artistEntry as unknown as Record<string, unknown>,
      serverTimestampFields: ['createdAt'],
      precondition: { exists: false },
    },
    {
      collection: 'monetization_ledger',
      docId: platformLedId,
      fields: platformEntry as unknown as Record<string, unknown>,
      serverTimestampFields: ['createdAt'],
      precondition: { exists: false },
    },
    buildNotificationWrite({
      recipientId: revenue.creatorId,
      actorId: admin.uid,
      actorName: admin.displayName || 'MANGA MOTION',
      title: 'Nova receita confirmada na sua obra',
      message: `${revenue.mangaTitle} (${revenue.referencePeriod}): crédito de R$ ${(split.artistShareCents / 100).toFixed(2).replace('.', ',')} (${split.artistPercentApplied}%).`,
      linkMangaId: revenue.mangaId,
    })
  );
}

export async function confirmPendingRevenue(
  repo: MonetizationRepository,
  admin: ActorIdentity,
  input: {
    revenueId: string;
    releaseBucket?: MonetizationCreditReleaseBucket;
    idempotencyKey?: string;
  }
): Promise<MonetizationRevenue> {
  const revenueId = sanitizeFirestoreId(input.revenueId);
  const cleanIdemp = input.idempotencyKey ? sanitizeFirestoreId(input.idempotencyKey) : `conf_${revenueId}`;

  return withLock(`revenue:${revenueId}`, async () => {
    const [existingIdemp, revSnap] = await Promise.all([
      repo.getIdempotency(cleanIdemp),
      repo.getRevenue(revenueId),
    ]);

    if (existingIdemp) {
      throw new MonetizationError('Esta receita já foi confirmada anteriormente.', 409);
    }
    if (!revSnap) {
      throw new MonetizationError('Lançamento de receita não encontrado.', 404);
    }

    const rev = revSnap.data;
    if (rev.confirmationStatus !== 'pending') {
      throw new MonetizationError(
        `Receita já está com status "${rev.confirmationStatus}" e não pode ser confirmada novamente.`,
        409
      );
    }

    const lockCreatorKey = rev.creatorId ? `creator:${rev.creatorId}` : 'revenue:unattributed';
    return withLock(lockCreatorKey, async () => {
      const { settings } = await getSettingsOrDefault(repo);
      const releaseBucket = input.releaseBucket || rev.releaseBucket || 'available';
      const split = computeRevenueSplit(
        rev.netRevenueCents,
        settings.artistSharePercent,
        rev.attributionType
      );
      const nowIso = new Date().toISOString();

      const updatedRevenue: MonetizationRevenue = {
        ...rev,
        artistPercentApplied: split.artistPercentApplied,
        platformPercentApplied: split.platformPercentApplied,
        artistShareCents: split.artistShareCents,
        platformShareCents: split.platformShareCents,
        releaseBucket,
        confirmationStatus: 'confirmed',
        confirmedBy: admin.uid,
        confirmedAt: nowIso,
      };

      const writes: CommitWriteOp[] = [
        {
          collection: 'monetization_idempotency',
          docId: cleanIdemp,
          serverTimestampFields: ['createdAt'],
          precondition: { exists: false },
          fields: {
            key: cleanIdemp,
            action: 'confirm_revenue',
            actorId: admin.uid,
          },
        },
        {
          collection: 'monetization_revenues',
          docId: revenueId,
          fields: {
            ...updatedRevenue,
            importedAt: new FirestoreTimestamp(rev.importedAt || nowIso),
            createdAt: new FirestoreTimestamp(rev.createdAt || nowIso),
          } as unknown as Record<string, unknown>,
          serverTimestampFields: ['updatedAt'],
          precondition: revSnap.updateTime ? { updateTime: revSnap.updateTime } : { exists: true },
        },
      ];

      await appendConfirmedSplitWrites({
        repo,
        writes,
        revenue: updatedRevenue,
        split,
        releaseBucket,
        admin,
      });

      await repo.commit(writes);
      const refreshed = await repo.getRevenue(revenueId);
      return refreshed?.data || updatedRevenue;
    });
  });
}

export async function cancelPendingRevenue(
  repo: MonetizationRepository,
  admin: ActorIdentity,
  revenueIdRaw: string,
  reason: string
): Promise<MonetizationRevenue> {
  const revenueId = sanitizeFirestoreId(revenueIdRaw);
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 3) {
    throw new MonetizationError('Informe uma justificativa para cancelar a receita pendente.', 400);
  }

  return withLock(`revenue:${revenueId}`, async () => {
    const revSnap = await repo.getRevenue(revenueId);
    if (!revSnap) {
      throw new MonetizationError('Lançamento de receita não encontrado.', 404);
    }
    const rev = revSnap.data;
    if (rev.confirmationStatus !== 'pending') {
      throw new MonetizationError(
        'Apenas receitas ainda não confirmadas (pendentes) podem ser canceladas.',
        409
      );
    }

    const updatedRevenue: MonetizationRevenue = {
      ...rev,
      confirmationStatus: 'cancelled',
      notes: `${rev.notes ? rev.notes + ' | ' : ''}Cancelado (${admin.uid}): ${cleanReason}`.slice(
        0,
        500
      ),
    };

    const nowIso = new Date().toISOString();
    await repo.commit([
      {
        collection: 'monetization_revenues',
        docId: revenueId,
        fields: {
          ...updatedRevenue,
          importedAt: new FirestoreTimestamp(rev.importedAt || nowIso),
          createdAt: new FirestoreTimestamp(rev.createdAt || nowIso),
        } as unknown as Record<string, unknown>,
        serverTimestampFields: ['updatedAt'],
        precondition: revSnap.updateTime ? { updateTime: revSnap.updateTime } : { exists: true },
      },
    ]);

    const refreshed = await repo.getRevenue(revenueId);
    return refreshed?.data || updatedRevenue;
  });
}

export async function releasePendingLedgerCredit(
  repo: MonetizationRepository,
  admin: ActorIdentity,
  ledgerEntryIdRaw: string
): Promise<MonetizationCreatorBalance> {
  const entryId = sanitizeFirestoreId(ledgerEntryIdRaw);

  return withLock(`ledger:${entryId}`, async () => {
    const entrySnap = await repo.getLedgerEntry(entryId);
    if (!entrySnap) {
      throw new MonetizationError('Lançamento no razão não encontrado.', 404);
    }
    const entry = entrySnap.data;
    if (entry.type !== 'revenue_credit' || entry.status !== 'pending' || !entry.creatorId) {
      throw new MonetizationError(
        'Somente créditos de receita em status pendente podem ser liberados para saque.',
        409
      );
    }

    return withLock(`creator:${entry.creatorId}`, async () => {
      const balanceSnap = await repo.getBalance(entry.creatorId);
      if (!balanceSnap) {
        throw new MonetizationError('Saldo do artista não encontrado.', 404);
      }
      const balance = balanceSnap.data;
      assertAccountingInvariant(balance);

      if (balance.pendingCents < entry.amountCents) {
        throw new MonetizationError(
          'Saldo pendente insuficiente para liberar este lançamento.',
          409
        );
      }

      const releaseLedId = generateMonetizationId('led');
      const nextBalance: MonetizationCreatorBalance = {
        creatorId: entry.creatorId,
        totalEarnedCents: balance.totalEarnedCents,
        pendingCents: balance.pendingCents - entry.amountCents,
        availableCents: balance.availableCents + entry.amountCents,
        withdrawalPendingCents: balance.withdrawalPendingCents,
        totalPaidCents: balance.totalPaidCents,
        lastOperationId: releaseLedId,
      };
      assertAccountingInvariant(nextBalance);

      const releaseEntry: MonetizationLedgerEntry = {
        id: releaseLedId,
        type: 'pending_release',
        creatorId: entry.creatorId,
        creatorName: entry.creatorName,
        mangaId: entry.mangaId,
        mangaTitle: entry.mangaTitle,
        chapterId: entry.chapterId,
        amountCents: entry.amountCents,
        artistPercentApplied: entry.artistPercentApplied,
        platformPercentApplied: entry.platformPercentApplied,
        origin: 'Liberação de saldo pendente',
        status: 'available',
        originalEntryId: entry.id,
        relatedRevenueId: entry.relatedRevenueId,
        relatedRequestId: '',
        relatedPaymentId: '',
        justification: 'Liberação administrativa para saldo disponível de saque.',
        createdBy: admin.uid,
      };

      const writes: CommitWriteOp[] = [
        {
          collection: 'monetization_ledger',
          docId: entry.id,
          fields: {
            ...entry,
            status: 'released',
            createdAt: new FirestoreTimestamp(entry.createdAt || new Date().toISOString()),
          } as unknown as Record<string, unknown>,
          precondition: entrySnap.updateTime ? { updateTime: entrySnap.updateTime } : { exists: true },
        },
        {
          collection: 'monetization_ledger',
          docId: releaseLedId,
          fields: releaseEntry as unknown as Record<string, unknown>,
          serverTimestampFields: ['createdAt'],
          precondition: { exists: false },
        },
        {
          collection: 'monetization_creator_balances',
          docId: entry.creatorId,
          fields: nextBalance as unknown as Record<string, unknown>,
          serverTimestampFields: ['updatedAt'],
          precondition: balanceSnap.updateTime
            ? { updateTime: balanceSnap.updateTime }
            : { exists: true },
        },
        buildNotificationWrite({
          recipientId: entry.creatorId,
          actorId: admin.uid,
          actorName: admin.displayName || 'MANGA MOTION',
          title: 'Saldo liberado para saque',
          message: `O crédito de R$ ${(entry.amountCents / 100).toFixed(2).replace('.', ',')} referente a ${entry.mangaTitle || 'sua obra'} foi liberado para saque.`,
          linkMangaId: entry.mangaId,
        }),
      ];

      await repo.commit(writes);
      return nextBalance;
    });
  });
}

export async function reviewPayoutRequest(
  repo: MonetizationRepository,
  admin: ActorIdentity,
  input: {
    requestId: string;
    decision: 'approve' | 'reject';
    reviewNote?: string;
  }
): Promise<MonetizationPayoutRequest> {
  const requestId = sanitizeFirestoreId(input.requestId);
  const reviewNote = String(input.reviewNote || '').trim();

  if (input.decision !== 'approve' && input.decision !== 'reject') {
    throw new MonetizationError('Decisão de análise inválida.', 400);
  }
  if (input.decision === 'reject' && reviewNote.length < 3) {
    throw new MonetizationError(
      'Informe o motivo da rejeição para registrar no histórico do criador.',
      400
    );
  }

  return withLock(`request:${requestId}`, async () => {
    const reqSnap = await repo.getPayoutRequest(requestId);
    if (!reqSnap) {
      throw new MonetizationError('Solicitação de saque não encontrada.', 404);
    }
    const req = reqSnap.data;

    return withLock(`creator:${req.creatorId}`, async () => {
      const nowIso = new Date().toISOString();

      if (input.decision === 'approve') {
        if (req.status !== 'pending') {
          throw new MonetizationError(
            `Somente solicitações aguardando análise podem ser aprovadas (status atual: ${req.status}).`,
            409
          );
        }

        const updated: MonetizationPayoutRequest = {
          ...req,
          status: 'approved',
          reviewedBy: admin.uid,
          reviewNote: (reviewNote || 'Aprovado para pagamento manual via Pix.').slice(0, 500),
          reviewedAt: nowIso,
        };

        await repo.commit([
          {
            collection: 'monetization_payout_requests',
            docId: req.id,
            fields: {
              ...updated,
              createdAt: new FirestoreTimestamp(req.createdAt || nowIso),
            } as unknown as Record<string, unknown>,
            serverTimestampFields: ['updatedAt'],
            precondition: reqSnap.updateTime ? { updateTime: reqSnap.updateTime } : { exists: true },
          },
          buildNotificationWrite({
            recipientId: req.creatorId,
            actorId: admin.uid,
            actorName: admin.displayName || 'MANGA MOTION',
            title: 'Solicitação de saque aprovada',
            message: `Seu saque de R$ ${(req.amountCents / 100).toFixed(2).replace('.', ',')} foi aprovado e aguarda pagamento manual via Pix.`,
          }),
        ]);

        const refreshed = await repo.getPayoutRequest(req.id);
        return refreshed?.data || updated;
      }

      // Reject decision
      if (req.status !== 'pending' && req.status !== 'approved') {
        throw new MonetizationError(
          `Não é possível rejeitar uma solicitação com status "${req.status}".`,
          409
        );
      }

      const balanceSnap = await repo.getBalance(req.creatorId);
      if (!balanceSnap) {
        throw new MonetizationError('Saldo do criador não encontrado.', 404);
      }
      const balance = balanceSnap.data;
      assertAccountingInvariant(balance);

      if (balance.withdrawalPendingCents < req.amountCents) {
        throw new MonetizationError(
          'Inconsistência: saldo em análise de saque menor que o valor da solicitação.',
          409
        );
      }

      const releaseLedId = generateMonetizationId('led');
      const nextBalance: MonetizationCreatorBalance = {
        creatorId: req.creatorId,
        totalEarnedCents: balance.totalEarnedCents,
        pendingCents: balance.pendingCents,
        availableCents: balance.availableCents + req.amountCents,
        withdrawalPendingCents: balance.withdrawalPendingCents - req.amountCents,
        totalPaidCents: balance.totalPaidCents,
        lastOperationId: releaseLedId,
      };
      assertAccountingInvariant(nextBalance);

      const updated: MonetizationPayoutRequest = {
        ...req,
        status: 'rejected',
        reviewedBy: admin.uid,
        reviewNote: reviewNote.slice(0, 500),
        reviewedAt: nowIso,
      };

      const releaseEntry: MonetizationLedgerEntry = {
        id: releaseLedId,
        type: 'withdrawal_release',
        creatorId: req.creatorId,
        creatorName: req.creatorName,
        mangaId: '',
        mangaTitle: '',
        chapterId: '',
        amountCents: req.amountCents,
        artistPercentApplied: 0,
        platformPercentApplied: 0,
        origin: 'Estorno de reserva por rejeição de saque',
        status: 'available',
        originalEntryId: req.ledgerEntryId,
        relatedRevenueId: '',
        relatedRequestId: req.id,
        relatedPaymentId: '',
        justification: reviewNote.slice(0, 500),
        createdBy: admin.uid,
      };

      await repo.commit([
        {
          collection: 'monetization_payout_requests',
          docId: req.id,
          fields: {
            ...updated,
            createdAt: new FirestoreTimestamp(req.createdAt || nowIso),
          } as unknown as Record<string, unknown>,
          serverTimestampFields: ['updatedAt'],
          precondition: reqSnap.updateTime ? { updateTime: reqSnap.updateTime } : { exists: true },
        },
        {
          collection: 'monetization_creator_balances',
          docId: req.creatorId,
          fields: nextBalance as unknown as Record<string, unknown>,
          serverTimestampFields: ['updatedAt'],
          precondition: balanceSnap.updateTime
            ? { updateTime: balanceSnap.updateTime }
            : { exists: true },
        },
        {
          collection: 'monetization_ledger',
          docId: releaseLedId,
          fields: releaseEntry as unknown as Record<string, unknown>,
          serverTimestampFields: ['createdAt'],
          precondition: { exists: false },
        },
        buildNotificationWrite({
          recipientId: req.creatorId,
          actorId: admin.uid,
          actorName: admin.displayName || 'MANGA MOTION',
          title: 'Solicitação de saque rejeitada',
          message: `Seu saque de R$ ${(req.amountCents / 100).toFixed(2).replace('.', ',')} foi devolvido ao saldo disponível. Motivo: ${reviewNote}`,
        }),
      ]);

      const refreshed = await repo.getPayoutRequest(req.id);
      return refreshed?.data || updated;
    });
  });
}

export async function recordManualPixPayment(
  repo: MonetizationRepository,
  admin: ActorIdentity,
  input: {
    requestId: string;
    transactionRef: string;
    paidDate: string;
    amountPaidCents?: number;
    receiptUrl?: string;
    notes?: string;
    idempotencyKey?: string;
  }
): Promise<MonetizationPayoutPayment> {
  const requestId = sanitizeFirestoreId(input.requestId);
  const transactionRef = String(input.transactionRef || '').trim();
  const paidDate = String(input.paidDate || '').trim();
  const receiptUrl = String(input.receiptUrl || '').trim();
  const notes = String(input.notes || '').trim();

  if (!transactionRef || transactionRef.length > 140) {
    throw new MonetizationError('Informe a referência/ID da transação Pix (E2E/comprovante).', 400);
  }
  if (!paidDate || paidDate.length > 40) {
    throw new MonetizationError('Informe a data do pagamento manual via Pix.', 400);
  }

  const payIdempKey = sanitizeFirestoreId(input.idempotencyKey || `pay_${requestId}`);

  return withLock(`request:${requestId}`, async () => {
    const [existingIdemp, reqSnap] = await Promise.all([
      repo.getIdempotency(payIdempKey),
      repo.getPayoutRequest(requestId),
    ]);

    if (existingIdemp) {
      throw new MonetizationError(
        'Pagamento duplicado bloqueado: esta solicitação já teve liquidação registrada.',
        409
      );
    }
    if (!reqSnap) {
      throw new MonetizationError('Solicitação de saque não encontrada.', 404);
    }

    const req = reqSnap.data;
    if (req.status === 'paid') {
      throw new MonetizationError('Esta solicitação de saque já foi paga.', 409);
    }
    if (req.status !== 'approved') {
      throw new MonetizationError(
        `Somente solicitações aprovadas podem ser marcadas como pagas (status atual: ${req.status}).`,
        409
      );
    }

    const amountPaidCents =
      input.amountPaidCents !== undefined && input.amountPaidCents !== null
        ? Number(input.amountPaidCents)
        : req.amountCents;

    if (amountPaidCents !== req.amountCents) {
      throw new MonetizationError(
        'O valor pago informado deve corresponder exatamente ao valor aprovado da solicitação.',
        400
      );
    }

    return withLock(`creator:${req.creatorId}`, async () => {
      const balanceSnap = await repo.getBalance(req.creatorId);
      if (!balanceSnap) {
        throw new MonetizationError('Saldo do criador não encontrado.', 404);
      }
      const balance = balanceSnap.data;
      assertAccountingInvariant(balance);

      if (balance.withdrawalPendingCents < req.amountCents) {
        throw new MonetizationError(
          'Saldo reservado para saque insuficiente para concluir a liquidação.',
          409
        );
      }

      const paymentId = generateMonetizationId('pay');
      const ledgerEntryId = generateMonetizationId('led');
      const nowIso = new Date().toISOString();

      const nextBalance: MonetizationCreatorBalance = {
        creatorId: req.creatorId,
        totalEarnedCents: balance.totalEarnedCents,
        pendingCents: balance.pendingCents,
        availableCents: balance.availableCents,
        withdrawalPendingCents: balance.withdrawalPendingCents - req.amountCents,
        totalPaidCents: balance.totalPaidCents + req.amountCents,
        lastOperationId: paymentId,
      };
      assertAccountingInvariant(nextBalance);

      const updatedRequest: MonetizationPayoutRequest = {
        ...req,
        status: 'paid',
        paidAt: nowIso,
        paymentId,
      };

      const paymentDoc: MonetizationPayoutPayment = {
        id: paymentId,
        requestId: req.id,
        creatorId: req.creatorId,
        creatorName: req.creatorName,
        amountPaidCents: req.amountCents,
        pixKeySnapshot: req.pixKeySnapshot,
        pixKeyTypeSnapshot: req.pixKeyTypeSnapshot,
        transactionRef: transactionRef.slice(0, 140),
        receiptUrl: receiptUrl.slice(0, 600),
        notes: notes.slice(0, 500),
        paidDate: paidDate.slice(0, 40),
        paidBy: admin.uid,
        ledgerEntryId,
      };

      const ledgerEntry: MonetizationLedgerEntry = {
        id: ledgerEntryId,
        type: 'payout_paid',
        creatorId: req.creatorId,
        creatorName: req.creatorName,
        mangaId: '',
        mangaTitle: '',
        chapterId: '',
        amountCents: -req.amountCents,
        artistPercentApplied: 0,
        platformPercentApplied: 0,
        origin: `Pagamento manual Pix (${transactionRef})`,
        status: 'completed',
        originalEntryId: req.ledgerEntryId,
        relatedRevenueId: '',
        relatedRequestId: req.id,
        relatedPaymentId: paymentId,
        justification: (notes || `Pix liquidado em ${paidDate} (Ref: ${transactionRef})`).slice(0, 500),
        createdBy: admin.uid,
      };

      await repo.commit([
        {
          collection: 'monetization_idempotency',
          docId: payIdempKey,
          serverTimestampFields: ['createdAt'],
          precondition: { exists: false },
          fields: {
            key: payIdempKey,
            action: 'pay_payout',
            actorId: admin.uid,
          },
        },
        {
          collection: 'monetization_payout_payments',
          docId: paymentId,
          fields: paymentDoc as unknown as Record<string, unknown>,
          serverTimestampFields: ['createdAt'],
          precondition: { exists: false },
        },
        {
          collection: 'monetization_payout_requests',
          docId: req.id,
          fields: {
            ...updatedRequest,
            createdAt: new FirestoreTimestamp(req.createdAt || nowIso),
          } as unknown as Record<string, unknown>,
          serverTimestampFields: ['updatedAt'],
          precondition: reqSnap.updateTime ? { updateTime: reqSnap.updateTime } : { exists: true },
        },
        {
          collection: 'monetization_creator_balances',
          docId: req.creatorId,
          fields: nextBalance as unknown as Record<string, unknown>,
          serverTimestampFields: ['updatedAt'],
          precondition: balanceSnap.updateTime
            ? { updateTime: balanceSnap.updateTime }
            : { exists: true },
        },
        {
          collection: 'monetization_ledger',
          docId: ledgerEntryId,
          fields: ledgerEntry as unknown as Record<string, unknown>,
          serverTimestampFields: ['createdAt'],
          precondition: { exists: false },
        },
        buildNotificationWrite({
          recipientId: req.creatorId,
          actorId: admin.uid,
          actorName: admin.displayName || 'MANGA MOTION',
          title: 'Pagamento Pix realizado',
          message: `Transferência manual de R$ ${(req.amountCents / 100).toFixed(2).replace('.', ',')} realizada em ${paidDate}. Ref: ${transactionRef}.`,
        }),
      ]);

      return paymentDoc;
    });
  });
}

export async function createManualAdjustment(
  repo: MonetizationRepository,
  admin: ActorIdentity,
  input: {
    creatorId: string;
    direction: 'credit' | 'debit';
    bucket: MonetizationCreditReleaseBucket;
    amountCents: number;
    justification: string;
    mangaId?: string;
    idempotencyKey?: string;
  }
): Promise<MonetizationLedgerEntry> {
  const creatorId = sanitizeFirestoreId(input.creatorId);
  const amountCents = Number(input.amountCents);
  const justification = String(input.justification || '').trim();
  const bucket: MonetizationCreditReleaseBucket =
    input.bucket === 'pending' ? 'pending' : 'available';

  if (input.direction !== 'credit' && input.direction !== 'debit') {
    throw new MonetizationError('Tipo de ajuste inválido (crédito ou débito).', 400);
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new MonetizationError('O valor do ajuste deve ser um inteiro positivo em centavos.', 400);
  }
  if (justification.length < 5 || justification.length > 500) {
    throw new MonetizationError(
      'Justificativa obrigatória para ajustes financeiros (mínimo 5 caracteres).',
      400
    );
  }

  const cleanIdemp = input.idempotencyKey ? sanitizeFirestoreId(input.idempotencyKey) : '';

  return withLock(`creator:${creatorId}`, async () => {
    if (cleanIdemp) {
      const existingIdemp = await repo.getIdempotency(cleanIdemp);
      if (existingIdemp) {
        throw new MonetizationError('Ajuste financeiro duplicado bloqueado (idempotência).', 409);
      }
    }

    const [userSnap, balanceSnap, mangaSnap] = await Promise.all([
      repo.getUserProfile(creatorId),
      repo.getBalance(creatorId),
      input.mangaId ? repo.getManga(sanitizeFirestoreId(input.mangaId)) : Promise.resolve(null),
    ]);

    if (!userSnap && !balanceSnap) {
      throw new MonetizationError('Artista não encontrado.', 404);
    }

    const balance = balanceSnap?.data || createEmptyBalance(creatorId);
    assertAccountingInvariant(balance);

    const signedAmount = input.direction === 'credit' ? amountCents : -amountCents;
    const nextBalance: MonetizationCreatorBalance = { ...balance };

    if (input.direction === 'credit') {
      nextBalance.totalEarnedCents += amountCents;
      if (bucket === 'pending') nextBalance.pendingCents += amountCents;
      else nextBalance.availableCents += amountCents;
    } else {
      const bucketValue = bucket === 'pending' ? balance.pendingCents : balance.availableCents;
      if (bucketValue < amountCents || balance.totalEarnedCents < amountCents) {
        throw new MonetizationError(
          `Saldo ${bucket === 'pending' ? 'pendente' : 'disponível'} insuficiente para aplicar este ajuste de débito sem deixar a conta negativa.`,
          409
        );
      }
      nextBalance.totalEarnedCents -= amountCents;
      if (bucket === 'pending') nextBalance.pendingCents -= amountCents;
      else nextBalance.availableCents -= amountCents;
    }

    const ledgerEntryId = generateMonetizationId('led');
    nextBalance.lastOperationId = ledgerEntryId;
    assertAccountingInvariant(nextBalance);

    const creatorName = (userSnap?.data.displayName || 'Artista').slice(0, 80);
    const ledgerEntry: MonetizationLedgerEntry = {
      id: ledgerEntryId,
      type: 'adjustment',
      creatorId,
      creatorName,
      mangaId: mangaSnap?.data.id || '',
      mangaTitle: mangaSnap?.data.title || '',
      chapterId: '',
      amountCents: signedAmount,
      artistPercentApplied: 0,
      platformPercentApplied: 0,
      origin: `Ajuste administrativo (${input.direction === 'credit' ? 'Crédito' : 'Débito'})`,
      status: input.direction === 'credit' ? bucket : 'completed',
      originalEntryId: '',
      relatedRevenueId: '',
      relatedRequestId: '',
      relatedPaymentId: '',
      justification,
      createdBy: admin.uid,
    };

    const writes: CommitWriteOp[] = [];
    if (cleanIdemp) {
      writes.push({
        collection: 'monetization_idempotency',
        docId: cleanIdemp,
        serverTimestampFields: ['createdAt'],
        precondition: { exists: false },
        fields: {
          key: cleanIdemp,
          action: 'adjustment',
          actorId: admin.uid,
        },
      });
    }

    writes.push(
      {
        collection: 'monetization_creator_balances',
        docId: creatorId,
        fields: nextBalance as unknown as Record<string, unknown>,
        serverTimestampFields: ['updatedAt'],
        precondition: balanceSnap?.updateTime
          ? { updateTime: balanceSnap.updateTime }
          : { exists: false },
      },
      {
        collection: 'monetization_ledger',
        docId: ledgerEntryId,
        fields: ledgerEntry as unknown as Record<string, unknown>,
        serverTimestampFields: ['createdAt'],
        precondition: { exists: false },
      },
      buildNotificationWrite({
        recipientId: creatorId,
        actorId: admin.uid,
        actorName: admin.displayName || 'MANGA MOTION',
        title: 'Ajuste financeiro registrado',
        message: `${input.direction === 'credit' ? '+' : '-'}R$ ${(amountCents / 100).toFixed(2).replace('.', ',')}: ${justification}`,
        linkMangaId: mangaSnap?.data.id,
      })
    );

    await repo.commit(writes);
    return ledgerEntry;
  });
}

export async function reverseLedgerEntry(
  repo: MonetizationRepository,
  admin: ActorIdentity,
  input: {
    originalEntryId: string;
    justification: string;
    idempotencyKey?: string;
  }
): Promise<MonetizationLedgerEntry> {
  const originalEntryId = sanitizeFirestoreId(input.originalEntryId);
  const justification = String(input.justification || '').trim();

  if (justification.length < 5 || justification.length > 500) {
    throw new MonetizationError(
      'Justificativa obrigatória para estorno de lançamento (mínimo 5 caracteres).',
      400
    );
  }

  const cleanIdemp = sanitizeFirestoreId(input.idempotencyKey || `rev_${originalEntryId}`);

  return withLock(`ledger:${originalEntryId}`, async () => {
    const [existingIdemp, origSnap] = await Promise.all([
      repo.getIdempotency(cleanIdemp),
      repo.getLedgerEntry(originalEntryId),
    ]);

    if (existingIdemp) {
      throw new MonetizationError('Este lançamento já foi estornado anteriormente.', 409);
    }
    if (!origSnap) {
      throw new MonetizationError('Lançamento original não encontrado.', 404);
    }
    const orig = origSnap.data;

    if (orig.status === 'reversed') {
      throw new MonetizationError('Este lançamento já está marcado como estornado.', 409);
    }
    if (
      !orig.creatorId ||
      orig.amountCents <= 0 ||
      (orig.type !== 'revenue_credit' && orig.type !== 'adjustment')
    ) {
      throw new MonetizationError(
        'Apenas lançamentos positivos de crédito de receita ou ajuste podem ser estornados.',
        400
      );
    }

    return withLock(`creator:${orig.creatorId}`, async () => {
      const [balanceSnap, creatorLedger] = await Promise.all([
        repo.getBalance(orig.creatorId),
        repo.listLedgerEntries(orig.creatorId),
      ]);

      if (creatorLedger.some((l) => l.data.type === 'reversal' && l.data.originalEntryId === orig.id)) {
        throw new MonetizationError('Já existe um estorno vinculado a este lançamento.', 409);
      }

      if (!balanceSnap) {
        throw new MonetizationError('Saldo do artista não encontrado.', 404);
      }
      const balance = balanceSnap.data;
      assertAccountingInvariant(balance);

      const fromPending = orig.status === 'pending';
      const nextBalance: MonetizationCreatorBalance = { ...balance };
      if (fromPending) {
        if (balance.pendingCents < orig.amountCents || balance.totalEarnedCents < orig.amountCents) {
          throw new MonetizationError(
            'Saldo pendente insuficiente para estornar este lançamento.',
            409
          );
        }
        nextBalance.pendingCents -= orig.amountCents;
        nextBalance.totalEarnedCents -= orig.amountCents;
      } else {
        if (balance.availableCents < orig.amountCents || balance.totalEarnedCents < orig.amountCents) {
          throw new MonetizationError(
            'Saldo disponível insuficiente para estornar este lançamento sem deixar saldo negativo.',
            409
          );
        }
        nextBalance.availableCents -= orig.amountCents;
        nextBalance.totalEarnedCents -= orig.amountCents;
      }

      const reversalId = generateMonetizationId('led');
      nextBalance.lastOperationId = reversalId;
      assertAccountingInvariant(nextBalance);

      const reversalEntry: MonetizationLedgerEntry = {
        id: reversalId,
        type: 'reversal',
        creatorId: orig.creatorId,
        creatorName: orig.creatorName,
        mangaId: orig.mangaId,
        mangaTitle: orig.mangaTitle,
        chapterId: orig.chapterId,
        amountCents: -orig.amountCents,
        artistPercentApplied: orig.artistPercentApplied,
        platformPercentApplied: orig.platformPercentApplied,
        origin: `Estorno do lançamento ${orig.id}`,
        status: 'completed',
        originalEntryId: orig.id,
        relatedRevenueId: orig.relatedRevenueId,
        relatedRequestId: orig.relatedRequestId,
        relatedPaymentId: orig.relatedPaymentId,
        justification,
        createdBy: admin.uid,
      };

      await repo.commit([
        {
          collection: 'monetization_idempotency',
          docId: cleanIdemp,
          serverTimestampFields: ['createdAt'],
          precondition: { exists: false },
          fields: {
            key: cleanIdemp,
            action: 'adjustment',
            actorId: admin.uid,
          },
        },
        {
          collection: 'monetization_ledger',
          docId: orig.id,
          fields: {
            ...orig,
            status: 'reversed',
            createdAt: new FirestoreTimestamp(orig.createdAt || new Date().toISOString()),
          } as unknown as Record<string, unknown>,
          precondition: origSnap.updateTime ? { updateTime: origSnap.updateTime } : { exists: true },
        },
        {
          collection: 'monetization_creator_balances',
          docId: orig.creatorId,
          fields: nextBalance as unknown as Record<string, unknown>,
          serverTimestampFields: ['updatedAt'],
          precondition: balanceSnap.updateTime
            ? { updateTime: balanceSnap.updateTime }
            : { exists: true },
        },
        {
          collection: 'monetization_ledger',
          docId: reversalId,
          fields: reversalEntry as unknown as Record<string, unknown>,
          serverTimestampFields: ['createdAt'],
          precondition: { exists: false },
        },
        buildNotificationWrite({
          recipientId: orig.creatorId,
          actorId: admin.uid,
          actorName: admin.displayName || 'MANGA MOTION',
          title: 'Estorno financeiro registrado',
          message: `Estorno de R$ ${(orig.amountCents / 100).toFixed(2).replace('.', ',')}: ${justification}`,
          linkMangaId: orig.mangaId,
        }),
      ]);

      return reversalEntry;
    });
  });
}

export async function getAdminMonetizationDashboard(
  repo: MonetizationRepository,
  filters: {
    creatorId?: string;
    mangaId?: string;
    referencePeriod?: string;
    status?: string;
  } = {}
): Promise<AdminMonetizationDashboard> {
  const [settingsRes, revSnaps, ledgerSnaps, reqSnaps, paySnaps, balSnaps, userSnaps, mangaSnaps] =
    await Promise.all([
      getSettingsOrDefault(repo),
      repo.listRevenues(),
      repo.listLedgerEntries(),
      repo.listPayoutRequests(),
      repo.listPayoutPayments(),
      repo.listBalances(),
      repo.listAllUsers(),
      repo.listAllMangas(),
    ]);

  const allRevenues = sortByNewest(revSnaps.map((s) => s.data));
  const allLedger = sortByNewest(ledgerSnaps.map((s) => s.data));
  const allRequests = sortByNewest(reqSnaps.map((s) => s.data));
  const allPayments = sortByNewest(paySnaps.map((s) => s.data));
  const allBalances = balSnaps.map((s) => s.data);

  // Global accounting overview over all confirmed records
  let totalConfirmedNetCents = 0;
  let totalAttributedNetCents = 0;
  let totalUnattributedNetCents = 0;
  let totalPlatformShareCents = 0;
  let unconfirmedRevenuesCents = 0;

  for (const rev of allRevenues) {
    if (rev.confirmationStatus === 'confirmed') {
      totalConfirmedNetCents += rev.netRevenueCents;
      totalPlatformShareCents += rev.platformShareCents;
      if (rev.attributionType === 'unattributed') {
        totalUnattributedNetCents += rev.netRevenueCents;
      } else {
        totalAttributedNetCents += rev.netRevenueCents;
      }
    } else if (rev.confirmationStatus === 'pending') {
      unconfirmedRevenuesCents += rev.netRevenueCents;
    }
  }

  let totalArtistsShareCents = 0;
  let totalArtistPendingHoldCents = 0;
  let totalArtistAvailableCents = 0;
  let totalWithdrawalPendingCents = 0;
  let totalPaidCents = 0;

  for (const b of allBalances) {
    totalArtistsShareCents += b.totalEarnedCents;
    totalArtistPendingHoldCents += b.pendingCents;
    totalArtistAvailableCents += b.availableCents;
    totalWithdrawalPendingCents += b.withdrawalPendingCents;
    totalPaidCents += b.totalPaidCents;
  }

  const overview: AdminMonetizationOverview = {
    totalConfirmedNetCents,
    totalAttributedNetCents,
    totalUnattributedNetCents,
    totalArtistsShareCents,
    totalPlatformShareCents,
    totalPendingPaymentCents:
      totalArtistPendingHoldCents + totalArtistAvailableCents + totalWithdrawalPendingCents,
    totalArtistPendingHoldCents,
    totalArtistAvailableCents,
    totalWithdrawalPendingCents,
    totalPaidCents,
    awaitingReviewCount: allRequests.filter((r) => r.status === 'pending').length,
    approvedAwaitingPayCount: allRequests.filter((r) => r.status === 'approved').length,
    unconfirmedRevenuesCents,
  };

  // Apply query filters cleanly in Node memory
  const creatorFilter = (filters.creatorId || '').trim();
  const mangaFilter = (filters.mangaId || '').trim();
  const periodFilter = (filters.referencePeriod || '').trim().toLowerCase();
  const statusFilter = (filters.status || '').trim();

  const revenueIdsMatchingPeriod = periodFilter
    ? new Set(
        allRevenues
          .filter((r) => r.referencePeriod.toLowerCase().includes(periodFilter))
          .map((r) => r.id)
      )
    : null;

  const revenues = allRevenues.filter((r) => {
    if (creatorFilter && r.creatorId !== creatorFilter) return false;
    if (mangaFilter && r.mangaId !== mangaFilter) return false;
    if (periodFilter && !r.referencePeriod.toLowerCase().includes(periodFilter)) return false;
    if (statusFilter && r.confirmationStatus !== statusFilter) return false;
    return true;
  });

  const ledger = allLedger.filter((l) => {
    if (creatorFilter && l.creatorId !== creatorFilter) return false;
    if (mangaFilter && l.mangaId !== mangaFilter) return false;
    if (
      periodFilter &&
      !l.origin.toLowerCase().includes(periodFilter) &&
      (!l.relatedRevenueId || !revenueIdsMatchingPeriod?.has(l.relatedRevenueId))
    ) {
      return false;
    }
    if (statusFilter && l.status !== statusFilter) return false;
    return true;
  });

  const payoutRequests = allRequests.filter((r) => {
    if (creatorFilter && r.creatorId !== creatorFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  });

  const payments = allPayments.filter((p) => {
    if (creatorFilter && p.creatorId !== creatorFilter) return false;
    return true;
  });

  const balances = allBalances.filter((b) => {
    if (creatorFilter && b.creatorId !== creatorFilter) return false;
    return true;
  });

  const creators: AdminCreatorOption[] = userSnaps
    .map((u) => ({
      uid: u.data.uid,
      displayName: u.data.displayName,
      handle: u.data.handle,
      accountType: u.data.accountType,
      worksCount: u.data.worksCount || 0,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const mangas: AdminMangaOption[] = mangaSnaps
    .map((m) => ({
      id: m.data.id,
      title: m.data.title,
      authorId: m.data.authorId,
      authorName: m.data.authorName,
      status: m.data.status,
      chaptersCount: m.data.chaptersCount || 0,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return {
    settings: settingsRes.settings,
    overview,
    revenues,
    ledger,
    payoutRequests,
    payments,
    balances,
    creators,
    mangas,
  };
}
