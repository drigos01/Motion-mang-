import express from 'express';
import { getSafeConfigReport } from './config.ts';
import {
  deleteMediaFile,
  getMediaFileStream,
  getStorageConfigStatus,
  headMediaFile,
  normalizeMediaKey,
  sanitizeSegment,
  StorageConfigError,
} from './storage.ts';
import {
  checkIsAdminUser,
  verifyFirebaseIdToken,
} from './firestoreRest.ts';
import {
  createMediaUploadHandler,
  type MediaUploadHandlerDeps,
} from './mediaUploadHandler.ts';
import {
  createMonetizationRouter,
  type MonetizationRouterDeps,
} from './monetizationRoutes.ts';

export interface ApiAppOptions {
  uploadDeps?: MediaUploadHandlerDeps;
  monetizationDeps?: MonetizationRouterDeps;
  verifyToken?: typeof verifyFirebaseIdToken;
  checkAdmin?: typeof checkIsAdminUser;
  deleteFile?: typeof deleteMediaFile;
  headFile?: typeof headMediaFile;
  getFileStream?: typeof getMediaFileStream;
}

export function createApiApp(options: ApiAppOptions = {}): express.Express {
  const app = express();

  const verifyTokenFn = options.verifyToken ?? verifyFirebaseIdToken;
  const checkAdminFn = options.checkAdmin ?? checkIsAdminUser;
  const deleteFileFn = options.deleteFile ?? deleteMediaFile;
  const headFileFn = options.headFile ?? headMediaFile;
  const getFileStreamFn = options.getFileStream ?? getMediaFileStream;

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    const report = getSafeConfigReport();
    res.json({
      ok: true,
      service: 'manga-motion',
      configOk: report.ok,
      platform: report.platform,
      storage: {
        driver: report.storage.driver,
        requestedDriver: report.storage.requestedDriver,
        configured: report.storage.configured,
        proxyMode: report.storage.proxyMode,
        missingVars: report.storage.missingVars,
        errors: report.storage.errors,
        warnings: report.storage.warnings,
      },
      firebaseConfigured: report.firebase.configured,
      geminiConfigured: report.gemini.configured,
    });
  });

  app.get('/api/storage/status', (_req, res) => {
    const status = getStorageConfigStatus();
    const report = getSafeConfigReport();
    res.json({
      ...status,
      firebaseConfigured: report.firebase.configured,
      firebaseProjectId: report.firebase.projectId,
      firebaseDatabaseId: report.firebase.databaseId,
      geminiConfigured: report.gemini.configured,
    });
  });

  app.use('/api/monetization', createMonetizationRouter(options.monetizationDeps));

  // Real authenticated media upload endpoint (covers, banners, avatars, original pages, motion loops, admin receipts)
  app.post('/api/media/upload', createMediaUploadHandler(options.uploadDeps));

  // Delete uploaded media owned by user (or receipt by admin)
  app.post('/api/media/delete', async (req, res) => {
    try {
      const user = await verifyTokenFn(req.headers.authorization);
      if (!user || !user.emailVerified) {
        res.status(401).json({ error: 'Não autorizado.' });
        return;
      }
      const rawKey = String(req.body?.key || '');
      const cleanKey = normalizeMediaKey(rawKey);
      if (!cleanKey) {
        res.status(400).json({ error: 'Identificador de arquivo inválido.' });
        return;
      }
      const isReceipt = cleanKey.startsWith('admin/monetization/receipts/');
      if (isReceipt) {
        const isAdmin = await checkAdminFn(user.uid, user.email, user.idToken);
        if (!isAdmin) {
          res.status(403).json({ error: 'Permissão negada para remover este comprovante.' });
          return;
        }
      } else if (!cleanKey.startsWith(`users/${sanitizeSegment(user.uid)}/`)) {
        res.status(403).json({ error: 'Você só pode remover seus próprios arquivos.' });
        return;
      }
      await deleteFileFn(cleanKey);
      res.json({ deleted: true, key: cleanKey });
    } catch (err) {
      if (err instanceof StorageConfigError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Delete media error:', err);
      res.status(500).json({ error: 'Erro ao remover arquivo do armazenamento.' });
    }
  });

  // HEAD metadata support for browsers / video players
  app.head('/api/media/file/*', async (req, res) => {
    try {
      const relPath = (req.params as Record<string, string>)[0] || '';
      const meta = await headFileFn(relPath);
      if (!meta) {
        res.status(404).end();
        return;
      }
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Content-Type', meta.contentType);
      if (meta.contentLength !== undefined) {
        res.setHeader('Content-Length', String(meta.contentLength));
      }
      if (meta.etag) {
        res.setHeader('ETag', meta.etag);
      }
      res.status(200).end();
    } catch (err) {
      if (err instanceof StorageConfigError) {
        res.status(err.statusCode).end();
        return;
      }
      console.error('Media HEAD error:', err);
      res.status(502).end();
    }
  });

  // Proxy media delivery via S3/Bunny GetObject (or local fallback) with real streaming & HTTP 206 Byte-Range
  app.get('/api/media/file/*', async (req, res) => {
    try {
      const relPath = (req.params as Record<string, string>)[0] || '';
      const outcome = await getFileStreamFn(relPath, req.headers.range);

      if (outcome.kind === 'not_found') {
        res.status(404).json({ error: 'Arquivo não encontrado.' });
        return;
      }

      if (outcome.kind === 'invalid_range') {
        if (outcome.totalSize !== undefined) {
          res.setHeader('Content-Range', `bytes */${outcome.totalSize}`);
        }
        res.status(416).end();
        return;
      }

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Content-Type', outcome.contentType);
      if (outcome.etag) {
        res.setHeader('ETag', outcome.etag);
      }

      if (outcome.statusCode === 206 && outcome.contentRange) {
        res.status(206);
        res.setHeader('Content-Range', outcome.contentRange);
      } else {
        res.status(200);
      }

      if (outcome.contentLength !== undefined) {
        res.setHeader('Content-Length', String(outcome.contentLength));
      }

      const stream = outcome.stream;
      const cleanup = () => {
        if (!stream.destroyed) {
          stream.destroy();
        }
      };

      res.on('close', cleanup);
      stream.on('error', (streamErr) => {
        console.error('Media stream error:', streamErr);
        res.off('close', cleanup);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Falha ao transmitir mídia do armazenamento.' });
        } else {
          res.destroy();
        }
      });

      stream.pipe(res);
    } catch (err) {
      if (err instanceof StorageConfigError) {
        if (!res.headersSent) {
          res.status(err.statusCode).json({ error: err.message });
        }
        return;
      }
      console.error('Media GET error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Erro ao ler arquivo do armazenamento.' });
      }
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Rota de API não encontrada.' });
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (!req.path.startsWith('/api')) {
        next(err);
        return;
      }
      console.error('Unhandled API error:', err);
      if (res.headersSent) return;
      const statusCode =
        err &&
        typeof err === 'object' &&
        'status' in err &&
        typeof (err as { status?: unknown }).status === 'number'
          ? (err as { status: number }).status
          : err instanceof StorageConfigError
            ? err.statusCode
            : 500;
      const message =
        err instanceof Error && err.message && err.message !== 'UnknownError'
          ? err.message
          : 'Erro interno no servidor de mídia.';
      res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({ error: message });
    }
  );

  return app;
}
