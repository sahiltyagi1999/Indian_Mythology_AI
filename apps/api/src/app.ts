import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { logger } from './config/logger';
import { errorHandler } from './routes/util';
import { healthRouter } from './routes/health';
import { settingsRouter } from './routes/settings';
import { filesRouter } from './routes/files';
import { mountRoutes } from './routes';
import { brandingRouter } from './routes/analytics';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(express.json({ limit: '5mb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/files') === true || req.url === '/api/health' },
      serializers: { req: (req) => ({ method: req.method, url: req.url }), res: (res) => ({ statusCode: res.statusCode }) },
    }),
  );
  app.use('/api/health', healthRouter);
  app.use('/api/settings/branding', brandingRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/files', filesRouter);
  mountRoutes(app);
  app.use('/api', (_req, res) => res.status(404).json({ error: { message: 'Not found', code: 'NOT_FOUND' } }));
  app.use(errorHandler);
  return app;
}
