import pino from 'pino';
import env from '../config/env';

const prettyTransport = {
  target: 'pino-pretty',
  options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
};

const logger = pino({
  level: env.logLevel,
  transport: env.logPretty ? prettyTransport : undefined,
});

export default logger;
