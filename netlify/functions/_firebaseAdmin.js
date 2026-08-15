// Shared Firebase Admin SDK setup, reused by every function in this folder.
// The service account credentials come from Netlify environment variables
// (Site settings -> Environment variables), never committed to the repo.
//
// Required env vars:
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
// CORS
// The static site (GitHub Pages) and these functions (Netlify) live on
// different origins, so every response needs Access-Control-Allow-Origin
// or the browser throws it away before app.js ever sees it (this is
// what caused the "Checking..." button to hang forever — the fetch()
// call was rejecting with a CORS error that nothing was catching).
//
// Add any other origins you serve the app from to this list.
// ---------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://nitins0910.github.io',
  'http://localhost:8888',
  'http://localhost:3000'
];

function corsHeaders(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}

// Every handler should call this first and return its result immediately
// on a truthy return — handles the preflight OPTIONS request the browser
// sends before the real POST for cross-origin calls with custom headers.
function handleOptions(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }
  return null;
}

// Verifies the Firebase ID token sent by the browser (Authorization:
// Bearer <token>) and returns the decoded token (contains uid, email).
// Throws if the token is missing/invalid/expired — every function below
// treats that as a 401.
async function requireUser(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
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

function json(statusCode, body, event) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...(event ? corsHeaders(event) : {})
    },
    body: JSON.stringify(body)
  };
}

module.exports = { admin, db, requireUser, json, handleOptions };