import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['**.key', '**.token', '**.secret', '**.password', '**.apiKey', '**.authorization', '**.privateKey', '**.secretKey', '**.api_key', 'SOLANA_PRIVATE_KEY'],
    censor: '[REDACTED]',
  },
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
  ...(!isDev && {
    timestamp: pino.stdTimeFunctions.isoTime,
  }),
});