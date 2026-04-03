import express from 'express';
import cors from 'cors';
import { authMiddleware, isAllowedOrigin, requestIdMiddleware } from '../middleware.js';
import { isProduction } from '../env.js';
import sessionsRouter from './routes/sessions.js';
import metaRouter from './routes/meta.js';
import workflowsRouter from './routes/workflows.js';
import experimentsRouter from './routes/experiments.js';

/**
 * Build the Express application (REST + global middleware + error handler).
 * WebSocket is attached separately in server.js.
 */
export function createApp() {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(
    cors({
      origin(origin, cb) {
        if (isAllowedOrigin(origin)) return cb(null, true);
        cb(new Error('CORS: origin not allowed'));
      },
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(authMiddleware);

  app.use('/api', sessionsRouter);
  app.use('/api', metaRouter);
  app.use('/api', workflowsRouter);
  app.use('/api', experimentsRouter);

  app.use((err, req, res, _next) => {
    const rid = req.requestId;
    console.error('[server] Unhandled route error:', rid || '(no-request-id)', err);
    const body = {
      error: isProduction() ? 'internal server error' : err.message || 'internal server error',
    };
    if (rid) body.requestId = rid;
    res.status(500).json(body);
  });

  return app;
}
