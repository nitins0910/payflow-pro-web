// POST /api/consume-credits   (was /.netlify/functions/consume-credits)
//
// Same logic as before, unchanged. Deducts EXPORT_COST_CREDITS
// atomically in a Firestore transaction before an export is generated.
const { db, requireUser, json, handleOptions } = require('../lib/firebaseAdmin');
const { EXPORT_COST_CREDITS } = require('../lib/creditPacks');

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
      const credits = Number(data.credits || 0);

      if (credits >= EXPORT_COST_CREDITS) {
        tx.set(userRef, { credits: credits - EXPORT_COST_CREDITS }, { merge: true });
        return { allowed: true, creditsRemaining: credits - EXPORT_COST_CREDITS };
      }

      return {
        allowed: false,
        reason: 'insufficient_credits',
        creditsRemaining: credits,
        creditsNeeded: EXPORT_COST_CREDITS - credits
      };
    });

    return json(res, result.allowed ? 200 : 402, result);
  } catch (err) {
    return json(res, 500, { error: 'Could not check export eligibility: ' + err.message });
  }
};
