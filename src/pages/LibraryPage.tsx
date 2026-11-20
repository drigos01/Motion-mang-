import { useEffect, useState } from 'react';
import { BookOpen, Heart, History, Users } from 'lucide-react';
import { AppRoute } from '../components/Navbar';
import { useAuth } from '../context/AuthContext';
import {
  fetchReadingHistoryForUser,
  fetchUserFavorites,
  fetchUserFollows,
  isMangaPubliclyAccessible,
} from '../services/mangaService';
import { FavoriteItem, FollowRelation, ReadingHistoryItem } from '../types/manga';

interface LibraryPageProps {
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
}

export function LibraryPage({ onNavigate, onOpenAuth }: LibraryPageProps) {
  const { user, notifications } = useAuth();
  const [tab, setTab] = useState<'favorites' | 'history' | 'following'>('favorites');
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [history, setHistory] = useState<ReadingHistoryItem[]>([]);
  const [follows, setFollows] = useState<FollowRelation[]>([]);
  const [loading, setLoading] = useState(false);

  const syncNotifsCount = notifications.filter(
    (n) => n.type === 'manga_deleted' || n.type === 'account_removed'
  ).length;

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      fetchUserFavorites(user.uid),
      fetchReadingHistoryForUser(user.uid),
      fetchUserFollows(user.uid),
    ])
      .then(([favs, hist, flw]) => {
        setFavorites(favs);
        setHistory(hist);
        setFollows(flw);
      })
      .finally(() => setLoading(false));
  }, [user?.uid, syncNotifsCount]);

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center space-y-5">
        <BookOpen className="w-10 h-10 text-[#E11D48] mx-auto" />
        <h1 className="font-display text-3xl font-bold text-white">Sua Biblioteca</h1>
        <p className="text-sm text-zinc-400">
          Entre na sua conta para acompanhar seus mangás favoritos, histórico automático e autores
          seguidos.
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="px-6 py-3 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold"
        >
          Entrar
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 md:pb-16 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
          Minha Biblioteca
        </h1>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#111115] border border-white/8">
          <button
            type="button"
            onClick={() => setTab('favorites')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === 'favorites' ? 'bg-[#E11D48] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Heart className="w-3.5 h-3.5" />
            Favoritos ({favorites.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === 'history' ? 'bg-[#E11D48] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Histórico ({history.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('following')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === 'following' ? 'bg-[#E11D48] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Seguindo ({follows.length})
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400 py-8">Carregando biblioteca...</p>
      ) : tab === 'favorites' ? (
        favorites.length === 0 ? (
          <div className="bg-[#111115] border border-white/8 rounded-2xl p-10 text-center text-sm text-zinc-400">
            Você ainda não favoritou nenhum mangá.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {favorites.map((fav) => (
              <button
                key={fav.mangaId}
                type="button"
                onClick={async () => {
                  if (fav.previewKey) {
                    const accessible = await isMangaPubliclyAccessible(fav.mangaId);
                    if (accessible) {
                      onNavigate({ name: 'manga', mangaId: fav.mangaId });
                    } else {
                      onNavigate({ name: 'preview', previewKey: fav.previewKey });
                    }
                  } else {
                    onNavigate({ name: 'manga', mangaId: fav.mangaId });
                  }
                }}
                className="text-left group space-y-2"
              >
                <div className="aspect-[3/4] rounded-xl overflow-hidden bg-[#141419] border border-white/8">
                  {fav.coverUrl ? (
                    <img
                      src={fav.coverUrl}
                      alt={fav.mangaTitle}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600">
                      <BookOpen className="w-7 h-7" />
                    </div>
                  )}
                </div>
                <div className="font-display text-sm font-semibold text-white truncate">
                  {fav.mangaTitle}
                </div>
                <div className="text-xs text-zinc-400 truncate">{fav.authorName}</div>
              </button>
            ))}
          </div>
        )
      ) : tab === 'history' ? (
        history.length === 0 ? (
          <div className="bg-[#111115] border border-white/8 rounded-2xl p-10 text-center text-sm text-zinc-400">
            Seu histórico de leitura aparecerá aqui automaticamente ao ler capítulos.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {history.map((item) => {
              const pct = Math.min(
                100,
                Math.round((item.pageNumber / Math.max(1, item.totalPages)) * 100)
              );
              return (
                <button
                  key={item.mangaId}
                  type="button"
                  onClick={() =>
                    onNavigate({
                      name: 'reader',
                      mangaId: item.mangaId,
                      chapterId: item.chapterId,
                      initialPage: item.pageNumber,
                    })
                  }
                  className="flex items-center gap-4 p-3.5 rounded-xl bg-[#111115] hover:bg-[#191920] border border-white/8 text-left transition-colors"
                >
                  <div className="w-14 h-20 rounded-lg overflow-hidden bg-[#191922] shrink-0">
                    {item.coverUrl && (
                      <img
                        src={item.coverUrl}
                        alt={item.mangaTitle}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="font-display text-sm font-semibold text-white truncate">
                      {item.mangaTitle}
                    </div>
                    <div className="text-xs text-zinc-400 font-mono-tabular truncate">
                      Cap. {item.chapterNumber} · Pág. {item.pageNumber}/{item.totalPages} ·{' '}
                      {item.preferredMode === 'motion' ? 'Motion' : 'Original'}
                    </div>
                    <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-[#E11D48]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : follows.length === 0 ? (
        <div className="bg-[#111115] border border-white/8 rounded-2xl p-10 text-center text-sm text-zinc-400">
          Você ainda não segue nenhum autor.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {follows.map((rel) => (
            <button
              key={rel.id}
              type="button"
              onClick={() => onNavigate({ name: 'explore', query: rel.authorName })}
              className="p-4 rounded-xl bg-[#111115] hover:bg-[#191920] border border-white/8 flex items-center justify-between text-left"
            >
              <div>
                <div className="font-display text-sm font-semibold text-white">
                  {rel.authorName}
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">Ver obras deste autor</div>
              </div>
              <Users className="w-4 h-4 text-zinc-500" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
