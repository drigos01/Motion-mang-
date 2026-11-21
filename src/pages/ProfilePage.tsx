import React, { useEffect, useState } from 'react';
import { deleteUser } from 'firebase/auth';
import { AlertTriangle, CheckCircle2, Trash2, Upload, User as UserIcon } from 'lucide-react';
import { AvatarCropModal } from '../components/AvatarCropModal';
import { AppRoute } from '../components/Navbar';
import { ToastPopup } from '../components/ToastPopup';
import { useAuth } from '../context/AuthContext';
import { deleteMediaAsset, uploadMediaAsset } from '../lib/api';
import { deleteUserAccount } from '../services/mangaService';
import { AccountType, ReaderLayoutMode, ReaderMode } from '../types/manga';

interface ProfilePageProps {
  onOpenAuth: () => void;
  onNavigate?: (route: AppRoute) => void;
}

export function ProfilePage({ onOpenAuth, onNavigate }: ProfilePageProps) {
  const { user, profile, privateInfo, isAdmin, signOut, updateUserProfile, updateReaderPreferences } =
    useAuth();

  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('reader');
  const [preferredMode, setPreferredMode] = useState<ReaderMode>('motion');
  const [layoutMode, setLayoutMode] = useState<ReaderLayoutMode>('single');
  const [saving, setSaving] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarProgress, setAvatarProgress] = useState<number | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setHandle(profile.handle);
      setBio(profile.bio);
      setAvatarUrl(profile.avatarUrl);
      setAccountType(profile.accountType);
    }
    if (privateInfo) {
      setPreferredMode(privateInfo.preferredMode);
      setLayoutMode(privateInfo.layoutMode || 'single');
    }
  }, [profile, privateInfo]);

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center space-y-4">
        <UserIcon className="w-10 h-10 text-[#E11D48] mx-auto" />
        <h1 className="font-display text-2xl font-bold text-white">Perfil da Conta</h1>
        <p className="text-sm text-zinc-400">Entre para gerenciar seu perfil de leitor ou criador.</p>
        <button
          type="button"
          onClick={onOpenAuth}
          className="px-6 py-2.5 rounded-xl bg-[#E11D48] text-white text-sm font-semibold"
        >
          Entrar
        </button>
      </div>
    );
  }

  const handleSelectAvatarFile = (file: File) => {
    if (uploadingAvatar) return;
    setError(null);
    setSavedMsg(null);
    if (!user.emailVerified) {
      setError('Confirme seu e-mail antes de enviar uma foto de perfil.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError('A foto selecionada excede o limite máximo de 25 MB.');
      return;
    }
    setPendingAvatarFile(file);
  };

  const handleAvatarUpload = async (file: File) => {
    if (uploadingAvatar) return;
    setPendingAvatarFile(null);
    setError(null);
    setSavedMsg(null);
    if (!user.emailVerified) {
      setError('Confirme seu e-mail antes de enviar uma foto de perfil.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError('A foto selecionada excede o limite máximo de 25 MB.');
      return;
    }
    const previousAvatar = profile?.avatarUrl || avatarUrl || '';
    setUploadingAvatar(true);
    setAvatarProgress(0);
    let uploadedUrl: string | null = null;
    try {
      const res = await uploadMediaAsset({
        file,
        kind: 'avatar',
        onProgress: setAvatarProgress,
      });
      uploadedUrl = res.url;
      await updateUserProfile({ avatarUrl: res.url });
      setAvatarUrl(res.url);
      if (previousAvatar && previousAvatar !== res.url) {
        await deleteMediaAsset(previousAvatar).catch(() => {});
      }
      setSavedMsg('Foto de perfil atualizada com sucesso!');
    } catch (err) {
      if (uploadedUrl && uploadedUrl !== previousAvatar) {
        await deleteMediaAsset(uploadedUrl).catch(() => {});
      }
      setError(err instanceof Error ? err.message : 'Erro ao enviar avatar.');
    } finally {
      setUploadingAvatar(false);
      setAvatarProgress(null);
    }
  };

  const handleRemoveAvatar = async () => {
    if (uploadingAvatar || !avatarUrl) return;
    const previousAvatar = profile?.avatarUrl || avatarUrl;
    setUploadingAvatar(true);
    setError(null);
    setSavedMsg(null);
    try {
      await updateUserProfile({ avatarUrl: '' });
      setAvatarUrl('');
      if (previousAvatar) {
        await deleteMediaAsset(previousAvatar).catch(() => {});
      }
      setSavedMsg('Foto de perfil removida do perfil e do servidor.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover foto de perfil.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    const previousAvatar = profile?.avatarUrl || '';
    try {
      await updateUserProfile({ displayName, handle, bio, avatarUrl, accountType });
      await updateReaderPreferences({ preferredMode, layoutMode });
      if (previousAvatar && previousAvatar !== avatarUrl) {
        await deleteMediaAsset(previousAvatar).catch(() => {});
      }
      setSavedMsg('Perfil atualizado com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar perfil.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOwnAccount = async () => {
    if (!user || deletingAccount) return;
    setDeletingAccount(true);
    setError(null);
    try {
      await deleteUserAccount({
        targetUid: user.uid,
        targetName: profile?.displayName || user.displayName || 'Usuário',
        avatarUrl: profile?.avatarUrl || '',
        asAdmin: false,
      });
      try {
        await deleteUser(user);
      } catch {
        await signOut();
      }
      onNavigate?.({ name: 'home' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir conta.');
      setDeletingAccount(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 md:pb-16 space-y-6">
      <ToastPopup
        feedback={savedMsg}
        error={error}
        onClearFeedback={() => setSavedMsg(null)}
        onClearError={() => setError(null)}
      />
      {pendingAvatarFile && (
        <AvatarCropModal
          file={pendingAvatarFile}
          onCancel={() => setPendingAvatarFile(null)}
          onConfirm={(croppedFile) => {
            void handleAvatarUpload(croppedFile);
          }}
          onUnsupportedPreview={(rawFile) => {
            void handleAvatarUpload(rawFile);
          }}
        />
      )}
      <div className="border-b border-white/8 pb-5">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">Meu Perfil</h1>
        <p className="text-sm text-zinc-400 mt-1">
          {user.email} {isAdmin ? '· Administrador da Plataforma' : ''}
        </p>
      </div>

      {profile?.isSuspended && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>
            Sua conta foi suspensa/banida pela moderação. Seus seguidores foram removidos e ações
            de publicação estão bloqueadas.
          </span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-[#111115] border border-white/8 rounded-2xl p-6 space-y-5"
      >
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              referrerPolicy="no-referrer"
              className="w-16 h-16 rounded-full object-cover border border-white/15"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-[#1C1C24] border border-white/15 flex items-center justify-center text-xl font-bold text-white">
              {(displayName || 'U').slice(0, 1).toUpperCase()}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/8 text-xs font-medium text-white ${
                uploadingAvatar
                  ? 'opacity-60 cursor-not-allowed'
                  : 'hover:bg-white/15 cursor-pointer'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              {uploadingAvatar
                ? `Enviando... ${avatarProgress ?? 0}%`
                : 'Enviar Nova Foto'}
              <input
                type="file"
                disabled={uploadingAvatar}
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/gif,image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleSelectAvatarFile(f);
                  e.target.value = '';
                }}
              />
            </label>

            {avatarUrl && (
              <button
                type="button"
                disabled={uploadingAvatar || saving}
                onClick={() => void handleRemoveAvatar()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/12 hover:bg-rose-500/20 border border-rose-500/25 text-xs font-medium text-rose-300 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remover Foto
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Nome de Exibição</label>
            <input
              type="text"
              required
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Identificador (@)</label>
            <input
              type="text"
              required
              maxLength={40}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">Biografia</label>
          <textarea
            rows={3}
            maxLength={400}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Conte sobre suas obras ou gêneros preferidos..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Tipo de Conta</label>
            <select
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as AccountType)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white"
            >
              <option value="reader">Leitor</option>
              <option value="creator">Criador / Autor</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Modalidade Padrão
            </label>
            <select
              value={preferredMode}
              onChange={(e) => setPreferredMode(e.target.value as ReaderMode)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white"
            >
              <option value="motion">Motion Manga</option>
              <option value="original">Original Estático</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Estilo de Leitura
            </label>
            <select
              value={layoutMode}
              onChange={(e) => setLayoutMode(e.target.value as ReaderLayoutMode)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#08080A] border border-white/10 text-sm text-white"
            >
              <option value="vertical">Contínuo (Rolar para baixo)</option>
              <option value="single">Páginas (Toque Esq/Dir)</option>
            </select>
          </div>
        </div>

        {savedMsg && (
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4" />
            <span>{savedMsg}</span>
          </div>
        )}
        {error && <p className="text-xs text-rose-400">{error}</p>}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar Perfil'}
          </button>
        </div>
      </form>

      <div className="bg-[#111115] border border-rose-500/20 rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold text-white">Excluir Conta</h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Remove permanentemente seu perfil, suas obras, seguidores e histórico de leitura,
              notificando os usuários afetados.
            </p>
          </div>

          {confirmDelete ? (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={deletingAccount}
                onClick={handleDeleteOwnAccount}
                className="px-4 py-2 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-xs font-semibold disabled:opacity-50"
              >
                {deletingAccount ? 'Excluindo...' : 'Confirmar Exclusão'}
              </button>
              <button
                type="button"
                disabled={deletingAccount}
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 rounded-xl bg-white/8 hover:bg-white/12 text-zinc-200 text-xs font-medium"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Excluir Minha Conta
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
