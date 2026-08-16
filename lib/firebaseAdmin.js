// Shared Firebase Admin SDK setup, reused by every function in /api.
// Same logic as the old Netlify version — just adapted from the
// (event, context) signature to Vercel's (req, res) signature.
//
// Required env vars (set these in Vercel dashboard -> Project ->
// Settings -> Environment Variables):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (paste the full key; this file fixes up the
//                            escaped \n newlines that env var UIs introduce)
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

// ---------------------------------------------------------
// CORS — same idea as before: frontend and functions can live on
// different origins, so every response needs
// Access-Control-Allow-Origin or the browser silently drops it.
//
// Add any other origins you serve the app from to this list.
// ---------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://nitins0910.github.io',
  'http://localhost:8888',
  'http://localhost:3000'
];

function applyCors(req, res) {
  const origin = (req.headers && req.headers.origin) || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

// Every handler should call this first and return immediately if it
// returns true — handles the preflight OPTIONS request the browser
// sends before the real POST for cross-origin calls with custom headers.
function handleOptions(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

// Verifies the Firebase ID token sent by the browser (Authorization:
// Bearer <token>) and returns the decoded token (contains uid, email).
// Throws if the token is missing/invalid/expired — every function below
// treats that as a 401.
async function requireUser(req) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    const err = new Error('Missing Authorization header');
    err.statusCode = 401;
    throw err;
  }
  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (e) {
    const err = new Error('Invalid or expired session. Please sign in again.');
    err.statusCode = 401;
    throw err;
  }
}

function json(res, statusCode, body) {
  res.status(statusCode).json(body);
}

module.exports = { admin, db, requireUser, json, handleOptions, applyCors };
