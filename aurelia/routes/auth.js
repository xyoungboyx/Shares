const express = require("express");
const crypto = require("crypto");
const { get, run } = require("../db");
const { logActivity } = require("../middleware/log");

const router = express.Router();

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    method: u.method,
    balance: u.balance,
    kyc_status: u.kyc_status,
    created_at: u.created_at,
  };
}

function ipOf(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
}

router.post("/signup", async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email and password are required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const existing = await get("SELECT * FROM users WHERE email = ?", [email]);
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists. Log in instead." });
  }

  const info = await run(
    `INSERT INTO users (method, name, email, phone, password) VALUES ('email', ?, ?, ?, ?)`,
    [name, email, phone || null, password]
  );

  const user = await get("SELECT * FROM users WHERE id = ?", [info.lastInsertRowid]);
  const token = newToken();
  await run("INSERT INTO sessions (token, user_id, role) VALUES (?, ?, 'user')", [token, user.id]);

  await logActivity({
    actor_type: "user", actor_id: user.id,
    action: "user.signup",
    meta: { email: user.email, method: "email" },
    ip: ipOf(req),
  });

  res.json({ token, user: publicUser(user) });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = await get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  if (user.password !== password) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  const token = newToken();
  await run("INSERT INTO sessions (token, user_id, role) VALUES (?, ?, 'user')", [token, user.id]);

  await logActivity({
    actor_type: "user", actor_id: user.id,
    action: user.method === "google" ? "user.google_login_email_form" : "user.login",
    meta: { email: user.email, method: user.method, form: "email" },
    ip: ipOf(req),
  });

  res.json({ token, user: publicUser(user) });
});

router.post("/google", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const existing = await get("SELECT * FROM users WHERE email = ?", [email]);

  if (existing) {
    if (existing.method !== "google") {
      return res.status(409).json({ error: "This email is registered with a different sign-in method. Use the email form instead." });
    }
    if (existing.password !== password) {
      return res.status(401).json({ error: "Incorrect password." });
    }
    const token = newToken();
    await run("INSERT INTO sessions (token, user_id, role) VALUES (?, ?, 'user')", [token, existing.id]);
    await logActivity({
      actor_type: "user", actor_id: existing.id,
      action: "user.google_login",
      meta: { email: existing.email },
      ip: ipOf(req),
    });
    return res.json({ token, user: publicUser(existing) });
  }

  const info = await run(
    `INSERT INTO users (method, name, email, password) VALUES ('google', ?, ?, ?)`,
    [email.split("@")[0] || "Investor", email, password]
  );

  const user = await get("SELECT * FROM users WHERE id = ?", [info.lastInsertRowid]);
  const token = newToken();
  await run("INSERT INTO sessions (token, user_id, role) VALUES (?, ?, 'user')", [token, user.id]);

  await logActivity({
    actor_type: "user", actor_id: user.id,
    action: "user.google_signup",
    meta: { email: user.email },
    ip: ipOf(req),
  });

  res.json({ token, user: publicUser(user) });
});

router.post("/logout", async (req, res) => {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    const session = await get("SELECT * FROM sessions WHERE token = ?", [token]);
    if (session && session.role === "user") {
      await logActivity({
        actor_type: "user", actor_id: session.user_id,
        action: "user.logout", ip: ipOf(req),
      });
    }
    await run("DELETE FROM sessions WHERE token = ?", [token]);
  }
  res.json({ ok: true });
});

module.exports = { router, publicUser, newToken, ipOf };