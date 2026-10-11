const { get } = require("../db");

async function requireAdmin(req, res, next) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Admin authentication required." });
  try {
    const session = await get(
      "SELECT * FROM sessions WHERE token = ? AND role = 'admin'",
      [token]
    );
    if (!session) return res.status(401).json({ error: "Admin authentication required." });
    const admin = await get(
      "SELECT id, username FROM admin WHERE id = ?",
      [session.admin_id]
    );
    if (!admin) return res.status(401).json({ error: "Admin authentication required." });
    req.admin = admin;
    req.token = token;
    next();
  } catch (e) {
    return res.status(500).json({ error: "Admin auth check failed." });
  }
}

module.exports = { requireAdmin };