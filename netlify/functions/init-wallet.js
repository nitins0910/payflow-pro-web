// POST /.netlify/functions/init-wallet
//
// Called once every time bootDashboard() runs (every login). Idempotent:
// the very first time a given user hits this, it grants
// FREE_SIGNUP_CREDITS and flips walletInitialized to true inside a
// transaction, so a double-click or two open tabs can never grant the
// free credits twice. Every call after that is a no-op read.
//
// Response: { credits, granted }
//   granted: true only on the call that actually performed the grant —
//   the client uses this single flag to decide whether to show the
//   "Congratulations, you got 5 free credits" banner.
const { db, requireUser, json, handleOptions } = require('./_firebaseAdmin');
const { FREE_SIGNUP_CREDITS } = require('./_creditPacks');

exports.handler = async (event) => {
  const preflight = handleOptions(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, event);

  let decoded;
  try {
    decoded = await requireUser(event);
  } catch (err) {
    return json(err.statusCode || 401, { error: err.message }, event);
  }

  const userRef = db.collection('users').doc(decoded.uid);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.exists ? snap.data() : {};

      if (data.walletInitialized) {
        return { credits: Number(data.credits || 0), granted: false };
      }

      tx.set(userRef, {
        walletInitialized: true,
        credits: FREE_SIGNUP_CREDITS
      }, { merge: true });

      return { credits: FREE_SIGNUP_CREDITS, granted: true };
    });

    return json(200, result, event);
  } catch (err) {
    return json(500, { error: 'Could not set up your wallet: ' + err.message }, event);
  }
};
