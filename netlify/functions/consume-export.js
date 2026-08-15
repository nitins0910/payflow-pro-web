// POST /.netlify/functions/consume-export
//
// Called by the browser right before generating a payroll export file.
// This is the ONLY place that grants permission to export — the check
// and the write happen together in one Firestore transaction, so two
// tabs (or a fast double-click) can never both slip through on the
// same free export or the same credit.
//
// Response:
//   200 { allowed: true,  reason: 'free' | 'credit', creditsRemaining }
//   402 { allowed: false, reason: 'payment_required' }   -> client should
//        start the Razorpay flow (create-order -> verify-payment) and
//        then call this endpoint again.
//   401 unauthenticated
const { db, requireUser, json } = require('./_firebaseAdmin');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let decoded;
  try {
    decoded = await requireUser(event);
  } catch (err) {
    return json(err.statusCode || 401, { error: err.message });
  }

  const userRef = db.collection('users').doc(decoded.uid);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.exists ? snap.data() : {};
      const freeExportUsed = !!data.freeExportUsed;
      const credits = Number(data.credits || 0);

      if (!freeExportUsed) {
        tx.set(userRef, { freeExportUsed: true }, { merge: true });
        return { allowed: true, reason: 'free', creditsRemaining: credits };
      }
      if (credits > 0) {
        tx.set(userRef, { credits: credits - 1 }, { merge: true });
        return { allowed: true, reason: 'credit', creditsRemaining: credits - 1 };
      }
      return { allowed: false, reason: 'payment_required', creditsRemaining: 0 };
    });

    return json(result.allowed ? 200 : 402, result);
  } catch (err) {
    return json(500, { error: 'Could not check export eligibility: ' + err.message });
  }
};
