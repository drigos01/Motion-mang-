import React, { useState } from 'react';
import { Flag, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { submitModerationReport } from '../services/mangaService';
import { ModerationReport, REPORT_REASONS } from '../types/manga';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: ModerationReport['targetType'];
  targetId: string;
  targetLabel: string;
  mangaId?: string;
}

export function ReportModal({
  isOpen,
  onClose,
  targetType,
  targetId,
  targetLabel,
  mangaId,
}: ReportModalProps) {
  const { user, profile } = useAuth();
  const [reason, setReason] = useState<ModerationReport['reason']>('broken_media');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !user.emailVerified) {
      setError('Faça login com uma conta verificada para enviar denúncias.');
      return;
    }
    if (!details.trim()) {
      setError('Descreva brevemente o problema encontrado.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitModerationReport({
        reporterId: user.uid,
        reporterName: profile?.displayName || user.displayName || 'Usuário',
        targetType,
        targetId,
        mangaId,
        targetLabel,
        reason,
        details,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar denúncia.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-md bg-[#121216] border border-white/12 rounded-2xl p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/5"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <Flag className="w-5 h-5 text-[#E11D48]" />
          <h3 className="font-display text-lg font-semibold text-white">Reportar Conteúdo</h3>
        </div>

        {sent ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300 leading-relaxed">
              Denúncia registrada com sucesso para <strong>{targetLabel}</strong>. Nossa equipe de
              moderação analisará o caso no painel administrativo.
            </p>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setDetails('');
                onClose();
              }}
              className="w-full py-2.5 rounded-xl bg-white text-zinc-950 font-semibold text-sm hover:bg-zinc-200 transition-colors"
            >
              Concluir
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="text-xs text-zinc-400">
              Alvo: <span className="text-zinc-200 font-medium">{targetLabel}</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Motivo</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as ModerationReport['reason'])}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0D] border border-white/10 text-sm text-white focus:outline-none focus:border-[#E11D48]"
              >
                {REPORT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Detalhes para moderação
              </label>
              <textarea
                rows={4}
                required
                maxLength={1000}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Explique o problema com clareza..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0D] border border-white/10 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#E11D48]"
              />
            </div>

            {error && <p className="text-xs text-rose-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm text-zinc-300 hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold disabled:opacity-50"
              >
                {submitting ? 'Enviando...' : 'Enviar Denúncia'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
