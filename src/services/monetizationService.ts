import { auth } from '../lib/firebase';
import {
  AdminMonetizationDashboard,
  CreatorMonetizationDashboard,
  MonetizationAttributionType,
  MonetizationCreatorBalance,
  MonetizationCreditReleaseBucket,
  MonetizationLedgerEntry,
  MonetizationPayoutPayment,
  MonetizationPayoutProfile,
  MonetizationPayoutRequest,
  MonetizationPixKeyType,
  MonetizationRevenue,
  MonetizationSettings,
} from '../types/monetization';

async function getAuthHeaders(includeJson = true): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Faça login para acessar os recursos financeiros.');
  }
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }

  if (!res.ok) {
    const errMsg =
      typeof parsed.error === 'string' && parsed.error
        ? parsed.error
        : `Erro na requisição (${res.status}).`;
    throw new Error(errMsg);
  }
  return parsed as T;
}

export async function fetchCreatorMonetizationDashboard(): Promise<CreatorMonetizationDashboard> {
  const headers = await getAuthHeaders(false);
  return requestJson<CreatorMonetizationDashboard>('/api/monetization/creator/dashboard', {
    method: 'GET',
    headers,
  });
}

export async function saveCreatorPayoutProfileApi(input: {
  beneficiaryName: string;
  pixKeyType: MonetizationPixKeyType;
  pixKey: string;
  pixBankName?: string;
}): Promise<MonetizationPayoutProfile> {
  const headers = await getAuthHeaders(true);
  const res = await requestJson<{ profile: MonetizationPayoutProfile }>(
    '/api/monetization/creator/payout-profile',
    {
      method: 'PUT',
      headers,
      body: JSON.stringify(input),
    }
  );
  return res.profile;
}

export async function requestCreatorWithdrawalApi(input: {
  amountCents: number;
  idempotencyKey?: string;
}): Promise<MonetizationPayoutRequest> {
  const headers = await getAuthHeaders(true);
  const res = await requestJson<{ request: MonetizationPayoutRequest }>(
    '/api/monetization/creator/withdrawals',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }
  );
  return res.request;
}

export async function fetchAdminMonetizationDashboard(filters: {
  creatorId?: string;
  mangaId?: string;
  referencePeriod?: string;
  status?: string;
} = {}): Promise<AdminMonetizationDashboard> {
  const headers = await getAuthHeaders(false);
  const params = new URLSearchParams();
  if (filters.creatorId) params.set('creatorId', filters.creatorId);
  if (filters.mangaId) params.set('mangaId', filters.mangaId);
  if (filters.referencePeriod) params.set('referencePeriod', filters.referencePeriod);
  if (filters.status) params.set('status', filters.status);
  const qs = params.toString();
  return requestJson<AdminMonetizationDashboard>(
    `/api/monetization/admin/dashboard${qs ? `?${qs}` : ''}`,
    { method: 'GET', headers }
  );
}

export async function updateMonetizationSettingsApi(input: {
  artistSharePercent: number;
  minWithdrawalCents: number;
}): Promise<MonetizationSettings> {
  const headers = await getAuthHeaders(true);
  const res = await requestJson<{ settings: MonetizationSettings }>(
    '/api/monetization/admin/settings',
    {
      method: 'PUT',
      headers,
      body: JSON.stringify(input),
    }
  );
  return res.settings;
}

export async function registerAdRevenueApi(input: {
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
}): Promise<MonetizationRevenue> {
  const headers = await getAuthHeaders(true);
  const res = await requestJson<{ revenue: MonetizationRevenue }>(
    '/api/monetization/admin/revenues',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }
  );
  return res.revenue;
}

export async function confirmPendingRevenueApi(input: {
  revenueId: string;
  releaseBucket?: MonetizationCreditReleaseBucket;
  idempotencyKey?: string;
}): Promise<MonetizationRevenue> {
  const headers = await getAuthHeaders(true);
  const res = await requestJson<{ revenue: MonetizationRevenue }>(
    `/api/monetization/admin/revenues/${encodeURIComponent(input.revenueId)}/confirm`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        releaseBucket: input.releaseBucket,
        idempotencyKey: input.idempotencyKey,
      }),
    }
  );
  return res.revenue;
}

export async function cancelPendingRevenueApi(
  revenueId: string,
  reason: string
): Promise<MonetizationRevenue> {
  const headers = await getAuthHeaders(true);
  const res = await requestJson<{ revenue: MonetizationRevenue }>(
    `/api/monetization/admin/revenues/${encodeURIComponent(revenueId)}/cancel`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason }),
    }
  );
  return res.revenue;
}

export async function releasePendingLedgerCreditApi(
  ledgerEntryId: string
): Promise<MonetizationCreatorBalance> {
  const headers = await getAuthHeaders(true);
  const res = await requestJson<{ balance: MonetizationCreatorBalance }>(
    `/api/monetization/admin/ledger/${encodeURIComponent(ledgerEntryId)}/release`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    }
  );
  return res.balance;
}

export async function reviewPayoutRequestApi(input: {
  requestId: string;
  decision: 'approve' | 'reject';
  reviewNote?: string;
}): Promise<MonetizationPayoutRequest> {
  const headers = await getAuthHeaders(true);
  const res = await requestJson<{ request: MonetizationPayoutRequest }>(
    `/api/monetization/admin/payout-requests/${encodeURIComponent(input.requestId)}/review`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        decision: input.decision,
        reviewNote: input.reviewNote,
      }),
    }
  );
  return res.request;
}

export async function recordManualPixPaymentApi(input: {
  requestId: string;
  transactionRef: string;
  paidDate: string;
  amountPaidCents?: number;
  receiptUrl?: string;
  notes?: string;
  idempotencyKey?: string;
}): Promise<MonetizationPayoutPayment> {
  const headers = await getAuthHeaders(true);
  const res = await requestJson<{ payment: MonetizationPayoutPayment }>(
    `/api/monetization/admin/payout-requests/${encodeURIComponent(input.requestId)}/pay`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }
  );
  return res.payment;
}

export async function createManualAdjustmentApi(input: {
  creatorId: string;
  direction: 'credit' | 'debit';
  bucket: MonetizationCreditReleaseBucket;
  amountCents: number;
  justification: string;
  mangaId?: string;
  idempotencyKey?: string;
}): Promise<MonetizationLedgerEntry> {
  const headers = await getAuthHeaders(true);
  const res = await requestJson<{ entry: MonetizationLedgerEntry }>(
    '/api/monetization/admin/adjustments',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    }
  );
  return res.entry;
}

export async function reverseLedgerEntryApi(input: {
  originalEntryId: string;
  justification: string;
  idempotencyKey?: string;
}): Promise<MonetizationLedgerEntry> {
  const headers = await getAuthHeaders(true);
  const res = await requestJson<{ entry: MonetizationLedgerEntry }>(
    `/api/monetization/admin/ledger/${encodeURIComponent(input.originalEntryId)}/reverse`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        justification: input.justification,
        idempotencyKey: input.idempotencyKey,
      }),
    }
  );
  return res.entry;
}
