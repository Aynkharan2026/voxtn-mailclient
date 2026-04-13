const env = process.env;

export const config = {
  port: Number(env.IMAP_BRIDGE_PORT ?? 4001),
  logLevel: env.IMAP_BRIDGE_LOG_LEVEL ?? 'info',
  internalServiceToken: env.INTERNAL_SERVICE_TOKEN ?? '',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  databaseUrl: env.DATABASE_URL ?? '',
  unsubscribeSecret: env.UNSUBSCRIBE_SECRET ?? '',
  unsubscribeBaseUrl: (env.UNSUBSCRIBE_BASE_URL ?? '').replace(/\/$/, ''),
} as const;

if (!config.internalServiceToken) {
  // eslint-disable-next-line no-console
  console.warn(
    'voxmail-imap: INTERNAL_SERVICE_TOKEN is not set — all authenticated requests will fail.',
  );
}

if (!config.databaseUrl) {
  // eslint-disable-next-line no-console
  console.warn(
    'voxmail-imap: DATABASE_URL is not set — campaign and compliance routes will fail.',
  );
}

if (!config.unsubscribeSecret) {
  // eslint-disable-next-line no-console
  console.warn(
    'voxmail-imap: UNSUBSCRIBE_SECRET is not set — unsubscribe links cannot be signed or verified.',
  );
}
