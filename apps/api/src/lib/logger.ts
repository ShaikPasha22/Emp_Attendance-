import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password', '*.token'],
    censor: '[redacted]',
  },
  ...(env.isProd
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
});
