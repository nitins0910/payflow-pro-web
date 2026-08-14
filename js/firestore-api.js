// ============================================================
// PayFlow Pro — Firestore data layer (multi-company)
// ============================================================

let currentCompanyId = null;
let currentCompanyName = '';

async function initCompanyContext(uid) {
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw new Error('No company linked to this account.');
  currentCompanyId = userDoc.data().companyId;
  const companyDoc = await db.collection('companies').doc(currentCompanyId).get();
  currentCompanyName = companyDoc.exists ? companyDoc.data().name : '';
  return { companyId: currentCompanyId, companyName: currentCompanyName, joinCode: companyDoc.data().joinCode };
}

function companyRef() {
  return db.collection('companies').doc(currentCompanyId);
}

const Api = {
  async getEmployees() {
    const snap = await companyRef().collection('employees').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async addEmployee(emp) {
    const existing = await companyRef().collection('employees')
      .where('accountNumber', '==', emp.accountNumber).limit(1).get();
    if (!existing.empty) throw new Error(`Account ${emp.accountNumber} already exists.`);
    await companyRef().collection('employees').add({
      ...emp, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },
  async updateEmployee(id, emp) {
    await companyRef().collection('employees').doc(id).set({
      ...emp, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  },
  async deleteEmployee(id) {
    await companyRef().collection('employees').doc(id).delete();
  },
  async bulkAddEmployees(rows) {
    let batch = db.batch();
    let count = 0;
    for (const r of rows) {
      const ref = companyRef().collection('employees').doc();
      batch.set(ref, { ...r, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      count++;
      if (count === 450) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
  },
  async getCompanyProfile() {
    const companyDoc = await companyRef().get();
    const privateDoc = await companyRef().collection('private').doc('profile').get();
    return {
      name: companyDoc.data().name,
      joinCode: companyDoc.data().joinCode,
      accountNumber: privateDoc.exists ? privateDoc.data().accountNumber : '',
      sysId: privateDoc.exists ? privateDoc.data().sysId : ''
    };
  },
  async updateCompanyProfile({ name, accountNumber, sysId }) {
    await companyRef().set({ name }, { merge: true });
    await companyRef().collection('private').doc('profile').set({
      accountNumber, sysId, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  },
  async getAndIncrementCounter() {
    const counterRef = companyRef().collection('meta').doc('fileCounter');
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists ? (snap.data().value || 1) : 1;
      tx.set(counterRef, { value: current + 1 }, { merge: true });
      return `A${String(current).padStart(2, '0')}`;
    });
  },
  async addDisbursementRows(rows) {
    let batch = db.batch();
    rows.forEach(r => {
      const ref = companyRef().collection('disbursements').doc();
      batch.set(ref, { ...r, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    await batch.commit();
  },
  async getDisbursementHistory() {
    const snap = await companyRef().collection('disbursements').orderBy('createdAt', 'desc').limit(500).get();
    return snap.docs.map(d => d.data());
  },
  async logAudit(userEmail, userName, action, details) {
    await companyRef().collection('auditTrail').add({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      userEmail, userName, action, details
    });
  },
  async getAuditTrail() {
    const snap = await companyRef().collection('auditTrail').orderBy('timestamp', 'desc').limit(300).get();
    return snap.docs.map(d => d.data());
  }
};