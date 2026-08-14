// ============================================================
// PayFlow Pro — Firestore data layer (single-user accounts)
// ============================================================

let currentUserId = null;

async function initUserContext(uid) {
  currentUserId = uid;
}

function userRef() {
  return db.collection('users').doc(currentUserId);
}

const Api = {
  async getEmployees() {
    const snap = await userRef().collection('employees').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async addEmployee(emp) {
    const existing = await userRef().collection('employees')
      .where('accountNumber', '==', emp.accountNumber).limit(1).get();
    if (!existing.empty) throw new Error(`Account ${emp.accountNumber} already exists.`);
    await userRef().collection('employees').add({
      ...emp, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },
  async updateEmployee(id, emp) {
    await userRef().collection('employees').doc(id).set({
      ...emp, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  },
  async deleteEmployee(id) {
    await userRef().collection('employees').doc(id).delete();
  },
  async bulkAddEmployees(rows) {
    let batch = db.batch();
    let count = 0;
    for (const r of rows) {
      const ref = userRef().collection('employees').doc();
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
    const doc = await userRef().get();
    const d = doc.exists ? doc.data() : {};
    return {
      name: d.companyName || '',
      accountNumber: d.accountNumber || '',
      sysId: d.sysId || ''
    };
  },
  async updateCompanyProfile({ name, accountNumber, sysId }) {
    await userRef().set({
      companyName: name, accountNumber, sysId,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  },
  async getAndIncrementCounter() {
    const counterRef = userRef().collection('meta').doc('fileCounter');
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
      const ref = userRef().collection('disbursements').doc();
      batch.set(ref, { ...r, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    await batch.commit();
  },
  async getDisbursementHistory() {
    const snap = await userRef().collection('disbursements').orderBy('createdAt', 'desc').limit(500).get();
    return snap.docs.map(d => d.data());
  },
  async logAudit(userEmail, userName, action, details) {
    await userRef().collection('auditTrail').add({
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      userEmail, userName, action, details
    });
  },
  async getAuditTrail() {
    const snap = await userRef().collection('auditTrail').orderBy('timestamp', 'desc').limit(300).get();
    return snap.docs.map(d => d.data());
  }
};