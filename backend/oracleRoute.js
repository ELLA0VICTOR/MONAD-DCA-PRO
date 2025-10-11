import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// simple in-memory cache to reduce Hermes calls
const cache = new Map();

/**
 * Proxy endpoint for fetching Pyth price updates
 * Example: GET /api/pyth/0xe786153cc54abd4b0e53b4c246d54d9f8eb3f3b5a34d4fc5a2e9a423b0ba5d6b
 */
router.get("/pyth/:feedId", async (req, res) => {
  const { feedId } = req.params;
  const now = Date.now();

  // serve cached result if < 60 seconds old
  const cached = cache.get(feedId);
  if (cached && now - cached.timestamp < 60000) {
    return res.json(cached.data);
  }

  try {
    const url = `https://hermes-beta.pyth.network/v2/updates/price/latest?ids[]=${feedId}`;
    const response = await fetch(url);

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: `Hermes fetch failed (${response.status})` });
    }

    const data = await response.json();
    cache.set(feedId, { data, timestamp: now });
    res.json(data);
  } catch (error) {
    console.error("Hermes proxy error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
