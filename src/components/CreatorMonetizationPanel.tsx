import React, { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  BookOpen,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  KeyRound,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { ToastPopup } from './ToastPopup';
import {
  fetchCreatorMonetizationDashboard,
  requestCreatorWithdrawalApi,
  saveCreatorPayoutProfileApi,
} from '../services/monetizationService';
import {
  CreatorMonetizationDashboard,
  MonetizationLedgerType,
  MonetizationPayoutStatus,
  MonetizationPixKeyType,
  formatBRL,
  parseBRLToCents,
} from '../types/monetization';

const PIX_KEY_LABELS: Record<MonetizationPixKeyType, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'E-mail',
  phone: 'Telefone',
  random: 'Chave Aleatória',
};

const PAYOUT_STATUS_LABEL: Record<MonetizationPayoutStatus, string> = {
  pending: 'Aguardando análise',
  approved: 'Aprovado (aguardando Pix)',
  paid: 'Pago via Pix',
  rejected: 'Rejeitado',
};

const PAYOUT_STATUS_CLASS: Record<MonetizationPayoutStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  approved: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  paid: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

const LEDGER_TYPE_LABEL: Record<MonetizationLedgerType, string> = {
  revenue_credit: 'Crédito de Receita',
  platform_fee: 'Taxa da Plataforma',
  unattributed_revenue: 'Receita Não Atribuída',
  pending_release: 'Liberação de Saldo Pendente',
  withdrawal_hold: 'Reserva para Saque',
  withdrawal_release: 'Devolução por Saque Rejeitado',
  payout_paid: 'Pagamento Pix Realizado',
  adjustment: 'Ajuste Financeiro',
  reversal: 'Estorno',
};

export function CreatorMonetizationPanel() {
  const [dashboard, setDashboard] = useState<CreatorMonetizationDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Pix profile form
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [pixKeyType, setPixKeyType] = useState<MonetizationPixKeyType>('cpf');
  const [pixKey, setPixKey] = useState('');
  const [pixBankName, setPixBankName] = useState('');
  const [savingPix, setSavingPix] = useState(false);

  // Withdrawal form
  const [withdrawAmountText, setWithdrawAmountText] = useState('');
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCreatorMonetizationDashboard();
      setDashboard(data);
      if (data.payoutProfile) {
        setBeneficiaryName(data.payoutProfile.beneficiaryName);
        setPixKeyType(data.payoutProfile.pixKeyType);
        setPixKey(data.payoutProfile.pixKey);
        setPixBankName(data.payoutProfile.pixBankName || '');
      }
      if (data.balance.availableCents > 0 && !withdrawAmountText) {
        setWithdrawAmountText((data.balance.availableCents / 100).toFixed(2).replace('.', ','));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Não foi possível carregar os dados financeiros.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const handleSavePixProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPix(true);
    setError(null);
    setFeedback(null);
    try {
      const saved = await saveCreatorPayoutProfileApi({
        beneficiaryName,
        pixKeyType,
        pixKey,
        pixBankName,
      });
      setDashboard((prev) => (prev ? { ...prev, payoutProfile: saved } : prev));
      setFeedback('Dados Pix para recebimento salvos com segurança.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar dados Pix.');
    } finally {
      setSavingPix(false);
    }
  };

  const handleRequestWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dashboard || submittingWithdrawal) return;
    const cents = parseBRLToCents(withdrawAmountText);
    if (cents <= 0) {
      setError('Informe um valor válido em reais para solicitar saque.');
      return;
    }

    setSubmittingWithdrawal(true);
    setError(null);
    setFeedback(null);
    try {
      const idempotencyKey = `wd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      await requestCreatorWithdrawalApi({
        amountCents: cents,
        idempotencyKey,
      });
      setFeedback(
        `Solicitação de saque no valor de ${formatBRL(cents)} enviada para análise administrativa.`
      );
      setWithdrawAmountText('');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao solicitar saque.');
    } finally {
      setSubmittingWithdrawal(false);
    }
  };

  if (loading && !dashboard) {
    return (
      <div className="bg-[#111115] border border-white/8 rounded-2xl p-8 text-sm text-zinc-400">
        Carregando extrato financeiro e saldo do criador...
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

  const { settings, balance, payoutProfile, workPerformance, revenues, ledger, payoutRequests, payments } =
    dashboard;

  const canWithdraw =
    Boolean(payoutProfile) && balance.availableCents >= settings.minWithdrawalCents;

  const paymentsByRequestId = new Map(payments.map((p) => [p.requestId, p]));

  return (
    <div className="space-y-6">
      {/* Policy Banner */}
      <div className="bg-[#111115] border border-white/8 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldCheck className="w-4 h-4 text-[#E11D48]" />
            Contabilização Oficial de Receitas Publicitárias
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed max-w-3xl">
            Os créditos financeiros refletem apenas receitas publicitárias reais e confirmadas pela
            plataforma (política vigente: <strong className="text-zinc-200">{settings.artistSharePercent}% artista / {settings.platformSharePercent}% plataforma</strong>).
            Obras concluídas ou antigas continuam elegíveis sempre que gerarem anúncios monetizados.
            Saques são analisados e transferidos manualmente via Pix a partir de{' '}
            <strong className="text-zinc-200">{formatBRL(settings.minWithdrawalCents)}</strong>.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadDashboard()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/12 text-xs font-medium text-white self-start sm:self-center shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <ToastPopup
        feedback={feedback}
        error={error}
        onClearFeedback={() => setFeedback(null)}
        onClearError={() => setError(null)}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-[#111115] border border-white/8 rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <DollarSign className="w-3.5 h-3.5 text-zinc-400" />
            Ganhos Acumulados
          </div>
          <div className="font-display text-xl sm:text-2xl font-bold font-mono-tabular text-white mt-1.5">
            {formatBRL(balance.totalEarnedCents)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">Receitas confirmadas líquidas</div>
        </div>

        <div className="bg-[#111115] border border-white/8 rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            Saldo Pendente
          </div>
          <div className="font-display text-xl sm:text-2xl font-bold font-mono-tabular text-amber-300 mt-1.5">
            {formatBRL(balance.pendingCents)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">Aguardando liberação p/ saque</div>
        </div>

        <div className="bg-[#111115] border border-emerald-500/25 rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-emerald-300">
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            Disponível p/ Saque
          </div>
          <div className="font-display text-xl sm:text-2xl font-bold font-mono-tabular text-emerald-400 mt-1.5">
            {formatBRL(balance.availableCents)}
          </div>
          <div className="text-[11px] text-zinc-400 mt-1">
            Mínimo: {formatBRL(settings.minWithdrawalCents)}
          </div>
        </div>

        <div className="bg-[#111115] border border-white/8 rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <ArrowDownToLine className="w-3.5 h-3.5 text-sky-400" />
            Em Análise de Saque
          </div>
          <div className="font-display text-xl sm:text-2xl font-bold font-mono-tabular text-sky-300 mt-1.5">
            {formatBRL(balance.withdrawalPendingCents)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">Solicitações em andamento</div>
        </div>

        <div className="bg-[#111115] border border-white/8 rounded-2xl p-4 col-span-2 lg:col-span-1">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" />
            Total Já Recebido
          </div>
          <div className="font-display text-xl sm:text-2xl font-bold font-mono-tabular text-white mt-1.5">
            {formatBRL(balance.totalPaidCents)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">Transferências Pix liquidadas</div>
        </div>
      </div>

      {/* Pix Details + Withdrawal Request */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pix Payout Profile */}
        <form
          onSubmit={handleSavePixProfile}
          className="bg-[#111115] border border-white/8 rounded-2xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-[#E11D48]" />
              <h2 className="font-display text-base font-bold text-white">
                Dados Pix para Recebimento
              </h2>
            </div>
            {payoutProfile && (
              <span className="text-[11px] text-emerald-400 font-medium">Cadastrado</span>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Nome completo / Razão social do favorecido *
              </label>
              <input
                type="text"
                required
                value={beneficiaryName}
                onChange={(e) => setBeneficiaryName(e.target.value)}
                placeholder="Ex.: Maria Oliveira Silva"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white focus:outline-none focus:border-[#E11D48]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Tipo de Chave *
                </label>
                <select
                  value={pixKeyType}
                  onChange={(e) => setPixKeyType(e.target.value as MonetizationPixKeyType)}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white focus:outline-none focus:border-[#E11D48]"
                >
                  {Object.entries(PIX_KEY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-zinc-300 mb-1">Chave Pix *</label>
                <input
                  type="text"
                  required
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  placeholder="Informe sua chave Pix"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white focus:outline-none focus:border-[#E11D48]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Banco / Instituição (opcional)
              </label>
              <input
                type="text"
                value={pixBankName}
                onChange={(e) => setPixBankName(e.target.value)}
                placeholder="Ex.: Nubank, Banco Inter, Itaú..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white focus:outline-none focus:border-[#E11D48]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={savingPix}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold disabled:opacity-50"
          >
            {savingPix ? 'Salvando...' : payoutProfile ? 'Atualizar Dados Pix' : 'Salvar Dados Pix'}
          </button>
        </form>

        {/* Withdrawal Request Form */}
        <form
          onSubmit={handleRequestWithdrawal}
          className="bg-[#111115] border border-white/8 rounded-2xl p-5 space-y-4 flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ArrowDownToLine className="w-4 h-4 text-[#E11D48]" />
                <h2 className="font-display text-base font-bold text-white">Solicitar Saque via Pix</h2>
              </div>
              <span className="text-xs font-mono-tabular text-zinc-400">
                Disponível: <strong className="text-emerald-400">{formatBRL(balance.availableCents)}</strong>
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Ao solicitar o saque, o valor fica reservado enquanto o administrador realiza a análise
              e efetua o pagamento manual para a sua chave Pix cadastrada.
            </p>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-zinc-300">Valor do saque (R$)</label>
                {balance.availableCents > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setWithdrawAmountText(
                        (balance.availableCents / 100).toFixed(2).replace('.', ',')
                      )
                    }
                    className="text-[11px] text-[#E11D48] hover:underline"
                  >
                    Usar saldo total disponível
                  </button>
                )}
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={withdrawAmountText}
                onChange={(e) => setWithdrawAmountText(e.target.value)}
                placeholder="Ex.: 50,00"
                disabled={!canWithdraw}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm font-mono-tabular text-white focus:outline-none focus:border-[#E11D48] disabled:opacity-50"
              />
            </div>

            {!payoutProfile && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200">
                Cadastre sua chave Pix ao lado para habilitar solicitações de saque.
              </div>
            )}

            {payoutProfile && balance.availableCents < settings.minWithdrawalCents && (
              <div className="p-3 rounded-xl bg-white/5 border border-white/8 text-xs text-zinc-400">
                Você precisa de pelo menos <strong className="text-zinc-200">{formatBRL(settings.minWithdrawalCents)}</strong>{' '}
                disponíveis para solicitar um saque.
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!canWithdraw || submittingWithdrawal}
            className="w-full py-3 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submittingWithdrawal ? 'Registrando solicitação...' : 'Solicitar Saque via Pix'}
          </button>
        </form>
      </div>

      {/* Performance by Work */}
      <section className="bg-[#111115] border border-white/8 rounded-2xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#E11D48]" />
            <h2 className="font-display text-base font-bold text-white">
              Desempenho Financeiro por Obra
            </h2>
          </div>
          <span className="text-xs text-zinc-400 font-mono-tabular">
            {workPerformance.length} {workPerformance.length === 1 ? 'obra' : 'obras'}
          </span>
        </div>

        {workPerformance.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500">
            Nenhuma receita atribuída às suas obras ainda. Quando receitas publicitárias forem
            registradas pela administração, o detalhamento por obra aparecerá aqui.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#08080A] text-zinc-400 border-b border-white/8">
                <tr>
                  <th className="px-4 py-3 font-medium">Obra</th>
                  <th className="px-4 py-3 font-medium">Lançamentos</th>
                  <th className="px-4 py-3 font-medium">Receita Líquida Confirmada</th>
                  <th className="px-4 py-3 font-medium">Sua Parcela Confirmada</th>
                  <th className="px-4 py-3 font-medium">Em Retenção</th>
                  <th className="px-4 py-3 font-medium">Em Confirmação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {workPerformance.map((w) => (
                  <tr key={w.mangaId} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-semibold text-white">{w.mangaTitle}</td>
                    <td className="px-4 py-3 font-mono-tabular text-zinc-400">{w.entriesCount}</td>
                    <td className="px-4 py-3 font-mono-tabular text-zinc-300">
                      {formatBRL(w.confirmedNetRevenueCents)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular font-semibold text-emerald-400">
                      {formatBRL(w.artistShareCents)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-amber-300">
                      {formatBRL(w.pendingArtistShareCents)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-zinc-500">
                      {w.unconfirmedRevenueCents > 0
                        ? `${formatBRL(w.unconfirmedRevenueCents)} (não confirmado)`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Withdrawal Requests */}
      <section className="bg-[#111115] border border-white/8 rounded-2xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-[#E11D48]" />
            <h2 className="font-display text-base font-bold text-white">Solicitações de Saque</h2>
          </div>
          <span className="text-xs text-zinc-400 font-mono-tabular">
            {payoutRequests.length} {payoutRequests.length === 1 ? 'solicitação' : 'solicitações'}
          </span>
        </div>

        {payoutRequests.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500">
            Você ainda não possui solicitações de saque registradas.
          </div>
        ) : (
          <div className="divide-y divide-white/8">
            {payoutRequests.map((req) => {
              const payment = paymentsByRequestId.get(req.id);
              return (
                <div
                  key={req.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-base font-bold font-mono-tabular text-white">
                        {formatBRL(req.amountCents)}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md border text-[11px] font-medium ${PAYOUT_STATUS_CLASS[req.status]}`}
                      >
                        {PAYOUT_STATUS_LABEL[req.status]}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-400">
                      Pix ({PIX_KEY_LABELS[req.pixKeyTypeSnapshot]}):{' '}
                      <span className="text-zinc-200 font-mono-tabular">{req.pixKeySnapshot}</span>
                      {' · '}Favorecido: {req.beneficiaryNameSnapshot}
                    </div>
                    {req.reviewNote && (
                      <div className="text-xs text-zinc-400">
                        Observação da análise: <span className="text-zinc-200">{req.reviewNote}</span>
                      </div>
                    )}
                    {payment && (
                      <div className="text-xs text-emerald-300 flex flex-wrap items-center gap-3 pt-0.5">
                        <span>
                          Pago em {payment.paidDate} · Ref: <code className="font-mono-tabular">{payment.transactionRef}</code>
                        </span>
                        {payment.receiptUrl && (
                          <a
                            href={payment.receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 underline text-emerald-200 hover:text-white"
                          >
                            Ver comprovante
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="text-[11px] text-zinc-500 font-mono-tabular shrink-0">
                    {req.createdAt
                      ? new Date(req.createdAt).toLocaleString('pt-BR')
                      : 'Registrado'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Earnings & Immutable Ledger History */}
      <section className="bg-[#111115] border border-white/8 rounded-2xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-white">
              Histórico de Ganhos e Movimentações
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Registro contábil imutável com percentuais aplicados na data de confirmação.
            </p>
          </div>
          <span className="text-xs text-zinc-400 font-mono-tabular">
            {ledger.length} movimentações · {revenues.filter((r) => r.confirmationStatus === 'pending').length} aguardando confirmação
          </span>
        </div>

        {ledger.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500">
            Nenhuma movimentação financeira registrada até o momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#08080A] text-zinc-400 border-b border-white/8">
                <tr>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Obra / Origem</th>
                  <th className="px-4 py-3 font-medium">Divisão Aplicada</th>
                  <th className="px-4 py-3 font-medium">Valor</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {ledger
                  .filter((entry) => entry.type !== 'platform_fee')
                  .map((entry) => (
                    <tr key={entry.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-mono-tabular text-zinc-400 whitespace-nowrap">
                        {entry.createdAt
                          ? new Date(entry.createdAt).toLocaleDateString('pt-BR')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 font-medium text-white">
                        {LEDGER_TYPE_LABEL[entry.type]}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        <div>{entry.mangaTitle || entry.origin}</div>
                        {entry.justification && (
                          <div className="text-[11px] text-zinc-500 mt-0.5">
                            {entry.justification}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-zinc-400">
                        {entry.artistPercentApplied > 0
                          ? `${entry.artistPercentApplied}% artista`
                          : '—'}
                      </td>
                      <td
                        className={`px-4 py-3 font-mono-tabular font-semibold whitespace-nowrap ${
                          entry.amountCents >= 0 ? 'text-emerald-400' : 'text-zinc-300'
                        }`}
                      >
                        {entry.amountCents >= 0 ? '+' : ''}
                        {formatBRL(entry.amountCents)}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">{entry.status}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
