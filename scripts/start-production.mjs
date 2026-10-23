import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { installLitestream } from './install-litestream.mjs';

async function main() {
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
  const hasR2Credentials = Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );

  const binPath = path.resolve(process.cwd(), 'bin', 'litestream');
  const configPath = path.resolve(process.cwd(), 'litestream.yml');
  const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'booknest.db');

  if (hasR2Credentials && process.platform === 'linux' && fs.existsSync(configPath)) {
    try {
      console.log('🔄 [BookNest Persistence] Cloudflare R2 credentials detected. Preparing Litestream replication...');
      const litestreamBin = await installLitestream();

      if (litestreamBin && fs.existsSync(litestreamBin)) {
        // Step 1: Restore if replica exists in R2
        console.log('📥 [BookNest Persistence] Checking for existing database replica in Cloudflare R2...');
        try {
          const restoreProc = spawn(litestreamBin, [
            'restore',
            '-if-replica-exists',
            '-if-db-not-exists',
            '-config', configPath,
            dbPath
          ], { stdio: 'inherit' });

          await new Promise((resolve) => {
            restoreProc.on('close', (code) => {
              if (code === 0) {
                console.log('✅ [BookNest Persistence] Database restore check completed successfully.');
              } else {
                console.warn(`⚠️ [BookNest Persistence] Restore check exited with code ${code}. Proceeding with local/seed database.`);
              }
              resolve();
            });
          });
        } catch (restoreErr) {
          console.warn('⚠️ [BookNest Persistence] Restore check warning:', restoreErr.message);
        }

        // Step 2: Launch application supervised by Litestream continuous replication
        console.log('🚀 [BookNest Persistence] Starting BookNest under Litestream continuous WAL replication...');
        const replicateProc = spawn(litestreamBin, [
          'replicate',
          '-config', configPath,
          '-exec', 'npm start'
        ], { stdio: 'inherit', env: process.env });

        replicateProc.on('close', (code) => {
          process.exit(code ?? 0);
        });

        const forwardSignal = (sig) => {
          if (replicateProc && !replicateProc.killed) {
            replicateProc.kill(sig);
          }
        };
        process.on('SIGTERM', () => forwardSignal('SIGTERM'));
        process.on('SIGINT', () => forwardSignal('SIGINT'));
        return;
      }
    } catch (err) {
      console.warn('⚠️ [BookNest Persistence] Litestream initialization failed. Falling back to local SQLite:', err.message);
    }
  }

  // Fallback / Standard Local Mode
  if (!hasR2Credentials) {
    console.log('📦 [BookNest Persistence] Running in Local SQLite Mode.');
    console.log('   (Cloudflare R2 credentials not detected. To enable continuous cloud backup, set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME)\n');
  }

  // Start Node backend directly
  const isWindows = process.platform === 'win32';
  const startCmd = isWindows ? 'npx.cmd' : 'npx';
  const serverProc = spawn(startCmd, ['tsx', 'server/index.ts'], {
    stdio: 'inherit',
    env: process.env
  });

  serverProc.on('close', (code) => {
    process.exit(code ?? 0);
  });

  const forwardSignal = (sig) => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill(sig);
    }
  };
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  process.on('SIGINT', () => forwardSignal('SIGINT'));
}

main().catch((err) => {
  console.error('[Startup Fatal Error]:', err);
  process.exit(1);
});
