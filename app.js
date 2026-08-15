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
// 1a. THEME (Dark / Light)
// Dark navy is the default. Light mode swaps the main dark-blue
// surfaces for a neutral grey (rgb(208,208,208)) via CSS variables
// scoped under html[data-theme="light"] — see style.css. The initial
// theme is already applied by an inline <head> script (before this
// file loads) to avoid a flash of the wrong theme; this just keeps
// the Settings toggle in sync and handles switching at runtime.
// ---------------------------------------------------------
const THEME_STORAGE_KEY = 'payflow-theme';

function getStoredTheme() {
  try { return localStorage.getItem(THEME_STORAGE_KEY); } catch (e) { return null; }
}
function isLightTheme() { return document.documentElement.getAttribute('data-theme') === 'light'; }
function applyTheme(theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) { /* ignore */ }
}
function wireThemeToggle() {
  const toggle = document.getElementById('lightModeToggle');
  if (!toggle) return;
  toggle.checked = isLightTheme();
  toggle.addEventListener('change', () => {
    applyTheme(toggle.checked ? 'light' : 'dark');
  });
}

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

// SESSION persistence: Firebase's default (LOCAL) keeps the user signed
// in even after the browser is fully closed and reopened. SESSION ties
// the sign-in to the current tab instead — the moment the tab or the
// whole browser window is closed, the sign-in state is gone, so the
// next visit lands back on the Sign In screen instead of walking
// straight into the dashboard. Must be set before any sign-in call.
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
      ifsc: d.ifsc || '',
      sysId: d.sysId || '',
      bankName: d.bankName || 'SBI'
    };
  },
  async updateCompanyProfile({ name, accountNumber, ifsc, sysId, bankName }) {
    await userRef().set({
      companyName: name, accountNumber, ifsc, sysId, bankName,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  },
  // Runs inside a Firestore transaction, so even if the user has two
  // tabs open and both hit "Export" at the same instant, each export
  // still reads-and-writes the counter atomically — nobody can ever
  // walk away with the same number. That's what actually guarantees
  // uniqueness here, not the number format itself.
  //
  // The counter value is encoded in base-36 (0-9 then A-Z) instead of
  // plain decimal, so the code stays alphanumeric like before but
  // packs far more values into the same width: 4 base-36 characters
  // give 36^4 = ~1.68 million unique exports before the code needs to
  // grow past 4 characters on its own (it never repeats either way —
  // padStart just keeps the width tidy for as long as possible).
  // Need more headroom later? Bump the padStart number below (e.g.
  // 5 or 6) — everything downstream just treats this as a string.
  async getAndIncrementCounter() {
    const counterRef = userRef().collection('meta').doc('fileCounter');
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists ? (snap.data().value || 1) : 1;
      tx.set(counterRef, { value: current + 1 }, { merge: true });
      return current.toString(36).toUpperCase().padStart(4, '0');
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
  // Stashes what each employee was actually paid in the batch that was
  // just exported, so the next payroll cycle's Disbursement page can
  // pre-fill the same figure instead of starting blank every time.
  // Silently skips any account number that no longer matches a current
  // employee (e.g. they were deleted after this batch was exported).
  async updateEmployeeLastAmounts(items) {
    const byAcc = new Map(employees.map(e => [String(e.accountNumber), e.id]));
    let batch = db.batch();
    let count = 0;
    for (const { accountNumber, amount } of items) {
      const id = byAcc.get(String(accountNumber));
      if (!id) continue;
      batch.set(userRef().collection('employees').doc(id), { lastAmount: amount }, { merge: true });
      count++;
      if (count === 450) { await batch.commit(); batch = db.batch(); count = 0; }
    }
    if (count > 0) await batch.commit();
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
// 2d. TOAST / CONFIRM SYSTEM
// Replaces native alert()/confirm() everywhere in the app. Native
// dialogs block the whole tab, can't be styled, and look out of place
// next to the rest of the UI. toast() is fire-and-forget (success,
// error, info); confirmDialog() returns a Promise<boolean> so existing
// `if (!confirm(...)) return;` call sites become
// `if (!(await confirmDialog(...))) return;` with minimal disruption.
// ---------------------------------------------------------
// `options` (optional) supports an inline action button, e.g.
// toast('Employee deleted.', 'success', { actionLabel: 'Undo', duration: 5000, onAction: fn })
function toast(message, kind, options) {
  const opts = options || {};
  const host = document.getElementById('toastHost');
  if (!host) { console.warn('[toast]', message); return; }
  const el = document.createElement('div');
  el.className = `toast toast-${kind || 'info'}`;

  const remove = () => {
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 200);
  };

  if (opts.actionLabel && typeof opts.onAction === 'function') {
    const row = document.createElement('div');
    row.className = 'toast-actions';
    const textEl = document.createElement('span');
    textEl.className = 'toast-text';
    textEl.textContent = message;
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'toast-undo-btn';
    actionBtn.textContent = opts.actionLabel;
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onAction();
      remove();
    });
    row.appendChild(textEl);
    row.appendChild(actionBtn);
    el.appendChild(row);
  } else {
    el.textContent = message;
    el.addEventListener('click', remove);
  }

  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(remove, opts.duration || (kind === 'error' ? 6000 : 4000));
}

function confirmDialog(message, { title = 'Please confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('confirmModal');
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalBody').textContent = message;
    const okBtn = document.getElementById('confirmModalOkBtn');
    const cancelBtn = document.getElementById('confirmModalCancelBtn');
    okBtn.className = danger ? 'btn-inline danger' : 'btn-inline';
    backdrop.classList.remove('hidden');

    function cleanup(result) {
      backdrop.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
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
// NOTE: the exact CSV/TXT column layouts below follow the specs
// supplied for SBI, HDFC, ICICI and PNB — the only 4 banks this app
// supports. Confirm the live column order with each bank's CMS /
// corporate net banking portal before using these in production.
// ---------------------------------------------------------
const BANKS = [
  { key: 'SBI',   label: 'State Bank of India (SBI)',  ifscPrefix: 'SBIN' },
  { key: 'HDFC',  label: 'HDFC Bank (HDFC)',            ifscPrefix: 'HDFC' },
  { key: 'ICICI', label: 'ICICI Bank (ICICI)',          ifscPrefix: 'ICIC' },
  { key: 'PNB',   label: 'Punjab National Bank (PNB)',  ifscPrefix: 'PUNB' },
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

// "Same Bank" is a UI-only label (shown in the mode badge on the
// Payroll Run screen) meaning "this is an intra-bank transfer" — it
// is NOT a value any bank's bulk-upload portal recognises in a
// TxnType column, and uploading it as-is risks the file being
// rejected. NEFT is accepted for same-bank transfers too, so the
// exported file always carries a real network code while the badge
// the user sees keeps the more informative "Same Bank" label.
function txnTypeCodeForFile(mode) {
  return mode === 'Same Bank' ? 'NEFT' : mode;
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
      // Each row's reference reuses ctx.batchId — which already carries
      // this export's unique counter value — plus the employee code.
      // Previously this only combined month + empCode, so exporting the
      // same month twice produced identical row codes both times. Tying
      // it to batchId means every row from every export is unique, while
      // still telling you which employee (and which batch) it belongs to.
      const empLines = ctx.lines.map(l => {
        const seqStr = `${ctx.batchId}E${l.empCode}`;
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
        ctx.companyProfile.accountNumber, l.acc, l.amount.toFixed(2), l.name, l.ifsc, txnTypeCodeForFile(l.mode),
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
        txnTypeCodeForFile(l.mode), ctx.companyProfile.accountNumber, l.acc, l.name, l.amount.toFixed(2), l.ifsc,
        ctx.txnDate, '', `SALARY OF ${ctx.monthName} ${ctx.year}`
      ]));
      return [header, ...rows].join('\r\n') + '\r\n';
    }
  },
  ICICI: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(ctx) {
      const d = v => sanitizeForDelimitedFile(v, '^');
      const rows = ctx.lines.map(l =>
        [txnTypeCodeForFile(l.mode), d(ctx.companyProfile.accountNumber), d(l.acc), l.amount.toFixed(2), d(l.name), d(l.ifsc),
          `SALARY OF ${d(ctx.monthName)} ${ctx.year}`].join('^'));
      return rows.join('\n') + '\n';
    }
  },
};

// Wires up the 4-bank selector button group in the Company Details
// edit view (SBI / HDFC / ICICI / PNB). Replaces the old <select>
// dropdown with a clear set of buttons — only one is ever active.
let selectedCompanyBankKey = 'SBI';
function setSelectedCompanyBank(key) {
  if (!BANK_BY_KEY[key]) return;
  selectedCompanyBankKey = key;
  document.querySelectorAll('#companyBankGroup .bank-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bank === key);
  });
}
function wireCompanyBankButtons() {
  document.querySelectorAll('#companyBankGroup .bank-select-btn').forEach(btn => {
    btn.addEventListener('click', () => setSelectedCompanyBank(btn.dataset.bank));
  });
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
      await handleGoogleSignInResult(result);
    } catch (err) {
      // Popups get blocked or silently fail in a lot of mobile browsers,
      // in-app webviews (opened from WhatsApp/LinkedIn, etc.), and some
      // corporate/managed-device setups. Rather than dead-ending with an
      // error in exactly those cases, fall back to a full-page redirect
      // flow, which works everywhere a popup doesn't.
      const popupFailureCodes = [
        'auth/popup-blocked',
        'auth/popup-closed-by-user',
        'auth/cancelled-popup-request',
        'auth/operation-not-supported-in-this-environment'
      ];
      if (popupFailureCodes.includes(err.code)) {
        try {
          await auth.signInWithRedirect(googleProvider);
          // Page will navigate away here; result is handled by
          // getRedirectResult() in boot() after the redirect back.
          return;
        } catch (redirectErr) {
          suppressAutoRoute = false;
          showAuthError(mapAuthError(redirectErr));
          return;
        }
      }
      suppressAutoRoute = false;
      showAuthError(mapAuthError(err));
    }
  };
}

// Shared by both the popup and redirect Google sign-in paths so new vs.
// returning users are routed identically no matter which one fired.
async function handleGoogleSignInResult(result) {
  const isNewUser = result.additionalUserInfo && result.additionalUserInfo.isNewUser;
  if (isNewUser) {
    document.getElementById('googleNameInput').value = result.user.displayName || '';
    showScreen('complete-profile');
  } else {
    suppressAutoRoute = false;
    routeUser(result.user);
  }
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
      toast('Could not save name: ' + err.message, 'error');
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
        toast('Please sign in again to resend the verification email.', 'error');
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
      toast('Could not resend: ' + mapAuthError(err), 'error');
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

  // Picks up the result after a signInWithRedirect() round-trip (the
  // Google fallback for blocked/unsupported popups). Resolves to null
  // on every normal page load where no redirect sign-in was pending —
  // that's expected, not an error.
  suppressAutoRoute = true;
  auth.getRedirectResult().then(async (result) => {
    if (result && result.user) {
      await handleGoogleSignInResult(result);
    } else {
      // No redirect was in flight (the normal case on every page load) —
      // release the hold and route based on whatever auth state we
      // actually have, since the onAuthStateChanged call below may have
      // already fired and been suppressed while this was pending.
      suppressAutoRoute = false;
      routeUser(auth.currentUser);
    }
  }).catch((err) => {
    suppressAutoRoute = false;
    if (err && err.code) showAuthError(mapAuthError(err));
    routeUser(auth.currentUser);
  });

  auth.onAuthStateChanged(routeUser);
})();

// ---------------------------------------------------------
// 10. DASHBOARD (unchanged logic from dashboard.js, wrapped so it
//     boots only once verification is confirmed)
// ---------------------------------------------------------
let employees = [];
let editingEmployeeId = null;
let salaryInputs = {};
let companyProfile = { name: '', accountNumber: '', ifsc: '', sysId: '', bankName: 'SBI' };
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
    toast('Could not load your account: ' + err.message, 'error');
    return;
  }

  initDisbursementDateFields();
  await Promise.all([loadEmployees(), loadCompanyProfile()]);
  renderEmployeeKpis();

  if (!dashboardBooted) {
    dashboardBooted = true;
    wireNav();
    wireEmployeeForm();
    wireEmployeeTableControls();
    wireBulkImport();
    wireDisbursement();
    wireAudit();
    wireExportHistory();
    wireCompanyForm();
    wireSettingsForms();
    wirePasswordToggles();
    wireModalCloseButtons();
    wireGuidedTour();
    document.getElementById('logoutBtn').onclick = () => auth.signOut();
    document.getElementById('employeeSearch').addEventListener('input', renderEmployeeTable);

    // First-ever dashboard visit for this browser: auto-start the tour.
    // Small delay so the employee table/KPIs have finished rendering and
    // the topbar/sidebar are laid out before we measure element rects.
    // localStorage can throw in private-browsing/locked-down contexts —
    // fall back to just always showing the tour rather than erroring out.
    let tourAlreadySeen = false;
    try { tourAlreadySeen = !!localStorage.getItem('payflow-tour-seen'); } catch (e) { /* ignore */ }
    if (!tourAlreadySeen) {
      setTimeout(() => startTour(), 600);
    }
  }
}

// ---------------------------------------------------------
// GUIDED TOUR — first-login spotlight walkthrough.
// Each step points at a real, always-visible element (topbar tabs,
// sidebar icons, the Employees-page action buttons) so nothing needs
// to be faked — no page switch required since the Employees page is
// already the default active page when the tour starts.
// ---------------------------------------------------------
const TOUR_STEPS = [
  {
    target: '.nav-item[data-page="settings"]',
    title: 'Company Details se shuru karein',
    body: 'Sabse pehle yahan aakar apni company ka naam, bank aur account number bhar dein. Yehi details har exported payment file par print hoti hain.'
  },
  {
    target: '#addEmployeeBtn',
    title: 'Employee add karein',
    body: 'Yahan click karke ek-ek employee ka naam, account number, IFSC, mobile aur email daalein.'
  },
  {
    target: '#bulkImportBtn',
    title: 'Ek saath bahut se employees add karein',
    body: 'Poori list ek baar me chahiye to sample CSV download karein, use bharein, aur yahan se bulk import kar dein. Import se pehle ek preview dikhega jisme galat rows highlight ho jaati hain.'
  },
  {
    target: '.topbar__tabs .nav-item[data-page="disbursement"]',
    title: 'Payroll Run',
    body: 'Har employee ke saamne is mahine ka amount bharein, transfer type chunein aur bank-ready file export karein.'
  },
  {
    target: '.topbar__tabs .nav-item[data-page="exports"]',
    title: 'Exports',
    body: 'Pehle export ki hui saari batches yahan milengi — dobara download bhi kar sakte hain.'
  },
  {
    target: '.sidebar-icons .nav-item[data-page="audit"]',
    title: 'Activity Log',
    body: 'Har add, edit, delete aur export yahan automatically track hota hai — kisne kab kya kiya.'
  },
  {
    target: '.user-chip',
    title: 'Aapka profile',
    body: 'Yahan aapka naam/email dikhta hai, aur neeche Logout button bhi hai. Bas ho gaya — ab explore karein!'
  }
];

let tourStepIndex = 0;
let tourEls = null; // { backdrop, spotlight, card }

function wireGuidedTour() {
  const helpBtn = document.getElementById('tourHelpBtn');
  if (helpBtn) helpBtn.addEventListener('click', () => startTour());

  const replayBtn = document.getElementById('replayTourBtn');
  if (replayBtn) replayBtn.addEventListener('click', () => {
    showAppPage('employees'); // tour steps assume the Employees page is active
    startTour();
  });
}

function startTour() {
  if (tourEls) endTour(); // guard against double-start
  tourStepIndex = 0;

  const backdrop = document.createElement('div');
  backdrop.className = 'tour-backdrop';
  const spotlight = document.createElement('div');
  spotlight.className = 'tour-spotlight';
  const card = document.createElement('div');
  card.className = 'tour-card';

  document.body.append(backdrop, spotlight, card);
  tourEls = { backdrop, spotlight, card };

  window.addEventListener('resize', repositionTourStep);
  renderTourStep();
}

function endTour() {
  if (!tourEls) return;
  window.removeEventListener('resize', repositionTourStep);
  tourEls.backdrop.remove();
  tourEls.spotlight.remove();
  tourEls.card.remove();
  tourEls = null;
  try { localStorage.setItem('payflow-tour-seen', '1'); } catch (e) { /* ignore */ }
}

function renderTourStep() {
  if (!tourEls) return;
  const step = TOUR_STEPS[tourStepIndex];
  const target = document.querySelector(step.target);

  // If a target isn't in the DOM for some reason, skip straight past
  // it rather than leaving the spotlight stuck on nothing.
  if (!target) {
    if (tourStepIndex < TOUR_STEPS.length - 1) { tourStepIndex++; renderTourStep(); }
    else endTour();
    return;
  }

  const isLast = tourStepIndex === TOUR_STEPS.length - 1;
  const isFirst = tourStepIndex === 0;

  tourEls.card.innerHTML = `
    <div class="tour-card__step">Step ${tourStepIndex + 1} of ${TOUR_STEPS.length}</div>
    <div class="tour-card__title">${step.title}</div>
    <div class="tour-card__body">${step.body}</div>
    <div class="tour-card__actions">
      <div class="tour-card__dots">
        ${TOUR_STEPS.map((_, i) => `<span class="tour-card__dot${i === tourStepIndex ? ' active' : ''}"></span>`).join('')}
      </div>
      <div class="tour-card__nav">
        <button type="button" class="tour-card__skip" id="tourSkipBtn">Skip</button>
        ${!isFirst ? '<button type="button" class="tour-card__back" id="tourBackBtn">Back</button>' : ''}
        <button type="button" class="tour-card__next" id="tourNextBtn">${isLast ? 'Done' : 'Next'}</button>
      </div>
    </div>
  `;

  tourEls.card.querySelector('#tourSkipBtn').onclick = endTour;
  tourEls.card.querySelector('#tourNextBtn').onclick = () => {
    if (isLast) { endTour(); return; }
    tourStepIndex++;
    renderTourStep();
  };
  const backBtn = tourEls.card.querySelector('#tourBackBtn');
  if (backBtn) backBtn.onclick = () => { tourStepIndex--; renderTourStep(); };

  positionTourAround(target);
}

// Positions the spotlight cutout directly over the target's bounding
// box (with a small padding), then places the tooltip card below it
// if there's room, or above it if the target is near the bottom of
// the viewport — clamped horizontally so it never runs off-screen.
function positionTourAround(target) {
  const rect = target.getBoundingClientRect();
  const pad = 6;

  tourEls.spotlight.style.top = (rect.top - pad) + 'px';
  tourEls.spotlight.style.left = (rect.left - pad) + 'px';
  tourEls.spotlight.style.width = (rect.width + pad * 2) + 'px';
  tourEls.spotlight.style.height = (rect.height + pad * 2) + 'px';

  const card = tourEls.card;
  const cardWidth = 290;
  const gap = 14;
  const spaceBelow = window.innerHeight - rect.bottom;
  const cardHeight = card.offsetHeight || 160;

  let top;
  if (spaceBelow > cardHeight + gap) {
    top = rect.bottom + gap;
  } else if (rect.top > cardHeight + gap) {
    top = rect.top - cardHeight - gap;
  } else {
    top = Math.max(12, window.innerHeight / 2 - cardHeight / 2);
  }

  let left = rect.left + rect.width / 2 - cardWidth / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - cardWidth - 12));

  card.style.top = top + 'px';
  card.style.left = left + 'px';
}

function repositionTourStep() {
  if (!tourEls) return;
  const step = TOUR_STEPS[tourStepIndex];
  const target = document.querySelector(step.target);
  if (target) positionTourAround(target);
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
  monthEl.textContent = '…';
  lastEl.textContent = '…';
  lastSubEl.textContent = '';

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

// Generic page navigation, shared by the topbar tabs, the Settings
// list items (Edit Company Details), and any code that needs to jump
// to a specific page programmatically (e.g. redirecting to Company
// Details when the profile is incomplete).
function showAppPage(page) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');
  document.querySelectorAll('#screen-dashboard main > section').forEach(s => s.classList.add('hidden'));
  const section = document.getElementById('page-' + page);
  if (section) section.classList.remove('hidden');
  if (page === 'audit') loadAuditTrail();
  if (page === 'exports') loadExportHistory();
}
function goToPage(page) { showAppPage(page); }

function wireNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => showAppPage(item.dataset.page));
  });
  document.getElementById('companyBackToSettings').addEventListener('click', (e) => {
    e.preventDefault();
    showAppPage('settings');
  });
}

// Renders N placeholder rows into a <tbody> while a Firestore read is
// in flight, so the table isn't just blank/frozen on a slow connection.
function renderSkeletonRows(tbody, colCount, rowCount) {
  tbody.innerHTML = Array.from({ length: rowCount }, () =>
    `<tr class="skeleton-row">${'<td><span class="skeleton-bar"></span></td>'.repeat(colCount)}</tr>`
  ).join('');
}

async function loadEmployees() {
  const tbody = document.getElementById('employeeTableBody');
  renderSkeletonRows(tbody, 9, 4);
  try {
    employees = await Api.getEmployees();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger);">Could not load employees: ${escapeHtml(err.message)}</td></tr>`;
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

// Sort state persists across re-renders (search, add/edit/delete) so the
// chosen order doesn't reset itself every time the table redraws.
let employeeSort = { key: null, dir: 1 };
let selectedEmployeeIds = new Set();

// ---------------------------------------------------------
// SOFT DELETE + UNDO (Employees)
// The row is removed from the UI (and from `employees`) immediately,
// but the actual Firestore delete is delayed by UNDO_WINDOW_MS. If the
// user hits "Undo" on the toast within that window, the row is simply
// put back and Firestore is never touched. Otherwise the delete is
// committed silently once the window elapses.
// ---------------------------------------------------------
const UNDO_WINDOW_MS = 5000;
let pendingEmployeeDeletions = new Map(); // id -> { emp, timer }

function refreshAfterEmployeeListChange() {
  renderEmployeeTable();
  renderDisbursementList();
  renderEmployeeKpis();
}

function softDeleteEmployees(ids, emps) {
  employees = employees.filter(e => !ids.includes(e.id));
  refreshAfterEmployeeListChange();

  const timer = setTimeout(async () => {
    ids.forEach(id => pendingEmployeeDeletions.delete(id));
    try {
      await Promise.all(ids.map(id => Api.deleteEmployee(id)));
      const names = emps.map(e => e && e.name).filter(Boolean);
      if (ids.length > 1) {
        await Api.logAudit(currentUser.email, currentUser.displayName, 'BULK DELETE EMPLOYEES',
          `Deleted ${ids.length}: ${names.join(', ')}`);
      } else {
        const emp = emps[0];
        await Api.logAudit(currentUser.email, currentUser.displayName, 'DELETE EMPLOYEE',
          `Deleted: ${emp ? emp.name : ''} | Acc: ${emp ? emp.accountNumber : ids[0]}`);
      }
    } catch (err) {
      toast('Delete failed: ' + err.message, 'error');
      await loadEmployees();
      renderEmployeeKpis();
    }
  }, UNDO_WINDOW_MS);

  ids.forEach(id => pendingEmployeeDeletions.set(id, { timer }));

  const label = ids.length > 1 ? `${ids.length} employees deleted.` : `${(emps[0] && emps[0].name) || 'Employee'} deleted.`;
  toast(label, 'success', {
    actionLabel: 'Undo',
    duration: UNDO_WINDOW_MS,
    onAction: () => {
      const stillPending = ids.some(id => pendingEmployeeDeletions.has(id));
      if (!stillPending) return; // window already elapsed / already committed
      clearTimeout(timer);
      ids.forEach(id => pendingEmployeeDeletions.delete(id));
      emps.forEach(emp => { if (emp && !employees.some(e => e.id === emp.id)) employees.push(emp); });
      refreshAfterEmployeeListChange();
      toast(ids.length > 1 ? `${ids.length} employees restored.` : `${(emps[0] && emps[0].name) || 'Employee'} restored.`, 'info');
    }
  });
}

function sortRows(rows, key, dir) {
  if (!key) return rows;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...rows].sort((a, b) => dir * collator.compare(String(a[key] ?? ''), String(b[key] ?? '')));
}

function updateEmployeeSortHeaders() {
  document.querySelectorAll('#page-employees th.sortable').forEach(th => {
    const active = th.dataset.sort === employeeSort.key;
    th.classList.toggle('sort-active', active);
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = active && employeeSort.dir === -1 ? '▼' : '▲';
  });
}

function updateEmployeeBulkBar() {
  const bar = document.getElementById('employeeBulkBar');
  const count = selectedEmployeeIds.size;
  bar.classList.toggle('hidden', count === 0);
  document.getElementById('employeeSelectedCount').textContent = count;
}

function renderEmployeeTable() {
  const tbody = document.getElementById('employeeTableBody');
  const emptyState = document.getElementById('employeeEmptyState');
  const query = (document.getElementById('employeeSearch').value || '').trim().toLowerCase();

  // Drop selections for employees no longer in the current employee list
  // (e.g. after a delete), so the count stays accurate.
  const currentIds = new Set(employees.map(e => e.id));
  selectedEmployeeIds.forEach(id => { if (!currentIds.has(id)) selectedEmployeeIds.delete(id); });

  let filtered = employees.filter(e =>
    !query || e.name.toLowerCase().includes(query) || String(e.accountNumber).includes(query));
  filtered = sortRows(filtered, employeeSort.key, employeeSort.dir);
  updateEmployeeSortHeaders();

  tbody.innerHTML = '';
  if (!filtered.length) {
    emptyState.classList.remove('hidden');
    updateEmployeeBulkBar();
    return;
  }
  emptyState.classList.add('hidden');

  filtered.forEach(emp => {
    const tr = document.createElement('tr');
    const checked = selectedEmployeeIds.has(emp.id) ? 'checked' : '';
    tr.innerHTML = `
      <td class="row-select-cell"><input type="checkbox" data-select="${escapeHtml(emp.id)}" ${checked} aria-label="Select ${escapeHtml(emp.name)}"></td>
      <td>${escapeHtml(emp.name)}</td>
      <td><span class="masked-acc"><span data-full="${escapeHtml(emp.accountNumber)}" data-revealed="0">${escapeHtml(maskAccount(emp.accountNumber))}</span><button type="button">Show</button></span></td>
      <td>${escapeHtml(emp.ifsc)}</td>
      <td>${badgeForMode(emp.transferType)}</td>
      <td>${escapeHtml(emp.empCode)}</td>
      <td>${escapeHtml(emp.mobile || '—')}</td>
      <td>${escapeHtml(emp.email || '—')}</td>
      <td class="row-actions">
        <button data-edit="${escapeHtml(emp.id)}">Edit</button>
        <button data-delete="${escapeHtml(emp.id)}" class="danger">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openEditModal(btn.dataset.edit));
  tbody.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => handleDelete(btn.dataset.delete));
  tbody.querySelectorAll('[data-select]').forEach(cb => cb.onchange = () => {
    if (cb.checked) selectedEmployeeIds.add(cb.dataset.select);
    else selectedEmployeeIds.delete(cb.dataset.select);
    updateEmployeeBulkBar();
    const allCb = document.getElementById('employeeSelectAll');
    if (allCb) allCb.checked = filtered.length > 0 && filtered.every(e => selectedEmployeeIds.has(e.id));
  });
  wireMaskedAccountToggles(tbody);
  updateEmployeeBulkBar();
}

function wireEmployeeTableControls() {
  document.querySelectorAll('#page-employees th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (employeeSort.key === key) employeeSort.dir *= -1;
      else employeeSort = { key, dir: 1 };
      renderEmployeeTable();
    });
  });

  document.getElementById('employeeSelectAll').addEventListener('change', (e) => {
    const query = (document.getElementById('employeeSearch').value || '').trim().toLowerCase();
    const visible = employees.filter(emp =>
      !query || emp.name.toLowerCase().includes(query) || String(emp.accountNumber).includes(query));
    if (e.target.checked) visible.forEach(emp => selectedEmployeeIds.add(emp.id));
    else visible.forEach(emp => selectedEmployeeIds.delete(emp.id));
    renderEmployeeTable();
  });

  document.getElementById('employeeBulkClearBtn').addEventListener('click', () => {
    selectedEmployeeIds.clear();
    renderEmployeeTable();
  });

  document.getElementById('employeeBulkDeleteBtn').addEventListener('click', async () => {
    const ids = [...selectedEmployeeIds];
    if (!ids.length) return;
    const ok = await confirmDialog(
      `Delete ${ids.length} selected employee${ids.length === 1 ? '' : 's'}? You'll have a few seconds to undo.`,
      { title: 'Delete Selected Employees' }
    );
    if (!ok) return;
    const emps = ids.map(id => employees.find(e => e.id === id)).filter(Boolean);
    selectedEmployeeIds.clear();
    softDeleteEmployees(ids, emps);
  });
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
// Strips any non-digit character as the user types (or pastes, drag-drops,
// autofills, etc. — anything that fires an 'input' event). Used for
// Employee Code and Account Number fields, which must be numeric only;
// IFSC stays untouched since it's genuinely alphanumeric (e.g. SBIN0001234).
function digitsOnlyLive(el) {
  el.addEventListener('input', () => {
    const pos = el.selectionStart;
    const digits = el.value.replace(/[^0-9]/g, '');
    if (digits !== el.value) {
      const removed = el.value.length - digits.length;
      el.value = digits;
      try { el.setSelectionRange(pos - removed, pos - removed); } catch (_) {}
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
  const fMobile = document.getElementById('empMobile');
  const fEmail  = document.getElementById('empEmail');
  const fAcc    = document.getElementById('empAccount');
  const fAccC   = document.getElementById('empAccountConfirm');
  const fIfsc   = document.getElementById('empIfsc');
  const fIfscC  = document.getElementById('empIfscConfirm');
  const accMismatchLbl  = document.getElementById('accMismatchLbl');
  const ifscMismatchLbl = document.getElementById('ifscMismatchLbl');
  const mobileErrLbl = document.getElementById('empMobileError');
  const emailErrLbl  = document.getElementById('empEmailError');

  // Name fields: no spaces within a single box, auto-uppercase as-you-type
  [fFirst, fMiddle, fLast].forEach(el => { blockSpaceKey(el); autoUpperCaseLive(el); });
  // Emp code: numeric only, no spaces
  blockSpaceKey(fCode);
  digitsOnlyLive(fCode);
  // Mobile: digits only, max 10, no spaces
  blockSpaceKey(fMobile);
  fMobile.addEventListener('input', () => {
    fMobile.value = fMobile.value.replace(/[^0-9]/g, '').slice(0, 10);
    validateMobileEmailLive();
  });
  fEmail.addEventListener('input', validateMobileEmailLive);

  function validateMobileEmailLive() {
    const mobileVal = fMobile.value.trim();
    if (!mobileVal) { mobileErrLbl.textContent = ''; fMobile.classList.remove('input-mismatch'); }
    else if (!/^[6-9][0-9]{9}$/.test(mobileVal)) {
      mobileErrLbl.textContent = 'Enter a valid 10-digit mobile number';
      fMobile.classList.add('input-mismatch');
    } else { mobileErrLbl.textContent = ''; fMobile.classList.remove('input-mismatch'); }

    const emailVal = fEmail.value.trim();
    if (!emailVal) { emailErrLbl.textContent = ''; fEmail.classList.remove('input-mismatch'); }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      emailErrLbl.textContent = 'Enter a valid email address';
      fEmail.classList.add('input-mismatch');
    } else { emailErrLbl.textContent = ''; fEmail.classList.remove('input-mismatch'); }
  }
  // Account / IFSC pairs: no spaces, no paste/right-click paste
  [fAcc, fAccC, fIfsc, fIfscC].forEach(el => { blockSpaceKey(el); blockPasteAndRightClick(el); });
  // Account Number is numeric only; IFSC stays alphanumeric (bank codes
  // like SBIN0001234 genuinely mix letters and digits) and just gets
  // auto-uppercased as before.
  [fAcc, fAccC].forEach(el => digitsOnlyLive(el));
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
  function existingEmpCodes() {
    return employees
      .filter(e => e.id !== editingEmployeeId)
      .map(e => String(e.empCode));
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
    [fAcc, fAccC, fIfsc, fIfscC, fMobile, fEmail].forEach(clearMatchStyles);
    accMismatchLbl.textContent = '';
    ifscMismatchLbl.textContent = '';
    mobileErrLbl.textContent = '';
    emailErrLbl.textContent = '';
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
    fMobile.value = emp.mobile || '';
    fEmail.value = emp.email || '';
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
    const mobile = fMobile.value.trim();
    const email  = fEmail.value.trim().toLowerCase();

    // Required-field check — Middle Name is the sole optional field.
    if (!(fname && lname && acc && accC && ifsc && ifscC && empCode && mobile && email)) {
      showFieldError('Please fill in all required fields before saving. (Middle Name is optional)');
      return;
    }
    if (!/^[6-9][0-9]{9}$/.test(mobile)) {
      showFieldError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showFieldError('Please enter a valid email address.');
      return;
    }
    // Employee Code and Account Number must be numeric only — the fields
    // already filter this live, but this catches anything that slips
    // through (e.g. a value set programmatically) before it gets saved.
    if (!/^[0-9]+$/.test(empCode)) {
      showFieldError('Employee Code must contain numbers only.');
      return;
    }
    if (!/^[0-9]+$/.test(acc) || !/^[0-9]+$/.test(accC)) {
      showFieldError('Account Number must contain numbers only.');
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
    // Emp Code feeds directly into the SBI batch reference string, so a
    // collision there produces two rows with a near-identical reference.
    if (existingEmpCodes().includes(empCode)) {
      showFieldError(`Emp Code ${empCode} is already assigned to another employee in the ledger.`);
      return;
    }

    const emp = { name: fullName, accountNumber: acc, ifsc, empCode, transferType, mobile, email };

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
    const ok = await confirmDialog(`Delete ${emp ? emp.name : id}? You'll have a few seconds to undo.`, { title: 'Delete Employee' });
    if (!ok) return;
    softDeleteEmployees([id], [emp]);
  };
}

// A ready-to-fill CSV using the exact headers parseCsv() expects, with
// one example row — closes the gap where the required column names
// only ever existed in source code, not anywhere in the UI.
function downloadSampleCsv() {
  const sample = [
    'Employee Name,Account Number,IFSC_BranchCode,Transfer Type,Emp Code',
    'JOHN DOE,123456789012,SBIN0001234,Same Bank,01'
  ].join('\r\n') + '\r\n';
  downloadTextFile('payflow_bulk_import_sample.csv', sample, 'text/csv;charset=utf-8');
}

// Exports the full current Employee Ledger back out as CSV, in the same
// column layout the Bulk Import expects — so the ledger can round-trip
// out for backup/editing and back in again.
function exportLedgerCsv() {
  if (!employees.length) { toast('No employees to export yet.', 'error'); return; }
  const header = 'Employee Name,Account Number,IFSC_BranchCode,Transfer Type,Emp Code';
  const rows = employees.map(e => csvRow([e.name, e.accountNumber, e.ifsc, e.transferType, e.empCode]));
  const content = [header, ...rows].join('\r\n') + '\r\n';
  downloadTextFile(`payflow_employee_ledger_${new Date().toISOString().slice(0, 10)}.csv`, content, 'text/csv;charset=utf-8');
}

// Parsed-but-not-yet-imported rows/errors, held between the preview
// modal being shown and the user confirming the import.
let pendingImportRows = [];
let pendingImportErrors = [];

function wireBulkImport() {
  const fileInput = document.getElementById('bulkImportInput');
  document.getElementById('bulkImportBtn').onclick = () => fileInput.click();
  document.getElementById('downloadSampleCsvLink').addEventListener('click', (e) => {
    e.preventDefault();
    downloadSampleCsv();
  });
  document.getElementById('exportLedgerCsvBtn').addEventListener('click', exportLedgerCsv);
  document.getElementById('importResultCloseBtn').addEventListener('click', () =>
    document.getElementById('importResultModal').classList.add('hidden'));

  // Selecting a file only parses and validates it — nothing is written
  // to the ledger yet. The user reviews exactly what will and won't be
  // imported in the preview modal below and has to explicitly confirm.
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const existingAccounts = employees.map(e => String(e.accountNumber));
      const { rows, errors } = parseCsv(text, existingAccounts);
      pendingImportRows = rows;
      pendingImportErrors = errors;
      showImportPreviewModal(rows, errors);
    } catch (err) {
      toast('Could not read file: ' + err.message, 'error');
    } finally {
      fileInput.value = '';
    }
  });

  document.getElementById('cancelImportPreviewBtn').addEventListener('click', () => {
    document.getElementById('importPreviewModal').classList.add('hidden');
    pendingImportRows = []; pendingImportErrors = [];
  });

  document.getElementById('confirmImportBtn').addEventListener('click', async () => {
    if (!pendingImportRows.length) {
      document.getElementById('importPreviewModal').classList.add('hidden');
      return;
    }
    const btn = document.getElementById('confirmImportBtn');
    btn.disabled = true; btn.textContent = 'Importing...';
    try {
      await Api.bulkAddEmployees(pendingImportRows);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'BULK IMPORT',
        `${pendingImportRows.length} employees imported${pendingImportErrors.length ? `, ${pendingImportErrors.length} row(s) skipped` : ''}`);
      await loadEmployees();
      document.getElementById('importPreviewModal').classList.add('hidden');
      showImportResultModal(pendingImportRows.length, pendingImportErrors);
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      pendingImportRows = []; pendingImportErrors = [];
    }
  });
}

// Renders the pre-import review: every row that parsed cleanly (green,
// "Will import") and every row that failed validation (red, with its
// exact reason) — so a bad file is caught and understood before a
// single record reaches the ledger, instead of only finding out after.
function showImportPreviewModal(rows, errors) {
  const summary = document.getElementById('importPreviewSummary');
  summary.innerHTML = `
    <span style="color:var(--success); font-weight:700;">${rows.length} row${rows.length === 1 ? '' : 's'} will be imported</span>
    ${errors.length ? ` &nbsp;•&nbsp; <span style="color:var(--danger); font-weight:700;">${errors.length} row${errors.length === 1 ? '' : 's'} will be skipped</span>` : ''}`;

  const tbody = document.getElementById('importPreviewTableBody');
  tbody.innerHTML = '';

  // Guards against freezing the tab on a very large file — everything
  // past this many rows is still imported/skipped exactly the same,
  // it's just not individually listed in the preview table.
  const MAX_ROWS = 500;
  let shown = 0;

  rows.forEach((r, i) => {
    if (shown >= MAX_ROWS) return;
    shown++;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${escapeHtml(r.empCode)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td style="font-family:var(--font-mono);">${escapeHtml(maskAccount(r.accountNumber))}</td>
      <td style="font-family:var(--font-mono);">${escapeHtml(r.ifsc)}</td>
      <td>${escapeHtml(r.transferType)}</td>
      <td><span class="badge badge-green">✓ Will import</span></td>`;
    tbody.appendChild(tr);
  });
  errors.forEach(e => {
    if (shown >= MAX_ROWS) return;
    shown++;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>Line ${e.line}</td>
      <td colspan="4" style="color:var(--text2);">${escapeHtml(e.reason)}</td>
      <td>—</td>
      <td><span class="badge" style="color:var(--danger); border-color:var(--danger);">✗ Skipped</span></td>`;
    tbody.appendChild(tr);
  });

  if (rows.length + errors.length > MAX_ROWS) {
    const note = document.createElement('tr');
    note.innerHTML = `<td colspan="7" style="color:var(--text3); text-align:center; padding:12px;">+ ${rows.length + errors.length - MAX_ROWS} more row(s) not listed — they will be processed the same way.</td>`;
    tbody.appendChild(note);
  }

  const confirmBtn = document.getElementById('confirmImportBtn');
  confirmBtn.textContent = rows.length ? `Import ${rows.length} Employee${rows.length === 1 ? '' : 's'}` : 'Nothing to Import';
  confirmBtn.disabled = !rows.length;

  document.getElementById('importPreviewModal').classList.remove('hidden');
}

// Shows a clear summary of what was imported vs skipped, with the exact
// line number and reason for every skipped row — replaces the old silent
// "Imported N employees" alert that gave no visibility into failures.
function showImportResultModal(importedCount, errors) {
  const body = document.getElementById('importResultBody');
  const okLine = `<p style="color:var(--success); font-weight:600;">${importedCount} employee${importedCount === 1 ? '' : 's'} imported successfully.</p>`;
  const errLines = errors.length
    ? `<p style="color:var(--danger); font-weight:600; margin-top:10px;">${errors.length} row(s) skipped:</p>
       <div style="max-height:220px; overflow-y:auto; font-size:12.5px; font-family:var(--font-mono); line-height:1.7; background:var(--surface2); border-radius:var(--radius-sm); padding:10px 12px;">
         ${errors.map(e => `Line ${e.line}: ${escapeHtml(e.reason)}`).join('<br>')}
       </div>`
    : '';
  body.innerHTML = okLine + errLines;
  document.getElementById('importResultModal').classList.remove('hidden');
}

const VALID_TRANSFER_TYPES = ['Same Bank', 'Other Bank'];

// Returns { rows, errors } instead of just an array, so the caller can
// tell the user exactly which CSV lines were skipped and why, rather
// than silently dropping bad rows or letting bad data slip in.
//   rows[]   — well-formed candidate employees, ready for the duplicate
//              check the caller still needs to run against existingAccounts
//   errors[] — { line, reason } for every row that failed validation
function parseCsv(text, existingAccounts) {
  const existing = new Set((existingAccounts || []).map(String));
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { rows: [], errors: [] };
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idxAcc  = headers.indexOf('account number');
  const idxIfsc = headers.indexOf('ifsc_branchcode');
  const idxName = headers.indexOf('employee name');
  const idxType = headers.indexOf('transfer type');
  const idxCode = headers.indexOf('emp code');

  const rows = [];
  const errors = [];
  const seenInFile = new Set(); // catches duplicates WITHIN the same CSV
  const seenCodes = new Set();

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1; // 1-based, matches what a spreadsheet app would show
    const cols = lines[i].split(',').map(c => c.trim());
    // Account Number and Emp Code are numeric-only fields — strip any
    // stray letters/symbols from the CSV the same way the manual Add
    // Employee form does, so bulk import can't bypass that rule.
    const accountNumber = (cols[idxAcc >= 0 ? idxAcc : 0] || '').replace(/[^0-9]/g, '');
    const ifsc = (cols[idxIfsc >= 0 ? idxIfsc : 1] || '').toUpperCase();
    const name = (cols[idxName >= 0 ? idxName : 2] || '').toUpperCase();
    const rawType = (cols[idxType >= 0 ? idxType : 3] || 'Same Bank').trim();
    const empCode = ((cols[idxCode >= 0 ? idxCode : 4] || '01').replace(/[^0-9]/g, '') || '01').padStart(2, '0');

    if (!accountNumber || !name) {
      errors.push({ line: lineNo, reason: 'Missing Account Number or Employee Name.' });
      continue;
    }
    // Case/whitespace-tolerant match against "Same Bank" / "Other Bank" —
    // anything else (typo, blank, unexpected value) is rejected outright
    // rather than silently defaulting, since a wrong value here makes an
    // employee vanish from the SBI Disbursement list with no warning.
    const transferType = VALID_TRANSFER_TYPES.find(t => t.toLowerCase() === rawType.toLowerCase());
    if (!transferType) {
      errors.push({ line: lineNo, reason: `Invalid Transfer Type "${rawType}" — must be "Same Bank" or "Other Bank".` });
      continue;
    }
    if (existing.has(accountNumber) || seenInFile.has(accountNumber)) {
      errors.push({ line: lineNo, reason: `Duplicate Account Number ${accountNumber} (already in ledger or repeated in this file).` });
      continue;
    }
    if (seenCodes.has(empCode)) {
      errors.push({ line: lineNo, reason: `Duplicate Emp Code ${empCode} within this file.` });
      continue;
    }
    seenInFile.add(accountNumber);
    seenCodes.add(empCode);
    rows.push({ accountNumber, ifsc, name, transferType, empCode });
  }
  return { rows, errors };
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

// Validates a Payroll Run amount field using the same clean
// validation-style UI as the Account Number / IFSC confirmation
// fields elsewhere in the app (input-match / input-mismatch classes)
// instead of a separate red/green status dot.
function validateLiveAmountEntry(inputEl, warnEl) {
  const v = inputEl.value.trim();
  warnEl.textContent = '';
  inputEl.classList.remove('input-mismatch', 'input-match');
  if (!v) {
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
    inputEl.classList.add('input-mismatch');
    warnEl.textContent = '⚠ INVALID FORMAT';
  } else {
    const val = parseFloat(v);
    if (!isNaN(val) && val > 0) {
      inputEl.classList.add('input-match');
    } else {
      inputEl.classList.add('input-mismatch');
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
    const prefill = (emp.lastAmount !== undefined && emp.lastAmount !== null) ? Number(emp.lastAmount).toFixed(2) : '';
    tr.innerHTML = `
      <td>${escapeHtml(emp.empCode)}</td>
      <td>${escapeHtml(emp.name)}</td>
      <td><span class="masked-acc"><span data-full="${escapeHtml(emp.accountNumber)}" data-revealed="0">${escapeHtml(maskAccount(emp.accountNumber))}</span><button type="button">Show</button></span></td>
      <td><span data-mode>${isSbi ? badgeForMode(tft) : badgeForMode('—')}</span></td>
      <td style="text-align:right;">
        <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px;">
          <span style="font-size:10px; color:var(--danger); font-weight:700;" data-warn></span>
          <input type="text" data-acc="${escapeHtml(emp.accountNumber)}" placeholder="0.00" value="${escapeHtml(prefill)}"
            title="${prefill ? 'Pre-filled from last export — review before sending' : ''}"
            style="width:120px; text-align:right; background:var(--surface2); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text); padding:6px 8px;">
        </div>
      </td>`;
    tbody.appendChild(tr);
    const inputEl = tr.querySelector('input');
    const warnEl  = tr.querySelector('[data-warn]');
    const modeEl  = tr.querySelector('[data-mode]');
    inputEl.addEventListener('input', () => {
      validateLiveAmountEntry(inputEl, warnEl);
      if (!isSbi) {
        const v = parseFloat(inputEl.value);
        modeEl.innerHTML = badgeForMode(currentModeFor(emp.ifsc, isNaN(v) ? 0 : v));
      }
    });
    // Keyboard-driven bulk entry: Tab and Enter both jump straight to
    // the next row's amount field (skipping the "Show" account-reveal
    // button in between), so a payroll clerk can key through the whole
    // batch without reaching for the mouse. Shift+Tab / Shift+Enter
    // goes back a row.
    inputEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' && e.key !== 'Enter') return;
      e.preventDefault();
      const inputs = Array.from(tbody.querySelectorAll('input[data-acc]'));
      const idx = inputs.indexOf(inputEl);
      const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
      const nextInput = inputs[nextIdx];
      if (nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    });
    const prefillAmt = parseFloat(prefill);
    if (!isSbi) modeEl.innerHTML = badgeForMode(currentModeFor(emp.ifsc, isNaN(prefillAmt) ? 0 : prefillAmt));
    if (prefill) validateLiveAmountEntry(inputEl, warnEl);
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
      const warnEl  = tr.querySelector('[data-warn]');
      if (inputEl) { inputEl.value = ''; inputEl.classList.remove('input-match', 'input-mismatch'); }
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
// Company Details no longer has its own top-level nav tab (it lives
// under Settings), so jumping there just shows the page section
// directly and opens it in Edit mode, since the caller only does
// this when the profile still needs to be filled in.
function goToCompanyPage() {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('#screen-dashboard main > section').forEach(s => s.classList.add('hidden'));
  document.getElementById('page-company').classList.remove('hidden');
  setCompanyEditMode(true);
}

// A basic IFSC format check — 4 letters, a fixed 0, then 6 alphanumerics.
// Not a substitute for verifying the branch actually exists, but it
// catches the obvious typo/paste-error case before the file goes out.
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function buildExportWarnings(isSbi, tft, lines) {
  const warnings = [];

  // Employees who are eligible for this batch (right transfer type, for
  // SBI) but were left with a blank/zero amount — flagged so a payday
  // omission isn't discovered only after the file's already gone out.
  const eligible = employees.filter(e => (isSbi ? e.transferType === tft : true));
  const includedAccounts = new Set(lines.map(l => l.acc));
  const skipped = eligible.filter(e => !includedAccounts.has(String(e.accountNumber)));
  if (skipped.length) {
    const names = skipped.slice(0, 5).map(e => e.name).join(', ');
    warnings.push(`${skipped.length} employee${skipped.length === 1 ? '' : 's'} eligible for this batch ${skipped.length === 1 ? 'has' : 'have'} no amount entered and will be skipped: ${names}${skipped.length > 5 ? ', ...' : ''}.`);
  }

  const badIfsc = lines.filter(l => !IFSC_RE.test(l.ifsc));
  if (badIfsc.length) {
    warnings.push(`${badIfsc.length} row(s) have an IFSC that doesn't match the standard format (4 letters + 0 + 6 characters): ${badIfsc.slice(0, 5).map(l => l.name).join(', ')}${badIfsc.length > 5 ? ', ...' : ''}.`);
  }

  // Flags amounts far outside the batch's normal range — a common
  // symptom of a misplaced decimal or a pasted-in wrong figure.
  if (lines.length >= 3) {
    const amounts = lines.map(l => l.amount).sort((a, b) => a - b);
    const mid = amounts[Math.floor(amounts.length / 2)];
    const outliers = lines.filter(l => mid > 0 && (l.amount > mid * 5 || l.amount < mid / 5));
    if (outliers.length) {
      warnings.push(`${outliers.length} amount(s) look unusually far from the rest of this batch — double-check for a misplaced decimal: ${outliers.slice(0, 5).map(l => `${l.name} (₹${l.amount.toFixed(2)})`).join(', ')}${outliers.length > 5 ? ', ...' : ''}.`);
    }
  }

  return warnings;
}

async function openExportPreview() {
  if (!isCompanyProfileComplete()) {
    toast('Please fill company details to continue. Company Name, Account Number, Branch/Sys Code and Bank are required before you can export a payment file.', 'error');
    goToCompanyPage();
    return;
  }
  const { tft, lines, total, hasInvalid } = collectBatchLines();
  if (hasInvalid) { toast('One or more amounts are in an invalid format. Please check and try again.', 'error'); return; }
  if (!lines.length) { toast('Please enter at least one salary amount before exporting.', 'error'); return; }

  const txnDate = getTransferDateDDMMYYYY();
  if (!txnDate) { toast('Please select a Transfer Date before exporting.', 'error'); return; }

  // Re-resolve the company's IFSC from its Branch/System Code right
  // before the file is generated, so the exported file always carries
  // a freshly-verified IFSC rather than a possibly-stale cached one.
  const exportBtn = document.getElementById('disbExportBtn');
  const prevLabel = exportBtn.textContent;
  exportBtn.disabled = true;
  exportBtn.textContent = 'Verifying IFSC...';
  try {
    const freshIfsc = await resolveCompanyIfsc(companyProfile.bankName, companyProfile.sysId);
    if (freshIfsc !== companyProfile.ifsc) {
      companyProfile = { ...companyProfile, ifsc: freshIfsc };
      await Api.updateCompanyProfile(companyProfile);
      renderCompanySummary();
    }
  } catch (err) {
    exportBtn.disabled = false;
    exportBtn.textContent = prevLabel;
    toast(err.message, 'error');
    return;
  }
  exportBtn.disabled = false;
  exportBtn.textContent = prevLabel;

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

  // A last-look validation pass before the file is generated — catches
  // the kind of mistakes that would otherwise only surface after the
  // bank portal rejects the file (or worse, silently underpays someone).
  const warnings = buildExportWarnings(isSbi, tft, lines);
  const warningsHtml = warnings.length
    ? `<div style="margin-top:10px; padding:10px 12px; background:var(--danger-bg); border:1px solid var(--danger); border-radius:var(--radius-sm); color:var(--danger); font-size:12.5px; line-height:1.6;">
        ${warnings.map(w => `⚠ ${escapeHtml(w)}`).join('<br>')}
       </div>`
    : '';

  document.getElementById('exportPreviewBody').innerHTML = `
    ${modeSummary}
    <p><strong>Payroll Cycle:</strong> ${escapeHtml(monthName)} ${escapeHtml(year)}</p>
    <p><strong>Transfer Date:</strong> ${escapeHtml(txnDate)}</p>
    <p><strong>Employees:</strong> ${lines.length}</p>
    <p style="font-size:20px; color:var(--success); font-weight:700; margin-top:10px;">₹ ${total.toFixed(2)}</p>
    ${warningsHtml}
  `;
  document.getElementById('exportPreviewModal').classList.remove('hidden');
  const confirmBtn = document.getElementById('confirmExportBtn');
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Confirm → Export';
  confirmBtn.onclick = async () => {
    // Guards against a fast double-click firing two exports — each one
    // burns a batch counter value and writes its own ledger/audit rows,
    // so a duplicate click would otherwise produce two "real" exports.
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Exporting...';
    document.getElementById('exportPreviewModal').classList.add('hidden');
    await executeExport();
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm → Export';
  };
}

// Refactored executeExport(): resolves the company's bank, delegates
// file-content generation to that bank's BankFormatters strategy, and
// keeps the existing batch counter / disbursement history / audit
// logging behaviour unchanged for every bank.
// Works out the batch-ID prefix. For SBI this is unchanged (driven by
// the Same Bank / Other Bank selector). For every other bank the SBI-
// only selector is hidden and not meaningful, so instead we look at
// the actual per-row modes in this batch: NEFT/RTGS/IMPS map directly
// (they're already 4 letters), a batch that's 100% Same Bank gets
// SBST, and a batch mixing more than one mode gets MULT — so the
// batch ID always reflects what's really inside that file.
function getBatchPrefix(isSbi, tft, lines) {
  if (isSbi) return tft === 'Same Bank' ? 'SBST' : 'OBST';
  const modes = new Set(lines.map(l => l.mode));
  if (modes.size === 1) {
    const only = [...modes][0];
    return only === 'Same Bank' ? 'SBST' : only.toUpperCase().padEnd(4, 'X').slice(0, 4);
  }
  return 'MULT';
}

async function executeExport() {
  const { tft, lines, total } = collectBatchLines();
  const bankKey = companyProfile.bankName || 'SBI';
  const isSbi = bankKey === 'SBI';
  const bank = BANK_BY_KEY[bankKey] || BANK_BY_KEY.SBI;
  const formatter = BankFormatters[bankKey] || BankFormatters.SBI;

  const prefix = getBatchPrefix(isSbi, tft, lines);
  const { monthRaw, monthName, year } = getPayrollCycle();
  const shortYear = year.slice(2);
  const txnDate = getTransferDateDDMMYYYY();
  if (!txnDate) { toast('Please select a Transfer Date before exporting.', 'error'); return; }

  let seq;
  try {
    seq = await Api.getAndIncrementCounter();
  } catch (err) {
    toast('Could not generate batch number: ' + err.message, 'error');
    return;
  }
  const batchId = `${prefix}${shortYear}${monthRaw}${seq}`;
  const fileName = `${bankKey.toLowerCase()}_salary_${monthName}_${year}.${formatter.ext}`;

  // Every row carries a full snapshot of the company profile and payroll
  // cycle as they were AT THE TIME of this export — not just the
  // employee/amount fields. Without this, re-downloading an old batch
  // later would silently use today's company profile (which may have
  // since changed bank, account, or IFSC) instead of what was actually
  // used to generate that file originally.
  const logRows = lines.map(({ acc, empCode, name, ifsc, amount, mode }) => ({
    batchId, transferDate: txnDate, empCode, employeeName: name, accountNumber: acc, ifsc,
    amount: amount.toFixed(2), transferType: mode, bank: bankKey,
    monthName, year, monthRaw, shortYear, fileName,
    companySnapshot: {
      name: companyProfile.name, accountNumber: companyProfile.accountNumber,
      ifsc: companyProfile.ifsc, sysId: companyProfile.sysId, bankName: bankKey
    }
  }));

  const output = formatter.generate({
    companyProfile, lines, total, batchId, txnDate, monthRaw, shortYear, monthName, year, tft
  });

  downloadTextFile(fileName, output, formatter.mime);

  try {
    await Api.addDisbursementRows(logRows);
    await Api.logAudit(currentUser.email, currentUser.displayName, 'EXPORT FILE',
      `Batch: ${batchId} | Bank: ${bank.label} | Total: ₹${total.toFixed(2)} | Employees: ${lines.length} | File: ${fileName}`);
    // Remembers what each employee was paid in this batch, so next
    // cycle's Disbursement page can pre-fill the same amount instead of
    // starting blank — most salaries don't change month to month.
    await Api.updateEmployeeLastAmounts(
      lines.map(l => ({ accountNumber: l.acc, amount: l.amount }))
    );
    renderEmployeeKpis();
  } catch (err) {
    toast('File downloaded, but logging to the ledger failed: ' + err.message, 'error');
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
let auditSort = { key: null, dir: 1 }; // null = natural (Firestore) order: newest first

function wireAudit() {
  document.getElementById('auditSearch').addEventListener('input', renderAuditTable);
  document.getElementById('auditActionFilter').addEventListener('change', renderAuditTable);
  document.getElementById('auditFromDate').addEventListener('change', renderAuditTable);
  document.getElementById('auditToDate').addEventListener('change', renderAuditTable);
  document.getElementById('auditClearFiltersBtn').addEventListener('click', () => {
    document.getElementById('auditSearch').value = '';
    document.getElementById('auditActionFilter').value = '';
    document.getElementById('auditFromDate').value = '';
    document.getElementById('auditToDate').value = '';
    renderAuditTable();
  });
  document.querySelectorAll('#page-audit th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.auditSort;
      if (auditSort.key === key) auditSort.dir *= -1;
      else auditSort = { key, dir: 1 };
      renderAuditTable();
    });
  });
}
async function loadAuditTrail() {
  renderSkeletonRows(document.getElementById('auditTableBody'), 4, 5);
  try {
    auditRows = await Api.getAuditTrail();
  } catch (err) {
    document.getElementById('auditTableBody').innerHTML = `<tr><td colspan="4" style="color:var(--danger);">${escapeHtml(err.message)}</td></tr>`;
    return;
  }
  renderAuditTable();
}
function updateAuditSortHeaders() {
  document.querySelectorAll('#page-audit th.sortable').forEach(th => {
    const active = th.dataset.auditSort === auditSort.key;
    th.classList.toggle('sort-active', active);
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = active && auditSort.dir === -1 ? '▼' : '▲';
  });
}
function renderAuditTable() {
  const tbody = document.getElementById('auditTableBody');
  const emptyState = document.getElementById('auditEmptyState');
  const query = (document.getElementById('auditSearch').value || '').trim().toLowerCase();
  const actionFilter = document.getElementById('auditActionFilter').value;
  const fromVal = document.getElementById('auditFromDate').value; // "YYYY-MM-DD"
  const toVal = document.getElementById('auditToDate').value;     // "YYYY-MM-DD"
  // "To" is inclusive of the whole day, so compare against the start
  // of the following day rather than midnight of the same day.
  const fromDate = fromVal ? new Date(fromVal + 'T00:00:00') : null;
  const toDate = toVal ? new Date(toVal + 'T23:59:59.999') : null;

  let filtered = auditRows.filter(r => {
    if (query &&
      !(r.userEmail||'').toLowerCase().includes(query) &&
      !(r.action||'').toLowerCase().includes(query) &&
      !(r.details||'').toLowerCase().includes(query)) return false;
    if (actionFilter && r.action !== actionFilter) return false;
    if (fromDate || toDate) {
      const ts = r.timestamp && r.timestamp.toDate ? r.timestamp.toDate() : null;
      if (!ts) return false;
      if (fromDate && ts < fromDate) return false;
      if (toDate && ts > toDate) return false;
    }
    return true;
  });

  if (auditSort.key) {
    const dir = auditSort.dir;
    filtered = [...filtered].sort((a, b) => {
      if (auditSort.key === 'timestamp') {
        const ta = a.timestamp && a.timestamp.toDate ? a.timestamp.toDate().getTime() : 0;
        const tb = b.timestamp && b.timestamp.toDate ? b.timestamp.toDate().getTime() : 0;
        return dir * (ta - tb);
      }
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      return dir * collator.compare(String(a[auditSort.key] ?? ''), String(b[auditSort.key] ?? ''));
    });
  }
  updateAuditSortHeaders();

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

// ---------------------------------------------------------
// EXPORT HISTORY — groups the flat disbursement-row log back into
// per-batch summaries, and lets a batch be regenerated and
// re-downloaded using the exact company/IFSC snapshot from the time
// it was originally exported (not today's settings).
// ---------------------------------------------------------
let exportBatches = [];

async function loadExportHistory() {
  const tbody = document.getElementById('exportsTableBody');
  renderSkeletonRows(tbody, 6, 4);
  let rows = [];
  try {
    rows = await Api.getDisbursementHistory();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--danger);">Could not load export history: ${escapeHtml(err.message)}</td></tr>`;
    return;
  }

  const byBatch = new Map();
  rows.forEach(r => {
    if (!byBatch.has(r.batchId)) {
      byBatch.set(r.batchId, {
        batchId: r.batchId, bank: r.bank, transferDate: r.transferDate,
        monthName: r.monthName, year: r.year, fileName: r.fileName,
        companySnapshot: r.companySnapshot, createdAt: r.createdAt,
        rows: []
      });
    }
    byBatch.get(r.batchId).rows.push(r);
  });
  exportBatches = [...byBatch.values()].sort((a, b) => {
    const ta = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
    const tb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
    return tb - ta;
  });
  renderExportHistory();
}

function renderExportHistory() {
  const tbody = document.getElementById('exportsTableBody');
  const emptyState = document.getElementById('exportsEmptyState');
  const query = (document.getElementById('exportsSearch').value || '').trim().toLowerCase();

  const filtered = exportBatches.filter(b =>
    !query || b.batchId.toLowerCase().includes(query) || (b.bank || '').toLowerCase().includes(query));

  tbody.innerHTML = '';
  if (!filtered.length) { emptyState.classList.remove('hidden'); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(batch => {
    const total = batch.rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
    const bank = BANK_BY_KEY[batch.bank] || { label: batch.bank };
    const tr = document.createElement('tr');
    tr.className = 'export-batch-row';
    tr.innerHTML = `
      <td style="font-family:var(--font-mono);"><button type="button" class="row-expand-toggle" data-expand="${escapeHtml(batch.batchId)}" aria-label="Show employee-wise breakdown"><span class="row-expand-arrow">›</span> ${escapeHtml(batch.batchId)}</button></td>
      <td>${escapeHtml(bank.label)}</td>
      <td>${escapeHtml(batch.transferDate || '—')}</td>
      <td>${batch.rows.length}</td>
      <td style="text-align:right;">₹${total.toFixed(2)}</td>
      <td class="row-actions"><button data-redownload="${escapeHtml(batch.batchId)}">Re-download</button></td>`;
    tbody.appendChild(tr);

    // Hidden-by-default detail row: employee-wise amount breakdown for
    // this batch, so you can see exactly who was paid how much in a
    // given export without re-downloading and opening the file.
    const detailTr = document.createElement('tr');
    detailTr.className = 'export-batch-detail hidden';
    detailTr.dataset.detailFor = batch.batchId;
    const rowsSorted = [...batch.rows].sort((a, b) =>
      (a.employeeName || '').localeCompare(b.employeeName || ''));
    const detailRows = rowsSorted.map(r => `
      <tr>
        <td style="color:var(--text2); font-family:var(--font-mono); font-size:12px;">${escapeHtml(r.empCode || '—')}</td>
        <td>${escapeHtml(r.employeeName || '—')}</td>
        <td style="font-family:var(--font-mono); font-size:12.5px; color:var(--text2);">${escapeHtml(maskAccount(r.accountNumber))}</td>
        <td>${badgeForMode(r.transferType)}</td>
        <td style="text-align:right; font-weight:600;">₹${(parseFloat(r.amount) || 0).toFixed(2)}</td>
      </tr>`).join('');
    detailTr.innerHTML = `
      <td colspan="6" style="padding:0;">
        <div class="export-batch-breakdown">
          <div class="export-batch-breakdown__head">Employee-wise breakdown — ${batch.rows.length} employee(s), ₹${total.toFixed(2)} total</div>
          <table class="export-batch-breakdown__table">
            <thead><tr><th>Emp Code</th><th>Employee</th><th>Account</th><th>Mode</th><th style="text-align:right;">Amount (₹)</th></tr></thead>
            <tbody>${detailRows}</tbody>
          </table>
        </div>
      </td>`;
    tbody.appendChild(detailTr);
  });

  tbody.querySelectorAll('[data-redownload]').forEach(btn =>
    btn.onclick = () => redownloadBatch(btn.dataset.redownload));

  tbody.querySelectorAll('[data-expand]').forEach(btn =>
    btn.onclick = () => {
      const id = btn.dataset.expand;
      const detailRow = tbody.querySelector(`.export-batch-detail[data-detail-for="${CSS.escape(id)}"]`);
      if (!detailRow) return;
      const willOpen = detailRow.classList.contains('hidden');
      detailRow.classList.toggle('hidden');
      btn.closest('tr').classList.toggle('is-expanded', willOpen);
    });
}

function redownloadBatch(batchId) {
  const batch = exportBatches.find(b => b.batchId === batchId);
  if (!batch) return;
  const formatter = BankFormatters[batch.bank] || BankFormatters.SBI;
  const snapshotProfile = batch.companySnapshot || companyProfile;

  const lines = batch.rows.map(r => ({
    acc: r.accountNumber, empCode: r.empCode, name: r.employeeName,
    ifsc: r.ifsc, amount: parseFloat(r.amount), mode: r.transferType
  }));
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  // monthRaw/shortYear weren't always stored on older rows — derive
  // them from the batch ID itself as a fallback (format is fixed:
  // 4-char prefix + 2-digit year + 2-digit month + 4-char sequence).
  const shortYear = batch.year ? String(batch.year).slice(2) : batchId.slice(4, 6);
  const monthRaw = batch.monthRaw || batchId.slice(6, 8);
  const monthName = batch.monthName || MONTHS[parseInt(monthRaw, 10) - 1] || '';

  const output = formatter.generate({
    companyProfile: snapshotProfile, lines, total, batchId,
    txnDate: batch.transferDate, monthRaw, shortYear, monthName,
    year: batch.year || `20${shortYear}`, tft: lines[0]?.mode === 'Same Bank' ? 'Same Bank' : 'Other Bank'
  });

  const fileName = batch.fileName || `${(batch.bank || 'sbi').toLowerCase()}_salary_${monthName}_${batch.year || ''}.${formatter.ext}`;
  downloadTextFile(fileName, output, formatter.mime);
  toast(`Re-downloaded ${batchId}.`, 'success');
}

function wireExportHistory() {
  document.getElementById('exportsSearch').addEventListener('input', renderExportHistory);
}

async function loadCompanyProfile() {
  try {
    const p = await Api.getCompanyProfile();
    companyProfile = { ...companyProfile, ...p };
    document.getElementById('companyNameInput').value = p.name || '';
    document.getElementById('companyAccInput').value = p.accountNumber || '';
    document.getElementById('companyAccConfirmInput').value = p.accountNumber || '';
    document.getElementById('companySysInput').value = p.sysId || '';
    setSelectedCompanyBank(p.bankName || 'SBI');
  } catch (err) {
    console.error(err);
  }
  renderCompanySummary();
  updateDisbursementModeUI();
}

// Renders the 4-line read-only Company Details summary (Company Name,
// Bank Name, Account Number, IFSC). This is the default view — the
// full double-entry edit fields only appear after clicking Edit.
function renderCompanySummary() {
  const bank = BANK_BY_KEY[companyProfile.bankName || 'SBI'] || BANK_BY_KEY.SBI;
  const nameEl = document.getElementById('coSummaryName');
  if (!nameEl) return; // Company page not present yet
  nameEl.textContent = companyProfile.name || '—';
  document.getElementById('coSummaryBank').textContent = bank.label;
  document.getElementById('coSummaryAcc').textContent = companyProfile.accountNumber ? maskAccount(companyProfile.accountNumber) : '—';
  document.getElementById('coSummaryIfsc').textContent = companyProfile.ifsc || '—';
}

function setCompanyEditMode(editing) {
  document.getElementById('companyReadOnlyView').classList.toggle('hidden', editing);
  document.getElementById('companyEditView').classList.toggle('hidden', !editing);
  if (editing) {
    // Re-sync the edit fields with the last-saved profile every time
    // Edit is opened, so a Cancel afterwards can't leave stale input.
    document.getElementById('companyNameInput').value = companyProfile.name || '';
    document.getElementById('companyAccInput').value = companyProfile.accountNumber || '';
    document.getElementById('companyAccConfirmInput').value = companyProfile.accountNumber || '';
    document.getElementById('companySysInput').value = companyProfile.sysId || '';
    document.getElementById('companyIfscPreview').textContent = '';
    setSelectedCompanyBank(companyProfile.bankName || 'SBI');
  }
}

// ---------------------------------------------------------
// AUTOMATIC IFSC LOOKUP
// The user only ever enters the Branch/System Code and picks the
// bank — the IFSC itself is resolved automatically via the public
// Razorpay IFSC directory (https://ifsc.razorpay.com/<code>), which
// mirrors the RBI's own IFSC database. We build a candidate code
// from the selected bank's 4-letter prefix + the branch code, then
// verify/resolve it through the API. This runs both when the profile
// is saved and again right before a bulk payment file is generated,
// so the IFSC that lands in the exported file is always freshly
// confirmed — never hand-typed.
// ---------------------------------------------------------
async function resolveCompanyIfsc(bankKey, sysId) {
  const bank = BANK_BY_KEY[bankKey];
  const branch = String(sysId || '').trim().toUpperCase();
  if (!bank || !branch) {
    throw new Error('Select a bank and enter the Branch/System Code first.');
  }
  const candidate = `${bank.ifscPrefix}0${branch}`;
  let res;
  try {
    res = await fetch(`https://ifsc.razorpay.com/${candidate}`);
  } catch (err) {
    throw new Error('Could not reach the IFSC lookup service. Check your connection and try again.');
  }
  if (!res.ok) {
    throw new Error(`No IFSC found for branch/system code "${branch}" at ${bank.label}. Please check the code.`);
  }
  const data = await res.json();
  return (data && data.IFSC) ? data.IFSC : candidate;
}

function wireCompanyForm() {
  wireCompanyBankButtons();

  const accInput        = document.getElementById('companyAccInput');
  const accConfirmInput = document.getElementById('companyAccConfirmInput');
  const accMismatchLbl  = document.getElementById('companyAccMismatchLbl');
  const sysInput        = document.getElementById('companySysInput');
  const ifscPreviewEl   = document.getElementById('companyIfscPreview');
  const saveBtn         = document.getElementById('saveCompanyBtn');

  // Account Number: no spaces, no pasting — blocking paste is what
  // makes "type it twice" actually catch typos.
  [accInput, accConfirmInput].forEach(el => {
    blockSpaceKey(el);
    blockPasteAndRightClick(el);
    digitsOnlyLive(el);
  });

  // Live double-entry check — mirrors the Employee form's Account
  // Number confirmation, so a mistyped digit is caught immediately
  // instead of silently corrupting every export's debit account.
  function checkPair(primeEl, confEl, lbl) {
    const prime = primeEl.value.trim();
    const conf = confEl.value.trim();
    confEl.classList.remove('input-mismatch', 'input-match');
    if (!conf) { lbl.textContent = ''; return; }
    if (prime !== conf) {
      confEl.classList.add('input-mismatch');
      lbl.textContent = 'MISMATCH';
    } else {
      confEl.classList.add('input-match');
      lbl.textContent = '';
    }
  }
  [accInput, accConfirmInput].forEach(el => el.addEventListener('input', () => checkPair(accInput, accConfirmInput, accMismatchLbl)));

  const infoBtn = document.getElementById('sysCodeInfoBtn');
  const infoText = document.getElementById('sysCodeInfoText');
  infoBtn.addEventListener('click', () => {
    infoText.classList.toggle('hidden');
    infoBtn.classList.toggle('is-open');
  });

  document.getElementById('editCompanyBtn').addEventListener('click', () => setCompanyEditMode(true));
  document.getElementById('cancelCompanyEditBtn').addEventListener('click', () => setCompanyEditMode(false));

  saveBtn.addEventListener('click', async () => {
    const name = document.getElementById('companyNameInput').value.trim().toUpperCase();
    const accountNumber = accInput.value.trim();
    const accountNumberConfirm = accConfirmInput.value.trim();
    const sysId = sysInput.value.trim().toUpperCase();
    const bankName = selectedCompanyBankKey;
    if (!name || !accountNumber || !accountNumberConfirm || !sysId || !bankName) {
      toast('Please fill all fields.', 'error'); return;
    }
    if (!/^[0-9]+$/.test(accountNumber) || !/^[0-9]+$/.test(accountNumberConfirm)) {
      toast('Company Account Number must contain numbers only.', 'error');
      return;
    }
    if (accountNumber !== accountNumberConfirm) {
      toast('Company Account Number and its confirmation do not match.', 'error');
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Resolving IFSC...';
    ifscPreviewEl.textContent = '';
    try {
      const ifsc = await resolveCompanyIfsc(bankName, sysId);
      ifscPreviewEl.textContent = `Resolved IFSC: ${ifsc}`;
      await Api.updateCompanyProfile({ name, accountNumber, ifsc, sysId, bankName });
      companyProfile = { ...companyProfile, name, accountNumber, ifsc, sysId, bankName };
      await Api.logAudit(currentUser.email, currentUser.displayName, 'UPDATE COMPANY', `${name} | Acc: ${accountNumber} | IFSC: ${ifsc} | Branch: ${sysId} | Bank: ${bankName}`);
      renderCompanySummary();
      updateDisbursementModeUI();
      renderDisbursementList();
      renderEmployeeKpis();
      setCompanyEditMode(false);
      toast('Company profile updated.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Company Profile';
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
  wireThemeToggle();

  document.getElementById('openChangeEmailBtn').addEventListener('click', () =>
    openSettingsModal('changeEmailModal', 'changeEmailForm', 'settingsEmailMsg'));
  document.getElementById('cancelChangeEmailBtn').addEventListener('click', () =>
    closeSettingsModal('changeEmailModal'));

  document.getElementById('openChangePasswordBtn').addEventListener('click', () =>
    openSettingsModal('changePasswordModal', 'changePasswordForm', 'settingsPasswordMsg'));
  document.getElementById('cancelChangePasswordBtn').addEventListener('click', () =>
    closeSettingsModal('changePasswordModal'));

  document.getElementById('openEditCompanyBtn').addEventListener('click', () => {
    showAppPage('company');
    setCompanyEditMode(false);
  });

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

// ---------------------------------------------------------
// 12. "/" KEYBOARD SHORTCUT — jump to the current page's search box
// Works on any dashboard page that has one (Employees, Audit Trail,
// Payroll Run, Exports). Ignored while already typing in a field, so
// it never steals a literal "/" from user input.
// ---------------------------------------------------------
const PAGE_SEARCH_INPUT_ID = {
  employees: 'employeeSearch',
  audit: 'auditSearch',
  disbursement: 'disbSearch',
  exports: 'exportsSearch'
};

document.addEventListener('keydown', (e) => {
  if (e.key !== '/') return;
  const target = e.target;
  const tag = (target.tagName || '').toLowerCase();
  const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  if (isEditable) return;

  const dashboardScreen = document.getElementById('screen-dashboard');
  if (!dashboardScreen || dashboardScreen.classList.contains('hidden')) return;

  const activeSection = document.querySelector('#screen-dashboard main > section:not(.hidden)');
  if (!activeSection) return;
  const pageId = activeSection.id.replace('page-', '');
  const inputId = PAGE_SEARCH_INPUT_ID[pageId];
  if (!inputId) return;

  const input = document.getElementById(inputId);
  if (!input) return;
  e.preventDefault();
  input.focus();
  input.select();
});