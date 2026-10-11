const express = require("express");
const { all, get } = require("../db");

const router = express.Router();

router.get("/", async (_req, res) => {
  const rows = await all("SELECT key, value FROM site_content");
  const content = {};
  for (const r of rows) content[r.key] = r.value;

  const bank = await get("SELECT bank_name, account_name, account_number FROM bank_details WHERE id = 1");

  res.json({
    content,
    bank: bank ? {
      bank_name: bank.bank_name,
      account_name: bank.account_name,
      account_number: bank.account_number,
    } : null,
  });
});

module.exports = { router };