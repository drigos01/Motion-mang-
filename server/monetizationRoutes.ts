import express from 'express';
import {
  VerifiedFirebaseUser,
  checkIsAdminUser,
  verifyFirebaseIdToken,
} from './firestoreRest.ts';
import {
  ActorIdentity,
  FirestoreMonetizationRepository,
  MonetizationError,
  MonetizationRepository,
  cancelPendingRevenue,
  confirmPendingRevenue,
  createManualAdjustment,
  getAdminMonetizationDashboard,
  getCreatorMonetizationDashboard,
  recordManualPixPayment,
  registerAdRevenue,
  releasePendingLedgerCredit,
  requestCreatorWithdrawal,
  reverseLedgerEntry,
  reviewPayoutRequest,
  saveCreatorPayoutProfile,
  updateMonetizationSettings,
} from './monetizationService.ts';

interface AuthenticatedRequest extends express.Request {
  authUser?: VerifiedFirebaseUser;
  monetizationRepo?: MonetizationRepository;
}

export interface MonetizationRouterDeps {
  authenticate?: (req: express.Request) => Promise<VerifiedFirebaseUser | null>;
  isAdmin?: (user: VerifiedFirebaseUser) => Promise<boolean>;
  createRepo?: (user: VerifiedFirebaseUser) => MonetizationRepository;
}

function sendError(res: express.Response, err: unknown): void {
  if (err instanceof MonetizationError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  console.error('Monetization API error:', err);
  const message =
    err instanceof Error && err.message
      ? err.message
      : 'Erro interno no serviço de monetização.';
  res.status(500).json({ error: message });
}

export function createMonetizationRouter(deps: MonetizationRouterDeps = {}): express.Router {
  const router = express.Router();

  const authenticateFn =
    deps.authenticate ||
    ((req: express.Request) => verifyFirebaseIdToken(req.headers.authorization));

  const isAdminFn =
    deps.isAdmin ||
    ((user: VerifiedFirebaseUser) => checkIsAdminUser(user.uid, user.email, user.idToken));

  const createRepoFn =
    deps.createRepo ||
    ((user: VerifiedFirebaseUser) => new FirestoreMonetizationRepository(user.idToken));

  const requireVerifiedUser: express.RequestHandler = async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = await authenticateFn(req);
      if (!user || !user.emailVerified) {
        res.status(401).json({ error: 'Autenticação verificada obrigatória.' });
        return;
      }
      req.authUser = user;
      req.monetizationRepo = createRepoFn(user);
      next();
    } catch (err) {
      sendError(res, err);
    }
  };

  const requireAdmin: express.RequestHandler = async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.authUser;
      if (!user) {
        res.status(401).json({ error: 'Não autenticado.' });
        return;
      }
      const allowed = await isAdminFn(user);
      if (!allowed) {
        res.status(403).json({ error: 'Acesso restrito a administradores da plataforma.' });
        return;
      }
      next();
    } catch (err) {
      sendError(res, err);
    }
  };

  function toActor(user: VerifiedFirebaseUser): ActorIdentity {
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.email.split('@')[0] || 'Usuário',
    };
  }

  // --- Creator Endpoints (Strict Ownership) ---

  router.get('/creator/dashboard', requireVerifiedUser, async (req: AuthenticatedRequest, res) => {
    try {
      const dashboard = await getCreatorMonetizationDashboard(
        req.monetizationRepo!,
        req.authUser!.uid
      );
      res.json(dashboard);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.put(
    '/creator/payout-profile',
    requireVerifiedUser,
    async (req: AuthenticatedRequest, res) => {
      try {
        const profile = await saveCreatorPayoutProfile(
          req.monetizationRepo!,
          req.authUser!.uid,
          req.body || {}
        );
        res.json({ profile });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/creator/withdrawals',
    requireVerifiedUser,
    async (req: AuthenticatedRequest, res) => {
      try {
        const request = await requestCreatorWithdrawal(
          req.monetizationRepo!,
          toActor(req.authUser!),
          req.body || {}
        );
        res.status(201).json({ request });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  // --- Admin Endpoints (Strict Admin RBAC) ---

  router.get(
    '/admin/dashboard',
    requireVerifiedUser,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const dashboard = await getAdminMonetizationDashboard(req.monetizationRepo!, {
          creatorId: typeof req.query.creatorId === 'string' ? req.query.creatorId : undefined,
          mangaId: typeof req.query.mangaId === 'string' ? req.query.mangaId : undefined,
          referencePeriod:
            typeof req.query.referencePeriod === 'string' ? req.query.referencePeriod : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
        });
        res.json(dashboard);
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.put(
    '/admin/settings',
    requireVerifiedUser,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const settings = await updateMonetizationSettings(
          req.monetizationRepo!,
          toActor(req.authUser!),
          req.body || {}
        );
        res.json({ settings });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/admin/revenues',
    requireVerifiedUser,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const revenue = await registerAdRevenue(
          req.monetizationRepo!,
          toActor(req.authUser!),
          req.body || {}
        );
        res.status(201).json({ revenue });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/admin/revenues/:id/confirm',
    requireVerifiedUser,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const revenue = await confirmPendingRevenue(
          req.monetizationRepo!,
          toActor(req.authUser!),
          {
            revenueId: req.params.id,
            releaseBucket: req.body?.releaseBucket,
            idempotencyKey: req.body?.idempotencyKey,
          }
        );
        res.json({ revenue });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/admin/revenues/:id/cancel',
    requireVerifiedUser,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const revenue = await cancelPendingRevenue(
          req.monetizationRepo!,
          toActor(req.authUser!),
          req.params.id,
          String(req.body?.reason || '')
        );
        res.json({ revenue });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/admin/ledger/:id/release',
    requireVerifiedUser,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const balance = await releasePendingLedgerCredit(
          req.monetizationRepo!,
          toActor(req.authUser!),
          req.params.id
        );
        res.json({ balance });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/admin/ledger/:id/reverse',
    requireVerifiedUser,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const entry = await reverseLedgerEntry(req.monetizationRepo!, toActor(req.authUser!), {
          originalEntryId: req.params.id,
          justification: String(req.body?.justification || ''),
          idempotencyKey: req.body?.idempotencyKey,
        });
        res.status(201).json({ entry });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/admin/adjustments',
    requireVerifiedUser,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const entry = await createManualAdjustment(
          req.monetizationRepo!,
          toActor(req.authUser!),
          req.body || {}
        );
        res.status(201).json({ entry });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/admin/payout-requests/:id/review',
    requireVerifiedUser,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const request = await reviewPayoutRequest(
          req.monetizationRepo!,
          toActor(req.authUser!),
          {
            requestId: req.params.id,
            decision: req.body?.decision,
            reviewNote: req.body?.reviewNote,
          }
        );
        res.json({ request });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/admin/payout-requests/:id/pay',
    requireVerifiedUser,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const payment = await recordManualPixPayment(
          req.monetizationRepo!,
          toActor(req.authUser!),
          {
            requestId: req.params.id,
            transactionRef: req.body?.transactionRef,
            paidDate: req.body?.paidDate,
            amountPaidCents: req.body?.amountPaidCents,
            receiptUrl: req.body?.receiptUrl,
            notes: req.body?.notes,
            idempotencyKey: req.body?.idempotencyKey,
          }
        );
        res.status(201).json({ payment });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  return router;
}
