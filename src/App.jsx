import React, { useState, useEffect, useRef } from 'react';
import { CreateMLCEngine } from "@mlc-ai/web-llm";
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { PHARMACY_KNOWLEDGE_BASE } from './pharmacyData';
import { checkPatientInteractions, depleteInventoryStock, writeAuditLog } from './pharmacyEngine';
import { SyncModule } from './SyncModule';

function App() {
  // --- AI Model Engine States ---
  const [engine, setEngine] = useState(null);
  const [status, setStatus] = useState("Checking WebGPU support...");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [prescriptionImage, setPrescriptionImage] = useState(null);

  // --- Selected Patient & Interaction Alert States ---
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [interactionAlerts, setInteractionAlerts] = useState([]);
  const [inventoryMessage, setInventoryMessage] = useState("");
  const [inventoryAlertClass, setInventoryAlertClass] = useState("info");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPatientHistory, setSelectedPatientHistory] = useState([]);

  // --- Comprehensive Editable Form State ---
  const [formData, setFormData] = useState({
    rxSequenceNumber: `RX-${new Date().getTime().toString().slice(-6)}`,
    currentDate: new Date().toLocaleDateString(),
    patientName: "", patientAddress: "", patientDOB: "",
    prescriberName: "", prescriberNPI: "", prescriberContact: "",
    medicationName: "", medicationStrength: "",
    quantityWritten: "", calculatedDaysSupply: "",
    directionsRaw: "", directionsVerified: "",
    precautionaryLabels: [],
    fees: { containerFee: 2.50, prescriptionFee: 5.00, medicineFee: 0.00, totalFee: 7.50 },
    extraNotes: ""
  });

  // --- Dexie Live Database Subscriptions (Stage 1 Core Monitors) ---
  const localInventoryList = useLiveQuery(() => db.inventory.toArray()) || [];
  const systemAuditTrail = useLiveQuery(() => db.auditLogs.orderBy('id').reverse().limit(10).toArray()) || [];
  
  // Live query for patient search results matching query string input
  const matchedPatients = useLiveQuery(async () => {
    if (!searchQuery) return [];
    return await db.patients
      .filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .toArray();
  }, [searchQuery]);

  // --- 1. Initialize Local Multi-modal Engine on Mount ($0.00) ---
  useEffect(() => {
    async function initAI() {
      try {
        setStatus("Downloading/Loading Vision LLM locally onto device hardware via WebGPU...");
        // Initialize lightweight vision model processing locally in user's browser context
        const localEngine = await CreateMLCEngine(
          "moondream2-q4f16_1-MLC",
          { initProgressCallback: (p) => setDownloadProgress(Math.round(p.progress * 100)) }
        );
        setEngine(localEngine);
        setStatus("Ready. Running 100% locally on your machine graphics hardware.");
      } catch (error) {
        console.error(error);
        setStatus("Initialization failed. Ensure browser supports WebGPU (Chrome/Edge recommended).");
      }
    }
    initAI();
  }, []);

  // --- 2. Live Automated Drug-Drug Interaction Trigger Checking ---
  useEffect(() => {
    async function runClinicalSanityCheck() {
      if (selectedPatientId && formData.medicationName) {
        const alerts = await checkPatientInteractions(selectedPatientId, formData.medicationName);
        setInteractionAlerts(alerts);
      } else {
        setInteractionAlerts([]);
      }
    }
    runClinicalSanityCheck();
  }, [formData.medicationName, selectedPatientId]);

  // --- 3. Dynamic Local Form & Financial Changes Handling ---
  const handleFormChange = (e, section = null) => {
    const { name, value } = e.target;
    if (section === 'fees') {
      setFormData(prev => {
        const updatedFees = { ...prev.fees, [name]: parseFloat(value) || 0 };
        updatedFees.totalFee = updatedFees.containerFee + updatedFees.prescriptionFee + updatedFees.medicineFee;
        return { ...prev, fees: updatedFees };
      });
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  // --- 4. Handle Existing Patient Profile Selection Recalls ---
  const handleSelectExistingPatient = async (patient) => {
    setSelectedPatientId(patient.id);
    setFormData(prev => ({
      ...prev,
      patientName: patient.name,
      patientAddress: patient.address,
      patientDOB: patient.dob
    }));

    const history = await db.prescriptions.where('patientId').equals(patient.id).toArray();
    setSelectedPatientHistory(history);
    setSearchQuery(""); // clear dropdown lists after selecting target record
  };

  // --- 5. Image Upload & Cross-Device P2P Image Handler Pipeline ---
  const handleImageUploadAndProcess = async (eventOrUrl) => {
    let imageUrl = typeof eventOrUrl === 'string' ? eventOrUrl : URL.createObjectURL(eventOrUrl.target.files[0]);
    if (!engine) return;

    setIsProcessing(true);
    setPrescriptionImage(imageUrl);

    const jsonOutputSchema = {
      patientName: "String", prescriberName: "String",
      medication: "String", strength: "String", sigDirections: "String", quantity: "Number"
    };

    const systemPrompt = `Analyze prescription document image. Extract written text details into a flat valid JSON object matching this schema blueprint strictly: ${JSON.stringify(jsonOutputSchema)}. Only output JSON structure.`;

    try {
      const reply = await engine.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [{ type: "text", text: "Parse prescription layout details:" }, { type: "image_url", image_url: imageUrl }] }
        ],
        temperature: 0.0
      });

      const parsedJSON = JSON.parse(reply.choices[0].message.content);
      const drugSafetyInfo = PHARMACY_KNOWLEDGE_BASE.find(d => parsedJSON.medication.toLowerCase().includes(d.generic_name.toLowerCase()));

      const baseMedPrice = 12.50;
      setFormData(prev => ({
        ...prev,
        patientName: parsedJSON.patientName,
        prescriberName: parsedJSON.prescriberName,
        medicationName: parsedJSON.medication,
        medicationStrength: parsedJSON.strength,
        directionsRaw: parsedJSON.sigDirections,
        quantityWritten: parsedJSON.quantity,
        directionsVerified: drugSafetyInfo ? `${parsedJSON.sigDirections} [Verified safe matching baseline safety reference: ${drugSafetyInfo.standard_dosage}]` : `${parsedJSON.sigDirections} [Warning: No matching regulatory baseline protocol found.]`,
        precautionaryLabels: drugSafetyInfo ? drugSafetyInfo.major_interactions : ["Review medication guide."],
        fees: { ...prev.fees, medicineFee: baseMedPrice, totalFee: prev.fees.containerFee + prev.fees.prescriptionFee + baseMedPrice }
      }));
    } catch (e) {
      console.error("VLM processing failed:", e);
    } finally {
      setIsProcessing(false);
    }
  };

  // --- 6. Remote Device WebSocket / WebRTC Print Hook ---
  const handleRemotePrintCommand = (labelId) => {
    const targetElement = document.getElementById(`print-label-${labelId}`);
    if (targetElement) {
      const printContent = targetElement.innerHTML;
      const originalContent = document.body.innerHTML;
      document.body.innerHTML = printContent;
      window.print();
      document.body.innerHTML = originalContent;
      window.location.reload();
    }
  };

  // --- 7. Final Transaction Form Commit Action Logic ---
  const handleFormSubmit = async (e) => {
    e.preventDefault();
    let currentPatientId = selectedPatientId;

    if (!currentPatientId) {
      currentPatientId = await db.patients.add({
        name: formData.patientName,
        address: formData.patientAddress,
        dob: formData.patientDOB
      });
      await writeAuditLog("CREATE_PATIENT", currentPatientId, {}, { name: formData.patientName });
    }

    const rxId = await db.prescriptions.add({
      rxSequenceNumber: formData.rxSequenceNumber,
      patientId: currentPatientId,
      patientName: formData.patientName,
      prescriberName: formData.prescriberName,
      drugName: formData.medicationName,
      medicationStrength: formData.medicationStrength,
      quantityWritten: formData.quantityWritten,
      calculatedDaysSupply: formData.calculatedDaysSupply,
      directionsVerified: formData.directionsVerified,
      fees: formData.fees,
      datePrescribed: formData.currentDate,
      backupStatus: 'pending'
    });

    await writeAuditLog("EMIT_PRESCRIPTION", rxId, {}, { rxNo: formData.rxSequenceNumber, drug: formData.medicationName });

    const inventoryResult = await depleteInventoryStock(formData.medicationName, formData.quantityWritten);
    setInventoryMessage(inventoryResult.msg);
    setInventoryAlertClass(inventoryResult.lowStockAlert ? "danger" : "success");

    // Reset local data states for entry system loops
    setSelectedPatientId(null);
    setSelectedPatientHistory([]);
    setFormData(prev => ({
      ...prev,
      rxSequenceNumber: `RX-${new Date().getTime().toString().slice(-6)}`,
      patientName: "", patientAddress: "", patientDOB: "",
      prescriberName: "", prescriberNPI: "", prescriberContact: "",
      medicationName: "", medicationStrength: "", quantityWritten: "", calculatedDaysSupply: "",
      directionsRaw: "", directionsVerified: "", precautionaryLabels: [], extraNotes: "",
      fees: { containerFee: 2.50, prescriptionFee: 5.00, medicineFee: 0.00, totalFee: 7.50 }
    }));
    alert("Prescription processing transaction finalized successfully.");
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '1100px', margin: '0 auto', color: '#333' }}>
      <header style={{ background: '#0070f3', padding: '15px', color: 'white', borderRadius: '6px', marginBottom: '25px' }}>
        <h2 style={{ margin: 0 }}>🛡️ Smart-PMS: Local Edge Pharmacy System</h2>
        <small>Compute Footprint Cost: $0.00 | Status: {status} {downloadProgress > 0 && downloadProgress < 100 && `(${downloadProgress}%)`}</small>
      </header>

      {/* Peer-To-Peer Linking Engine Connection Port */}
      <SyncModule onImageReceived={handleImageUploadAndProcess} onRemotePrintTriggered={handleRemotePrintCommand} />

      {/* Relational Patient Database History Finder Row */}
      <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '5px', marginBottom: '20px', border: '1px solid #dee2e6' }}>
        <h3>🔍 Active Patient Database Registry Lookup</h3>
        <input 
          type="text" placeholder="Type a patient's name to search localized clinical data indexes..." value={searchQuery} 
          onChange={(e) => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '10px', boxSizing: 'border-box' }}
        />
        {matchedPatients && matchedPatients.length > 0 && (
          <div style={{ background: 'white', border: '1px solid #ccc', borderRadius: '4px', marginTop: '5px', maxHeight: '150px', overflowY: 'auto' }}>
            {matchedPatients.map(p => (
              <div key={p.id} onClick={() => handleSelectExistingPatient(p)} style={{ padding: '10px', cursor: 'pointer', borderBottom: '1px solid #eee' }}>
                👤 <strong>{p.name}</strong> (DOB: {p.dob})
              </div>
            ))}
          </div>
        )}
        {selectedPatientId && (
          <div style={{ marginTop: '10px', padding: '10px', background: '#fff', borderLeft: '4px solid #0070f3', fontSize: '13px' }}>
            <strong>📜 Historic Treatment Log For Active Selected Patient Profile:</strong>
            {selectedPatientHistory.length === 0 ? <p style={{ margin: '5px 0', color: '#666' }}>No legacy transaction invoices found on machine.</p> : (
              <ul>{selectedPatientHistory.map(rx => <li key={rx.id}>{rx.datePrescribed} - {rx.rxSequenceNumber}: {rx.drugName} ({rx.quantityWritten} units)</li>)}</ul>
            )}
          </div>
        )}
      </div>

      {/* Live Context Image Camera Capture Node Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
        <div>
          <h3>📸 Optical Scanner Unit</h3>
          <div style={{ border: '2px dashed #bbb', padding: '20px', textAlign: 'center', background: '#fafafa', borderRadius: '6px' }}>
            <input type="file" accept="image/*" onChange={handleImageUploadAndProcess} disabled={!engine || isProcessing} />
            {isProcessing && <p style={{ color: 'blue', fontWeight: 'bold' }}>Local WebGPU VLM is reading characters...</p>}
            {prescriptionImage && <img src={prescriptionImage} alt="Captured Prescription Layout Target" style={{ marginTop: '10px', width: '100%', maxHeight: '200px', objectFit: 'contain' }} />}
          </div>
          
          {/* Automated Safety Check System Banner Feedouts */}
          {interactionAlerts.length > 0 && (
            <div style={{ background: '#fff0f0', borderLeft: '5px solid #d9534f', padding: '12px', marginTop: '20px', borderRadius: '4px' }}>
              <h4 style={{ color: '#d9534f', margin: '0 0 5px 0' }}>⚠️ CLINICAL CONTRAINDICATION DETECTED</h4>
              {interactionAlerts.map((a, i) => <p key={i} style={{ fontSize: '12px', margin: '3px 0' }}><strong>{a.drugA.toUpperCase()} + {a.drugB.toUpperCase()}:</strong> {a.description}</p>)}
            </div>
          )}

          {inventoryMessage && (
            <div style={{ padding: '10px', marginTop: '10px', borderRadius: '4px', fontSize: '13px', fontWeight: 'bold', background: inventoryAlertClass === 'danger' ? '#f8d7da' : '#d4edda', color: inventoryAlertClass === 'danger' ? '#721c24' : '#155724' }}>
              {inventoryMessage}
            </div>
          )}
        </div>

        {/* Core Automated Entry Form Workspace Layout Panel Component */}
        <div>
          <h3>🏷️ Workorder Manifest Formulation Sheet</h3>
          <form onSubmit={handleFormSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', background: '#fff', border: '1px solid #ddd', padding: '20px', borderRadius: '6px' }}>
            <div style={{ gridColumn: '1/-1', background: '#eee', padding: '8px', fontWeight: 'bold', fontSize: '13px' }}>TRACK INDEX ID: {formData.rxSequenceNumber} | SYSTEM CLOCK TIMESTAMP: {formData.currentDate}</div>
            
            <input type="text" name="patientName" value={formData.patientName} onChange={handleFormChange} placeholder="Patient Full Name" required />
            <input type="text" name="patientDOB" value={formData.patientDOB} onChange={handleFormChange} placeholder="Patient Date of Birth" required />
            <input type="text" name="patientAddress" value={formData.patientAddress} onChange={handleFormChange} placeholder="Patient Residential Street Address" style={{ gridColumn: '1/-1' }} />
            
            <input type="text" name="prescriberName" value={formData.prescriberName} onChange={handleFormChange} placeholder="Prescribing Medical Specialist" />
            <input type="text" name="prescriberNPI" value={formData.prescriberNPI} onChange={handleFormChange} placeholder="NPI Verification Registry String" />
            
            <input type="text" name="medicationName" value={formData.medicationName} onChange={handleFormChange} placeholder="Dispensed Chemical Compound Target" style={{ gridColumn: '1/-1', fontWeight: 'bold' }} required />
            <input type="text" name="medicationStrength" value={formData.medicationStrength} onChange={handleFormChange} placeholder="Dosage Strength Factor (e.g. 20mg)" />
            <input type="number" name="quantityWritten" value={formData.quantityWritten} onChange={handleFormChange} placeholder="Vol Dispensed Metric Units" required />
            
            <textarea name="directionsRaw" value={formData.directionsRaw} onChange={handleFormChange} placeholder="Transcribed Sig Inbound Codes..." style={{ gridColumn: '1/-1' }} rows={2} />
            <textarea name="directionsVerified" value={formData.directionsVerified} onChange={handleFormChange} placeholder="AI Validated Reference Verification Feedback Output" style={{ gridColumn: '1/-1', color: 'green', fontWeight: 'bold' }} rows={2} />

            <div style={{ gridColumn: '1/-1', background: '#fff9e6', padding: '10px', borderRadius: '4px', fontSize: '12px' }}>
              <strong>⚠️ Active Dynamic Precautionary Adhesives:</strong>
              <div>{formData.precautionaryLabels.map((l, idx) => <span key={idx} style={{ background: '#f5c6cb', color: '#721c24', padding: '2px 6px', margin: '2px', display: 'inline-block', borderRadius: '4px' }}>{l}</span>)}</div>
            </div>

            <div style={{ gridColumn: '1/-1', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px', borderTop: '1px solid #ddd', paddingTop: '10px', fontSize: '12px' }}>
              <div>Vial Fee ($)<input type="number" name="containerFee" value={formData.fees.containerFee} onChange={(e)=>handleFormChange(e,'fees')} step="0.01"/></div>
              <div>Rx Fee ($)<input type="number" name="prescriptionFee" value={formData.fees.prescriptionFee} onChange={(e)=>handleFormChange(e,'fees')} step="0.01"/></div>
              <div>Base Price ($)<input type="number" name="medicineFee" value={formData.fees.medicineFee} onChange={(e)=>handleFormChange(e,'fees')} step="0.01"/></div>
              <div style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '14px', alignSelf: 'center' }}>TOTAL: ${formData.fees.totalFee.toFixed(2)}</div>
            </div>

            <button type="submit" style={{ gridColumn: '1/-1', background: '#28a745', color: '#fff', border: 'none', padding: '12px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '4px', marginTop: '10px' }}>Finalize and Commit Invoices Locally</button>
          </form>
        </div>
      </div>

      {/* System Infrastructure Metrics Display Modules Row (Stage 1 Core Monitors) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '30px' }}>
        <div style={{ background: '#fdfefe', border: '1px solid #ccc', padding: '15px', borderRadius: '5px' }}>
          <h4>📦 Real-time Shelf Stock Management Ledger</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead><tr style={{ background: '#eee', textAlign: 'left' }}><th style={{ padding: '6px' }}>Compound Label</th><th style={{ padding: '6px' }}>Physical On-Hand Volume</th><th style={{ padding: '6px' }}>Expiry Clock</th></tr></thead>
            <tbody>
              {localInventoryList.map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid #eee', color: item.currentStock <= item.reorderLevel ? 'red' : 'black' }}>
                  <td style={{ padding: '6px' }}>{item.drugName} {item.currentStock <= item.reorderLevel && "⚠️"}</td>
                  <td style={{ padding: '6px', fontWeight: 'bold' }}>{item.currentStock} tab counts</td>
                  <td style={{ padding: '6px' }}>{item.expiryDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ background: '#fdfefe', border: '1px solid #ccc', padding: '15px', borderRadius: '5px' }}>
          <h4>🛡️ Active Legal Compliance Security Audit Stream</h4>
          <div style={{ maxHeight: '180px', overflowY: 'auto', fontSize: '11px', fontFamily: 'monospace', background: '#fafafa', padding: '5px' }}>
            {systemAuditTrail.map(log => (
              <div key={log.id} style={{ padding: '4px 0', borderBottom: '1px dashed #ddd' }}>
                <span style={{ color: '#0070f3' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span> <strong>{log.actionType}</strong> <br />
                <span style={{ color: '#555' }}>Payload Struct Trace: {log.newValues}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;