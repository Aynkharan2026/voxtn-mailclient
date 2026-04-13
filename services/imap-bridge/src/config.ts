const env = process.env;

export const config = {
  port: Number(env.IMAP_BRIDGE_PORT ?? 4001),
  logLevel: env.IMAP_BRIDGE_LOG_LEVEL ?? 'info',
  internalServiceToken: env.INTERNAL_SERVICE_TOKEN ?? '',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
} as const;

if (!config.internalServiceToken) {
  // eslint-disable-next-line no-console
  console.warn(
    'voxmail-imap: INTERNAL_SERVICE_TOKEN is not set — all authenticated requests will fail.',
  );
}
