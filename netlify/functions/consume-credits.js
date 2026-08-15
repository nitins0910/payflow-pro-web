// POST /.netlify/functions/consume-credits
//
// Called by the browser right before generating a payroll export file.
// Every export costs EXPORT_COST_CREDITS credits, whether they came
// from the free signup grant or a purchased pack — the wallet doesn't
// distinguish between the two once they're in the balance. The check
// and the deduction happen together in one Firestore transaction, so
// two tabs (or a fast double-click) can never both slip through on the
// same balance.
//
// Response:
//   200 { allowed: true,  creditsRemaining }
//   402 { allowed: false, reason: 'insufficient_credits', creditsRemaining, creditsNeeded }
//        -> client should send the user to buy a credit pack
//           (create-order -> verify-payment) and then call this
//           endpoint again.
//   401 unauthenticated
const { db, requireUser, json, handleOptions } = require('./_firebaseAdmin');
const { EXPORT_COST_CREDITS } = require('./_creditPacks');

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

    return json(result.allowed ? 200 : 402, result, event);
  } catch (err) {
    return json(500, { error: 'Could not check export eligibility: ' + err.message }, event);
  }
};
