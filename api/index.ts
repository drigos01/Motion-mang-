import { createApiApp } from '../server/app.ts';
import { formatStartupConfigSummary, getSafeConfigReport } from '../server/config.ts';

const safeReport = getSafeConfigReport();
console.log(formatStartupConfigSummary(safeReport));

const app = createApiApp();

export default app;
