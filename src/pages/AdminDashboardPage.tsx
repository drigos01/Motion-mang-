import { useEffect, useState } from 'react';
import {
  CheckCircle,
  Eye,
  Flag,
  Heart,
  Server,
  Shield,
  Star,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';
import { AdminMonetizationPanel } from '../components/AdminMonetizationPanel';
import { AppRoute } from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import { fetchStorageStatus, StorageStatusResponse } from '../lib/api';
import {
  adminFetchAllMangas,
  adminFetchAllReports,
  adminFetchAllUsers,
  adminModerateManga,
  adminResolveReport,
  adminToggleUserSuspension,
  deleteManga,
  deleteUserAccount,
  fetchStimulusSettings,
  updateStimulusSettings,
} from '../services/mangaService';
import { computeMangaRankingScore } from '../lib/ranking';
import {
  computeViewsLikesRatioPercent,
  DEFAULT_STIMULUS_SETTINGS,
  toMillisValue,
} from '../lib/stimulus';
import { Manga, ModerationReport, ModerationStatus, StimulusSettings, UserProfile } from '../types/manga';

interface AdminDashboardPageProps {
  onNavigate: (route: AppRoute) => void;
}

export function AdminDashboardPage({ onNavigate }: AdminDashboardPageProps) {
  const { user, isAdmin } = useAuth();
  const [tab, setTab] = useState<'mangas' | 'users' | 'reports' | 'monetization' | 'infra'>('mangas');
  const [mangaSortMode, setMangaSortMode] = useState<'ranking' | 'recent'>('ranking');
  const [mangas, setMangas] = useState<Manga[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [storage, setStorage] = useState<StorageStatusResponse | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [deletingMangaId, setDeletingMangaId] = useState<string | null>(null);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [userActionError, setUserActionError] = useState<string | null>(null);
  const [stimulusSettings, setStimulusSettings] = useState<StimulusSettings>(
    DEFAULT_STIMULUS_SETTINGS
  );
  const [savingStimulus, setSavingStimulus] = useState(false);
  const [stimulusFeedback, setStimulusFeedback] = useState<string | null>(null);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [mList, uList, rList, st, stim] = await Promise.all([
        adminFetchAllMangas(),
        adminFetchAllUsers(),
        adminFetchAllReports(),
        fetchStorageStatus(),
        fetchStimulusSettings(),
      ]);
      setMangas(mList);
      setUsers(uList);
      setReports(rList);
      setStorage(st);
      setStimulusSettings(stim);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      void loadAdminData();
    }
  }, [isAdmin]);

  if (!user || !isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center space-y-3">
        <Shield className="w-10 h-10 text-[#E11D48] mx-auto" />
        <h1 className="font-display text-2xl font-bold text-white">Acesso Restrito</h1>
        <p className="text-sm text-zinc-400">
          Esta área é exclusiva para administradores autenticados da plataforma.
        </p>
      </div>
    );
  }

  const openReportsCount = reports.filter((r) => r.status === 'open' || r.status === 'reviewing').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 md:pb-16 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/8 pb-5">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
            Painel Administrativo
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Moderação de obras, gestão de usuários, denúncias e status de infraestrutura.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#111115] border border-white/8 overflow-x-auto no-scrollbar">
          {[
            { id: 'mangas', label: `Obras (${mangas.length})` },
            { id: 'users', label: `Usuários (${users.length})` },
            { id: 'reports', label: `Denúncias (${openReportsCount})` },
            { id: 'monetization', label: 'Monetização' },
            { id: 'infra', label: 'Infraestrutura' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() =>
                setTab(t.id as 'mangas' | 'users' | 'reports' | 'monetization' | 'infra')
              }
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                tab === t.id ? 'bg-[#E11D48] text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#111115] border border-white/8 rounded-xl p-4">
          <div className="text-xs text-zinc-400">Total de Obras</div>
          <div className="font-display text-2xl font-bold font-mono-tabular text-white mt-1">
            {mangas.length}
          </div>
        </div>
        <div className="bg-[#111115] border border-white/8 rounded-xl p-4">
          <div className="text-xs text-zinc-400">Contas Registradas</div>
          <div className="font-display text-2xl font-bold font-mono-tabular text-white mt-1">
            {users.length}
          </div>
        </div>
        <div className="bg-[#111115] border border-white/8 rounded-xl p-4">
          <div className="text-xs text-zinc-400">Denúncias Pendentes</div>
          <div className="font-display text-2xl font-bold font-mono-tabular text-[#E11D48] mt-1">
            {openReportsCount}
          </div>
        </div>
        <div className="bg-[#111115] border border-white/8 rounded-xl p-4">
          <div className="text-xs text-zinc-400">Driver de Mídia</div>
          <div className="font-display text-lg font-bold text-white mt-1">
            {storage?.driver === 's3' ? 'S3 / R2 Externo' : 'Servidor Local'}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400 py-8">Carregando dados administrativos...</p>
      ) : tab === 'mangas' ? (
        <div className="space-y-4">
          {/* Stimulus Views Configuration Card */}
          <div className="bg-[#111115] border border-white/8 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-white">
                  Sistema de Estímulo Orgânico e Ranking Inteligente
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Orçamento único sorteado uma única vez por obra (1 a 1.000 views em 72h) com
                  funil progressivo entre capítulos públicos, preservação absoluta do engajamento
                  real, sem seguidores, favoritos ou avaliações fictícias, e isolamento total da
                  monetização.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={stimulusSettings.enabled}
                  onChange={(e) =>
                    setStimulusSettings((prev) => ({ ...prev, enabled: e.target.checked }))
                  }
                  className="accent-[#E11D48] w-4 h-4"
                />
                {stimulusSettings.enabled ? 'Ativado' : 'Desativado'}
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Mínimo por capítulo</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={stimulusSettings.minViews}
                  onChange={(e) =>
                    setStimulusSettings((prev) => ({
                      ...prev,
                      minViews: Math.max(1, Math.min(1000, Number(e.target.value) || 1)),
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs font-mono-tabular text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Máximo por capítulo</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={stimulusSettings.maxViews}
                  onChange={(e) =>
                    setStimulusSettings((prev) => ({
                      ...prev,
                      maxViews: Math.max(1, Math.min(1000, Number(e.target.value) || 1000)),
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs font-mono-tabular text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Janela (horas)</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={stimulusSettings.durationHours}
                  onChange={(e) =>
                    setStimulusSettings((prev) => ({
                      ...prev,
                      durationHours: Math.max(1, Math.min(168, Number(e.target.value) || 72)),
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs font-mono-tabular text-white"
                />
              </div>

              <button
                type="button"
                disabled={savingStimulus}
                onClick={async () => {
                  setSavingStimulus(true);
                  setStimulusFeedback(null);
                  try {
                    const updated = await updateStimulusSettings({
                      enabled: stimulusSettings.enabled,
                      minViews: stimulusSettings.minViews,
                      maxViews: Math.max(stimulusSettings.minViews, stimulusSettings.maxViews),
                      durationHours: stimulusSettings.durationHours,
                      updatedBy: user.uid,
                    });
                    setStimulusSettings(updated);
                    setStimulusFeedback('Configuração de visualizações de estímulo salva.');
                  } finally {
                    setSavingStimulus(false);
                  }
                }}
                className="min-h-[38px] px-4 py-2 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-semibold disabled:opacity-50"
              >
                {savingStimulus ? 'Salvando...' : 'Salvar Configuração'}
              </button>
            </div>

            {stimulusFeedback && (
              <p className="text-xs text-emerald-400">{stimulusFeedback}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="text-xs font-medium text-zinc-400">
              Auditoria do Motor de Ranking ({mangas.length} obras)
            </span>
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#111115] border border-white/8">
              <button
                type="button"
                onClick={() => setMangaSortMode('ranking')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  mangaSortMode === 'ranking'
                    ? 'bg-[#E11D48] text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Ranking Inteligente
              </button>
              <button
                type="button"
                onClick={() => setMangaSortMode('recent')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  mangaSortMode === 'recent'
                    ? 'bg-[#E11D48] text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Mais Recentes
              </button>
            </div>
          </div>

          <div className="bg-[#111115] border border-white/8 rounded-2xl overflow-hidden divide-y divide-white/8">
          {mangas.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-500">Nenhuma obra cadastrada.</p>
          ) : (
            [...mangas]
              .sort((a, b) => {
                if (mangaSortMode === 'recent') {
                  const aDate =
                    toMillisValue(a.lastChapterPublishedAt) ||
                    toMillisValue(a.launchedAt) ||
                    toMillisValue(a.createdAt);
                  const bDate =
                    toMillisValue(b.lastChapterPublishedAt) ||
                    toMillisValue(b.launchedAt) ||
                    toMillisValue(b.createdAt);
                  return bDate - aDate;
                }
                return (b.rankingScore ?? 0) - (a.rankingScore ?? 0);
              })
              .map((m) => (
              <div
                key={m.id}
                className="p-4 flex flex-col md:flex-row md:items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onNavigate({ name: 'manga', mangaId: m.id })}
                    className="font-display text-base font-semibold text-white hover:underline text-left"
                  >
                    {m.title}
                  </button>
                  <div className="text-xs text-zinc-400 mt-0.5 font-mono-tabular">
                    Autor: {m.authorName} · Status: {m.status} · Moderação: {m.moderationStatus} ·{' '}
                    {m.chaptersCount} cap.
                  </div>
                  {(() => {
                    const totalViews = m.viewsCount || 0;
                    const realViews = m.realViewsCount ?? m.viewsCount ?? 0;
                    const stimulusViews = m.stimulusViewsCount ?? 0;
                    const realFavorites = m.realFavoritesCount ?? m.favoritesCount ?? 0;
                    const stimulusLikes = m.stimulusLikesCount ?? 0;
                    const ratioPercent = computeViewsLikesRatioPercent(totalViews, realFavorites);
                    const barWidth =
                      totalViews > 0
                        ? Math.min(100, Math.max(realFavorites > 0 ? 4 : 0, (realFavorites / totalViews) * 100))
                        : 0;
                    const audit = computeMangaRankingScore(
                      { manga: m, chapters: m.publishedChapters },
                      Date.now()
                    );
                    const motionPct = Math.round(audit.stats.motionChapterRatio * 100);
                    return (
                      <div className="mt-2.5 p-3 rounded-xl bg-[#0B0B0E] border border-white/6 space-y-2.5 max-w-3xl">
                        {/* Top Score + Classification */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/6">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-mono-tabular">
                            <span className="px-2 py-0.5 rounded bg-[#E11D48]/15 border border-[#E11D48]/30 text-[#FB7185] font-bold">
                              Score {audit.score.toFixed(1)}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-white/6 text-zinc-200 font-semibold">
                              {audit.traction.label}
                            </span>
                            {audit.stats.hasStrictMotion ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-semibold">
                                Motion {audit.stats.validMotionChaptersCount}/
                                {audit.stats.publishedChaptersCount} ({motionPct}%)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-white/5 text-zinc-400">
                                Tradicional ({audit.stats.publishedChaptersCount} cap.)
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-zinc-400">{audit.reasonSummary}</span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] font-mono-tabular">
                          <span className="inline-flex items-center gap-1.5 text-zinc-400">
                            <Eye className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            Views: <strong className="text-white">{totalViews.toLocaleString('pt-BR')}</strong>{' '}
                            (<span className="text-emerald-400">{realViews.toLocaleString('pt-BR')} reais</span> ·{' '}
                            <span className="text-zinc-300">{stimulusViews.toLocaleString('pt-BR')} estímulo</span>)
                          </span>

                          <span className="inline-flex items-center gap-1.5 text-zinc-400">
                            <Heart className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            Favoritos Reais:{' '}
                            <strong className="text-rose-400">{realFavorites.toLocaleString('pt-BR')}</strong>{' '}
                            {stimulusLikes > 0 && (
                              <span className="text-zinc-400">
                                · Sinal estímulo interno: {stimulusLikes.toLocaleString('pt-BR')}
                              </span>
                            )}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px] font-mono-tabular text-zinc-400">
                          <span className="inline-flex items-center gap-1">
                            <Star className="w-3 h-3 text-amber-400 shrink-0" />
                            Avaliações Reais:{' '}
                            <strong className="text-white">
                              {(m.ratingCount || 0) > 0 ? `${m.ratingAverage.toFixed(1)} (${m.ratingCount})` : '—'}
                            </strong>{' '}
                            · Nota Bayesiana:{' '}
                            <strong className="text-zinc-200">{audit.bayesianRating.toFixed(2)}</strong>
                          </span>
                          <span className="text-zinc-300">
                            24h:{' '}
                            <span className="text-emerald-400">
                              +{audit.traction.recentRealViews24h} views reais / +
                              {audit.traction.recentRealFavorites24h} favs
                            </span>{' '}
                            ·{' '}
                            <span className="text-amber-300">
                              +{audit.traction.recentStimulusViews24h} estímulo
                            </span>
                          </span>
                        </div>

                        {/* Ranking Components Breakdown */}
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1 text-[10px] font-mono-tabular">
                          <div className="p-1.5 rounded bg-white/[0.03] border border-white/5">
                            <div className="text-zinc-500">Engaj. Real</div>
                            <div className="text-emerald-400 font-semibold">
                              +{audit.components.trueEngagement.toFixed(1)}
                            </div>
                          </div>
                          <div className="p-1.5 rounded bg-white/[0.03] border border-white/5">
                            <div className="text-zinc-500">Retenção</div>
                            <div className="text-zinc-200 font-semibold">
                              +{audit.components.retention.toFixed(1)}
                            </div>
                          </div>
                          <div className="p-1.5 rounded bg-white/[0.03] border border-white/5">
                            <div className="text-zinc-500">Capítulos</div>
                            <div className="text-zinc-200 font-semibold">
                              +{audit.components.chapterDepth.toFixed(1)}
                            </div>
                          </div>
                          <div className="p-1.5 rounded bg-white/[0.03] border border-white/5">
                            <div className="text-zinc-500">Bônus Motion</div>
                            <div className="text-[#FB7185] font-semibold">
                              +{audit.components.motionBonus.toFixed(1)}
                            </div>
                          </div>
                          <div className="p-1.5 rounded bg-white/[0.03] border border-white/5">
                            <div className="text-zinc-500">Tração 24h</div>
                            <div className="text-amber-300 font-semibold">
                              +{audit.components.recentTraction.toFixed(1)}
                            </div>
                          </div>
                          <div className="p-1.5 rounded bg-white/[0.03] border border-white/5">
                            <div className="text-zinc-500">Estímulo</div>
                            <div className="text-zinc-300 font-semibold">
                              +{audit.components.stimulusDiscovery.toFixed(1)}
                            </div>
                          </div>
                        </div>

                        {audit.stats.retentionTransitions.length > 0 && (
                          <div className="text-[10px] font-mono-tabular text-zinc-400 flex flex-wrap gap-x-4 gap-y-1">
                            <span>
                              Retenção Cap 1→2:{' '}
                              <strong className="text-zinc-200">
                                {audit.stats.retentionCap1To2 !== null
                                  ? `${Math.round(audit.stats.retentionCap1To2 * 100)}%`
                                  : '—'}
                              </strong>
                            </span>
                            {audit.stats.retentionCap2To3 !== null && (
                              <span>
                                Cap 2→3:{' '}
                                <strong className="text-zinc-200">
                                  {Math.round(audit.stats.retentionCap2To3 * 100)}%
                                </strong>
                              </span>
                            )}
                            {audit.stats.retentionSubsequentAvg !== null && (
                              <span>
                                Demais:{' '}
                                <strong className="text-zinc-200">
                                  {Math.round(audit.stats.retentionSubsequentAvg * 100)}%
                                </strong>
                              </span>
                            )}
                          </div>
                        )}

                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-[10px] font-mono-tabular text-zinc-400">
                            <span>Comparação Visualizações × Favoritos Reais</span>
                            <span className="text-zinc-200 font-semibold">
                              {totalViews.toLocaleString('pt-BR')} × {realFavorites.toLocaleString('pt-BR')} ({ratioPercent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-[#E11D48] to-rose-400 transition-all duration-300"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      await adminModerateManga({ mangaId: m.id, isFeatured: !m.isFeatured });
                      await loadAdminData();
                    }}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ${
                      m.isFeatured
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-white/6 text-zinc-300 hover:bg-white/12'
                    }`}
                  >
                    <Star className="w-3.5 h-3.5" />
                    {m.isFeatured ? 'Em Destaque' : 'Destacar'}
                  </button>

                  <select
                    value={m.moderationStatus}
                    onChange={async (e) => {
                      await adminModerateManga({
                        mangaId: m.id,
                        moderationStatus: e.target.value as ModerationStatus,
                      });
                      await loadAdminData();
                    }}
                    aria-label="Status de moderação"
                    className="px-2.5 py-1.5 rounded-lg bg-[#08080A] border border-white/10 text-xs text-white"
                  >
                    <option value="approved">Aprovada</option>
                    <option value="flagged">Sinalizada</option>
                    <option value="removed">Removida</option>
                  </select>

                  <button
                    type="button"
                    disabled={deletingMangaId === m.id}
                    onClick={async () => {
                      if (deletingMangaId) return;
                      setDeletingMangaId(m.id);
                      try {
                        await deleteManga(m.id, m.authorId, true);
                        await loadAdminData();
                      } finally {
                        setDeletingMangaId(null);
                      }
                    }}
                    aria-label="Excluir obra permanentemente"
                    className="p-2 rounded-lg bg-white/5 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
          </div>
        </div>
      ) : tab === 'users' ? (
        <div className="space-y-3">
          {userActionError && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {userActionError}
            </div>
          )}
          <div className="bg-[#111115] border border-white/8 rounded-2xl overflow-hidden divide-y divide-white/8">
            {users.map((u) => {
              const totalFollowers = Math.max(0, u.followersCount || 0);
              return (
              <div
                key={u.uid}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div>
                  <div className="font-display text-sm font-semibold text-white">
                    {u.displayName}{' '}
                    <span className="text-xs font-normal text-zinc-400">@{u.handle}</span>
                  </div>
                  <div className="text-xs text-zinc-400 font-mono-tabular mt-0.5">
                    Perfil: {u.accountType === 'creator' ? 'Criador' : 'Leitor'} · {u.worksCount} obras
                    · {totalFollowers} seguidores reais ·{' '}
                    {u.isSuspended ? 'Banido / Suspenso' : 'Ativo'}
                  </div>
                </div>

                {u.uid !== user.uid && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={togglingUserId === u.uid || deletingUserId === u.uid}
                      onClick={async () => {
                        setUserActionError(null);
                        setTogglingUserId(u.uid);
                        try {
                          await adminToggleUserSuspension(u.uid, !u.isSuspended, u.displayName);
                          await loadAdminData();
                        } catch (err) {
                          setUserActionError(
                            err instanceof Error ? err.message : 'Erro ao atualizar status da conta.'
                          );
                        } finally {
                          setTogglingUserId(null);
                        }
                      }}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50 ${
                        u.isSuspended
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {u.isSuspended ? (
                        <>
                          <UserCheck className="w-3.5 h-3.5" />
                          Reativar Conta
                        </>
                      ) : (
                        <>
                          <UserX className="w-3.5 h-3.5" />
                          Banir / Suspender
                        </>
                      )}
                    </button>

                    {confirmDeleteUid === u.uid ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={deletingUserId === u.uid}
                          onClick={async () => {
                            setUserActionError(null);
                            setDeletingUserId(u.uid);
                            try {
                              await deleteUserAccount({
                                targetUid: u.uid,
                                targetName: u.displayName,
                                avatarUrl: u.avatarUrl,
                                asAdmin: true,
                              });
                              setConfirmDeleteUid(null);
                              await loadAdminData();
                            } catch (err) {
                              setUserActionError(
                                err instanceof Error ? err.message : 'Erro ao excluir conta.'
                              );
                            } finally {
                              setDeletingUserId(null);
                            }
                          }}
                          className="px-3 py-2 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-semibold disabled:opacity-50"
                        >
                          {deletingUserId === u.uid ? 'Excluindo...' : 'Confirmar Exclusão'}
                        </button>
                        <button
                          type="button"
                          disabled={deletingUserId === u.uid}
                          onClick={() => setConfirmDeleteUid(null)}
                          className="px-3 py-2 rounded-xl bg-white/8 text-zinc-300 text-xs font-medium hover:bg-white/12"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={deletingUserId === u.uid}
                        onClick={() => setConfirmDeleteUid(u.uid)}
                        aria-label={`Excluir conta de ${u.displayName}`}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-rose-500/20 text-zinc-300 hover:text-rose-300 border border-white/10 text-xs font-medium disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Excluir Conta
                      </button>
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>
      ) : tab === 'reports' ? (
        <div className="space-y-3">
          {reports.length === 0 ? (
            <div className="bg-[#111115] border border-white/8 rounded-2xl p-10 text-center text-sm text-zinc-500">
              Nenhuma denúncia registrada até o momento.
            </div>
          ) : (
            reports.map((r) => (
              <div
                key={r.id}
                className="bg-[#111115] border border-white/8 rounded-2xl p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Flag className="w-4 h-4 text-[#E11D48]" />
                    <span className="font-display text-sm font-semibold text-white">
                      {r.targetLabel}
                    </span>
                    <span className="text-xs text-zinc-400">
                      ({r.targetType} · {r.reason})
                    </span>
                  </div>
                  <span className="text-xs font-mono-tabular text-zinc-300">
                    Status: {r.status}
                  </span>
                </div>

                <p className="text-xs text-zinc-300 leading-relaxed">{r.details}</p>
                <div className="text-[11px] text-zinc-500">Enviado por: {r.reporterName}</div>

                {(r.status === 'open' || r.status === 'reviewing') && (
                  <div className="pt-2 border-t border-white/8 flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={resolutionNotes[r.id] || ''}
                      onChange={(e) =>
                        setResolutionNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      placeholder="Nota de resolução da moderação..."
                      className="flex-1 px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await adminResolveReport({
                            reportId: r.id,
                            status: 'resolved',
                            resolutionNote: resolutionNotes[r.id] || 'Ação de moderação aplicada.',
                            adminUid: user.uid,
                          });
                          await loadAdminData();
                        }}
                        className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-[#E11D48] text-white text-xs font-semibold"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Resolver
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await adminResolveReport({
                            reportId: r.id,
                            status: 'dismissed',
                            resolutionNote: resolutionNotes[r.id] || 'Denúncia improcedente.',
                            adminUid: user.uid,
                          });
                          await loadAdminData();
                        }}
                        className="px-3.5 py-2 rounded-xl bg-white/8 text-zinc-200 text-xs font-medium"
                      >
                        Dispensar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : tab === 'monetization' ? (
        <AdminMonetizationPanel />
      ) : (
        <div className="bg-[#111115] border border-white/8 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-[#E11D48]" />
            <h2 className="font-display text-lg font-bold text-white">
              Integrações e Armazenamento Externo
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-zinc-300">
            <div className="p-4 rounded-xl bg-[#08080A] border border-white/8 space-y-1.5">
              <div className="font-semibold text-white">Banco de Dados &amp; Autenticação (Ativo)</div>
              <p className="text-zinc-400">
                Firebase Firestore e Firebase Auth configurados no projeto{' '}
                <code className="text-zinc-200">{storage?.firebaseProjectId || 'provisionado'}</code>.
              </p>
              <p className="text-zinc-400">
                Para habilitar cadastro por E-mail/Senha além do login Google já ativo, ative o
                provedor Email/Password no Firebase Console em Authentication &gt; Sign-in method.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#08080A] border border-white/8 space-y-1.5">
              <div className="font-semibold text-white">
                Armazenamento de Arquivos ({storage?.driver === 's3' ? 'S3 / R2 Ativo' : 'Local Gerenciado'})
              </div>
              <p className="text-zinc-400">
                Uploads atuais gravam arquivos binários reais com streaming HTTP Byte-Range (206
                Partial Content) para loops Motion MP4/WebM.
              </p>
              <p className="text-zinc-400">
                Para escalar para CDN externa (AWS S3, Cloudflare R2 ou GCS Interop), defina{' '}
                <code className="text-zinc-200">
                  STORAGE_DRIVER=s3, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
                  S3_PUBLIC_URL
                </code>{' '}
                nas variáveis de ambiente.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
