import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      '**.key', '**.token', '**.secret', '**.password', '**.apiKey', '**.authorization',
      '**.privateKey', '**.secretKey', '**.api_key', '**.credentials', '**.credential',
      '**.signingSecret', '**.signing_secret', '**.seed', '**.mnemonic',
      'SOLANA_PRIVATE_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLERK_SECRET_KEY',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_SUBSCRIPTION_WEBHOOK_SECRET',
      'PLATFORM_SIGNING_SECRET', 'ADMIN_API_KEY', 'RESEND_API_KEY',
      '**.headers.authorization',
      '**.email', '**.to', '**.clerkEmail', '**.senderEmail',
    ],
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