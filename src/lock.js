/* =========================================================================
   LOCK21 — PETERBOROUGH LOCAL REWARDS
   JAVASCRIPT (src/lock.js)
   =========================================================================
   Two independent, self-contained animations live in this file:

     PART A — HERO LIFT-LOCK ANIMATION
       Drives the SVG boat/chamber card in the hero (§5 of lock.css).

     PART B — HOW-IT-WORKS RING ANIMATION
       Drives the circular progress ring under "How it works" (§7 of
       lock.css) — fills one of 3 wedges per purchase, then reveals
       "FREE Reward" once all three are lit.

   Each part checks prefers-reduced-motion independently and each is
   wrapped in its own IIFE, so a missing element in one never breaks
   the other.
   ========================================================================= */


/* =========================================================================
   PART A — HERO LIFT-LOCK ANIMATION
   Table of contents:
     A1. Element references
     A2. Reduced-motion check
     A3. Timeline — the 8-phase journey (in ms)
     A4. Easing + small helpers
     A5. Animation loop
     A6. Start / fallback
   ========================================================================= */
(function () {

  /* --- A1. ELEMENT REFERENCES --- */
  const chamber        = document.getElementById('chamber');
  const boat            = document.getElementById('boat');
  const gateLightBottom = document.getElementById('gateLightBottom');
  const gateLightTop    = document.getElementById('gateLightTop');
  const pointsEl        = document.getElementById('pointsVal');
  const railFill        = document.getElementById('railFill'); // present only if the tiers rail SVG is on the page
  const rung1           = document.getElementById('rung1');
  const rung2           = document.getElementById('rung2');
  const rung3           = document.getElementById('rung3');
  const popup1          = document.getElementById('popup1');
  const popup2          = document.getElementById('popup2');
  const rewardBadge     = document.getElementById('rewardBadge');

  // Bail out quietly if this page doesn't have the hero SVG at all.
  if (!chamber || !boat) return;

  /* --- A2. REDUCED-MOTION CHECK --- */
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- A3. TIMELINE (ms) ---
       enter   0     -> 700    boat sails in, docks
       rise1   700   -> 2100   purchase 1 -> stop 1   (0  -> 7 pts)
       pause1  2100  -> 2800   "+7" popup, rung 1 lights up
       rise2   2800  -> 4200   purchase 2 -> stop 2   (7  -> 14 pts)
       pause2  4200  -> 4900   "+7" popup, rung 2 lights up
       rise3   4900  -> 6300   purchase 3 -> stop 3   (14 -> 21 pts)
       reward  6300  -> 7600   "reward unlocked" badge, rung 3 lights up
       exit    7600  -> 8300   boat sails out, everything resets
  --- */
  const T_ENTER_END  = 700;
  const T_RISE1_END  = 2100;
  const T_PAUSE1_END = 2800;
  const T_RISE2_END  = 4200;
  const T_PAUSE2_END = 4900;
  const T_RISE3_END  = 6300;
  const T_REWARD_END = 7600;
  const CYCLE_MS      = 8300;

  const TRAVEL           = 336;
  const BOAT_DOCK_X      = 155;
  const BOAT_OFF_LEFT_X  = -60;
  const BOAT_OFF_RIGHT_X = 420;
  const BOAT_Y_OFFSET    = 10;

  let cycleStart = null;

  /* --- A4. EASING + HELPERS --- */
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function fadeInHoldOut(elapsedInWindow, windowLength) {
    const fadeMs = 180;
    if (elapsedInWindow < fadeMs) return elapsedInWindow / fadeMs;
    if (elapsedInWindow > windowLength - fadeMs) return clamp01((windowLength - elapsedInWindow) / fadeMs);
    return 1;
  }

  /* --- A5. ANIMATION LOOP --- */
  function animationFrame(timestamp) {
    if (!cycleStart) cycleStart = timestamp;
    const elapsed = (timestamp - cycleStart) % CYCLE_MS;

    let riseProgress;
    let boatX = BOAT_DOCK_X;
    let stopsReached = 0;
    let popup1Opacity = 0;
    let popup2Opacity = 0;
    let badgeOpacity = 0;

    if (elapsed <= T_ENTER_END) {
      const local = elapsed / T_ENTER_END;
      boatX = lerp(BOAT_OFF_LEFT_X, BOAT_DOCK_X, easeInOut(local));
      riseProgress = 0;

    } else if (elapsed <= T_RISE1_END) {
      const local = (elapsed - T_ENTER_END) / (T_RISE1_END - T_ENTER_END);
      riseProgress = easeInOut(local) * (1 / 3);

    } else if (elapsed <= T_PAUSE1_END) {
      riseProgress = 1 / 3;
      stopsReached = 1;
      popup1Opacity = fadeInHoldOut(elapsed - T_RISE1_END, T_PAUSE1_END - T_RISE1_END);

    } else if (elapsed <= T_RISE2_END) {
      const local = (elapsed - T_PAUSE1_END) / (T_RISE2_END - T_PAUSE1_END);
      riseProgress = (1 / 3) + easeInOut(local) * (1 / 3);
      stopsReached = 1;

    } else if (elapsed <= T_PAUSE2_END) {
      riseProgress = 2 / 3;
      stopsReached = 2;
      popup2Opacity = fadeInHoldOut(elapsed - T_RISE2_END, T_PAUSE2_END - T_RISE2_END);

    } else if (elapsed <= T_RISE3_END) {
      const local = (elapsed - T_PAUSE2_END) / (T_RISE3_END - T_PAUSE2_END);
      riseProgress = (2 / 3) + easeInOut(local) * (1 / 3);
      stopsReached = 2;

    } else if (elapsed <= T_REWARD_END) {
      riseProgress = 1;
      stopsReached = 3;
      badgeOpacity = fadeInHoldOut(elapsed - T_RISE3_END, T_REWARD_END - T_RISE3_END);

    } else {
      const local = (elapsed - T_REWARD_END) / (CYCLE_MS - T_REWARD_END);
      boatX = lerp(BOAT_DOCK_X, BOAT_OFF_RIGHT_X, easeInOut(local));
      riseProgress = 1;
      stopsReached = 3;
    }

    const chamberY = TRAVEL - (riseProgress * TRAVEL);
    chamber.setAttribute('transform', 'translate(0,' + chamberY + ')');

    const bob  = Math.sin(timestamp / 260) * 2.2;
    const tilt = Math.sin(timestamp / 260) * 2.5;
    const boatY = chamberY + BOAT_Y_OFFSET + bob;
    boat.setAttribute('transform', 'translate(' + boatX + ',' + boatY + ') rotate(' + tilt + ' 25 12)');

    if (rung1) rung1.setAttribute('opacity', stopsReached >= 1 ? '1' : '0.35');
    if (rung2) rung2.setAttribute('opacity', stopsReached >= 2 ? '1' : '0.35');
    if (rung3) rung3.setAttribute('opacity', stopsReached >= 3 ? '1' : '0.35');

    if (popup1) {
      popup1.setAttribute('opacity', popup1Opacity.toFixed(2));
      popup1.setAttribute('transform', 'translate(0,' + (-(1 - popup1Opacity) * 6) + ')');
    }
    if (popup2) {
      popup2.setAttribute('opacity', popup2Opacity.toFixed(2));
      popup2.setAttribute('transform', 'translate(0,' + (-(1 - popup2Opacity) * 6) + ')');
    }
    if (rewardBadge) rewardBadge.setAttribute('opacity', badgeOpacity.toFixed(2));

    if (gateLightBottom) {
      const nearBottom = clamp01(1 - Math.abs(elapsed - T_ENTER_END / 2) / (T_ENTER_END / 2));
      gateLightBottom.setAttribute('opacity', (0.15 + nearBottom * 0.85).toFixed(2));
    }
    if (gateLightTop) {
      const exitMid = T_REWARD_END + (CYCLE_MS - T_REWARD_END) / 2;
      const halfWindow = (CYCLE_MS - T_REWARD_END) / 2;
      const nearTop = clamp01(1 - Math.abs(elapsed - exitMid) / halfWindow);
      gateLightTop.setAttribute('opacity', (0.15 + nearTop * 0.85).toFixed(2));
    }

    if (pointsEl) pointsEl.textContent = Math.round(riseProgress * 21);
    if (railFill) {
      const railHeight = 100 + riseProgress * 180;
      railFill.setAttribute('y', 316 - railHeight);
      railFill.setAttribute('height', railHeight);
    }

    requestAnimationFrame(animationFrame);
  }

  /* --- A6. START / FALLBACK --- */
  if (!prefersReducedMotion) {
    requestAnimationFrame(animationFrame);
  } else {
    if (pointsEl) pointsEl.textContent = '21';
    boat.setAttribute('transform', 'translate(' + BOAT_DOCK_X + ',' + BOAT_Y_OFFSET + ')');
    if (rung1) rung1.setAttribute('opacity', '1');
    if (rung2) rung2.setAttribute('opacity', '1');
    if (rung3) rung3.setAttribute('opacity', '1');
    if (rewardBadge) rewardBadge.setAttribute('opacity', '1');
  }

})();


/* =========================================================================
   PART B — HOW-IT-WORKS PADLOCK ANIMATION
   Table of contents:
     B1. Element references
     B2. Reduced-motion check
     B3. Small helpers (delay, number tween)
     B4. The purchase cycle (state machine)
     B5. Start / fallback
   ========================================================================= */
(function () {

  /* --- B1. ELEMENT REFERENCES --- */
  const lockWrapper = document.getElementById('howLockWrapper');
  const bars = [
    document.getElementById('howBar1'),
    document.getElementById('howBar2'),
    document.getElementById('howBar3'),
  ];
  const icons = [
    document.getElementById('howIcon1'), // shopping bag
    document.getElementById('howIcon2'), // shopping bag
    document.getElementById('howIcon3'), // gift box -> "opens" into a party emoji
  ];
  const pointsEl = document.getElementById('howPoints');
  const statusEl = document.getElementById('howStatus');
  const rewardEl = document.getElementById('howReward');

  // Bail out quietly if this page doesn't have the padlock at all.
  if (!lockWrapper || bars.some((b) => !b)) return;

  const GIFT_ICON_INDEX = 2; // icons[2] is the gift box (3rd purchase)
  const POINTS_PER_PURCHASE = 7;
  const PURCHASES_TO_UNLOCK = 3;
  const TOTAL_POINTS = POINTS_PER_PURCHASE * PURCHASES_TO_UNLOCK; // 21

  /* --- B2. REDUCED-MOTION CHECK --- */
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- B3. SMALL HELPERS --- */
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  function animateCount(from, to, duration) {
    return new Promise((resolve) => {
      const start = performance.now();
      function tick(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const value = Math.round(from + (to - from) * eased);
        if (pointsEl) pointsEl.textContent = value;
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
  }

  /* --- B4. THE PURCHASE CYCLE --- */
  function resetState() {
    bars.forEach((bar) => bar.classList.remove('active'));
    icons.forEach((icon, i) => {
      if (!icon) return;
      icon.classList.remove('pop', 'gift-open');
      if (i === GIFT_ICON_INDEX) icon.textContent = '🎁'; // reset gift box before it "opens" again
    });
    lockWrapper.classList.remove('unlock');
    if (rewardEl) rewardEl.classList.remove('show');
    if (pointsEl) pointsEl.textContent = '0';
    if (statusEl) statusEl.textContent = 'Collect 3 purchases to unlock your reward';
  }

  async function registerPurchase(purchaseNumber) {
    const index = purchaseNumber - 1;
    bars[index].classList.add('active');

    const icon = icons[index];
    if (icon) icon.classList.add('pop'); // bag (or gift box) bounces in

    const fromPoints = index * POINTS_PER_PURCHASE;
    const toPoints = purchaseNumber * POINTS_PER_PURCHASE;
    await animateCount(fromPoints, toPoints, 550);

    // On the 3rd purchase, let the gift box "open" — swap it to a party
    // emoji with a bigger pop, like a mystery box being unwrapped.
    if (index === GIFT_ICON_INDEX && icon) {
      await delay(300);
      icon.textContent = '🎉';
      icon.classList.add('gift-open');
    }
  }

  async function unlockReward() {
    await delay(300);
    lockWrapper.classList.add('unlock');
    if (rewardEl) rewardEl.classList.add('show');
    if (statusEl) statusEl.textContent = 'Reward ready to redeem!';
  }

  async function runCycle() {
    resetState();
    await delay(900);

    for (let i = 1; i <= PURCHASES_TO_UNLOCK; i++) {
      await registerPurchase(i);
      await delay(950);
    }

    await unlockReward();
    await delay(2600);
    await delay(700);
    runCycle();
  }

  /* --- B5. START / FALLBACK --- */
  if (!prefersReducedMotion) {
    runCycle();
  } else {
    bars.forEach((bar) => bar.classList.add('active'));
    icons.forEach((icon, i) => {
      if (!icon) return;
      if (i === GIFT_ICON_INDEX) icon.textContent = '🎉';
      icon.classList.add('pop');
    });
    lockWrapper.classList.add('unlock');
    if (rewardEl) rewardEl.classList.add('show');
    if (pointsEl) pointsEl.textContent = String(TOTAL_POINTS);
    if (statusEl) statusEl.textContent = 'Reward ready to redeem!';
  }

})();