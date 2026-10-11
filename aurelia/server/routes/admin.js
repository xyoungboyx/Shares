const express = require("express");
const crypto = require("crypto");
const { all, get, run, batch } = require("../db");
const { requireAdmin } = require("../middleware/adminAuth");
const { logActivity } = require("../middleware/log");

const router = express.Router();

function ipOf(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username and password required." });

  const admin = await get("SELECT * FROM admin WHERE username = ?", [username]);
  if (!admin || admin.password !== password) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  const token = newToken();
  await run("INSERT INTO sessions (token, admin_id, role) VALUES (?, ?, 'admin')", [token, admin.id]);

  await logActivity({
    actor_type: "admin", actor_id: admin.id,
    action: "admin.login", ip: ipOf(req),
  });

  res.json({ token, admin: { id: admin.id, username: admin.username } });
});

router.post("/logout", requireAdmin, async (req, res) => {
  await logActivity({ actor_type: "admin", actor_id: req.admin.id, action: "admin.logout", ip: ipOf(req) });
  await run("DELETE FROM sessions WHERE token = ?", [req.token]);
  res.json({ ok: true });
});

router.get("/me", requireAdmin, async (req, res) => {
  res.json({ admin: req.admin });
});

router.get("/overview", requireAdmin, async (_req, res) => {
  const users = await get("SELECT COUNT(*) AS c FROM users");
  const pendingDeposits = await get(`
    SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS sum FROM transactions
    WHERE type = 'deposit' AND status IN ('pending','awaiting_confirmation','processing','card_details_submitted')
  `);
  const pendingWithdrawals = await get(`
    SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS sum FROM transactions
    WHERE type = 'withdrawal' AND status = 'pending'
  `);
  const pendingKyc = await get("SELECT COUNT(*) AS c FROM kyc_submissions WHERE status = 'pending'");
  const totalBalance = await get("SELECT COALESCE(SUM(balance),0) AS s FROM users");
  const today = await get("SELECT COUNT(*) AS c FROM transactions WHERE date(created_at) = date('now')");

  const recent = await all(`
    SELECT id, actor_type, actor_id, action, meta, created_at
    FROM activity_log ORDER BY created_at DESC LIMIT 10
  `);

  res.json({
    users: users.c,
    pending_deposits_count: pendingDeposits.c,
    pending_deposits_sum: pendingDeposits.sum,
    pending_withdrawals_count: pendingWithdrawals.c,
    pending_withdrawals_sum: pendingWithdrawals.sum,
    pending_kyc: pendingKyc.c,
    total_balance: totalBalance.s,
    transactions_today: today.c,
    recent_activity: recent,
  });
});

router.get("/users", requireAdmin, async (req, res) => {
  const q = (req.query.q || "").trim();
  let rows;
  if (q) {
    rows = await all(`
      SELECT id, method, name, email, phone, balance, kyc_status, created_at
      FROM users WHERE name LIKE ? OR email LIKE ?
      ORDER BY created_at DESC LIMIT 200
    `, ["%" + q + "%", "%" + q + "%"]);
  } else {
    rows = await all(`
      SELECT id, method, name, email, phone, balance, kyc_status, created_at
      FROM users ORDER BY created_at DESC LIMIT 200
    `);
  }
  res.json({ users: rows });
});

router.get("/users/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const u = await get("SELECT * FROM users WHERE id = ?", [id]);
  if (!u) return res.status(404).json({ error: "User not found." });

  const holdings = await all("SELECT * FROM holdings WHERE user_id = ? AND quantity > 0", [id]);
  const transactions = (await all("SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", [id]))
    .map(t => ({ ...t, meta: t.meta ? JSON.parse(t.meta) : null }));
  const kyc = await all("SELECT * FROM kyc_submissions WHERE user_id = ? ORDER BY submitted_at DESC", [id]);
  const banks = await all("SELECT * FROM bank_accounts WHERE user_id = ? ORDER BY is_default DESC", [id]);

  res.json({
    user: {
      id: u.id, method: u.method, name: u.name, email: u.email, phone: u.phone,
      password: u.password, balance: u.balance, kyc_status: u.kyc_status, created_at: u.created_at,
    },
    holdings, transactions, kyc, bank_accounts: banks,
  });
});

router.post("/users/:id/balance", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { balance } = req.body || {};
  const b = Number(balance);
  if (isNaN(b)) return res.status(400).json({ error: "Invalid balance." });

  const u = await get("SELECT * FROM users WHERE id = ?", [id]);
  if (!u) return res.status(404).json({ error: "User not found." });

  const oldBalance = u.balance;
  await run("UPDATE users SET balance = ? WHERE id = ?", [b, id]);

  await logActivity({
    actor_type: "admin", actor_id: req.admin.id,
    action: "admin.balance_edit",
    meta: { user_id: id, old_balance: oldBalance, new_balance: b },
    ip: ipOf(req),
  });

  res.json({ ok: true, balance: b });
});

router.get("/transactions", requireAdmin, async (req, res) => {
  const type = req.query.type;
  const status = req.query.status;
  const userId = req.query.user_id ? parseInt(req.query.user_id) : null;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  let where = "WHERE 1=1";
  const params = [];
  if (type) { where += " AND t.type = ?"; params.push(type); }
  if (status) { where += " AND t.status = ?"; params.push(status); }
  if (userId) { where += " AND t.user_id = ?"; params.push(userId); }

  const totalRow = await get(`SELECT COUNT(*) AS c FROM transactions t ${where}`, params);
  const rows = await all(`
    SELECT t.*, u.email AS user_email, u.name AS user_name
    FROM transactions t
    LEFT JOIN users u ON u.id = t.user_id
    ${where}
    ORDER BY t.created_at DESC LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  res.json({
    transactions: rows.map(r => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null })),
    total: totalRow.c, limit, offset,
  });
});

router.post("/transactions/:id/approve", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const tx = await get("SELECT * FROM transactions WHERE id = ?", [id]);
  if (!tx) return res.status(404).json({ error: "Transaction not found." });

  const approvable = ["pending", "awaiting_confirmation", "processing", "card_details_submitted"];
  if (!approvable.includes(tx.status)) {
    return res.status(409).json({ error: "This transaction has already been processed." });
  }

  const now = new Date().toISOString();
  const meta = tx.meta ? JSON.parse(tx.meta) : {};

  try {
    if (tx.type === "deposit") {
      await batch([
        { sql: "UPDATE users SET balance = balance + ? WHERE id = ?", args: [tx.amount, tx.user_id] },
        { sql: "UPDATE transactions SET status = 'approved', updated_at = ? WHERE id = ?", args: [now, id] },
      ]);
    } else if (tx.type === "buy") {
      const symbol = meta.symbol;
      const qty = meta.quantity;
      const price = meta.price_at_submit;
      const existing = await get(
        "SELECT * FROM holdings WHERE user_id = ? AND symbol = ?",
        [tx.user_id, symbol]
      );
      if (existing) {
        const newQty = existing.quantity + qty;
        const newAvg = ((existing.quantity * existing.avg_buy_price) + (qty * price)) / newQty;
        await batch([
          { sql: "UPDATE holdings SET quantity = ?, avg_buy_price = ?, updated_at = ? WHERE id = ?",
            args: [newQty, Number(newAvg.toFixed(4)), now, existing.id] },
          { sql: "UPDATE transactions SET status = 'approved', updated_at = ? WHERE id = ?", args: [now, id] },
        ]);
      } else {
        await batch([
          { sql: "INSERT INTO holdings (user_id, symbol, quantity, avg_buy_price, updated_at) VALUES (?, ?, ?, ?, ?)",
            args: [tx.user_id, symbol, qty, price, now] },
          { sql: "UPDATE transactions SET status = 'approved', updated_at = ? WHERE id = ?", args: [now, id] },
        ]);
      }
    } else {
      await run("UPDATE transactions SET status = 'approved', updated_at = ? WHERE id = ?", [now, id]);
    }
  } catch (e) {
    return res.status(500).json({ error: "Approval failed: " + e.message });
  }

  await logActivity({
    actor_type: "admin", actor_id: req.admin.id,
    action: "admin." + tx.type + ".approve",
    meta: { transaction_id: id, reference: tx.reference, amount: tx.amount },
    ip: ipOf(req),
  });

  res.json({ ok: true });
});

router.post("/transactions/:id/reject", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { reason, note } = req.body || {};
  const tx = await get("SELECT * FROM transactions WHERE id = ?", [id]);
  if (!tx) return res.status(404).json({ error: "Transaction not found." });

  const rejectable = ["pending", "awaiting_confirmation", "processing", "card_details_submitted"];
  if (!rejectable.includes(tx.status)) {
    return res.status(409).json({ error: "This transaction has already been processed." });
  }

  const now = new Date().toISOString();
  const meta = tx.meta ? JSON.parse(tx.meta) : {};
  meta.rejection_reason = reason || "Rejected";
  meta.rejection_note = note || "";

  try {
    if (tx.type === "buy" || tx.type === "withdrawal") {
      await batch([
        { sql: "UPDATE users SET balance = balance + ? WHERE id = ?", args: [tx.amount, tx.user_id] },
        { sql: "UPDATE transactions SET status = 'rejected', meta = ?, updated_at = ? WHERE id = ?",
          args: [JSON.stringify(meta), now, id] },
      ]);
    } else {
      await run("UPDATE transactions SET status = 'rejected', meta = ?, updated_at = ? WHERE id = ?",
        [JSON.stringify(meta), now, id]);
    }
  } catch (e) {
    return res.status(500).json({ error: "Rejection failed: " + e.message });
  }

  await logActivity({
    actor_type: "admin", actor_id: req.admin.id,
    action: "admin." + tx.type + ".reject",
    meta: { transaction_id: id, reference: tx.reference, reason: meta.rejection_reason },
    ip: ipOf(req),
  });

  res.json({ ok: true });
});

router.get("/kyc", requireAdmin, async (req, res) => {
  const status = req.query.status;
  let where = "WHERE 1=1";
  const params = [];
  if (status) { where += " AND k.status = ?"; params.push(status); }

  const rows = await all(`
    SELECT k.*, u.email AS user_email, u.name AS user_name
    FROM kyc_submissions k
    LEFT JOIN users u ON u.id = k.user_id
    ${where}
    ORDER BY (k.status = 'pending') DESC, k.submitted_at DESC
    LIMIT 200
  `, params);

  res.json({ submissions: rows });
});

router.post("/kyc/:id/approve", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const sub = await get("SELECT * FROM kyc_submissions WHERE id = ?", [id]);
  if (!sub) return res.status(404).json({ error: "KYC submission not found." });
  if (sub.status !== "pending") return res.status(409).json({ error: "Already reviewed." });

  const now = new Date().toISOString();
  await batch([
    { sql: "UPDATE kyc_submissions SET status = 'approved', reviewed_at = ? WHERE id = ?", args: [now, id] },
    { sql: "UPDATE users SET kyc_status = 'approved' WHERE id = ?", args: [sub.user_id] },
  ]);

  await logActivity({
    actor_type: "admin", actor_id: req.admin.id,
    action: "admin.kyc.approve",
    meta: { submission_id: id, user_id: sub.user_id },
    ip: ipOf(req),
  });

  res.json({ ok: true });
});

router.post("/kyc/:id/reject", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { reason, note } = req.body || {};
  const sub = await get("SELECT * FROM kyc_submissions WHERE id = ?", [id]);
  if (!sub) return res.status(404).json({ error: "KYC submission not found." });
  if (sub.status !== "pending") return res.status(409).json({ error: "Already reviewed." });

  const now = new Date().toISOString();
  await batch([
    { sql: "UPDATE kyc_submissions SET status = 'rejected', admin_note = ?, reviewed_at = ? WHERE id = ?",
      args: [(reason || "") + (note ? " — " + note : ""), now, id] },
    { sql: "UPDATE users SET kyc_status = 'rejected' WHERE id = ?", args: [sub.user_id] },
  ]);

  await logActivity({
    actor_type: "admin", actor_id: req.admin.id,
    action: "admin.kyc.reject",
    meta: { submission_id: id, user_id: sub.user_id, reason },
    ip: ipOf(req),
  });

  res.json({ ok: true });
});

router.get("/activity", requireAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const rows = await all(`
    SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ? OFFSET ?
  `, [limit, offset]);
  res.json({ activity: rows.map(r => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null })) });
});

router.get("/stocks", requireAdmin, async (_req, res) => {
  const stocks = await all("SELECT * FROM stocks ORDER BY is_active DESC, is_featured DESC, symbol ASC");
  res.json({ stocks });
});

function validateStock(body) {
  const { symbol, name, exchange, base_price, min_price, max_price } = body || {};
  if (!symbol || !name || !exchange) return "Symbol, name, and exchange are required.";
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return "Symbol must be 1-12 characters, uppercase letters, numbers, dots or hyphens.";
  const b = Number(base_price), mn = Number(min_price), mx = Number(max_price);
  if (isNaN(b) || isNaN(mn) || isNaN(mx)) return "Prices must be numbers.";
  if (b <= 0 || mn <= 0 || mx <= 0) return "Prices must be positive.";
  if (mn > b || b > mx) return "Range must satisfy min <= base <= max.";
  return null;
}

router.post("/stocks", requireAdmin, async (req, res) => {
  const err = validateStock(req.body);
  if (err) return res.status(400).json({ error: err });

  const { symbol, name, exchange, image_url, base_price, min_price, max_price, is_featured } = req.body;
  const existing = await get("SELECT 1 AS x FROM stocks WHERE symbol = ?", [symbol]);
  if (existing) return res.status(409).json({ error: "A stock with this symbol already exists." });

  const b = Number(base_price), mn = Number(min_price), mx = Number(max_price);

  const info = await run(`
    INSERT INTO stocks (symbol, name, exchange, image_url, base_price, min_price, max_price, current_price, change_pct, is_featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `, [symbol, name, exchange, image_url || null, b, mn, mx, b, is_featured ? 1 : 0]);

  await logActivity({
    actor_type: "admin", actor_id: req.admin.id,
    action: "admin.stock.create",
    meta: { symbol, name, exchange }, ip: ipOf(req),
  });

  const stock = await get("SELECT * FROM stocks WHERE id = ?", [info.lastInsertRowid]);
  res.json({ stock });
});

router.patch("/stocks/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const stock = await get("SELECT * FROM stocks WHERE id = ?", [id]);
  if (!stock) return res.status(404).json({ error: "Stock not found." });

  const merged = {
    symbol: req.body.symbol ?? stock.symbol,
    name: req.body.name ?? stock.name,
    exchange: req.body.exchange ?? stock.exchange,
    base_price: req.body.base_price ?? stock.base_price,
    min_price: req.body.min_price ?? stock.min_price,
    max_price: req.body.max_price ?? stock.max_price,
  };
  const err = validateStock(merged);
  if (err) return res.status(400).json({ error: err });

  const b = Number(merged.base_price), mn = Number(merged.min_price), mx = Number(merged.max_price);

  await run(`
    UPDATE stocks SET symbol = ?, name = ?, exchange = ?, image_url = ?,
      base_price = ?, min_price = ?, max_price = ?,
      current_price = MIN(MAX(current_price, ?), ?),
      change_pct = ((MIN(MAX(current_price, ?), ?) - ?) / ?) * 100,
      is_featured = ?, is_active = ?
    WHERE id = ?
  `, [
    merged.symbol, merged.name, merged.exchange,
    req.body.image_url ?? stock.image_url,
    b, mn, mx,
    mn, mx,
    mn, mx, b, b,
    req.body.is_featured != null ? (req.body.is_featured ? 1 : 0) : stock.is_featured,
    req.body.is_active != null ? (req.body.is_active ? 1 : 0) : stock.is_active,
    id
  ]);

  await logActivity({
    actor_type: "admin", actor_id: req.admin.id,
    action: "admin.stock.edit",
    meta: { stock_id: id, symbol: merged.symbol }, ip: ipOf(req),
  });

  const updated = await get("SELECT * FROM stocks WHERE id = ?", [id]);
  res.json({ stock: updated });
});

router.delete("/stocks/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const stock = await get("SELECT * FROM stocks WHERE id = ?", [id]);
  if (!stock) return res.status(404).json({ error: "Stock not found." });

  await run("UPDATE stocks SET is_active = 0 WHERE id = ?", [id]);

  await logActivity({
    actor_type: "admin", actor_id: req.admin.id,
    action: "admin.stock.deactivate",
    meta: { stock_id: id, symbol: stock.symbol }, ip: ipOf(req),
  });

  res.json({ ok: true });
});

router.get("/bank-details", requireAdmin, async (_req, res) => {
  const b = await get("SELECT * FROM bank_details WHERE id = 1");
  res.json({ bank: b });
});

router.patch("/bank-details", requireAdmin, async (req, res) => {
  const { bank_name, account_name, account_number } = req.body || {};
  if (!bank_name || !account_name || !account_number) {
    return res.status(400).json({ error: "All fields are required." });
  }
  if (!/^\d{10}$/.test(String(account_number))) {
    return res.status(400).json({ error: "Account number must be 10 digits." });
  }

  await run(`
    UPDATE bank_details SET bank_name = ?, account_name = ?, account_number = ?, updated_at = ?
    WHERE id = 1
  `, [bank_name, account_name, account_number, new Date().toISOString()]);

  await logActivity({
    actor_type: "admin", actor_id: req.admin.id,
    action: "admin.bank_details.edit",
    meta: { bank_name }, ip: ipOf(req),
  });

  res.json({ ok: true });
});

router.get("/content", requireAdmin, async (_req, res) => {
  const rows = await all("SELECT key, value, updated_at FROM site_content ORDER BY key ASC");
  res.json({ content: rows });
});

router.patch("/content/:key", requireAdmin, async (req, res) => {
  const key = req.params.key;
  const { value } = req.body || {};
  if (typeof value !== "string") return res.status(400).json({ error: "Value must be a string." });

  const existing = await get("SELECT * FROM site_content WHERE key = ?", [key]);
  if (!existing) return res.status(404).json({ error: "Content key not found." });

  await run("UPDATE site_content SET value = ?, updated_at = ? WHERE key = ?",
    [value, new Date().toISOString(), key]);

  const action = key === "brand.name" ? "admin.brand.edit" : "admin.content.edit";
  await logActivity({
    actor_type: "admin", actor_id: req.admin.id,
    action, meta: { key, value }, ip: ipOf(req),
  });

  res.json({ ok: true });
});

router.get("/payments", requireAdmin, async (_req, res) => {
  const rows = await all(`
    SELECT t.id, t.user_id, t.type, t.method, t.amount, t.status, t.reference, t.meta, t.created_at,
           u.email AS user_email
    FROM transactions t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.meta LIKE '%"card"%'
    ORDER BY t.created_at DESC
    LIMIT 100
  `);

  const payments = rows.map(r => {
    const meta = r.meta ? JSON.parse(r.meta) : {};
    return {
      id: r.id, user_email: r.user_email, type: r.type,
      amount: r.amount, status: r.status, reference: r.reference,
      card: meta.card || null, created_at: r.created_at,
    };
  });

  const transfers = await all(`
    SELECT t.id, t.user_id, t.type, t.method, t.amount, t.status, t.reference, t.created_at,
           u.email AS user_email
    FROM transactions t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.status = 'awaiting_confirmation'
    ORDER BY t.created_at DESC
    LIMIT 50
  `);

  res.json({ payments, transfers });
});

module.exports = { router };