const express = require("express");
const { all, get } = require("../db");

const router = express.Router();

router.get("/", async (_req, res) => {
  const stocks = await all(`
    SELECT id, symbol, name, exchange, image_url, base_price, min_price, max_price,
           current_price, change_pct, is_active, is_featured
    FROM stocks
    WHERE is_active = 1
    ORDER BY is_featured DESC, symbol ASC
  `);
  res.json({ stocks });
});

router.get("/:symbol", async (req, res) => {
  const s = await get("SELECT * FROM stocks WHERE symbol = ? AND is_active = 1", [req.params.symbol]);
  if (!s) return res.status(404).json({ error: "Stock not found." });
  res.json({ stock: s });
});

module.exports = { router };