// ============================================================
// PayFlow Pro — API bridge to your Google Sheet
// This calls the Apps Script Web App you deploy from
// apps-script/Code.gs (bound to your existing SBI_Salary_Database sheet).
// ============================================================

// PASTE your Apps Script Web App deployment URL here after Step 4 in README.md
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzpdWdO51WvTU_LN_ICVC7QihXuoum4LKRFpY6yQBxSqaUPGuogYRV73nO_6j1NV-p4/exec";

async function callApi(action, payload = {}) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    // text/plain avoids a CORS preflight, which Apps Script Web Apps don't handle.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data.result;
}

const Api = {
  getEmployees: () => callApi('getEmployees'),
  addEmployee: (emp) => callApi('addEmployee', { emp }),
  updateEmployee: (emp) => callApi('updateEmployee', { emp }),
  deleteEmployee: (accountNumber) => callApi('deleteEmployee', { accountNumber }),
  logAudit: (user, action, details) => callApi('logAudit', { user, action, details }),
};
