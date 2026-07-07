import Dexie from 'dexie';

export const db = new Dexie('PharmacyLabelDB');

// Version 3: Added inventory, audit logs, and interaction definition tables
db.version(3).stores({
  patients: '++id, name, dob, contact',
  prescriptions: '++id, rxSequenceNumber, patientId, drugName, datePrescribed, backupStatus',
  inventory: '++id, drugName, currentStock, reorderLevel, expiryDate',
  auditLogs: '++id, timestamp, actionType, targetId, oldValues, newValues',
  interactions: '++id, drugA, drugB, severity, description'
});

// Seed Initial Mock Data for testing if tables are empty
db.on('populate', () => {
  db.inventory.bulkAdd([
    { drugName: "Lisinopril 10mg", currentStock: 500, reorderLevel: 100, expiryDate: "2028-12-01" },
    { drugName: "Metformin 500mg", currentStock: 1000, reorderLevel: 200, expiryDate: "2028-08-15" },
    { drugName: "Amoxicillin 500mg", currentStock: 50, reorderLevel: 100, expiryDate: "2027-05-20" } // Low stock test
  ]);

  db.interactions.bulkAdd([
    { drugA: "lisinopril", drugB: "spironolactone", severity: "Severe", description: "Concomitant use may result in profound hyperkalemia (high potassium levels)." },
    { drugA: "lisinopril", drugB: "ibuprofen", severity: "Moderate", description: "NSAIDs may decrease the antihypertensive effect of Lisinopril and increase risk of renal impairment." },
    { drugA: "metformin", drugB: "contrast", severity: "Severe", description: "Iodinated contrast media can lead to acute renal failure and metformin accumulation, raising lactic acidosis risks." }
  ]);
});