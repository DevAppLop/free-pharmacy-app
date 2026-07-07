import { db } from './db';

/**
 * 1. REGULATORY AUDIT LOG ENGINE
 * Logs any transaction or change made to sensitive medical data fields.
 */
export async function writeAuditLog(actionType, targetId, oldValues = {}, newValues = {}) {
  await db.auditLogs.add({
    timestamp: new Date().toISOString(),
    actionType,
    targetId: String(targetId),
    oldValues: JSON.stringify(oldValues),
    newValues: JSON.stringify(newValues)
  });
}

/**
 * 2. REAL-TIME DRUG INTERACTION CHECKER
 * Cross-references a targeted drug against a patient's historical active profile entries.
 */
export async function checkPatientInteractions(patientId, newDrugName) {
  if (!patientId) return [];

  // Fetch all historical prescriptions written to this specific patient record
  const patientHistory = await db.prescriptions.where('patientId').equals(patientId).toArray();
  const activeDrugs = patientHistory.map(rx => rx.drugName.toLowerCase());
  const targetDrug = newDrugName.toLowerCase();
  
  let detectedConflicts = [];

  for (const historicalDrug of activeDrugs) {
    // Search local database for an interaction rule matching the pair
    const conflict = await db.interactions
      .filter(inter => 
        (inter.drugA === targetDrug && inter.drugB.includes(historicalDrug)) ||
        (inter.drugB === targetDrug && inter.drugA.includes(historicalDrug))
      ).first();

    if (conflict) {
      detectedConflicts.push(conflict);
    }
  }
  
  return detectedConflicts;
}

/**
 * 3. AUTOMATIC INVENTORY STOCK DEPLETION
 * Deducts quantities from local physical stock tables when a label is approved.
 */
export async function depleteInventoryStock(drugName, quantityToDeduct) {
  // Find matching inventory item where the inventory name matches the prescription text
  const stockItem = await db.inventory
    .filter(item => drugName.toLowerCase().includes(item.drugName.toLowerCase()) || item.drugName.toLowerCase().includes(drugName.toLowerCase()))
    .first();

  if (!stockItem) {
    return { success: false, msg: "Medication not found in active local inventory database." };
  }

  const oldStock = stockItem.currentStock;
  const newStock = Math.max(0, oldStock - parseInt(quantityToDeduct || 0, 10));

  // Commit updated stock level to disk
  await db.inventory.update(stockItem.id, { currentStock: newStock });

  // Pipe into our audit log table
  await writeAuditLog("INVENTORY_DEPLETION", stockItem.id, { currentStock: oldStock }, { currentStock: newStock });

  // Return stock alerts if thresholds are violated
  const lowStockAlert = newStock <= stockItem.reorderLevel;
  return { 
    success: true, 
    newStock, 
    lowStockAlert, 
    msg: lowStockAlert ? `⚠️ Warning: ${stockItem.drugName} is now below reorder thresholds!` : "Inventory successfully updated."
  };
}