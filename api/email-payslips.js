// POST /api/email-payslips
// body: { payrollMonth, companyName, companyAddress, employees: [...] }
//
// Real backend for the "📧 Email All Payslips" button on the Salary
// Calculation page — replaces the earlier placeholder-only toast.
// Sends one individually-addressed payslip email per employee, using
// the SAME Gmail SMTP account already configured for Help & Support
// (see HELP_SUPPORT_SETUP.md) — no new environment variable needed,
// just deploy this file alongside the existing ones.
//
// Required env var (already set if Help & Support works):
//   SUPPORT_EMAIL_APP_PASSWORD — Gmail App Password for
//   payflowprosystem@gmail.com
const nodemailer = require('nodemailer');
const { requireUser, json, handleOptions } = require('../lib/firebaseAdmin');

const SEND_FROM_INBOX = 'payflowprosystem@gmail.com';
const MAX_EMPLOYEES_PER_REQUEST = 500; // sanity cap, not a real-world limit for this app

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function inr(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Plain inline-styled HTML — deliberately NOT using the app's CSS
// variables or <style> blocks, since most email clients (Gmail,
// Outlook) strip external/embedded stylesheets and only reliably
// render inline `style="..."` attributes. Colors are hardcoded to
// match the app's printed-payslip palette (see the @media print
// block in style.css) rather than the on-screen dark theme, since a
// payslip landing in someone's inbox should read like a normal
// printed document, not a dark-mode app screenshot.
function payslipEmailHtml(company, emp) {
  const row = (label, value) =>
    `<tr><td style="padding:6px 8px;color:#555;font-size:12px;">${escapeHtml(label)}</td><td style="padding:6px 8px;color:#111;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(value)}</td></tr>`;

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;color:#111;">
    <div style="border-bottom:3px solid #3B82F6;padding-bottom:16px;margin-bottom:20px;">
      <div style="font-size:20px;font-weight:700;">${escapeHtml(company.companyName || 'PayFlow Pro Technologies')}</div>
      ${company.companyAddress ? `<div style="font-size:11.5px;color:#666;margin-top:3px;">${escapeHtml(company.companyAddress)}</div>` : ''}
      <div style="margin-top:10px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#3B82F6;background:#eef4ff;display:inline-block;padding:4px 10px;border-radius:20px;">PAYSLIP</div>
      <div style="font-size:13.5px;color:#333;margin-top:6px;font-weight:600;">${escapeHtml(company.payrollMonth || '')}</div>
    </div>

    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;margin:16px 0 8px;">Employee Details</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr>
        <td style="padding:4px 0;color:#666;width:50%;">Employee Name</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(emp.name)}</td>
      </tr>
      <tr><td style="padding:4px 0;color:#666;">Employee Code</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(emp.empCode || '—')}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Designation</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(emp.designation || '—')}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Department</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(emp.department || '—')}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Date of Joining</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(emp.doj || '—')}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">UAN</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(emp.uan || '—')}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">PAN</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(emp.pan || '—')}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Bank Account No.</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(emp.bankAccountMasked || '—')}</td></tr>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:14px;background:#f5f5f5;border-radius:8px;">
      <tr>
        <td style="padding:10px;text-align:center;"><div style="font-size:10.5px;color:#666;text-transform:uppercase;">Days in Month</div><div style="font-size:16px;font-weight:700;">${escapeHtml(emp.daysInMonth)}</div></td>
        <td style="padding:10px;text-align:center;"><div style="font-size:10.5px;color:#666;text-transform:uppercase;">LOP Days</div><div style="font-size:16px;font-weight:700;">${escapeHtml(emp.lopDays)}</div></td>
        <td style="padding:10px;text-align:center;"><div style="font-size:10.5px;color:#666;text-transform:uppercase;">Paid Days</div><div style="font-size:16px;font-weight:700;">${escapeHtml(emp.paidDays)}</div></td>
      </tr>
    </table>

    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;margin:18px 0 8px;">Earnings &amp; Deductions</div>
    <table style="width:100%;border-collapse:collapse;">
      <tr style="border-bottom:1px solid #111;">
        <td style="padding:6px 8px;font-size:10.5px;color:#888;text-transform:uppercase;">Earnings</td>
        <td style="padding:6px 8px;font-size:10.5px;color:#888;text-transform:uppercase;text-align:right;">Amount (₹)</td>
        <td style="padding:6px 8px;font-size:10.5px;color:#888;text-transform:uppercase;">Deductions</td>
        <td style="padding:6px 8px;font-size:10.5px;color:#888;text-transform:uppercase;text-align:right;">Amount (₹)</td>
      </tr>
      <tr>
        <td style="padding:6px 8px;font-size:13px;">Basic Pay</td><td style="padding:6px 8px;font-size:13px;text-align:right;">${inr(emp.basic)}</td>
        <td style="padding:6px 8px;font-size:13px;">Provident Fund (EPF)</td><td style="padding:6px 8px;font-size:13px;text-align:right;">${inr(emp.pf)}</td>
      </tr>
      <tr>
        <td style="padding:6px 8px;font-size:13px;">House Rent Allowance</td><td style="padding:6px 8px;font-size:13px;text-align:right;">${inr(emp.hra)}</td>
        <td style="padding:6px 8px;font-size:13px;">Employee State Insurance (ESI)</td><td style="padding:6px 8px;font-size:13px;text-align:right;">${inr(emp.esi)}</td>
      </tr>
      <tr>
        <td style="padding:6px 8px;font-size:13px;">Special Allowance</td><td style="padding:6px 8px;font-size:13px;text-align:right;">${inr(emp.special)}</td>
        <td style="padding:6px 8px;font-size:13px;">Professional Tax (PT)</td><td style="padding:6px 8px;font-size:13px;text-align:right;">${inr(emp.pt)}</td>
      </tr>
      <tr>
        <td style="padding:6px 8px;font-size:13px;">Other Allowance</td><td style="padding:6px 8px;font-size:13px;text-align:right;">${inr(emp.other)}</td>
        <td style="padding:6px 8px;font-size:13px;">TDS</td><td style="padding:6px 8px;font-size:13px;text-align:right;">${inr(emp.tds)}</td>
      </tr>
      <tr>
        <td style="padding:6px 8px;font-size:13px;"></td><td style="padding:6px 8px;font-size:13px;"></td>
        <td style="padding:6px 8px;font-size:13px;">Other Deductions</td><td style="padding:6px 8px;font-size:13px;text-align:right;">${inr(emp.otherDed)}</td>
      </tr>
      <tr style="border-top:2px solid #111;">
        <td style="padding:10px 8px 6px;font-size:13px;font-weight:700;">Total Earnings (Gross)</td><td style="padding:10px 8px 6px;font-size:13px;font-weight:700;text-align:right;">${inr(emp.gross)}</td>
        <td style="padding:10px 8px 6px;font-size:13px;font-weight:700;">Total Deductions</td><td style="padding:10px 8px 6px;font-size:13px;font-weight:700;text-align:right;">${inr(emp.totalDeductions)}</td>
      </tr>
    </table>

    <div style="margin-top:20px;padding:18px 20px;text-align:center;background:#f0faf3;border:1px solid #8fd6a6;border-radius:12px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#666;font-weight:700;">Net Payable Amount</div>
      <div style="font-size:28px;font-weight:700;color:#111;margin-top:4px;">₹ ${inr(emp.netPay)}</div>
      <div style="font-size:12px;color:#333;margin-top:6px;font-style:italic;">${escapeHtml(emp.netPayWords || '')}</div>
    </div>

    <div style="margin-top:28px;text-align:right;">
      <div style="font-size:10.5px;color:#888;margin-bottom:36px;">For ${escapeHtml(company.companyName || 'PayFlow Pro Technologies')}</div>
      <div style="font-size:12.5px;font-weight:700;color:#111;">${escapeHtml(company.signatoryName) || 'Authorized Signatory'}</div>
      ${company.signatoryName
        ? `<div style="font-size:10.5px;color:#888;margin-top:2px;">${company.signatoryDesignation ? `${escapeHtml(company.signatoryDesignation)} — ` : ''}Authorized Signatory</div>`
        : ''}
    </div>

    <div style="margin-top:26px;padding-top:14px;border-top:1px dashed #999;font-size:10.5px;color:#888;text-align:center;">
      This is a computer-generated payslip and does not require a physical signature.
    </div>
  </div>`;
}

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
  const employees = Array.isArray(body.employees) ? body.employees : [];
  if (!employees.length) {
    return json(res, 400, { error: 'No employees to email payslips to.' });
  }
  if (employees.length > MAX_EMPLOYEES_PER_REQUEST) {
    return json(res, 400, { error: `Too many employees in one request (max ${MAX_EMPLOYEES_PER_REQUEST}).` });
  }
  if (!process.env.SUPPORT_EMAIL_APP_PASSWORD) {
    return json(res, 500, { error: 'Email sending is not configured yet — SUPPORT_EMAIL_APP_PASSWORD is missing. See HELP_SUPPORT_SETUP.md.' });
  }

  const company = {
    companyName: String(body.companyName || '').trim().slice(0, 120),
    companyAddress: String(body.companyAddress || '').trim().slice(0, 300),
    payrollMonth: String(body.payrollMonth || '').trim().slice(0, 40),
    signatoryName: String(body.signatoryName || '').trim().slice(0, 80),
    signatoryDesignation: String(body.signatoryDesignation || '').trim().slice(0, 80)
  };

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SEND_FROM_INBOX, pass: process.env.SUPPORT_EMAIL_APP_PASSWORD }
  });

  const results = await Promise.allSettled(employees.map((emp) => {
    const toEmail = String(emp.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return Promise.reject(new Error(`Missing or invalid email address for ${emp.name || 'this employee'}.`));
    }
    return transporter.sendMail({
      from: `"${company.companyName || 'PayFlow Pro'} Payroll" <${SEND_FROM_INBOX}>`,
      to: toEmail,
      subject: `Payslip for ${company.payrollMonth} — ${company.companyName || 'PayFlow Pro'}`,
      html: payslipEmailHtml(company, emp)
    }).then(() => ({ email: toEmail, name: emp.name }));
  }));

  const sent = [];
  const failures = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') sent.push(r.value);
    else failures.push({ email: employees[i]?.email || '', name: employees[i]?.name || '', reason: r.reason?.message || 'Send failed' });
  });

  return json(res, 200, {
    sent: sent.length,
    failed: failures.length,
    total: employees.length,
    failures
  });
};