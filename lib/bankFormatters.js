// Server-side port of app.js's bank-file formatting logic (BANKS,
// BankFormatters, and their helper functions). This is a DELIBERATE
// duplication of that client-side code — it now runs here so that
// generating a payroll file requires the server (which has already
// verified auth + charged credits), instead of running entirely in the
// browser where it could be triggered without ever paying.
//
// Keep this in sync with the BankFormatters section of app.js if the
// file-format logic there ever changes.

const SBI_RTGS_THRESHOLD = 200000;
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

const BANKS = [
  { key: 'SBI',   label: 'State Bank of India (SBI)',  ifscPrefix: 'SBIN', supportsRtgs: true,  supportsImps: true  },
  { key: 'HDFC',  label: 'HDFC Bank (HDFC)',            ifscPrefix: 'HDFC', supportsRtgs: true,  supportsImps: false },
  { key: 'ICICI', label: 'ICICI Bank (ICICI)',          ifscPrefix: 'ICIC', supportsRtgs: false, supportsImps: false },
  { key: 'PNB',   label: 'Punjab National Bank (PNB)',  ifscPrefix: 'PUNB', supportsRtgs: true,  supportsImps: false },
];
const BANK_BY_KEY = Object.fromEntries(BANKS.map(b => [b.key, b]));

const IFSC_BANK_NAMES = {
  SBIN: 'SBI BANK', HDFC: 'HDFC BANK', ICIC: 'ICICI BANK', PUNB: 'PNB BANK',
  UTIB: 'AXIS BANK', KKBK: 'KOTAK BANK', BARB: 'BANK OF BARODA', CNRB: 'CANARA BANK',
  UBIN: 'UNION BANK', IDIB: 'INDIAN BANK', IOBA: 'INDIAN OVERSEAS BANK', IDFB: 'IDFC FIRST BANK',
  YESB: 'YES BANK', INDB: 'INDUSIND BANK', RATN: 'RBL BANK', FDRL: 'FEDERAL BANK',
  CBIN: 'CENTRAL BANK OF INDIA', MAHB: 'BANK OF MAHARASHTRA', PSIB: 'PUNJAB & SIND BANK',
  UCBA: 'UCO BANK', BKID: 'BANK OF INDIA', SIBL: 'SOUTH INDIAN BANK', DCBL: 'DCB BANK'
};
function bankNameFromIfsc(ifsc) {
  const prefix = String(ifsc || '').trim().toUpperCase().slice(0, 4);
  return IFSC_BANK_NAMES[prefix] || (prefix ? `${prefix} BANK` : '');
}

function branchCodeFromIfsc(ifsc) {
  return String(ifsc || '').trim().toUpperCase().slice(5);
}

function isValidIfscFormat(ifsc) {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(ifsc || '').trim().toUpperCase());
}

function csvField(value) {
  const s = String(value ?? '').replace(/[\r\n]+/g, ' ');
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(values) { return values.map(csvField).join(','); }

function sanitizeForDelimitedFile(value, ...reservedChars) {
  let s = String(value ?? '').replace(/[\r\n]+/g, ' ');
  reservedChars.forEach(ch => { s = s.split(ch).join(''); });
  return s.trim();
}

function determineTransactionMode(bankKey, ifsc, amount, preferImps) {
  const bank = BANK_BY_KEY[bankKey];
  if (!bank) return 'NEFT';
  const sameBank = bank.ifscPrefix && String(ifsc || '').toUpperCase().startsWith(bank.ifscPrefix);
  if (sameBank) return 'Same Bank';
  if (preferImps && bank.supportsImps) return 'IMPS';
  if (bank.supportsRtgs === false) return 'NEFT';
  return amount >= SBI_RTGS_THRESHOLD ? 'RTGS' : 'NEFT';
}

function bankTxnCode(bankKey, mode) {
  if (bankKey === 'PNB') {
    if (mode === 'Same Bank') return 'PMT';
    if (mode === 'RTGS') return 'RTG';
    return 'NFT';
  }
  if (bankKey === 'HDFC') {
    if (mode === 'Same Bank') return 'I';
    if (mode === 'RTGS') return 'R';
    return 'N';
  }
  return mode === 'Same Bank' ? 'NEFT' : mode;
}

function ddmmyyyyToMmddyyyy(ddmmyyyy) {
  const [d, m, y] = String(ddmmyyyy || '').split('/');
  if (!d || !m || !y) return ddmmyyyy || '';
  return `${m}/${d}/${y}`;
}

// ctx passed to every generate() below:
//   companyProfile { name, accountNumber, sysId, ifsc, hdfcClientCode, iciciCorporateId }
//   lines[]  { acc, empCode, name, ifsc, amount, mode }
//   total, batchId, txnDate ('DD/MM/YYYY'), monthName, year, tft
const BankFormatters = {
  SBI: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(ctx) {
      const d = v => sanitizeForDelimitedFile(v, '#');
      const empLines = ctx.lines.map(l => {
        const seqStr = `${ctx.batchId}E${l.empCode}`;
        return `${d(l.acc)}#${d(l.ifsc)}#${ctx.txnDate}##${l.amount.toFixed(2)}#${seqStr}#${d(l.name)}#SALARY OF ${d(ctx.monthName)} ${ctx.year}`;
      });
      const header = `${d(ctx.companyProfile.accountNumber)}#${d(ctx.companyProfile.sysId)}#${ctx.txnDate}#${ctx.total.toFixed(2)}##${ctx.batchId}#${d(ctx.companyProfile.name)}#SALARY OF ${d(ctx.monthName)} ${ctx.year}`;
      return [header, ...empLines].join('\n') + '\n';
    }
  },
  SBI_INTRA: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(ctx) {
      const d = v => sanitizeForDelimitedFile(v, '#');
      const empLines = ctx.lines.map(l => {
        const seqStr = `${ctx.batchId}E${l.empCode}`;
        const branchCode = branchCodeFromIfsc(l.ifsc);
        return `${d(l.acc)}#${d(branchCode)}#${ctx.txnDate}##${l.amount.toFixed(2)}#${seqStr}#${d(l.name)}#SALARY OF ${d(ctx.monthName)} ${ctx.year}#`;
      });
      const header = `${d(ctx.companyProfile.accountNumber)}#${d(ctx.companyProfile.sysId)}#${ctx.txnDate}#${ctx.total.toFixed(2)}##${ctx.batchId}#${d(ctx.companyProfile.name)}#SALARY OF ${d(ctx.monthName)} ${ctx.year}#`;
      return [header, ...empLines].join('\n') + '\n';
    }
  },
  PNB: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(ctx) {
      const remarks = `SALARY OF ${ctx.monthName} ${ctx.year}`.slice(0, 30);
      const rows = ctx.lines.map(l => csvRow([
        bankTxnCode('PNB', l.mode),
        ctx.companyProfile.accountNumber,
        l.amount.toFixed(2),
        'INR',
        l.acc,
        l.ifsc,
        remarks
      ]));
      return rows.join('\r\n') + '\r\n';
    }
  },
  HDFC: {
    ext: 'csv', mime: 'text/csv;charset=utf-8',
    generate(ctx) {
      const custRef = `SALARY${(ctx.monthName || '').slice(0, 3).toUpperCase()}${ctx.year}`;
      const rows = ctx.lines.map(l => {
        const isInternal = l.mode === 'Same Bank';
        const cols = new Array(28).fill('');
        cols[0]  = bankTxnCode('HDFC', l.mode);
        cols[1]  = isInternal ? l.acc : '';
        cols[2]  = l.acc;
        cols[3]  = l.amount.toFixed(2);
        cols[4]  = l.name.slice(0, 40);
        cols[13] = custRef;
        cols[22] = ctx.txnDate;
        cols[24] = l.ifsc;
        cols[25] = bankNameFromIfsc(l.ifsc);
        cols[27] = '';
        return csvRow(cols);
      });
      return rows.join('\r\n') + '\r\n';
    },
    fileName(ctx) {
      const code = (ctx.companyProfile.hdfcClientCode || 'XXXX').toUpperCase().slice(0, 4).padEnd(4, 'X');
      const [dd, mm] = String(ctx.txnDate || '').split('/');
      const seqNum = ((parseInt(ctx.seq, 36) || 1) % 999) + 1;
      return `${code}${dd || '01'}${mm || '01'}.${String(seqNum).padStart(3, '0')}`;
    }
  },
  ICICI: {
    ext: 'txt', mime: 'text/plain;charset=utf-8',
    generate(ctx) {
      const d = (v, max) => {
        const s = sanitizeForDelimitedFile(v, '|', '^');
        return max ? s.slice(0, max) : s;
      };
      const dName = (v, max) => {
        const s = d(v).replace(/[^A-Za-z0-9 ]/g, '');
        return max ? s.slice(0, max) : s;
      };
      const totalRecords = ctx.lines.length + 1;
      const execDate = ddmmyyyyToMmddyyyy(ctx.txnDate);
      const externalRef = `SALARY_${(ctx.monthName || '').slice(0, 3).toUpperCase()}${ctx.year}`;
      const debitAcc = d(ctx.companyProfile.accountNumber, 12);
      const corporateId = d(ctx.companyProfile.iciciCorporateId, 20);
      const narration = d(`SALARY OF ${ctx.monthName} ${ctx.year}`, 30);

      const fhr = `FHR|${totalRecords}|${execDate}|${externalRef}|${ctx.total.toFixed(2)}|INR|${debitAcc}|0011^`;
      const mdr = `MDR|${debitAcc}|0011|${corporateId}|${ctx.total.toFixed(2)}|INR|${narration}|ICIC0000011|WIB^`;

      const creditLines = ctx.lines.map(l => {
        const name = dName(l.name, 32);
        const remarks = d(`SAL ${ctx.monthName}`, 30);
        if (l.mode === 'Same Bank') {
          return `MCW|${d(l.acc, 12)}|0011|${name}|${l.amount.toFixed(2)}|INR|${remarks}|ICIC0000011|WIB^`;
        }
        return `MCO|${d(l.acc, 34)}|0011|${name}|${l.amount.toFixed(2)}|INR|${remarks}|NFT|${d(l.ifsc)}^`;
      });

      return [fhr, mdr, ...creditLines].join('\n') + '\n';
    }
  },
};

function getBatchPrefix(isSbi, tft, lines) {
  if (isSbi) return tft === 'Same Bank' ? 'SBST' : 'OBST';
  const modes = new Set(lines.map(l => l.mode));
  if (modes.size === 1) {
    const only = [...modes][0];
    return only === 'Same Bank' ? 'SBST' : only.toUpperCase().padEnd(4, 'X').slice(0, 4);
  }
  return 'MULT';
}

function splitIntoSubBatches(isSbi, tft, lines) {
  if (isSbi && tft === 'Other Bank') {
    const rtgsLines = lines.filter(l => l.mode === 'RTGS');
    const neftLines = lines.filter(l => l.mode === 'NEFT');
    const subBatches = [];
    if (rtgsLines.length) subBatches.push({ prefix: 'OBRT', label: 'RTGS', lines: rtgsLines });
    if (neftLines.length) subBatches.push({ prefix: 'OBNE', label: 'NEFT', lines: neftLines });
    return subBatches;
  }
  const label = (isSbi && tft === 'Same Bank') ? 'INTRA' : null;
  return [{ prefix: getBatchPrefix(isSbi, tft, lines), label, lines }];
}

// Mirrors isCompanyProfileComplete() in app.js.
function isCompanyProfileComplete(companyProfile) {
  const base = !!(companyProfile.name && companyProfile.accountNumber && companyProfile.ifsc && companyProfile.bankName);
  if (!base) return false;
  if (companyProfile.bankName === 'HDFC' && !/^[A-Z0-9]{4}$/.test(companyProfile.hdfcClientCode || '')) return false;
  if (companyProfile.bankName === 'ICICI' && !companyProfile.iciciCorporateId) return false;
  if (companyProfile.bankName === 'PNB' && String(companyProfile.accountNumber || '').length !== 16) return false;
  if (companyProfile.bankName === 'ICICI' && String(companyProfile.accountNumber || '').length !== 12) return false;
  return true;
}

module.exports = {
  SBI_RTGS_THRESHOLD, MONTHS, BANKS, BANK_BY_KEY, BankFormatters,
  determineTransactionMode, bankTxnCode, bankNameFromIfsc, branchCodeFromIfsc,
  isValidIfscFormat, getBatchPrefix, splitIntoSubBatches, isCompanyProfileComplete
};
