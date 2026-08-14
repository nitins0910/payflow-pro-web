// ============================================================
// PayFlow Pro — Custom email verification handler
// Runs when the user clicks the link from the verification email.
// ============================================================

const statusIcon = document.getElementById('statusIcon');
const statusText = document.getElementById('statusText');
const continueBtn = document.getElementById('continueBtn');

continueBtn.onclick = () => { window.location.href = 'index.html'; };

(async () => {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const oobCode = params.get('oobCode');

  if (mode !== 'verifyEmail' || !oobCode) {
    statusIcon.textContent = '⚠️';
    statusText.textContent = 'This verification link looks invalid or incomplete.';
    continueBtn.classList.remove('hidden');
    return;
  }

  try {
    await auth.applyActionCode(oobCode);
    statusIcon.textContent = '✅';
    statusText.innerHTML = 'Your email has been verified successfully!<br>Redirecting you to login...';
    continueBtn.classList.remove('hidden');
    setTimeout(() => { window.location.href = 'index.html'; }, 2500);
  } catch (err) {
    statusIcon.textContent = '❌';
    if (err.code === 'auth/invalid-action-code') {
      statusText.textContent = 'This link has already been used or has expired. Please try signing in — if you\'re still unverified, request a new link from the login page.';
    } else {
      statusText.textContent = 'Could not verify your email: ' + err.message;
    }
    continueBtn.classList.remove('hidden');
  }
})();
