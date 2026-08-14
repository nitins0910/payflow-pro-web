// ============================================================
// PASTE YOUR FIREBASE CONFIG HERE
// Firebase Console → Project Settings → General → Your apps → Web app
// These values are PUBLIC and safe to commit to GitHub — they are not secrets.
// Security is enforced by Firebase Auth + your Apps Script deployment settings.
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
const auth = firebase.auth();
