// Mock backend for the POC only. In-memory; replace with your real server.
// Run: node server/server.js   (needs: npm i express)
const express = require('express');
const crypto = require('crypto');
const os = require('os');
const app = express();
app.use(express.json({ limit: '10mb' }));

const requests = new Map(); // id -> { status, signature, createdAt }
const TTL_MS = 10 * 60 * 1000;

// LAN IPs of this machine, so the desktop app can put a phone-reachable address in the QR code.
app.get('/api/network', (_req, res) => {
  const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Docker|Loopback|Bluetooth|vboxnet/i;
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if ((i.family === 'IPv4' || i.family === 4) && !i.internal) {
        let score = 0;
        if (virtual.test(name)) score += 10;
        if (i.address.startsWith('192.168.56.')) score += 10; // VirtualBox default
        if (!i.address.startsWith('192.168.') && !i.address.startsWith('10.')) score += 3;
        found.push({ ip: i.address, score });
      }
    }
  }
  found.sort((a, b) => a.score - b.score);
  res.json({ ips: found.map((f) => f.ip) });
});

app.post('/api/requests', (_req, res) => {
  const id = crypto.randomUUID();
  requests.set(id, { status: 'pending', signature: null, createdAt: Date.now() });
  res.json({ id });
});

app.get('/api/requests/:id', (req, res) => {
  const r = requests.get(req.params.id);
  if (!r || Date.now() - r.createdAt > TTL_MS) return res.status(404).json({ error: 'not_found' });
  res.json({ status: r.status, signature: r.signature });
});

app.post('/api/requests/:id/signature', (req, res) => {
  const r = requests.get(req.params.id);
  if (!r || Date.now() - r.createdAt > TTL_MS) return res.status(404).json({ error: 'not_found' });
  const image = req.body?.image;
  if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,'))
    return res.status(400).json({ error: 'png_data_url_required' });
  r.status = 'signed';
  r.signature = image;
  res.json({ ok: true });
});

const path = require('path');
const dist = path.join(__dirname, '../dist/signature-poc/browser');
app.use(express.static(dist));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));