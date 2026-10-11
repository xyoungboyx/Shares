const express = require("express");
const { all, get, run, batch } = require("../db");
const { requireUser } = require("../middleware/auth");
const { logActivity } = require("../middleware/log");

const router = express.Router();

function ipOf(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
}

router.get("/", requireUser, async (req, res) => {
  const u = req.user;
  const hc = await get(
    "SELECT COUNT(*) AS c FROM holdings WHERE user_id = ? AND quantity > 0",
    [u.id]
  );
  res.json({
    user: {
      id: u.id, name: u.name, email: u.email, phone: u.phone,
      method: u.method, balance: u.balance, kyc_status: u.kyc_status,
      created_at: u.created_at, holdings_count: hc.c,
    },
  });
});

router.patch("/", requireUser, async (req, res) => {
  const { name, phone } = req.body || {};
  const updates = [];
  const params = [];
  if (typeof name === "string" && name.trim()) { updates.push("name = ?"); params.push(name.trim()); }
  if (typeof phone === "string") { updates.push("phone = ?"); params.push(phone.trim()); }
  if (!updates.length) return res.status(400).json({ error: "Nothing to update." });

  params.push(req.user.id);
  await run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);

  await logActivity({
    actor_type: "user", actor_id: req.user.id,
    action: "user.profile_updated",
    meta: { fields: Object.keys(req.body || {}) },
    ip: ipOf(req),
  });

  const u = await get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  res.json({ user: { id: u.id, name: u.name, email: u.email, phone: u.phone, balance: u.balance, kyc_status: u.kyc_status } });
});

router.get("/holdings", requireUser, async (req, res) => {
  const rows = await all(`
    SELECT h.symbol, h.quantity, h.avg_buy_price, s.name, s.exchange, s.current_price, s.change_pct
    FROM holdings h
    LEFT JOIN stocks s ON s.symbol = h.symbol
    WHERE h.user_id = ? AND h.quantity > 0
    ORDER BY h.updated_at DESC
  `, [req.user.id]);

  const holdings = rows.map(r => {
    const currentValue = r.quantity * (r.current_price || 0);
    const costBasis = r.quantity * r.avg_buy_price;
    const pl = currentValue - costBasis;
    return {
      symbol: r.symbol,
      name: r.name || r.symbol,
      exchange: r.exchange || "",
      quantity: r.quantity,
      avg_buy_price: r.avg_buy_price,
      current_price: r.current_price || 0,
      change_pct: r.change_pct || 0,
      current_value: Number(currentValue.toFixed(2)),
      cost_basis: Number(costBasis.toFixed(2)),
      profit_loss: Number(pl.toFixed(2)),
    };
  });

  const totalValue = holdings.reduce((s, h) => s + h.current_value, 0);
  res.json({ holdings, total_value: Number(totalValue.toFixed(2)) });
});

router.get("/transactions", requireUser, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;
  const type = req.query.type;
  const status = req.query.status;

  let where = "WHERE user_id = ?";
  const params = [req.user.id];
  if (type) { where += " AND type = ?"; params.push(type); }
  if (status) { where += " AND status = ?"; params.push(status); }

  const totalRow = await get(`SELECT COUNT(*) AS c FROM transactions ${where}`, params);
  const rows = await all(`
    SELECT id, type, method, amount, status, reference, meta, created_at, updated_at
    FROM transactions ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const transactions = rows.map(r => ({
    ...r,
    meta: r.meta ? JSON.parse(r.meta) : null,
  }));

  res.json({ transactions, total: totalRow.c, limit, offset });
});

router.get("/bank-accounts", requireUser, async (req, res) => {
  const accounts = await all(
    "SELECT * FROM bank_accounts WHERE user_id = ? ORDER BY is_default DESC, created_at DESC",
    [req.user.id]
  );
  res.json({ accounts });
});

router.post("/bank-accounts", requireUser, async (req, res) => {
  const { bank_name, account_number, account_name } = req.body || {};
  if (!bank_name || !account_number || !account_name) {
    return res.status(400).json({ error: "All fields are required." });
  }
  if (!/^\d{10}$/.test(String(account_number))) {
    return res.status(400).json({ error: "Account number must be 10 digits." });
  }

  const countRow = await get("SELECT COUNT(*) AS c FROM bank_accounts WHERE user_id = ?", [req.user.id]);
  const isDefault = countRow.c === 0 ? 1 : 0;

  const info = await run(`
    INSERT INTO bank_accounts (user_id, bank_name, account_number, account_name, is_default)
    VALUES (?, ?, ?, ?, ?)
  `, [req.user.id, bank_name, account_number, account_name, isDefault]);

  await logActivity({
    actor_type: "user", actor_id: req.user.id,
    action: "user.bank_account_added",
    meta: { bank_name, last4: String(account_number).slice(-4) },
    ip: ipOf(req),
  });

  const account = await get("SELECT * FROM bank_accounts WHERE id = ?", [info.lastInsertRowid]);
  res.json({ account });
});

router.patch("/bank-accounts/:id/default", requireUser, async (req, res) => {
  const id = parseInt(req.params.id);
  const acc = await get("SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?", [id, req.user.id]);
  if (!acc) return res.status(404).json({ error: "Account not found." });

  await batch([
    { sql: "UPDATE bank_accounts SET is_default = 0 WHERE user_id = ?", args: [req.user.id] },
    { sql: "UPDATE bank_accounts SET is_default = 1 WHERE id = ?", args: [id] },
  ]);
  res.json({ ok: true });
});

router.delete("/bank-accounts/:id", requireUser, async (req, res) => {
  const id = parseInt(req.params.id);
  const acc = await get("SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?", [id, req.user.id]);
  if (!acc) return res.status(404).json({ error: "Account not found." });

  const remaining = await get("SELECT COUNT(*) AS c FROM bank_accounts WHERE user_id = ?", [req.user.id]);
  if (remaining.c === 1) {
    return res.status(400).json({ error: "You must keep at least one bank account." });
  }

  await run("DELETE FROM bank_accounts WHERE id = ?", [id]);

  if (acc.is_default) {
    const next = await get(
      "SELECT id FROM bank_accounts WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      [req.user.id]
    );
    if (next) await run("UPDATE bank_accounts SET is_default = 1 WHERE id = ?", [next.id]);
  }

  await logActivity({
    actor_type: "user", actor_id: req.user.id,
    action: "user.bank_account_removed",
    meta: { last4: String(acc.account_number).slice(-4) },
    ip: ipOf(req),
  });

  res.json({ ok: true });
});

module.exports = { router };