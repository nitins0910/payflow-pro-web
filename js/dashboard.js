// ============================================================
// PayFlow Pro — Dashboard (multi-company, Firestore-backed)
// ============================================================

let currentUser = null;
let employees = [];
let editingEmployeeId = null;
let salaryInputs = {};
let companyProfile = { name: '', accountNumber: '', sysId: '', joinCode: '' };

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function formatDateDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user;
  document.getElementById('userName').textContent = user.displayName || 'PayFlow User';
  document.getElementById('userEmail').textContent = user.email;

  try {
    const ctx = await initCompanyContext(user.uid);
    companyProfile.joinCode = ctx.joinCode;
  } catch (err) {
    alert('Could not load your company: ' + err.message);
    return;
  }

  populateMonthYear();
  await Promise.all([loadEmployees(), loadCompanyProfile()]);
  wireNav();
  wireEmployeeForm();
  wireBulkImport();
  wireDisbursement();
  wireAudit();
  wireCompanyForm();
});

document.getElementById('logoutBtn').onclick = () => auth.signOut();

function wireNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
      document.getElementById('page-' + item.dataset.page).classList.remove('hidden');
      if (item.dataset.page === 'audit') loadAuditTrail();
    });
  });
}

async function loadEmployees() {
  const tbody = document.getElementById('employeeTableBody');
  try {
    employees = await Api.getEmployees();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--danger);">Could not load employees: ${err.message}</td></tr>`;
    return;
  }
  renderEmployeeTable();
  renderDisbursementList();
}

function renderEmployeeTable() {
  const tbody = document.getElementById('employeeTableBody');
  const emptyState = document.getElementById('employeeEmptyState');
  const query = (document.getElementById('employeeSearch').value || '').trim().toLowerCase();

  const filtered = employees.filter(e =>
    !query || e.name.toLowerCase().includes(query) || String(e.accountNumber).includes(query));

  tbody.innerHTML = '';
  if (!filtered.length) { emptyState.classList.remove('hidden'); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(emp => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${emp.name}</td>
      <td>${emp.accountNumber}</td>
      <td>${emp.ifsc}</td>
      <td>${emp.transferType}</td>
      <td>${emp.empCode}</td>
      <td class="row-actions">
        <button data-edit="${emp.id}">Edit</button>
        <button data-delete="${emp.id}" class="danger">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openEditModal(btn.dataset.edit));
  tbody.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = () => handleDelete(btn.dataset.delete));
}

document.getElementById('employeeSearch').addEventListener('input', renderEmployeeTable);

function wireEmployeeForm() {
  const modal = document.getElementById('employeeModal');
  const employeeForm = document.getElementById('employeeForm');

  document.getElementById('addEmployeeBtn').onclick = () => {
    editingEmployeeId = null;
    document.getElementById('modalTitle').textContent = 'Add Employee';
    employeeForm.reset();
    modal.classList.remove('hidden');
  };
  document.getElementById('cancelModalBtn').onclick = () => modal.classList.add('hidden');

  window.openEditModal = (id) => {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    editingEmployeeId = id;
    document.getElementById('modalTitle').textContent = 'Edit Employee';
    document.getElementById('empName').value = emp.name;
    document.getElementById('empAccount').value = emp.accountNumber;
    document.getElementById('empIfsc').value = emp.ifsc;
    document.getElementById('empCode').value = emp.empCode;
    document.getElementById('empTransferType').value = emp.transferType;
    modal.classList.remove('hidden');
  };

  employeeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveEmployeeBtn');
    btn.disabled = true; btn.textContent = 'Saving...';

    const emp = {
      name: document.getElementById('empName').value.trim().toUpperCase(),
      accountNumber: document.getElementById('empAccount').value.trim(),
      ifsc: document.getElementById('empIfsc').value.trim().toUpperCase(),
      empCode: document.getElementById('empCode').value.trim().padStart(2, '0'),
      transferType: document.getElementById('empTransferType').value,
    };

    try {
      if (editingEmployeeId) {
        await Api.updateEmployee(editingEmployeeId, emp);
        await Api.logAudit(currentUser.email, currentUser.displayName, 'EDIT EMPLOYEE', `${emp.name} | Acc: ${emp.accountNumber}`);
      } else {
        await Api.addEmployee(emp);
        await Api.logAudit(currentUser.email, currentUser.displayName, 'ADD EMPLOYEE', `${emp.name} | Acc: ${emp.accountNumber}`);
      }
      modal.classList.add('hidden');
      await loadEmployees();
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  });

  window.handleDelete = async (id) => {
    const emp = employees.find(e => e.id === id);
    if (!confirm(`Delete ${emp ? emp.name : id}? This cannot be undone.`)) return;
    try {
      await Api.deleteEmployee(id);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'DELETE EMPLOYEE', `${emp ? emp.name : ''} | Acc: ${emp ? emp.accountNumber : id}`);
      await loadEmployees();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };
}

function wireBulkImport() {
  const fileInput = document.getElementById('bulkImportInput');
  document.getElementById('bulkImportBtn').onclick = () => fileInput.click();

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) { alert('No valid rows found in CSV.'); return; }
    try {
      await Api.bulkAddEmployees(rows);
      await Api.logAudit(currentUser.email, currentUser.displayName, 'BULK IMPORT', `${rows.length} employees imported`);
      await loadEmployees();
      alert(`Imported ${rows.length} employees.`);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    fileInput.value = '';
  });
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idxAcc  = headers.indexOf('account number');
  const idxIfsc = headers.indexOf('ifsc_branchcode');
  const idxName = headers.indexOf('employee name');
  const idxType = headers.indexOf('transfer type');
  const idxCode = headers.indexOf('emp code');

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const accountNumber = cols[idxAcc >= 0 ? idxAcc : 0] || '';
    const ifsc = (cols[idxIfsc >= 0 ? idxIfsc : 1] || '').toUpperCase();
    const name = (cols[idxName >= 0 ? idxName : 2] || '').toUpperCase();
    const transferType = cols[idxType >= 0 ? idxType : 3] || 'Same Bank';
    const empCode = (cols[idxCode >= 0 ? idxCode : 4] || '01').padStart(2, '0');
    if (accountNumber && name) out.push({ accountNumber, ifsc, name, transferType, empCode });
  }
  return out;
}

function populateMonthYear() {
  const monthSel = document.getElementById('disbMonth');
  const yearSel = document.getElementById('disbYear');
  const now = new Date();
  monthSel.innerHTML = MONTHS.map((m, i) => `<option value="${String(i+1).padStart(2,'0')}">${String(i+1).padStart(2,'0')} - ${m}</option>`).join('');
  monthSel.value = String(now.getMonth()+1).padStart(2,'0');
  const cy = now.getFullYear();
  yearSel.innerHTML = Array.from({length:11}, (_, i) => cy+i).map(y => `<option value="${y}">${y}</option>`).join('');
  yearSel.value = String(cy);
  document.getElementById('disbDateDisplay').textContent = formatDateDDMMYYYY(now);
}

function renderDisbursementList() {
  const tbody = document.getElementById('disbTableBody');
  const emptyState = document.getElementById('disbEmptyState');
  if (!tbody) return;

  const tft = document.getElementById('disbTransferType').value;
  const query = (document.getElementById('disbSearch').value || '').trim().toLowerCase();

  salaryInputs = {};
  tbody.innerHTML = '';

  const filtered = employees.filter(e =>
    e.transferType === tft &&
    (!query || e.name.toLowerCase().includes(query) || String(e.accountNumber).includes(query)));

  if (!filtered.length) { emptyState.classList.remove('hidden'); updateBatchTotal(); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(emp => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${emp.empCode}</td>
      <td>${emp.name}</td>
      <td>${emp.accountNumber}</td>
      <td style="text-align:right;">
        <input type="text" data-acc="${emp.accountNumber}" placeholder="0.00"
          style="width:120px; text-align:right; background:var(--surface2); border:1px solid var(--border); color:var(--success); padding:6px 8px;">
      </td>`;
    tbody.appendChild(tr);
    const inputEl = tr.querySelector('input');
    inputEl.addEventListener('input', updateBatchTotal);
    salaryInputs[emp.accountNumber] = { inputEl, name: emp.name, ifsc: emp.ifsc, empCode: emp.empCode };
  });
  updateBatchTotal();
}

function updateBatchTotal() {
  let total = 0;
  Object.values(salaryInputs).forEach(md => {
    const v = parseFloat(md.inputEl.value);
    if (!isNaN(v)) total += v;
  });
  document.getElementById('disbTotal').textContent = `BATCH TOTAL ₹ ${total.toFixed(2)}`;
}

function wireDisbursement() {
  document.getElementById('disbTransferType').addEventListener('change', renderDisbursementList);
  document.getElementById('disbSearch').addEventListener('input', renderDisbursementList);
  document.getElementById('disbClearBtn').addEventListener('click', () => {
    Object.values(salaryInputs).forEach(md => md.inputEl.value = '');
    updateBatchTotal();
  });
  document.getElementById('disbExportBtn').addEventListener('click', openExportPreview);
  document.getElementById('cancelExportBtn').addEventListener('click', () => {
    document.getElementById('exportPreviewModal').classList.add('hidden');
  });
  renderDisbursementList();
}

function collectBatchLines() {
  const tft = document.getElementById('disbTransferType').value;
  const lines = [];
  let total = 0, hasInvalid = false;
  for (const [acc, md] of Object.entries(salaryInputs)) {
    const raw = md.inputEl.value.trim();
    if (!raw) continue;
    const v = parseFloat(raw);
    if (isNaN(v)) { hasInvalid = true; continue; }
    if (v <= 0) continue;
    total += v;
    lines.push({ acc, empCode: md.empCode, name: md.name, ifsc: md.ifsc, amount: v });
  }
  return { tft, lines, total, hasInvalid };
}

function openExportPreview() {
  const { tft, lines, total, hasInvalid } = collectBatchLines();
  if (hasInvalid) { alert('Some amounts are not valid numbers.'); return; }
  if (!lines.length) { alert('No valid allocations to export.'); return; }

  const monthRaw = document.getElementById('disbMonth').value;
  const monthName = MONTHS[parseInt(monthRaw,10)-1];
  const year = document.getElementById('disbYear').value;

  document.getElementById('exportPreviewBody').innerHTML = `
    <p><strong>Transfer Type:</strong> ${tft}</p>
    <p><strong>Payroll Cycle:</strong> ${monthName} ${year}</p>
    <p><strong>Employees:</strong> ${lines.length}</p>
    <p style="font-size:20px; color:var(--success); font-weight:700; margin-top:10px;">₹ ${total.toFixed(2)}</p>
  `;
  document.getElementById('exportPreviewModal').classList.remove('hidden');
  document.getElementById('confirmExportBtn').onclick = () => {
    document.getElementById('exportPreviewModal').classList.add('hidden');
    executeExport();
  };
}

async function executeExport() {
  const { tft, lines, total } = collectBatchLines();
  const prefix = tft === 'Same Bank' ? 'SBST' : 'OBST';
  const monthRaw = document.getElementById('disbMonth').value;
  const monthName = MONTHS[parseInt(monthRaw,10)-1];
  const year = document.getElementById('disbYear').value;
  const shortYear = year.slice(2);
  const txnDate = formatDateDDMMYYYY(new Date());

  let seq;
  try {
    seq = await Api.getAndIncrementCounter();
  } catch (err) {
    alert('Could not generate batch number: ' + err.message);
    return;
  }
  const batchId = `${prefix}${shortYear}${monthRaw}${seq}`;

  const empLines = [];
  const logRows = [];
  lines.forEach(({ acc, empCode, name, ifsc, amount }) => {
    const seqStr = `${prefix}${shortYear}${monthRaw}E${empCode}`;
    empLines.push(`${acc}#${ifsc}#${txnDate}##${amount.toFixed(2)}#${seqStr}#${name}#SALARY OF ${monthName} ${year}#`);
    logRows.push({ batchId, transferDate: txnDate, empCode, employeeName: name, accountNumber: acc, ifsc, amount: amount.toFixed(2), transferType: tft });
  });

  const header = `${companyProfile.accountNumber}#${companyProfile.sysId}#${txnDate}#${total.toFixed(2)}##${batchId}#${companyProfile.name}#SALARY OF ${monthName} ${year}#`;
  const output = [header, ...empLines].join('\n') + '\n';

  const fileName = `${prefix.toLowerCase()}_salary_${monthName}_${year}.txt`;
  downloadTextFile(fileName, output);

  try {
    await Api.addDisbursementRows(logRows);
    await Api.logAudit(currentUser.email, currentUser.displayName, 'EXPORT FILE',
      `Batch: ${batchId} | Type: ${tft} | Total: ₹${total.toFixed(2)} | Employees: ${empLines.length} | File: ${fileName}`);
  } catch (err) {
    alert('File downloaded, but logging to the ledger failed: ' + err.message);
  }
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

let auditRows = [];
function wireAudit() {
  document.getElementById('auditSearch').addEventListener('input', renderAuditTable);
}
async function loadAuditTrail() {
  try {
    auditRows = await Api.getAuditTrail();
  } catch (err) {
    document.getElementById('auditTableBody').innerHTML = `<tr><td colspan="4" style="color:var(--danger);">${err.message}</td></tr>`;
    return;
  }
  renderAuditTable();
}
function renderAuditTable() {
  const tbody = document.getElementById('auditTableBody');
  const emptyState = document.getElementById('auditEmptyState');
  const query = (document.getElementById('auditSearch').value || '').trim().toLowerCase();

  const filtered = auditRows.filter(r =>
    !query ||
    (r.userEmail||'').toLowerCase().includes(query) ||
    (r.action||'').toLowerCase().includes(query) ||
    (r.details||'').toLowerCase().includes(query));

  tbody.innerHTML = '';
  if (!filtered.length) { emptyState.classList.remove('hidden'); return; }
  emptyState.classList.add('hidden');

  filtered.forEach(r => {
    const ts = r.timestamp && r.timestamp.toDate ? r.timestamp.toDate().toLocaleString() : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${ts}</td><td>${r.userName || r.userEmail}</td><td>${r.action}</td><td>${r.details || ''}</td>`;
    tbody.appendChild(tr);
  });
}

async function loadCompanyProfile() {
  try {
    const p = await Api.getCompanyProfile();
    companyProfile = { ...companyProfile, ...p };
    document.getElementById('companyNameInput').value = p.name || '';
    document.getElementById('companyAccInput').value = p.accountNumber || '';
    document.getElementById('companySysInput').value = p.sysId || '';
    document.getElementById('companyJoinCodeDisplay').value = p.joinCode || '';
  } catch (err) {
    console.error(err);
  }
}
function wireCompanyForm() {
  document.getElementById('saveCompanyBtn').addEventListener('click', async () => {
    const name = document.getElementById('companyNameInput').value.trim().toUpperCase();
    const accountNumber = document.getElementById('companyAccInput').value.trim();
    const sysId = document.getElementById('companySysInput').value.trim();
    if (!name || !accountNumber || !sysId) { alert('Please fill all fields.'); return; }
    try {
      await Api.updateCompanyProfile({ name, accountNumber, sysId });
      companyProfile = { ...companyProfile, name, accountNumber, sysId };
      await Api.logAudit(currentUser.email, currentUser.displayName, 'UPDATE COMPANY', `${name} | Acc: ${accountNumber} | Branch: ${sysId}`);
      alert('Company profile updated.');
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  });
}

let lastActivity = Date.now();
['click','keydown','mousemove'].forEach(evt => document.addEventListener(evt, () => lastActivity = Date.now()));
setInterval(() => {
  if (Date.now() - lastActivity > 15 * 60 * 1000) {
    auth.signOut();
  }
}, 30000);