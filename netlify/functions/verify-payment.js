// POST /.netlify/functions/verify-payment
// body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//
// Recomputes the HMAC-SHA256 signature Razorpay says it sent, using our
// secret key, and compares it to what the browser handed back. This is
// the step that actually proves the payment happened and wasn't just
// faked by calling the success callback directly in devtools.
//
// The number of credits to add is never taken from the browser — after
// the signature checks out, we fetch the order back from Razorpay's API
// (trusted, server-to-server) and read the credit count from the notes
// that create-order.js stamped onto it. We also check notes.uid matches
// the signed-in user, so one user's order can never credit someone
// else's wallet.
const crypto = require('crypto');
const Razorpay = require('razorpay');
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

  // Signature is genuine — pull the trusted order details back from
  // Razorpay to find out how many credits this order actually paid for.
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

  let order;
  try {
    order = await razorpay.orders.fetch(razorpay_order_id);
  } catch (err) {
    return json(500, { error: 'Payment verified but order details could not be fetched. Contact support with payment ID: ' + razorpay_payment_id }, event);
  }

  const notes = order.notes || {};
  if (notes.uid !== decoded.uid) {
    return json(403, { error: 'This order does not belong to your account.' }, event);
  }
  const credits = parseInt(notes.credits, 10);
  if (!credits || credits <= 0) {
    return json(500, { error: 'Payment verified but the order has no credit amount on it. Contact support with payment ID: ' + razorpay_payment_id }, event);
  }

  // Credits the account. Uses a transaction (even though it's a simple
  // increment) so this can never race with consume-credits.js
  // decrementing the same field.
  const userRef = db.collection('users').doc(decoded.uid);
  try {
    const newBalance = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const current = Number((snap.exists && snap.data().credits) || 0);
      const updated = current + credits;
      tx.set(userRef, { credits: updated }, { merge: true });
      return updated;
    });
    return json(200, { verified: true, creditsAdded: credits, creditsRemaining: newBalance }, event);
  } catch (err) {
    return json(500, { error: 'Payment verified but could not credit your account. Contact support with payment ID: ' + razorpay_payment_id }, event);
  }
};
