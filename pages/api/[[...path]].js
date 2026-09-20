import { createApp } from '../../src/server/app';
import { prepareNextRequest } from '../../src/server/next-request';
let backend;

export const config = { api: { bodyParser: false, externalResolver: true, responseLimit: false } };

export default function handler(req, res) {
  if (!backend) {
    backend = createApp({ serveClient: false });
  }
  // Rewrites bring non-/api routes through this same serverless entry point.
  prepareNextRequest(req);
  return new Promise((resolve, reject) => {
    res.once('finish', resolve);
    res.once('close', resolve);
    backend(req, res, error => {
      if (error) return reject(error);
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    });
  });
}
