import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT ?? 4000),
  env: process.env.NODE_ENV ?? 'development',
  dataDir: process.env.OMA_DATA_DIR ?? path.join(root, 'data'),
  dbFile: process.env.OMA_DB_FILE ?? path.join(process.env.OMA_DATA_DIR ?? path.join(root, 'data'), 'oma.sqlite'),
  // 32-byte master key (base64). In production this comes from a KMS; the dev default is deterministic so seeds work.
  masterKey: process.env.OMA_MASTER_KEY ?? 'b21hLWRldi1vbmx5LW1hc3Rlci1rZXktMzJieXRlcyE=',
  jwtSecret: process.env.OMA_JWT_SECRET ?? 'dev-only-jwt-secret-change-me',
  sessionHours: 12,
  maxUploadBytes: 12 * 1024 * 1024,
  webDist: path.join(root, '..', 'web', 'dist'),
  seedAssets: path.join(root, 'seed-assets'),
  root,
};

export const isProd = () => config.env === 'production';
