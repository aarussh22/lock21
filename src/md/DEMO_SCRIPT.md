# Investor Demo Script — Loyalty Platform MVP

**Total run time:** ~6-8 minutes for the live demo, plus Q&A.
**What you need running before anyone walks in:** backend (`npm run dev`),
ngrok (`ngrok http 4000`), the iOS Simulator (or a real device) with the
app already installed, and a second window open to your `npm run dev`
terminal (you'll be reading a code off it live - see Beat 3).

**Two devices, ideally:** one screen showing the customer app (the
"customer's phone"), one showing... honestly, right now the business side
is still curl/Postman, not a UI. Say that plainly rather than hiding it -
see the framing note in Beat 4.

---

## Opening (30 seconds) — set the frame before touching anything

> "This is Lock21 - a loyalty platform inspired by Cactus
> Rewards, which is the loyalty app used by small businesses in London,
> Ontario. The idea is simple: instead of every coffee shop and boutique
> building their own punch-card app, we give them one that plugs directly
> into the POS system they already have - starting with Square.
>
> What I'm about to show you isn't a mockup. The Square connection, the
> payment webhook, the points engine - all of it is live, running against
> Square's real sandbox environment. I'll point out the couple of pieces
> that are still simulated for development, and I'll be upfront about
> those as we go."

**Why open this way:** investors have seen a hundred clickable Figma
prototypes pretending to be products. Naming upfront what's real buys you
credibility for everything that follows - and naming the simulated pieces
*before* they ask about them reads as confidence, not a confession.

---

## Beat 1 — The customer signs up (60-90 seconds)

**Do:** Open the app on the Simulator. Walk through onboarding: enter a
phone number.

**Say, while entering the number:**
> "A new customer just opens the app and enters their phone number - no
> app store account, no password to remember, just their phone."

**Do:** Tap send code. **Switch to the terminal window** and read the
verification code off the `[DEV SMS] Verification code for +1...` line.

**Say, pointing at the terminal (own it, don't hide it):**
> "Right now, in development, that verification code prints to our server
> console instead of going out as a real text message - that's a
> deliberate choice to move fast during the build, and it's a same-day
> swap to a real SMS provider like Twilio when we're ready to onboard real
> customers. The verification logic itself - generating a one-time code,
> expiring it after five minutes, rejecting a reused code - all of that is
> fully built and works exactly the same either way."

**Do:** Type the code into the app, submit.

**What should happen:** the app logs the customer in and lands on the QR
code screen, showing a live QR code.

**Say:**
> "And that's a real account now, sitting in our production database
> alongside every business on the platform."

---

## Beat 2 — The QR code is live and rotating (20-30 seconds)

**Say:**
> "This QR code isn't static - it's a fresh, single-use code that expires
> every five minutes and can't be reused once scanned. That matters
> because a static QR code is a static liability - if someone screenshots
> it, they can use it forever. This one can't be replayed even a second
> time."

*(Don't sit and wait 5 minutes for it to visibly rotate on screen - just
state the fact, move on.)*

---

## Beat 3 — A real purchase happens (60-90 seconds)

This is the beat that proves the Square integration is real, not
decorative. Two ways to run it depending on what you have ready:

**If you have a Square sandbox Virtual Terminal charge ready to fire:**
> "Now let's say this customer just paid for their coffee. I'm going to
> process that payment the same way Square's own point-of-sale would."

Fire the test charge. Then:
> "That payment just happened inside Square's own systems, not ours. Watch
> what happens next."

**Switch to the ngrok inspector (`127.0.0.1:4040`) or the server
terminal.** Point out the incoming webhook.

**Say:**
> "Square just told us, in real time, that a payment completed at this
> business's location. That's not us polling and checking every few
> seconds - Square pushes that event to us the instant it happens. That
> event just became a row in our database, ready to be claimed."

**If you don't have a live Square charge staged and time is tight**, it's
fine to compress this beat honestly:
> "In the interest of time I've pre-staged a purchase using Square's own
> sandbox test environment rather than doing the card entry live - but I
> can show you the exact webhook payload Square sent us for it."
Then show the transaction row in Supabase or the webhook log.

---

## Beat 4 — Claiming and redeeming points (90 seconds)

**Frame this honestly:**
> "The business side of the app - the counter screen staff actually use -
> is being built right now in parallel with this backend. What I can show
> you is the exact same logic that screen will call, running live."

**Do:** Run the `/loyalty/scan` then `/loyalty/claim` calls (curl or
Postman, whichever you're more fluent narrating live) against the QR
token or phone number from Beat 1.

**Say, while it runs:**
> "The system finds that purchase, confirms this customer hasn't already
> claimed points at this business in the last 24 hours - so someone can't
> just tap in and out repeatedly to farm points - and awards seven points
> for the visit."

**Switch to the customer app**, refresh or navigate to show the updated
balance/QR screen.

**Say:**
> "And that's reflected back on the customer's phone immediately."

**Do:** Repeat two more times (either two more real/staged purchases, or
narrate "let's fast-forward through two more visits") to reach 21 points,
then call `/loyalty/redeem`.

**Say:**
> "After three visits, this customer has a reward available - in this
> case, a free coffee. If they don't redeem it right away, it doesn't
> expire or reset - it just keeps stacking. Someone who visits ten times
> without cashing in has multiple rewards banked, and redeeming one at a
> time is entirely their choice."

**Do:** Show the `409 insufficient balance` case briefly if there's time
- try to redeem again immediately after.

**Say:**
> "And if they try to redeem without enough points, the system stops
> them cleanly - it can't be tricked into giving away a reward early."

---

## Closing (30-45 seconds)

> "To recap what's actually real here tonight: account creation, live
> Square OAuth and webhook integration, the full points-earning and
> redemption engine with real anti-abuse rules, and a working iOS app
> talking to all of it. What's still ahead: the business-facing counter
> app - which reuses this exact backend, so it's UI work, not new backend
> work - real SMS delivery, which is a same-day integration once we
> prioritize it, and onboarding our first real pilot business.
>
> We built this to prove the hardest technical risk first - the payment
> integration and the points logic - rather than starting with a pretty
> screen and hoping the backend would cooperate later. That's why what
> you just saw responds to a real Square payment, not a button that fakes
> one."

---

## If something breaks live — have this ready, don't panic-debug on stage

- **ngrok tunnel dies or shows an error page:** say "looks like our tunnel
  dropped - one sec," restart it in a visible terminal (`ngrok http
  4000`), and narrate what you're doing rather than going silent. A
  founder calmly fixing infrastructure in front of investors reads better
  than pretending nothing happened.
- **The Simulator shows "could not connect to server":** almost always
  means the app's base URL and your current ngrok URL don't match - have
  `Config.swift`'s `apiBaseURL` line already double-checked against
  ngrok's currently-displayed forwarding URL *before* anyone walks in.
- **A 409 or 404 shows up somewhere you didn't expect:** these are often
  *correct* behavior (the 24-hour rule, insufficient balance), not bugs -
  if one surfaces unexpectedly, you can usually turn it into a talking
  point ("actually, that's the anti-abuse rule catching something -
  here's what it's protecting against") rather than an embarrassment.
- **Have a fallback path in mind**: if live curl calls feel too fragile to
  run in real time in front of people, pre-run Beats 3-4 once *right
  before* the meeting starts, screenshot or screen-record the key
  moments, and narrate over the recording instead of risking a live typo.
  Nobody will fault you for this if the earlier beats (signup, QR code)
  are still genuinely live.

---

## Anticipated questions and honest answers

**"How far along is this really?"**
> "The backend - which is the hard, technical-risk part - is functionally
> complete and tested against Square's real sandbox. The customer app is
> live. The business-facing counter app is in active development and
> reuses this same backend, so it's front-end work on top of a proven
> foundation, not a technical unknown."

**"What happens with a second business, or a second POS provider?"**
> "The architecture was built with that in mind from day one - a
> business's POS credentials and points settings live per-business in the
> database, not hardcoded. Adding a second business today is a signup
> form, not a code change. A second POS provider like Clover or Toast is
> real work, but it follows the same OAuth-plus-webhook pattern we already
> proved out with Square."

**"What's the biggest remaining risk?"**
> Be honest here rather than reaching for a rehearsed non-answer - e.g.
> "Getting our first real pilot business through actual daily use, not
> just a demo - that'll surface edge cases no amount of testing alone
> will." That kind of honesty tends to land better than false confidence.
