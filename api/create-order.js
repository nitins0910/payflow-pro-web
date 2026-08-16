// POST /api/create-order   (was /.netlify/functions/create-order)
// body: { packId, purpose }
//
// Same logic as before. Vercel auto-parses a JSON body into req.body,
// so no more manual JSON.parse(event.body).
//
// `purpose` is new: a free-text tag ('export' | 'recharge') describing
// WHY the client is paying — a direct per-export payment vs a wallet
// top-up. It never affects price or credits (those still only ever
// come from the server-side pack lookup below); it's stamped onto the
// order's notes purely so verify-payment.js can carry it onto the
// transaction record for the Payment History page. Client input, so
// it's whitelisted rather than trusted as-is.
const Razorpay = require('razorpay');
const { requireUser, json, handleOptions } = require('../lib/firebaseAdmin');
const { getPack } = require('../lib/creditPacks');

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
  const pack = getPack(body.packId);
  if (!pack) {
    return json(res, 400, { error: 'Unknown credit pack.' });
  }
  const purpose = body.purpose === 'export' ? 'export' : 'recharge';

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

  try {
    const order = await razorpay.orders.create({
      amount: pack.priceRupees * 100, // paise
      currency: 'INR',
      receipt: `wal_${decoded.uid.slice(0, 18)}_${Date.now()}`.slice(0, 40),
      notes: { uid: decoded.uid, purpose, packId: pack.id, credits: String(pack.credits) }
    });

    return json(res, 200, {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      credits: pack.credits,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    return json(res, 500, { error: 'Could not create payment order: ' + err.message });
  }
};