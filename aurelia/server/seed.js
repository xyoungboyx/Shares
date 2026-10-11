const { get, run } = require("./db");

async function seed() {
  const adminCount = await get("SELECT COUNT(*) AS c FROM admin");
  if (adminCount.c === 0) {
    const user = process.env.ADMIN_USER || "admin";
    const pass = process.env.ADMIN_PASS || "change-me-please-12chars";
    await run("INSERT INTO admin (username, password) VALUES (?, ?)", [user, pass]);
    console.log("=================================================");
    console.log("  ADMIN SEEDED");
    console.log("  username:", user);
    console.log("  password:", pass);
    console.log("  login at: /dollyb14");
    console.log("=================================================");
  }

  const stockCount = await get("SELECT COUNT(*) AS c FROM stocks");
  if (stockCount.c === 0) {
    const stocks = [
      { symbol: "DANGCEM",  name: "Dangote Cement", exchange: "NGX",    base: 452.80, min: 430, max: 480, featured: 1 },
      { symbol: "MTNN",     name: "MTN Nigeria",    exchange: "NGX",    base: 218.50, min: 200, max: 235 },
      { symbol: "GTCO",     name: "GTCO",           exchange: "NGX",    base: 62.35,  min: 55,  max: 70 },
      { symbol: "BUACEMENT",name: "BUA Cement",     exchange: "NGX",    base: 91.10,  min: 82,  max: 100 },
      { symbol: "AAPL",     name: "Apple Inc.",     exchange: "NASDAQ", base: 227.40, min: 210, max: 245 },
      { symbol: "TSLA",     name: "Tesla Inc.",     exchange: "NASDAQ", base: 248.10, min: 220, max: 275 },
    ];
    for (const s of stocks) {
      await run(
        `INSERT INTO stocks (symbol, name, exchange, base_price, min_price, max_price, current_price, change_pct, is_featured)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [s.symbol, s.name, s.exchange, s.base, s.min, s.max, s.base, s.featured || 0]
      );
    }
  }

  const bankCount = await get("SELECT COUNT(*) AS c FROM bank_details");
  if (bankCount.c === 0) {
    await run(
      `INSERT INTO bank_details (id, bank_name, account_name, account_number) VALUES (1, ?, ?, ?)`,
      ["Wema Bank", "Aurelia Ltd", "9012345678"]
    );
  }

  const contentCount = await get("SELECT COUNT(*) AS c FROM site_content");
  if (contentCount.c === 0) {
    const defaults = {
      "brand.name": "Aurelia",
      "landing.headline": "Put your naira to work.",
      "landing.subhead": "Buy and sell Nigerian and U.S. stocks from your phone or computer. Start with as little as ₦1,000 — no broker, no paperwork.",
      "landing.fineprint": "Already investing with us? Log in to continue.",
      "signup.subhead": "Start investing in a few minutes.",
      "login.subhead": "Log in to continue investing.",
      "buy.transfer.instructions": "Transfer the exact amount above, using the reference code, from any Nigerian bank.",
      "deposit.transfer.instructions": "Transfer the exact amount, using the reference code, from any Nigerian bank.",
      "withdraw.timing_message": "Withdrawal reviews typically take 1–2 business days.",
      "footer.copyright": "© 2026 Aurelia",
    };
    for (const [k, v] of Object.entries(defaults)) {
      await run("INSERT INTO site_content (key, value) VALUES (?, ?)", [k, v]);
    }
  }
}

module.exports = { seed };