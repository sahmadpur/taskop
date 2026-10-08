import type { Params } from 'nestjs-pino';
import { uuidv7 } from 'uuidv7';
import type { AppConfig } from '../config/config';
import type { AppRequest } from './request';

export function loggerParams(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      genReqId: (req, res) => {
        const header = req.headers['x-request-id'];
        const id = typeof header === 'string' && header.length > 0 && header.length <= 100 ? header : uuidv7();
        res.setHeader('x-request-id', id);
        return id;
      },
      customProps: (req) => {
        const p = (req as AppRequest).principal;
        return p ? { tenantId: p.tenantId, userId: p.userId } : {};
      },
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
  };
}
