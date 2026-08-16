// POST /api/consume-credits   (was /.netlify/functions/consume-credits)
//
// Same deduction logic as before, plus: every successful deduction now
// also writes a row to users/{uid}/transactions so the user can see
// their full credit history (purchases AND export debits) on the
// Wallet page. This write happens inside the same Firestore
// transaction as the balance deduction, using the Admin SDK, so it
// can never be skipped, faked, or bypassed from the browser.
const { db, admin, requireUser, json, handleOptions } = require('../lib/firebaseAdmin');
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
        const creditsRemaining = credits - EXPORT_COST_CREDITS;
        tx.set(userRef, { credits: creditsRemaining }, { merge: true });

        // Transaction-history row for this export debit. Auto-ID doc,
        // written server-side only — the client can read this
        // subcollection (see firestore.rules) but this function is the
        // only place that ever writes an 'export_debit' entry.
        const txnRef = userRef.collection('transactions').doc();
        tx.set(txnRef, {
          type: 'export_debit',
          credits: -EXPORT_COST_CREDITS,
          creditsRemaining,
          description: 'Payroll file export',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { allowed: true, creditsRemaining };
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