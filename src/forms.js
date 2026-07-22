/* =========================================================================
   LOCK21 — PETERBOROUGH LOCAL REWARDS
   JAVASCRIPT (src/forms.js)
   =========================================================================
   Shared by signup.html (customers) and business-signup.html (businesses).

   IMPORTANT: there is no backend behind this demo. Submitting either form
   does not send data anywhere or save it — it only validates the fields
   and swaps the form for a success message so the flow can be reviewed
   end-to-end. Wire up a real endpoint (fetch/POST) in handleSubmit()
   below when you're ready to connect this to something.

   Table of contents:
     1. initForm(formId, cardId) — wires one form up
     2. Run on whichever page we're on
   ========================================================================= */

(function () {

  /* -----------------------------------------------------------------------
     1. initForm
     formId — the <form> element's id
     cardId — the wrapping .form-card element's id (swapped out on success)
  ----------------------------------------------------------------------- */
  function initForm(formId, cardId) {
    const form = document.getElementById(formId);
    if (!form) return; // this page doesn't have this form — skip quietly

    const card = document.getElementById(cardId);
    const successPanel = card ? card.querySelector('.form-success') : null;

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      // Use the browser's built-in validation (required, type="email", etc.)
      // and show its native messages if something's missing/invalid.
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      handleSubmit(form);
    });
  }

  /* -----------------------------------------------------------------------
     handleSubmit — called once the form passes validation.
     Replace the body of this function with a real fetch(...) call to your
     backend when one exists. For now it just reveals the success panel.
  ----------------------------------------------------------------------- */
  function handleSubmit(form) {
    const card = form.closest('.form-card');
    const successPanel = card ? card.querySelector('.form-success') : null;

    form.style.display = 'none';
    if (successPanel) successPanel.classList.add('show');
  }


  /* -----------------------------------------------------------------------
     2. RUN ON WHICHEVER PAGE WE'RE ON
     Both calls are safe on every page — initForm() bails out quietly if
     the form it's looking for isn't present.
  ----------------------------------------------------------------------- */
  initForm('customerSignupForm', 'customerFormCard');
  initForm('businessSignupForm', 'businessFormCard');

})();