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

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

module.exports = { admin, db, requireUser, json };
