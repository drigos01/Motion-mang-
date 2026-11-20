import { useState } from 'react';
import {
  Bell,
  Bookmark,
  Compass,
  Home,
  LogOut,
  PenTool,
  Shield,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  deleteNotification,
  fetchReadingHistoryForUser,
  fetchUserFavorites,
  fetchUserFollows,
} from '../services/mangaService';

export type AppRoute =
  | { name: 'home' }
  | { name: 'explore'; genre?: string; query?: string }
  | { name: 'manga'; mangaId: string }
  | { name: 'preview'; previewKey: string }
  | { name: 'reader'; mangaId: string; chapterId: string; initialPage?: number }
  | { name: 'preview_reader'; previewKey: string; chapterId: string; initialPage?: number }
  | { name: 'creator' }
  | { name: 'library' }
  | { name: 'profile' }
  | { name: 'admin' };

interface NavbarProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  onOpenAuth: () => void;
}

export function Navbar({ route, onNavigate, onOpenAuth }: NavbarProps) {
  const { user, profile, isAdmin, notifications, signOut } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [dismissingNotifIds, setDismissingNotifIds] = useState<string[]>([]);

  const visibleNotifications = notifications.filter((n) => !dismissingNotifIds.includes(n.id));
  const visibleUnreadCount = visibleNotifications.filter((n) => !n.isRead).length;

  const navLinks: Array<{ id: AppRoute['name']; label: string }> = [
    { id: 'home', label: 'Início' },
    { id: 'explore', label: 'Explorar' },
    { id: 'library', label: 'Biblioteca' },
    { id: 'creator', label: 'Estúdio' },
  ];
  if (isAdmin) {
    navLinks.push({ id: 'admin', label: 'Admin' });
  }

  return (
    <>
      {/* Desktop & Mobile Top Header (3-Zone Top Bar Contract) */}
      <header className="sticky top-0 z-40 h-13 md:h-16 bg-[#08080A]/90 backdrop-blur-md border-b border-white/8">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={() => onNavigate({ name: 'home' })}
            className="font-display text-lg md:text-xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48] rounded"
          >
            MANGA MOTION
          </button>

          {/* Zone 2: Clean Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            {navLinks.map((link) => {
              const active = route.name === link.id;
              return (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => onNavigate({ name: link.id } as AppRoute)}
                  className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                    active
                      ? 'text-white border-[#E11D48]'
                      : 'text-zinc-400 border-transparent hover:text-white'
                  }`}
                >
                  {link.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Action / Account Menu */}
          <div className="relative flex items-center gap-2 shrink-0">
            {user ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen((v) => !v);
                    setUserMenuOpen(false);
                  }}
                  aria-label="Notificações"
                  className="relative min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-white/6 transition-colors"
                >
                  <Bell className="w-5 h-5" />
                  {visibleUnreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#E11D48] text-[10px] font-mono-tabular font-bold text-white flex items-center justify-center">
                      {visibleUnreadCount > 9 ? '9+' : visibleUnreadCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen((v) => !v);
                    setNotifOpen(false);
                  }}
                  className="flex items-center gap-2.5 pl-1.5 pr-3 py-1 rounded-lg hover:bg-white/6 transition-colors min-h-[40px]"
                >
                  {profile?.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt={profile.displayName}
                      referrerPolicy="no-referrer"
                      className="w-7 h-7 rounded-full object-cover border border-white/15"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-[#1C1C24] border border-white/15 flex items-center justify-center text-xs font-semibold text-white">
                      {(profile?.displayName || user.displayName || 'U').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="hidden sm:inline text-sm font-medium text-zinc-200 max-w-[120px] truncate whitespace-nowrap">
                    {profile?.displayName || user.displayName || 'Conta'}
                  </span>
                </button>

                {/* Notifications Dropdown */}
                {notifOpen && (
                  <div className="absolute right-0 top-12 w-80 max-w-[calc(100vw-2rem)] bg-[#141419] border border-white/12 rounded-2xl shadow-2xl p-3 z-50">
                    <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/8 mb-2">
                      <span className="font-display text-sm font-semibold text-white">
                        Notificações
                      </span>
                      <span className="text-xs text-zinc-400 font-mono-tabular">
                        {visibleNotifications.length}{' '}
                        {visibleNotifications.length === 1 ? 'notificação' : 'notificações'}
                      </span>
                    </div>
                    <div className="max-h-72 overflow-y-auto space-y-1">
                      {visibleNotifications.length === 0 ? (
                        <p className="text-xs text-zinc-500 py-6 text-center">
                          Nenhuma notificação no momento.
                        </p>
                      ) : (
                        visibleNotifications.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={async () => {
                              setDismissingNotifIds((prev) =>
                                prev.includes(n.id) ? prev : [...prev, n.id]
                              );
                              setNotifOpen(false);
                              try {
                                if (user?.emailVerified) {
                                  if (n.type === 'manga_deleted') {
                                    await Promise.allSettled([
                                      fetchReadingHistoryForUser(user.uid),
                                      fetchUserFavorites(user.uid),
                                    ]);
                                  } else if (n.type === 'account_removed') {
                                    await fetchUserFollows(user.uid).catch(() => {});
                                  }
                                }
                                await deleteNotification(n.id);
                              } catch {
                                // Ignore if notification already deleted
                              } finally {
                                setDismissingNotifIds((prev) => prev.filter((id) => id !== n.id));
                              }
                              if (n.linkMangaId && n.linkChapterId) {
                                onNavigate({
                                  name: 'reader',
                                  mangaId: n.linkMangaId,
                                  chapterId: n.linkChapterId,
                                });
                              } else if (n.linkMangaId) {
                                onNavigate({ name: 'manga', mangaId: n.linkMangaId });
                              }
                            }}
                            className={`w-full text-left p-2.5 rounded-xl transition-colors ${
                              n.isRead
                                ? 'hover:bg-white/5 text-zinc-400'
                                : 'bg-white/6 hover:bg-white/10 text-zinc-100'
                            }`}
                          >
                            <div className="text-xs font-semibold line-clamp-1">{n.title}</div>
                            <div className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">
                              {n.message}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* User Menu Dropdown */}
                {userMenuOpen && (
                  <div className="absolute right-0 top-12 w-56 bg-[#141419] border border-white/12 rounded-2xl shadow-2xl p-2 z-50">
                    <div className="px-3 py-2 border-b border-white/8 mb-1">
                      <div className="text-sm font-semibold text-white truncate">
                        {profile?.displayName || user.displayName}
                      </div>
                      <div className="text-xs text-zinc-400 truncate">
                        {profile?.accountType === 'creator' ? 'Criador' : 'Leitor'}
                        {isAdmin ? ' · Administrador' : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        onNavigate({ name: 'profile' });
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-zinc-200 hover:bg-white/6 transition-colors"
                    >
                      <UserIcon className="w-4 h-4 text-zinc-400" />
                      Meu Perfil
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        onNavigate({ name: 'creator' });
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-zinc-200 hover:bg-white/6 transition-colors"
                    >
                      <PenTool className="w-4 h-4 text-zinc-400" />
                      Estúdio do Criador
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          onNavigate({ name: 'admin' });
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-zinc-200 hover:bg-white/6 transition-colors"
                      >
                        <Shield className="w-4 h-4 text-[#E11D48]" />
                        Administração
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        setUserMenuOpen(false);
                        await signOut();
                        onNavigate({ name: 'home' });
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-rose-300 hover:bg-rose-500/10 transition-colors mt-1 border-t border-white/8 pt-2.5"
                    >
                      <LogOut className="w-4 h-4" />
                      Sair
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
                className="px-4 py-2 rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                Entrar
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar (< 15% aggregate sticky height) */}
      <nav
        aria-label="Navegação principal mobile"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-[#0B0B0E]/95 backdrop-blur-md border-t border-white/10 grid grid-cols-5 items-center"
      >
        <button
          type="button"
          onClick={() => onNavigate({ name: 'home' })}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 ${
            route.name === 'home' ? 'text-[#E11D48]' : 'text-zinc-400'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px] font-medium">Início</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate({ name: 'explore' })}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 ${
            route.name === 'explore' ? 'text-[#E11D48]' : 'text-zinc-400'
          }`}
        >
          <Compass className="w-5 h-5" />
          <span className="text-[10px] font-medium">Explorar</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate({ name: 'library' })}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 ${
            route.name === 'library' ? 'text-[#E11D48]' : 'text-zinc-400'
          }`}
        >
          <Bookmark className="w-5 h-5" />
          <span className="text-[10px] font-medium">Biblioteca</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate({ name: 'creator' })}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 ${
            route.name === 'creator' ? 'text-[#E11D48]' : 'text-zinc-400'
          }`}
        >
          <PenTool className="w-5 h-5" />
          <span className="text-[10px] font-medium">Estúdio</span>
        </button>

        <button
          type="button"
          onClick={() => (user ? onNavigate({ name: 'profile' }) : onOpenAuth())}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 ${
            route.name === 'profile' ? 'text-[#E11D48]' : 'text-zinc-400'
          }`}
        >
          <UserIcon className="w-5 h-5" />
          <span className="text-[10px] font-medium">{user ? 'Perfil' : 'Entrar'}</span>
        </button>
      </nav>
    </>
  );
}
