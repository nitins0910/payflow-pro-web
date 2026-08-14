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
const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// IMPORTANT: this must be your real, live Firebase Hosting URL
// (or custom domain once you attach one). It's what makes the
// verification email link open THIS app instead of Firebase's
// generic default page.
const SITE_URL = "https://payflow-pro-4070a.web.app/";
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
// 3. SCREEN ROUTER
// Only one of these top-level screens is visible at a time.
// ---------------------------------------------------------
const SCREENS = ['auth', 'verify-pending', 'verifying', 'dashboard'];
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
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was closed before completing.',
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

// Always land on the LOGIN form (not signup) whenever we route back
// to the auth screen — fixes "stuck on signup form" after verifying
// email, logging out, or clicking "use a different account".
function goToAuthScreen() {
  clearAuthError();
  document.getElementById('signupForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
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
    clearAuthError();
    loginForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
    document.getElementById('switchToSignupWrap').classList.add('hidden');
    document.getElementById('switchToLoginWrap').classList.remove('hidden');
  };
  switchToLogin.onclick = () => {
    clearAuthError();
    signupForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    document.getElementById('switchToLoginWrap').classList.add('hidden');
    document.getElementById('switchToSignupWrap').classList.remove('hidden');
  };

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
      await auth.signInWithPopup(googleProvider);
      // Google accounts come pre-verified, routeUser() sends to dashboard.
    } catch (err) {
      showAuthError(mapAuthError(err));
    }
  };
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

(function boot() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const oobCode = params.get('oobCode');
  if (mode === 'verifyEmail' && oobCode) {
    handleVerifyEmailAction(oobCode);
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
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--danger);">Could not load employees: ${err.message}</td></tr>`;
    return;
  }
  renderEmployeeTable();
  renderDisbursementList();
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
      <td>${emp.name}</td>
      <td>${emp.accountNumber}</td>
      <td>${emp.ifsc}</td>
      <td>${emp.transferType}</td>
      <td>${emp.empCode}</td>
      <td class="row-actions">
        <button data-edit="${emp.id}">Edit</button>
        <button data-delete="${emp.id}" class="danger">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openEditModal(btn.dataset.edit));
  tbody.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => handleDelete(btn.dataset.delete));
}

function wireEmployeeForm() {
  const modal = document.getElementById('employeeModal');
  const employeeForm = document.getElementById('employeeForm');

  document.getElementById('addEmployeeBtn').onclick = () => {
    editingEmployeeId = null;
    document.getElementById('modalTitle').textContent = 'Add Employee';
    employeeForm.reset();
    modal.classList.remove('hidden');
  };
  document.getElementById('cancelModalBtn').onclick = () => modal.classList.add('hidden');

  window.openEditModal = (id) => {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    editingEmployeeId = id;
    document.getElementById('modalTitle').textContent = 'Edit Employee';
    document.getElementById('empName').value = emp.name;
    document.getElementById('empAccount').value = emp.accountNumber;
    document.getElementById('empIfsc').value = emp.ifsc;
    document.getElementById('empCode').value = emp.empCode;
    document.getElementById('empTransferType').value = emp.transferType;
    modal.classList.remove('hidden');
  };

  employeeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveEmployeeBtn');
    btn.disabled = true; btn.textContent = 'Saving...';

    const emp = {
      name: document.getElementById('empName').value.trim().toUpperCase(),
      accountNumber: document.getElementById('empAccount').value.trim(),
      ifsc: document.getElementById('empIfsc').value.trim().toUpperCase(),
      empCode: document.getElementById('empCode').value.trim().padStart(2, '0'),
      transferType: document.getElementById('empTransferType').value,
    };

    try {
      if (editingEmployeeId) {
        await Api.updateEmployee(editingEmployeeId, emp);
        await Api.logAudit(currentUser.email, currentUser.displayName, 'EDIT EMPLOYEE', `${emp.name} | Acc: ${emp.accountNumber}`);
      } else {
        await Api.addEmployee(emp);
        await Api.logAudit(currentUser.email, currentUser.displayName, 'ADD EMPLOYEE', `${emp.name} | Acc: ${emp.accountNumber}`);
      }
      modal.classList.add('hidden');
      await loadEmployees();
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  });

  window.handleDelete = async (id) => {
    const emp = employees.find(e => e.id === id);
    if (!confirm(`Delete ${emp ? emp.name : id}? This cannot be undone.`)) return;
    try {
      await Api.deleteEmployee(id);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'DELETE EMPLOYEE', `${emp ? emp.name : ''} | Acc: ${emp ? emp.accountNumber : id}`);
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
  document.getElementById('disbDateDisplay').textContent = formatDateDDMMYYYY(now);
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
    (!query || e.name.toLowerCase().includes(query) || String(e.accountNumber).includes(query)));

  if (!filtered.length) { emptyState.classList.remove('hidden'); updateBatchTotal(); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(emp => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${emp.empCode}</td>
      <td>${emp.name}</td>
      <td>${emp.accountNumber}</td>
      <td style="text-align:right;">
        <input type="text" data-acc="${emp.accountNumber}" placeholder="0.00"
          style="width:120px; text-align:right; background:var(--surface2); border:1px solid var(--border); color:var(--success); padding:6px 8px;">
      </td>`;
    tbody.appendChild(tr);
    const inputEl = tr.querySelector('input');
    inputEl.addEventListener('input', updateBatchTotal);
    salaryInputs[emp.accountNumber] = { inputEl, name: emp.name, ifsc: emp.ifsc, empCode: emp.empCode };
  });
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
    Object.values(salaryInputs).forEach(md => md.inputEl.value = '');
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
  if (hasInvalid) { alert('Some amounts are not valid numbers.'); return; }
  if (!lines.length) { alert('No valid allocations to export.'); return; }

  const monthRaw = document.getElementById('disbMonth').value;
  const monthName = MONTHS[parseInt(monthRaw,10)-1];
  const year = document.getElementById('disbYear').value;

  document.getElementById('exportPreviewBody').innerHTML = `
    <p><strong>Transfer Type:</strong> ${tft}</p>
    <p><strong>Payroll Cycle:</strong> ${monthName} ${year}</p>
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
  const txnDate = formatDateDDMMYYYY(new Date());

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
    document.getElementById('auditTableBody').innerHTML = `<tr><td colspan="4" style="color:var(--danger);">${err.message}</td></tr>`;
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
    tr.innerHTML = `<td>${ts}</td><td>${r.userName || r.userEmail}</td><td>${r.action}</td><td>${r.details || ''}</td>`;
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
// 11. INACTIVITY AUTO-LOGOUT (15 min)
// ---------------------------------------------------------
let lastActivity = Date.now();
['click','keydown','mousemove'].forEach(evt => document.addEventListener(evt, () => lastActivity = Date.now()));
setInterval(() => {
  if (auth.currentUser && Date.now() - lastActivity > 15 * 60 * 1000) {
    auth.signOut();
  }
}, 30000);