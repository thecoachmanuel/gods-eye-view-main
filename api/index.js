import dns from 'node:dns';

try {
  dns.setDefaultResultOrder?.('ipv4first');
} catch {
  /* ignore */
}

import { localProviderPlugins } from '../server/providers/local.js';

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

const routes = [];
const middlewares = {
  use(path, handler) {
    if (typeof path === 'function') {
      routes.push({ prefix: '', handler: path });
    } else {
      routes.push({ prefix: path, handler });
    }
  },
};

const plugins = localProviderPlugins();
for (const p of plugins) {
  if (Array.isArray(p)) {
    for (const sp of p) sp.configureServer?.({ middlewares });
  } else {
    p.configureServer?.({ middlewares });
  }
}

/**
 * Serverless function entrypoint for Vercel deployment.
 * Routes /api/* requests through the God's Eye View local provider middlewares.
 */
export default async function handler(req, res) {
  const rawUrl = req.headers['x-forwarded-uri'] || req.headers['x-matched-path'] || req.url || '/';
  let pathname = '/';
  try {
    pathname = new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    pathname = rawUrl.split('?')[0];
  }

  for (const route of routes) {
    if (
      pathname === route.prefix ||
      pathname.startsWith(route.prefix + '/') ||
      (route.prefix && pathname.startsWith(route.prefix))
    ) {
      const subUrl = rawUrl.slice(route.prefix.length) || '/';
      const origUrl = req.url;
      req.originalUrl = origUrl;
      req.url = subUrl.startsWith('/') || subUrl.startsWith('?') ? subUrl : '/' + subUrl;
      try {
        await new Promise((resolve, reject) => {
          let resolved = false;
          const done = (err) => {
            if (resolved) return;
            resolved = true;
            if (err) reject(err);
            else resolve();
          };
          res.on('finish', () => done());
          res.on('close', () => done());
          try {
            const ret = route.handler(req, res, done);
            if (ret && typeof ret.then === 'function') {
              ret.then(() => {
                if (res.writableEnded) done();
              }, done);
            }
          } catch (err) {
            done(err);
          }
        });
      } catch (err) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err?.message || 'Internal Server Error' }));
        }
      } finally {
        req.url = origUrl;
      }
      return;
    }
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'API route not found' }));
}
