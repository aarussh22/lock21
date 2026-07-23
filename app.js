/* =========================================================================
   LOCK21 APP DEMO
   JAVASCRIPT (src/app.js)
   =========================================================================
   Front-end only, as requested — there is no backend yet:
     - "Sending" an SMS code just displays the demo code on-screen
       (see the banner on the OTP screen) instead of actually texting
       anyone. Swap sendCode() to call a real SMS API (e.g. Twilio Verify)
       later — the rest of the flow doesn't need to change.
     - The QR code is generated entirely in the browser from the phone
       number the person typed in, using a small hash so the same phone
       number always produces the same ID/QR in this demo. A real backend
       would instead issue a stable customer ID when the account is first
       created and just hand that back on every login.

   Table of contents:
     1. Demo data (points per business, promos, transaction history)
     2. State
     3. Screen navigation
     4. Step 1 — phone entry -> "send" code
     5. Step 2 — OTP input + verify
     6. Step 3 — first-time profile (name + city)
     7. Finish login -> populate Home/QR/Account, show tab bar
     8. QR generation
     9. Tab bar + logout
     10. Wire up events
   ========================================================================= */

(function () {

  /* -----------------------------------------------------------------------
     1. DEMO DATA
     Static, illustrative only — this is what a real backend would supply
     per logged-in customer.
  ----------------------------------------------------------------------- */
  const DEMO_POINTS_BY_BUSINESS = [
    { emoji: '☕', name: 'Jackson Creek Coffee', tag: 'Downtown · Café', points: 14 },
    { emoji: '🍺', name: 'Lock 21 Brewing Co.', tag: 'Ashburnham · Brewery', points: 7 },
    { emoji: '📚', name: 'Hunter St. Book Room', tag: 'Downtown · Books', points: 21, ready: true },
    { emoji: '🥐', name: 'Millbrook Bakehouse', tag: 'East City · Bakery', points: 0 },
  ];

  const DEMO_PROMOS = [
    { title: 'Double points this week', sub: 'Lock 21 Brewing Co.', distance: '0.3 km away' },
    { title: '10% off your next visit', sub: 'Riverside Flower Co.', distance: '0.6 km away' },
    { title: 'New: Del Crary Kitchen just joined', sub: 'Downtown · Restaurant', distance: '0.8 km away' },
  ];

  const DEMO_TRANSACTIONS = [
    { biz: 'Jackson Creek Coffee', date: 'Jul 21, 2026', points: '+7' },
    { biz: 'Hunter St. Book Room', date: 'Jul 18, 2026', points: '+7' },
    { biz: 'Hunter St. Book Room', date: 'Jul 14, 2026', points: 'Reward redeemed', reward: true },
    { biz: 'Lock 21 Brewing Co.', date: 'Jul 10, 2026', points: '+7' },
    { biz: 'Jackson Creek Coffee', date: 'Jul 6, 2026', points: '+7' },
  ];

  const DEMO_OTP_CODE = '123456';


  /* -----------------------------------------------------------------------
     2. STATE
     Lives only in memory for this demo session — nothing is saved
     between page loads, and nothing leaves the browser.
  ----------------------------------------------------------------------- */
  const state = {
    phone: '',
    name: '',
    city: '',
    customerId: '',
  };


  /* -----------------------------------------------------------------------
     3. SCREEN NAVIGATION
  ----------------------------------------------------------------------- */
  const screens = document.querySelectorAll('.app-screen');
  const tabBar = document.getElementById('tabBar');
  const tabButtons = document.querySelectorAll('.tab-btn');

  function showScreen(id) {
    screens.forEach((screen) => {
      screen.hidden = screen.id !== id;
    });
    tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.target === id);
    });
    const activeScreen = document.getElementById(id);
    if (activeScreen) activeScreen.scrollTop = 0;
  }


  /* -----------------------------------------------------------------------
     4. STEP 1 — PHONE ENTRY -> "SEND" CODE
  ----------------------------------------------------------------------- */
  const phoneForm = document.getElementById('phoneForm');
  const phoneInput = document.getElementById('phoneInput');
  const demoCodeBanner = document.getElementById('demoCodeBanner');

  if (phoneForm) {
    phoneForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!phoneForm.checkValidity()) {
        phoneForm.reportValidity();
        return;
      }
      state.phone = phoneInput.value.trim();
      if (demoCodeBanner) {
        demoCodeBanner.innerHTML =
          'Demo mode — no real SMS is sent. Enter code <b>' + DEMO_OTP_CODE + '</b> to continue.';
      }
      clearOtpBoxes();
      showScreen('screenOtp');
      focusFirstOtpBox();
    });
  }


  /* -----------------------------------------------------------------------
     5. STEP 2 — OTP INPUT + VERIFY
  ----------------------------------------------------------------------- */
  const otpBoxes = Array.from(document.querySelectorAll('.otp-box'));
  const otpErrorMsg = document.getElementById('otpErrorMsg');
  const otpForm = document.getElementById('otpForm');
  const resendBtn = document.getElementById('resendCodeBtn');

  function focusFirstOtpBox() {
    if (otpBoxes[0]) otpBoxes[0].focus();
  }

  function clearOtpBoxes() {
    otpBoxes.forEach((box) => {
      box.value = '';
      box.classList.remove('error');
    });
    if (otpErrorMsg) otpErrorMsg.textContent = '';
  }

  otpBoxes.forEach((box, index) => {
    box.addEventListener('input', function () {
      box.value = box.value.replace(/[^0-9]/g, '').slice(0, 1);
      box.classList.remove('error');
      if (box.value && otpBoxes[index + 1]) {
        otpBoxes[index + 1].focus();
      }
    });
    box.addEventListener('keydown', function (event) {
      if (event.key === 'Backspace' && !box.value && otpBoxes[index - 1]) {
        otpBoxes[index - 1].focus();
      }
    });
  });

  if (otpForm) {
    otpForm.addEventListener('submit', function (event) {
      event.preventDefault();
      const entered = otpBoxes.map((box) => box.value).join('');

      if (entered.length < 6) {
        showOtpError('Enter all 6 digits.');
        return;
      }

      if (entered !== DEMO_OTP_CODE) {
        showOtpError('That code doesn\u2019t match. Try ' + DEMO_OTP_CODE + ' for this demo.');
        return;
      }

      if (state.name) {
        finishLogin();
      } else {
        showScreen('screenProfile');
      }
    });
  }

  function showOtpError(message) {
    if (otpErrorMsg) otpErrorMsg.textContent = message;
    otpBoxes.forEach((box) => box.classList.add('error'));
  }

  if (resendBtn) {
    resendBtn.addEventListener('click', function () {
      clearOtpBoxes();
      focusFirstOtpBox();
      if (demoCodeBanner) {
        demoCodeBanner.innerHTML =
          'Demo mode — no real SMS is sent. Enter code <b>' + DEMO_OTP_CODE + '</b> to continue.';
      }
    });
  }


  /* -----------------------------------------------------------------------
     6. STEP 3 — FIRST-TIME PROFILE (name + city)
     Only shown once per session, the first time someone verifies a code.
  ----------------------------------------------------------------------- */
  const profileForm = document.getElementById('profileForm');
  const profileNameInput = document.getElementById('profileNameInput');
  const profileCityInput = document.getElementById('profileCityInput');

  if (profileForm) {
    profileForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!profileForm.checkValidity()) {
        profileForm.reportValidity();
        return;
      }
      state.name = profileNameInput.value.trim();
      state.city = profileCityInput.value;
      finishLogin();
    });
  }


  /* -----------------------------------------------------------------------
     7. FINISH LOGIN — populate Home/QR/Account, reveal the tab bar
  ----------------------------------------------------------------------- */
  function finishLogin() {
    state.customerId = phoneToCustomerId(state.phone);

    // -- Home screen --
    const homeGreeting = document.getElementById('homeGreeting');
    if (homeGreeting) homeGreeting.textContent = 'Hi, ' + firstNameOf(state.name);

    const totalPoints = DEMO_POINTS_BY_BUSINESS.reduce((sum, b) => sum + b.points, 0);
    const homeTotalPoints = document.getElementById('homeTotalPoints');
    if (homeTotalPoints) homeTotalPoints.textContent = totalPoints;

    renderBizPointsList();
    renderPromoList();
    renderTransactionList();

    // -- Account screen --
    setText('accountName', state.name || '—');
    setText('accountPhone', state.phone || '—');
    setText('accountCity', state.city || '—');
    setText('accountId', state.customerId);

    // -- QR screen --
    setText('qrName', state.name || 'Lock21 member');
    setText('qrId', state.customerId);
    renderQrCode();

    if (tabBar) tabBar.hidden = false;
    showScreen('screenHome');
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function firstNameOf(fullName) {
    if (!fullName) return 'there';
    return fullName.trim().split(/\s+/)[0];
  }

  function renderBizPointsList() {
    const list = document.getElementById('bizPointsList');
    if (!list) return;
    list.innerHTML = '';
    DEMO_POINTS_BY_BUSINESS.forEach((biz) => {
      const row = document.createElement('div');
      row.className = 'biz-points-card';
      row.innerHTML =
        '<div class="biz-info">' +
        '<div class="biz-emoji">' + biz.emoji + '</div>' +
        '<div><div class="biz-name">' + biz.name + '</div>' +
        '<div class="biz-tag">' + biz.tag + '</div></div>' +
        '</div>' +
        '<div class="biz-points' + (biz.ready ? ' ready' : '') + '">' +
        (biz.ready ? 'Reward ready' : biz.points + ' / 21') +
        '</div>';
      list.appendChild(row);
    });
  }

  function renderPromoList() {
    const list = document.getElementById('promoList');
    if (!list) return;
    list.innerHTML = '';
    DEMO_PROMOS.forEach((promo) => {
      const card = document.createElement('div');
      card.className = 'promo-card';
      card.innerHTML =
        '<div class="promo-title">' + promo.title + '</div>' +
        '<div class="promo-sub">' + promo.sub + '</div>' +
        '<div class="promo-distance">' + promo.distance + '</div>';
      list.appendChild(card);
    });
  }

  function renderTransactionList() {
    const list = document.getElementById('txnList');
    if (!list) return;
    list.innerHTML = '';
    DEMO_TRANSACTIONS.forEach((txn) => {
      const row = document.createElement('div');
      row.className = 'txn-row';
      row.innerHTML =
        '<div class="txn-main"><div class="txn-biz">' + txn.biz + '</div>' +
        '<div class="txn-date">' + txn.date + '</div></div>' +
        '<div class="txn-points' + (txn.reward ? ' reward' : '') + '">' + txn.points + '</div>';
      list.appendChild(row);
    });
  }


  /* -----------------------------------------------------------------------
     8. QR GENERATION
     phoneToCustomerId() is a simple deterministic hash — same phone
     number always yields the same demo ID/QR. A real backend would
     assign this once, in a database, when the account is created.
  ----------------------------------------------------------------------- */
  function phoneToCustomerId(phone) {
    const digits = (phone || '').replace(/\D/g, '') || '0000000000';
    let hash = 0;
    for (let i = 0; i < digits.length; i++) {
      hash = (hash * 31 + digits.charCodeAt(i)) >>> 0;
    }
    const idNum = (hash % 900000) + 100000; // always a 6-digit number
    return 'LK-' + idNum;
  }

  function renderQrCode() {
    const container = document.getElementById('qrCodeContainer');
    if (!container) return;
    container.innerHTML = '';

    const payload = 'https://lock21.app/c/' + state.customerId; // placeholder URL — illustrative only

    if (typeof QRCode !== 'undefined') {
      new QRCode(container, {
        text: payload,
        width: 176,
        height: 176,
        colorDark: '#0E74B8',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
    } else {
      // Fallback if the QR library didn't load (e.g. no internet access)
      container.textContent = state.customerId;
    }
  }


  /* -----------------------------------------------------------------------
     9. TAB BAR + LOGOUT
  ----------------------------------------------------------------------- */
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', function () {
      showScreen(btn.dataset.target);
    });
  });

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      state.phone = '';
      state.name = '';
      state.city = '';
      state.customerId = '';
      if (phoneInput) phoneInput.value = '';
      if (profileNameInput) profileNameInput.value = '';
      if (profileCityInput) profileCityInput.value = '';
      clearOtpBoxes();
      if (tabBar) tabBar.hidden = true;
      showScreen('screenLogin');
    });
  }


  /* -----------------------------------------------------------------------
     10. WIRE UP EVENTS — nothing further needed; everything above is
     already listening. Show the login screen as the starting point.
  ----------------------------------------------------------------------- */
  showScreen('screenLogin');

})();