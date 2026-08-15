// POST /.netlify/functions/create-order
// body: { packId }
//
// Creates a Razorpay order for a credit pack. The browser only ever
// sends a packId ('pack_5', 'pack_15', ...) — the actual rupee amount
// is looked up server-side from CREDIT_PACKS and can't be tampered
// with client-side. The pack's credit count is stashed in the order's
// notes so verify-payment.js can credit the right amount without
// trusting anything else the browser says.
const Razorpay = require('razorpay');
const { requireUser, json, handleOptions } = require('./_firebaseAdmin');
const { getPack } = require('./_creditPacks');

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

  const pack = getPack(body.packId);
  if (!pack) {
    return json(400, { error: 'Unknown credit pack.' }, event);
  }

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

  try {
    const order = await razorpay.orders.create({
      amount: pack.priceRupees * 100, // paise
      currency: 'INR',
      // Receipt must be <= 40 chars for Razorpay.
      receipt: `wal_${decoded.uid.slice(0, 18)}_${Date.now()}`.slice(0, 40),
      notes: { uid: decoded.uid, purpose: 'payflow_wallet_topup', packId: pack.id, credits: String(pack.credits) }
    });

    return json(200, {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      credits: pack.credits,
      keyId: process.env.RAZORPAY_KEY_ID // public key — safe to send to the browser
    }, event);
  } catch (err) {
    return json(500, { error: 'Could not create payment order: ' + err.message }, event);
  }
};
