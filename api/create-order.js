// POST /api/create-order   (was /.netlify/functions/create-order)
// body: { packId }
//
// Same logic as before. Vercel auto-parses a JSON body into req.body,
// so no more manual JSON.parse(event.body).
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

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });

  try {
    const order = await razorpay.orders.create({
      amount: pack.priceRupees * 100, // paise
      currency: 'INR',
      receipt: `wal_${decoded.uid.slice(0, 18)}_${Date.now()}`.slice(0, 40),
      notes: { uid: decoded.uid, purpose: 'payflow_wallet_topup', packId: pack.id, credits: String(pack.credits) }
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
