// ============================================================
// PayFlow Pro — Authentication + Company Onboarding
// ============================================================

const errorBox = document.getElementById('errorBox');
function showError(msg){
  errorBox.textContent = msg;
  errorBox.classList.add('show');
}
function clearError(){
  errorBox.textContent = '';
  errorBox.classList.remove('show');
}

auth.onAuthStateChanged(user => {
  if (user) window.location.href = 'dashboard.html';
});

// ---------- Toggle login / signup ----------
const loginForm  = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
document.getElementById('switchToSignup').onclick = () => {
  clearError();
  loginForm.classList.add('hidden');
  signupForm.classList.remove('hidden');
  document.getElementById('switchToSignupWrap').classList.add('hidden');
  document.getElementById('switchToLoginWrap').classList.remove('hidden');
};
document.getElementById('switchToLogin').onclick = () => {
  clearError();
  signupForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  document.getElementById('switchToLoginWrap').classList.add('hidden');
  document.getElementById('switchToSignupWrap').classList.remove('hidden');
};

// ---------- Signup mode: create vs join company ----------
let signupMode = 'create'; // 'create' | 'join'
const companyNameField = document.getElementById('companyNameField');
const companyCodeField = document.getElementById('companyCodeField');
const modeCreateBtn = document.getElementById('modeCreateCompany');
const modeJoinBtn   = document.getElementById('modeJoinCompany');

function setSignupMode(mode) {
  signupMode = mode;
  const creating = mode === 'create';
  companyNameField.classList.toggle('hidden', !creating);
  companyCodeField.classList.toggle('hidden', creating);
  modeCreateBtn.classList.toggle('secondary', !creating);
  modeJoinBtn.classList.toggle('secondary', creating);
}
modeCreateBtn.onclick = () => setSignupMode('create');
modeJoinBtn.onclick   = () => setSignupMode('join');
setSignupMode('create');

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createCompany(companyName, uid) {
  let code, exists = true;
  while (exists) {
    code = generateJoinCode();
    const snap = await db.collection('companies').where('joinCode', '==', code).limit(1).get();
    exists = !snap.empty;
  }
  const companyRef = db.collection('companies').doc();
  await companyRef.set({
    name: companyName,
    joinCode: code,
    createdBy: uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await companyRef.collection('private').doc('profile').set({
    accountNumber: '',
    sysId: '',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await companyRef.collection('meta').doc('fileCounter').set({ value: 1 });
  return companyRef.id;
}

async function joinCompanyByCode(code) {
  const snap = await db.collection('companies').where('joinCode', '==', code.toUpperCase().trim()).limit(1).get();
  if (snap.empty) throw new Error('No company found with that join code.');
  return snap.docs[0].id;
}

// ---------- Friendly error messages ----------
function friendlyAuthError(code){
  const map = {
    'auth/email-already-in-use': 'An account with this email already exists. Try signing in instead.',
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.'
  };
  return map[code] || 'Something went wrong. Please try again.';
}

// ---------- Signup ----------
signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const companyName = document.getElementById('signupCompanyName').value.trim();
  const companyCode = document.getElementById('signupCompanyCode').value.trim();
  const btn = document.getElementById('signupBtn');

  if (signupMode === 'create' && !companyName) {
    showError('Please enter a company name.'); return;
  }
  if (signupMode === 'join' && !companyCode) {
    showError('Please enter the company join code.'); return;
  }

  btn.disabled = true; btn.textContent = 'Creating account...';
  let cred;
  try {
    cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });

    let companyId;
    if (signupMode === 'create') {
      companyId = await createCompany(companyName, cred.user.uid);
    } else {
      companyId = await joinCompanyByCode(companyCode);
    }

    await db.collection('users').doc(cred.user.uid).set({
      companyId, name, email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    window.location.href = 'dashboard.html';
  } catch (err) {
    if (cred && cred.user) { try { await cred.user.delete(); } catch (_) {} }
    showError(err.code ? friendlyAuthError(err.code) : err.message);
    btn.disabled = false; btn.textContent = 'Create Account';
  }
});

// ---------- Login ----------
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Signing in...';

  try {
    await auth.signInWithEmailAndPassword(email, password);
    window.location.href = 'dashboard.html';
  } catch (err) {
    showError(friendlyAuthError(err.code));
    btn.disabled = false; btn.textContent = 'Sign In';
  }
});

// ---------- Google Login ----------
document.getElementById('googleBtn').addEventListener('click', async () => {
  clearError();
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    const cred = await auth.signInWithPopup(provider);
    const userDoc = await db.collection('users').doc(cred.user.uid).get();
    if (!userDoc.exists) {
      alert('Google sign-in needs a company chosen first. Please use email/password signup for now, or ask me to build the choose-company page.');
      await auth.signOut();
      return;
    }
    window.location.href = 'dashboard.html';
  } catch (err) {
    showError(friendlyAuthError(err.code));
  }
});