import fs from 'fs';
import path from 'path';

export interface FirebaseAppletConfig {
  apiKey?: string;
  projectId?: string;
  firestoreDatabaseId?: string;
}

export const BOOTSTRAP_ADMIN_EMAIL = 'helciorodri@gmail.com';

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  idToken: string;
}

export class FirestoreTimestamp {
  public readonly iso: string;
  constructor(value: string | Date) {
    const d = value instanceof Date ? value : new Date(value);
    this.iso = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
}

export class FirestoreRestError extends Error {
  public readonly statusCode: number;
  public readonly firestoreStatus?: string;

  constructor(message: string, statusCode = 500, firestoreStatus?: string) {
    super(message);
    this.name = 'FirestoreRestError';
    this.statusCode = statusCode;
    this.firestoreStatus = firestoreStatus;
  }
}

export function loadFirebaseAppletConfig(): FirebaseAppletConfig {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as FirebaseAppletConfig;
  } catch {
    return {};
  }
}

function getFirestoreBasePaths() {
  const cfg = loadFirebaseAppletConfig();
  if (!cfg.projectId) {
    throw new FirestoreRestError('Configuração Firebase ausente no servidor.', 500);
  }
  const dbId = cfg.firestoreDatabaseId || '(default)';
  const docRoot = `projects/${cfg.projectId}/databases/${dbId}/documents`;
  const apiBase = `https://firestore.googleapis.com/v1/${docRoot}`;
  return { cfg, docRoot, apiBase };
}

export async function verifyFirebaseIdToken(authHeader?: string): Promise<VerifiedFirebaseUser | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;

  const cfg = loadFirebaseAppletConfig();
  if (!cfg.apiKey) return null;

  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(cfg.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const user = data.users?.[0];
    if (!user?.localId) return null;
    return {
      uid: user.localId,
      email: user.email || '',
      emailVerified: Boolean(user.emailVerified),
      idToken,
    };
  } catch {
    return null;
  }
}

type FirestoreRawValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreRawValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreRawValue> } };

interface FirestoreRawDoc {
  name: string;
  fields?: Record<string, FirestoreRawValue>;
  createTime?: string;
  updateTime?: string;
}

export function encodeFirestoreValue(val: unknown): FirestoreRawValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (val instanceof FirestoreTimestamp) {
    return { timestampValue: val.iso };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { integerValue: '0' };
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => encodeFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreRawValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function encodeFirestoreFields(obj: Record<string, unknown>): Record<string, FirestoreRawValue> {
  const out: Record<string, FirestoreRawValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = encodeFirestoreValue(v);
    }
  }
  return out;
}

export function decodeFirestoreValue(raw: FirestoreRawValue | undefined): unknown {
  if (!raw) return undefined;
  if ('nullValue' in raw) return null;
  if ('booleanValue' in raw) return raw.booleanValue;
  if ('integerValue' in raw) return Number(raw.integerValue);
  if ('doubleValue' in raw) return Number(raw.doubleValue);
  if ('timestampValue' in raw) return raw.timestampValue;
  if ('stringValue' in raw) return raw.stringValue;
  if ('arrayValue' in raw) {
    return (raw.arrayValue.values || []).map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in raw) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw.mapValue.fields || {})) {
      obj[k] = decodeFirestoreValue(v);
    }
    return obj;
  }
  return undefined;
}

export function decodeFirestoreDocument<T>(doc: FirestoreRawDoc): {
  id: string;
  data: T;
  updateTime?: string;
} {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields || {})) {
    obj[k] = decodeFirestoreValue(v);
  }
  const parts = doc.name.split('/');
  const id = parts[parts.length - 1] || '';
  return {
    id,
    data: obj as T,
    updateTime: doc.updateTime,
  };
}

function parseFirestoreErrorBody(status: number, bodyText: string): FirestoreRestError {
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; status?: string; code?: number };
    };
    const fbStatus = parsed.error?.status;
    const msg = parsed.error?.message || bodyText;
    if (
      fbStatus === 'ALREADY_EXISTS' ||
      fbStatus === 'FAILED_PRECONDITION' ||
      fbStatus === 'ABORTED'
    ) {
      return new FirestoreRestError(
        `Conflito ou duplicidade na operação financeira (${fbStatus}): ${msg}`,
        409,
        fbStatus
      );
    }
    if (fbStatus === 'PERMISSION_DENIED') {
      return new FirestoreRestError(
        'Permissão negada pelas regras de segurança do banco de dados.',
        403,
        fbStatus
      );
    }
    if (fbStatus === 'NOT_FOUND') {
      return new FirestoreRestError('Registro não encontrado no banco de dados.', 404, fbStatus);
    }
    return new FirestoreRestError(msg || 'Erro no Firestore.', status, fbStatus);
  } catch {
    return new FirestoreRestError(bodyText || 'Erro de comunicação com o Firestore.', status);
  }
}

export interface StoredDocSnapshot<T> {
  id: string;
  data: T;
  updateTime?: string;
}

export async function getFirestoreDocument<T>(
  collectionPath: string,
  docId: string,
  idToken: string
): Promise<StoredDocSnapshot<T> | null> {
  const { apiBase } = getFirestoreBasePaths();
  const cleanCol = collectionPath.replace(/^\/+|\/+$/g, '');
  const cleanId = encodeURIComponent(docId);
  const resp = await fetch(`${apiBase}/${cleanCol}/${cleanId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (resp.status === 404) {
    return null;
  }
  if (!resp.ok) {
    const errText = await resp.text();
    throw parseFirestoreErrorBody(resp.status, errText);
  }

  const raw = (await resp.json()) as FirestoreRawDoc;
  return decodeFirestoreDocument<T>(raw);
}

export async function runFirestoreQuery<T>(
  collectionId: string,
  idToken: string,
  whereEquals?: { field: string; value: string }
): Promise<Array<StoredDocSnapshot<T>>> {
  const { apiBase } = getFirestoreBasePaths();
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId }],
  };

  if (whereEquals) {
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: whereEquals.field },
        op: 'EQUAL',
        value: encodeFirestoreValue(whereEquals.value),
      },
    };
  }

  const resp = await fetch(`${apiBase}:runQuery`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ structuredQuery }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw parseFirestoreErrorBody(resp.status, errText);
  }

  const rows = (await resp.json()) as Array<{ document?: FirestoreRawDoc }>;
  const results: Array<StoredDocSnapshot<T>> = [];
  for (const row of rows) {
    if (row.document) {
      results.push(decodeFirestoreDocument<T>(row.document));
    }
  }
  return results;
}

export interface CommitWriteOp {
  collection: string;
  docId: string;
  fields: Record<string, unknown>;
  serverTimestampFields?: string[];
  precondition?: {
    exists?: boolean;
    updateTime?: string;
  };
}

export async function commitFirestoreWrites(
  ops: CommitWriteOp[],
  idToken: string
): Promise<void> {
  if (ops.length === 0) return;
  const { docRoot, apiBase } = getFirestoreBasePaths();

  const writes = ops.map((op) => {
    const cleanCol = op.collection.replace(/^\/+|\/+$/g, '');
    const serverFields = new Set(op.serverTimestampFields || []);
    const filteredFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(op.fields)) {
      if (!serverFields.has(k) && v !== undefined) {
        filteredFields[k] = v;
      }
    }

    const writePayload: Record<string, unknown> = {
      update: {
        name: `${docRoot}/${cleanCol}/${op.docId}`,
        fields: encodeFirestoreFields(filteredFields),
      },
    };

    if (serverFields.size > 0) {
      writePayload.updateTransforms = Array.from(serverFields).map((fieldPath) => ({
        fieldPath,
        setToServerValue: 'REQUEST_TIME',
      }));
    }

    if (op.precondition) {
      if (op.precondition.updateTime) {
        writePayload.currentDocument = { updateTime: op.precondition.updateTime };
      } else if (op.precondition.exists !== undefined) {
        writePayload.currentDocument = { exists: op.precondition.exists };
      }
    }

    return writePayload;
  });

  const resp = await fetch(`${apiBase}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw parseFirestoreErrorBody(resp.status, errText);
  }
}

export async function checkIsAdminUser(
  uid: string,
  email: string,
  idToken: string
): Promise<boolean> {
  if (email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }
  const adminDoc = await getFirestoreDocument<{ uid: string }>('admins', uid, idToken);
  return adminDoc !== null;
}
