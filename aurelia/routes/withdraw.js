const express = require("express");
const crypto = require("crypto");
const { get, run } = require("../db");
const { requireUser } = require("../middleware/auth");
const { logActivity } = require("../middleware/log");

const router = express.Router();

function ipOf(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
}

async function newReference() {
  for (let i = 0; i < 10; i++) {
    const ref = "RI-" + crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
    const exists = await get("SELECT 1 AS x FROM transactions WHERE reference = ?", [ref]);
    if (!exists) return ref;
  }
  return "RI-" + crypto.randomBytes(6).toString("hex").toUpperCase().slice(0, 10);
}

router.post("/initiate", requireUser, async (req, res) => {
  const { amount, bank_account_id } = req.body || {};
  const amt = Number(amount);

  if (!amt || amt <= 0) return res.status(400).json({ error: "Enter a valid amount." });
  if (req.user.kyc_status !== "approved") {
    return res.status(403).json({ error: "Complete your identity verification before withdrawing." });
  }
  if (amt > req.user.balance) {
    return res.status(400).json({ error: "Insufficient balance." });
  }

  const account = await get("SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?",
    [bank_account_id, req.user.id]);
  if (!account) return res.status(400).json({ error: "Select a valid bank account." });

  await run("UPDATE users SET balance = balance - ? WHERE id = ?", [amt, req.user.id]);

  const reference = await newReference();
  const meta = {
    bank_name: account.bank_name,
    account_number: account.account_number,
    account_name: account.account_name,
  };

  const info = await run(`
    INSERT INTO transactions (user_id, type, method, amount, status, reference, meta)
    VALUES (?, 'withdrawal', 'bank', ?, 'pending', ?, ?)
  `, [req.user.id, amt, reference, JSON.stringify(meta)]);

  await logActivity({
    actor_type: "user", actor_id: req.user.id,
    action: "withdraw.initiate",
    meta: { reference, amount: amt, bank: account.bank_name },
    ip: ipOf(req),
  });

  res.json({ reference, transaction_id: info.lastInsertRowid });
});

module.exports = { router };