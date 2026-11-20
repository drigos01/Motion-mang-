import React, { useEffect, useMemo, useState } from 'react';
import {
  Eye,
  EyeOff,
  MessageSquare,
  RefreshCw,
  Reply,
  Send,
  Star,
  Trash2,
} from 'lucide-react';
import { AppRoute } from './Navbar';
import { ToastPopup } from './ToastPopup';
import {
  CreatorStudioCommentItem,
  CreatorStudioRatingItem,
  deleteChapterComment,
  postChapterComment,
  setChapterCommentHidden,
} from '../services/mangaService';
import { ChapterComment, Manga, MAX_LIMITS } from '../types/manga';

interface CreatorInteractionsPanelProps {
  mangas: Manga[];
  comments: CreatorStudioCommentItem[];
  ratings: CreatorStudioRatingItem[];
  loading: boolean;
  initialMangaFilter?: string;
  userId: string;
  userName: string;
  userAvatar: string;
  onRefresh: () => Promise<void>;
  onNavigate: (route: AppRoute) => void;
}

function formatTs(ts: unknown): string {
  if (ts && typeof ts === 'object' && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    return new Date((ts as { toMillis: () => number }).toMillis()).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return 'Agora';
}

export function CreatorInteractionsPanel({
  mangas,
  comments,
  ratings,
  loading,
  initialMangaFilter = 'all',
  userId,
  userName,
  userAvatar,
  onRefresh,
  onNavigate,
}: CreatorInteractionsPanelProps) {
  const [subTab, setSubTab] = useState<'comments' | 'ratings'>('comments');
  const [mangaFilter, setMangaFilter] = useState<string>(initialMangaFilter);
  const [chapterFilter, setChapterFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unanswered' | 'hidden'>('all');

  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMangaFilter(initialMangaFilter || 'all');
    setChapterFilter('all');
  }, [initialMangaFilter]);

  const chapterOptions = useMemo(() => {
    if (mangaFilter === 'all') return [];
    const seen = new Map<string, { id: string; chapterNumber: number; title: string }>();
    comments.forEach((item) => {
      if (item.manga.id === mangaFilter && !seen.has(item.chapter.id)) {
        seen.set(item.chapter.id, {
          id: item.chapter.id,
          chapterNumber: item.chapter.chapterNumber,
          title: item.chapter.title,
        });
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.chapterNumber - b.chapterNumber);
  }, [comments, mangaFilter]);

  const repliesByParentId = useMemo(() => {
    const map = new Map<string, CreatorStudioCommentItem[]>();
    comments.forEach((item) => {
      const pid = item.comment.parentId;
      if (!pid) return;
      const list = map.get(pid) || [];
      list.push(item);
      map.set(pid, list);
    });
    map.forEach((list) => list.reverse());
    return map;
  }, [comments]);

  const filteredTopComments = useMemo(() => {
    return comments.filter((item) => {
      const c = item.comment;
      if (c.parentId) return false;
      if (mangaFilter !== 'all' && item.manga.id !== mangaFilter) return false;
      if (chapterFilter !== 'all' && item.chapter.id !== chapterFilter) return false;
      const threadReplies = repliesByParentId.get(c.id) || [];
      if (statusFilter === 'hidden') {
        return c.isHidden || threadReplies.some((r) => r.comment.isHidden);
      }
      if (statusFilter === 'unanswered') {
        const hasAuthorReply = threadReplies.some(
          (r) => r.comment.isAuthorReply || r.comment.userId === userId
        );
        return !c.isHidden && c.userId !== userId && !hasAuthorReply;
      }
      return true;
    });
  }, [comments, mangaFilter, chapterFilter, statusFilter, repliesByParentId, userId]);

  const filteredRatings = useMemo(() => {
    return ratings.filter((item) => mangaFilter === 'all' || item.manga.id === mangaFilter);
  }, [ratings, mangaFilter]);

  const unansweredCount = useMemo(() => {
    return comments.filter((item) => {
      const c = item.comment;
      if (c.parentId || c.isHidden || c.userId === userId) return false;
      const threadReplies = repliesByParentId.get(c.id) || [];
      return !threadReplies.some((r) => r.comment.isAuthorReply || r.comment.userId === userId);
    }).length;
  }, [comments, repliesByParentId, userId]);

  const handleSendReply = async (e: React.FormEvent, target: CreatorStudioCommentItem) => {
    e.preventDefault();
    if (!replyDraft.trim() || submittingReply) return;
    setSubmittingReply(true);
    setError(null);
    setFeedback(null);
    try {
      await postChapterComment({
        manga: target.manga,
        chapter: target.chapter,
        userId,
        userName,
        userAvatar,
        content: replyDraft,
        parentComment: target.comment,
      });
      setReplyDraft('');
      setReplyingToId(null);
      setFeedback(`Resposta publicada no Cap. ${target.chapter.chapterNumber} e leitor notificado.`);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar resposta.');
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleToggleHidden = async (item: CreatorStudioCommentItem) => {
    const c = item.comment;
    setActionBusyId(c.id);
    setError(null);
    try {
      await setChapterCommentHidden(item.manga.id, item.chapter.id, c.id, !c.isHidden);
      setFeedback(c.isHidden ? 'Comentário restaurado no capítulo.' : 'Comentário ocultado do público.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar visibilidade do comentário.');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleDeleteComment = async (item: CreatorStudioCommentItem) => {
    const c = item.comment;
    setActionBusyId(c.id);
    setError(null);
    try {
      await deleteChapterComment(item.manga.id, item.chapter.id, c.id);
      setConfirmDeleteId(null);
      setFeedback('Comentário removido permanentemente.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir comentário.');
    } finally {
      setActionBusyId(null);
    }
  };

  const renderCommentRow = (item: CreatorStudioCommentItem, isNested = false) => {
    const c: ChapterComment = item.comment;
    const isAuthor = Boolean(c.isAuthorReply || c.userId === userId);
    const isBusy = actionBusyId === c.id;
    const isReplyingHere = replyingToId === c.id;

    return (
      <div
        key={c.id}
        className={`space-y-2.5 ${
          isNested ? 'pt-3 border-t border-white/6' : ''
        } ${c.isHidden ? 'opacity-65' : ''}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-white">{c.userName}</span>
              {isAuthor && (
                <span className="text-[11px] font-semibold text-[#FB7185]">Autor</span>
              )}
              {c.replyToUserName && (
                <>
                  <span className="text-zinc-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-zinc-400">em resposta a {c.replyToUserName}</span>
                </>
              )}
              {c.isHidden && (
                <>
                  <span className="text-zinc-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-amber-400 font-medium">Oculto</span>
                </>
              )}
            </div>

            {!isNested && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                <span className="text-zinc-300 font-medium">{item.manga.title}</span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() =>
                    onNavigate({
                      name: 'reader',
                      mangaId: item.manga.id,
                      chapterId: item.chapter.id,
                    })
                  }
                  className="text-[#E11D48] hover:underline font-mono-tabular"
                >
                  Cap. {item.chapter.chapterNumber}: {item.chapter.title}
                </button>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular text-zinc-500">{formatTs(c.createdAt)}</span>
              </div>
            )}

            {isNested && (
              <div className="text-[11px] font-mono-tabular text-zinc-500">
                {formatTs(c.createdAt)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setReplyingToId(isReplyingHere ? null : c.id);
                setReplyDraft('');
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/6 hover:bg-white/12 text-xs font-medium text-zinc-200 transition-colors"
            >
              <Reply className="w-3.5 h-3.5" />
              Responder
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleToggleHidden(item)}
              title={c.isHidden ? 'Exibir comentário novamente' : 'Ocultar comentário'}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/6 hover:bg-white/12 text-xs text-zinc-300 disabled:opacity-40"
            >
              {c.isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{c.isHidden ? 'Exibir' : 'Ocultar'}</span>
            </button>

            {confirmDeleteId === c.id ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleDeleteComment(item)}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold disabled:opacity-40"
                >
                  Confirmar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-2 py-1.5 rounded-lg bg-white/6 text-xs text-zinc-300"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDeleteId(c.id)}
                aria-label="Excluir comentário"
                title="Excluir comentário"
                className="p-1.5 rounded-lg bg-white/6 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{c.content}</p>

        {isReplyingHere && (
          <form
            onSubmit={(e) => void handleSendReply(e, item)}
            className="pt-2 flex flex-col sm:flex-row gap-2"
          >
            <input
              type="text"
              maxLength={MAX_LIMITS.COMMENT_CONTENT}
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
              placeholder={`Responder a ${c.userName}...`}
              autoFocus
              className="flex-1 min-h-[40px] px-3.5 rounded-xl bg-[#08080A] border border-white/12 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E11D48]"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={submittingReply || !replyDraft.trim()}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-4 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-semibold disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" />
                {submittingReply ? 'Enviando...' : 'Enviar Resposta'}
              </button>
              <button
                type="button"
                onClick={() => setReplyingToId(null)}
                className="min-h-[40px] px-3 rounded-xl bg-white/6 text-xs text-zinc-300"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Toolbar & Filters */}
      <div className="bg-[#111115] border border-white/8 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#08080A] border border-white/8 self-start">
            <button
              type="button"
              onClick={() => setSubTab('comments')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'comments'
                  ? 'bg-[#E11D48] text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Comentários ({comments.filter((c) => !c.comment.isHidden).length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('ratings')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'ratings'
                  ? 'bg-[#E11D48] text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Star className="w-3.5 h-3.5" />
              Avaliações ({ratings.length})
            </button>
          </div>

          <div className="flex items-center gap-3">
            {unansweredCount > 0 && (
              <span className="text-xs text-amber-300 font-mono-tabular">
                {unansweredCount} sem resposta do autor
              </span>
            )}
            <button
              type="button"
              disabled={loading}
              onClick={() => void onRefresh()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/8 hover:bg-white/12 text-xs font-medium text-white disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-zinc-400 mb-1">Filtrar por Obra</label>
            <select
              value={mangaFilter}
              onChange={(e) => {
                setMangaFilter(e.target.value);
                setChapterFilter('all');
              }}
              className="w-full px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white focus:outline-none focus:border-[#E11D48]"
            >
              <option value="all">Todas as minhas obras</option>
              {mangas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </div>

          {subTab === 'comments' && (
            <>
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Filtrar por Capítulo
                </label>
                <select
                  value={chapterFilter}
                  disabled={mangaFilter === 'all'}
                  onChange={(e) => setChapterFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white focus:outline-none focus:border-[#E11D48] disabled:opacity-45"
                >
                  <option value="all">Todos os capítulos</option>
                  {chapterOptions.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      Cap. {ch.chapterNumber} — {ch.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">Exibição</label>
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as 'all' | 'unanswered' | 'hidden')
                  }
                  className="w-full px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white focus:outline-none focus:border-[#E11D48]"
                >
                  <option value="all">Todos os comentários</option>
                  <option value="unanswered">Aguardando resposta do autor</option>
                  <option value="hidden">Ocultos pelo autor/moderação</option>
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      <ToastPopup
        feedback={feedback}
        error={error}
        onClearFeedback={() => setFeedback(null)}
        onClearError={() => setError(null)}
      />

      {loading && comments.length === 0 && ratings.length === 0 ? (
        <div className="bg-[#111115] border border-white/8 rounded-2xl p-10 text-center text-sm text-zinc-400">
          Carregando comentários e avaliações das suas publicações...
        </div>
      ) : subTab === 'comments' ? (
        filteredTopComments.length === 0 ? (
          <div className="bg-[#111115] border border-white/8 rounded-2xl p-10 text-center space-y-2">
            <MessageSquare className="w-8 h-8 text-zinc-600 mx-auto" />
            <p className="font-display text-base font-semibold text-white">
              Nenhum comentário encontrado neste filtro
            </p>
            <p className="text-xs text-zinc-400">
              Os comentários enviados pelos leitores nos seus capítulos aparecerão aqui para você
              responder diretamente.
            </p>
          </div>
        ) : (
          <div className="bg-[#111115] border border-white/8 rounded-2xl divide-y divide-white/8">
            {filteredTopComments.map((item) => {
              const replies = repliesByParentId.get(item.comment.id) || [];
              return (
                <div key={item.comment.id} className="p-4 sm:p-5 space-y-4">
                  {renderCommentRow(item, false)}

                  {replies.length > 0 && (
                    <div className="ml-4 sm:ml-6 pl-4 border-l border-white/10 space-y-3">
                      {replies.map((reply) => renderCommentRow(reply, true))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : filteredRatings.length === 0 ? (
        <div className="bg-[#111115] border border-white/8 rounded-2xl p-10 text-center space-y-2">
          <Star className="w-8 h-8 text-zinc-600 mx-auto" />
          <p className="font-display text-base font-semibold text-white">
            Nenhuma avaliação encontrada
          </p>
          <p className="text-xs text-zinc-400">
            As notas e resenhas deixadas na página das suas obras aparecerão aqui.
          </p>
        </div>
      ) : (
        <div className="bg-[#111115] border border-white/8 rounded-2xl divide-y divide-white/8">
          {filteredRatings.map(({ rating, manga }) => (
            <div key={`${manga.id}_${rating.userId}`} className="p-4 sm:p-5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-white">{rating.userName}</span>
                  <span className="text-zinc-600" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate({ name: 'manga', mangaId: manga.id })}
                    className="text-zinc-300 hover:text-white hover:underline font-medium"
                  >
                    {manga.title}
                  </button>
                  <span className="text-zinc-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono-tabular font-semibold text-amber-400">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    {rating.score}/5
                  </span>
                </div>
                <span className="text-[11px] font-mono-tabular text-zinc-500">
                  {formatTs(rating.updatedAt)}
                </span>
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {rating.review?.trim()
                  ? rating.review
                  : 'Avaliação enviada apenas com pontuação por estrelas.'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
