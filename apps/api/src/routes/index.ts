import type { Express } from 'express';
import { sourcesRouter } from './sources';
import { outlinesRouter } from './outlines';
import { episodesRouter } from './episodes';
import { charactersRouter } from './characters';
import { jobsRouter } from './jobs';
import { batchesRouter, videosRouter } from './videos';
import { analyticsRouter, dashboardRouter, musicRouter } from './analytics';

export function mountRoutes(app: Express) {
  app.use('/api/sources', sourcesRouter);
  app.use('/api', outlinesRouter);
  app.use('/api', episodesRouter);
  app.use('/api/characters', charactersRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/videos', videosRouter);
  app.use('/api/batches', batchesRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/music', musicRouter);
}
