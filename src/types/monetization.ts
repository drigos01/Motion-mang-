export type MonetizationAttributionType = 'work' | 'unattributed';
export type MonetizationConfirmationStatus = 'pending' | 'confirmed' | 'cancelled';
export type MonetizationCreditReleaseBucket = 'available' | 'pending';
export type MonetizationPixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

export type MonetizationLedgerType =
  | 'revenue_credit'
  | 'platform_fee'
  | 'unattributed_revenue'
  | 'pending_release'
  | 'withdrawal_hold'
  | 'withdrawal_release'
  | 'payout_paid'
  | 'adjustment'
  | 'reversal';

export type MonetizationLedgerStatus =
  | 'pending'
  | 'available'
  | 'released'
  | 'completed'
  | 'reversed'
  | 'cancelled';

export type MonetizationPayoutStatus = 'pending' | 'approved' | 'paid' | 'rejected';

export interface MonetizationSettings {
  id: string;
  artistSharePercent: number;
  platformSharePercent: number;
  minWithdrawalCents: number;
  updatedBy: string;
  updatedAt?: string;
}

export interface MonetizationPayoutProfile {
  creatorId: string;
  beneficiaryName: string;
  pixKeyType: MonetizationPixKeyType;
  pixKey: string;
  pixBankName: string;
  updatedAt?: string;
}

export interface MonetizationCreatorBalance {
  creatorId: string;
  totalEarnedCents: number;
  pendingCents: number;
  availableCents: number;
  withdrawalPendingCents: number;
  totalPaidCents: number;
  lastOperationId: string;
  updatedAt?: string;
}

export interface MonetizationRevenue {
  id: string;
  attributionType: MonetizationAttributionType;
  mangaId: string;
  mangaTitle: string;
  creatorId: string;
  creatorName: string;
  chapterId: string;
  chapterNumber: number;
  referencePeriod: string;
  adImpressions: number;
  hasAdImpressions: boolean;
  grossRevenueCents: number;
  hasGrossRevenue: boolean;
  networkDeductionsCents: number;
  hasNetworkDeductions: boolean;
  netRevenueCents: number;
  artistPercentApplied: number;
  platformPercentApplied: number;
  artistShareCents: number;
  platformShareCents: number;
  releaseBucket: MonetizationCreditReleaseBucket;
  source: string;
  externalRef: string;
  notes: string;
  confirmationStatus: MonetizationConfirmationStatus;
  recordedBy: string;
  confirmedBy: string;
  confirmedAt?: string;
  importedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MonetizationLedgerEntry {
  id: string;
  type: MonetizationLedgerType;
  creatorId: string;
  creatorName: string;
  mangaId: string;
  mangaTitle: string;
  chapterId: string;
  amountCents: number;
  artistPercentApplied: number;
  platformPercentApplied: number;
  origin: string;
  status: MonetizationLedgerStatus;
  originalEntryId: string;
  relatedRevenueId: string;
  relatedRequestId: string;
  relatedPaymentId: string;
  justification: string;
  createdBy: string;
  createdAt?: string;
}

export interface MonetizationPayoutRequest {
  id: string;
  creatorId: string;
  creatorName: string;
  amountCents: number;
  beneficiaryNameSnapshot: string;
  pixKeyTypeSnapshot: MonetizationPixKeyType;
  pixKeySnapshot: string;
  pixBankNameSnapshot: string;
  status: MonetizationPayoutStatus;
  ledgerEntryId: string;
  reviewedBy: string;
  reviewNote: string;
  reviewedAt?: string;
  paidAt?: string;
  paymentId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MonetizationPayoutPayment {
  id: string;
  requestId: string;
  creatorId: string;
  creatorName: string;
  amountPaidCents: number;
  pixKeySnapshot: string;
  pixKeyTypeSnapshot: MonetizationPixKeyType;
  transactionRef: string;
  receiptUrl: string;
  notes: string;
  paidDate: string;
  paidBy: string;
  ledgerEntryId: string;
  createdAt?: string;
}

export interface WorkPerformanceSummary {
  mangaId: string;
  mangaTitle: string;
  confirmedNetRevenueCents: number;
  artistShareCents: number;
  pendingArtistShareCents: number;
  unconfirmedRevenueCents: number;
  entriesCount: number;
}

export interface CreatorMonetizationDashboard {
  settings: MonetizationSettings;
  balance: MonetizationCreatorBalance;
  payoutProfile: MonetizationPayoutProfile | null;
  workPerformance: WorkPerformanceSummary[];
  revenues: MonetizationRevenue[];
  ledger: MonetizationLedgerEntry[];
  payoutRequests: MonetizationPayoutRequest[];
  payments: MonetizationPayoutPayment[];
}

export interface AdminCreatorOption {
  uid: string;
  displayName: string;
  handle: string;
  accountType: string;
  worksCount: number;
}

export interface AdminMangaOption {
  id: string;
  title: string;
  authorId: string;
  authorName: string;
  status: string;
  chaptersCount: number;
}

export interface AdminMonetizationOverview {
  totalConfirmedNetCents: number;
  totalAttributedNetCents: number;
  totalUnattributedNetCents: number;
  totalArtistsShareCents: number;
  totalPlatformShareCents: number;
  totalPendingPaymentCents: number;
  totalArtistPendingHoldCents: number;
  totalArtistAvailableCents: number;
  totalWithdrawalPendingCents: number;
  totalPaidCents: number;
  awaitingReviewCount: number;
  approvedAwaitingPayCount: number;
  unconfirmedRevenuesCents: number;
}

export interface AdminMonetizationDashboard {
  settings: MonetizationSettings;
  overview: AdminMonetizationOverview;
  revenues: MonetizationRevenue[];
  ledger: MonetizationLedgerEntry[];
  payoutRequests: MonetizationPayoutRequest[];
  payments: MonetizationPayoutPayment[];
  balances: MonetizationCreatorBalance[];
  creators: AdminCreatorOption[];
  mangas: AdminMangaOption[];
}

export function formatBRL(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(safe / 100);
}

export function parseBRLToCents(raw: string | number): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return 0;
    return Math.round(raw * 100);
  }
  const trimmed = String(raw || '').trim();
  if (!trimmed) return 0;
  // Support both "100,50" / "1.234,56" and "100.50"
  let normalized = trimmed.replace(/[R$\s]/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}
