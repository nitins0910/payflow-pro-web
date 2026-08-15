// ============================================================
// PayFlow Pro — Single-file app
// (Firebase config + Firestore API + Auth + Email Verification + Dashboard)
// ============================================================

// ---------------------------------------------------------
// 1. FIREBASE CONFIG
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
// 1b. APP CHECK
// ---------------------------------------------------------
const RECAPTCHA_V3_SITE_KEY = "6LcGm4UtAAAAAE6U6J4olvwUW4RDKVcJ0cHTMZ54";
if (RECAPTCHA_V3_SITE_KEY && RECAPTCHA_V3_SITE_KEY.indexOf("PASTE_YOUR") !== 0) {
  firebase.appCheck().activate(
    new firebase.appCheck.ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
    true
  );
} else {
  console.warn('[App Check] Not activated — RECAPTCHA_V3_SITE_KEY is still a placeholder.');
}

const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(err => {
  console.warn('[Auth] Could not set session persistence:', err.message);
});

const SITE_URL = "https://nitins0910.github.io/payflow-pro-web/";
const actionCodeSettings = { url: SITE_URL, handleCodeInApp: true };

// ---------------------------------------------------------
// 2. FIRESTORE DATA LAYER
// ---------------------------------------------------------
let currentUserId = null;

async function initUserContext(uid) {
  currentUserId = uid;
}

function userRef() {
  return db.collection('users').doc(currentUserId);
}

// IFSC lookup via Razorpay API (free, no key required for basic lookup)
async function fetchIfscFromCode(code) {
  // code is the branch/system code (last 6 digits of IFSC)
  // For SBI: SBIN + code, HDFC: HDFC + code, ICICI: ICIC + code, PNB: PUNB + code
  // We need the full IFSC to look up. But since we don't have the bank prefix here,
  // we'll use the bank from the profile. The user enters the branch code, we combine.
  // Actually, we need the full IFSC. The user enters the branch code (last 6 digits).
  // We prepend the bank prefix based on the selected bank.
  // This is a simplification - in production you'd use a real IFSC API.
  const bankPrefixes = {
    'SBI': 'SBIN',
    'HDFC': 'HDFC',
    'ICICI': 'ICIC',
    'PNB': 'PUNB'
  };
  const prefix = bankPrefixes[companyProfile.bankName] || 'SBIN';
  const fullIfsc = prefix + code;
  // Validate format
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(fullIfsc)) {
    throw new Error('Invalid IFSC format. Please enter a valid 6-digit branch code.');
  }
  return fullIfsc;
}

const Api = {
  async getEmployees() {
    const snap = await userRef().collection('employees').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  // Uniqueness for accountNumber / empCode is enforced atomically via two small
  // "index" collections (accountIndex/{accountNumber} and empCodeIndex/{empCode}),
  // each doc id'd by the value itself. A Firestore transaction reads both index
  // docs and only writes the employee (+ index docs) if neither already exists,
  // so two simultaneous adds of the same account/code can no longer both succeed.
  async addEmployee(emp) {
    const acc = String(emp.accountNumber);
    const code = String(emp.empCode);
    const empRef = userRef().collection('employees').doc();
    const accIdxRef = userRef().collection('accountIndex').doc(acc);
    const codeIdxRef = userRef().collection('empCodeIndex').doc(code);
    await db.runTransaction(async (tx) => {
      const [accSnap, codeSnap] = await Promise.all([tx.get(accIdxRef), tx.get(codeIdxRef)]);
      if (accSnap.exists) throw new Error(`Account ${acc} already exists.`);
      if (codeSnap.exists) throw new Error(`Emp Code ${code} already exists.`);
      tx.set(empRef, { ...emp, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      tx.set(accIdxRef, { employeeId: empRef.id });
      tx.set(codeIdxRef, { employeeId: empRef.id });
    });
    return empRef.id;
  },
  async updateEmployee(id, emp) {
    const empRef = userRef().collection('employees').doc(id);
    const newAcc = String(emp.accountNumber);
    const newCode = String(emp.empCode);
    await db.runTransaction(async (tx) => {
      const empSnap = await tx.get(empRef);
      if (!empSnap.exists) throw new Error('Employee record no longer exists.');
      const prev = empSnap.data();
      const accChanged = String(prev.accountNumber) !== newAcc;
      const codeChanged = String(prev.empCode) !== newCode;

      const newAccIdxRef = accChanged ? userRef().collection('accountIndex').doc(newAcc) : null;
      const newCodeIdxRef = codeChanged ? userRef().collection('empCodeIndex').doc(newCode) : null;
      const [newAccSnap, newCodeSnap] = await Promise.all([
        accChanged ? tx.get(newAccIdxRef) : Promise.resolve(null),
        codeChanged ? tx.get(newCodeIdxRef) : Promise.resolve(null)
      ]);
      if (accChanged && newAccSnap.exists) throw new Error(`Account ${newAcc} already exists.`);
      if (codeChanged && newCodeSnap.exists) throw new Error(`Emp Code ${newCode} already exists.`);

      tx.set(empRef, { ...emp, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      if (accChanged) {
        tx.delete(userRef().collection('accountIndex').doc(String(prev.accountNumber)));
        tx.set(newAccIdxRef, { employeeId: id });
      }
      if (codeChanged) {
        tx.delete(userRef().collection('empCodeIndex').doc(String(prev.empCode)));
        tx.set(newCodeIdxRef, { employeeId: id });
      }
    });
  },
  async deleteEmployee(id) {
    const empRef = userRef().collection('employees').doc(id);
    await db.runTransaction(async (tx) => {
      const empSnap = await tx.get(empRef);
      if (!empSnap.exists) return;
      const data = empSnap.data();
      tx.delete(empRef);
      if (data.accountNumber != null) tx.delete(userRef().collection('accountIndex').doc(String(data.accountNumber)));
      if (data.empCode != null) tx.delete(userRef().collection('empCodeIndex').doc(String(data.empCode)));
    });
  },
  // Bulk import can't get the same hard transactional guarantee as a single
  // add (Firestore batched writes don't support "create if not exists"), so
  // callers must re-fetch a fresh employee list immediately before calling
  // this (see wireBulkImport) to shrink the staleness window as much as
  // possible. Index docs are still written so future single adds/edits are
  // protected against colliding with anything just imported.
  async bulkAddEmployees(rows) {
    let batch = db.batch();
    let opsInBatch = 0;
    for (const r of rows) {
      const ref = userRef().collection('employees').doc();
      batch.set(ref, { ...r, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      batch.set(userRef().collection('accountIndex').doc(String(r.accountNumber)), { employeeId: ref.id });
      batch.set(userRef().collection('empCodeIndex').doc(String(r.empCode)), { employeeId: ref.id });
      opsInBatch += 3;
      // Firestore batches cap at 500 ops; each row here is 3 ops, so flush well before that.
      if (opsInBatch >= 450) {
        await batch.commit();
        batch = db.batch();
        opsInBatch = 0;
      }
    }
    if (opsInBatch > 0) await batch.commit();
  },
  // One-time, self-healing migration: employees created before the
  // accountIndex/empCodeIndex collections existed won't have index docs yet,
  // so their account/emp-code wouldn't be protected by the transactional
  // checks above. This runs once per account (guarded by meta/indexBackfillDone)
  // and backfills index docs for whatever is currently in `employees`.
  async ensureIndexBackfill(employeesList) {
    const flagRef = userRef().collection('meta').doc('indexBackfillDone');
    const flagSnap = await flagRef.get();
    if (flagSnap.exists) return;
    let batch = db.batch();
    let opsInBatch = 0;
    for (const emp of employeesList) {
      if (emp.accountNumber == null || emp.empCode == null) continue;
      batch.set(userRef().collection('accountIndex').doc(String(emp.accountNumber)), { employeeId: emp.id });
      batch.set(userRef().collection('empCodeIndex').doc(String(emp.empCode)), { employeeId: emp.id });
      opsInBatch += 2;
      if (opsInBatch >= 450) { await batch.commit(); batch = db.batch(); opsInBatch = 0; }
    }
    batch.set(flagRef, { done: true, at: firebase.firestore.FieldValue.serverTimestamp() });
    await batch.commit();
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
    // Chunked the same way as the other bulk writers: an unchunked batch()
    // silently throws once a payroll run exceeds Firestore's 500-op limit,
    // which would leave a large batch's ledger entries unlogged.
    let batch = db.batch();
    let count = 0;
    for (const r of rows) {
      const ref = userRef().collection('disbursements').doc();
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
  async getDisbursementHistory() {
    const snap = await userRef().collection('disbursements').orderBy('createdAt', 'desc').limit(500).get();
    return snap.docs.map(d => d.data());
  },
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
// ---------------------------------------------------------
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// ---------------------------------------------------------
// 2d. TOAST / CONFIRM SYSTEM
// ---------------------------------------------------------
function toast(message, kind) {
  const host = document.getElementById('toastHost');
  if (!host) { console.warn('[toast]', message); return; }
  const el = document.createElement('div');
  el.className = `toast toast-${kind || 'info'}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  const remove = () => {
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener('click', remove);
  setTimeout(remove, kind === 'error' ? 6000 : 4000);
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
// 2c. BANK SUPPORT (4 banks only: SBI, HDFC, ICICI, PNB)
// ---------------------------------------------------------
const BANKS = [
  { key: 'SBI',  label: 'State Bank of India',  ifscPrefix: 'SBIN' },
  { key: 'HDFC', label: 'HDFC Bank',            ifscPrefix: 'HDFC' },
  { key: 'ICICI', label: 'ICICI Bank',          ifscPrefix: 'ICIC' },
  { key: 'PNB',  label: 'Punjab National Bank', ifscPrefix: 'PUNB' },
];
const BANK_BY_KEY = Object.fromEntries(BANKS.map(b => [b.key, b]));

function csvField(value) {
  const s = String(value ?? '').replace(/[\r\n]+/g, ' ');
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(values) { return values.map(csvField).join(','); }

function sanitizeForDelimitedFile(value, ...reservedChars) {
  let s = String(value ?? '').replace(/[\r\n]+/g, ' ');
  reservedChars.forEach(ch => { s = s.split(ch).join(''); });
  return s.trim();
}

function determineTransactionMode(bankKey, ifsc, amount, preferImps) {
  const bank = BANK_BY_KEY[bankKey];
  if (!bank) return 'NEFT';
  const sameBank = bank.ifscPrefix && String(ifsc || '').toUpperCase().startsWith(bank.ifscPrefix);
  if (sameBank) return 'Same Bank';
  if (preferImps) return 'IMPS';
  return amount >= 200000 ? 'RTGS' : 'NEFT';
}

const BankFormatters = {
  SBI: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(ctx) {
      const d = v => sanitizeForDelimitedFile(v, '#');
      const empLines = ctx.lines.map(l => {
        const seqStr = `${ctx.batchId}E${l.empCode}`;
        return `${d(l.acc)}#${d(l.ifsc)}#${ctx.txnDate}##${l.amount.toFixed(2)}#${seqStr}#${d(l.name)}#SALARY OF ${d(ctx.monthName)} ${ctx.year}#`;
      });
      const header = `${d(ctx.companyProfile.accountNumber)}#${d(ctx.companyProfile.sysId)}#${ctx.txnDate}#${ctx.total.toFixed(2)}##${ctx.batchId}#${d(ctx.companyProfile.name)}#SALARY OF ${d(ctx.monthName)} ${ctx.year}#`;
      return [header, ...empLines].join('\n') + '\n';
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
  ICICI: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(ctx) {
      const d = v => sanitizeForDelimitedFile(v, '^');
      const rows = ctx.lines.map(l =>
        [l.mode, d(ctx.companyProfile.accountNumber), d(l.acc), l.amount.toFixed(2), d(l.name), d(l.ifsc),
          `SALARY OF ${d(ctx.monthName)} ${ctx.year}`].join('^'));
      return rows.join('\n') + '\n';
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
  }
};

// ---------------------------------------------------------
// 3. SCREEN ROUTER
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
// 5. AUTH SCREEN
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
      showAuthSuccess('If an account exists for that email, a password reset link is on its way. Check your spam folder too.');
      forgotForm.reset();
      hideForgotFormAfterSend();
    } catch (err) {
      if (err.code === 'auth/invalid-email') {
        showAuthError(mapAuthError(err));
      } else {
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
      suppressAutoRoute = true;
      const result = await auth.signInWithPopup(googleProvider);
      await handleGoogleSignInResult(result);
    } catch (err) {
      const popupFailureCodes = [
        'auth/popup-blocked',
        'auth/popup-closed-by-user',
        'auth/cancelled-popup-request',
        'auth/operation-not-supported-in-this-environment'
      ];
      if (popupFailureCodes.includes(err.code)) {
        try {
          await auth.signInWithRedirect(googleProvider);
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
// 7. VERIFICATION LINK HANDLER
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

  history.replaceState({}, '', window.location.pathname);
  btn.classList.remove('hidden');
  btn.onclick = async () => {
    if (auth.currentUser) await auth.signOut();
    suppressAutoRoute = false;
    goToAuthScreen();
  };
}

// ---------------------------------------------------------
// 7b. PASSWORD RESET LINK HANDLER
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
// 8. ROUTER
// ---------------------------------------------------------
function routeUser(user) {
  if (suppressAutoRoute) return;
  if (!user) { goToAuthScreen(); return; }

  if (!user.emailVerified) {
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

  suppressAutoRoute = true;
  auth.getRedirectResult().then(async (result) => {
    if (result && result.user) {
      await handleGoogleSignInResult(result);
    } else {
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
// 10. DASHBOARD
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

function getBankLabel(key) {
  const b = BANK_BY_KEY[key] || BANK_BY_KEY.SBI;
  return b.label;
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
  Api.ensureIndexBackfill(employees).catch(err => console.warn('[index backfill] failed:', err.message));

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
    wireBankSelection();
    document.getElementById('logoutBtn').onclick = () => auth.signOut();
    document.getElementById('employeeSearch').addEventListener('input', renderEmployeeTable);
  }
}

function wireModalCloseButtons() {
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = document.getElementById(btn.dataset.modal);
      if (modal) modal.classList.add('hidden');
    });
  });
}

// ---------------------------------------------------------
// Bank selection wiring
// ---------------------------------------------------------
function wireBankSelection() {
  // Payroll Run "Select Bank" tiles are a read-only reflection of the
  // company's saved bank (kept in sync in loadCompanyProfile /
  // wireCompanyForm's save handler) — they must NOT be clickable here.
  // Previously, clicking a tile mutated companyProfile.bankName directly in
  // memory: that changed which IFSC prefix / file formatter the export used
  // for the rest of the session, without touching the company's own saved
  // accountNumber/ifsc (which are tied to a *specific* real bank) and without
  // persisting anything — so a refresh silently reverted it, and in between,
  // an exported file could carry one bank's formatter/IFSC-prefix logic
  // while the company header line still had another bank's account/IFSC.
  // Bank is a company-wide setting, so it can only be changed from the
  // Company page (which derives IFSC and saves atomically).
  document.querySelectorAll('#bankSelectGrid .bank-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      if (tile.dataset.bank === (companyProfile.bankName || 'SBI')) return;
      toast('Bank is a company-wide setting — change it from the Company page.', 'info');
      goToCompanyPage();
    });
  });

  // Company edit bank selection
  document.querySelectorAll('#companyBankSelectGrid .bank-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      document.querySelectorAll('#companyBankSelectGrid .bank-tile').forEach(t => t.classList.remove('active'));
      tile.classList.add('active');
    });
  });
}

// ---------------------------------------------------------
// Employee KPI
// ---------------------------------------------------------
async function renderEmployeeKpis() {
  const totalEl = document.getElementById('kpiTotalEmployees');
  const bankEl = document.getElementById('kpiCompanyBank');
  const monthEl = document.getElementById('kpiMonthDisbursed');
  const lastEl = document.getElementById('kpiLastExport');
  const lastSubEl = document.getElementById('kpiLastExportSub');
  if (!totalEl) return;

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

function goToPage(page) {
  const item = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (item) item.click();
}

function wireNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('#screen-dashboard main > section').forEach(s => s.classList.add('hidden'));
      const pageId = 'page-' + item.dataset.page;
      const section = document.getElementById(pageId);
      if (section) section.classList.remove('hidden');
      if (item.dataset.page === 'audit') loadAuditTrail();
      if (item.dataset.page === 'exports') loadExportHistory();
    });
  });
}

function renderSkeletonRows(tbody, colCount, rowCount) {
  tbody.innerHTML = Array.from({ length: rowCount }, () =>
    `<tr class="skeleton-row">${'<td><span class="skeleton-bar"></span></td>'.repeat(colCount)}</tr>`
  ).join('');
}

async function loadEmployees() {
  const tbody = document.getElementById('employeeTableBody');
  renderSkeletonRows(tbody, 6, 4);
  try {
    employees = await Api.getEmployees();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger);">Could not load employees: ${escapeHtml(err.message)}</td></tr>`;
    return;
  }
  renderEmployeeTable();
  renderDisbursementList();
}

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

function badgeForMode(mode) {
  const cls = mode === 'Same Bank' ? 'badge-green'
    : mode === 'RTGS' ? 'badge-blue'
    : mode === 'NEFT' ? 'badge-blue'
    : mode === 'IMPS' ? 'badge-amber'
    : 'badge-grey';
  return `<span class="badge ${cls}">${escapeHtml(mode || '—')}</span>`;
}

let employeeSort = { key: null, dir: 1 };
let selectedEmployeeIds = new Set();

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
      `Delete ${ids.length} selected employee${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
      { title: 'Delete Selected Employees' }
    );
    if (!ok) return;
    const btn = document.getElementById('employeeBulkDeleteBtn');
    btn.disabled = true; btn.textContent = 'Deleting...';
    try {
      const names = ids.map(id => employees.find(e => e.id === id)?.name).filter(Boolean);
      await Promise.all(ids.map(id => Api.deleteEmployee(id)));
      await Api.logAudit(currentUser.email, currentUser.displayName, 'BULK DELETE EMPLOYEES',
        `Deleted ${ids.length}: ${names.join(', ')}`);
      selectedEmployeeIds.clear();
      await loadEmployees();
      toast(`${ids.length} employee${ids.length === 1 ? '' : 's'} deleted.`, 'success');
    } catch (err) {
      toast('Bulk delete failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Delete Selected';
    }
  });
}

// ---------------------------------------------------------
// Employee form helpers
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

  [fFirst, fMiddle, fLast].forEach(el => { blockSpaceKey(el); autoUpperCaseLive(el); });
  blockSpaceKey(fCode);
  digitsOnlyLive(fCode);
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

  [fAcc, fAccC, fIfsc, fIfscC].forEach(el => { blockSpaceKey(el); blockPasteAndRightClick(el); });
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

    function checkPair(primeEl, confEl, lbl, skip, formatRegex, formatMsg) {
      if (skip) return;
      const prime = primeEl.value.trim();
      const conf = confEl.value.trim();
      clearMatchStyles(confEl);
      if (conf) {
        if (prime !== conf) {
          confEl.classList.add('input-mismatch');
          lbl.textContent = 'MISMATCH';
        } else if (formatRegex && !formatRegex.test(prime)) {
          confEl.classList.add('input-mismatch');
          lbl.textContent = formatMsg;
        } else {
          confEl.classList.add('input-match');
          lbl.textContent = '';
        }
      } else {
        lbl.textContent = '';
      }
    }
    checkPair(fAcc, fAccC, accMismatchLbl, isDuplicate);
    checkPair(fIfsc, fIfscC, ifscMismatchLbl, false, IFSC_RE, 'INVALID IFSC FORMAT');
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
    if (!/^[0-9]+$/.test(empCode)) {
      showFieldError('Employee Code must contain numbers only.');
      return;
    }
    if (!/^[0-9]+$/.test(acc) || !/^[0-9]+$/.test(accC)) {
      showFieldError('Account Number must contain numbers only.');
      return;
    }
    if (acc !== accC || ifsc !== ifscC) {
      showFieldError('Account Number and IFSC must match their confirmation fields.');
      return;
    }
    if (!IFSC_RE.test(ifsc)) {
      showFieldError('IFSC Code format looks wrong — it should be 4 letters, then 0, then 6 letters/digits (e.g. SBIN0001234).');
      return;
    }

    const nameParts = [fname];
    if (mname) nameParts.push(mname);
    nameParts.push(lname);
    const fullName = nameParts.join(' ').toUpperCase();

    if (existingAccountNumbers().includes(acc)) {
      showFieldError(`Account number ${acc} is already assigned to another employee in the ledger.`);
      return;
    }
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
    const ok = await confirmDialog(`Delete ${emp ? emp.name : id}? This cannot be undone.`, { title: 'Delete Employee' });
    if (!ok) return;
    try {
      await Api.deleteEmployee(id);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'DELETE EMPLOYEE',
        `Deleted: ${emp ? emp.name : ''} | Acc: ${emp ? emp.accountNumber : id}`);
      await loadEmployees();
      toast(`${emp ? emp.name : 'Employee'} deleted.`, 'success');
    } catch (err) {
      toast('Delete failed: ' + err.message, 'error');
    }
  };
}

function downloadSampleCsv() {
  const sample = [
    'Employee Name,Account Number,IFSC_BranchCode,Transfer Type,Emp Code',
    'JOHN DOE,123456789012,SBIN0001234,Same Bank,01'
  ].join('\r\n') + '\r\n';
  downloadTextFile('payflow_bulk_import_sample.csv', sample, 'text/csv;charset=utf-8');
}

function exportLedgerCsv() {
  if (!employees.length) { toast('No employees to export yet.', 'error'); return; }
  const header = 'Employee Name,Account Number,IFSC_BranchCode,Transfer Type,Emp Code';
  const rows = employees.map(e => csvRow([e.name, e.accountNumber, e.ifsc, e.transferType, e.empCode]));
  const content = [header, ...rows].join('\r\n') + '\r\n';
  downloadTextFile(`payflow_employee_ledger_${new Date().toISOString().slice(0, 10)}.csv`, content, 'text/csv;charset=utf-8');
}

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

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const btn = document.getElementById('bulkImportBtn');
    btn.disabled = true; btn.textContent = 'Importing...';
    try {
      const text = await file.text();
      // Re-fetch the ledger right before validating instead of trusting the
      // `employees` array that was loaded whenever the page opened — that
      // could be stale if another tab/session added employees since, which
      // would let a duplicate account number slip past the check below.
      let existingAccounts;
      try {
        const fresh = await Api.getEmployees();
        employees = fresh;
        existingAccounts = fresh.map(e => String(e.accountNumber));
      } catch (err) {
        existingAccounts = employees.map(e => String(e.accountNumber));
      }
      const { rows, errors } = parseCsv(text, existingAccounts);

      if (!rows.length) {
        showImportResultModal(0, errors);
        return;
      }
      await Api.bulkAddEmployees(rows);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'BULK IMPORT',
        `${rows.length} employees imported${errors.length ? `, ${errors.length} row(s) skipped` : ''}`);
      await loadEmployees();
      showImportResultModal(rows.length, errors);
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Bulk Import CSV';
      fileInput.value = '';
    }
  });
}

function showImportResultModal(importedCount, errors) {
  const body = document.getElementById('importResultBody');
  const okLine = `<p style="color:var(--success); font-weight:600;">${importedCount} employee${importedCount === 1 ? '' : 's'} imported successfully.</p>`;
  const errLines = errors.length
    ? `<p style="color:var(--danger); font-weight:600; margin-top:10px;">${errors.length} row(s) skipped:</p>
       <div style="max-height:220px; overflow-y:auto; font-size:12px; font-family:var(--font-mono); line-height:1.7; background:var(--surface2); padding:10px 12px;">
         ${errors.map(e => `Line ${e.line}: ${escapeHtml(e.reason)}`).join('<br>')}
       </div>`
    : '';
  body.innerHTML = okLine + errLines;
  document.getElementById('importResultModal').classList.remove('hidden');
}

const VALID_TRANSFER_TYPES = ['Same Bank', 'Other Bank'];

// RFC4180-style CSV tokenizer: handles quoted fields, commas and double-quotes
// inside quotes, and quoted fields that span multiple lines. A plain
// line.split(',') (the previous approach) breaks as soon as any field —
// e.g. an employee name — contains a comma, since the exported ledger
// (exportLedgerCsv) quotes such fields on the way out but a naive split
// doesn't un-quote them on the way back in; every column after that point
// shifts, silently mixing up account numbers/IFSCs/names.
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; }
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else { field += ch; }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

function parseCsv(text, existingAccounts) {
  const existing = new Set((existingAccounts || []).map(String));
  const rawRows = parseCsvRows(text);
  if (!rawRows.length) return { rows: [], errors: [] };

  const headers = rawRows[0].map(h => h.trim().toLowerCase());
  const idxAcc  = headers.indexOf('account number');
  const idxIfsc = headers.indexOf('ifsc_branchcode');
  const idxName = headers.indexOf('employee name');
  const idxType = headers.indexOf('transfer type');
  const idxCode = headers.indexOf('emp code');

  const rows = [];
  const errors = [];
  const seenInFile = new Set();
  const seenCodes = new Set();

  for (let i = 1; i < rawRows.length; i++) {
    const lineNo = i + 1;
    const cols = rawRows[i].map(c => c.trim());
    const accountNumber = (cols[idxAcc >= 0 ? idxAcc : 0] || '').replace(/[^0-9]/g, '');
    const ifsc = (cols[idxIfsc >= 0 ? idxIfsc : 1] || '').toUpperCase();
    const name = (cols[idxName >= 0 ? idxName : 2] || '').toUpperCase();
    const rawType = (cols[idxType >= 0 ? idxType : 3] || 'Same Bank').trim();
    const empCode = ((cols[idxCode >= 0 ? idxCode : 4] || '01').replace(/[^0-9]/g, '') || '01').padStart(2, '0');

    if (!accountNumber || !name) {
      errors.push({ line: lineNo, reason: 'Missing Account Number or Employee Name.' });
      continue;
    }
    if (!IFSC_RE.test(ifsc)) {
      errors.push({ line: lineNo, reason: `Invalid IFSC "${ifsc || '(blank)'}" — must be 4 letters, then 0, then 6 letters/digits (e.g. SBIN0001234).` });
      continue;
    }
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

function initDisbursementDateFields() {
  const now = new Date();
  const monthInput = document.getElementById('disbPayrollMonth');
  const dateInput = document.getElementById('disbTransferDate');
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (monthInput && !monthInput.value) monthInput.value = ym;
  if (dateInput && !dateInput.value) dateInput.value = ymd;
}

function getPayrollCycle() {
  const raw = document.getElementById('disbPayrollMonth').value;
  const [year, monthRaw] = String(raw || '').split('-');
  const monthName = MONTHS[parseInt(monthRaw, 10) - 1] || '';
  return { monthRaw: monthRaw || '', year: year || '', monthName };
}

function getTransferDateDDMMYYYY() {
  const raw = document.getElementById('disbTransferDate').value;
  const [y, m, d] = String(raw || '').split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function validateLiveAmountEntry(inputEl, statusEl, warnEl) {
  const v = inputEl.value.trim();
  warnEl.textContent = '';
  statusEl.className = 'amount-status';
  if (!v) {
    statusEl.classList.add('empty');
    updateBatchTotal();
    return;
  }
  let ok = true, dots = 0;
  for (const ch of v) {
    if (ch === '.') { dots += 1; ok = dots <= 1; }
    else if (!/[0-9]/.test(ch)) { ok = false; }
    if (!ok) break;
  }
  if (!ok) {
    statusEl.classList.add('invalid');
    warnEl.textContent = '⚠';
  } else {
    const val = parseFloat(v);
    if (!isNaN(val) && val > 0) {
      statusEl.classList.add('valid');
    } else {
      statusEl.classList.add('invalid');
      warnEl.textContent = '⚠';
    }
  }
  updateBatchTotal();
}

function updateDisbursementModeUI() {
  const bankKey = companyProfile.bankName || 'SBI';
  const bank = BANK_BY_KEY[bankKey] || BANK_BY_KEY.SBI;
  const isSbi = bankKey === 'SBI';

  const badge = document.getElementById('disbBankBadge');
  if (badge) badge.textContent = `BANK: ${bank.label}`;

  const subtitle = document.getElementById('disbSubtitle');
  if (subtitle) {
    subtitle.textContent = isSbi
      ? 'Enter amounts and export the bulk payment file.'
      : `Enter amounts and export the ${bank.label} bulk payment file. Mode (Same Bank / RTGS / NEFT / IMPS) is auto-detected per beneficiary.`;
  }

  const ttWrap = document.getElementById('disbTransferTypeWrap');
  const impsWrap = document.getElementById('disbImpsWrap');
  if (ttWrap) ttWrap.classList.toggle('hidden', !isSbi);
  if (impsWrap) impsWrap.classList.toggle('hidden', isSbi);
}

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
        <div class="amount-input-wrap">
          <span data-warn class="amount-warn"></span>
          <span data-status class="amount-status empty"></span>
          <input type="text" data-acc="${escapeHtml(emp.accountNumber)}" placeholder="0.00" value="${escapeHtml(prefill)}">
        </div>
      </td>`;
    tbody.appendChild(tr);
    const inputEl = tr.querySelector('input');
    const statusEl = tr.querySelector('[data-status]');
    const warnEl  = tr.querySelector('[data-warn]');
    const modeEl  = tr.querySelector('[data-mode]');
    inputEl.addEventListener('input', () => {
      validateLiveAmountEntry(inputEl, statusEl, warnEl);
      if (!isSbi) {
        const v = parseFloat(inputEl.value);
        modeEl.innerHTML = badgeForMode(currentModeFor(emp.ifsc, isNaN(v) ? 0 : v));
      }
    });
    const prefillAmt = parseFloat(prefill);
    if (!isSbi) modeEl.innerHTML = badgeForMode(currentModeFor(emp.ifsc, isNaN(prefillAmt) ? 0 : prefillAmt));
    if (prefill) validateLiveAmountEntry(inputEl, statusEl, warnEl);
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
      const statusEl = tr.querySelector('[data-status]');
      const warnEl  = tr.querySelector('[data-warn]');
      if (inputEl) inputEl.value = '';
      if (statusEl) statusEl.className = 'amount-status empty';
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

function isCompanyProfileComplete() {
  return !!(companyProfile.name && companyProfile.accountNumber && companyProfile.ifsc && companyProfile.sysId && companyProfile.bankName);
}

function goToCompanyPage() {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const navItem = document.querySelector('.nav-item[data-page="company"]');
  if (navItem) navItem.classList.add('active');
  document.querySelectorAll('#screen-dashboard main > section').forEach(s => s.classList.add('hidden'));
  document.getElementById('page-company').classList.remove('hidden');
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function buildExportWarnings(isSbi, tft, lines) {
  const warnings = [];

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

function openExportPreview() {
  if (!isCompanyProfileComplete()) {
    toast('Please fill company details to continue. Company Name, Account Number, IFSC Code, Branch/Sys Code and Bank are required before you can export a payment file.', 'error');
    goToCompanyPage();
    return;
  }
  const { tft, lines, total, hasInvalid } = collectBatchLines();
  if (hasInvalid) { toast('One or more amounts are in an invalid format. Please check and try again.', 'error'); return; }
  if (!lines.length) { toast('Please enter at least one salary amount before exporting.', 'error'); return; }

  const txnDate = getTransferDateDDMMYYYY();
  if (!txnDate) { toast('Please select a Transfer Date before exporting.', 'error'); return; }

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

  const warnings = buildExportWarnings(isSbi, tft, lines);
  const warningsHtml = warnings.length
    ? `<div style="margin-top:10px; padding:10px 12px; background:var(--danger-bg); border:1px solid var(--danger); color:var(--danger); font-size:12px; line-height:1.6;">
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
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Exporting...';
    document.getElementById('exportPreviewModal').classList.add('hidden');
    await executeExport();
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm → Export';
  };
}

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
let auditSort = { key: null, dir: 1 };

function wireAudit() {
  document.getElementById('auditSearch').addEventListener('input', renderAuditTable);
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

  let filtered = auditRows.filter(r =>
    !query ||
    (r.userEmail||'').toLowerCase().includes(query) ||
    (r.action||'').toLowerCase().includes(query) ||
    (r.details||'').toLowerCase().includes(query));

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

    const detailTr = document.createElement('tr');
    detailTr.className = 'export-batch-detail hidden';
    detailTr.dataset.detailFor = batch.batchId;
    const rowsSorted = [...batch.rows].sort((a, b) =>
      (a.employeeName || '').localeCompare(b.employeeName || ''));
    const detailRows = rowsSorted.map(r => `
      <tr>
        <td style="color:var(--text2); font-family:var(--font-mono); font-size:11.5px;">${escapeHtml(r.empCode || '—')}</td>
        <td>${escapeHtml(r.employeeName || '—')}</td>
        <td style="font-family:var(--font-mono); font-size:12px; color:var(--text2);">${escapeHtml(maskAccount(r.accountNumber))}</td>
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
    updateCompanyDisplay();
    // Set bank selection in Payroll Run
    document.querySelectorAll('#bankSelectGrid .bank-tile').forEach(tile => {
      tile.classList.toggle('active', tile.dataset.bank === companyProfile.bankName);
    });
    // Set bank selection in Company edit
    document.querySelectorAll('#companyBankSelectGrid .bank-tile').forEach(tile => {
      tile.classList.toggle('active', tile.dataset.bank === companyProfile.bankName);
    });
    // Fill edit fields
    document.getElementById('companyNameInput').value = p.name || '';
    document.getElementById('companyAccInput').value = p.accountNumber || '';
    document.getElementById('companyAccConfirmInput').value = p.accountNumber || '';
    document.getElementById('companySysInput').value = p.sysId || '';
  } catch (err) {
    console.error(err);
  }
  updateDisbursementModeUI();
}

function updateCompanyDisplay() {
  document.getElementById('companyDisplayName').textContent = companyProfile.name || '—';
  const bank = BANK_BY_KEY[companyProfile.bankName] || BANK_BY_KEY.SBI;
  document.getElementById('companyDisplayBank').textContent = bank.label;
  document.getElementById('companyDisplayAcc').textContent = companyProfile.accountNumber || '—';
  document.getElementById('companyDisplayIfsc').textContent = companyProfile.ifsc || '—';
}

function deriveBranchCodeFromIfsc(ifsc) {
  const s = String(ifsc || '').toUpperCase();
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s) ? s.slice(5) : '';
}

function wireCompanyForm() {
  const editToggle = document.getElementById('companyEditToggleBtn');
  const readonlyView = document.getElementById('companyReadonlyView');
  const editView = document.getElementById('companyEditView');
  const cancelBtn = document.getElementById('companyEditCancelBtn');
  let isEditing = false;

  function toggleEditMode(editing) {
    isEditing = editing;
    readonlyView.classList.toggle('hidden', editing);
    editView.classList.toggle('hidden', !editing);
    editToggle.textContent = editing ? 'Cancel' : 'Edit';
    if (editing) {
      // Populate edit fields with current values
      document.getElementById('companyNameInput').value = companyProfile.name || '';
      document.getElementById('companyAccInput').value = companyProfile.accountNumber || '';
      document.getElementById('companyAccConfirmInput').value = companyProfile.accountNumber || '';
      document.getElementById('companySysInput').value = companyProfile.sysId || '';
      // Set bank selection
      document.querySelectorAll('#companyBankSelectGrid .bank-tile').forEach(tile => {
        tile.classList.toggle('active', tile.dataset.bank === companyProfile.bankName);
      });
    }
  }

  editToggle.addEventListener('click', () => {
    if (isEditing) {
      toggleEditMode(false);
    } else {
      toggleEditMode(true);
    }
  });

  cancelBtn.addEventListener('click', () => {
    toggleEditMode(false);
  });

  // Company bank selection in edit mode
  document.querySelectorAll('#companyBankSelectGrid .bank-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      document.querySelectorAll('#companyBankSelectGrid .bank-tile').forEach(t => t.classList.remove('active'));
      tile.classList.add('active');
    });
  });

  const accInput = document.getElementById('companyAccInput');
  const accConfirmInput = document.getElementById('companyAccConfirmInput');
  const accMismatchLbl = document.getElementById('companyAccMismatchLbl');

  [accInput, accConfirmInput].forEach(el => {
    blockSpaceKey(el);
    blockPasteAndRightClick(el);
    digitsOnlyLive(el);
  });

  function checkAccMatch() {
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
  accInput.addEventListener('input', checkAccMatch);
  accConfirmInput.addEventListener('input', checkAccMatch);

  // Auto-fill Sys Code from IFSC (we'll use the bank prefix + sys code)
  // For the company form, we use the sys code as the branch code (last 6 digits)
  // The IFSC is derived from bank prefix + sys code during save

  document.getElementById('saveCompanyBtn').addEventListener('click', async () => {
    const name = document.getElementById('companyNameInput').value.trim().toUpperCase();
    const accountNumber = accInput.value.trim();
    const accountNumberConfirm = accConfirmInput.value.trim();
    const sysId = document.getElementById('companySysInput').value.trim();
    // Get selected bank from edit mode
    const activeBankTile = document.querySelector('#companyBankSelectGrid .bank-tile.active');
    const bankName = activeBankTile ? activeBankTile.dataset.bank : (companyProfile.bankName || 'SBI');

    if (!name || !accountNumber || !accountNumberConfirm || !sysId) {
      toast('Please fill all fields.', 'error');
      return;
    }
    if (!/^[0-9]+$/.test(accountNumber) || !/^[0-9]+$/.test(accountNumberConfirm)) {
      toast('Company Account Number must contain numbers only.', 'error');
      return;
    }
    if (accountNumber !== accountNumberConfirm) {
      toast('Company Account Number and its confirmation do not match.', 'error');
      return;
    }

    // Derive IFSC from bank prefix + sys code (branch code)
    const bankPrefix = BANK_BY_KEY[bankName]?.ifscPrefix || 'SBIN';
    const ifsc = bankPrefix + sysId;
    if (!IFSC_RE.test(ifsc)) {
      toast('Invalid IFSC derived. Please check the Branch/Sys Code (should be 6 alphanumeric characters).', 'error');
      return;
    }

    try {
      await Api.updateCompanyProfile({ name, accountNumber, ifsc, sysId, bankName });
      companyProfile = { ...companyProfile, name, accountNumber, ifsc, sysId, bankName };
      await Api.logAudit(currentUser.email, currentUser.displayName, 'UPDATE COMPANY', `${name} | Acc: ${accountNumber} | IFSC: ${ifsc} | Branch: ${sysId} | Bank: ${bankName}`);
      updateCompanyDisplay();
      updateDisbursementModeUI();
      renderDisbursementList();
      renderEmployeeKpis();
      // Update bank selection in Payroll Run
      document.querySelectorAll('#bankSelectGrid .bank-tile').forEach(tile => {
        tile.classList.toggle('active', tile.dataset.bank === bankName);
      });
      toggleEditMode(false);
      toast('Company profile updated.', 'success');
    } catch (err) {
      toast('Save failed: ' + err.message, 'error');
    }
  });

  // Initial state: read-only
  toggleEditMode(false);
}

// ---------------------------------------------------------
// Settings
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

  // Company settings from Settings page - navigate to Company page
  document.getElementById('openCompanySettingsBtn').addEventListener('click', () => {
    goToPage('company');
  });

  document.getElementById('changeEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearSettingsMsg('settingsEmailMsg');
    const btn = document.getElementById('changeEmailBtn');
    const currentPassword = document.getElementById('emailChangeCurrentPassword').value;
    const newEmail = document.getElementById('newEmailInput').value.trim();
    btn.disabled = true; btn.textContent = 'Updating...';
    try {
      await reauthenticate(currentPassword);
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

setInterval(checkInactivity, 30000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkInactivity();
});
window.addEventListener('focus', checkInactivity);