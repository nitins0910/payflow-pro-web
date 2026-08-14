// ============================================================
// PayFlow Pro — Single-file app
// (Firebase config + Firestore API + Auth + Email Verification + Dashboard)
// ============================================================

// ---------------------------------------------------------
// 1. FIREBASE CONFIG
// These values are PUBLIC and safe to have in client code —
// real security is enforced by Firestore rules + Firebase Auth.
// ---------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyC17VDG73Klmg8IwCA_cTbtMdIG9trwd5k",
  authDomain: "payflow-pro-4070a.firebaseapp.com",
  projectId: "payflow-pro-4070a",
  storageBucket: "payflow-pro-4070a.firebasestorage.app",
  messagingSenderId: "769845474274",
  appId: "1:769845474274:web:0c2c6fd093ccd41715bfbb"
};

firebase.initializeApp(firebaseConfig);

// ---------------------------------------------------------
// 1b. APP CHECK — blocks scripted / bot signups & requests
// that don't come from this real web app, so someone can't
// just hammer createUserWithEmailAndPassword in a loop and
// burn through the free Firebase quota.
//
// SETUP REQUIRED (one-time, in Firebase Console):
//   1. Console → Build → App Check → Apps → register this web app
//      with the "reCAPTCHA v3" provider.
//   2. Copy the site key it gives you and paste it below in place
//      of "PASTE_YOUR_RECAPTCHA_V3_SITE_KEY_HERE".
//   3. Console → App Check → APIs tab → mark "Firestore" and
//      "Authentication" as Enforced (not just Monitored).
// Until you do this, App Check runs in a harmless no-op state —
// it does NOT block anything on its own.
// ---------------------------------------------------------
const RECAPTCHA_V3_SITE_KEY = "6LcGm4UtAAAAAE6U6J4olvwUW4RDKVcJ0cHTMZ54";
if (RECAPTCHA_V3_SITE_KEY && RECAPTCHA_V3_SITE_KEY.indexOf("PASTE_YOUR") !== 0) {
  firebase.appCheck().activate(
    new firebase.appCheck.ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
    true // auto-refresh the token
  );
} else {
  console.warn('[App Check] Not activated — RECAPTCHA_V3_SITE_KEY is still a placeholder. Signups are NOT yet protected from bot abuse. See comment above.');
}

const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// SESSION persistence: the sign-in is only kept for the current browser tab.
// Closing the tab or the whole browser clears it, so the next visit lands
// back on the sign-in screen instead of staying logged in indefinitely
// (the previous default, LOCAL persistence, survived browser restarts).
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(err => {
  console.warn('[Auth] Could not set session persistence:', err.message);
});

// IMPORTANT: this must be your real, live Firebase Hosting URL
// (or custom domain once you attach one). It's what makes the
// verification email link open THIS app instead of Firebase's
// generic default page.
const SITE_URL = "https://nitins0910.github.io/payflow-pro-web/";
const actionCodeSettings = { url: SITE_URL, handleCodeInApp: true };

// ---------------------------------------------------------
// 2. FIRESTORE DATA LAYER (unchanged from firestore-api.js)
// ---------------------------------------------------------
let currentUserId = null;

async function initUserContext(uid) {
  currentUserId = uid;
}

function userRef() {
  return db.collection('users').doc(currentUserId);
}

const Api = {
  async getEmployees() {
    const snap = await userRef().collection('employees').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async addEmployee(emp) {
    const existing = await userRef().collection('employees')
      .where('accountNumber', '==', emp.accountNumber).limit(1).get();
    if (!existing.empty) throw new Error(`Account ${emp.accountNumber} already exists.`);
    await userRef().collection('employees').add({
      ...emp, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },
  async updateEmployee(id, emp) {
    await userRef().collection('employees').doc(id).set({
      ...emp, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  },
  async deleteEmployee(id) {
    await userRef().collection('employees').doc(id).delete();
  },
  async bulkAddEmployees(rows) {
    let batch = db.batch();
    let count = 0;
    for (const r of rows) {
      const ref = userRef().collection('employees').doc();
      batch.set(ref, { ...r, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      count++;
      if (count === 450) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
  },
  async getCompanyProfile() {
    const doc = await userRef().get();
    const d = doc.exists ? doc.data() : {};
    return {
      name: d.companyName || '',
      accountNumber: d.accountNumber || '',
      sysId: d.sysId || ''
    };
  },
  async updateCompanyProfile({ name, accountNumber, sysId }) {
    await userRef().set({
      companyName: name, accountNumber, sysId,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  },
  async getAndIncrementCounter() {
    const counterRef = userRef().collection('meta').doc('fileCounter');
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists ? (snap.data().value || 1) : 1;
      tx.set(counterRef, { value: current + 1 }, { merge: true });
      return `A${String(current).padStart(2, '0')}`;
    });
  },
  async addDisbursementRows(rows) {
    let batch = db.batch();
    rows.forEach(r => {
      const ref = userRef().collection('disbursements').doc();
      batch.set(ref, { ...r, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    await batch.commit();
  },
  async getDisbursementHistory() {
    const snap = await userRef().collection('disbursements').orderBy('createdAt', 'desc').limit(500).get();
    return snap.docs.map(d => d.data());
  },
  async logAudit(userEmail, userName, action, details) {
    await userRef().collection('auditTrail').add({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      userEmail, userName, action, details
    });
  },
  async getAuditTrail() {
    const snap = await userRef().collection('auditTrail').orderBy('timestamp', 'desc').limit(300).get();
    return snap.docs.map(d => d.data());
  }
};

// ---------------------------------------------------------
// 2b. HTML ESCAPING
// Any user-entered value (employee name, audit details, etc.) that
// gets inserted via innerHTML/template strings MUST go through this
// first, or a value like <img src=x onerror=...> in a name field
// would execute as script instead of displaying as text.
// ---------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// ---------------------------------------------------------
// 3. SCREEN ROUTER
// Only one of these top-level screens is visible at a time.
// ---------------------------------------------------------
const SCREENS = ['auth', 'verify-pending', 'verifying', 'reset-password', 'complete-profile', 'dashboard'];
function showScreen(name) {
  SCREENS.forEach(s => {
    document.getElementById('screen-' + s).classList.toggle('hidden', s !== name);
  });
}

// ---------------------------------------------------------
// 4. FRIENDLY ERROR MESSAGES
// ---------------------------------------------------------
function mapAuthError(err) {
  const map = {
    'auth/email-already-in-use': 'This email is already registered. Try signing in instead.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password should be at least 8 characters.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/user-not-found': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was closed before completing.',
    'auth/requires-recent-login': 'For your security, please re-enter your current password to confirm this change.',
    'auth/email-already-exists': 'That email is already in use by another account.',
    'auth/invalid-phone-number': 'Please enter a valid phone number with country code, e.g. +91XXXXXXXXXX.',
    'auth/invalid-verification-code': 'That verification code is incorrect.',
    'auth/code-expired': 'That verification code has expired. Please request a new one.',
    'auth/missing-verification-code': 'Please enter the code sent to your phone.',
  };
  return map[err.code] || err.message;
}

function showAuthError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = msg;
  box.classList.add('show');
}
function clearAuthError() {
  const box = document.getElementById('errorBox');
  box.textContent = '';
  box.classList.remove('show');
}
function showAuthSuccess(msg) {
  const box = document.getElementById('successBox');
  box.textContent = msg;
  box.classList.add('show');
}
function clearAuthSuccess() {
  const box = document.getElementById('successBox');
  box.textContent = '';
  box.classList.remove('show');
}

// ---------------------------------------------------------
// 4b. PASSWORD SHOW/HIDE TOGGLE (works for any .pw-toggle button
// paired with an input via data-target, on any screen — login,
// signup, and later the Settings page).
// ---------------------------------------------------------
function wirePasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.classList.toggle('is-visible', !showing);
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });
}

// Always land on the LOGIN form (not signup) whenever we route back
// to the auth screen — fixes "stuck on signup form" after verifying
// email, logging out, or clicking "use a different account".
function goToAuthScreen() {
  clearAuthError();
  clearAuthSuccess();
  document.getElementById('signupForm').classList.add('hidden');
  document.getElementById('forgotPasswordForm').classList.add('hidden');
  document.getElementById('forgotPwInstructions').classList.remove('hidden');
  document.getElementById('forgotEmailField').classList.remove('hidden');
  document.getElementById('forgotSubmitBtn').classList.remove('hidden');
  document.getElementById('forgotSendAgainRow').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
  document.getElementById('switchModeWrap').classList.remove('hidden');
  document.getElementById('authDivider').classList.remove('hidden');
  document.getElementById('googleBtn').classList.remove('hidden');
  document.getElementById('switchToLoginWrap').classList.add('hidden');
  document.getElementById('switchToSignupWrap').classList.remove('hidden');
  showScreen('auth');
}

// ---------------------------------------------------------
// 5. AUTH SCREEN (login / signup / google)
// ---------------------------------------------------------
function wireAuthForms() {
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const switchToSignup = document.getElementById('switchToSignup');
  const switchToLogin = document.getElementById('switchToLogin');

  switchToSignup.onclick = () => {
    clearAuthError(); clearAuthSuccess();
    loginForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
    document.getElementById('switchToSignupWrap').classList.add('hidden');
    document.getElementById('switchToLoginWrap').classList.remove('hidden');
  };
  switchToLogin.onclick = () => {
    clearAuthError(); clearAuthSuccess();
    signupForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    document.getElementById('switchToLoginWrap').classList.add('hidden');
    document.getElementById('switchToSignupWrap').classList.remove('hidden');
  };

  // ---- Forgot password ----
  const forgotForm = document.getElementById('forgotPasswordForm');
  function resetForgotFormVisibility() {
    document.getElementById('forgotPwInstructions').classList.remove('hidden');
    document.getElementById('forgotEmailField').classList.remove('hidden');
    document.getElementById('forgotSubmitBtn').classList.remove('hidden');
    document.getElementById('forgotSendAgainRow').classList.add('hidden');
  }
  function hideForgotFormAfterSend() {
    document.getElementById('forgotPwInstructions').classList.add('hidden');
    document.getElementById('forgotEmailField').classList.add('hidden');
    document.getElementById('forgotSubmitBtn').classList.add('hidden');
    document.getElementById('forgotSendAgainRow').classList.remove('hidden');
  }
  document.getElementById('forgotPasswordLink').onclick = () => {
    clearAuthError(); clearAuthSuccess();
    resetForgotFormVisibility();
    loginForm.classList.add('hidden');
    forgotForm.classList.remove('hidden');
    document.getElementById('switchModeWrap').classList.add('hidden');
    document.getElementById('authDivider').classList.add('hidden');
    document.getElementById('googleBtn').classList.add('hidden');
    document.getElementById('forgotEmail').value = document.getElementById('loginEmail').value || '';
  };
  document.getElementById('forgotBackBtn').onclick = () => {
    clearAuthError(); clearAuthSuccess();
    forgotForm.reset();
    resetForgotFormVisibility();
    forgotForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    document.getElementById('switchModeWrap').classList.remove('hidden');
    document.getElementById('authDivider').classList.remove('hidden');
    document.getElementById('googleBtn').classList.remove('hidden');
  };
  document.getElementById('forgotSendAgainBtn').onclick = () => {
    clearAuthSuccess();
    resetForgotFormVisibility();
    document.getElementById('forgotEmail').focus();
  };
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError(); clearAuthSuccess();
    const btn = document.getElementById('forgotSubmitBtn');
    const email = document.getElementById('forgotEmail').value.trim();
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      await auth.sendPasswordResetEmail(email, actionCodeSettings);
      // Same message whether or not the account exists — avoids
      // leaking which emails are registered.
      showAuthSuccess('If an account exists for that email, a password reset link is on its way. Check your spam folder too.');
      forgotForm.reset();
      hideForgotFormAfterSend();
    } catch (err) {
      if (err.code === 'auth/invalid-email') {
        showAuthError(mapAuthError(err));
      } else {
        // Still show the generic success message for anything else
        // (e.g. user-not-found) so we don't reveal account existence.
        showAuthSuccess('If an account exists for that email, a password reset link is on its way. Check your spam folder too.');
        forgotForm.reset();
        hideForgotFormAfterSend();
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Send Reset Link';
    }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError();
    const btn = document.getElementById('loginBtn');
    btn.disabled = true; btn.textContent = 'Signing in...';
    try {
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      await auth.signInWithEmailAndPassword(email, password);
      // routeUser() fires automatically via onAuthStateChanged
    } catch (err) {
      showAuthError(mapAuthError(err));
    } finally {
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError();
    const btn = document.getElementById('signupBtn');
    btn.disabled = true; btn.textContent = 'Creating account...';
    try {
      const name = document.getElementById('signupName').value.trim();
      const email = document.getElementById('signupEmail').value.trim();
      const password = document.getElementById('signupPassword').value;
      const passwordConfirm = document.getElementById('signupPasswordConfirm').value;

      if (password !== passwordConfirm) {
        showAuthError('Passwords do not match.');
        return;
      }

      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: name });
      await cred.user.sendEmailVerification(actionCodeSettings);
      // Do NOT leave the user signed in unverified — sign out and
      // make them explicitly verify + log in. This is what fixes
      // "shows registered but isn't really".
      await auth.signOut();

      signupForm.reset();
      document.getElementById('verifyPendingEmail').textContent = email;
      showScreen('verify-pending');
    } catch (err) {
      showAuthError(mapAuthError(err));
    } finally {
      btn.disabled = false; btn.textContent = 'Create Account';
    }
  });

  document.getElementById('googleBtn').onclick = async () => {
    clearAuthError();
    try {
      suppressAutoRoute = true; // hold the router while we check if this is a new user
      const result = await auth.signInWithPopup(googleProvider);
      const isNewUser = result.additionalUserInfo && result.additionalUserInfo.isNewUser;
      if (isNewUser) {
        // New Google sign-ups: confirm/complete their full name before continuing.
        document.getElementById('googleNameInput').value = result.user.displayName || '';
        showScreen('complete-profile');
      } else {
        suppressAutoRoute = false;
        routeUser(result.user);
      }
    } catch (err) {
      suppressAutoRoute = false;
      showAuthError(mapAuthError(err));
    }
  };
}

// ---------------------------------------------------------
// 5b. COMPLETE PROFILE SCREEN (new Google sign-ups only)
// ---------------------------------------------------------
function wireCompleteProfileForm() {
  document.getElementById('completeProfileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('completeProfileBtn');
    const name = document.getElementById('googleNameInput').value.trim();
    if (!name) return;
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      await auth.currentUser.updateProfile({ displayName: name });
      suppressAutoRoute = false;
      routeUser(auth.currentUser);
    } catch (err) {
      alert('Could not save name: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Continue';
    }
  });
}

// ---------------------------------------------------------
// 6. "CHECK YOUR EMAIL" SCREEN (post-signup, pre-verification)
// ---------------------------------------------------------
let resendCooldown = false;
function wireVerifyPending() {
  document.getElementById('resendVerifyBtn').onclick = async () => {
    if (resendCooldown) return;
    const btn = document.getElementById('resendVerifyBtn');
    try {
      let user = auth.currentUser;
      if (!user) {
        alert('Please sign in again to resend the verification email.');
        showScreen('auth');
        return;
      }
      await user.sendEmailVerification(actionCodeSettings);
      resendCooldown = true;
      btn.textContent = 'Sent — check your inbox (and spam folder)';
      setTimeout(() => {
        resendCooldown = false;
        btn.textContent = 'Resend verification email';
      }, 60000);
    } catch (err) {
      alert('Could not resend: ' + mapAuthError(err));
    }
  };

  document.getElementById('verifyPendingRefreshBtn').onclick = async () => {
    const user = auth.currentUser;
    if (!user) { goToAuthScreen(); return; }
    await user.reload();
    routeUser(auth.currentUser);
  };

  document.getElementById('verifyPendingLogoutBtn').onclick = () => auth.signOut();
}

// ---------------------------------------------------------
// 7. VERIFICATION LINK HANDLER (?mode=verifyEmail&oobCode=...)
// This is what makes the link open THIS page's own UI instead
// of Firebase's generic default page.
// ---------------------------------------------------------
let suppressAutoRoute = false;

async function handleVerifyEmailAction(oobCode) {
  suppressAutoRoute = true;
  showScreen('verifying');
  const icon = document.getElementById('verifyIcon');
  const text = document.getElementById('verifyText');
  const btn = document.getElementById('verifyContinueBtn');

  try {
    await auth.applyActionCode(oobCode);
    icon.textContent = '✅';
    text.innerHTML = 'Your email has been verified!<br>You can now sign in.';
  } catch (err) {
    icon.textContent = '❌';
    if (err.code === 'auth/invalid-action-code') {
      text.textContent = 'This link has expired or was already used. Please sign in — if you\'re still unverified, request a new link from the login page.';
    } else {
      text.textContent = 'Could not verify your email: ' + err.message;
    }
  }

  // Clean the ?mode=&oobCode= out of the URL so a refresh doesn't re-trigger it.
  history.replaceState({}, '', window.location.pathname);
  btn.classList.remove('hidden');
  btn.onclick = async () => {
    if (auth.currentUser) await auth.signOut();
    suppressAutoRoute = false;
    goToAuthScreen();
  };
}

// ---------------------------------------------------------
// 7b. PASSWORD RESET LINK HANDLER (?mode=resetPassword&oobCode=...)
// Without this, clicking the reset-password email link just lands
// back on the normal auth screen with no way to actually set a new
// password — this is what shows the "new password" form instead.
// ---------------------------------------------------------
async function handleResetPasswordAction(oobCode) {
  suppressAutoRoute = true;
  showScreen('reset-password');

  const checkingMsg = document.getElementById('resetPwCheckingMsg');
  const form = document.getElementById('resetPasswordForm');
  const backBtn = document.getElementById('resetPwBackToSignInBtn');
  const errBox = document.getElementById('resetPwErrorBox');
  const okBox = document.getElementById('resetPwSuccessBox');

  let email;
  try {
    email = await auth.verifyPasswordResetCode(oobCode);
  } catch (err) {
    checkingMsg.classList.add('hidden');
    errBox.textContent = err.code === 'auth/invalid-action-code'
      ? 'This reset link has expired or was already used. Please request a new one from the sign-in page.'
      : mapAuthError(err);
    errBox.classList.add('show');
    backBtn.classList.remove('hidden');
    history.replaceState({}, '', window.location.pathname);
    return;
  }

  checkingMsg.classList.add('hidden');
  document.getElementById('resetPwEmail').textContent = email;
  form.classList.remove('hidden');
  history.replaceState({}, '', window.location.pathname);

  form.addEventListener('submit', async function onSubmit(e) {
    e.preventDefault();
    errBox.classList.remove('show'); errBox.textContent = '';
    const newPw = document.getElementById('resetPwNew').value;
    const confirmPw = document.getElementById('resetPwConfirm').value;
    if (newPw !== confirmPw) {
      errBox.textContent = 'Passwords do not match.';
      errBox.classList.add('show');
      return;
    }
    const btn = document.getElementById('resetPwSubmitBtn');
    btn.disabled = true; btn.textContent = 'Setting password...';
    try {
      await auth.confirmPasswordReset(oobCode, newPw);
      form.classList.add('hidden');
      okBox.textContent = 'Password updated. You can now sign in with your new password.';
      okBox.classList.add('show');
      backBtn.classList.remove('hidden');
      form.removeEventListener('submit', onSubmit);
    } catch (err) {
      errBox.textContent = err.code === 'auth/invalid-action-code'
        ? 'This reset link has expired or was already used. Please request a new one from the sign-in page.'
        : mapAuthError(err);
      errBox.classList.add('show');
    } finally {
      btn.disabled = false; btn.textContent = 'Set New Password';
    }
  }, { once: true });

  backBtn.onclick = () => {
    suppressAutoRoute = false;
    goToAuthScreen();
  };
}

// ---------------------------------------------------------
// 8. ROUTER — decides which screen to show based on auth state
// ---------------------------------------------------------
function routeUser(user) {
  if (suppressAutoRoute) return; // we're busy handling a verification link
  if (!user) { goToAuthScreen(); return; }

  if (!user.emailVerified) {
    // This is the key fix: unverified users never reach the dashboard.
    document.getElementById('verifyPendingEmail').textContent = user.email;
    showScreen('verify-pending');
    return;
  }

  showScreen('dashboard');
  bootDashboard(user);
}

// ---------------------------------------------------------
// 9. BOOT SEQUENCE
// ---------------------------------------------------------
wireAuthForms();
wireVerifyPending();
wireCompleteProfileForm();
wirePasswordToggles();

(function boot() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const oobCode = params.get('oobCode');
  if (mode === 'verifyEmail' && oobCode) {
    handleVerifyEmailAction(oobCode);
  } else if (mode === 'resetPassword' && oobCode) {
    handleResetPasswordAction(oobCode);
  }
  auth.onAuthStateChanged(routeUser);
})();

// ---------------------------------------------------------
// 10. DASHBOARD (unchanged logic from dashboard.js, wrapped so it
//     boots only once verification is confirmed)
// ---------------------------------------------------------
let employees = [];
let editingEmployeeId = null;
let salaryInputs = {};
let companyProfile = { name: '', accountNumber: '', sysId: '' };
let dashboardBooted = false;
let currentUser = null;

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function formatDateDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

async function bootDashboard(user) {
  currentUser = user;
  document.getElementById('userName').textContent = user.displayName || 'PayFlow User';
  document.getElementById('userEmail').textContent = user.email;

  try {
    await initUserContext(user.uid);
  } catch (err) {
    alert('Could not load your account: ' + err.message);
    return;
  }

  populateMonthYear();
  await Promise.all([loadEmployees(), loadCompanyProfile()]);

  if (!dashboardBooted) {
    dashboardBooted = true;
    wireNav();
    wireEmployeeForm();
    wireBulkImport();
    wireDisbursement();
    wireAudit();
    wireCompanyForm();
    wireSettingsForms();
    wirePasswordToggles();
    document.getElementById('logoutBtn').onclick = () => auth.signOut();
    document.getElementById('employeeSearch').addEventListener('input', renderEmployeeTable);
  }
}

function wireNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('#screen-dashboard main > section').forEach(s => s.classList.add('hidden'));
      document.getElementById('page-' + item.dataset.page).classList.remove('hidden');
      if (item.dataset.page === 'audit') loadAuditTrail();
    });
  });
}

async function loadEmployees() {
  const tbody = document.getElementById('employeeTableBody');
  try {
    employees = await Api.getEmployees();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--danger);">Could not load employees: ${escapeHtml(err.message)}</td></tr>`;
    return;
  }
  renderEmployeeTable();
  renderDisbursementList();
}

// Bank account numbers are sensitive — mask them on screen by
// default (last 4 digits only) with a click-to-reveal toggle, so
// they aren't sitting in plain view on a shared screen or during
// a screen-share.
function maskAccount(acc) {
  const s = String(acc || '');
  if (s.length <= 4) return s;
  return '•'.repeat(s.length - 4) + s.slice(-4);
}
function wireMaskedAccountToggles(container) {
  container.querySelectorAll('.masked-acc button').forEach(btn => {
    btn.onclick = () => {
      const span = btn.previousElementSibling;
      const revealed = span.dataset.revealed === '1';
      span.textContent = revealed ? maskAccount(span.dataset.full) : span.dataset.full;
      span.dataset.revealed = revealed ? '0' : '1';
      btn.textContent = revealed ? 'Show' : 'Hide';
    };
  });
}

function renderEmployeeTable() {
  const tbody = document.getElementById('employeeTableBody');
  const emptyState = document.getElementById('employeeEmptyState');
  const query = (document.getElementById('employeeSearch').value || '').trim().toLowerCase();

  const filtered = employees.filter(e =>
    !query || e.name.toLowerCase().includes(query) || String(e.accountNumber).includes(query));

  tbody.innerHTML = '';
  if (!filtered.length) { emptyState.classList.remove('hidden'); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(emp => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(emp.name)}</td>
      <td><span class="masked-acc"><span data-full="${escapeHtml(emp.accountNumber)}" data-revealed="0">${escapeHtml(maskAccount(emp.accountNumber))}</span><button type="button">Show</button></span></td>
      <td>${escapeHtml(emp.ifsc)}</td>
      <td>${escapeHtml(emp.transferType)}</td>
      <td>${escapeHtml(emp.empCode)}</td>
      <td class="row-actions">
        <button data-edit="${escapeHtml(emp.id)}">Edit</button>
        <button data-delete="${escapeHtml(emp.id)}" class="danger">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openEditModal(btn.dataset.edit));
  tbody.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => handleDelete(btn.dataset.delete));
  wireMaskedAccountToggles(tbody);
}

// ---------------------------------------------------------
// Employee form helpers — mirror the desktop app's field-level
// behaviour exactly: name parts are split/joined the same way,
// account/IFSC fields block spaces & paste, name/IFSC fields
// auto-uppercase as you type, and duplicate/mismatch checks are
// evaluated live on every keystroke, not just on submit.
// ---------------------------------------------------------
function splitFullNameParts(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ['', '', ''];
  if (parts.length === 1) return [parts[0], '', ''];
  if (parts.length === 2) return [parts[0], '', parts[1]];
  return [parts[0], parts.slice(1, -1).join(' '), parts[parts.length - 1]];
}

function blockSpaceKey(el) {
  el.addEventListener('keydown', (e) => { if (e.key === ' ') e.preventDefault(); });
}
function blockPasteAndRightClick(el) {
  el.addEventListener('paste', (e) => e.preventDefault());
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
function autoUpperCaseLive(el) {
  el.addEventListener('input', () => {
    const pos = el.selectionStart;
    const upper = el.value.toUpperCase();
    if (upper !== el.value) {
      el.value = upper;
      try { el.setSelectionRange(pos, pos); } catch (_) {}
    }
  });
}

function wireEmployeeForm() {
  const modal = document.getElementById('employeeModal');
  const employeeForm = document.getElementById('employeeForm');
  const errBox = document.getElementById('employeeFormError');

  const fFirst  = document.getElementById('empFirstName');
  const fMiddle = document.getElementById('empMiddleName');
  const fLast   = document.getElementById('empLastName');
  const fCode   = document.getElementById('empCode');
  const fType   = document.getElementById('empTransferType');
  const fAcc    = document.getElementById('empAccount');
  const fAccC   = document.getElementById('empAccountConfirm');
  const fIfsc   = document.getElementById('empIfsc');
  const fIfscC  = document.getElementById('empIfscConfirm');
  const accMismatchLbl  = document.getElementById('accMismatchLbl');
  const ifscMismatchLbl = document.getElementById('ifscMismatchLbl');

  // Name fields: no spaces within a single box, auto-uppercase as-you-type
  [fFirst, fMiddle, fLast].forEach(el => { blockSpaceKey(el); autoUpperCaseLive(el); });
  // Emp code: no spaces
  blockSpaceKey(fCode);
  // Account / IFSC pairs: no spaces, no paste/right-click paste
  [fAcc, fAccC, fIfsc, fIfscC].forEach(el => { blockSpaceKey(el); blockPasteAndRightClick(el); });
  // IFSC fields auto-uppercase as-you-type
  [fIfsc, fIfscC].forEach(el => autoUpperCaseLive(el));

  function clearMatchStyles(el) {
    el.classList.remove('input-mismatch', 'input-match');
  }

  function showFieldError(msg) {
    errBox.textContent = msg;
    errBox.classList.add('show');
  }
  function clearFieldError() {
    errBox.textContent = '';
    errBox.classList.remove('show');
  }

  function existingAccountNumbers() {
    return employees
      .filter(e => e.id !== editingEmployeeId)
      .map(e => String(e.accountNumber));
  }

  function validateLive() {
    const accVal = fAcc.value.trim();
    const isDuplicate = accVal && existingAccountNumbers().includes(accVal);

    if (isDuplicate) {
      clearMatchStyles(fAcc);
      fAcc.classList.add('input-mismatch');
      accMismatchLbl.textContent = '⚠ DUPLICATE ACC';
    } else {
      clearMatchStyles(fAcc);
    }

    function checkPair(primeEl, confEl, lbl, skip) {
      if (skip) return;
      const prime = primeEl.value.trim();
      const conf = confEl.value.trim();
      clearMatchStyles(confEl);
      if (conf) {
        if (prime !== conf) {
          confEl.classList.add('input-mismatch');
          lbl.textContent = 'MISMATCH';
        } else {
          confEl.classList.add('input-match');
          lbl.textContent = '';
        }
      } else {
        lbl.textContent = '';
      }
    }
    checkPair(fAcc, fAccC, accMismatchLbl, isDuplicate);
    checkPair(fIfsc, fIfscC, ifscMismatchLbl, false);
  }
  [fAcc, fAccC, fIfsc, fIfscC].forEach(el => el.addEventListener('input', validateLive));

  function resetForm() {
    employeeForm.reset();
    [fAcc, fAccC, fIfsc, fIfscC].forEach(clearMatchStyles);
    accMismatchLbl.textContent = '';
    ifscMismatchLbl.textContent = '';
    clearFieldError();
    fType.value = 'Same Bank';
  }

  document.getElementById('addEmployeeBtn').onclick = () => {
    editingEmployeeId = null;
    document.getElementById('modalTitle').textContent = 'Add Employee';
    resetForm();
    modal.classList.remove('hidden');
    fFirst.focus();
  };
  document.getElementById('cancelModalBtn').onclick = () => modal.classList.add('hidden');

  window.openEditModal = (id) => {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    editingEmployeeId = id;
    document.getElementById('modalTitle').textContent = 'Edit Employee Record';
    resetForm();
    const [first, middle, last] = splitFullNameParts(emp.name);
    fFirst.value = first;
    fMiddle.value = middle;
    fLast.value = last;
    fAcc.value = emp.accountNumber;
    fAccC.value = emp.accountNumber;
    fIfsc.value = emp.ifsc;
    fIfscC.value = emp.ifsc;
    fCode.value = emp.empCode;
    fType.value = emp.transferType;
    modal.classList.remove('hidden');
  };

  employeeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldError();

    const fname  = fFirst.value.trim();
    const mname  = fMiddle.value.trim();
    const lname  = fLast.value.trim();
    const acc    = fAcc.value.trim().replace(/\s+/g, '');
    const accC   = fAccC.value.trim().replace(/\s+/g, '');
    const ifsc   = fIfsc.value.trim().replace(/\s+/g, '').toUpperCase();
    const ifscC  = fIfscC.value.trim().replace(/\s+/g, '').toUpperCase();
    const empCode = fCode.value.trim().padStart(2, '0');
    const transferType = fType.value;

    // Required-field check — Middle Name is the sole optional field.
    if (!(fname && lname && acc && accC && ifsc && ifscC && empCode)) {
      showFieldError('Fill all database entry boxes completely before committing. (Middle Name is optional)');
      return;
    }
    // Double-entry verification for Account Number and IFSC.
    if (acc !== accC || ifsc !== ifscC) {
      showFieldError('Verification Error: Double-entry field mismatch detected.');
      return;
    }

    const nameParts = [fname];
    if (mname) nameParts.push(mname);
    nameParts.push(lname);
    const fullName = nameParts.join(' ').toUpperCase();

    // Duplicate account-number check, excluding the record currently being edited.
    if (existingAccountNumbers().includes(acc)) {
      showFieldError(`Duplicate Error: Account number ${acc} is already explicitly assigned inside ledger.`);
      return;
    }

    const emp = { name: fullName, accountNumber: acc, ifsc, empCode, transferType };

    const btn = document.getElementById('saveEmployeeBtn');
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      if (editingEmployeeId) {
        await Api.updateEmployee(editingEmployeeId, emp);
        await Api.logAudit(currentUser.email, currentUser.displayName, 'EDIT EMPLOYEE',
          `${emp.name} | Acc: ${emp.accountNumber} | IFSC: ${emp.ifsc} | Type: ${emp.transferType}`);
      } else {
        await Api.addEmployee(emp);
        await Api.logAudit(currentUser.email, currentUser.displayName, 'ADD EMPLOYEE',
          `${emp.name} | Acc: ${emp.accountNumber} | IFSC: ${emp.ifsc} | Type: ${emp.transferType}`);
      }
      modal.classList.add('hidden');
      await loadEmployees();
    } catch (err) {
      showFieldError('Save failed: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  });

  window.handleDelete = async (id) => {
    const emp = employees.find(e => e.id === id);
    if (!confirm(`Delete ${emp ? emp.name : id}? This cannot be undone.`)) return;
    try {
      await Api.deleteEmployee(id);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'DELETE EMPLOYEE',
        `Deleted: ${emp ? emp.name : ''} | Acc: ${emp ? emp.accountNumber : id}`);
      await loadEmployees();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };
}

function wireBulkImport() {
  const fileInput = document.getElementById('bulkImportInput');
  document.getElementById('bulkImportBtn').onclick = () => fileInput.click();

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) { alert('No valid rows found in CSV.'); return; }
    try {
      await Api.bulkAddEmployees(rows);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'BULK IMPORT', `${rows.length} employees imported`);
      await loadEmployees();
      alert(`Imported ${rows.length} employees.`);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    fileInput.value = '';
  });
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idxAcc  = headers.indexOf('account number');
  const idxIfsc = headers.indexOf('ifsc_branchcode');
  const idxName = headers.indexOf('employee name');
  const idxType = headers.indexOf('transfer type');
  const idxCode = headers.indexOf('emp code');

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const accountNumber = cols[idxAcc >= 0 ? idxAcc : 0] || '';
    const ifsc = (cols[idxIfsc >= 0 ? idxIfsc : 1] || '').toUpperCase();
    const name = (cols[idxName >= 0 ? idxName : 2] || '').toUpperCase();
    const transferType = cols[idxType >= 0 ? idxType : 3] || 'Same Bank';
    const empCode = (cols[idxCode >= 0 ? idxCode : 4] || '01').padStart(2, '0');
    if (accountNumber && name) out.push({ accountNumber, ifsc, name, transferType, empCode });
  }
  return out;
}

function populateMonthYear() {
  const monthSel = document.getElementById('disbMonth');
  const yearSel = document.getElementById('disbYear');
  const now = new Date();
  monthSel.innerHTML = MONTHS.map((m, i) => `<option value="${String(i+1).padStart(2,'0')}">${String(i+1).padStart(2,'0')} - ${m}</option>`).join('');
  monthSel.value = String(now.getMonth()+1).padStart(2,'0');
  const cy = now.getFullYear();
  yearSel.innerHTML = Array.from({length:11}, (_, i) => cy+i).map(y => `<option value="${y}">${y}</option>`).join('');
  yearSel.value = String(cy);

  // Transfer date defaults to today but is a real <input type="date">, so
  // the user can pick any date for the exported file instead of always
  // getting the current date.
  const dateInput = document.getElementById('disbDateDisplay');
  if (dateInput && !dateInput.value) {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth()+1).padStart(2,'0');
    const dd = String(now.getDate()).padStart(2,'0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  }
}

// Reads the user-selected transfer date (yyyy-mm-dd from the date input)
// and returns it formatted as dd/mm/yyyy for the export file. Falls back
// to today if nothing is selected yet.
function getSelectedTransferDate() {
  const raw = document.getElementById('disbDateDisplay').value;
  if (!raw) return formatDateDDMMYYYY(new Date());
  const [yyyy, mm, dd] = raw.split('-');
  return `${dd}/${mm}/${yyyy}`;
}

function validateLiveAmountEntry(inputEl, lightEl, warnEl) {
  const v = inputEl.value.trim();
  warnEl.textContent = '';
  inputEl.classList.remove('input-mismatch');
  if (!v) {
    lightEl.style.background = '#F43F5E';
    updateBatchTotal();
    return;
  }
  // Only digits and at most one decimal point are allowed — mirrors the
  // desktop app's character-by-character format check.
  let ok = true, dots = 0;
  for (const ch of v) {
    if (ch === '.') { dots += 1; ok = dots <= 1; }
    else if (!/[0-9]/.test(ch)) { ok = false; }
    if (!ok) break;
  }
  if (!ok) {
    lightEl.style.background = '#F43F5E';
    warnEl.textContent = '⚠ INVALID FORMAT';
  } else {
    const val = parseFloat(v);
    if (!isNaN(val) && val > 0) {
      lightEl.style.background = '#22C55E';
    } else {
      lightEl.style.background = '#F43F5E';
      warnEl.textContent = '⚠ MUST BE > 0';
    }
  }
  updateBatchTotal();
}

function renderDisbursementList() {
  const tbody = document.getElementById('disbTableBody');
  const emptyState = document.getElementById('disbEmptyState');
  if (!tbody) return;

  const tft = document.getElementById('disbTransferType').value;
  const query = (document.getElementById('disbSearch').value || '').trim().toLowerCase();

  salaryInputs = {};
  tbody.innerHTML = '';

  const filtered = employees.filter(e =>
    e.transferType === tft &&
    (!query || e.name.toLowerCase().includes(query) || String(e.accountNumber).includes(query) || String(e.empCode).includes(query)));

  if (!filtered.length) { emptyState.classList.remove('hidden'); updateBatchTotal(); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(emp => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(emp.empCode)}</td>
      <td>${escapeHtml(emp.name)}</td>
      <td><span class="masked-acc"><span data-full="${escapeHtml(emp.accountNumber)}" data-revealed="0">${escapeHtml(maskAccount(emp.accountNumber))}</span><button type="button">Show</button></span></td>
      <td style="text-align:right;">
        <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px;">
          <span style="font-size:10px; color:var(--danger); font-weight:700;" data-warn></span>
          <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#F43F5E;" data-light></span>
          <input type="text" data-acc="${escapeHtml(emp.accountNumber)}" placeholder="0.00"
            style="width:120px; text-align:right; background:var(--surface2); border:1px solid var(--border); color:var(--success); padding:6px 8px;">
        </div>
      </td>`;
    tbody.appendChild(tr);
    const inputEl = tr.querySelector('input');
    const lightEl = tr.querySelector('[data-light]');
    const warnEl  = tr.querySelector('[data-warn]');
    inputEl.addEventListener('input', () => validateLiveAmountEntry(inputEl, lightEl, warnEl));
    salaryInputs[emp.accountNumber] = { inputEl, name: emp.name, ifsc: emp.ifsc, empCode: emp.empCode };
  });
  wireMaskedAccountToggles(tbody);
  updateBatchTotal();
}

function updateBatchTotal() {
  let total = 0;
  Object.values(salaryInputs).forEach(md => {
    const v = parseFloat(md.inputEl.value);
    if (!isNaN(v)) total += v;
  });
  document.getElementById('disbTotal').textContent = `BATCH TOTAL ₹ ${total.toFixed(2)}`;
}

function wireDisbursement() {
  document.getElementById('disbTransferType').addEventListener('change', renderDisbursementList);
  document.getElementById('disbSearch').addEventListener('input', renderDisbursementList);
  document.getElementById('disbClearBtn').addEventListener('click', () => {
    document.querySelectorAll('#disbTableBody tr').forEach(tr => {
      const inputEl = tr.querySelector('input');
      const lightEl = tr.querySelector('[data-light]');
      const warnEl  = tr.querySelector('[data-warn]');
      if (inputEl) inputEl.value = '';
      if (lightEl) lightEl.style.background = '#F43F5E';
      if (warnEl)  warnEl.textContent = '';
    });
    updateBatchTotal();
  });
  document.getElementById('disbExportBtn').addEventListener('click', openExportPreview);
  document.getElementById('cancelExportBtn').addEventListener('click', () => {
    document.getElementById('exportPreviewModal').classList.add('hidden');
  });
  renderDisbursementList();
}

function collectBatchLines() {
  const tft = document.getElementById('disbTransferType').value;
  const lines = [];
  let total = 0, hasInvalid = false;
  for (const [acc, md] of Object.entries(salaryInputs)) {
    const raw = md.inputEl.value.trim();
    if (!raw) continue;
    const v = parseFloat(raw);
    if (isNaN(v)) { hasInvalid = true; continue; }
    if (v <= 0) continue;
    total += v;
    lines.push({ acc, empCode: md.empCode, name: md.name, ifsc: md.ifsc, amount: v });
  }
  return { tft, lines, total, hasInvalid };
}

function openExportPreview() {
  const { tft, lines, total, hasInvalid } = collectBatchLines();
  if (hasInvalid) { alert('Block Export Execution: Invalid amount format strings detected.'); return; }
  if (!lines.length) { alert('Execution blocked: No valid allocations found to process.'); return; }

  const monthRaw = document.getElementById('disbMonth').value;
  const monthName = MONTHS[parseInt(monthRaw,10)-1];
  const year = document.getElementById('disbYear').value;
  const dateInput = document.getElementById('disbDateDisplay');
  if (!dateInput.value) { alert('Please select a transfer date before exporting.'); return; }
  const txnDate = getSelectedTransferDate();

  document.getElementById('exportPreviewBody').innerHTML = `
    <p><strong>Transfer Type:</strong> ${escapeHtml(tft)}</p>
    <p><strong>Payroll Cycle:</strong> ${escapeHtml(monthName)} ${escapeHtml(year)}</p>
    <p><strong>Transfer Date:</strong> ${escapeHtml(txnDate)}</p>
    <p><strong>Employees:</strong> ${lines.length}</p>
    <p style="font-size:20px; color:var(--success); font-weight:700; margin-top:10px;">₹ ${total.toFixed(2)}</p>
  `;
  document.getElementById('exportPreviewModal').classList.remove('hidden');
  document.getElementById('confirmExportBtn').onclick = () => {
    document.getElementById('exportPreviewModal').classList.add('hidden');
    executeExport();
  };
}

async function executeExport() {
  const { tft, lines, total } = collectBatchLines();
  const prefix = tft === 'Same Bank' ? 'SBST' : 'OBST';
  const monthRaw = document.getElementById('disbMonth').value;
  const monthName = MONTHS[parseInt(monthRaw,10)-1];
  const year = document.getElementById('disbYear').value;
  const shortYear = year.slice(2);
  const txnDate = getSelectedTransferDate();

  let seq;
  try {
    seq = await Api.getAndIncrementCounter();
  } catch (err) {
    alert('Could not generate batch number: ' + err.message);
    return;
  }
  const batchId = `${prefix}${shortYear}${monthRaw}${seq}`;

  const empLines = [];
  const logRows = [];
  lines.forEach(({ acc, empCode, name, ifsc, amount }) => {
    const seqStr = `${prefix}${shortYear}${monthRaw}E${empCode}`;
    empLines.push(`${acc}#${ifsc}#${txnDate}##${amount.toFixed(2)}#${seqStr}#${name}#SALARY OF ${monthName} ${year}#`);
    logRows.push({ batchId, transferDate: txnDate, empCode, employeeName: name, accountNumber: acc, ifsc, amount: amount.toFixed(2), transferType: tft });
  });

  const header = `${companyProfile.accountNumber}#${companyProfile.sysId}#${txnDate}#${total.toFixed(2)}##${batchId}#${companyProfile.name}#SALARY OF ${monthName} ${year}#`;
  const output = [header, ...empLines].join('\n') + '\n';

  const fileName = `${prefix.toLowerCase()}_salary_${monthName}_${year}.txt`;
  downloadTextFile(fileName, output);

  try {
    await Api.addDisbursementRows(logRows);
    await Api.logAudit(currentUser.email, currentUser.displayName, 'EXPORT FILE',
      `Batch: ${batchId} | Type: ${tft} | Total: ₹${total.toFixed(2)} | Employees: ${empLines.length} | File: ${fileName}`);
  } catch (err) {
    alert('File downloaded, but logging to the ledger failed: ' + err.message);
  }
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

let auditRows = [];
function wireAudit() {
  document.getElementById('auditSearch').addEventListener('input', renderAuditTable);
}
async function loadAuditTrail() {
  try {
    auditRows = await Api.getAuditTrail();
  } catch (err) {
    document.getElementById('auditTableBody').innerHTML = `<tr><td colspan="4" style="color:var(--danger);">${escapeHtml(err.message)}</td></tr>`;
    return;
  }
  renderAuditTable();
}
function renderAuditTable() {
  const tbody = document.getElementById('auditTableBody');
  const emptyState = document.getElementById('auditEmptyState');
  const query = (document.getElementById('auditSearch').value || '').trim().toLowerCase();

  const filtered = auditRows.filter(r =>
    !query ||
    (r.userEmail||'').toLowerCase().includes(query) ||
    (r.action||'').toLowerCase().includes(query) ||
    (r.details||'').toLowerCase().includes(query));

  tbody.innerHTML = '';
  if (!filtered.length) { emptyState.classList.remove('hidden'); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(r => {
    const ts = r.timestamp && r.timestamp.toDate ? r.timestamp.toDate().toLocaleString() : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(ts)}</td><td>${escapeHtml(r.userName || r.userEmail)}</td><td>${escapeHtml(r.action)}</td><td>${escapeHtml(r.details || '')}</td>`;
    tbody.appendChild(tr);
  });
}

async function loadCompanyProfile() {
  try {
    const p = await Api.getCompanyProfile();
    companyProfile = { ...companyProfile, ...p };
    document.getElementById('companyNameInput').value = p.name || '';
    document.getElementById('companyAccInput').value = p.accountNumber || '';
    document.getElementById('companySysInput').value = p.sysId || '';
  } catch (err) {
    console.error(err);
  }
}
function wireCompanyForm() {
  document.getElementById('saveCompanyBtn').addEventListener('click', async () => {
    const name = document.getElementById('companyNameInput').value.trim().toUpperCase();
    const accountNumber = document.getElementById('companyAccInput').value.trim();
    const sysId = document.getElementById('companySysInput').value.trim();
    if (!name || !accountNumber || !sysId) { alert('Please fill all fields.'); return; }
    try {
      await Api.updateCompanyProfile({ name, accountNumber, sysId });
      companyProfile = { ...companyProfile, name, accountNumber, sysId };
      await Api.logAudit(currentUser.email, currentUser.displayName, 'UPDATE COMPANY', `${name} | Acc: ${accountNumber} | Branch: ${sysId}`);
      alert('Company profile updated.');
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  });
}

// ---------------------------------------------------------
// 10b. SETTINGS PAGE
// Lets a signed-in user change their email/password from inside
// the dashboard. Both the email and password forms re-authenticate
// with the CURRENT password first — Firebase requires this
// ("recent login") for sensitive account changes, and it also means
// someone who merely stole a logged-in session can't silently take
// over the account.
// ---------------------------------------------------------
function settingsMsg(boxId, text, isError) {
  const box = document.getElementById(boxId);
  box.textContent = text;
  box.className = isError ? 'error-msg show' : 'success-msg show';
  box.style.marginBottom = '16px';
}
function clearSettingsMsg(boxId) {
  const box = document.getElementById(boxId);
  box.textContent = '';
  box.className = '';
}

async function reauthenticate(password) {
  const cred = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, password);
  await auth.currentUser.reauthenticateWithCredential(cred);
}

// ---- Settings list → modal open/close ----
function openSettingsModal(modalId, formId, msgBoxId) {
  clearSettingsMsg(msgBoxId);
  document.getElementById(formId).reset();
  document.getElementById(modalId).classList.remove('hidden');
}
function closeSettingsModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

function wireSettingsForms() {
  document.getElementById('openChangeEmailBtn').addEventListener('click', () =>
    openSettingsModal('changeEmailModal', 'changeEmailForm', 'settingsEmailMsg'));
  document.getElementById('cancelChangeEmailBtn').addEventListener('click', () =>
    closeSettingsModal('changeEmailModal'));

  document.getElementById('openChangePasswordBtn').addEventListener('click', () =>
    openSettingsModal('changePasswordModal', 'changePasswordForm', 'settingsPasswordMsg'));
  document.getElementById('cancelChangePasswordBtn').addEventListener('click', () =>
    closeSettingsModal('changePasswordModal'));

  // ---- Change email ----
  document.getElementById('changeEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearSettingsMsg('settingsEmailMsg');
    const btn = document.getElementById('changeEmailBtn');
    const currentPassword = document.getElementById('emailChangeCurrentPassword').value;
    const newEmail = document.getElementById('newEmailInput').value.trim();
    btn.disabled = true; btn.textContent = 'Updating...';
    try {
      await reauthenticate(currentPassword);
      // verifyBeforeUpdateEmail sends a confirmation link to the NEW
      // address and only swaps the email once that link is clicked —
      // so a typo or someone else's inbox can't hijack the account.
      await auth.currentUser.verifyBeforeUpdateEmail(newEmail, actionCodeSettings);
      settingsMsg('settingsEmailMsg', `Verification link sent to ${newEmail}. Your sign-in email will update once you click it.`, false);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'REQUEST EMAIL CHANGE', `Requested change to ${newEmail}`);
      document.getElementById('changeEmailForm').reset();
    } catch (err) {
      settingsMsg('settingsEmailMsg', mapAuthError(err), true);
    } finally {
      btn.disabled = false; btn.textContent = 'Update Email';
    }
  });

  // ---- Change password ----
  document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearSettingsMsg('settingsPasswordMsg');
    const btn = document.getElementById('changePasswordBtn');
    const currentPassword = document.getElementById('pwChangeCurrentPassword').value;
    const newPassword = document.getElementById('pwChangeNewPassword').value;
    btn.disabled = true; btn.textContent = 'Updating...';
    try {
      await reauthenticate(currentPassword);
      await auth.currentUser.updatePassword(newPassword);
      settingsMsg('settingsPasswordMsg', 'Password updated.', false);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'CHANGE PASSWORD', 'Password updated from Settings');
      document.getElementById('changePasswordForm').reset();
    } catch (err) {
      settingsMsg('settingsPasswordMsg', mapAuthError(err), true);
    } finally {
      btn.disabled = false; btn.textContent = 'Update Password';
    }
  });
}

// ---------------------------------------------------------
// 11. INACTIVITY AUTO-LOGOUT (15 min)
// Signs the user out after 15 minutes of no activity — including
// when the browser tab/window itself is inactive (switched away,
// minimized, or backgrounded). A plain setInterval alone isn't
// enough because browsers throttle timers in background tabs, so
// the 30s check can fire late. We fix that by also re-checking the
// instant the tab becomes visible/focused again.
// ---------------------------------------------------------
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
let lastActivity = Date.now();

function markActivity() { lastActivity = Date.now(); }
['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(evt =>
  document.addEventListener(evt, markActivity, { passive: true })
);

function checkInactivity() {
  if (auth.currentUser && Date.now() - lastActivity > INACTIVITY_LIMIT_MS) {
    auth.signOut();
  }
}

// Regular check while the tab is in the foreground.
setInterval(checkInactivity, 30000);

// Catch the case where the tab was backgrounded/minimized long
// enough that the timer above got throttled — re-check the moment
// the user comes back, so logout happens immediately if overdue.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkInactivity();
});
window.addEventListener('focus', checkInactivity);