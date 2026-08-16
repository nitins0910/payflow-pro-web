// POST /api/init-wallet   (was /.netlify/functions/init-wallet)
//
// Same logic as before, unchanged. Idempotent: first call ever for a
// user grants FREE_SIGNUP_CREDITS and flips walletInitialized to true
// inside a transaction. Every call after that is a no-op read.
const { db, admin, requireUser, json, handleOptions } = require('../lib/firebaseAdmin');
const { FREE_SIGNUP_CREDITS } = require('../lib/creditPacks');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  let decoded;
  try {
    decoded = await requireUser(req);
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message });
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

      const txnRef = userRef.collection('transactions').doc();
      tx.set(txnRef, {
        type: 'free_signup_credit',
        credits: FREE_SIGNUP_CREDITS,
        creditsRemaining: FREE_SIGNUP_CREDITS,
        description: 'Free signup credits',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { credits: FREE_SIGNUP_CREDITS, granted: true };
    });

    return json(res, 200, result);
  } catch (err) {
    return json(res, 500, { error: 'Could not set up your wallet: ' + err.message });
  }
};