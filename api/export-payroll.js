// POST /api/export-payroll
// body: { transferType, payrollMonth ('YYYY-MM'), transferDate ('YYYY-MM-DD'), preferImps, amounts }
//
// SECURITY FIX: this endpoint replaces the old client-side executeExport()
// in app.js. Previously, "consume-credits" (deduct payment) and the actual
// bank-file generation were two independent steps — the file generation
// ran entirely in the browser using data already loaded there, so it
// could be called directly from the DevTools console, bypassing payment
// entirely.
//
// Now, credit deduction AND file generation happen in one server-side
// call. The company profile and employee records used to build the file
// are read fresh from Firestore here (trusted, server-side) rather than
// trusted from whatever the browser sends — only the per-employee
// "amounts" a payroll clerk just typed in need to come from the client,
// since those aren't persisted anywhere until this export runs.
const { db, admin, requireUser, json, handleOptions } = require('../lib/firebaseAdmin');
const { EXPORT_COST_CREDITS } = require('../lib/creditPacks');
const {
  BANK_BY_KEY, BankFormatters, MONTHS, SBI_RTGS_THRESHOLD,
  determineTransactionMode, splitIntoSubBatches, isCompanyProfileComplete
} = require('../lib/bankFormatters');

function ddmmyyyyFromIso(iso) {
  const [y, m, d] = String(iso || '').split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
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
  const tft = body.transferType === 'Same Bank' ? 'Same Bank' : 'Other Bank';
  const payrollMonth = String(body.payrollMonth || ''); // "YYYY-MM"
  const [year, monthRaw] = payrollMonth.split('-');
  const monthName = MONTHS[parseInt(monthRaw, 10) - 1] || '';
  const txnDate = ddmmyyyyFromIso(body.transferDate);
  const preferImps = !!body.preferImps;
  const amounts = (body.amounts && typeof body.amounts === 'object') ? body.amounts : {};

  if (!year || !monthRaw || !monthName) {
    return json(res, 400, { error: 'Please select a valid payroll month before exporting.' });
  }
  if (!txnDate) {
    return json(res, 400, { error: 'Please select a Transfer Date before exporting.' });
  }

  const uid = decoded.uid;
  const userRef = db.collection('users').doc(uid);

  // --- Fetch company profile + employees fresh from Firestore. Never
  // trust these from the client — only the entered amounts come from
  // the request body.
  let companyProfile;
  let employees;
  try {
    const [userSnap, empSnap] = await Promise.all([
      userRef.get(),
      userRef.collection('employees').get()
    ]);
    const d = userSnap.exists ? userSnap.data() : {};
    companyProfile = {
      name: d.companyName || '',
      accountNumber: d.accountNumber || '',
      ifsc: d.ifsc || '',
      sysId: d.sysId || '',
      bankName: d.bankName || 'SBI',
      hdfcClientCode: d.hdfcClientCode || '',
      iciciCorporateId: d.iciciCorporateId || ''
    };
    employees = empSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    return json(res, 500, { error: 'Could not load your company/employee records: ' + err.message });
  }

  if (!isCompanyProfileComplete(companyProfile)) {
    return json(res, 400, { error: 'Your Company Details are incomplete for the selected bank. Please finish them under Settings before exporting.' });
  }

  const bankKey = companyProfile.bankName || 'SBI';
  const isSbi = bankKey === 'SBI';
  const bank = BANK_BY_KEY[bankKey] || BANK_BY_KEY.SBI;

  // --- Build the batch lines server-side from the trusted employee
  // records + the amounts the client just typed in.
  const lines = [];
  for (const emp of employees) {
    const acc = String(emp.accountNumber || '');
    if (!acc || !Object.prototype.hasOwnProperty.call(amounts, acc)) continue;
    if (isSbi && emp.transferType !== tft) continue;
    const v = parseFloat(amounts[acc]);
    if (isNaN(v) || v <= 0) continue;
    const mode = isSbi
      ? (tft === 'Same Bank' ? 'Same Bank' : (v >= SBI_RTGS_THRESHOLD ? 'RTGS' : 'NEFT'))
      : determineTransactionMode(bankKey, emp.ifsc, v, preferImps);
    lines.push({ acc, empCode: emp.empCode || '', name: emp.name || '', ifsc: emp.ifsc || '', amount: v, mode });
  }

  if (!lines.length) {
    return json(res, 400, { error: 'No employees with a valid amount entered for this transfer type.' });
  }

  const subBatches = splitIntoSubBatches(isSbi, tft, lines);
  const shortYear = year.slice(2);

  // --- Deduct credits AND reserve batch-counter values in one atomic
  // Firestore transaction. Nothing below this point runs unless this
  // transaction commits successfully — file generation can no longer
  // happen without a successful credit deduction.
  const counterRef = userRef.collection('meta').doc('fileCounter');
  let creditsRemaining;
  let seqValues;
  try {
    const result = await db.runTransaction(async (tx) => {
      const [userSnap, counterSnap] = await Promise.all([tx.get(userRef), tx.get(counterRef)]);
      const data = userSnap.exists ? userSnap.data() : {};
      const credits = Number(data.credits || 0);

      if (credits < EXPORT_COST_CREDITS) {
        return { allowed: false, creditsRemaining: credits, creditsNeeded: EXPORT_COST_CREDITS - credits };
      }

      const updatedCredits = credits - EXPORT_COST_CREDITS;
      tx.set(userRef, { credits: updatedCredits }, { merge: true });

      const txnRef = userRef.collection('transactions').doc();
      tx.set(txnRef, {
        type: 'export_debit',
        credits: -EXPORT_COST_CREDITS,
        creditsRemaining: updatedCredits,
        description: 'Payroll file export',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Reserve one counter value per sub-batch, atomically.
      let current = counterSnap.exists ? (counterSnap.data().value || 1) : 1;
      const seqs = [];
      for (let i = 0; i < subBatches.length; i++) {
        seqs.push(current.toString(36).toUpperCase().padStart(4, '0'));
        current += 1;
      }
      tx.set(counterRef, { value: current }, { merge: true });

      return { allowed: true, creditsRemaining: updatedCredits, seqs };
    });

    if (!result.allowed) {
      return json(res, 402, {
        allowed: false,
        reason: 'insufficient_credits',
        creditsRemaining: result.creditsRemaining,
        creditsNeeded: result.creditsNeeded
      });
    }
    creditsRemaining = result.creditsRemaining;
    seqValues = result.seqs;
  } catch (err) {
    return json(res, 500, { error: 'Could not process credits for this export: ' + err.message });
  }

  // --- Generate the file(s). This now only ever runs after credits
  // were successfully deducted above.
  const files = [];
  const disbursementRows = [];
  const lastAmountItems = [];
  const auditDetails = [];

  subBatches.forEach((sub, idx) => {
    const seq = seqValues[idx];
    const formatter = (isSbi && tft === 'Same Bank')
      ? BankFormatters.SBI_INTRA
      : (BankFormatters[bankKey] || BankFormatters.SBI);

    const batchId = `${sub.prefix}${shortYear}${monthRaw}${seq}`;
    const subTotal = sub.lines.reduce((s, l) => s + l.amount, 0);

    const fileName = typeof formatter.fileName === 'function'
      ? formatter.fileName({ companyProfile, txnDate, seq })
      : `${bankKey.toLowerCase()}_salary_${monthName}_${year}${sub.label ? '_' + sub.label.toLowerCase() : ''}.${formatter.ext}`;

    const output = formatter.generate({
      companyProfile, lines: sub.lines, total: subTotal, batchId, txnDate, monthRaw, shortYear, monthName, year, tft
    });

    files.push({ fileName, content: output, mime: formatter.mime });

    sub.lines.forEach(({ acc, empCode, name, ifsc, amount, mode }) => {
      disbursementRows.push({
        batchId, transferDate: txnDate, empCode, employeeName: name, accountNumber: acc, ifsc,
        amount: amount.toFixed(2), transferType: mode, bank: bankKey,
        monthName, year, monthRaw, shortYear, fileName,
        companySnapshot: {
          name: companyProfile.name, accountNumber: companyProfile.accountNumber,
          ifsc: companyProfile.ifsc, sysId: companyProfile.sysId, bankName: bankKey
        }
      });
      lastAmountItems.push({ accountNumber: acc, amount });
    });

    auditDetails.push(`Batch: ${batchId} | Bank: ${bank.label}${sub.label ? ' (' + sub.label + ')' : ''} | Total: ₹${subTotal.toFixed(2)} | Employees: ${sub.lines.length} | File: ${fileName}`);
  });

  // --- Best-effort bookkeeping (disbursement history, audit log,
  // pre-fill amounts). Credits are already correctly deducted above
  // regardless of whether these succeed, matching the original app's
  // behaviour (a logging failure never blocked the download).
  try {
    let batch = db.batch();
    let count = 0;
    disbursementRows.forEach(r => {
      const ref = userRef.collection('disbursements').doc();
      batch.set(ref, { ...r, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      count++;
      if (count === 450) { batch.commit(); batch = db.batch(); count = 0; }
    });
    if (count > 0) await batch.commit();

    const byAcc = new Map(employees.map(e => [String(e.accountNumber), e.id]));
    let batch2 = db.batch();
    let count2 = 0;
    lastAmountItems.forEach(({ accountNumber, amount }) => {
      const id = byAcc.get(String(accountNumber));
      if (!id) return;
      batch2.set(userRef.collection('employees').doc(id), { lastAmount: amount }, { merge: true });
      count2++;
      if (count2 === 450) { batch2.commit(); batch2 = db.batch(); count2 = 0; }
    });
    if (count2 > 0) await batch2.commit();

    await userRef.collection('auditTrail').add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userEmail: decoded.email || '',
      userName: decoded.name || decoded.email || '',
      action: 'EXPORT FILE',
      details: auditDetails.join(' || ')
    });
  } catch (err) {
    // Non-fatal — the file(s) below are still returned to the user.
  }

  return json(res, 200, { verified: true, creditsRemaining, files });
};
