// POST /.netlify/functions/verify-payment
// body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//
// Recomputes the HMAC-SHA256 signature Razorpay says it sent, using our
// secret key, and compares it to what the browser handed back. This is
// the step that actually proves the payment happened and wasn't just
// faked by calling the success callback directly in devtools. Only
// after this passes do we credit the account — never on the client's
// say-so alone.
const crypto = require('crypto');
const { db, requireUser, json, handleOptions } = require('./_firebaseAdmin');

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

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid request body' }, event);
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return json(400, { error: 'Missing payment details' }, event);
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return json(400, { error: 'Payment verification failed. If money was deducted, it will be auto-refunded within a few days.' }, event);
  }

  // Signature is genuine — credit the account. Uses a transaction (even
  // though it's a simple increment) so this can never race with
  // consume-export.js decrementing the same field.
  const userRef = db.collection('users').doc(decoded.uid);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const current = Number((snap.exists && snap.data().credits) || 0);
      tx.set(userRef, { credits: current + 1 }, { merge: true });
    });
    return json(200, { verified: true }, event);
  } catch (err) {
    return json(500, { error: 'Payment verified but could not credit your account. Contact support with payment ID: ' + razorpay_payment_id }, event);
  }
};