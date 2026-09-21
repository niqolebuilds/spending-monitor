import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

const publicDir = path.join(__dirname, 'public');

// Serve static assets with automatic .html extension resolution
app.use(express.static(publicDir, { extensions: ['html'] }));

// Also support paths prefixed with /spend-monitor-site
app.use('/spend-monitor-site', express.static(publicDir, { extensions: ['html'] }));

// SPA fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Spend Monitor server running at http://0.0.0.0:${PORT}`);
});
