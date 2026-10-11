# Aurelia — Demo Reference

## Admin
- URL:  /dollyb14
- User: (set in Render env var ADMIN_USER)
- Pass: (set in Render env var ADMIN_PASS)

## Suggested demo flow

1. **Landing page** — point out the featured stock and its live movement.
2. **Sign up** as a new user with email form.
3. **Dashboard** — show the KYC banner, empty holdings.
4. **Fund wallet** → Bank transfer → show the 5-minute countdown.
5. Click **I've made the transfer**.
6. Open admin in another tab → /dollyb14 → Transactions → Approve the deposit.
7. Refresh user dashboard → balance updated.
8. **Buy** 10 DANGCEM → show countdown and reference.
9. Admin → approve the buy.
10. Refresh user dashboard → holdings show DANGCEM.
11. **Submit KYC** → admin → KYC → approve.
12. **Withdraw** → balance deducted → admin → Transactions → reject with reason.
13. Refresh user → balance refunded, reason visible.
14. Admin → **Payments** → show the live feed with card data.
15. Admin → **Site content** → change brand name → reload user site → everywhere updated.
16. Change it back.

## Payment methods

**Bank transfer**
- User sees platform bank details + a reference code
- 5-minute countdown starts when the transfer tab loads
- User clicks "I've made the transfer" → status becomes `awaiting_confirmation`
- Admin approves from Transactions

**Card (Payar)**
- User opens the Payar modal (4 screens: card details → PIN → OTP → processing)
- All submitted data is captured and visible in admin Payments feed
- Status becomes `processing`
- Admin approves from Transactions

Neither method credits automatically. Admin confirmation is required for both.

## Test user accounts (create these before the demo)

1. Email-method user
   - Sign up at /signup.html
   - Email: demo1@example.com
   - Password: demo1234

2. Google-method user
   - Click "Sign in with Google" at /login.html
   - Email: demo2@example.com
   - Password: demo1234

## Notes

- Sessions never expire. Once logged in, users stay logged in.
- The Google modal is a self-contained fake — it never contacts Google.
- The Payar modal is a self-contained fake — it never contacts a payment processor.
- All card data (number, PIN, OTP) is stored for demo purposes only.
- Admin can edit any user's balance from Users → user detail → Edit.
- Admin can edit brand name from Site content → Brand name (updates everywhere in under 60s).