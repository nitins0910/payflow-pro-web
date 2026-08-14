// ============================================================
// PayFlow Pro — Multi-Bank Payroll Engine
// ============================================================

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
// 1. SESSION PERSISTENCE (Tab/Browser close = Logout)
// ---------------------------------------------------------
const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch((err) => {
  console.warn("Could not set session persistence:", err);
});

const RECAPTCHA_V3_SITE_KEY = "6LcGm4UtAAAAAE6U6J4olvwUW4RDKVcJ0cHTMZ54";
if (RECAPTCHA_V3_SITE_KEY && RECAPTCHA_V3_SITE_KEY.indexOf("PASTE_YOUR") !== 0) {
  try {
    firebase.appCheck().activate(
      new firebase.appCheck.ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
      true
    );
  } catch (e) {
    console.warn('[App Check] Warning:', e);
  }
}

const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

const SITE_URL = "https://nitins0910.github.io/payflow-pro-web/";
const actionCodeSettings = { url: SITE_URL, handleCodeInApp: true };

// ---------------------------------------------------------
// 2. FIRESTORE DATA LAYER
// ---------------------------------------------------------
let currentUserId = null;
async function initUserContext(uid) { currentUserId = uid; }
function userRef() { return db.collection('users').doc(currentUserId); }

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
      bankName: d.bankName || 'SBI',
      name: d.companyName || '',
      accountNumber: d.accountNumber || '',
      sysId: d.sysId || ''
    };
  },
  async updateCompanyProfile({ bankName, name, accountNumber, sysId }) {
    await userRef().set({
      bankName: bankName || 'SBI',
      companyName: name,
      accountNumber,
      sysId,
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// ---------------------------------------------------------
// 2c. MULTI-BANK BULK FORMATTERS
// ---------------------------------------------------------
function getTxnMode(ifsc, bankPrefix, amount) {
  if (ifsc && bankPrefix && ifsc.toUpperCase().startsWith(bankPrefix.toUpperCase())) {
    return 'FT';
  }
  return amount >= 200000 ? 'RTGS' : 'NEFT';
}

const BankFormatters = {
  SBI: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(company, lines, meta) {
      const prefix = meta.tft === 'Same Bank' ? 'SBST' : 'OBST';
      const batchId = `${prefix}${meta.shortYear}${meta.monthRaw}${meta.seq}`;
      const header = `${company.accountNumber}#${company.sysId}#${meta.txnDate}#${meta.total.toFixed(2)}##${batchId}#${company.name}#SALARY OF ${meta.monthName} ${meta.year}#`;
      const empLines = lines.map(({ acc, empCode, name, ifsc, amount }) => {
        const seqStr = `${prefix}${meta.shortYear}${meta.monthRaw}E${empCode}`;
        return `${acc}#${ifsc}#${meta.txnDate}##${amount.toFixed(2)}#${seqStr}#${name}#SALARY OF ${meta.monthName} ${meta.year}#`;
      });
      return { content: [header, ...empLines].join('\n') + '\n', batchId, prefix };
    }
  },
  PNB: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(company, lines, meta) {
      const rows = lines.map(l => {
        const mode = getTxnMode(l.ifsc, 'PUNB', l.amount);
        return `"${company.accountNumber}","${l.acc}","${l.amount.toFixed(2)}","${l.name}","${l.ifsc}","${mode}","${meta.txnDate}","SALARY ${meta.monthName} ${meta.year}"`;
      });
      return { content: rows.join('\n') + '\n', batchId: `PNB${meta.shortYear}${meta.monthRaw}${meta.seq}`, prefix: 'PNB' };
    }
  },
  BOB: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(company, lines, meta) {
      const rows = lines.map(l => {
        const mode = l.ifsc.startsWith('BARB') ? 'BOB' : (l.amount >= 200000 ? 'RTGS' : 'NEFT');
        return `"${mode}","${company.accountNumber}","${l.acc}","${l.name}","${l.amount.toFixed(2)}","${l.ifsc}","SALARY ${meta.monthName} ${meta.year}","${meta.txnDate}"`;
      });
      return { content: rows.join('\n') + '\n', batchId: `BOB${meta.shortYear}${meta.monthRaw}${meta.seq}`, prefix: 'BOB' };
    }
  },
  CNRB: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(company, lines, meta) {
      const rows = lines.map(l => `"${company.accountNumber}","${l.acc}","${l.amount.toFixed(2)}","${l.ifsc}","${l.name}","SALARY ${meta.monthName} ${meta.year}","${company.name}"`);
      return { content: rows.join('\n') + '\n', batchId: `CNRB${meta.shortYear}${meta.monthRaw}${meta.seq}`, prefix: 'CNRB' };
    }
  },
  UBI: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(company, lines, meta) {
      const rows = lines.map(l => `"${company.accountNumber}","${l.acc}","${l.name}","${l.amount.toFixed(2)}","${l.ifsc}","${getTxnMode(l.ifsc, 'UBIN', l.amount)}","SALARY ${meta.monthName}"`);
      return { content: rows.join('\n') + '\n', batchId: `UBI${meta.shortYear}${meta.monthRaw}${meta.seq}`, prefix: 'UBI' };
    }
  },
  INDB: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(company, lines, meta) {
      const rows = lines.map(l => {
        const mode = l.ifsc.startsWith('IDIB') ? 'I' : (l.amount >= 200000 ? 'R' : 'N');
        return `"${mode}","${company.accountNumber}","${l.acc}","${l.amount.toFixed(2)}","${l.name}","${l.ifsc}","SALARY ${meta.monthName}"`;
      });
      return { content: rows.join('\n') + '\n', batchId: `INDB${meta.shortYear}${meta.monthRaw}${meta.seq}`, prefix: 'INDB' };
    }
  },
  HDFC: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(company, lines, meta) {
      const rows = lines.map(l => `"${getTxnMode(l.ifsc, 'HDFC', l.amount)}","${company.accountNumber}","${l.acc}","${l.name}","${l.amount.toFixed(2)}","${l.ifsc}","${meta.txnDate}","","SALARY ${meta.monthName} ${meta.year}"`);
      return { content: rows.join('\n') + '\n', batchId: `HDFC${meta.shortYear}${meta.monthRaw}${meta.seq}`, prefix: 'HDFC' };
    }
  },
  ICICI: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(company, lines, meta) {
      const rows = lines.map(l => `${getTxnMode(l.ifsc, 'ICIC', l.amount)}^${company.accountNumber}^${l.acc}^${l.amount.toFixed(2)}^${l.name}^${l.ifsc}^SALARY ${meta.monthName} ${meta.year}`);
      return { content: rows.join('\n') + '\n', batchId: `ICIC${meta.shortYear}${meta.monthRaw}${meta.seq}`, prefix: 'ICICI' };
    }
  },
  AXIS: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(company, lines, meta) {
      const header = "PaymentType,DebitAcc,BenAcc,BenName,Amount,IFSC,Remarks,TxnDate";
      const rows = lines.map(l => {
        const mode = l.ifsc.startsWith('UTIB') ? 'PA' : (l.amount >= 200000 ? 'RT' : 'NE');
        return `"${mode}","${company.accountNumber}","${l.acc}","${l.name}","${l.amount.toFixed(2)}","${l.ifsc}","SALARY ${meta.monthName}","${meta.txnDate}"`;
      });
      return { content: [header, ...rows].join('\n') + '\n', batchId: `AXIS${meta.shortYear}${meta.monthRaw}${meta.seq}`, prefix: 'AXIS' };
    }
  },
  KOTAK: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(company, lines, meta) {
      const clientCode = company.sysId || 'KOTAK';
      const header = "ClientCode,DebitAcc,BenAcc,Amount,BenName,IFSC,ValueDate,Narration";
      const rows = lines.map(l => `"${clientCode}","${company.accountNumber}","${l.acc}","${l.amount.toFixed(2)}","${l.name}","${l.ifsc}","${meta.txnDate}","SALARY ${meta.monthName}"`);
      return { content: [header, ...rows].join('\n') + '\n', batchId: `KOTAK${meta.shortYear}${meta.monthRaw}${meta.seq}`, prefix: 'KOTAK' };
    }
  },
  INDUSIND: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(company, lines, meta) {
      const header = "TxnType,DebitAcc,BenAcc,BenName,Amount,IFSC,Narration,Email";
      const rows = lines.map(l => `"${getTxnMode(l.ifsc, 'INDB', l.amount)}","${company.accountNumber}","${l.acc}","${l.name}","${l.amount.toFixed(2)}","${l.ifsc}","SALARY ${meta.monthName}",""`);
      return { content: [header, ...rows].join('\n') + '\n', batchId: `INDUS${meta.shortYear}${meta.monthRaw}${meta.seq}`, prefix: 'INDUS' };
    }
  },
  YES: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(company, lines, meta) {
      const rows = lines.map(l => `"${getTxnMode(l.ifsc, 'YESB', l.amount)}","${company.accountNumber}","${l.acc}","${l.amount.toFixed(2)}","${l.name}","${l.ifsc}","SALARY ${meta.monthName}"`);
      return { content: rows.join('\n') + '\n', batchId: `YES${meta.shortYear}${meta.monthRaw}${meta.seq}`, prefix: 'YES' };
    }
  },
  PAYMENTS_BANK: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(company, lines, meta) {
      const header = "BeneficiaryAccount,IFSC,BeneficiaryName,Amount,PaymentMode,Remarks,ClientRefId";
      const rows = lines.map((l, idx) => `"${l.acc}","${l.ifsc}","${l.name}","${l.amount.toFixed(2)}","${l.amount >= 200000 ? 'RTGS' : 'NEFT'}","SALARY","REF${meta.shortYear}${meta.monthRaw}${idx+1}"`);
      return { content: [header, ...rows].join('\n') + '\n', batchId: `PAYM${meta.shortYear}${meta.monthRaw}${meta.seq}`, prefix: 'PAYM' };
    }
  }
};

// ---------------------------------------------------------
// 3. SCREEN ROUTER
// ---------------------------------------------------------
const SCREENS = ['auth', 'verify-pending', 'verifying', 'reset-password', 'complete-profile', 'dashboard'];
function showScreen(name) {
  SCREENS.forEach(s => {
    const el = document.getElementById('screen-' + s);
    if (el) el.classList.toggle('hidden', s !== name);
  });
}

function mapAuthError(err) {
  const map = {
    'auth/email-already-in-use': 'This email is already registered.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password should be at least 8 characters.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment.'
  };
  return map[err.code] || err.message;
}

function showAuthError(msg) {
  const box = document.getElementById('errorBox');
  if (box) { box.textContent = msg; box.classList.add('show'); }
}
function clearAuthError() {
  const box = document.getElementById('errorBox');
  if (box) { box.textContent = ''; box.classList.remove('show'); }
}
function showAuthSuccess(msg) {
  const box = document.getElementById('successBox');
  if (box) { box.textContent = msg; box.classList.add('show'); }
}
function clearAuthSuccess() {
  const box = document.getElementById('successBox');
  if (box) { box.textContent = ''; box.classList.remove('show'); }
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
    });
  });
}

function goToAuthScreen() {
  clearAuthError();
  clearAuthSuccess();
  document.getElementById('signupForm').classList.add('hidden');
  document.getElementById('forgotPasswordForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
  document.getElementById('switchModeWrap').classList.remove('hidden');
  document.getElementById('authDivider').classList.remove('hidden');
  document.getElementById('googleBtn').classList.remove('hidden');
  document.getElementById('switchToLoginWrap').classList.add('hidden');
  document.getElementById('switchToSignupWrap').classList.remove('hidden');
  showScreen('auth');
}

// ---------------------------------------------------------
// 4. AUTH FLOW
// ---------------------------------------------------------
let suppressAutoRoute = false;

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
  document.getElementById('forgotPasswordLink').onclick = () => {
    clearAuthError(); clearAuthSuccess();
    loginForm.classList.add('hidden');
    forgotForm.classList.remove('hidden');
    document.getElementById('switchModeWrap').classList.add('hidden');
    document.getElementById('authDivider').classList.add('hidden');
    document.getElementById('googleBtn').classList.add('hidden');
    document.getElementById('forgotEmail').value = document.getElementById('loginEmail').value || '';
  };
  document.getElementById('forgotBackBtn').onclick = () => {
    clearAuthError(); clearAuthSuccess();
    forgotForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    document.getElementById('switchModeWrap').classList.remove('hidden');
    document.getElementById('authDivider').classList.remove('hidden');
    document.getElementById('googleBtn').classList.remove('hidden');
  };

  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthError(); clearAuthSuccess();
    const btn = document.getElementById('forgotSubmitBtn');
    const email = document.getElementById('forgotEmail').value.trim();
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      await auth.sendPasswordResetEmail(email, actionCodeSettings);
      showAuthSuccess('If an account exists, a password reset link has been dispatched.');
      forgotForm.reset();
    } catch (err) {
      showAuthSuccess('If an account exists, a password reset link has been dispatched.');
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
      if (result.additionalUserInfo && result.additionalUserInfo.isNewUser) {
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
// 5. ROUTER
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
// 6. DASHBOARD & STATE
// ---------------------------------------------------------
let employees = [];
let editingEmployeeId = null;
let salaryValues = {}; // PERSISTENT STORE FOR SEARCH BUG FIX
let companyProfile = { bankName: 'SBI', name: '', accountNumber: '', sysId: '' };
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

  // Context-aware Settings Page for Google vs Email Auth
  const isGoogleUser = user.providerData && user.providerData.some(p => p.providerId === 'google.com');
  const gNotice = document.getElementById('googleAccountNotice');
  const emailOpts = document.getElementById('emailAuthOptions');
  if (gNotice && emailOpts) {
    gNotice.classList.toggle('hidden', !isGoogleUser);
    emailOpts.classList.toggle('hidden', isGoogleUser);
  }

  try {
    await initUserContext(user.uid);
  } catch (err) {
    alert('Could not load account data: ' + err.message);
    return;
  }

  populateMonthYearAndDate();
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
    wireModalDismissals();
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

function wireModalDismissals() {
  // ESC & Backdrop Close
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.add('hidden');
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
    }
  });
}

// ---------------------------------------------------------
// 7. EMPLOYEES & DISBURSEMENT
// ---------------------------------------------------------
async function loadEmployees() {
  try {
    employees = await Api.getEmployees();
  } catch (err) {
    console.error(err);
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

function renderEmployeeTable() {
  const tbody = document.getElementById('employeeTableBody');
  const emptyState = document.getElementById('employeeEmptyState');
  const query = (document.getElementById('employeeSearch').value || '').trim().toLowerCase();

  const filtered = employees.filter(e =>
    !query || e.name.toLowerCase().includes(query) || String(e.accountNumber).includes(query) || String(e.empCode).includes(query));

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

function populateMonthYearAndDate() {
  const monthSel = document.getElementById('disbMonth');
  const yearSel = document.getElementById('disbYear');
  const customDate = document.getElementById('disbCustomDate');
  const now = new Date();

  monthSel.innerHTML = MONTHS.map((m, i) => `<option value="${String(i+1).padStart(2,'0')}">${String(i+1).padStart(2,'0')} - ${m}</option>`).join('');
  monthSel.value = String(now.getMonth()+1).padStart(2,'0');

  const cy = now.getFullYear();
  yearSel.innerHTML = Array.from({length:11}, (_, i) => cy+i).map(y => `<option value="${y}">${y}</option>`).join('');
  yearSel.value = String(cy);

  // Set default manual date as YYYY-MM-DD
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  customDate.value = `${yyyy}-${mm}-${dd}`;
}

function renderDisbursementList() {
  const tbody = document.getElementById('disbTableBody');
  const emptyState = document.getElementById('disbEmptyState');
  if (!tbody) return;

  const tft = document.getElementById('disbTransferType').value;
  const query = (document.getElementById('disbSearch').value || '').trim().toLowerCase();

  tbody.innerHTML = '';
  const filtered = employees.filter(e =>
    e.transferType === tft &&
    (!query || e.name.toLowerCase().includes(query) || String(e.accountNumber).includes(query) || String(e.empCode).includes(query)));

  if (!filtered.length) { emptyState.classList.remove('hidden'); updateBatchTotal(); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(emp => {
    const val = salaryValues[emp.accountNumber] || '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(emp.empCode)}</td>
      <td>${escapeHtml(emp.name)}</td>
      <td><span class="masked-acc"><span data-full="${escapeHtml(emp.accountNumber)}" data-revealed="0">${escapeHtml(maskAccount(emp.accountNumber))}</span><button type="button">Show</button></span></td>
      <td style="text-align:right;">
        <input type="text" data-acc="${escapeHtml(emp.accountNumber)}" value="${escapeHtml(val)}" placeholder="0.00"
          style="width:120px; text-align:right; background:var(--surface2); border:1px solid var(--border); color:var(--success); padding:6px 8px; border-radius:4px;">
      </td>`;
    tbody.appendChild(tr);

    const inputEl = tr.querySelector('input');
    inputEl.addEventListener('input', () => {
      salaryValues[emp.accountNumber] = inputEl.value.trim();
      updateBatchTotal();
    });
  });
  wireMaskedAccountToggles(tbody);
  updateBatchTotal();
}

function updateBatchTotal() {
  let total = 0;
  Object.values(salaryValues).forEach(val => {
    const v = parseFloat(val);
    if (!isNaN(v) && v > 0) total += v;
  });
  document.getElementById('disbTotal').textContent = `BATCH TOTAL ₹ ${total.toFixed(2)}`;
}

function wireDisbursement() {
  document.getElementById('disbTransferType').addEventListener('change', renderDisbursementList);
  document.getElementById('disbSearch').addEventListener('input', renderDisbursementList);
  document.getElementById('disbClearBtn').addEventListener('click', () => {
    salaryValues = {};
    renderDisbursementList();
  });
  document.getElementById('disbExportBtn').addEventListener('click', openExportPreview);
  document.getElementById('cancelExportBtn').addEventListener('click', () => {
    document.getElementById('exportPreviewModal').classList.add('hidden');
  });
}

function collectBatchLines() {
  const tft = document.getElementById('disbTransferType').value;
  const lines = [];
  let total = 0, hasInvalid = false;

  employees.filter(e => e.transferType === tft).forEach(emp => {
    const raw = salaryValues[emp.accountNumber];
    if (!raw) return;
    const v = parseFloat(raw);
    if (isNaN(v) || v <= 0) { hasInvalid = true; return; }
    total += v;
    lines.push({ acc: emp.accountNumber, empCode: emp.empCode, name: emp.name, ifsc: emp.ifsc, amount: v });
  });

  return { tft, lines, total, hasInvalid };
}

function openExportPreview() {
  const { tft, lines, total, hasInvalid } = collectBatchLines();
  if (hasInvalid) { alert('Some entered amounts have invalid numeric formats.'); return; }
  if (!lines.length) { alert('No valid payout amounts entered for this transfer type.'); return; }

  const monthRaw = document.getElementById('disbMonth').value;
  const monthName = MONTHS[parseInt(monthRaw,10)-1];
  const year = document.getElementById('disbYear').value;
  const bank = companyProfile.bankName || 'SBI';

  document.getElementById('exportPreviewBody').innerHTML = `
    <p><strong>Bank Format:</strong> ${escapeHtml(bank)}</p>
    <p><strong>Transfer Type:</strong> ${escapeHtml(tft)}</p>
    <p><strong>Cycle:</strong> ${escapeHtml(monthName)} ${escapeHtml(year)}</p>
    <p><strong>Total Beneficiaries:</strong> ${lines.length}</p>
    <p style="font-size:20px; color:var(--success); font-weight:700; margin-top:8px;">₹ ${total.toFixed(2)}</p>
  `;
  document.getElementById('exportPreviewModal').classList.remove('hidden');
  document.getElementById('confirmExportBtn').onclick = () => {
    document.getElementById('exportPreviewModal').classList.add('hidden');
    executeExport();
  };
}

async function executeExport() {
  const { tft, lines, total } = collectBatchLines();
  const monthRaw = document.getElementById('disbMonth').value;
  const monthName = MONTHS[parseInt(monthRaw,10)-1];
  const year = document.getElementById('disbYear').value;
  const shortYear = year.slice(2);

  // Parse Manual Custom Value Date
  const rawDateVal = document.getElementById('disbCustomDate').value;
  let txnDate;
  if (rawDateVal) {
    const [y, m, d] = rawDateVal.split('-');
    txnDate = `${d}/${m}/${y}`;
  } else {
    txnDate = formatDateDDMMYYYY(new Date());
  }

  let seq;
  try {
    seq = await Api.getAndIncrementCounter();
  } catch (err) {
    alert('Could not allocate sequence number: ' + err.message);
    return;
  }

  const selectedBank = companyProfile.bankName || 'SBI';
  const formatter = BankFormatters[selectedBank] || BankFormatters.SBI;

  const meta = { tft, lines, total, monthRaw, monthName, year, shortYear, txnDate, seq };
  const { content, batchId, prefix } = formatter.generate(companyProfile, lines, meta);

  const fileName = `${(prefix || selectedBank).toLowerCase()}_salary_${monthName}_${year}.${formatter.ext}`;
  downloadTextFile(fileName, content, formatter.mime);

  const logRows = lines.map(({ acc, empCode, name, ifsc, amount }) => ({
    batchId, transferDate: txnDate, empCode, employeeName: name,
    accountNumber: acc, ifsc, amount: amount.toFixed(2), transferType: tft, bank: selectedBank
  }));

  try {
    await Api.addDisbursementRows(logRows);
    await Api.logAudit(currentUser.email, currentUser.displayName, 'EXPORT FILE',
      `Bank: ${selectedBank} | Batch: ${batchId} | Total: ₹${total.toFixed(2)} | Lines: ${lines.length}`);
  } catch (err) {
    console.error('Audit write error:', err);
  }
}

function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------
// 8. EMPLOYEE MODAL FORM
// ---------------------------------------------------------
function splitFullNameParts(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return ['', '', ''];
  if (parts.length === 1) return [parts[0], '', ''];
  if (parts.length === 2) return [parts[0], '', parts[1]];
  return [parts[0], parts.slice(1, -1).join(' '), parts[parts.length - 1]];
}

function wireEmployeeForm() {
  const modal = document.getElementById('employeeModal');
  const form = document.getElementById('employeeForm');
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

  function validateLive() {
    const acc = fAcc.value.trim();
    const accC = fAccC.value.trim();
    const ifsc = fIfsc.value.trim().toUpperCase();
    const ifscC = fIfscC.value.trim().toUpperCase();

    if (accC) {
      accMismatchLbl.textContent = (acc !== accC) ? 'MISMATCH' : '';
    } else {
      accMismatchLbl.textContent = '';
    }

    if (ifscC) {
      ifscMismatchLbl.textContent = (ifsc !== ifscC) ? 'MISMATCH' : '';
    } else {
      ifscMismatchLbl.textContent = '';
    }
  }

  [fAcc, fAccC, fIfsc, fIfscC].forEach(el => el.addEventListener('input', validateLive));

  document.getElementById('addEmployeeBtn').onclick = () => {
    editingEmployeeId = null;
    document.getElementById('modalTitle').textContent = 'Add Employee Record';
    form.reset();
    accMismatchLbl.textContent = '';
    ifscMismatchLbl.textContent = '';
    errBox.classList.remove('show');
    modal.classList.remove('hidden');
  };
  document.getElementById('cancelModalBtn').onclick = () => modal.classList.add('hidden');

  window.openEditModal = (id) => {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    editingEmployeeId = id;
    document.getElementById('modalTitle').textContent = 'Edit Employee Record';
    form.reset();
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.remove('show');

    const fname  = fFirst.value.trim();
    const mname  = fMiddle.value.trim();
    const lname  = fLast.value.trim();
    const acc    = fAcc.value.trim().replace(/\s+/g, '');
    const accC   = fAccC.value.trim().replace(/\s+/g, '');
    const ifsc   = fIfsc.value.trim().replace(/\s+/g, '').toUpperCase();
    const ifscC  = fIfscC.value.trim().replace(/\s+/g, '').toUpperCase();
    const empCode = fCode.value.trim().padStart(2, '0');
    const transferType = fType.value;

    if (acc !== accC || ifsc !== ifscC) {
      errBox.textContent = 'Double-entry validation failed. Account or IFSC numbers do not match.';
      errBox.classList.add('show');
      return;
    }

    const nameParts = [fname];
    if (mname) nameParts.push(mname);
    nameParts.push(lname);
    const fullName = nameParts.join(' ').toUpperCase();

    const emp = { name: fullName, accountNumber: acc, ifsc, empCode, transferType };
    const btn = document.getElementById('saveEmployeeBtn');
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      if (editingEmployeeId) {
        await Api.updateEmployee(editingEmployeeId, emp);
      } else {
        await Api.addEmployee(emp);
      }
      modal.classList.add('hidden');
      await loadEmployees();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('show');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Record';
    }
  });

  window.handleDelete = async (id) => {
    const emp = employees.find(e => e.id === id);
    if (!confirm(`Delete ${emp ? emp.name : 'this record'} permanently?`)) return;
    try {
      await Api.deleteEmployee(id);
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
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length <= 1) { alert('No records found in CSV.'); return; }
    
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      if (cols.length >= 2) {
        rows.push({
          accountNumber: cols[0],
          ifsc: (cols[1] || '').toUpperCase(),
          name: (cols[2] || '').toUpperCase(),
          transferType: cols[3] || 'Same Bank',
          empCode: (cols[4] || '01').padStart(2, '0')
        });
      }
    }
    try {
      await Api.bulkAddEmployees(rows);
      await loadEmployees();
      alert(`Successfully imported ${rows.length} records.`);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    fileInput.value = '';
  });
}

// ---------------------------------------------------------
// 9. COMPANY & SETTINGS
// ---------------------------------------------------------
async function loadCompanyProfile() {
  try {
    const p = await Api.getCompanyProfile();
    companyProfile = { ...companyProfile, ...p };
    document.getElementById('companyBankInput').value = p.bankName || 'SBI';
    document.getElementById('companyNameInput').value = p.name || '';
    document.getElementById('companyAccInput').value = p.accountNumber || '';
    document.getElementById('companySysInput').value = p.sysId || '';
  } catch (err) {
    console.error(err);
  }
}

function wireCompanyForm() {
  document.getElementById('saveCompanyBtn').addEventListener('click', async () => {
    const bankName = document.getElementById('companyBankInput').value;
    const name = document.getElementById('companyNameInput').value.trim().toUpperCase();
    const accountNumber = document.getElementById('companyAccInput').value.trim();
    const sysId = document.getElementById('companySysInput').value.trim();
    if (!name || !accountNumber) { alert('Company name and account number are required.'); return; }
    try {
      await Api.updateCompanyProfile({ bankName, name, accountNumber, sysId });
      companyProfile = { ...companyProfile, bankName, name, accountNumber, sysId };
      alert('Company profile updated successfully.');
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  });
}

function wireSettingsForms() {
  document.getElementById('openChangeEmailBtn').onclick = () => {
    document.getElementById('changeEmailForm').reset();
    document.getElementById('changeEmailModal').classList.remove('hidden');
  };
  document.getElementById('cancelChangeEmailBtn').onclick = () => {
    document.getElementById('changeEmailModal').classList.add('hidden');
  };

  document.getElementById('openChangePasswordBtn').onclick = () => {
    document.getElementById('changePasswordForm').reset();
    document.getElementById('changePasswordModal').classList.remove('hidden');
  };
  document.getElementById('cancelChangePasswordBtn').onclick = () => {
    document.getElementById('changePasswordModal').classList.add('hidden');
  };

  document.getElementById('changeEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('changeEmailBtn');
    const pwd = document.getElementById('emailChangeCurrentPassword').value;
    const newEmail = document.getElementById('newEmailInput').value.trim();
    btn.disabled = true;
    try {
      const cred = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, pwd);
      await auth.currentUser.reauthenticateWithCredential(cred);
      await auth.currentUser.verifyBeforeUpdateEmail(newEmail, actionCodeSettings);
      alert(`Verification sent to ${newEmail}. Changes take effect after confirmation.`);
      document.getElementById('changeEmailModal').classList.add('hidden');
    } catch (err) {
      alert(mapAuthError(err));
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('changePasswordBtn');
    const pwd = document.getElementById('pwChangeCurrentPassword').value;
    const newPwd = document.getElementById('pwChangeNewPassword').value;
    btn.disabled = true;
    try {
      const cred = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, pwd);
      await auth.currentUser.reauthenticateWithCredential(cred);
      await auth.currentUser.updatePassword(newPwd);
      alert('Password updated successfully.');
      document.getElementById('changePasswordModal').classList.add('hidden');
    } catch (err) {
      alert(mapAuthError(err));
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------
// 10. AUDIT TRAIL
// ---------------------------------------------------------
async function loadAuditTrail() {
  try {
    const logs = await Api.getAuditTrail();
    const tbody = document.getElementById('auditTableBody');
    const emptyState = document.getElementById('auditEmptyState');
    tbody.innerHTML = '';
    if (!logs.length) { emptyState.classList.remove('hidden'); return; }
    emptyState.classList.add('hidden');
    logs.forEach(r => {
      const ts = r.timestamp && r.timestamp.toDate ? r.timestamp.toDate().toLocaleString() : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(ts)}</td><td>${escapeHtml(r.userName || r.userEmail)}</td><td>${escapeHtml(r.action)}</td><td>${escapeHtml(r.details || '')}</td>`;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
  }
}

function wireAudit() {
  document.getElementById('auditSearch').addEventListener('input', () => {
    const query = document.getElementById('auditSearch').value.trim().toLowerCase();
    document.querySelectorAll('#auditTableBody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
  });
}

// ---------------------------------------------------------
// 11. BOOTSTRAP
// ---------------------------------------------------------
wireAuthForms();
wirePasswordToggles();
auth.onAuthStateChanged(routeUser);