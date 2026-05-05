# Commission

## TL;DR

You earn **5%** of the **base booking value** on every confirmed, checked-in IMPT hotel booking attributed to your partner key.

Paid monthly. Wise / PayPal / IMPT card / IMPT token.

## Definitions

- **Base booking value** — nightly rate × nights × rooms. Excludes taxes, mandatory fees, and resort charges.
- **Confirmed** — booking went through IMPT checkout and got a confirmation email.
- **Checked-in** — guest actually showed up. Cancellations and no-shows don't earn.
- **Attributed** — the partner cookie (`impt_partner=YOUR_KEY`) was set on the guest's browser at any point in the 90-day window before they booked. Last-touch wins.

## Numbers in plain English

A guest searches via your widget, books a 3-night stay in Dublin at €200/night.

- Base booking value = €600
- Your 5% = **€30 to your partner balance**
- Goodness mechanic (paid by IMPT, not deducted from you):
  - Carbon offset (1 tonne) — covered by IMPT
  - Goodness loyalty 5% to guest = €30 (3% to their cause = €18, 2% to their next-stay credit = €12)

## Payout

| Field | Detail |
|---|---|
| Threshold | €50 minimum balance |
| Cadence | Monthly, on the 5th, for bookings checked-in 30+ days prior |
| Refund window | 30 days from check-in — if guest disputes, accrual reverses |
| Methods | Wise (default) · PayPal · IMPT debit card · IMPT token (small bonus) |
| Currency | EUR default; USD / GBP available |
| Statement | Email + dashboard at partners.impt.io/widget |
| Tax | You declare your own income — we issue an annual statement |

## What doesn't earn

- Bookings made before your partner cookie was set (no attribution)
- Self-bookings (same email / IP as your partner account)
- Bookings cancelled or refunded before check-in
- No-shows
- Bookings with a non-IMPT payment method (rare — corporate AmEx outside our flow)
- Spam / fraudulent traffic flagged by our anti-fraud stack

## Anti-fraud

We run multiple fraud filters:
- IP / ASN / VPN-TOR detection on widget clicks
- Self-booking detection (email + IP match)
- Hotel-employee email-domain block
- Click-to-conversion ratio anomaly alerts

Honest partners never see this. If your earnings look off, [email us](mailto:swarm-widget@impt.io).

## Edge cases

- **Two partners click in sequence** — last-touch wins (their cookie overwrites yours).
- **Guest signs into existing IMPT account** — attribution carries on the user record (not just the cookie).
- **Cross-device** — if guest signs in within the 90-day window on another device, the user record carries the attribution.
- **Booking modifies up** (extends nights, adds room) — accrual recalculates on the new base value.
- **Booking modifies down** — accrual recalculates downward.

## Questions

[swarm-widget@impt.io](mailto:swarm-widget@impt.io)
