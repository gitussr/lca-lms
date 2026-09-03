import { buildApp } from './app.js';
import { config } from './shared/config.js';

/**
 * Process entrypoint: build the app, start listening, and shut down cleanly on
 * SIGINT/SIGTERM so in-flight requests drain and (later) pools close.
 */
async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

void main();
