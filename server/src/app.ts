import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, isProd } from './config.js';
import { authenticate } from './security/auth.js';
import { errorHandler, HttpError } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { reviewRouter } from './routes/review.js';
import { patientsRouter } from './routes/patients.js';
import { schedulingRouter } from './routes/scheduling.js';
import { settingsRouter } from './routes/settings.js';
import { patientAppRouter } from './routes/patientApp.js';
import { adminRouter } from './routes/admin.js';
import { publicRouter } from './routes/public.js';
import { integrationsRouter } from './routes/integrations.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=()');
    if (isProd()) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Dev CORS for the Android emulator / Vite dev server. Production serves the web app from the same origin.
  app.use((req, res, next) => {
    if (!isProd()) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(authenticate);

  const v1 = express.Router();
  v1.get('/health', (_req, res) => res.json({ status: 'ok', service: 'ortho-monitoring-ai', version: '1.0.0' }));
  v1.use('/auth', authRouter);
  v1.use('/patient', patientAppRouter);
  v1.use('/admin', adminRouter);
  v1.use('/public', publicRouter);
  v1.use('/integrations', integrationsRouter);
  v1.use(reviewRouter, patientsRouter, schedulingRouter, settingsRouter);
  v1.get('/openapi.yaml', (_req, res) => res.type('text/yaml').send(fs.readFileSync(path.join(config.root, '..', 'docs', 'openapi.yaml'), 'utf8')));
  v1.use((_req, _res, next) => next(new HttpError(404, 'Endpoint not found', 'not_found')));
  app.use('/api/v1', v1);

  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
