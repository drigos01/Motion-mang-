import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Mail, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AccountType } from '../types/manga';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { signInWithGoogle, signInWithEmail, registerWithEmail } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [accountType, setAccountType] = useState<AccountType>('reader');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGoogle = async () => {
    setError(null);
    setInfoMessage(null);
    setBusy(true);
    try {
      await signInWithGoogle(accountType);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao autenticar com Google.';
      if (msg.includes('popup-closed-by-user')) {
        setError('Janela de login fechada antes da conclusão.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
        onClose();
      } else {
        if (!displayName.trim()) {
          setError('Informe seu nome artístico ou de leitor.');
          setBusy(false);
          return;
        }
        const res = await registerWithEmail({ email, password, displayName, accountType });
        if (res.needsVerification) {
          setInfoMessage(
            'Conta criada! Enviamos um link de confirmação para o seu e-mail. Confirme seu e-mail para liberar publicações e comentários.'
          );
        } else {
          onClose();
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro na autenticação.';
      if (msg.includes('operation-not-allowed')) {
        setError(
          'O provedor E-mail/Senha ainda não foi ativado no Firebase Console (Authentication > Sign-in method). Use "Continuar com Google" acima ou ative E-mail/Senha no Console.'
        );
      } else if (msg.includes('invalid-credential') || msg.includes('wrong-password')) {
        setError('E-mail ou senha incorretos.');
      } else if (msg.includes('email-already-in-use')) {
        setError('Este e-mail já possui cadastro. Tente fazer login.');
      } else if (msg.includes('weak-password')) {
        setError('A senha deve ter pelo menos 6 caracteres.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="relative w-full max-w-md bg-[#121216] border border-white/12 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar janela de acesso"
          className="absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-1.5 mb-6">
          <h2 id="auth-modal-title" className="font-display text-2xl font-bold text-white">
            {mode === 'login' ? 'Entrar na MANGA MOTION' : 'Criar conta'}
          </h2>
          <p className="text-sm text-zinc-400">
            Sincronize histórico de leitura, favoritos e publique obras em Motion Manga.
          </p>
        </div>

        {/* Account Type Selector */}
        <div className="mb-5">
          <span className="block text-xs font-medium text-zinc-400 mb-2">
            Perfil inicial na plataforma
          </span>
          <div className="grid grid-cols-2 gap-2 p-1 bg-[#0A0A0D] rounded-xl border border-white/8">
            <button
              type="button"
              onClick={() => setAccountType('reader')}
              className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                accountType === 'reader'
                  ? 'bg-[#1D1D25] text-white border border-white/12'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Leitor
            </button>
            <button
              type="button"
              onClick={() => setAccountType('creator')}
              className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                accountType === 'creator'
                  ? 'bg-[#E11D48] text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Criador / Autor
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          className="w-full min-h-[46px] flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-white text-zinc-950 font-semibold text-sm hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
            />
          </svg>
          Continuar com Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-zinc-500">
          <div className="h-px flex-1 bg-white/8" />
          <span>ou com e-mail</span>
          <div className="h-px flex-1 bg-white/8" />
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-3.5">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Nome ou Pseudônimo
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ex: Studio Kuroi"
                maxLength={80}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0D] border border-white/10 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#E11D48]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@exemplo.com"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0D] border border-white/10 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#E11D48]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0A0D] border border-white/10 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#E11D48]"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200 leading-relaxed">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {infoMessage && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-200 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{infoMessage}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#E11D48] hover:bg-[#BE123C] text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            <Mail className="w-4 h-4" />
            {mode === 'login' ? 'Entrar com E-mail' : 'Criar Conta'}
          </button>
        </form>

        <div className="mt-5 text-center text-xs text-zinc-400">
          {mode === 'login' ? (
            <>
              Ainda não tem conta?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                  setInfoMessage(null);
                }}
                className="text-white font-semibold hover:underline"
              >
                Cadastre-se
              </button>
            </>
          ) : (
            <>
              Já possui conta?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                  setInfoMessage(null);
                }}
                className="text-white font-semibold hover:underline"
              >
                Fazer login
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
