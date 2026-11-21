import React, { useEffect, useMemo, useState } from 'react';
import {
  Eye,
  EyeOff,
  MessageSquare,
  Pencil,
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
  updateChapterCommentContent,
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

function getTsMillis(ts: unknown): number {
  if (ts && typeof ts === 'object' && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function wasCommentEdited(c: ChapterComment): boolean {
  if (c.isHidden) return false;
  const created = getTsMillis(c.createdAt);
  const updated = getTsMillis(c.updatedAt);
  return created > 0 && updated > created + 1500;
}

function formatTs(ts: unknown): string {
  const millis = getTsMillis(ts);
  if (millis > 0) {
    return new Date(millis).toLocaleString('pt-BR', {
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
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

  const handleSaveEdit = async (e: React.FormEvent, item: CreatorStudioCommentItem) => {
    e.preventDefault();
    if (!editDraft.trim() || savingEdit) return;
    setSavingEdit(true);
    setError(null);
    setFeedback(null);
    try {
      await updateChapterCommentContent(item.manga.id, item.chapter.id, item.comment.id, editDraft);
      setEditingId(null);
      setEditDraft('');
      setFeedback('Comentário atualizado.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao editar comentário.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteComment = async (item: CreatorStudioCommentItem) => {
    const c = item.comment;
    setActionBusyId(c.id);
    setError(null);
    try {
      await deleteChapterComment(item.manga.id, item.chapter.id, c.id, !c.parentId);
      setConfirmDeleteId(null);
      setFeedback('Comentário removido permanentemente.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir comentário.');
    } finally {
      setActionBusyId(null);
    }
  };

  const renderCommentRow = (
    item: CreatorStudioCommentItem,
    isReply = false,
    hasAuthorReply = false
  ) => {
    const c: ChapterComment = item.comment;
    const isAuthor = Boolean(c.isAuthorReply || c.userId === userId);
    const isBusy = actionBusyId === c.id;
    const isReplyingHere = replyingToId === c.id;
    const isEditingHere = editingId === c.id;
    const canEdit = c.userId === userId && !c.isHidden;
    const edited = wasCommentEdited(c);

    return (
      <div
        key={c.id}
        className={`space-y-2.5 ${isReply ? 'pt-3 border-t border-white/6' : ''} ${
          c.isHidden ? 'opacity-65' : ''
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-white">{c.userName}</span>
              {isAuthor && (
                <span className="text-[11px] font-semibold text-[#FB7185]">Autor</span>
              )}
              {c.replyToUserName && (
                <span className="text-zinc-400">▸ {c.replyToUserName}</span>
              )}
              {!isReply && hasAuthorReply && (
                <>
                  <span className="text-zinc-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-[11px] font-medium text-emerald-400">
                    Respondido pelo autor
                  </span>
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

            {!isReply && (
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
                      openComments: true,
                    })
                  }
                  className="text-[#E11D48] hover:underline font-mono-tabular"
                >
                  Cap. {item.chapter.chapterNumber}: {item.chapter.title}
                </button>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular text-zinc-500">
                  {formatTs(c.createdAt)}
                  {edited ? ' · editado' : ''}
                </span>
              </div>
            )}

            {isReply && (
              <div className="text-[11px] font-mono-tabular text-zinc-500">
                {formatTs(c.createdAt)}
                {edited ? ' · editado' : ''}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setReplyingToId(isReplyingHere ? null : c.id);
                setReplyDraft('');
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/6 hover:bg-white/12 text-xs font-medium text-zinc-200 transition-colors"
            >
              <Reply className="w-3.5 h-3.5" />
              Responder
            </button>

            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setReplyingToId(null);
                  setConfirmDeleteId(null);
                  setEditingId(isEditingHere ? null : c.id);
                  setEditDraft(c.content);
                }}
                aria-label="Editar comentário"
                title="Editar comentário"
                className="p-1.5 rounded-lg bg-white/6 hover:bg-white/12 text-zinc-300 hover:text-white"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}

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

        {isEditingHere ? (
          <form
            onSubmit={(e) => void handleSaveEdit(e, item)}
            className="pt-1 flex flex-col sm:flex-row gap-2"
          >
            <input
              type="text"
              maxLength={MAX_LIMITS.COMMENT_CONTENT}
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              autoFocus
              className="flex-1 min-h-[40px] px-3.5 rounded-xl bg-[#08080A] border border-white/15 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#E11D48]"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={savingEdit || !editDraft.trim()}
                className="min-h-[40px] px-4 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-semibold disabled:opacity-40"
              >
                {savingEdit ? 'Salvando...' : 'Salvar'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setEditDraft('');
                }}
                className="min-h-[40px] px-3 rounded-xl bg-white/6 text-xs text-zinc-300"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{c.content}</p>
        )}

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
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="grid grid-cols-2 flex-1 sm:flex-none p-1 rounded-xl bg-[#08080A] border border-white/8">
              <button
                type="button"
                onClick={() => setSubTab('comments')}
                className={`min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  subTab === 'comments'
                    ? 'bg-[#E11D48] text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                <span>Comentários ({comments.filter((c) => !c.comment.isHidden).length})</span>
              </button>
              <button
                type="button"
                onClick={() => setSubTab('ratings')}
                className={`min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  subTab === 'ratings'
                    ? 'bg-[#E11D48] text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Star className="w-3.5 h-3.5 shrink-0" />
                <span>Avaliações ({ratings.length})</span>
              </button>
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={() => void onRefresh()}
              aria-label="Atualizar comentários e avaliações"
              title="Atualizar"
              className="min-h-[42px] shrink-0 inline-flex items-center justify-center gap-1.5 px-3 sm:px-3.5 rounded-xl bg-white/8 hover:bg-white/12 text-xs font-medium text-white disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
          </div>

          {unansweredCount > 0 && subTab === 'comments' && (
            <p className="text-xs text-amber-300 font-mono-tabular">
              {unansweredCount}{' '}
              {unansweredCount === 1
                ? 'comentário aguardando resposta do autor'
                : 'comentários aguardando resposta do autor'}
            </p>
          )}
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
              className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white focus:outline-none focus:border-[#E11D48]"
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
                  className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white focus:outline-none focus:border-[#E11D48] disabled:opacity-45"
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
                  className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-[#08080A] border border-white/10 text-xs text-white focus:outline-none focus:border-[#E11D48]"
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
              const hasAuthorReply = replies.some(
                (r) => r.comment.isAuthorReply || r.comment.userId === userId
              );
              return (
                <div key={item.comment.id} className="p-4 sm:p-5 space-y-3">
                  {renderCommentRow(item, false, hasAuthorReply)}

                  {replies.length > 0 && (
                    <div className="pl-4 sm:pl-6 space-y-3">
                      {replies.map((reply) => renderCommentRow(reply, true, false))}
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
