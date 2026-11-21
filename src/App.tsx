import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthModal } from './components/AuthModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppRoute, Navbar } from './components/Navbar';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { CreatorStudioPage } from './pages/CreatorStudioPage';
import { ExploreFiltersState, ExplorePage } from './pages/ExplorePage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { MangaDetailPage } from './pages/MangaDetailPage';
import { ProfilePage } from './pages/ProfilePage';
import { ReaderPage } from './pages/ReaderPage';
import {
  fetchReadingHistoryForUser,
  fetchUserFollows,
} from './services/mangaService';

function isOriginRoute(route: AppRoute): boolean {
  return (
    route.name === 'home' ||
    route.name === 'explore' ||
    route.name === 'library' ||
    route.name === 'creator' ||
    route.name === 'admin' ||
    route.name === 'profile'
  );
}

function parseHashRoute(): AppRoute {
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (!raw) return { name: 'home' };
  const parts = raw.split('/').map(decodeURIComponent);
  if (parts[0] === 'explore') return { name: 'explore', genre: parts[1] || undefined };
  if (parts[0] === 'manga' && parts[1]) return { name: 'manga', mangaId: parts[1] };
  if (parts[0] === 'preview' && parts[1] && parts[2] === 'read' && parts[3]) {
    return { name: 'preview_reader', previewKey: parts[1], chapterId: parts[3] };
  }
  if (parts[0] === 'preview' && parts[1]) {
    return { name: 'preview', previewKey: parts[1] };
  }
  if (parts[0] === 'read' && parts[1] && parts[2]) {
    return { name: 'reader', mangaId: parts[1], chapterId: parts[2] };
  }
  if (parts[0] === 'creator') return { name: 'creator' };
  if (parts[0] === 'library') return { name: 'library' };
  if (parts[0] === 'profile') return { name: 'profile' };
  if (parts[0] === 'admin') return { name: 'admin' };
  return { name: 'home' };
}

function serializeHashRoute(route: AppRoute): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'explore':
      return route.genre ? `#/explore/${encodeURIComponent(route.genre)}` : '#/explore';
    case 'manga':
      return `#/manga/${encodeURIComponent(route.mangaId)}`;
    case 'preview':
      return `#/preview/${encodeURIComponent(route.previewKey)}`;
    case 'reader':
      return `#/read/${encodeURIComponent(route.mangaId)}/${encodeURIComponent(route.chapterId)}`;
    case 'preview_reader':
      return `#/preview/${encodeURIComponent(route.previewKey)}/read/${encodeURIComponent(route.chapterId)}`;
    case 'creator':
      return '#/creator';
    case 'library':
      return '#/library';
    case 'profile':
      return '#/profile';
    case 'admin':
      return '#/admin';
  }
}

function AppShell() {
  const { user, notifications } = useAuth();
  const [route, setRoute] = useState<AppRoute>(() => parseHashRoute());
  const [mangaReturnRoute, setMangaReturnRoute] = useState<AppRoute>(() => {
    const initial = parseHashRoute();
    return isOriginRoute(initial) ? initial : { name: 'home' };
  });
  const [savedExploreFilters, setSavedExploreFilters] = useState<ExploreFiltersState | undefined>(
    undefined
  );
  const [restoreExploreFilters, setRestoreExploreFilters] = useState(false);
  const routeRef = useRef<AppRoute>(route);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  const mangaDeletedNotifCount = notifications.filter((n) => n.type === 'manga_deleted').length;
  const accountRemovedNotifCount = notifications.filter((n) => n.type === 'account_removed').length;

  useEffect(() => {
    if (!user?.emailVerified || mangaDeletedNotifCount === 0) return;
    void fetchReadingHistoryForUser(user.uid).catch(() => {});
  }, [user?.uid, user?.emailVerified, mangaDeletedNotifCount]);

  useEffect(() => {
    if (!user?.emailVerified || accountRemovedNotifCount === 0) return;
    void fetchUserFollows(user.uid).catch(() => {});
  }, [user?.uid, user?.emailVerified, accountRemovedNotifCount]);

  const navigate = useCallback(
    (next: AppRoute, options?: { restoreExplore?: boolean }) => {
      if (next.name === 'explore') {
        if (options?.restoreExplore) {
          setRestoreExploreFilters(true);
        } else {
          setRestoreExploreFilters(false);
          setSavedExploreFilters(undefined);
        }
      }
      if (isOriginRoute(next)) {
        setMangaReturnRoute(next);
      }
      setRoute(next);
      const nextHash = serializeHashRoute(next);
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash;
      }
      const isReaderRoute = next.name === 'reader' || next.name === 'preview_reader';
      window.scrollTo({ top: 0, behavior: isReaderRoute ? 'auto' : 'smooth' });
    },
    []
  );

  useEffect(() => {
    const onHashChange = () => {
      const prev = routeRef.current;
      const next = parseHashRoute();
      if (next.name === 'explore') {
        setRestoreExploreFilters(prev.name === 'manga' || prev.name === 'reader');
      }
      if (isOriginRoute(next)) {
        setMangaReturnRoute(next);
      }
      setRoute(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const isReader = route.name === 'reader' || route.name === 'preview_reader';

  return (
    <div className="min-h-screen bg-[#08080A] text-[#F4F4F6] flex flex-col">
      {!isReader && (
        <Navbar
          route={route}
          onNavigate={navigate}
          onOpenAuth={() => setAuthModalOpen(true)}
        />
      )}

      <main className="flex-1">
        {route.name === 'home' && <HomePage onNavigate={navigate} />}
        {route.name === 'explore' && (
          <ExplorePage
            initialGenre={route.genre}
            initialQuery={route.query}
            savedFilters={restoreExploreFilters ? savedExploreFilters : undefined}
            onFiltersChange={setSavedExploreFilters}
            onNavigate={navigate}
          />
        )}
        {route.name === 'manga' && (
          <MangaDetailPage
            mangaId={route.mangaId}
            returnRoute={mangaReturnRoute}
            onReturn={() =>
              navigate(mangaReturnRoute, {
                restoreExplore: mangaReturnRoute.name === 'explore',
              })
            }
            onNavigate={navigate}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        )}
        {route.name === 'preview' && (
          <MangaDetailPage
            previewKey={route.previewKey}
            onNavigate={navigate}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        )}
        {route.name === 'reader' && (
          <ReaderPage
            mangaId={route.mangaId}
            chapterId={route.chapterId}
            initialPage={route.initialPage}
            initialCommentsOpen={route.openComments}
            onNavigate={navigate}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        )}
        {route.name === 'preview_reader' && (
          <ReaderPage
            previewKey={route.previewKey}
            chapterId={route.chapterId}
            initialPage={route.initialPage}
            onNavigate={navigate}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        )}
        {route.name === 'creator' && (
          <CreatorStudioPage
            onNavigate={navigate}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        )}
        {route.name === 'library' && (
          <LibraryPage
            onNavigate={navigate}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        )}
        {route.name === 'profile' && (
          <ProfilePage onOpenAuth={() => setAuthModalOpen(true)} onNavigate={navigate} />
        )}
        {route.name === 'admin' && <AdminDashboardPage onNavigate={navigate} />}
      </main>

      {!isReader && (
        <footer className="hidden md:block border-t border-white/8 py-6 px-8 text-xs text-zinc-500">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <span>MANGA MOTION · Plataforma de Mangá Tradicional &amp; Motion Manga</span>
            <div className="flex items-center gap-6">
              <button
                type="button"
                onClick={() => navigate({ name: 'explore' })}
                className="hover:text-zinc-300 transition-colors"
              >
                Catálogo
              </button>
              <button
                type="button"
                onClick={() => navigate({ name: 'creator' })}
                className="hover:text-zinc-300 transition-colors"
              >
                Publicar Obra
              </button>
            </div>
          </div>
        </footer>
      )}

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ErrorBoundary>
  );
}
