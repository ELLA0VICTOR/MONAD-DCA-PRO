import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
const PORT = 4000;

// Enable CORS
app.use(cors());
app.use(express.json());

// ✅ Proxy route for any Hermes feed ID
app.get('/api/pyth/:feedId', async (req, res) => {
  const { feedId } = req.params;
  if (!feedId) return res.status(400).json({ error: 'Missing feedId' });

  const isMonToken = feedId.toLowerCase() === '0xe786153cc54abd4b0e53b4c246d54d9f8eb3f3b5a34d4fc5a2e9a423b0ba5d6b';
  const baseUrl = isMonToken
    ? 'https://hermes-beta.pyth.network'
    : 'https://hermes.pyth.network';

  const url = `${baseUrl}/v2/updates/price/latest?ids[]=${feedId}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: `Hermes API error: ${response.status}`, data });
    }

    // ✅ Return full JSON for frontend use
    res.json(data);
  } catch (err) {
    console.error('Hermes proxy error:', err.message);
    res.status(500).json({ error: 'Proxy fetch failed', details: err.message });
  }
});

// Default route
app.get('/', (req, res) => res.send('✅ Hermes proxy backend is running'));

// Start server
app.listen(PORT, () => console.log(`✅ Hermes proxy backend running on http://localhost:${PORT}`));
