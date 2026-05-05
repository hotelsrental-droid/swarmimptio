# Attribution

## How a click becomes a paid booking

```
1. Guest visits your-blog.com
   → Your page loads <script src=".../widget.js" data-key="YOUR_KEY">
   → Widget renders + fires `view` pixel to swarm.impt.io

2. Guest picks Dublin, clicks "Search hotels"
   → Widget redirects browser to:
     https://app.impt.io/find-hotel-input
       ?destination=Dublin
       &locationName=Dublin
       &tl=ie&gl=ie
       &utm_source=swarm-YOUR_KEY
       &utm_medium=widget
       &utm_campaign=oss

3. app.impt.io receives the click
   → Sets first-party cookie `impt_partner=YOUR_KEY` on `*.impt.io`, 90-day window
   → Records `partner_clicks` row (key, ip-hash, ua-hash, ts, dest)
   → Renders the lander pre-filled with Dublin

4. Guest searches → views hotel → checks out
   → Booking confirmation triggers an internal webhook to
     swarm.impt.io/api/widget/booking
     { booking_id, partner_key, base_value, currency, booked_at, check_in_at }
   → `partner_bookings` row created with status=PENDING

5. Guest checks in 14 days later
   → Status flips to CHECKED_IN

6. 30 days after check-in (refund window closed)
   → Status flips to PAYABLE

7. 5th of next month
   → Aggregate all PAYABLE rows for partner
   → If balance ≥ €50, fire payout via Wise / PayPal / IMPT
   → `partner_payouts` row recorded
```

## Cookie window

90 days. We picked this because:
- Booking.com affiliate window: 30 days
- Expedia affiliate window: 7 days
- Travel decisions average 36 days from research to booking (ITB Berlin 2024 data)

90 days means a guest who reads your blog post in March can book in May and you still get paid.

## Last-touch attribution

If a guest clicks two partner widgets in 90 days, the most recent overwrites. This matches industry standard and avoids the "double-pay" problem.

## Cross-device

If a guest signs into their existing IMPT account on another device within the cookie window, the attribution moves to the user record. So:

- Day 1: guest clicks your widget on laptop → cookie set
- Day 14: guest opens IMPT app on phone, signs in
- Attribution carries over via user record
- Day 28: guest books on phone → you still get paid

## What we never do

- Strip the partner key for our own benefit
- Reattribute paid clicks to ourselves
- Hide bookings from your dashboard
- Pay sub-5% silently

If you ever suspect we did, the booking IDs are public to you in the dashboard. We will reconcile any disputed booking against IMPT's public ledger of bookings (Mongo `bookings` collection, anonymised export available on request).
