function prepareNextRequest(req) {
  const route = Array.isArray(req.query?.path) ? req.query.path : [req.query?.path].filter(Boolean);

  // Next keeps the browser-visible URL after a rewrite. Reconstruct the
  // internal asset prefix so Express can reach its static client middleware.
  if (route[0] === '_client' && !/^\/api\/_client(?=\/|\?|$)/.test(req.url)) {
    req.url = `/api/_client${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }

  // Direct calls contain the internal gateway prefix; rewritten calls already
  // retain their public backend URL (for example, /x402/weather).
  req.url = req.url.replace(/^\/api\/_gateway(?=\/|\?|$)/, '');
  return req;
}

module.exports = { prepareNextRequest };
