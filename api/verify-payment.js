// POST /api/verify-payment   (was /.netlify/functions/verify-payment)
// body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//
// Same logic as before, including the replay-attack guard via
// processed_payments/{payment_id}. Only the (event,context) -> (req,res)
// plumbing changed.
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { admin, db, requireUser, json, handleOptions } = require('../lib/firebaseAdmin');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  let decoded;
  try {
    decoded = await requireUser(req);
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message });
  }

  const body = req.body || {};
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return json(res, 400, { error: 'Missing payment details' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return json(res, 400, { error: 'Payment verification failed. If money was deducted, it will be auto-refunded within a few days.' });
  }

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

  let order;
  try {
    order = await razorpay.orders.fetch(razorpay_order_id);
  } catch (err) {
    return json(res, 500, { error: 'Payment verified but order details could not be fetched. Contact support with payment ID: ' + razorpay_payment_id });
  }

  const notes = order.notes || {};
  if (notes.uid !== decoded.uid) {
    return json(res, 403, { error: 'This order does not belong to your account.' });
  }
  const credits = parseInt(notes.credits, 10);
  if (!credits || credits <= 0) {
    return json(res, 500, { error: 'Payment verified but the order has no credit amount on it. Contact support with payment ID: ' + razorpay_payment_id });
  }

  const userRef = db.collection('users').doc(decoded.uid);
  const paymentRef = db.collection('processed_payments').doc(razorpay_payment_id);
  try {
    const result = await db.runTransaction(async (tx) => {
      const paymentSnap = await tx.get(paymentRef);
      if (paymentSnap.exists) {
        return { alreadyProcessed: true, creditsRemaining: paymentSnap.data().creditsRemaining };
      }
      const snap = await tx.get(userRef);
      const current = Number((snap.exists && snap.data().credits) || 0);
      const updated = current + credits;
      tx.set(userRef, { credits: updated }, { merge: true });
      tx.set(paymentRef, {
        uid: decoded.uid,
        orderId: razorpay_order_id,
        credits,
        creditsRemaining: updated,
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { alreadyProcessed: false, creditsRemaining: updated };
    });

    return json(res, 200, {
      verified: true,
      creditsAdded: result.alreadyProcessed ? 0 : credits,
      creditsRemaining: result.creditsRemaining,
      alreadyProcessed: result.alreadyProcessed
    });
  } catch (err) {
    return json(res, 500, { error: 'Payment verified but could not credit your account. Contact support with payment ID: ' + razorpay_payment_id });
  }
};
