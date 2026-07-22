/* =========================================================================
   LOCKSTEP — PETERBOROUGH LOCAL REWARDS
   JAVASCRIPT (script.js)
   =========================================================================
   Table of contents:
     1. Element references
     2. Reduced-motion check
     3. Animation loop (chamber rise + points counter + tier rail fill)
     4. Start / fallback
     5. How it works
   ========================================================================= */

(function () {

  /* -----------------------------------------------------------------------
     1. ELEMENT REFERENCES
     Grab the three animated pieces once, up front, instead of querying
     the DOM inside the animation loop.
  ----------------------------------------------------------------------- */
  const chamber   = document.getElementById('chamber');   // the SVG lift-lock trough + boat (hero)
  const pointsEl  = document.getElementById('pointsVal');  // the numeric points readout (hero)
  const railFill  = document.getElementById('railFill');   // the vertical rewards-tier rail fill (tiers section)


  /* -----------------------------------------------------------------------
     2. REDUCED-MOTION CHECK
     If the visitor's OS/browser asks for reduced motion, skip the loop
     entirely and show a static, representative end-state instead.
  ----------------------------------------------------------------------- */
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


  /* =========================================================================
   LOCK21 — PETERBOROUGH LOCAL REWARDS
   JAVASCRIPT (assets/js/lock.js)
   =========================================================================
   Table of contents:
     1. Element references
     2. Reduced-motion check
     3. Timeline — the 8-phase journey (in milliseconds)
     4. Easing + small helpers
     5. Animation loop
        5a. Boat position (enter / docked / exit)
        5b. Chamber rise progress (3 discrete stops, not one smooth ramp)
        5c. Purchase-stop rung highlighting
        5d. "+7" popups at stop 1 and stop 2
        5e. "Reward unlocked" badge at stop 3 (21 pts)
        5f. Gate-light glow (boat entering / exiting)
        5g. Points counter + rewards-tier rail
     6. Start / fallback
   ========================================================================= */

(function () {

  /* -----------------------------------------------------------------------
     1. ELEMENT REFERENCES
  ----------------------------------------------------------------------- */
  const chamber          = document.getElementById('chamber');
  const boat              = document.getElementById('boat');
  const gateLightBottom   = document.getElementById('gateLightBottom');
  const gateLightTop      = document.getElementById('gateLightTop');
  const pointsEl          = document.getElementById('pointsVal');
  const railFill          = document.getElementById('railFill');
  const rung1             = document.getElementById('rung1'); // lowest stop  (7 pts)
  const rung2             = document.getElementById('rung2'); // middle stop (14 pts)
  const rung3             = document.getElementById('rung3'); // top stop    (21 pts)
  const popup1            = document.getElementById('popup1'); // "+7" shown at stop 1
  const popup2            = document.getElementById('popup2'); // "+7" shown at stop 2
  const rewardBadge       = document.getElementById('rewardBadge'); // shown at stop 3


  /* -----------------------------------------------------------------------
     2. REDUCED-MOTION CHECK
  ----------------------------------------------------------------------- */
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


  /* -----------------------------------------------------------------------
     3. TIMELINE — THE 8-PHASE JOURNEY (in ms)
     Every purchase is its own discrete rise + a short pause where the
     points visibly land, rather than one continuous ramp. This mirrors
     the real reward logic: 7 + 7 + 7 = 21.

       enter   0     -> 700    boat sails in, docks
       rise1   700   -> 2100   purchase 1 → rises to stop 1  (0  -> 7 pts)
       pause1  2100  -> 2800   "+7" popup, rung 1 lights up
       rise2   2800  -> 4200   purchase 2 → rises to stop 2  (7  -> 14 pts)
       pause2  4200  -> 4900   "+7" popup, rung 2 lights up
       rise3   4900  -> 6300   purchase 3 → rises to stop 3  (14 -> 21 pts)
       reward  6300  -> 7600   "reward unlocked" badge, rung 3 lights up
       exit    7600  -> 8300   boat sails out, everything resets
  ----------------------------------------------------------------------- */
  const T_ENTER_END  = 700;
  const T_RISE1_END  = 2100;
  const T_PAUSE1_END = 2800;
  const T_RISE2_END  = 4200;
  const T_PAUSE2_END = 4900;
  const T_RISE3_END  = 6300;
  const T_REWARD_END = 7600;
  const CYCLE_MS      = 8300; // = end of exit phase

  const TRAVEL      = 336;  // total px the chamber travels, bottom -> top
  const BOAT_DOCK_X = 155;
  const BOAT_OFF_LEFT_X  = -60;
  const BOAT_OFF_RIGHT_X = 420;
  const BOAT_Y_OFFSET    = 10;

  let cycleStart = null;


  /* -----------------------------------------------------------------------
     4. EASING + SMALL HELPERS
  ----------------------------------------------------------------------- */
  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  // Smoothly fades an element in, holds, then fades out across a window.
  // Returns 0..1 opacity given elapsed time within the window and its length.
  function fadeInHoldOut(elapsedInWindow, windowLength) {
    const fadeMs = 180;
    if (elapsedInWindow < fadeMs) return elapsedInWindow / fadeMs;
    if (elapsedInWindow > windowLength - fadeMs) return clamp01((windowLength - elapsedInWindow) / fadeMs);
    return 1;
  }


  /* -----------------------------------------------------------------------
     5. ANIMATION LOOP
  ----------------------------------------------------------------------- */
  function animationFrame(timestamp) {
    if (!cycleStart) cycleStart = timestamp;
    const elapsed = (timestamp - cycleStart) % CYCLE_MS; // 0 -> CYCLE_MS

    let riseProgress; // 0 -> 1 across the full 3-stop climb (maps to 0 -> 21 pts)
    let boatX = BOAT_DOCK_X;
    let stopsReached = 0; // how many of the 3 rungs are currently lit

    // Reset transient UI each frame; phases below turn on what applies.
    let popup1Opacity = 0;
    let popup2Opacity = 0;
    let badgeOpacity = 0;

    if (elapsed <= T_ENTER_END) {
      // --- 5a. Boat sailing in ---
      const local = elapsed / T_ENTER_END;
      boatX = lerp(BOAT_OFF_LEFT_X, BOAT_DOCK_X, easeInOut(local));
      riseProgress = 0;

    } else if (elapsed <= T_RISE1_END) {
      // --- 5b. Purchase 1: rising to stop 1 (0 -> 7 pts) ---
      const local = (elapsed - T_ENTER_END) / (T_RISE1_END - T_ENTER_END);
      riseProgress = easeInOut(local) * (1 / 3);

    } else if (elapsed <= T_PAUSE1_END) {
      // --- Pause at stop 1: show "+7", light up rung 1 ---
      riseProgress = 1 / 3;
      stopsReached = 1;
      popup1Opacity = fadeInHoldOut(elapsed - T_RISE1_END, T_PAUSE1_END - T_RISE1_END);

    } else if (elapsed <= T_RISE2_END) {
      // --- Purchase 2: rising to stop 2 (7 -> 14 pts) ---
      const local = (elapsed - T_PAUSE1_END) / (T_RISE2_END - T_PAUSE1_END);
      riseProgress = (1 / 3) + easeInOut(local) * (1 / 3);
      stopsReached = 1;

    } else if (elapsed <= T_PAUSE2_END) {
      // --- Pause at stop 2: show "+7", light up rung 2 ---
      riseProgress = 2 / 3;
      stopsReached = 2;
      popup2Opacity = fadeInHoldOut(elapsed - T_RISE2_END, T_PAUSE2_END - T_RISE2_END);

    } else if (elapsed <= T_RISE3_END) {
      // --- Purchase 3: rising to stop 3 (14 -> 21 pts) ---
      const local = (elapsed - T_PAUSE2_END) / (T_RISE3_END - T_PAUSE2_END);
      riseProgress = (2 / 3) + easeInOut(local) * (1 / 3);
      stopsReached = 2;

    } else if (elapsed <= T_REWARD_END) {
      // --- Reward unlocked at stop 3: badge appears, rung 3 lights up ---
      riseProgress = 1;
      stopsReached = 3;
      badgeOpacity = fadeInHoldOut(elapsed - T_RISE3_END, T_REWARD_END - T_RISE3_END);

    } else {
      // --- 5a (again). Boat sailing out, chamber holds at the top ---
      const local = (elapsed - T_REWARD_END) / (CYCLE_MS - T_REWARD_END);
      boatX = lerp(BOAT_DOCK_X, BOAT_OFF_RIGHT_X, easeInOut(local));
      riseProgress = 1;
      stopsReached = 3;
    }

    // --- Position the chamber (trough) ---
    const chamberY = TRAVEL - (riseProgress * TRAVEL);
    if (chamber) chamber.setAttribute('transform', 'translate(0,' + chamberY + ')');

    // --- Position the boat: rides the chamber vertically, plus a gentle
    //     continuous water bob/tilt so it never looks perfectly static ---
    const bob  = Math.sin(timestamp / 260) * 2.2;
    const tilt = Math.sin(timestamp / 260) * 2.5;
    const boatY = chamberY + BOAT_Y_OFFSET + bob;
    if (boat) {
      boat.setAttribute('transform', 'translate(' + boatX + ',' + boatY + ') rotate(' + tilt + ' 25 12)');
    }

    // --- 5c. Purchase-stop rung highlighting (dim by default, glow once reached) ---
    if (rung1) rung1.setAttribute('opacity', stopsReached >= 1 ? '1' : '0.35');
    if (rung2) rung2.setAttribute('opacity', stopsReached >= 2 ? '1' : '0.35');
    if (rung3) rung3.setAttribute('opacity', stopsReached >= 3 ? '1' : '0.35');

    // --- 5d. "+7" popups (drift upward slightly while fading) ---
    if (popup1) {
      popup1.setAttribute('opacity', popup1Opacity.toFixed(2));
      popup1.setAttribute('y', 240 - (1 - popup1Opacity) * 6);
    }
    if (popup2) {
      popup2.setAttribute('opacity', popup2Opacity.toFixed(2));
      popup2.setAttribute('y', 128 - (1 - popup2Opacity) * 6);
    }

    // --- 5e. Reward badge ---
    if (rewardBadge) rewardBadge.setAttribute('opacity', badgeOpacity.toFixed(2));

    // --- 5f. Gate-light glow: pulses as the boat transits each end ---
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

    // --- 5g. Points counter + rewards-tier rail, tied to riseProgress ---
    if (pointsEl) pointsEl.textContent = Math.round(riseProgress * 21);
    if (railFill) {
      const railHeight = 100 + riseProgress * 180;
      railFill.setAttribute('y', 316 - railHeight);
      railFill.setAttribute('height', railHeight);
    }

    requestAnimationFrame(animationFrame);
  }


  /* -----------------------------------------------------------------------
     6. START / FALLBACK
  ----------------------------------------------------------------------- */
  if (!prefersReducedMotion) {
    requestAnimationFrame(animationFrame);
  } else {
    // static, representative end-state when motion is disabled
    if (pointsEl) pointsEl.textContent = '21';
    if (boat) boat.setAttribute('transform', 'translate(' + BOAT_DOCK_X + ',' + BOAT_Y_OFFSET + ')');
    if (rung1) rung1.setAttribute('opacity', '1');
    if (rung2) rung2.setAttribute('opacity', '1');
    if (rung3) rung3.setAttribute('opacity', '1');
    if (rewardBadge) rewardBadge.setAttribute('opacity', '1');
  }

})();

  /* -----------------------------------------------------------------------
     4. START / FALLBACK
  ----------------------------------------------------------------------- */
  if (!prefersReducedMotion) {
    requestAnimationFrame(animationFrame);
  } else if (pointsEl) {
    // static, representative value when motion is disabled
    pointsEl.textContent = '640';
  }

   /* -----------------------------------------------------------------------
     5. How it works circle fill
  ----------------------------------------------------------------------- */
const bars=document.querySelectorAll(".bar");

const counter=document.getElementById("counter");

const reward=document.querySelector(".reward");

const status=document.querySelector(".status");

const wrapper=document.querySelector(".lock-wrapper");

let purchase=0;

function animate(){

bars.forEach(bar=>bar.classList.remove("active"));

reward.classList.remove("show");

wrapper.classList.remove("unlock");

if(purchase==0){

bars[0].classList.add("active");

counter.innerHTML="7";

status.innerHTML="Purchase #1";

}

if(purchase==1){

bars[0].classList.add("active");

bars[1].classList.add("active");

counter.innerHTML="14";

status.innerHTML="Purchase #2";

}

if(purchase==2){

bars[0].classList.add("active");

bars[1].classList.add("active");

bars[2].classList.add("active");

counter.innerHTML="21";

status.innerHTML="Purchase #3";

setTimeout(()=>{

wrapper.classList.add("unlock");

reward.classList.add("show");

},900);

}

purchase++;

if(purchase>2){

setTimeout(()=>{

purchase=0;

},1800);

}

}

animate();

setInterval(animate,3000);
  
})();