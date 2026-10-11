const express = require("express");
const { get, run } = require("../db");
const { requireUser } = require("../middleware/auth");
const { logActivity } = require("../middleware/log");

const router = express.Router();

function ipOf(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
}

router.get("/", requireUser, async (req, res) => {
  const submission = await get(
    "SELECT * FROM kyc_submissions WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1",
    [req.user.id]
  );
  res.json({ submission: submission || null, kyc_status: req.user.kyc_status });
});

router.post("/submit", requireUser, async (req, res) => {
  const { full_name, date_of_birth, nin, address, id_type, id_number } = req.body || {};
  if (!full_name || !date_of_birth || !nin || !address || !id_type || !id_number) {
    return res.status(400).json({ error: "All fields are required." });
  }
  if (!/^\d{11}$/.test(String(nin))) {
    return res.status(400).json({ error: "NIN must be 11 digits." });
  }

  await run("DELETE FROM kyc_submissions WHERE user_id = ? AND status = 'pending'", [req.user.id]);

  const info = await run(`
    INSERT INTO kyc_submissions (user_id, full_name, date_of_birth, nin, address, id_type, id_number, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `, [req.user.id, full_name, date_of_birth, nin, address, id_type, id_number]);

  await run("UPDATE users SET kyc_status = 'pending' WHERE id = ?", [req.user.id]);

  await logActivity({
    actor_type: "user", actor_id: req.user.id,
    action: "kyc.submit",
    meta: { submission_id: info.lastInsertRowid },
    ip: ipOf(req),
  });

  res.json({ ok: true, submission_id: info.lastInsertRowid });
});

module.exports = { router };