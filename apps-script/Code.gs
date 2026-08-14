/**
 * PayFlow Pro — Apps Script API bridge
 *
 * HOW TO USE:
 * 1. Open your "SBI_Salary_Database" Google Sheet.
 * 2. Extensions → Apps Script.
 * 3. Delete any starter code, paste this whole file in.
 * 4. Click Deploy → New deployment → type "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the Web App URL it gives you.
 * 6. Paste that URL into js/api.js as APPS_SCRIPT_URL.
 *
 * This script runs under YOUR Google identity, so your sheet
 * stays private — the browser never touches your credentials.
 */

const SHEET_NAME_EMPLOYEES = "Employees";
const SHEET_NAME_AUDIT = "Audit_Trail";

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: "Invalid request body" });
  }

  const action = body.action;
  try {
    let result;
    switch (action) {
      case "getEmployees":
        result = getEmployees();
        break;
      case "addEmployee":
        result = addEmployee(body.emp);
        break;
      case "updateEmployee":
        result = updateEmployee(body.emp);
        break;
      case "deleteEmployee":
        result = deleteEmployee(body.accountNumber);
        break;
      case "logAudit":
        result = logAudit(body.user, body.action, body.details);
        break;
      default:
        return jsonResponse({ ok: false, error: "Unknown action: " + action });
    }
    return jsonResponse({ ok: true, result: result });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doGet(e) {
  // GET is used for simple read-only calls if you need them later.
  return jsonResponse({ ok: true, result: getEmployees() });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

// Sheet columns (matching the desktop app): Account Number, IFSC_BranchCode, Employee Name, Transfer Type, Emp Code
function getEmployees() {
  const sheet = getSheet(SHEET_NAME_EMPLOYEES);
  const rows = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    out.push({
      accountNumber: String(r[0]),
      ifsc: String(r[1]),
      name: String(r[2]),
      transferType: String(r[3]),
      empCode: String(r[4]),
    });
  }
  return out;
}

function addEmployee(emp) {
  const sheet = getSheet(SHEET_NAME_EMPLOYEES);
  sheet.appendRow([emp.accountNumber, emp.ifsc, emp.name, emp.transferType, emp.empCode]);
  return { added: true };
}

function updateEmployee(emp) {
  const sheet = getSheet(SHEET_NAME_EMPLOYEES);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(emp.accountNumber)) {
      sheet.getRange(i + 1, 1, 1, 5).setValues([[emp.accountNumber, emp.ifsc, emp.name, emp.transferType, emp.empCode]]);
      return { updated: true };
    }
  }
  throw new Error("Employee not found: " + emp.accountNumber);
}

function deleteEmployee(accountNumber) {
  const sheet = getSheet(SHEET_NAME_EMPLOYEES);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(accountNumber)) {
      sheet.deleteRow(i + 1);
      return { deleted: true };
    }
  }
  throw new Error("Employee not found: " + accountNumber);
}

function logAudit(user, action, details) {
  let sheet = getSheet(SHEET_NAME_AUDIT);
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME_AUDIT);
    sheet.appendRow(["Timestamp", "User", "Action", "Details"]);
  }
  sheet.appendRow([new Date(), user, action, details]);
  return { logged: true };
}


App Script Deployement URL: https://script.google.com/macros/s/AKfycbzpdWdO51WvTU_LN_ICVC7QihXuoum4LKRFpY6yQBxSqaUPGuogYRV73nO_6j1NV-p4/exec