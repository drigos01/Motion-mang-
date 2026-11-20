import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { CommitWriteOp, FirestoreRestError, FirestoreTimestamp, StoredDocSnapshot } from '../server/firestoreRest.ts';
import { createMonetizationRouter } from '../server/monetizationRoutes.ts';
import {
  ActorIdentity,
  ChapterSummaryRecord,
  IdempotencyRecord,
  MangaSummaryRecord,
  MonetizationError,
  MonetizationRepository,
  UserSummaryRecord,
  assertAccountingInvariant,
  computeRevenueSplit,
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
} from '../server/monetizationService.ts';
import {
  MonetizationCreatorBalance,
  MonetizationLedgerEntry,
  MonetizationPayoutPayment,
  MonetizationPayoutProfile,
  MonetizationPayoutRequest,
  MonetizationRevenue,
  MonetizationSettings,
} from '../src/types/monetization.ts';

class InMemoryMonetizationRepository implements MonetizationRepository {
  public collections = new Map<string, Map<string, { data: Record<string, unknown>; version: number }>>();
  private seq = 1;

  constructor(seed?: {
    users?: UserSummaryRecord[];
    mangas?: MangaSummaryRecord[];
    chapters?: ChapterSummaryRecord[];
  }) {
    if (seed?.users) {
      for (const u of seed.users) {
        this.putDirect('users', u.uid, u as unknown as Record<string, unknown>);
      }
    }
    if (seed?.mangas) {
      for (const m of seed.mangas) {
        this.putDirect('mangas', m.id, m as unknown as Record<string, unknown>);
      }
    }
    if (seed?.chapters) {
      for (const c of seed.chapters) {
        this.putDirect(`mangas/${c.mangaId}/chapters`, c.id, c as unknown as Record<string, unknown>);
      }
    }
  }

  private col(name: string) {
    let map = this.collections.get(name);
    if (!map) {
      map = new Map();
      this.collections.set(name, map);
    }
    return map;
  }

  private putDirect(collection: string, docId: string, data: Record<string, unknown>) {
    this.col(collection).set(docId, {
      data: structuredClone(data),
      version: this.seq++,
    });
  }

  private getDoc<T>(collection: string, docId: string): StoredDocSnapshot<T> | null {
    const found = this.col(collection).get(docId);
    if (!found) return null;
    return {
      id: docId,
      data: structuredClone(found.data) as T,
      updateTime: `v_${found.version}`,
    };
  }

  private listDocs<T>(collection: string, filterCreatorId?: string): Array<StoredDocSnapshot<T>> {
    const out: Array<StoredDocSnapshot<T>> = [];
    for (const [id, entry] of this.col(collection).entries()) {
      if (filterCreatorId && entry.data.creatorId !== filterCreatorId) continue;
      out.push({
        id,
        data: structuredClone(entry.data) as T,
        updateTime: `v_${entry.version}`,
      });
    }
    return out;
  }

  async getSettings() {
    return this.getDoc<MonetizationSettings>('monetization_settings', 'global');
  }

  async getPayoutProfile(creatorId: string) {
    return this.getDoc<MonetizationPayoutProfile>('monetization_payout_profiles', creatorId);
  }

  async getBalance(creatorId: string) {
    return this.getDoc<MonetizationCreatorBalance>('monetization_creator_balances', creatorId);
  }

  async getRevenue(revenueId: string) {
    return this.getDoc<MonetizationRevenue>('monetization_revenues', revenueId);
  }

  async getLedgerEntry(entryId: string) {
    return this.getDoc<MonetizationLedgerEntry>('monetization_ledger', entryId);
  }

  async getPayoutRequest(requestId: string) {
    return this.getDoc<MonetizationPayoutRequest>('monetization_payout_requests', requestId);
  }

  async getIdempotency(key: string) {
    return this.getDoc<IdempotencyRecord>('monetization_idempotency', key);
  }

  async getManga(mangaId: string) {
    return this.getDoc<MangaSummaryRecord>('mangas', mangaId);
  }

  async getChapter(mangaId: string, chapterId: string) {
    return this.getDoc<ChapterSummaryRecord>(`mangas/${mangaId}/chapters`, chapterId);
  }

  async getUserProfile(uid: string) {
    return this.getDoc<UserSummaryRecord>('users', uid);
  }

  async listRevenues(creatorId?: string) {
    return this.listDocs<MonetizationRevenue>('monetization_revenues', creatorId);
  }

  async listLedgerEntries(creatorId?: string) {
    return this.listDocs<MonetizationLedgerEntry>('monetization_ledger', creatorId);
  }

  async listPayoutRequests(creatorId?: string) {
    return this.listDocs<MonetizationPayoutRequest>('monetization_payout_requests', creatorId);
  }

  async listPayoutPayments(creatorId?: string) {
    return this.listDocs<MonetizationPayoutPayment>('monetization_payout_payments', creatorId);
  }

  async listBalances() {
    return this.listDocs<MonetizationCreatorBalance>('monetization_creator_balances');
  }

  async listAllUsers() {
    return this.listDocs<UserSummaryRecord>('users');
  }

  async listAllMangas() {
    return this.listDocs<MangaSummaryRecord>('mangas');
  }

  async commit(ops: CommitWriteOp[]): Promise<void> {
    // 1. Validate preconditions atomically
    for (const op of ops) {
      const current = this.col(op.collection).get(op.docId);
      if (op.precondition?.exists === false && current) {
        throw new FirestoreRestError(`Document already exists: ${op.collection}/${op.docId}`, 409, 'ALREADY_EXISTS');
      }
      if (op.precondition?.exists === true && !current) {
        throw new FirestoreRestError(`Document missing: ${op.collection}/${op.docId}`, 409, 'FAILED_PRECONDITION');
      }
      if (op.precondition?.updateTime) {
        if (!current || `v_${current.version}` !== op.precondition.updateTime) {
          throw new FirestoreRestError(`Stale updateTime on ${op.collection}/${op.docId}`, 409, 'ABORTED');
        }
      }
    }

    // 2. Apply writes
    const nowIso = new Date().toISOString();
    for (const op of ops) {
      const normalized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(op.fields)) {
        if (v instanceof FirestoreTimestamp) {
          normalized[k] = v.iso;
        } else if (v instanceof Date) {
          normalized[k] = v.toISOString();
        } else {
          normalized[k] = structuredClone(v);
        }
      }
      for (const tsField of op.serverTimestampFields || []) {
        normalized[tsField] = nowIso;
      }
      this.putDirect(op.collection, op.docId, normalized);
    }
  }
}

const ADMIN: ActorIdentity = {
  uid: 'admin_1',
  email: 'helciorodri@gmail.com',
  displayName: 'Admin Principal',
};

const CREATOR_A: ActorIdentity = {
  uid: 'creator_a',
  email: 'artista.a@example.com',
  displayName: 'Artista A',
};

const CREATOR_B: ActorIdentity = {
  uid: 'creator_b',
  email: 'artista.b@example.com',
  displayName: 'Artista B',
};

function createSeededRepo() {
  return new InMemoryMonetizationRepository({
    users: [
      { uid: CREATOR_A.uid, displayName: 'Artista A', handle: 'artista_a', accountType: 'creator', worksCount: 2 },
      { uid: CREATOR_B.uid, displayName: 'Artista B', handle: 'artista_b', accountType: 'creator', worksCount: 1 },
    ],
    mangas: [
      { id: 'manga_ongoing', title: 'Lâmina Solar', authorId: CREATOR_A.uid, authorName: 'Artista A', status: 'ongoing', chaptersCount: 12 },
      { id: 'manga_completed', title: 'Crônicas Antigas', authorId: CREATOR_A.uid, authorName: 'Artista A', status: 'completed', chaptersCount: 40 },
      { id: 'manga_b', title: 'Sombra Lunar', authorId: CREATOR_B.uid, authorName: 'Artista B', status: 'ongoing', chaptersCount: 5 },
    ],
    chapters: [
      { id: 'ch_1', mangaId: 'manga_ongoing', chapterNumber: 1, title: 'Prólogo' },
    ],
  });
}

test('1 e 2. Registro, confirmação e cálculo exato da divisão 70/30', async () => {
  const repo = createSeededRepo();

  // Cálculo puro incluindo arredondamento exato
  const splitExact = computeRevenueSplit(10000, 70, 'work');
  assert.equal(splitExact.artistShareCents, 7000);
  assert.equal(splitExact.platformShareCents, 3000);
  assert.equal(splitExact.artistPercentApplied, 70);
  assert.equal(splitExact.platformPercentApplied, 30);

  const splitOdd = computeRevenueSplit(101, 70, 'work');
  assert.equal(splitOdd.artistShareCents + splitOdd.platformShareCents, 101);

  // Registro como pendente NÃO gera crédito ainda
  const pendingRev = await registerAdRevenue(repo, ADMIN, {
    attributionType: 'work',
    mangaId: 'manga_ongoing',
    chapterId: 'ch_1',
    referencePeriod: '2026-11',
    adImpressions: 15000,
    grossRevenueCents: 11200,
    networkDeductionsCents: 1200,
    netRevenueCents: 10000,
    source: 'Google AdSense',
    confirmImmediately: false,
  });

  assert.equal(pendingRev.confirmationStatus, 'pending');
  assert.equal(pendingRev.artistShareCents, 0);
  assert.equal(pendingRev.platformShareCents, 0);

  let dashBefore = await getCreatorMonetizationDashboard(repo, CREATOR_A.uid);
  assert.equal(dashBefore.balance.totalEarnedCents, 0);
  assert.equal(dashBefore.balance.availableCents, 0);

  // Confirmação aplica split 70/30 e credita artista + razão
  const confirmed = await confirmPendingRevenue(repo, ADMIN, {
    revenueId: pendingRev.id,
  });
  assert.equal(confirmed.confirmationStatus, 'confirmed');
  assert.equal(confirmed.artistShareCents, 7000);
  assert.equal(confirmed.platformShareCents, 3000);

  const dashAfter = await getCreatorMonetizationDashboard(repo, CREATOR_A.uid);
  assert.equal(dashAfter.balance.totalEarnedCents, 7000);
  assert.equal(dashAfter.balance.availableCents, 7000);
  assertAccountingInvariant(dashAfter.balance);
});

test('3. Isolamento entre artistas e bloqueio RBAC nas rotas HTTP', async () => {
  const repo = createSeededRepo();
  await registerAdRevenue(repo, ADMIN, {
    attributionType: 'work',
    mangaId: 'manga_ongoing',
    referencePeriod: '2026-11',
    netRevenueCents: 10000,
    source: 'Rede A',
    confirmImmediately: true,
  });
  await registerAdRevenue(repo, ADMIN, {
    attributionType: 'work',
    mangaId: 'manga_b',
    referencePeriod: '2026-11',
    netRevenueCents: 20000,
    source: 'Rede A',
    confirmImmediately: true,
  });

  // Dashboard do criador A não contém nada do criador B
  const dashA = await getCreatorMonetizationDashboard(repo, CREATOR_A.uid);
  assert.equal(dashA.balance.availableCents, 7000);
  assert.ok(dashA.revenues.every((r) => r.creatorId === CREATOR_A.uid));
  assert.ok(dashA.ledger.every((l) => l.creatorId === CREATOR_A.uid));

  const dashB = await getCreatorMonetizationDashboard(repo, CREATOR_B.uid);
  assert.equal(dashB.balance.availableCents, 14000);
  assert.ok(dashB.revenues.every((r) => r.creatorId === CREATOR_B.uid));

  // Teste HTTP real nas rotas Express: anônimo -> 401, criador tentando admin -> 403
  const app = express();
  app.use(express.json());
  app.use(
    '/api/monetization',
    createMonetizationRouter({
      authenticate: async (req) => {
        const hdr = req.headers.authorization;
        if (hdr === 'Bearer token_creator_a') {
          return { uid: CREATOR_A.uid, email: CREATOR_A.email, emailVerified: true, idToken: 't' };
        }
        if (hdr === 'Bearer token_admin') {
          return { uid: ADMIN.uid, email: ADMIN.email, emailVerified: true, idToken: 't' };
        }
        return null;
      },
      isAdmin: async (u) => u.uid === ADMIN.uid,
      createRepo: () => repo,
    })
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const unauth = await fetch(`${baseUrl}/api/monetization/creator/dashboard`);
    assert.equal(unauth.status, 401);

    const creatorAdminDash = await fetch(`${baseUrl}/api/monetization/admin/dashboard`, {
      headers: { Authorization: 'Bearer token_creator_a' },
    });
    assert.equal(creatorAdminDash.status, 403);

    const creatorRegisterRev = await fetch(`${baseUrl}/api/monetization/admin/revenues`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token_creator_a', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attributionType: 'work',
        mangaId: 'manga_ongoing',
        referencePeriod: '2026-11',
        netRevenueCents: 5000,
        source: 'Hack',
      }),
    });
    assert.equal(creatorRegisterRev.status, 403);

    const adminDashResp = await fetch(`${baseUrl}/api/monetization/admin/dashboard`, {
      headers: { Authorization: 'Bearer token_admin' },
    });
    assert.equal(adminDashResp.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('4. Separação entre saldo pendente e saldo disponível + liberação administrativa', async () => {
  const repo = createSeededRepo();
  await saveCreatorPayoutProfile(repo, CREATOR_A.uid, {
    beneficiaryName: 'Artista A',
    pixKeyType: 'email',
    pixKey: 'artista.a@example.com',
  });

  await registerAdRevenue(repo, ADMIN, {
    attributionType: 'work',
    mangaId: 'manga_ongoing',
    referencePeriod: '2026-11',
    netRevenueCents: 10000,
    releaseBucket: 'pending',
    source: 'AdSense',
    confirmImmediately: true,
  });

  const dashPending = await getCreatorMonetizationDashboard(repo, CREATOR_A.uid);
  assert.equal(dashPending.balance.totalEarnedCents, 7000);
  assert.equal(dashPending.balance.pendingCents, 7000);
  assert.equal(dashPending.balance.availableCents, 0);

  // Não pode sacar saldo pendente
  await assert.rejects(
    () => requestCreatorWithdrawal(repo, CREATOR_A, { amountCents: 5000 }),
    (err: unknown) => err instanceof MonetizationError && err.statusCode === 400
  );

  // Libera crédito pendente -> passa para availableCents
  const creditEntry = dashPending.ledger.find((l) => l.type === 'revenue_credit');
  assert.ok(creditEntry);
  await releasePendingLedgerCredit(repo, ADMIN, creditEntry.id);

  const dashReleased = await getCreatorMonetizationDashboard(repo, CREATOR_A.uid);
  assert.equal(dashReleased.balance.pendingCents, 0);
  assert.equal(dashReleased.balance.availableCents, 7000);
  assertAccountingInvariant(dashReleased.balance);
});

test('5 e 6. Solicitação de saque com Pix e bloqueios (sem Pix, abaixo do mínimo, acima do saldo)', async () => {
  const repo = createSeededRepo();
  await registerAdRevenue(repo, ADMIN, {
    attributionType: 'work',
    mangaId: 'manga_ongoing',
    referencePeriod: '2026-11',
    netRevenueCents: 10000, // 7000 cents pro artista
    source: 'AdSense',
    confirmImmediately: true,
  });

  // 6a. Bloqueio sem chave Pix cadastrada
  await assert.rejects(
    () => requestCreatorWithdrawal(repo, CREATOR_A, { amountCents: 5000 }),
    /Pix/
  );

  await saveCreatorPayoutProfile(repo, CREATOR_A.uid, {
    beneficiaryName: 'Artista A Oficial',
    pixKeyType: 'cpf',
    pixKey: '12345678900',
    pixBankName: 'Nubank',
  });

  // 6b. Bloqueio abaixo do valor mínimo (R$ 50,00 = 5000 cents)
  await assert.rejects(
    () => requestCreatorWithdrawal(repo, CREATOR_A, { amountCents: 3000 }),
    /mínimo/
  );

  // 6c. Bloqueio acima do saldo disponível (7000 cents)
  await assert.rejects(
    () => requestCreatorWithdrawal(repo, CREATOR_A, { amountCents: 9000 }),
    /excede/
  );

  // 5. Sucesso dentro das regras
  const req = await requestCreatorWithdrawal(repo, CREATOR_A, { amountCents: 6000 });
  assert.equal(req.status, 'pending');
  assert.equal(req.pixKeySnapshot, '12345678900');

  const dash = await getCreatorMonetizationDashboard(repo, CREATOR_A.uid);
  assert.equal(dash.balance.availableCents, 1000);
  assert.equal(dash.balance.withdrawalPendingCents, 6000);
  assertAccountingInvariant(dash.balance);
});

test('7 e 8. Aprovação/rejeição de saque e pagamento manual via Pix', async () => {
  const repo = createSeededRepo();
  await saveCreatorPayoutProfile(repo, CREATOR_A.uid, {
    beneficiaryName: 'Artista A',
    pixKeyType: 'email',
    pixKey: 'pix@artista.com',
  });
  await registerAdRevenue(repo, ADMIN, {
    attributionType: 'work',
    mangaId: 'manga_ongoing',
    referencePeriod: '2026-11',
    netRevenueCents: 20000, // 14000 cents
    source: 'AdSense',
    confirmImmediately: true,
  });

  // Solicitação 1 -> Rejeitada (exige motivo e devolve saldo)
  const req1 = await requestCreatorWithdrawal(repo, CREATOR_A, { amountCents: 7000 });
  await assert.rejects(
    () => reviewPayoutRequest(repo, ADMIN, { requestId: req1.id, decision: 'reject', reviewNote: '' }),
    /motivo/
  );

  const rejected = await reviewPayoutRequest(repo, ADMIN, {
    requestId: req1.id,
    decision: 'reject',
    reviewNote: 'Chave Pix não confere com titularidade.',
  });
  assert.equal(rejected.status, 'rejected');

  let dash = await getCreatorMonetizationDashboard(repo, CREATOR_A.uid);
  assert.equal(dash.balance.availableCents, 14000);
  assert.equal(dash.balance.withdrawalPendingCents, 0);

  // Solicitação 2 -> Aprovada -> Paga manualmente via Pix
  const req2 = await requestCreatorWithdrawal(repo, CREATOR_A, { amountCents: 10000 });
  const approved = await reviewPayoutRequest(repo, ADMIN, {
    requestId: req2.id,
    decision: 'approve',
  });
  assert.equal(approved.status, 'approved');

  const payment = await recordManualPixPayment(repo, ADMIN, {
    requestId: req2.id,
    transactionRef: 'E1234567820261117PIX01',
    paidDate: '2026-11-17',
    receiptUrl: '/api/media/file/admin/monetization/receipts/req2/comprovante.png',
    notes: 'Transferência manual executada via Banco do Brasil',
  });
  assert.equal(payment.amountPaidCents, 10000);
  assert.equal(payment.transactionRef, 'E1234567820261117PIX01');

  dash = await getCreatorMonetizationDashboard(repo, CREATOR_A.uid);
  assert.equal(dash.balance.availableCents, 4000);
  assert.equal(dash.balance.withdrawalPendingCents, 0);
  assert.equal(dash.balance.totalPaidCents, 10000);
  assert.equal(dash.balance.totalEarnedCents, 14000);
  assertAccountingInvariant(dash.balance);
});

test('9. Prevenção de duplicidade (idempotência, externalRef e pagamento concorrente)', async () => {
  const repo = createSeededRepo();
  await saveCreatorPayoutProfile(repo, CREATOR_A.uid, {
    beneficiaryName: 'Artista A',
    pixKeyType: 'random',
    pixKey: 'chave-aleatoria-uuid-123',
  });

  // Lançamento duplicado por externalRef + source
  await registerAdRevenue(repo, ADMIN, {
    attributionType: 'work',
    mangaId: 'manga_ongoing',
    referencePeriod: '2026-11',
    netRevenueCents: 10000,
    source: 'AdSense',
    externalRef: 'REL-2026-11-001',
    idempotencyKey: 'key_rev_1',
    confirmImmediately: true,
  });

  await assert.rejects(
    () =>
      registerAdRevenue(repo, ADMIN, {
        attributionType: 'work',
        mangaId: 'manga_ongoing',
        referencePeriod: '2026-11',
        netRevenueCents: 10000,
        source: 'AdSense',
        externalRef: 'REL-2026-11-001',
        confirmImmediately: true,
      }),
    (err: unknown) => err instanceof MonetizationError && err.statusCode === 409
  );

  // Idempotência na solicitação de saque
  const req = await requestCreatorWithdrawal(repo, CREATOR_A, {
    amountCents: 5000,
    idempotencyKey: 'wd_unique_1',
  });
  await assert.rejects(
    () =>
      requestCreatorWithdrawal(repo, CREATOR_A, {
        amountCents: 5000,
        idempotencyKey: 'wd_unique_1',
      }),
    (err: unknown) => err instanceof MonetizationError && err.statusCode === 409
  );

  await reviewPayoutRequest(repo, ADMIN, { requestId: req.id, decision: 'approve' });

  // Concorrência no pagamento Pix: duas chamadas simultâneas -> exatamente 1 sucesso, 1 erro 409
  const results = await Promise.allSettled([
    recordManualPixPayment(repo, ADMIN, {
      requestId: req.id,
      transactionRef: 'E2E-1',
      paidDate: '2026-11-17',
    }),
    recordManualPixPayment(repo, ADMIN, {
      requestId: req.id,
      transactionRef: 'E2E-2',
      paidDate: '2026-11-17',
    }),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
});

test('10. Alteração futura de percentual preserva integralmente lançamentos antigos', async () => {
  const repo = createSeededRepo();
  const revOld = await registerAdRevenue(repo, ADMIN, {
    attributionType: 'work',
    mangaId: 'manga_ongoing',
    referencePeriod: '2026-10',
    netRevenueCents: 10000,
    source: 'AdSense',
    confirmImmediately: true,
  });
  assert.equal(revOld.artistPercentApplied, 70);
  assert.equal(revOld.artistShareCents, 7000);

  // Muda política global para 80/20
  const updatedSettings = await updateMonetizationSettings(repo, ADMIN, {
    artistSharePercent: 80,
    minWithdrawalCents: 5000,
  });
  assert.equal(updatedSettings.artistSharePercent, 80);
  assert.equal(updatedSettings.platformSharePercent, 20);

  // Novo lançamento usa 80/20
  const revNew = await registerAdRevenue(repo, ADMIN, {
    attributionType: 'work',
    mangaId: 'manga_ongoing',
    referencePeriod: '2026-11',
    netRevenueCents: 10000,
    source: 'AdSense',
    confirmImmediately: true,
  });
  assert.equal(revNew.artistPercentApplied, 80);
  assert.equal(revNew.artistShareCents, 8000);

  // Registro antigo no banco permanece intocado em 70/30 e 7000 cents!
  const persistedOld = await repo.getRevenue(revOld.id);
  assert.equal(persistedOld?.data.artistPercentApplied, 70);
  assert.equal(persistedOld?.data.artistShareCents, 7000);

  const dash = await getCreatorMonetizationDashboard(repo, CREATOR_A.uid);
  assert.equal(dash.balance.totalEarnedCents, 15000); // 7000 + 8000
});

test('11. Obra antiga ou concluída continua elegível para gerar receita confirmada', async () => {
  const repo = createSeededRepo();
  const completedRev = await registerAdRevenue(repo, ADMIN, {
    attributionType: 'work',
    mangaId: 'manga_completed', // status === 'completed'
    referencePeriod: '2026-11',
    netRevenueCents: 5000,
    source: 'AdSense',
    confirmImmediately: true,
  });

  assert.equal(completedRev.artistShareCents, 3500);
  const dash = await getCreatorMonetizationDashboard(repo, CREATOR_A.uid);
  const completedWorkPerf = dash.workPerformance.find((w) => w.mangaId === 'manga_completed');
  assert.ok(completedWorkPerf);
  assert.equal(completedWorkPerf.artistShareCents, 3500);
});

test('12. Ajustes manuais, estornos com justificativa obrigatória, bloqueio de saldo negativo e receita não atribuída', async () => {
  const repo = createSeededRepo();

  // Receita não atribuída vai 100% para a plataforma, sem atribuir ficticiamente a nenhum artista
  const unattr = await registerAdRevenue(repo, ADMIN, {
    attributionType: 'unattributed',
    referencePeriod: '2026-11',
    netRevenueCents: 4500,
    source: 'Rede Sem Quebra por Obra',
    confirmImmediately: true,
  });
  assert.equal(unattr.artistShareCents, 0);
  assert.equal(unattr.platformShareCents, 4500);

  const rev = await registerAdRevenue(repo, ADMIN, {
    attributionType: 'work',
    mangaId: 'manga_ongoing',
    referencePeriod: '2026-11',
    netRevenueCents: 10000, // 7000 cents pro artista
    source: 'AdSense',
    confirmImmediately: true,
  });
  assert.equal(rev.artistShareCents, 7000);

  // Ajuste sem justificativa é rejeitado
  await assert.rejects(
    () =>
      createManualAdjustment(repo, ADMIN, {
        creatorId: CREATOR_A.uid,
        direction: 'credit',
        bucket: 'available',
        amountCents: 1000,
        justification: 'ok',
      }),
    /Justificativa obrigatória/
  );

  // Ajuste de débito maior que o saldo disponível é rejeitado (sem saldo negativo)
  await assert.rejects(
    () =>
      createManualAdjustment(repo, ADMIN, {
        creatorId: CREATOR_A.uid,
        direction: 'debit',
        bucket: 'available',
        amountCents: 99999,
        justification: 'Tentativa de débito maior que saldo.',
      }),
    (err: unknown) => err instanceof MonetizationError && err.statusCode === 409
  );

  // Ajuste positivo com justificativa
  await createManualAdjustment(repo, ADMIN, {
    creatorId: CREATOR_A.uid,
    direction: 'credit',
    bucket: 'available',
    amountCents: 1500,
    justification: 'Bonificação manual por divergência de relatório da rede.',
  });

  let dash = await getCreatorMonetizationDashboard(repo, CREATOR_A.uid);
  assert.equal(dash.balance.availableCents, 8500);

  // Estorno com referência ao lançamento original
  const creditEntry = dash.ledger.find((l) => l.type === 'revenue_credit');
  assert.ok(creditEntry);

  const reversal = await reverseLedgerEntry(repo, ADMIN, {
    originalEntryId: creditEntry.id,
    justification: 'Estorno por tráfego inválido descontado pela rede de anúncios.',
  });
  assert.equal(reversal.type, 'reversal');
  assert.equal(reversal.originalEntryId, creditEntry.id);
  assert.equal(reversal.amountCents, -7000);

  // Bloqueio de estorno duplicado
  await assert.rejects(
    () =>
      reverseLedgerEntry(repo, ADMIN, {
        originalEntryId: creditEntry.id,
        justification: 'Tentativa duplicada de estorno.',
      }),
    (err: unknown) => err instanceof MonetizationError && err.statusCode === 409
  );

  dash = await getCreatorMonetizationDashboard(repo, CREATOR_A.uid);
  assert.equal(dash.balance.availableCents, 1500);
  assertAccountingInvariant(dash.balance);

  // Conferência no painel admin com receita não atribuída incluída no total plataforma
  const adminDash = await getAdminMonetizationDashboard(repo);
  assert.equal(adminDash.overview.totalUnattributedNetCents, 4500);
  assert.equal(adminDash.overview.totalConfirmedNetCents, 14500);
  assert.equal(adminDash.overview.totalPlatformShareCents, 7500); // 4500 unattr + 3000 platform_fee
});
