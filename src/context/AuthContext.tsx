import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  AccountType,
  AppNotification,
  MAX_LIMITS,
  ReaderFitMode,
  ReaderLayoutMode,
  ReaderMode,
  ReaderNightTheme,
  UserPrivateInfo,
  UserProfile,
} from '../types/manga';

const BOOTSTRAP_ADMIN_EMAIL = 'helciorodri@gmail.com';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  privateInfo: UserPrivateInfo | null;
  isAdmin: boolean;
  loading: boolean;
  notifications: AppNotification[];
  unreadNotificationsCount: number;
  signInWithGoogle: (preferredAccountType?: AccountType) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (params: {
    email: string;
    password: string;
    displayName: string;
    accountType: AccountType;
  }) => Promise<{ needsVerification: boolean }>;
  resendVerificationEmail: () => Promise<void>;
  signOut: () => Promise<void>;
  updateUserProfile: (patch: Partial<Pick<UserProfile, 'displayName' | 'handle' | 'bio' | 'avatarUrl' | 'accountType'>>) => Promise<void>;
  updateReaderPreferences: (
    patch: Partial<
      Pick<
        UserPrivateInfo,
        'preferredMode' | 'nightMode' | 'layoutMode' | 'fitMode' | 'nightTheme' | 'brightness' | 'zoom'
      >
    >
  ) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function sanitizeHandle(name: string, uid: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_.]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
  const suffix = uid.slice(0, 5).toLowerCase();
  return `${base || 'leitor'}_${suffix}`.slice(0, MAX_LIMITS.HANDLE);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [privateInfo, setPrivateInfo] = useState<UserPrivateInfo | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const pendingAccountTypeRef = React.useRef<AccountType | undefined>(undefined);
  const ensuringMapRef = React.useRef<Map<string, Promise<void>>>(new Map());

  const ensureUserDocuments = async (firebaseUser: User, preferredAccountType?: AccountType) => {
    const inFlight = ensuringMapRef.current.get(firebaseUser.uid);
    if (inFlight) {
      await inFlight;
      return;
    }

    const run = async () => {
      const userRef = doc(db, 'users', firebaseUser.uid);
      const privRef = doc(db, 'users', firebaseUser.uid, 'private', 'info');
      const resolvedAccountType = preferredAccountType ?? pendingAccountTypeRef.current;

      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          if (!firebaseUser.emailVerified) {
            return;
          }
          const safeName = (firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Leitor').slice(
            0,
            MAX_LIMITS.DISPLAY_NAME
          );
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            displayName: safeName,
            handle: sanitizeHandle(safeName, firebaseUser.uid),
            avatarUrl: (firebaseUser.photoURL || '').slice(0, 600),
            bio: '',
            accountType: resolvedAccountType || 'reader',
            followersCount: 0,
            worksCount: 0,
            isSuspended: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(userRef, newProfile);
        }

        const privSnap = await getDoc(privRef);
        if (!privSnap.exists() && firebaseUser.emailVerified) {
          const newPriv: UserPrivateInfo = {
            uid: firebaseUser.uid,
            email: (firebaseUser.email || '').slice(0, 160),
            preferredMode: 'motion',
            nightMode: true,
            layoutMode: 'single',
            fitMode: 'fit-width',
            nightTheme: 'oled',
            brightness: 100,
            zoom: 100,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(privRef, newPriv);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}`);
      }
    };

    const promise = run().finally(() => {
      ensuringMapRef.current.delete(firebaseUser.uid);
    });
    ensuringMapRef.current.set(firebaseUser.uid, promise);
    await promise;
  };

  const checkAdminStatus = async (firebaseUser: User): Promise<boolean> => {
    if (firebaseUser.email === BOOTSTRAP_ADMIN_EMAIL && firebaseUser.emailVerified) {
      return true;
    }
    try {
      const adminSnap = await getDoc(doc(db, 'admins', firebaseUser.uid));
      return adminSnap.exists();
    } catch {
      return false;
    }
  };

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubPrivate: (() => void) | null = null;
    let unsubNotifs: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      if (unsubPrivate) {
        unsubPrivate();
        unsubPrivate = null;
      }
      if (unsubNotifs) {
        unsubNotifs();
        unsubNotifs = null;
      }

      setUser(firebaseUser);

      if (!firebaseUser) {
        setProfile(null);
        setPrivateInfo(null);
        setIsAdmin(false);
        setNotifications([]);
        setLoading(false);
        return;
      }

      try {
        if (firebaseUser.emailVerified) {
          await ensureUserDocuments(firebaseUser);
        }
        const adminFlag = await checkAdminStatus(firebaseUser);
        setIsAdmin(adminFlag);

        const userPath = `users/${firebaseUser.uid}`;
        unsubProfile = onSnapshot(
          doc(db, 'users', firebaseUser.uid),
          (snap) => {
            if (snap.exists()) {
              setProfile(snap.data() as UserProfile);
            } else {
              setProfile(null);
            }
            setLoading(false);
          },
          (err) => {
            handleFirestoreError(err, OperationType.GET, userPath);
          }
        );

        const privPath = `users/${firebaseUser.uid}/private/info`;
        unsubPrivate = onSnapshot(
          doc(db, 'users', firebaseUser.uid, 'private', 'info'),
          (snap) => {
            if (snap.exists()) {
              setPrivateInfo(snap.data() as UserPrivateInfo);
            }
          },
          (err) => {
            handleFirestoreError(err, OperationType.GET, privPath);
          }
        );

        const notifsQuery = query(
          collection(db, 'notifications'),
          where('recipientId', '==', firebaseUser.uid)
        );
        unsubNotifs = onSnapshot(
          notifsQuery,
          (snap) => {
            const list = snap.docs.map((d) => d.data() as AppNotification);
            list.sort((a, b) => {
              const ta = (a.createdAt as { toMillis?: () => number })?.toMillis?.() || 0;
              const tb = (b.createdAt as { toMillis?: () => number })?.toMillis?.() || 0;
              return tb - ta;
            });
            setNotifications(list.slice(0, 30));
          },
          (err) => {
            handleFirestoreError(err, OperationType.LIST, 'notifications');
          }
        );
      } catch (err) {
        console.error(err);
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
      if (unsubPrivate) unsubPrivate();
      if (unsubNotifs) unsubNotifs();
    };
  }, []);

  const signInWithGoogle = async (preferredAccountType?: AccountType) => {
    pendingAccountTypeRef.current = preferredAccountType;
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await ensureUserDocuments(cred.user, preferredAccountType);
    } finally {
      pendingAccountTypeRef.current = undefined;
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (cred.user.emailVerified) {
      await ensureUserDocuments(cred.user);
    }
  };

  const registerWithEmail = async (params: {
    email: string;
    password: string;
    displayName: string;
    accountType: AccountType;
  }) => {
    pendingAccountTypeRef.current = params.accountType;
    try {
      const cred = await createUserWithEmailAndPassword(auth, params.email.trim(), params.password);
      await updateProfile(cred.user, {
        displayName: params.displayName.trim().slice(0, MAX_LIMITS.DISPLAY_NAME),
      });
      if (!cred.user.emailVerified) {
        await sendEmailVerification(cred.user);
        return { needsVerification: true };
      }
      await ensureUserDocuments(cred.user, params.accountType);
      return { needsVerification: false };
    } finally {
      pendingAccountTypeRef.current = undefined;
    }
  };

  const resendVerificationEmail = async () => {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  const updateUserProfile = async (
    patch: Partial<Pick<UserProfile, 'displayName' | 'handle' | 'bio' | 'avatarUrl' | 'accountType'>>
  ) => {
    if (!user) throw new Error('Usuário não autenticado.');
    const path = `users/${user.uid}`;
    try {
      const sanitized: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (patch.displayName !== undefined) {
        sanitized.displayName = patch.displayName.trim().slice(0, MAX_LIMITS.DISPLAY_NAME);
      }
      if (patch.handle !== undefined) {
        sanitized.handle = patch.handle
          .trim()
          .replace(/[^a-zA-Z0-9_.\-]/g, '_')
          .slice(0, MAX_LIMITS.HANDLE);
      }
      if (patch.bio !== undefined) {
        sanitized.bio = patch.bio.trim().slice(0, MAX_LIMITS.BIO);
      }
      if (patch.avatarUrl !== undefined) {
        sanitized.avatarUrl = patch.avatarUrl.slice(0, 600);
      }
      if (patch.accountType !== undefined) {
        sanitized.accountType = patch.accountType;
      }
      await updateDoc(doc(db, 'users', user.uid), sanitized);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const updateReaderPreferences = async (
    patch: Partial<
      Pick<
        UserPrivateInfo,
        'preferredMode' | 'nightMode' | 'layoutMode' | 'fitMode' | 'nightTheme' | 'brightness' | 'zoom'
      >
    >
  ) => {
    if (!user || !user.emailVerified) return;
    const path = `users/${user.uid}/private/info`;
    try {
      const sanitized: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (patch.preferredMode !== undefined) sanitized.preferredMode = patch.preferredMode as ReaderMode;
      if (patch.nightMode !== undefined) sanitized.nightMode = Boolean(patch.nightMode);
      if (patch.layoutMode !== undefined) sanitized.layoutMode = patch.layoutMode as ReaderLayoutMode;
      if (patch.fitMode !== undefined) sanitized.fitMode = patch.fitMode as ReaderFitMode;
      if (patch.nightTheme !== undefined) sanitized.nightTheme = patch.nightTheme as ReaderNightTheme;
      if (patch.brightness !== undefined) {
        sanitized.brightness = Math.min(100, Math.max(40, Math.round(Number(patch.brightness) || 100)));
      }
      if (patch.zoom !== undefined) {
        sanitized.zoom = Math.min(250, Math.max(50, Math.round(Number(patch.zoom) || 100)));
      }
      await updateDoc(doc(db, 'users', user.uid, 'private', 'info'), sanitized);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const refreshProfile = async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    setUser({ ...auth.currentUser } as User);
    if (auth.currentUser.emailVerified) {
      await ensureUserDocuments(auth.currentUser);
    }
  };

  const unreadNotificationsCount = notifications.filter((n) => !n.isRead).length;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        privateInfo,
        isAdmin,
        loading,
        notifications,
        unreadNotificationsCount,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        resendVerificationEmail,
        signOut,
        updateUserProfile,
        updateReaderPreferences,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  }
  return ctx;
}
