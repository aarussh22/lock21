/* =========================================================================
   LOCKSTEP — PETERBOROUGH LOCAL REWARDS
   JAVASCRIPT (script.js)
   =========================================================================
   Table of contents:
     1. Element references
     2. Reduced-motion check
     3. Animation loop (chamber rise + points counter + tier rail fill)
     4. Start / fallback
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


  /* -----------------------------------------------------------------------
     3. ANIMATION LOOP
     One continuous, looping "rise" that ties three visuals to the same
     0→1 progress value (eased) so they all move in sync:
       - the SVG chamber travels from the lower canal to the top canal
       - the points counter counts up from 0
       - the rewards-tier rail fill grows taller
  ----------------------------------------------------------------------- */
  const CYCLE_DURATION_MS = 6000; // how long one full rise takes
  let cycleStart = null;

  function animationFrame(timestamp) {
    if (!cycleStart) cycleStart = timestamp;

    // t = 0 -> 1 across each cycle, then loops
    const t = ((timestamp - cycleStart) % CYCLE_DURATION_MS) / CYCLE_DURATION_MS;

    // ease-in-out so the rise feels mechanical, not linear
    const eased = t < 0.5
      ? 2 * t * t
      : 1 - Math.pow(-2 * t + 2, 2) / 2;

    // --- 3a. Lift-lock chamber (hero visual) ---
    // travel: 336 (resting in the lower canal) -> 0 (arrived at the top canal)
    const travel = 336;
    const chamberY = travel - (eased * travel);
    if (chamber) {
      chamber.setAttribute('transform', 'translate(0,' + chamberY + ')');
    }

    // --- 3b. Points counter (hero visual) ---
    // ties directly to the same eased progress, 0 -> 1280 points
    if (pointsEl) {
      const pts = Math.round(eased * 1280);
      pointsEl.textContent = pts.toLocaleString();
    }

    // --- 3c. Rewards-tier rail fill (tiers section) ---
    // grows from 100px to 280px tall, anchored to the bottom of the rail
    if (railFill) {
      const railHeight = 100 + eased * 180;
      const railY = 316 - railHeight;
      railFill.setAttribute('y', railY);
      railFill.setAttribute('height', railHeight);
    }

    requestAnimationFrame(animationFrame);
  }


  /* -----------------------------------------------------------------------
     4. START / FALLBACK
  ----------------------------------------------------------------------- */
  if (!prefersReducedMotion) {
    requestAnimationFrame(animationFrame);
  } else if (pointsEl) {
    // static, representative value when motion is disabled
    pointsEl.textContent = '640';
  }

})();