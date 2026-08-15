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
      sysId: d.sysId || '',
      bankName: d.bankName || 'SBI'
    };
  },
  async updateCompanyProfile({ name, accountNumber, sysId, bankName }) {
    await userRef().set({
      companyName: name, accountNumber, sysId, bankName,
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
// 2c. MULTI-BANK BULK PAYMENT FILE SUPPORT
//
// BANKS: the master list backing the Company Profile "bank" dropdown.
//   key         — stable internal id, stored in Firestore as bankName
//   label       — text shown in the dropdown
//   ifscPrefix  — the 4-letter IFSC bank code used to detect an
//                 "internal / same-bank" transfer for that bank
//
// BankFormatters: one entry per BANKS key, keyed the same way, each
// providing the file extension/MIME type and a generate() function
// that turns a batch into that bank's exact file layout. This is the
// single place to touch when a bank changes its file spec or a new
// bank needs to be added — nothing else in the export pipeline is
// bank-specific.
//
// NOTE: the exact CSV column layouts below follow the specs supplied
// for SBI, PNB, BOB, HDFC, ICICI, Axis and Kotak. Canara, Union,
// IndusInd, Yes Bank and the payments banks don't have a distinct
// spec on file, so they fall back to a generic standard CSV layout —
// confirm the live column order with each bank's CMS/corporate net
// banking portal before using those in production.
// ---------------------------------------------------------
const BANKS = [
  { key: 'SBI',      label: 'State Bank of India (SBI)',   ifscPrefix: 'SBIN' },
  { key: 'PNB',      label: 'Punjab National Bank (PNB)',  ifscPrefix: 'PUNB' },
  { key: 'BOB',      label: 'Bank of Baroda (BOB)',        ifscPrefix: 'BARB' },
  { key: 'CNRB',     label: 'Canara Bank (CNRB)',          ifscPrefix: 'CNRB' },
  { key: 'UBI',      label: 'Union Bank of India (UBI)',   ifscPrefix: 'UBIN' },
  { key: 'INDB',     label: 'Indian Bank (INDB)',          ifscPrefix: 'IDIB' },
  { key: 'HDFC',     label: 'HDFC Bank (HDFC)',            ifscPrefix: 'HDFC' },
  { key: 'ICIC',     label: 'ICICI Bank (ICIC)',           ifscPrefix: 'ICIC' },
  { key: 'UTIB',     label: 'Axis Bank (UTIB)',            ifscPrefix: 'UTIB' },
  { key: 'KKBK',     label: 'Kotak Mahindra Bank (KKBK)',  ifscPrefix: 'KKBK' },
  { key: 'INDUSIND', label: 'IndusInd Bank (INDB)',        ifscPrefix: 'INDB' },
  { key: 'YESB',     label: 'Yes Bank (YESB)',             ifscPrefix: 'YESB' },
  { key: 'PAYTM',    label: 'Payments Bank — Paytm',       ifscPrefix: 'PYTM' },
  { key: 'AIRTEL',   label: 'Payments Bank — Airtel',      ifscPrefix: 'AIRP' },
];
const BANK_BY_KEY = Object.fromEntries(BANKS.map(b => [b.key, b]));

// Wraps a CSV field in quotes if it contains a comma, quote, or newline.
function csvField(value) {
  const s = String(value ?? '').replace(/[\r\n]+/g, ' ');
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(values) { return values.map(csvField).join(','); }

// SBI and ICICI's bulk files use a single character (# or ^) as the
// field separator instead of CSV-style quoting. If a company or
// employee name ever contained that exact character, the row would
// silently split into an extra column and the whole batch would be
// misread — or bounced — by the bank's upload portal. Strip any
// stray delimiter characters and line breaks before they go in.
function sanitizeForDelimitedFile(value, ...reservedChars) {
  let s = String(value ?? '').replace(/[\r\n]+/g, ' ');
  reservedChars.forEach(ch => { s = s.split(ch).join(''); });
  return s.trim();
}

// Determines NEFT / RTGS / IMPS / Same Bank for a single transaction on
// any non-SBI bank, per the rules in the spec:
//  - Same Bank / Internal: beneficiary IFSC starts with the company's
//    own bank's 4-letter code
//  - otherwise RTGS if amount >= ₹2,00,000, else NEFT
//  - IMPS is an optional override toggle for any cross-bank transfer
function determineTransactionMode(bankKey, ifsc, amount, preferImps) {
  const bank = BANK_BY_KEY[bankKey];
  if (!bank) return 'NEFT';
  const sameBank = bank.ifscPrefix && String(ifsc || '').toUpperCase().startsWith(bank.ifscPrefix);
  if (sameBank) return 'Same Bank';
  if (preferImps) return 'IMPS';
  return amount >= 200000 ? 'RTGS' : 'NEFT';
}

// ctx passed to every generate() below:
//   companyProfile { name, accountNumber, sysId, bankName }
//   lines[]  { acc, empCode, name, ifsc, amount, mode }
//   total, batchId, txnDate ('DD/MM/YYYY'), monthName, year, tft
const BankFormatters = {
  SBI: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(ctx) {
      const d = v => sanitizeForDelimitedFile(v, '#');
      const prefix = ctx.tft === 'Same Bank' ? 'SBST' : 'OBST';
      const empLines = ctx.lines.map(l => {
        const seqStr = `${prefix}${ctx.shortYear}${ctx.monthRaw}E${l.empCode}`;
        return `${d(l.acc)}#${d(l.ifsc)}#${ctx.txnDate}##${l.amount.toFixed(2)}#${seqStr}#${d(l.name)}#SALARY OF ${d(ctx.monthName)} ${ctx.year}#`;
      });
      const header = `${d(ctx.companyProfile.accountNumber)}#${d(ctx.companyProfile.sysId)}#${ctx.txnDate}#${ctx.total.toFixed(2)}##${ctx.batchId}#${d(ctx.companyProfile.name)}#SALARY OF ${d(ctx.monthName)} ${ctx.year}#`;
      return [header, ...empLines].join('\n') + '\n';
    }
  },
  PNB: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(ctx) {
      const header = 'DebitAcc,BenAcc,Amount,BenName,IFSC,TxnType,TxnDate,Remarks';
      const rows = ctx.lines.map(l => csvRow([
        ctx.companyProfile.accountNumber, l.acc, l.amount.toFixed(2), l.name, l.ifsc, l.mode,
        ctx.txnDate, `SALARY OF ${ctx.monthName} ${ctx.year}`
      ]));
      return [header, ...rows].join('\r\n') + '\r\n';
    }
  },
  BOB: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(ctx) {
      const header = 'PaymentType,DebitAcc,BenAcc,BenName,Amount,IFSC,Remarks,TxnDate';
      const rows = ctx.lines.map(l => csvRow([
        l.mode, ctx.companyProfile.accountNumber, l.acc, l.name, l.amount.toFixed(2), l.ifsc,
        `SALARY OF ${ctx.monthName} ${ctx.year}`, ctx.txnDate
      ]));
      return [header, ...rows].join('\r\n') + '\r\n';
    }
  },
  CNRB: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(ctx) {
      const header = 'TxnType,DebitAcc,BenAcc,BenName,Amount,IFSC,TxnDate,Remarks';
      const rows = ctx.lines.map(l => csvRow([
        l.mode, ctx.companyProfile.accountNumber, l.acc, l.name, l.amount.toFixed(2), l.ifsc,
        ctx.txnDate, `SALARY OF ${ctx.monthName} ${ctx.year}`
      ]));
      return [header, ...rows].join('\r\n') + '\r\n';
    }
  },
  UBI: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(ctx) {
      const header = 'TxnType,DebitAcc,BenAcc,BenName,Amount,IFSC,TxnDate,Remarks';
      const rows = ctx.lines.map(l => csvRow([
        l.mode, ctx.companyProfile.accountNumber, l.acc, l.name, l.amount.toFixed(2), l.ifsc,
        ctx.txnDate, `SALARY OF ${ctx.monthName} ${ctx.year}`
      ]));
      return [header, ...rows].join('\r\n') + '\r\n';
    }
  },
  INDB: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(ctx) {
      const header = 'TxnType,DebitAcc,BenAcc,BenName,Amount,IFSC,TxnDate,Remarks';
      const rows = ctx.lines.map(l => csvRow([
        l.mode, ctx.companyProfile.accountNumber, l.acc, l.name, l.amount.toFixed(2), l.ifsc,
        ctx.txnDate, `SALARY OF ${ctx.monthName} ${ctx.year}`
      ]));
      return [header, ...rows].join('\r\n') + '\r\n';
    }
  },
  HDFC: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(ctx) {
      const header = 'TxnType,DebitAcc,BenAcc,BenName,Amount,IFSC,TxnDate,Email,Remarks';
      const rows = ctx.lines.map(l => csvRow([
        l.mode, ctx.companyProfile.accountNumber, l.acc, l.name, l.amount.toFixed(2), l.ifsc,
        ctx.txnDate, '', `SALARY OF ${ctx.monthName} ${ctx.year}`
      ]));
      return [header, ...rows].join('\r\n') + '\r\n';
    }
  },
  ICIC: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(ctx) {
      const d = v => sanitizeForDelimitedFile(v, '^');
      const rows = ctx.lines.map(l =>
        [l.mode, d(ctx.companyProfile.accountNumber), d(l.acc), l.amount.toFixed(2), d(l.name), d(l.ifsc),
          `SALARY OF ${d(ctx.monthName)} ${ctx.year}`].join('^'));
      return rows.join('\n') + '\n';
    }
  },
  UTIB: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(ctx) {
      const header = 'PaymentType,DebitAcc,BenAcc,BenName,Amount,IFSC,Remarks,TxnDate';
      const rows = ctx.lines.map(l => csvRow([
        l.mode, ctx.companyProfile.accountNumber, l.acc, l.name, l.amount.toFixed(2), l.ifsc,
        `SALARY OF ${ctx.monthName} ${ctx.year}`, ctx.txnDate
      ]));
      return [header, ...rows].join('\r\n') + '\r\n';
    }
  },
  KKBK: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(ctx) {
      const header = 'ClientCode,DebitAcc,BenAcc,Amount,BenName,IFSC,ValueDate,Narration';
      const rows = ctx.lines.map(l => csvRow([
        ctx.companyProfile.sysId, ctx.companyProfile.accountNumber, l.acc, l.amount.toFixed(2),
        l.name, l.ifsc, ctx.txnDate, `SALARY OF ${ctx.monthName} ${ctx.year}`
      ]));
      return [header, ...rows].join('\r\n') + '\r\n';
    }
  },
  // Generic standard CSV layout — used for banks without a distinct
  // spec supplied (IndusInd, Yes Bank, Paytm, Airtel Payments Bank).
  INDUSIND: { ext: 'csv', mime: 'text/csv;charset=utf-8', generate: genericCsv },
  YESB:     { ext: 'csv', mime: 'text/csv;charset=utf-8', generate: genericCsv },
  PAYTM:    { ext: 'csv', mime: 'text/csv;charset=utf-8', generate: genericCsv },
  AIRTEL:   { ext: 'csv', mime: 'text/csv;charset=utf-8', generate: genericCsv },
};
function genericCsv(ctx) {
  const header = 'TxnType,DebitAcc,BenAcc,BenName,Amount,IFSC,TxnDate,Remarks';
  const rows = ctx.lines.map(l => csvRow([
    l.mode, ctx.companyProfile.accountNumber, l.acc, l.name, l.amount.toFixed(2), l.ifsc,
    ctx.txnDate, `SALARY OF ${ctx.monthName} ${ctx.year}`
  ]));
  return [header, ...rows].join('\r\n') + '\r\n';
}

function populateCompanyBankSelect() {
  const sel = document.getElementById('companyBankInput');
  if (!sel || sel.dataset.populated) return;
  sel.dataset.populated = '1';
  sel.innerHTML = BANKS.map(b => `<option value="${b.key}">${escapeHtml(b.label)}</option>`).join('');
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
let companyProfile = { name: '', accountNumber: '', sysId: '', bankName: 'SBI' };
let dashboardBooted = false;
let currentUser = null;

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function formatDateDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// ---------------------------------------------------------
// Google account UI — profile photo in the sidebar, and hiding the
// "change email/password" settings for accounts signed in via Google
// (those credentials live with Google, not with Firebase's email/
// password provider, so there's nothing here to change).
// ---------------------------------------------------------
function getInitials(name, email) {
  const src = (name || email || '').trim();
  if (!src) return '?';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function isGoogleAccount(user) {
  return !!user && Array.isArray(user.providerData) &&
    user.providerData.some(p => p.providerId === 'google.com');
}
function applyUserProfileUI(user) {
  const imgEl = document.getElementById('userAvatarImg');
  const fallbackEl = document.getElementById('userAvatarFallback');

  if (user.photoURL) {
    imgEl.src = user.photoURL;
    imgEl.classList.remove('hidden');
    fallbackEl.classList.add('hidden');
    // Google photo URLs can occasionally fail to load (revoked, rate
    // limited, offline) — fall back to initials instead of a broken image.
    imgEl.onerror = () => {
      imgEl.classList.add('hidden');
      fallbackEl.classList.remove('hidden');
    };
  } else {
    imgEl.classList.add('hidden');
    fallbackEl.textContent = getInitials(user.displayName, user.email);
    fallbackEl.classList.remove('hidden');
  }

  const google = isGoogleAccount(user);
  document.getElementById('settingsCredentialsList').classList.toggle('hidden', google);
  document.getElementById('settingsGoogleNotice').classList.toggle('hidden', !google);
}

async function bootDashboard(user) {
  currentUser = user;
  document.getElementById('userName').textContent = user.displayName || 'PayFlow User';
  document.getElementById('userEmail').textContent = user.email;
  applyUserProfileUI(user);

  try {
    await initUserContext(user.uid);
  } catch (err) {
    alert('Could not load your account: ' + err.message);
    return;
  }

  initDisbursementDateFields();
  await Promise.all([loadEmployees(), loadCompanyProfile()]);
  renderEmployeeKpis();

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
    wireModalCloseButtons();
    document.getElementById('logoutBtn').onclick = () => auth.signOut();
    document.getElementById('employeeSearch').addEventListener('input', renderEmployeeTable);
  }
}

// Generic "×" close button on every modal — just hides the backdrop,
// same as each modal's own Cancel button, without needing bespoke
// wiring per modal.
function wireModalCloseButtons() {
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = document.getElementById(btn.dataset.modal);
      if (modal) modal.classList.add('hidden');
    });
  });
}

// Populates the KPI summary row at the top of the Employee Ledger page:
// headcount, the company's configured bank, this calendar month's total
// disbursed amount, and the most recent export batch — all derived from
// data already being fetched (employees, company profile, disbursement
// history), so no extra Firestore reads are introduced.
async function renderEmployeeKpis() {
  const totalEl = document.getElementById('kpiTotalEmployees');
  const bankEl = document.getElementById('kpiCompanyBank');
  const monthEl = document.getElementById('kpiMonthDisbursed');
  const lastEl = document.getElementById('kpiLastExport');
  const lastSubEl = document.getElementById('kpiLastExportSub');
  if (!totalEl) return; // KPI row only exists on the Employee Ledger page

  totalEl.textContent = employees.length;
  const bank = BANK_BY_KEY[companyProfile.bankName || 'SBI'] || BANK_BY_KEY.SBI;
  bankEl.textContent = bank.label;

  let history = [];
  try {
    history = await Api.getDisbursementHistory();
  } catch (err) {
    console.error(err);
  }

  const now = new Date();
  let monthTotal = 0;
  history.forEach(row => {
    const created = row.createdAt && row.createdAt.toDate ? row.createdAt.toDate() : null;
    if (created && created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear()) {
      const amt = parseFloat(row.amount);
      if (!isNaN(amt)) monthTotal += amt;
    }
  });
  monthEl.textContent = `₹ ${monthTotal.toFixed(2)}`;

  // getDisbursementHistory() is already ordered newest-first, so the
  // first row belongs to the most recently exported batch.
  const last = history[0];
  if (last) {
    lastEl.textContent = last.batchId || '—';
    const d = last.createdAt && last.createdAt.toDate ? last.createdAt.toDate().toLocaleDateString() : (last.transferDate || '');
    lastSubEl.textContent = d ? `on ${d}` : '';
  } else {
    lastEl.textContent = '—';
    lastSubEl.textContent = 'No exports yet';
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

// Renders a transfer-mode/type value (Same Bank, RTGS, NEFT, IMPS,
// Other Bank) as a small colored pill instead of plain text.
function badgeForMode(mode) {
  const cls = mode === 'Same Bank' ? 'badge-green'
    : mode === 'RTGS' ? 'badge-blue'
    : mode === 'NEFT' ? 'badge-blue'
    : mode === 'IMPS' ? 'badge-amber'
    : 'badge-grey';
  return `<span class="badge ${cls}">${escapeHtml(mode || '—')}</span>`;
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
      <td>${badgeForMode(emp.transferType)}</td>
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
      showFieldError('Please fill in all required fields before saving. (Middle Name is optional)');
      return;
    }
    // Double-entry verification for Account Number and IFSC.
    if (acc !== accC || ifsc !== ifscC) {
      showFieldError('Account Number and IFSC must match their confirmation fields.');
      return;
    }

    const nameParts = [fname];
    if (mname) nameParts.push(mname);
    nameParts.push(lname);
    const fullName = nameParts.join(' ').toUpperCase();

    // Duplicate account-number check, excluding the record currently being edited.
    if (existingAccountNumbers().includes(acc)) {
      showFieldError(`Account number ${acc} is already assigned to another employee in the ledger.`);
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

// Initializes the two native date pickers on the Disbursement page:
//  - Payroll Cycle (<input type="month">) — defaults to the current
//    month, drives the payroll-cycle label used on the exported file.
//  - Transfer Date (<input type="date">) — defaults to today but is
//    fully editable, so a batch can be dated for a future value date
//    instead of always using "today".
function initDisbursementDateFields() {
  const now = new Date();
  const monthInput = document.getElementById('disbPayrollMonth');
  const dateInput = document.getElementById('disbTransferDate');
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (monthInput && !monthInput.value) monthInput.value = ym;
  if (dateInput && !dateInput.value) dateInput.value = ymd;
}

// Reads the Payroll Cycle picker ("YYYY-MM") into the { monthRaw,
// year, monthName } shape the rest of the export pipeline expects.
function getPayrollCycle() {
  const raw = document.getElementById('disbPayrollMonth').value; // "YYYY-MM"
  const [year, monthRaw] = String(raw || '').split('-');
  const monthName = MONTHS[parseInt(monthRaw, 10) - 1] || '';
  return { monthRaw: monthRaw || '', year: year || '', monthName };
}

// Reads the Transfer Date picker ("YYYY-MM-DD") and reformats it to
// the DD/MM/YYYY convention every bank file / audit record uses.
function getTransferDateDDMMYYYY() {
  const raw = document.getElementById('disbTransferDate').value; // "YYYY-MM-DD"
  const [y, m, d] = String(raw || '').split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function validateLiveAmountEntry(inputEl, lightEl, warnEl) {
  const v = inputEl.value.trim();
  warnEl.textContent = '';
  inputEl.classList.remove('input-mismatch');
  if (!v) {
    lightEl.style.background = '#FF4757';
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
    lightEl.style.background = '#FF4757';
    warnEl.textContent = '⚠ INVALID FORMAT';
  } else {
    const val = parseFloat(v);
    if (!isNaN(val) && val > 0) {
      lightEl.style.background = '#00E676';
    } else {
      lightEl.style.background = '#FF4757';
      warnEl.textContent = '⚠ MUST BE > 0';
    }
  }
  updateBatchTotal();
}

// Shows/hides the SBI-style "Transfer Type" selector vs. the
// cross-bank "Prefer IMPS" toggle, and refreshes the bank badge —
// called whenever the company's bank changes.
function updateDisbursementModeUI() {
  const bankKey = companyProfile.bankName || 'SBI';
  const bank = BANK_BY_KEY[bankKey] || BANK_BY_KEY.SBI;
  const isSbi = bankKey === 'SBI';

  const badge = document.getElementById('disbBankBadge');
  if (badge) badge.textContent = `BANK: ${bank.label}`;

  const subtitle = document.getElementById('disbSubtitle');
  if (subtitle) {
    subtitle.textContent = isSbi
      ? 'Enter amounts and export the SBI bulk payment file.'
      : `Enter amounts and export the ${bank.label} bulk payment file. Mode (Same Bank / RTGS / NEFT / IMPS) is auto-detected per beneficiary.`;
  }

  const ttWrap = document.getElementById('disbTransferTypeWrap');
  const impsWrap = document.getElementById('disbImpsWrap');
  if (ttWrap) ttWrap.classList.toggle('hidden', !isSbi);
  if (impsWrap) impsWrap.classList.toggle('hidden', isSbi);
}

// For the currently-selected bank, works out which employees belong in
// the batch and what transfer mode applies to each one.
//  - SBI: unchanged behaviour — filtered by the employee's own stored
//    Same Bank / Other Bank transferType.
//  - Every other bank: all employees are shown, and the mode is
//    computed live from IFSC + amount (+ the "Prefer IMPS" toggle).
function currentModeFor(ifsc, amount) {
  const bankKey = companyProfile.bankName || 'SBI';
  if (bankKey === 'SBI') return null;
  const preferImps = !!document.getElementById('disbUseImps')?.checked;
  return determineTransactionMode(bankKey, ifsc, amount, preferImps);
}

function renderDisbursementList() {
  const tbody = document.getElementById('disbTableBody');
  const emptyState = document.getElementById('disbEmptyState');
  if (!tbody) return;

  const bankKey = companyProfile.bankName || 'SBI';
  const isSbi = bankKey === 'SBI';
  const tft = document.getElementById('disbTransferType').value;
  const query = (document.getElementById('disbSearch').value || '').trim().toLowerCase();

  salaryInputs = {};
  tbody.innerHTML = '';

  const filtered = employees.filter(e =>
    (isSbi ? e.transferType === tft : true) &&
    (!query || e.name.toLowerCase().includes(query) || String(e.accountNumber).includes(query) || String(e.empCode).includes(query)));

  if (!filtered.length) { emptyState.classList.remove('hidden'); updateBatchTotal(); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(emp => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(emp.empCode)}</td>
      <td>${escapeHtml(emp.name)}</td>
      <td><span class="masked-acc"><span data-full="${escapeHtml(emp.accountNumber)}" data-revealed="0">${escapeHtml(maskAccount(emp.accountNumber))}</span><button type="button">Show</button></span></td>
      <td><span data-mode>${isSbi ? badgeForMode(tft) : badgeForMode('—')}</span></td>
      <td style="text-align:right;">
        <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px;">
          <span style="font-size:10px; color:var(--danger); font-weight:700;" data-warn></span>
          <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#FF4757;" data-light></span>
          <input type="text" data-acc="${escapeHtml(emp.accountNumber)}" placeholder="0.00"
            style="width:120px; text-align:right; background:var(--surface2); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--success); padding:6px 8px;">
        </div>
      </td>`;
    tbody.appendChild(tr);
    const inputEl = tr.querySelector('input');
    const lightEl = tr.querySelector('[data-light]');
    const warnEl  = tr.querySelector('[data-warn]');
    const modeEl  = tr.querySelector('[data-mode]');
    inputEl.addEventListener('input', () => {
      validateLiveAmountEntry(inputEl, lightEl, warnEl);
      if (!isSbi) {
        const v = parseFloat(inputEl.value);
        modeEl.innerHTML = badgeForMode(currentModeFor(emp.ifsc, isNaN(v) ? 0 : v));
      }
    });
    if (!isSbi) modeEl.innerHTML = badgeForMode(currentModeFor(emp.ifsc, 0));
    salaryInputs[emp.accountNumber] = { inputEl, modeEl, name: emp.name, ifsc: emp.ifsc, empCode: emp.empCode };
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
  document.getElementById('disbTotal').textContent = `Batch Total: ₹ ${total.toFixed(2)}`;
}

function wireDisbursement() {
  document.getElementById('disbTransferType').addEventListener('change', renderDisbursementList);
  document.getElementById('disbSearch').addEventListener('input', renderDisbursementList);
  document.getElementById('disbUseImps').addEventListener('change', renderDisbursementList);
  document.getElementById('disbClearBtn').addEventListener('click', () => {
    document.querySelectorAll('#disbTableBody tr').forEach(tr => {
      const inputEl = tr.querySelector('input');
      const lightEl = tr.querySelector('[data-light]');
      const warnEl  = tr.querySelector('[data-warn]');
      if (inputEl) inputEl.value = '';
      if (lightEl) lightEl.style.background = '#FF4757';
      if (warnEl)  warnEl.textContent = '';
    });
    updateBatchTotal();
  });
  document.getElementById('disbExportBtn').addEventListener('click', openExportPreview);
  document.getElementById('cancelExportBtn').addEventListener('click', () => {
    document.getElementById('exportPreviewModal').classList.add('hidden');
  });
  updateDisbursementModeUI();
  renderDisbursementList();
}

function collectBatchLines() {
  const bankKey = companyProfile.bankName || 'SBI';
  const isSbi = bankKey === 'SBI';
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
    const mode = isSbi ? tft : currentModeFor(md.ifsc, v);
    lines.push({ acc, empCode: md.empCode, name: md.name, ifsc: md.ifsc, amount: v, mode });
  }
  return { tft, lines, total, hasInvalid };
}

// The exported bank file's header row is built entirely from
// companyProfile fields — if any of these are still blank, the file
// would export "successfully" but contain an empty/broken debit
// account row, which the bank portal will reject. So export must be
// blocked (not just discouraged) until the Company Profile is saved.
function isCompanyProfileComplete() {
  return !!(companyProfile.name && companyProfile.accountNumber && companyProfile.sysId && companyProfile.bankName);
}
function goToCompanyPage() {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const navItem = document.querySelector('.nav-item[data-page="company"]');
  if (navItem) navItem.classList.add('active');
  document.querySelectorAll('#screen-dashboard main > section').forEach(s => s.classList.add('hidden'));
  document.getElementById('page-company').classList.remove('hidden');
}

function openExportPreview() {
  if (!isCompanyProfileComplete()) {
    alert('Please fill company details to continue. Company Name, Account Number, Branch/Sys Code and Bank are required before you can export a payment file.');
    goToCompanyPage();
    return;
  }
  const { tft, lines, total, hasInvalid } = collectBatchLines();
  if (hasInvalid) { alert('One or more amounts are in an invalid format. Please check and try again.'); return; }
  if (!lines.length) { alert('Please enter at least one salary amount before exporting.'); return; }

  const txnDate = getTransferDateDDMMYYYY();
  if (!txnDate) { alert('Please select a Transfer Date before exporting.'); return; }

  const bankKey = companyProfile.bankName || 'SBI';
  const isSbi = bankKey === 'SBI';
  const bank = BANK_BY_KEY[bankKey] || BANK_BY_KEY.SBI;
  const { monthName, year } = getPayrollCycle();

  const modeSummary = isSbi
    ? `<p><strong>Transfer Type:</strong> ${escapeHtml(tft)}</p>`
    : (() => {
        const counts = {};
        lines.forEach(l => { counts[l.mode] = (counts[l.mode] || 0) + 1; });
        const breakdown = Object.entries(counts).map(([m, c]) => `${escapeHtml(m)}: ${c}`).join(' &nbsp;•&nbsp; ');
        return `<p><strong>Bank:</strong> ${escapeHtml(bank.label)}</p><p><strong>Mode breakdown:</strong> ${breakdown}</p>`;
      })();

  document.getElementById('exportPreviewBody').innerHTML = `
    ${modeSummary}
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

// Refactored executeExport(): resolves the company's bank, delegates
// file-content generation to that bank's BankFormatters strategy, and
// keeps the existing batch counter / disbursement history / audit
// logging behaviour unchanged for every bank.
async function executeExport() {
  const { tft, lines, total } = collectBatchLines();
  const bankKey = companyProfile.bankName || 'SBI';
  const bank = BANK_BY_KEY[bankKey] || BANK_BY_KEY.SBI;
  const formatter = BankFormatters[bankKey] || BankFormatters.SBI;

  const prefix = tft === 'Same Bank' ? 'SBST' : 'OBST';
  const { monthRaw, monthName, year } = getPayrollCycle();
  const shortYear = year.slice(2);
  const txnDate = getTransferDateDDMMYYYY();
  if (!txnDate) { alert('Please select a Transfer Date before exporting.'); return; }

  let seq;
  try {
    seq = await Api.getAndIncrementCounter();
  } catch (err) {
    alert('Could not generate batch number: ' + err.message);
    return;
  }
  const batchId = `${prefix}${shortYear}${monthRaw}${seq}`;

  const logRows = lines.map(({ acc, empCode, name, ifsc, amount, mode }) => ({
    batchId, transferDate: txnDate, empCode, employeeName: name, accountNumber: acc, ifsc,
    amount: amount.toFixed(2), transferType: mode, bank: bankKey
  }));

  const output = formatter.generate({
    companyProfile, lines, total, batchId, txnDate, monthRaw, shortYear, monthName, year, tft
  });

  const fileName = `${bankKey.toLowerCase()}_salary_${monthName}_${year}.${formatter.ext}`;
  downloadTextFile(fileName, output, formatter.mime);

  try {
    await Api.addDisbursementRows(logRows);
    await Api.logAudit(currentUser.email, currentUser.displayName, 'EXPORT FILE',
      `Batch: ${batchId} | Bank: ${bank.label} | Total: ₹${total.toFixed(2)} | Employees: ${lines.length} | File: ${fileName}`);
    renderEmployeeKpis();
  } catch (err) {
    alert('File downloaded, but logging to the ledger failed: ' + err.message);
  }
}

function downloadTextFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
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
  populateCompanyBankSelect();
  try {
    const p = await Api.getCompanyProfile();
    companyProfile = { ...companyProfile, ...p };
    document.getElementById('companyNameInput').value = p.name || '';
    document.getElementById('companyAccInput').value = p.accountNumber || '';
    document.getElementById('companyAccConfirmInput').value = p.accountNumber || '';
    document.getElementById('companySysInput').value = p.sysId || '';
    document.getElementById('companyBankInput').value = p.bankName || 'SBI';
  } catch (err) {
    console.error(err);
  }
  updateDisbursementModeUI();
}
function wireCompanyForm() {
  populateCompanyBankSelect();

  const accInput = document.getElementById('companyAccInput');
  const accConfirmInput = document.getElementById('companyAccConfirmInput');
  const accMismatchLbl = document.getElementById('companyAccMismatchLbl');

  // Live double-entry check — mirrors the Employee form's Account
  // Number confirmation, so a mistyped digit is caught immediately
  // instead of silently corrupting every export's debit account.
  function validateCompanyAccountLive() {
    const prime = accInput.value.trim();
    const conf = accConfirmInput.value.trim();
    accConfirmInput.classList.remove('input-mismatch', 'input-match');
    if (!conf) { accMismatchLbl.textContent = ''; return; }
    if (prime !== conf) {
      accConfirmInput.classList.add('input-mismatch');
      accMismatchLbl.textContent = 'MISMATCH';
    } else {
      accConfirmInput.classList.add('input-match');
      accMismatchLbl.textContent = '';
    }
  }
  [accInput, accConfirmInput].forEach(el => el.addEventListener('input', validateCompanyAccountLive));

  document.getElementById('saveCompanyBtn').addEventListener('click', async () => {
    const name = document.getElementById('companyNameInput').value.trim().toUpperCase();
    const accountNumber = accInput.value.trim();
    const accountNumberConfirm = accConfirmInput.value.trim();
    const sysId = document.getElementById('companySysInput').value.trim();
    const bankName = document.getElementById('companyBankInput').value;
    if (!name || !accountNumber || !accountNumberConfirm || !sysId || !bankName) { alert('Please fill all fields.'); return; }
    if (accountNumber !== accountNumberConfirm) {
      alert('Company Account Number and its confirmation do not match.');
      return;
    }
    try {
      await Api.updateCompanyProfile({ name, accountNumber, sysId, bankName });
      companyProfile = { ...companyProfile, name, accountNumber, sysId, bankName };
      await Api.logAudit(currentUser.email, currentUser.displayName, 'UPDATE COMPANY', `${name} | Acc: ${accountNumber} | Branch: ${sysId} | Bank: ${bankName}`);
      updateDisbursementModeUI();
      renderDisbursementList();
      renderEmployeeKpis();
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