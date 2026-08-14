// ============================================================
// PayFlow Pro — Authentication (simple signup/login + email verification)
// ============================================================

const errorBox = document.getElementById('errorBox');

function showError(msg, resendUser){
  errorBox.innerHTML = '';
  errorBox.append(msg);
  if (resendUser) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Resend verification email';
    btn.style.cssText = 'display:block; margin-top:8px; background:none; border:none; color:var(--cyan); text-decoration:underline; cursor:pointer; font-size:12.5px; padding:0;';
    btn.onclick = async () => {
      try {
        await resendUser.sendEmailVerification();
        await auth.signOut();
        showMessage('Verification email sent again. Please check your inbox (and spam folder).');
      } catch (err) {
        showError('Could not resend email: ' + err.message);
      }
    };
    errorBox.appendChild(btn);
  }
  errorBox.classList.add('show');
}
function showMessage(msg){
  errorBox.innerHTML = msg;
  errorBox.style.background = 'var(--success-bg)';
  errorBox.style.borderColor = 'var(--success)';
  errorBox.style.color = 'var(--success)';
  errorBox.classList.add('show');
}
function clearError(){
  errorBox.innerHTML = '';
  errorBox.classList.remove('show');
  errorBox.style.background = '';
  errorBox.style.borderColor = '';
  errorBox.style.color = '';
}

// Only auto-redirect if the user is signed in AND verified.
auth.onAuthStateChanged(user => {
  if (user && user.emailVerified) {
    window.location.href = 'dashboard.html';
  }
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

  if (!name) { showError('Please enter your full name.'); return; }

  btn.disabled = true; btn.textContent = 'Creating account...';
  let cred;
  try {
    cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });

    // Store the user's own profile doc (no company linkage anymore).
    await db.collection('users').doc(cred.user.uid).set({
      name, email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await cred.user.sendEmailVerification();
    await auth.signOut();

    signupForm.reset();
    signupForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    document.getElementById('switchToLoginWrap').classList.add('hidden');
    document.getElementById('switchToSignupWrap').classList.remove('hidden');
    showMessage(`Account created! We've sent a verification link to <strong>${email}</strong>. Please verify your email, then sign in.`);
  } catch (err) {
    if (cred && cred.user) { try { await cred.user.delete(); } catch (_) {} }
    showError(err.code ? friendlyAuthError(err.code) : err.message);
  } finally {
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
    const cred = await auth.signInWithEmailAndPassword(email, password);
    if (!cred.user.emailVerified) {
      showError('Please verify your email before signing in.', cred.user);
      btn.disabled = false; btn.textContent = 'Sign In';
      return;
    }
    window.location.href = 'dashboard.html';
  } catch (err) {
    showError(friendlyAuthError(err.code));
    btn.disabled = false; btn.textContent = 'Sign In';
  }
});

// ---------- Google Login ----------
// Google-verified emails are trusted automatically (Google already verifies them),
// so no separate company step is needed anymore — we just create the user doc
// on first sign-in if it doesn't exist yet.
document.getElementById('googleBtn').addEventListener('click', async () => {
  clearError();
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    const cred = await auth.signInWithPopup(provider);
    const userDoc = await db.collection('users').doc(cred.user.uid).get();
    if (!userDoc.exists) {
      await db.collection('users').doc(cred.user.uid).set({
        name: cred.user.displayName || '',
        email: cred.user.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    window.location.href = 'dashboard.html';
  } catch (err) {
    showError(friendlyAuthError(err.code));
  }
});