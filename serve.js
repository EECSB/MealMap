/* Minimal static file server for previewing MealMap on http:// instead of file://.
   Dependency-free on purpose — no npm install, works offline, matches the app itself.
   Used by .claude/launch.json;  run manually with:  node serve.js [port] */
const http = require('http'), fs = require('fs'), path = require('path');

const PORT = Number(process.argv[2]) || 8765;
const ROOT = __dirname;
const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.ico':'image/x-icon',  '.webp':'image/webp', '.md':'text/plain; charset=utf-8'
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if(urlPath === '/') urlPath = '/index.html';
  const file = path.join(ROOT, path.normalize(urlPath).replace(/^[/\\]+/, ''));
  // never serve outside the project folder
  if(!file.startsWith(ROOT)){ res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if(err){ res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'   // always serve the file as it is on disk while editing
    });
    res.end(buf);
  });
}).listen(PORT, () => console.log('MealMap dev server -> http://localhost:' + PORT));
