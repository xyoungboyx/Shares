const { run } = require("../db");

async function logActivity({ actor_type, actor_id = null, action, meta = null, ip = null }) {
  try {
    await run(
      `INSERT INTO activity_log (actor_type, actor_id, action, meta, ip) VALUES (?, ?, ?, ?, ?)`,
      [actor_type, actor_id, action, meta ? JSON.stringify(meta) : null, ip]
    );
  } catch (e) {
    console.error("activity_log write failed:", e.message);
  }
}

module.exports = { logActivity };