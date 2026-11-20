import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApiApp } from './server/app.ts';
import {
  formatStartupConfigSummary,
  getAppConfig,
  getSafeConfigReport,
} from './server/config.ts';

async function startServer() {
  const appConfig = getAppConfig();
  const safeReport = getSafeConfigReport();
  console.log(formatStartupConfigSummary(safeReport));

  const app = createApiApp();
  const PORT = appConfig.runtime.port;

  if (!appConfig.runtime.isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { maxAge: '1d' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`MANGA MOTION server listening on http://0.0.0.0:${PORT}`);
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}

startServer();
