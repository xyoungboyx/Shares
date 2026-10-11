const { get } = require("../db");

async function getUserFromToken(token) {
  if (!token) return null;
  const session = await get(
    "SELECT * FROM sessions WHERE token = ? AND role = 'user'",
    [token]
  );
  if (!session) return null;
  const user = await get("SELECT * FROM users WHERE id = ?", [session.user_id]);
  return user || null;
}

async function requireUser(req, res, next) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  try {
    const user = await getUserFromToken(token);
    if (!user) return res.status(401).json({ error: "Not logged in." });
    req.user = user;
    req.token = token;
    next();
  } catch (e) {
    return res.status(500).json({ error: "Auth check failed." });
  }
}

async function optionalUser(req, _res, next) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  try {
    req.user = await getUserFromToken(token);
    req.token = token;
  } catch (_) {
    req.user = null;
  }
  next();
}

module.exports = { requireUser, optionalUser, getUserFromToken };