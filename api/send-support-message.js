// POST /api/send-support-message   (was /.netlify/functions/send-support-message)
// body: { subject, message }
//
// Same logic as before. Required env var:
//   SUPPORT_EMAIL_APP_PASSWORD — Gmail App Password for
//   nitins1009@gmail.com (see HELP_SUPPORT_SETUP.md).
const nodemailer = require('nodemailer');
const { requireUser, json, handleOptions } = require('../lib/firebaseAdmin');

const SUPPORT_INBOX = 'nitins1009@gmail.com';
const MAX_SUBJECT_LEN = 120;
const MAX_MESSAGE_LEN = 4000;

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
  const subject = String(body.subject || '').trim().slice(0, MAX_SUBJECT_LEN);
  const message = String(body.message || '').trim().slice(0, MAX_MESSAGE_LEN);
  if (!subject || !message) {
    return json(res, 400, { error: 'Subject and message are both required.' });
  }

  if (!process.env.SUPPORT_EMAIL_APP_PASSWORD) {
    return json(res, 500, { error: 'Support inbox is not configured yet. Please try again later.' });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: SUPPORT_INBOX,
      pass: process.env.SUPPORT_EMAIL_APP_PASSWORD
    }
  });

  try {
    await transporter.sendMail({
      from: `"PayFlow Pro Support" <${SUPPORT_INBOX}>`,
      to: SUPPORT_INBOX,
      replyTo: decoded.email || undefined,
      subject: `[PayFlow Pro Support] ${subject}`,
      text: `From: ${decoded.email || 'unknown'} (uid: ${decoded.uid})\n\n${message}`
    });
    return json(res, 200, { sent: true });
  } catch (err) {
    return json(res, 500, { error: 'Could not send your message right now. Please try again in a bit.' });
  }
};
