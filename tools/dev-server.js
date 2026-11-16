// Local dev server: serves the static site and routes /api/* to the Vercel-style handlers in /api.
// Usage: npm run dev  (PORT=5173 by default)
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = +(process.env.PORT || 5174);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/api/')) {
    const name = url.slice(5).replace(/[^a-z0-9-]/gi, '');
    const file = path.join(root, 'api', name + '.js');
    if (!name || name.startsWith('_') || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    return require(file)(req, res);
  }
  let p = url.endsWith('/') ? url + 'index.html' : url;
  const f = path.join(root, p);
  if (!f.startsWith(root) || /[\\/](\.|node_modules|api)/.test(path.relative(root, f))) { res.writeHead(403); return res.end(); }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const type = types[path.extname(f)] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && type === 'video/mp4') {           // video seeking
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = +s, end = e ? +e : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return fs.createReadStream(f, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(f).pipe(res);
  });
}).listen(port, () => console.log(`watercoin dev server on http://localhost:${port}`));
