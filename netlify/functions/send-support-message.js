// POST /.netlify/functions/send-support-message
// body: { subject, message }
//
// Simple one-way "contact us" message. Requires a signed-in user (same
// auth as the billing functions), then emails the site owner via Gmail
// SMTP with the user's account email set as Reply-To — so replying to
// the notification email goes straight back to the user, no ticketing
// system needed.
//
// Required env var:
//   SUPPORT_EMAIL_APP_PASSWORD — a Gmail "App Password" for
//   nitins1009@gmail.com (see HELP_SUPPORT_SETUP.md for how to get one).
const nodemailer = require('nodemailer');
const { requireUser, json, handleOptions } = require('./_firebaseAdmin');

const SUPPORT_INBOX = 'nitins1009@gmail.com';
const MAX_SUBJECT_LEN = 120;
const MAX_MESSAGE_LEN = 4000;

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

  const subject = String(body.subject || '').trim().slice(0, MAX_SUBJECT_LEN);
  const message = String(body.message || '').trim().slice(0, MAX_MESSAGE_LEN);
  if (!subject || !message) {
    return json(400, { error: 'Subject and message are both required.' }, event);
  }

  if (!process.env.SUPPORT_EMAIL_APP_PASSWORD) {
    return json(500, { error: 'Support inbox is not configured yet. Please try again later.' }, event);
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
    return json(200, { sent: true }, event);
  } catch (err) {
    return json(500, { error: 'Could not send your message right now. Please try again in a bit.' }, event);
  }
};
