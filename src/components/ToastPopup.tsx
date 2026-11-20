import React, { useEffect } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

interface ToastPopupProps {
  feedback?: string | null;
  error?: string | null;
  onClearFeedback?: () => void;
  onClearError?: () => void;
  autoHideMs?: number;
}

export function ToastPopup({
  feedback,
  error,
  onClearFeedback,
  onClearError,
  autoHideMs = 6000,
}: ToastPopupProps) {
  useEffect(() => {
    if (!feedback || !onClearFeedback || autoHideMs <= 0) return;
    const timer = window.setTimeout(() => {
      onClearFeedback();
    }, autoHideMs);
    return () => window.clearTimeout(timer);
  }, [feedback, onClearFeedback, autoHideMs]);

  useEffect(() => {
    if (!error || !onClearError || autoHideMs <= 0) return;
    const timer = window.setTimeout(() => {
      onClearError();
    }, Math.max(autoHideMs, 8500));
    return () => window.clearTimeout(timer);
  }, [error, onClearError, autoHideMs]);

  if (!feedback && !error) {
    return null;
  }

  return (
    <div className="fixed top-16 md:top-20 left-4 right-4 sm:left-auto sm:right-6 sm:w-full sm:max-w-md z-50 flex flex-col gap-2.5 pointer-events-none">
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex items-start justify-between gap-3 p-4 rounded-2xl bg-[#0D1A15]/95 backdrop-blur-md border border-emerald-500/40 shadow-2xl shadow-black/70 text-xs sm:text-sm text-emerald-100"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{feedback}</span>
          </div>
          {onClearFeedback && (
            <button
              type="button"
              onClick={onClearFeedback}
              aria-label="Fechar notificação"
              className="p-1 -m-1 rounded-lg text-emerald-300/80 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="pointer-events-auto flex items-start justify-between gap-3 p-4 rounded-2xl bg-[#1E0F14]/95 backdrop-blur-md border border-rose-500/40 shadow-2xl shadow-black/70 text-xs sm:text-sm text-rose-100"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
          {onClearError && (
            <button
              type="button"
              onClick={onClearError}
              aria-label="Fechar aviso de erro"
              className="p-1 -m-1 rounded-lg text-rose-300/80 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
