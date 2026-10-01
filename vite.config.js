// The development server also takes the captures that clips are made of.
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);

// Dev-only endpoint that saves reproducible captures into ./captures.
function capturePlugin() {
  return {
    name: 'komorebi-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const url = new URL(req.url, 'http://localhost');
        const clean = (s) => (s || '').replace(/[^a-z0-9._-]/gi, '_').replace(/^\.+/, '');
        const name = clean(url.searchParams.get('name')) || 'capture.png';
        const dir = path.join(root, 'captures', clean(url.searchParams.get('dir')));
        fs.mkdirSync(dir, { recursive: true });
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default {
  root,
  server: { port: 5181 },
  plugins: [capturePlugin()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
};
