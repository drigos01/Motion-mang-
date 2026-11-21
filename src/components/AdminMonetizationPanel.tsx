import React, { useEffect, useState } from 'react';
import {
  CheckCircle,
  Coins,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  History,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Upload,
  Wallet,
  XCircle,
} from 'lucide-react';
import { ToastPopup } from './ToastPopup';
import { deleteMediaAsset, uploadMediaAsset } from '../lib/api';
import { fetchChaptersForManga } from '../services/mangaService';
import {
  cancelPendingRevenueApi,
  confirmPendingRevenueApi,
  createManualAdjustmentApi,
  fetchAdminMonetizationDashboard,
  recordManualPixPaymentApi,
  registerAdRevenueApi,
  releasePendingLedgerCreditApi,
  reverseLedgerEntryApi,
  reviewPayoutRequestApi,
  updateMonetizationSettingsApi,
} from '../services/monetizationService';
import { Chapter } from '../types/manga';
import {
  AdminMonetizationDashboard,
  MonetizationAttributionType,
  MonetizationCreditReleaseBucket,
  MonetizationLedgerEntry,
  MonetizationLedgerType,
  MonetizationPayoutRequest,
  MonetizationPayoutStatus,
  formatBRL,
  parseBRLToCents,
} from '../types/monetization';

const LEDGER_TYPE_LABEL: Record<MonetizationLedgerType, string> = {
  revenue_credit: 'Crédito de Receita',
  platform_fee: 'Taxa da Plataforma',
  unattributed_revenue: 'Receita Não Atribuída',
  pending_release: 'Liberação de Retenção',
  withdrawal_hold: 'Reserva de Saque',
  withdrawal_release: 'Devolução (Saque Rejeitado)',
  payout_paid: 'Pagamento Pix Realizado',
  adjustment: 'Ajuste Manual',
  reversal: 'Estorno',
};

const PAYOUT_STATUS_LABEL: Record<MonetizationPayoutStatus, string> = {
  pending: 'Aguardando Análise',
  approved: 'Aprovado p/ Pix',
  paid: 'Pago',
  rejected: 'Rejeitado',
};

export function AdminMonetizationPanel() {
  const [dashboard, setDashboard] = useState<AdminMonetizationDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<'revenues' | 'payouts' | 'ledger' | 'settings'>('revenues');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Filters
  const [filterCreatorId, setFilterCreatorId] = useState('');
  const [filterMangaId, setFilterMangaId] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Revenue form
  const [attributionType, setAttributionType] = useState<MonetizationAttributionType>('work');
  const [revMangaId, setRevMangaId] = useState('');
  const [revChapterId, setRevChapterId] = useState('');
  const [mangaChapters, setMangaChapters] = useState<Chapter[]>([]);
  const [revPeriod, setRevPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [revSource, setRevSource] = useState('Rede de Anúncios');
  const [revExternalRef, setRevExternalRef] = useState('');
  const [revImpressions, setRevImpressions] = useState('');
  const [revGross, setRevGross] = useState('');
  const [revDeductions, setRevDeductions] = useState('');
  const [revNet, setRevNet] = useState('');
  const [revConfirmNow, setRevConfirmNow] = useState(true);
  const [revReleaseBucket, setRevReleaseBucket] =
    useState<MonetizationCreditReleaseBucket>('available');
  const [revNotes, setRevNotes] = useState('');
  const [submittingRev, setSubmittingRev] = useState(false);

  // Payout review & manual payment state
  const [rejectingReqId, setRejectingReqId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [payingReq, setPayingReq] = useState<MonetizationPayoutRequest | null>(null);
  const [payTxRef, setPayTxRef] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payAmountText, setPayAmountText] = useState('');
  const [payReceiptUrl, setPayReceiptUrl] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  // Adjustment & reversal state
  const [adjCreatorId, setAdjCreatorId] = useState('');
  const [adjDirection, setAdjDirection] = useState<'credit' | 'debit'>('credit');
  const [adjBucket, setAdjBucket] = useState<MonetizationCreditReleaseBucket>('available');
  const [adjAmountText, setAdjAmountText] = useState('');
  const [adjMangaId, setAdjMangaId] = useState('');
  const [adjJustification, setAdjJustification] = useState('');
  const [submittingAdj, setSubmittingAdj] = useState(false);
  const [reversingEntry, setReversingEntry] = useState<MonetizationLedgerEntry | null>(null);
  const [reversalJustification, setReversalJustification] = useState('');

  // Settings form
  const [artistPercentInput, setArtistPercentInput] = useState('70');
  const [minWithdrawalInput, setMinWithdrawalInput] = useState('50,00');
  const [savingSettings, setSavingSettings] = useState(false);

  const loadDashboard = async (overrides?: {
    creatorId?: string;
    mangaId?: string;
    referencePeriod?: string;
    status?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminMonetizationDashboard({
        creatorId: overrides ? overrides.creatorId : filterCreatorId,
        mangaId: overrides ? overrides.mangaId : filterMangaId,
        referencePeriod: overrides ? overrides.referencePeriod : filterPeriod,
        status: overrides ? overrides.status : filterStatus,
      });
      setDashboard(data);
      setArtistPercentInput(String(data.settings.artistSharePercent));
      setMinWithdrawalInput(
        (data.settings.minWithdrawalCents / 100).toFixed(2).replace('.', ',')
      );
      if (!revMangaId && data.mangas.length > 0) {
        setRevMangaId(data.mangas[0].id);
      }
      if (!adjCreatorId && data.creators.length > 0) {
        setAdjCreatorId(data.creators[0].uid);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao carregar dados administrativos de monetização.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (!revMangaId || attributionType !== 'work') {
      setMangaChapters([]);
      setRevChapterId('');
      return;
    }
    fetchChaptersForManga(revMangaId, true)
      .then((chs) => {
        setMangaChapters(chs);
        setRevChapterId('');
      })
      .catch(() => setMangaChapters([]));
  }, [revMangaId, attributionType]);

  const handleRegisterRevenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRev) return;
    const netCents = parseBRLToCents(revNet);
    if (netCents <= 0) {
      setError('Informe a receita líquida recebida em reais maior que zero.');
      return;
    }

    setSubmittingRev(true);
    setError(null);
    setFeedback(null);
    try {
      const idempotencyKey = `reg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const created = await registerAdRevenueApi({
        attributionType,
        mangaId: attributionType === 'work' ? revMangaId : undefined,
        chapterId: attributionType === 'work' && revChapterId ? revChapterId : undefined,
        referencePeriod: revPeriod,
        adImpressions: revImpressions.trim() ? Number(revImpressions) : null,
        grossRevenueCents: revGross.trim() ? parseBRLToCents(revGross) : null,
        networkDeductionsCents: revDeductions.trim() ? parseBRLToCents(revDeductions) : null,
        netRevenueCents: netCents,
        releaseBucket: revReleaseBucket,
        source: revSource,
        externalRef: revExternalRef.trim() || undefined,
        notes: revNotes.trim() || undefined,
        confirmImmediately: revConfirmNow,
        idempotencyKey,
      });
      setFeedback(
        created.confirmationStatus === 'confirmed'
          ? `Receita confirmada (${formatBRL(created.netRevenueCents)}): artista ${formatBRL(created.artistShareCents)} (${created.artistPercentApplied}%) · plataforma ${formatBRL(created.platformShareCents)} (${created.platformPercentApplied}%).`
          : `Receita registrada como pendente (${formatBRL(created.netRevenueCents)}). Aguardando confirmação para dividir e creditar.`
      );
      setRevNet('');
      setRevGross('');
      setRevDeductions('');
      setRevImpressions('');
      setRevExternalRef('');
      setRevNotes('');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar receita.');
    } finally {
      setSubmittingRev(false);
    }
  };

  const handleConfirmRevenue = async (revenueId: string) => {
    setBusyActionId(revenueId);
    setError(null);
    setFeedback(null);
    try {
      const rev = await confirmPendingRevenueApi({
        revenueId,
        idempotencyKey: `conf_${revenueId}`,
      });
      setFeedback(
        `Receita confirmada: ${formatBRL(rev.artistShareCents)} para artista e ${formatBRL(rev.platformShareCents)} para a plataforma.`
      );
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao confirmar receita.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleCancelPendingRevenue = async (revenueId: string) => {
    setBusyActionId(revenueId);
    setError(null);
    setFeedback(null);
    try {
      await cancelPendingRevenueApi(revenueId, 'Cancelado antes da confirmação pela administração.');
      setFeedback('Lançamento pendente cancelado.');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar receita.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleApproveRequest = async (requestId: string) => {
    setBusyActionId(requestId);
    setError(null);
    setFeedback(null);
    try {
      await reviewPayoutRequestApi({
        requestId,
        decision: 'approve',
        reviewNote: 'Solicitação aprovada. Aguardando transferência manual via Pix.',
      });
      setFeedback('Solicitação de saque aprovada! Agora registre o pagamento Pix quando transferir.');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao aprovar solicitação.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleRejectRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingReqId) return;
    setBusyActionId(rejectingReqId);
    setError(null);
    setFeedback(null);
    try {
      await reviewPayoutRequestApi({
        requestId: rejectingReqId,
        decision: 'reject',
        reviewNote: rejectReason,
      });
      setFeedback('Solicitação rejeitada e saldo devolvido ao disponível do artista.');
      setRejectingReqId(null);
      setRejectReason('');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao rejeitar solicitação.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleReceiptUpload = async (file: File, requestId: string) => {
    setUploadingReceipt(true);
    setError(null);
    const previousReceiptUrl = payReceiptUrl;
    try {
      const uploaded = await uploadMediaAsset({
        file,
        kind: 'receipt',
        mangaId: requestId,
      });
      setPayReceiptUrl(uploaded.url);
      if (previousReceiptUrl && previousReceiptUrl !== uploaded.url) {
        await deleteMediaAsset(previousReceiptUrl).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no envio do comprovante.');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleRemoveReceipt = () => {
    if (!payReceiptUrl) return;
    const toDelete = payReceiptUrl;
    setPayReceiptUrl('');
    void deleteMediaAsset(toDelete).catch(() => {});
  };

  const handleClosePayModal = () => {
    if (payReceiptUrl) {
      void deleteMediaAsset(payReceiptUrl).catch(() => {});
    }
    setPayingReq(null);
    setPayReceiptUrl('');
  };

  const handleRecordPixPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingReq) return;
    setBusyActionId(payingReq.id);
    setError(null);
    setFeedback(null);
    try {
      const payment = await recordManualPixPaymentApi({
        requestId: payingReq.id,
        transactionRef: payTxRef,
        paidDate: payDate,
        amountPaidCents: parseBRLToCents(payAmountText) || payingReq.amountCents,
        receiptUrl: payReceiptUrl,
        notes: payNotes,
        idempotencyKey: `pay_${payingReq.id}`,
      });
      setFeedback(
        `Pagamento Pix de ${formatBRL(payment.amountPaidCents)} registrado com sucesso (Ref: ${payment.transactionRef}).`
      );
      setPayingReq(null);
      setPayTxRef('');
      setPayReceiptUrl('');
      setPayNotes('');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar pagamento Pix.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleReleasePendingCredit = async (entryId: string) => {
    setBusyActionId(entryId);
    setError(null);
    setFeedback(null);
    try {
      await releasePendingLedgerCreditApi(entryId);
      setFeedback('Saldo liberado para saque do criador.');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao liberar saldo.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleCreateAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingAdj) return;
    const cents = parseBRLToCents(adjAmountText);
    if (cents <= 0) {
      setError('Informe um valor positivo em reais para o ajuste.');
      return;
    }

    setSubmittingAdj(true);
    setError(null);
    setFeedback(null);
    try {
      await createManualAdjustmentApi({
        creatorId: adjCreatorId,
        direction: adjDirection,
        bucket: adjBucket,
        amountCents: cents,
        justification: adjJustification,
        mangaId: adjMangaId || undefined,
        idempotencyKey: `adj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      });
      setFeedback('Ajuste financeiro registrado no livro-razão.');
      setAdjAmountText('');
      setAdjJustification('');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar ajuste financeiro.');
    } finally {
      setSubmittingAdj(false);
    }
  };

  const handleReverseEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversingEntry) return;
    setBusyActionId(reversingEntry.id);
    setError(null);
    setFeedback(null);
    try {
      await reverseLedgerEntryApi({
        originalEntryId: reversingEntry.id,
        justification: reversalJustification,
        idempotencyKey: `rev_${reversingEntry.id}`,
      });
      setFeedback(`Lançamento ${reversingEntry.id} estornado com sucesso.`);
      setReversingEntry(null);
      setReversalJustification('');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao estornar lançamento.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setError(null);
    setFeedback(null);
    try {
      const artistPercent = Number(artistPercentInput);
      const minWithdrawalCents = parseBRLToCents(minWithdrawalInput);
      const saved = await updateMonetizationSettingsApi({
        artistSharePercent: artistPercent,
        minWithdrawalCents,
      });
      setFeedback(
        `Política atualizada para lançamentos futuros: ${saved.artistSharePercent}% artista / ${saved.platformSharePercent}% plataforma · Saque mínimo ${formatBRL(saved.minWithdrawalCents)}.`
      );
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar configurações.');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading && !dashboard) {
    return (
      <div className="bg-[#111115] border border-white/8 rounded-2xl p-8 text-sm text-zinc-400">
        Carregando módulo financeiro e administrativo de monetização...
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="bg-[#111115] border border-rose-500/30 rounded-2xl p-6 space-y-3">
        <div className="text-sm text-rose-300">{error || 'Erro ao carregar monetização.'}</div>
        <button
          type="button"
          onClick={() => void loadDashboard()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-xs text-white"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Tentar novamente
        </button>
      </div>
    );
  }

  const { overview, revenues, ledger, payoutRequests, payments, creators, mangas, settings } =
    dashboard;

  return (
    <div className="space-y-6">
      {/* Global Financial Overview KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="bg-[#111115] border border-white/8 rounded-2xl p-4">
          <div className="text-[11px] text-zinc-400">Receita Líquida Confirmada</div>
          <div className="font-display text-lg sm:text-xl font-bold font-mono-tabular text-white mt-1">
            {formatBRL(overview.totalConfirmedNetCents)}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            Não atribuída: {formatBRL(overview.totalUnattributedNetCents)}
          </div>
        </div>

        <div className="bg-[#111115] border border-white/8 rounded-2xl p-4">
          <div className="text-[11px] text-zinc-400">Parcela dos Artistas</div>
          <div className="font-display text-lg sm:text-xl font-bold font-mono-tabular text-emerald-400 mt-1">
            {formatBRL(overview.totalArtistsShareCents)}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">Créditos líquidos acumulados</div>
        </div>

        <div className="bg-[#111115] border border-white/8 rounded-2xl p-4">
          <div className="text-[11px] text-zinc-400">Parcela da Plataforma</div>
          <div className="font-display text-lg sm:text-xl font-bold font-mono-tabular text-white mt-1">
            {formatBRL(overview.totalPlatformShareCents)}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">Inclui receitas não atribuídas</div>
        </div>

        <div className="bg-[#111115] border border-amber-500/25 rounded-2xl p-4">
          <div className="text-[11px] text-amber-300">Pendente de Pagamento</div>
          <div className="font-display text-lg sm:text-xl font-bold font-mono-tabular text-amber-300 mt-1">
            {formatBRL(overview.totalPendingPaymentCents)}
          </div>
          <div className="text-[10px] text-zinc-400 mt-1">
            Disp.: {formatBRL(overview.totalArtistAvailableCents)}
          </div>
        </div>

        <div className="bg-[#111115] border border-white/8 rounded-2xl p-4">
          <div className="text-[11px] text-zinc-400">Total Já Pago (Pix)</div>
          <div className="font-display text-lg sm:text-xl font-bold font-mono-tabular text-white mt-1">
            {formatBRL(overview.totalPaidCents)}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">{payments.length} liquidações</div>
        </div>

        <div className="bg-[#111115] border border-[#E11D48]/30 rounded-2xl p-4">
          <div className="text-[11px] text-zinc-300">Saques p/ Analisar</div>
          <div className="font-display text-lg sm:text-xl font-bold font-mono-tabular text-[#E11D48] mt-1">
            {overview.awaitingReviewCount}
          </div>
          <div className="text-[10px] text-zinc-400 mt-1">
            Aprovados p/ Pix: {overview.approvedAwaitingPayCount}
          </div>
        </div>
      </div>

      <ToastPopup
        feedback={feedback}
        error={error}
        onClearFeedback={() => setFeedback(null)}
        onClearError={() => setError(null)}
      />

      {/* Filter Bar + Sub-navigation */}
      <div className="bg-[#111115] border border-white/8 rounded-2xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#08080A] border border-white/8 overflow-x-auto no-scrollbar">
            {[
              { id: 'revenues', label: `Receitas (${revenues.length})`, icon: Coins },
              {
                id: 'payouts',
                label: `Saques & Pix (${payoutRequests.length})`,
                icon: Wallet,
              },
              { id: 'ledger', label: `Livro-Razão & Ajustes (${ledger.length})`, icon: History },
              { id: 'settings', label: `Política (${settings.artistSharePercent}/${settings.platformSharePercent})`, icon: Settings },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    setSubTab(item.id as 'revenues' | 'payouts' | 'ledger' | 'settings')
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    subTab === item.id
                      ? 'bg-[#E11D48] text-white'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/8 hover:bg-white/12 text-xs text-white"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        {/* Detailed Query Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-2 border-t border-white/8">
          <select
            value={filterCreatorId}
            onChange={(e) => setFilterCreatorId(e.target.value)}
            aria-label="Filtrar por artista"
            className="px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
          >
            <option value="">Todos os artistas</option>
            {creators.map((c) => (
              <option key={c.uid} value={c.uid}>
                {c.displayName} (@{c.handle})
              </option>
            ))}
          </select>

          <select
            value={filterMangaId}
            onChange={(e) => setFilterMangaId(e.target.value)}
            aria-label="Filtrar por obra"
            className="px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
          >
            <option value="">Todas as obras</option>
            {mangas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({m.authorName})
              </option>
            ))}
          </select>

          <input
            type="text"
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
            placeholder="Período (ex.: 2026-11)"
            className="px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
          />

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            aria-label="Filtrar por status financeiro"
            className="px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
          >
            <option value="">Todos os status</option>
            <option value="pending">Pendente</option>
            <option value="confirmed">Confirmada</option>
            <option value="available">Disponível</option>
            <option value="approved">Aprovado</option>
            <option value="paid">Pago</option>
            <option value="rejected">Rejeitado</option>
            <option value="reversed">Estornado</option>
            <option value="cancelled">Cancelado</option>
          </select>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white"
            >
              <Filter className="w-3.5 h-3.5" />
              Filtrar
            </button>
            {(filterCreatorId || filterMangaId || filterPeriod || filterStatus) && (
              <button
                type="button"
                onClick={() => {
                  setFilterCreatorId('');
                  setFilterMangaId('');
                  setFilterPeriod('');
                  setFilterStatus('');
                  void loadDashboard({
                    creatorId: '',
                    mangaId: '',
                    referencePeriod: '',
                    status: '',
                  });
                }}
                className="px-3 py-2 rounded-xl bg-white/5 text-xs text-zinc-400 hover:text-white"
              >
                Limpar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* TAB 1: REVENUES */}
      {subTab === 'revenues' && (
        <div className="space-y-6">
          <form
            onSubmit={handleRegisterRevenue}
            className="bg-[#111115] border border-white/8 rounded-2xl p-5 space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#E11D48]" />
                <h2 className="font-display text-base font-bold text-white">
                  Registrar Receita Publicitária Real
                </h2>
              </div>
              <span className="text-xs text-zinc-400">
                Política aplicada na confirmação: {settings.artistSharePercent}% artista /{' '}
                {settings.platformSharePercent}% plataforma
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Atribuição da Receita *
                </label>
                <select
                  value={attributionType}
                  onChange={(e) =>
                    setAttributionType(e.target.value as MonetizationAttributionType)
                  }
                  className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
                >
                  <option value="work">Atribuída a uma Obra (divisão {settings.artistSharePercent}/{settings.platformSharePercent})</option>
                  <option value="unattributed">
                    Não Atribuída (sem divisão por obra — 100% plataforma)
                  </option>
                </select>
              </div>

              {attributionType === 'work' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      Obra Associada *
                    </label>
                    <select
                      required
                      value={revMangaId}
                      onChange={(e) => setRevMangaId(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
                    >
                      <option value="">Selecione a obra...</option>
                      {mangas.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title} — {m.authorName} ({m.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      Capítulo (opcional)
                    </label>
                    <select
                      value={revChapterId}
                      onChange={(e) => setRevChapterId(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
                    >
                      <option value="">Receita geral da obra</option>
                      {mangaChapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          Cap. {c.chapterNumber} — {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Período de Referência *
                </label>
                <input
                  type="text"
                  required
                  value={revPeriod}
                  onChange={(e) => setRevPeriod(e.target.value)}
                  placeholder="Ex.: 2026-11"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Fonte dos Dados *
                </label>
                <input
                  type="text"
                  required
                  value={revSource}
                  onChange={(e) => setRevSource(e.target.value)}
                  placeholder="Ex.: Google AdSense, Rede X..."
                  className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Referência Externa (anti-duplicidade)
                </label>
                <input
                  type="text"
                  value={revExternalRef}
                  onChange={(e) => setRevExternalRef(e.target.value)}
                  placeholder="ID do relatório/lote"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Impressões Publicitárias (opcional)
                </label>
                <input
                  type="number"
                  min={0}
                  value={revImpressions}
                  onChange={(e) => setRevImpressions(e.target.value)}
                  placeholder="Ex.: 12500"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs font-mono-tabular text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Receita Bruta Informada R$ (opcional)
                </label>
                <input
                  type="text"
                  value={revGross}
                  onChange={(e) => setRevGross(e.target.value)}
                  placeholder="Ex.: 115,00"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs font-mono-tabular text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Descontos / Ajustes Rede R$ (opcional)
                </label>
                <input
                  type="text"
                  value={revDeductions}
                  onChange={(e) => setRevDeductions(e.target.value)}
                  placeholder="Ex.: 15,00"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs font-mono-tabular text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-emerald-300 mb-1">
                  Receita Líquida Recebida R$ *
                </label>
                <input
                  type="text"
                  required
                  value={revNet}
                  onChange={(e) => setRevNet(e.target.value)}
                  placeholder="Ex.: 100,00"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-emerald-500/40 text-xs font-mono-tabular text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Status de Confirmação
                </label>
                <select
                  value={revConfirmNow ? 'confirm' : 'pending'}
                  onChange={(e) => setRevConfirmNow(e.target.value === 'confirm')}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
                >
                  <option value="confirm">Confirmada agora (executar divisão e creditar)</option>
                  <option value="pending">Pendente (registrar sem creditar ainda)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Destino do Crédito do Artista
                </label>
                <select
                  value={revReleaseBucket}
                  onChange={(e) =>
                    setRevReleaseBucket(e.target.value as MonetizationCreditReleaseBucket)
                  }
                  disabled={attributionType === 'unattributed'}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white disabled:opacity-40"
                >
                  <option value="available">Disponível para saque imediatamente</option>
                  <option value="pending">Saldo pendente (aguardando liberação)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Observações</label>
                <input
                  type="text"
                  value={revNotes}
                  onChange={(e) => setRevNotes(e.target.value)}
                  placeholder="Notas internas do lançamento"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submittingRev}
              className="px-5 py-2.5 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-semibold disabled:opacity-50"
            >
              {submittingRev ? 'Registrando...' : 'Registrar Receita Publicitária'}
            </button>
          </form>

          {/* Revenues Table */}
          <div className="bg-[#111115] border border-white/8 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-white/8 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#E11D48]" />
              <h3 className="font-display text-sm font-bold text-white">
                Receitas Registradas ({revenues.length})
              </h3>
            </div>
            {revenues.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500">
                Nenhuma receita encontrada para os filtros selecionados.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#08080A] text-zinc-400 border-b border-white/8">
                    <tr>
                      <th className="px-4 py-3 font-medium">Obra / Atribuição</th>
                      <th className="px-4 py-3 font-medium">Período / Fonte</th>
                      <th className="px-4 py-3 font-medium">Receita Líquida</th>
                      <th className="px-4 py-3 font-medium">Divisão</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6">
                    {revenues.map((r) => (
                      <tr key={r.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-white">
                            {r.attributionType === 'unattributed'
                              ? 'Receita Não Atribuída'
                              : r.mangaTitle}
                          </div>
                          <div className="text-[11px] text-zinc-400">
                            {r.attributionType === 'unattributed'
                              ? 'Sem atribuição confiável por obra'
                              : `${r.creatorName}${r.chapterId ? ` · Cap. ${r.chapterNumber}` : ''}`}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-zinc-300">
                          <div className="font-mono-tabular">{r.referencePeriod}</div>
                          <div className="text-[11px] text-zinc-500">
                            {r.source}
                            {r.hasAdImpressions ? ` · ${r.adImpressions.toLocaleString('pt-BR')} imp.` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono-tabular font-semibold text-white">
                          {formatBRL(r.netRevenueCents)}
                          {r.hasGrossRevenue && (
                            <div className="text-[10px] font-normal text-zinc-500">
                              Bruto: {formatBRL(r.grossRevenueCents)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-zinc-300">
                          {r.confirmationStatus === 'confirmed' ? (
                            <div>
                              <span className="text-emerald-400">
                                {formatBRL(r.artistShareCents)} ({r.artistPercentApplied}%)
                              </span>
                              <div className="text-[10px] text-zinc-500">
                                Plat.: {formatBRL(r.platformShareCents)} ({r.platformPercentApplied}%)
                              </div>
                            </div>
                          ) : (
                            <span className="text-zinc-500">Aguardando confirmação</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                              r.confirmationStatus === 'confirmed'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : r.confirmationStatus === 'pending'
                                ? 'bg-amber-500/15 text-amber-300'
                                : 'bg-zinc-500/15 text-zinc-400'
                            }`}
                          >
                            {r.confirmationStatus === 'confirmed'
                              ? 'Confirmada'
                              : r.confirmationStatus === 'pending'
                              ? 'Pendente'
                              : 'Cancelada'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {r.confirmationStatus === 'pending' && (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busyActionId === r.id}
                                onClick={() => void handleConfirmRevenue(r.id)}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[11px] font-semibold"
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                disabled={busyActionId === r.id}
                                onClick={() => void handleCancelPendingRevenue(r.id)}
                                className="px-2.5 py-1.5 rounded-lg bg-white/8 hover:bg-rose-500/20 text-zinc-300 hover:text-rose-300 text-[11px]"
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: PAYOUT REQUESTS & MANUAL PIX */}
      {subTab === 'payouts' && (
        <div className="space-y-6">
          {/* Manual Pix Payment Modal / Inline Card */}
          {payingReq && (
            <form
              onSubmit={handleRecordPixPayment}
              className="bg-[#111115] border border-emerald-500/40 rounded-2xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold text-white">
                  Registrar Pagamento Manual via Pix — {payingReq.creatorName}
                </h3>
                <button
                  type="button"
                  onClick={handleClosePayModal}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Fechar
                </button>
              </div>

              <div className="p-3 rounded-xl bg-[#08080A] border border-white/8 text-xs text-zinc-300 space-y-1">
                <div>
                  Favorecido: <strong className="text-white">{payingReq.beneficiaryNameSnapshot}</strong>
                </div>
                <div>
                  Chave Pix ({payingReq.pixKeyTypeSnapshot.toUpperCase()}):{' '}
                  <code className="text-emerald-300 font-mono-tabular">
                    {payingReq.pixKeySnapshot}
                  </code>
                  {payingReq.pixBankNameSnapshot ? ` · ${payingReq.pixBankNameSnapshot}` : ''}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Valor Pago R$ *
                  </label>
                  <input
                    type="text"
                    required
                    value={payAmountText}
                    onChange={(e) => setPayAmountText(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs font-mono-tabular text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Data do Pagamento *
                  </label>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Referência / ID E2E da Transação Pix *
                  </label>
                  <input
                    type="text"
                    required
                    value={payTxRef}
                    onChange={(e) => setPayTxRef(e.target.value)}
                    placeholder="Ex.: E1234567820261117..."
                    className="w-full px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs font-mono-tabular text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Observações do Pagamento
                  </label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    placeholder="Observações opcionais"
                    className="w-full px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Comprovante Pix (JPG, PNG, WebP ou PDF)
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      {uploadingReceipt ? 'Enviando...' : payReceiptUrl ? 'Trocar Arquivo' : 'Anexar Comprovante'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleReceiptUpload(f, payingReq.id);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {payReceiptUrl && (
                      <>
                        <a
                          href={payReceiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-emerald-400 underline truncate"
                        >
                          Comprovante anexado
                        </a>
                        <button
                          type="button"
                          onClick={handleRemoveReceipt}
                          className="text-xs text-rose-400 hover:text-rose-300 shrink-0"
                        >
                          Remover
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={busyActionId === payingReq.id || uploadingReceipt}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50"
              >
                {busyActionId === payingReq.id
                  ? 'Registrando liquidação...'
                  : 'Confirmar Pagamento Pix Realizado'}
              </button>
            </form>
          )}

          {/* Reject Modal / Inline Card */}
          {rejectingReqId && (
            <form
              onSubmit={handleRejectRequest}
              className="bg-[#111115] border border-rose-500/40 rounded-2xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-white">
                  Rejeitar Solicitação de Saque
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setRejectingReqId(null);
                    setRejectReason('');
                  }}
                  className="text-xs text-zinc-400"
                >
                  Cancelar
                </button>
              </div>
              <input
                type="text"
                required
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Informe o motivo obrigatório (ex.: chave Pix divergente do titular)..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
              />
              <button
                type="submit"
                disabled={busyActionId === rejectingReqId}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
              >
                Confirmar Rejeição e Devolver Saldo
              </button>
            </form>
          )}

          {/* Requests List */}
          <div className="bg-[#111115] border border-white/8 rounded-2xl overflow-hidden divide-y divide-white/8">
            <div className="p-4 font-display text-sm font-bold text-white">
              Solicitações de Saque ({payoutRequests.length})
            </div>
            {payoutRequests.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500">
                Nenhuma solicitação de saque encontrada.
              </div>
            ) : (
              payoutRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-base font-bold font-mono-tabular text-white">
                        {formatBRL(req.amountCents)}
                      </span>
                      <span className="text-sm font-semibold text-zinc-200">{req.creatorName}</span>
                      <span className="px-2 py-0.5 rounded-md bg-white/8 text-[11px] text-zinc-200">
                        {PAYOUT_STATUS_LABEL[req.status]}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-400">
                      Pix ({req.pixKeyTypeSnapshot.toUpperCase()}):{' '}
                      <code className="text-zinc-200 font-mono-tabular">{req.pixKeySnapshot}</code>
                      {' · '}Titular: {req.beneficiaryNameSnapshot}
                      {req.pixBankNameSnapshot ? ` · ${req.pixBankNameSnapshot}` : ''}
                    </div>
                    {req.reviewNote && (
                      <div className="text-[11px] text-zinc-500">Nota: {req.reviewNote}</div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {req.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          disabled={busyActionId === req.id}
                          onClick={() => void handleApproveRequest(req.id)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-xs font-semibold"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Aprovar
                        </button>
                        <button
                          type="button"
                          disabled={busyActionId === req.id}
                          onClick={() => {
                            setRejectingReqId(req.id);
                            setRejectReason('');
                          }}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Rejeitar
                        </button>
                      </>
                    )}

                    {req.status === 'approved' && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setPayingReq(req);
                            setPayAmountText((req.amountCents / 100).toFixed(2).replace('.', ','));
                            setPayTxRef('');
                            setPayReceiptUrl('');
                            setPayNotes('');
                          }}
                          className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                        >
                          Registrar Pagamento Pix
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectingReqId(req.id);
                            setRejectReason('');
                          }}
                          className="px-3 py-2 rounded-xl bg-white/8 hover:bg-rose-500/20 text-zinc-300 hover:text-rose-300 text-xs"
                        >
                          Rejeitar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Recorded Manual Payments */}
          {payments.length > 0 && (
            <div className="bg-[#111115] border border-white/8 rounded-2xl overflow-hidden divide-y divide-white/8">
              <div className="p-4 font-display text-sm font-bold text-white">
                Comprovantes e Pagamentos Pix Realizados ({payments.length})
              </div>
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <span className="font-mono-tabular font-bold text-emerald-400">
                      {formatBRL(p.amountPaidCents)}
                    </span>{' '}
                    para <strong className="text-white">{p.creatorName}</strong> · Data: {p.paidDate} ·
                    Ref: <code className="text-zinc-300 font-mono-tabular">{p.transactionRef}</code>
                  </div>
                  {p.receiptUrl && (
                    <a
                      href={p.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-300 underline"
                    >
                      Abrir Comprovante
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: IMMUTABLE LEDGER, RELEASES, ADJUSTMENTS & REVERSALS */}
      {subTab === 'ledger' && (
        <div className="space-y-6">
          {/* Manual Adjustment Form */}
          <form
            onSubmit={handleCreateAdjustment}
            className="bg-[#111115] border border-white/8 rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[#E11D48]" />
              <h2 className="font-display text-base font-bold text-white">
                Registrar Ajuste Financeiro (com Justificativa Obrigatória)
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <select
                required
                value={adjCreatorId}
                onChange={(e) => setAdjCreatorId(e.target.value)}
                className="px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
              >
                <option value="">Selecione o artista...</option>
                {creators.map((c) => (
                  <option key={c.uid} value={c.uid}>
                    {c.displayName} (@{c.handle})
                  </option>
                ))}
              </select>

              <select
                value={adjDirection}
                onChange={(e) => setAdjDirection(e.target.value as 'credit' | 'debit')}
                className="px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
              >
                <option value="credit">Crédito (+)</option>
                <option value="debit">Débito (-)</option>
              </select>

              <select
                value={adjBucket}
                onChange={(e) =>
                  setAdjBucket(e.target.value as MonetizationCreditReleaseBucket)
                }
                className="px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
              >
                <option value="available">Saldo Disponível</option>
                <option value="pending">Saldo Pendente</option>
              </select>

              <input
                type="text"
                required
                value={adjAmountText}
                onChange={(e) => setAdjAmountText(e.target.value)}
                placeholder="Valor R$ (ex.: 25,00)"
                className="px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs font-mono-tabular text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select
                value={adjMangaId}
                onChange={(e) => setAdjMangaId(e.target.value)}
                className="px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
              >
                <option value="">Obra associada (opcional)</option>
                {mangas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>

              <input
                type="text"
                required
                value={adjJustification}
                onChange={(e) => setAdjJustification(e.target.value)}
                placeholder="Justificativa obrigatória para auditoria..."
                className="sm:col-span-2 px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
              />
            </div>

            <button
              type="submit"
              disabled={submittingAdj}
              className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold disabled:opacity-50"
            >
              {submittingAdj ? 'Registrando ajuste...' : 'Registrar Ajuste no Livro-Razão'}
            </button>
          </form>

          {reversingEntry && (
            <form
              onSubmit={handleReverseEntry}
              className="bg-[#111115] border border-rose-500/40 rounded-2xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-white">
                  Estornar Lançamento {reversingEntry.id} ({formatBRL(reversingEntry.amountCents)})
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setReversingEntry(null);
                    setReversalJustification('');
                  }}
                  className="text-xs text-zinc-400"
                >
                  Cancelar
                </button>
              </div>
              <input
                type="text"
                required
                value={reversalJustification}
                onChange={(e) => setReversalJustification(e.target.value)}
                placeholder="Justificativa obrigatória do estorno (ex.: ajuste retroativo da rede de anúncios)..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
              />
              <button
                type="submit"
                disabled={busyActionId === reversingEntry.id}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
              >
                Confirmar Estorno Imutável
              </button>
            </form>
          )}

          {/* Ledger Table */}
          <div className="bg-[#111115] border border-white/8 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-white/8 font-display text-sm font-bold text-white">
              Livro-Razão Contábil Imutável ({ledger.length})
            </div>
            {ledger.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500">
                Nenhum lançamento encontrado no razão.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#08080A] text-zinc-400 border-b border-white/8">
                    <tr>
                      <th className="px-4 py-3 font-medium">Data</th>
                      <th className="px-4 py-3 font-medium">Tipo</th>
                      <th className="px-4 py-3 font-medium">Artista / Obra</th>
                      <th className="px-4 py-3 font-medium">Valor</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6">
                    {ledger.map((l) => (
                      <tr key={l.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-mono-tabular text-zinc-400 whitespace-nowrap">
                          {l.createdAt ? new Date(l.createdAt).toLocaleDateString('pt-BR') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-white">{LEDGER_TYPE_LABEL[l.type]}</div>
                          {l.originalEntryId && (
                            <div className="text-[10px] text-zinc-500 font-mono-tabular">
                              Ref. orig.: {l.originalEntryId}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-300">
                          <div>
                            {l.creatorName || 'Plataforma'}
                            {l.mangaTitle ? ` · ${l.mangaTitle}` : ''}
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            {l.justification || l.origin}
                          </div>
                        </td>
                        <td
                          className={`px-4 py-3 font-mono-tabular font-semibold whitespace-nowrap ${
                            l.amountCents >= 0 ? 'text-emerald-400' : 'text-rose-300'
                          }`}
                        >
                          {l.amountCents >= 0 ? '+' : ''}
                          {formatBRL(l.amountCents)}
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{l.status}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {l.type === 'revenue_credit' && l.status === 'pending' && (
                              <button
                                type="button"
                                disabled={busyActionId === l.id}
                                onClick={() => void handleReleasePendingCredit(l.id)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[11px] font-medium"
                              >
                                Liberar Saldo
                              </button>
                            )}
                            {l.status !== 'reversed' &&
                              l.amountCents > 0 &&
                              (l.type === 'revenue_credit' || l.type === 'adjustment') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReversingEntry(l);
                                    setReversalJustification('');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/8 hover:bg-rose-500/20 text-zinc-300 hover:text-rose-300 text-[11px]"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  Estornar
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: POLICY SETTINGS */}
      {subTab === 'settings' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-[#111115] border border-white/8 rounded-2xl p-6 space-y-5 max-w-2xl"
        >
          <div className="space-y-1">
            <h2 className="font-display text-lg font-bold text-white">
              Configuração de Divisão de Ganhos e Saque
            </h2>
            <p className="text-xs text-zinc-400">
              Alterações nesta política afetam exclusivamente novos lançamentos confirmados no
              futuro. Valores e percentuais de registros históricos permanecem preservados.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Parcela do Artista (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                required
                value={artistPercentInput}
                onChange={(e) => setArtistPercentInput(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm font-mono-tabular text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Parcela da Plataforma (%)
              </label>
              <input
                type="text"
                readOnly
                value={`${Math.max(0, 100 - (Number(artistPercentInput) || 0))}%`}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/8 text-sm font-mono-tabular text-zinc-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Saque Mínimo (R$)
              </label>
              <input
                type="text"
                required
                value={minWithdrawalInput}
                onChange={(e) => setMinWithdrawalInput(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm font-mono-tabular text-white"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={savingSettings}
            className="px-5 py-2.5 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-semibold disabled:opacity-50"
          >
            {savingSettings ? 'Salvando política...' : 'Salvar Política de Monetização'}
          </button>
        </form>
      )}
    </div>
  );
}
