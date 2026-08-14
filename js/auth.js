// ============================================================
// PayFlow Pro — Authentication
// Handles: email/password signup, email/password login, Google login.
// One user type only — every signed-in user lands on the same
// hybrid dashboard (dashboard.html).
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

// If already logged in, skip straight to dashboard
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
  const btn = document.getElementById('signupBtn');
  btn.disabled = true; btn.textContent = 'Creating account...';

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    window.location.href = 'dashboard.html';
  } catch (err) {
    showError(friendlyAuthError(err.code));
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
    await auth.signInWithPopup(provider);
    window.location.href = 'dashboard.html';
  } catch (err) {
    showError(friendlyAuthError(err.code));
  }
});
