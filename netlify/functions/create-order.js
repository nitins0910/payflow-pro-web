// POST /.netlify/functions/create-order
//
// Creates a Razorpay order for a single ₹50 file-export credit. The
// amount is fixed here, server-side, on purpose — the browser only
// ever tells us "I want to pay", never how much; that number can't be
// tampered with client-side.
const Razorpay = require('razorpay');
const { requireUser, json, handleOptions } = require('./_firebaseAdmin');

const EXPORT_PRICE_PAISE = 5000; // ₹50.00 — change this one number to reprice

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

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

  try {
    const order = await razorpay.orders.create({
      amount: EXPORT_PRICE_PAISE,
      currency: 'INR',
      // Receipt must be <= 40 chars for Razorpay.
      receipt: `exp_${decoded.uid.slice(0, 20)}_${Date.now()}`.slice(0, 40),
      notes: { uid: decoded.uid, purpose: 'payflow_export_credit' }
    });

    return json(200, {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID // public key — safe to send to the browser
    }, event);
  } catch (err) {
    return json(500, { error: 'Could not create payment order: ' + err.message }, event);
  }
};