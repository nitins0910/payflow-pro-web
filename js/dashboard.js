// ============================================================
// PayFlow Pro — Dashboard
// One hybrid dashboard for every signed-in user (no separate
// Maker / Authenticator accounts).
// ============================================================

let currentUser = null;
let employees = [];
let editingAccountNumber = null; // null = adding new

// ---------- Auth guard ----------
auth.onAuthStateChanged(user => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = user;
  document.getElementById('userName').textContent = user.displayName || 'PayFlow User';
  document.getElementById('userEmail').textContent = user.email;
  loadEmployees();
});

document.getElementById('logoutBtn').onclick = () => auth.signOut();

// ---------- Sidebar navigation ----------
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
    document.getElementById('page-' + item.dataset.page).classList.remove('hidden');
  });
});

// ---------- Load & render employees ----------
async function loadEmployees() {
  const tbody = document.getElementById('employeeTableBody');
  const emptyState = document.getElementById('employeeEmptyState');
  try {
    employees = await Api.getEmployees();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--danger);">Could not load employees — check APPS_SCRIPT_URL in js/api.js. (${err.message})</td></tr>`;
    return;
  }
  renderEmployeeTable();
}

function renderEmployeeTable() {
  const tbody = document.getElementById('employeeTableBody');
  const emptyState = document.getElementById('employeeEmptyState');
  tbody.innerHTML = '';

  if (!employees.length) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  employees.forEach(emp => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${emp.name}</td>
      <td>${emp.accountNumber}</td>
      <td>${emp.ifsc}</td>
      <td>${emp.transferType}</td>
      <td>${emp.empCode}</td>
      <td class="row-actions">
        <button data-edit="${emp.accountNumber}">Edit</button>
        <button data-delete="${emp.accountNumber}" class="danger">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => openEditModal(btn.dataset.edit);
  });
  tbody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.onclick = () => handleDelete(btn.dataset.delete);
  });
}

// ---------- Add / Edit modal ----------
const modal = document.getElementById('employeeModal');
const employeeForm = document.getElementById('employeeForm');

document.getElementById('addEmployeeBtn').onclick = () => openAddModal();
document.getElementById('cancelModalBtn').onclick = () => closeModal();

function openAddModal() {
  editingAccountNumber = null;
  document.getElementById('modalTitle').textContent = 'Add Employee';
  employeeForm.reset();
  modal.classList.remove('hidden');
}

function openEditModal(accountNumber) {
  const emp = employees.find(e => String(e.accountNumber) === String(accountNumber));
  if (!emp) return;
  editingAccountNumber = accountNumber;
  document.getElementById('modalTitle').textContent = 'Edit Employee';
  document.getElementById('empName').value = emp.name;
  document.getElementById('empAccount').value = emp.accountNumber;
  document.getElementById('empIfsc').value = emp.ifsc;
  document.getElementById('empCode').value = emp.empCode;
  document.getElementById('empTransferType').value = emp.transferType;
  modal.classList.remove('hidden');
}

function closeModal() {
  modal.classList.add('hidden');
}

employeeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('saveEmployeeBtn');
  btn.disabled = true; btn.textContent = 'Saving...';

  const emp = {
    name: document.getElementById('empName').value.trim().toUpperCase(),
    accountNumber: document.getElementById('empAccount').value.trim(),
    ifsc: document.getElementById('empIfsc').value.trim(),
    empCode: document.getElementById('empCode').value.trim(),
    transferType: document.getElementById('empTransferType').value.trim(),
  };

  try {
    if (editingAccountNumber) {
      await Api.updateEmployee(emp);
      await Api.logAudit(currentUser.email, 'EDIT EMPLOYEE', `${emp.name} | Acc: ${emp.accountNumber}`);
    } else {
      await Api.addEmployee(emp);
      await Api.logAudit(currentUser.email, 'ADD EMPLOYEE', `${emp.name} | Acc: ${emp.accountNumber}`);
    }
    closeModal();
    await loadEmployees();
  } catch (err) {
    alert('Save failed: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
});

async function handleDelete(accountNumber) {
  const emp = employees.find(e => String(e.accountNumber) === String(accountNumber));
  if (!confirm(`Delete ${emp ? emp.name : accountNumber}? This cannot be undone.`)) return;
  try {
    await Api.deleteEmployee(accountNumber);
    await Api.logAudit(currentUser.email, 'DELETE EMPLOYEE', `${emp ? emp.name : ''} | Acc: ${accountNumber}`);
    await loadEmployees();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}
