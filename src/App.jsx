import { useState, useEffect } from 'react';
import { CreateMLCEngine } from '@mlc-ai/web-llm';

// Pre-defined training tracks for the dropdown menu
const TRAINING_TOPICS = [
  "Pediatric Weight-Based Dose Calculations",
  "Antibiotic Reconstitution & Storage Protocols",
  "High-Alert Medications & Black Box Warnings",
  "Look-Alike, Sound-Alike (LASA) Drug Prevention",
  "Patient Confidentiality & HIPAA Compliance basics"
];

export default function App() {
  // --- APPLICATION STATE ---
  const [inventory, setInventory] = useState(() => {
    const saved = localStorage.getItem('pharmacy_inventory');
    return saved ? JSON.parse(saved) : [];
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [verificationResult, setVerificationResult] = useState(null);
  const [childWeight, setChildWeight] = useState('');
  const [calcResults, setCalcResults] = useState(null);

  // Training Module States
  const [selectedTopic, setSelectedTopic] = useState('');
  const [trainingContent, setTrainingContent] = useState(null);
  const [userAnswers, setUserAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [isGeneratingModule, setIsGeneratingModule] = useState(false);

  // Local WebGPU LLM States
  const [aiStatus, setAiStatus] = useState('Not Initialized');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [engine, setEngine] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    localStorage.setItem('pharmacy_inventory', JSON.stringify(inventory));
  }, [inventory]);

  // --- INITIALIZE WEB_LLM ENGINE ---
  const initAI = async () => {
    setAiStatus('Initializing WebGPU Model (Llama-3.2)...');
    try {
      const selectedModel = "Llama-3.2-1B-Instruct-q4f16_1-MLC"; 
      const replyProgressCallback = (report) => { setAiStatus(report.text); };
      const aiEngine = await CreateMLCEngine(selectedModel, { initProgressCallback: replyProgressCallback });
      setEngine(aiEngine);
      setAiStatus('Model Ready!');
    } catch (error) {
      console.error(error);
      setAiStatus('Initialization failed. Verify WebGPU capabilities.');
    }
  };

  // --- DYNAMIC AI TRAINING MODULE GENERATOR ---
  const handleGenerateTraining = async (topicName) => {
    if (!topicName) return;
    setSelectedTopic(topicName);
    setIsGeneratingModule(true);
    setTrainingContent(null);
    setQuizSubmitted(false);
    setUserAnswers({});
    
    if (!engine) {
      alert("Please initialize the Local AI Assistant at the top of the page first to generate training modules.");
      setIsGeneratingModule(false);
      return;
    }

    const trainingPrompt = 
      `You are an expert Clinical Pharmacy Instructor building a training module for an assistant on the topic: "${topicName}".\n` +
      `Generate a structured training module and return ONLY a valid JSON object matching the exact schema below. Do not include markdown codeblocks or extra conversational text:\n` +
      `{\n` +
      `  "topic": "${topicName}",\n` +
      `  "core_lesson": "A detailed 2-paragraph clinical explanation covering critical protocols and workflows.",\n` +
      `  "safety_takeaway": "The #1 golden safety rule for this specific topic.",\n` +
      `  "quiz": [\n` +
      `    {\n` +
      `      "question": "Clear scenario-based question 1?",\n` +
      `      "options": ["Option A", "Option B", "Option C", "Option D"],\n` +
      `      "correct_index": 0,\n` +
      `      "explanation": "Why Option A is clinically correct."\n` +
      `    },\n` +
      `    {\n` +
      `      "question": "Clear scenario-based question 2?",\n` +
      `      "options": ["Option A", "Option B", "Option C", "Option D"],\n` +
      `      "correct_index": 1,\n` +
      `      "explanation": "Why Option B is clinically correct."\n` +
      `    }\n` +
      `  ]\n` +
      `}`;

    try {
      const reply = await engine.chat.completions.create({
        messages: [{ role: 'user', content: trainingPrompt }]
      });
      
      const cleanJsonText = reply.choices[0].message.content.trim().replace(/```json|```/g, "");
      const generatedModule = JSON.parse(cleanJsonText);
      setTrainingContent(generatedModule);
    } catch (error) {
      console.error("Failed to construct training module JSON:", error);
      alert("The local model encountered an issue assembling the structural data block. Please try generating it again.");
    } finally {
      setIsGeneratingModule(false);
    }
  };

  // --- STANDARD COMPLIANCE CHAT ---
  const handleAiChat = async (e) => {
    e.preventDefault();
    if (!engine || !aiPrompt) return;
    setAiResponse('Thinking...');
    try {
      const reply = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: "You are a clinical verification engine. Verify age-based calculations strictly." },
          { role: 'user', content: aiPrompt }
        ]
      });
      setAiResponse(reply.choices[0].message.content);
    } catch (error) {
      setAiResponse('Error executing local safety inference.');
    }
  };

  // --- CLINICAL REGISTRY VERIFICATION LAYER (OPENFDA) ---
  const handleClinicalRegistryVerification = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;
    setIsVerifying(true);
    setVerificationResult(null);
    setCalcResults(null);

    try {
      const fdaResponse = await fetch(`https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${searchQuery}"&limit=1`);
      if (!fdaResponse.ok) throw new Error("Medication label not found in federal reference registry.");
      
      const fdaData = await fdaResponse.json();
      const labelInfo = fdaData.results[0];

      const brandName = labelInfo.openfda?.brand_name?.[0] || "Generic Variant";
      const genericName = labelInfo.openfda?.generic_name?.[0] || searchQuery;
      const dosageAndAdministration = labelInfo.dosage_and_administration?.[0] || "Not specified.";
      const pediatricUse = labelInfo.pediatric_use?.[0] || "No specialized pediatric metadata found.";
      const boxedWarning = labelInfo.boxed_warning?.[0] || "No severe black box warnings active on record.";

      if (!engine) {
        setVerificationResult({
          generic_name: genericName, brand_name: brandName, dosage: dosageAndAdministration,
          pediatric: pediatricUse, warning: boxedWarning, pediatric_mg_per_kg_per_day: 10, pediatric_max_mg_per_kg_per_day: 40
        });
        setIsVerifying(false);
        return;
      }

      const parsingPrompt = 
        `You are parsing an official FDA label for "${genericName}". Extract structured values and return ONLY valid JSON:\n` +
        `{\n` +
        `  "generic_name": "${genericName}",\n` +
        `  "brand_name": "${brandName}",\n` +
        `  "pediatric_mg_per_kg_per_day": 15,\n` +
        `  "pediatric_max_mg_per_kg_per_day": 60\n` +
        `}\n` +
        `Extract parameters from: ${dosageAndAdministration.substring(0, 1000)}`;

      const aiReply = await engine.chat.completions.create({ messages: [{ role: 'user', content: parsingPrompt }] });
      const parsedJson = JSON.parse(aiReply.choices[0].message.content.trim().replace(/```json|```/g, ""));
      
      setVerificationResult({
        generic_name: parsedJson.generic_name, brand_name: parsedJson.brand_name, dosage: dosageAndAdministration,
        pediatric: pediatricUse, warning: boxedWarning, pediatric_mg_per_kg_per_day: parsedJson.pediatric_mg_per_kg_per_day || 10,
        pediatric_max_mg_per_kg_per_day: parsedJson.pediatric_max_mg_per_kg_per_day || 40
      });
    } catch (err) {
      alert(`Verification error: ${err.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleWeightCalculation = (weightKg, med) => {
    const kg = parseFloat(weightKg);
    setChildWeight(weightKg);
    if (!kg || kg <= 0) { setCalcResults(null); return; }
    setCalcResults({
      targetDaily: (kg * med.pediatric_mg_per_kg_per_day).toFixed(1),
      maxDaily: (kg * med.pediatric_max_mg_per_kg_per_day).toFixed(1)
    });
  };

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '850px', margin: '0 auto', padding: '20px', color: '#333' }}>
      <h1>Pharmacy Workshop</h1>
      <p style={{ color: '#666' }}>Grounded Workspace with Dynamic Assistant Training & FDA Reference Layers.</p>
      <hr />

      {/* CORE CONTROL MATRIX */}
      <section style={{ marginBottom: '30px', background: '#f8f9fa', padding: '25px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <h2>🤖 Your Local AI Assistant</h2>
        <p><strong>Status Track:</strong> <span style={{ color: '#2b6cb0' }}>{aiStatus}</span></p>
        {aiStatus === 'Not Initialized' && (
          <button onClick={initAI} style={{ padding: '10px 20px', background: '#3182ce', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
            Initialize Local AI Core (WebGPU)
          </button>
        )}
        {engine && (
          <form onSubmit={handleAiChat} style={{ marginTop: '15px' }}>
            <input type="text" placeholder="Ask custom compliance or structural safety questions..." value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} style={{ width: '80%', padding: '10px', borderRadius: '4px', border: '1px solid #cbd5e0' }} />
            <button type="submit" style={{ width: '18%', marginLeft: '2%', padding: '10px', background: '#48bb78', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Ask Assistant</button>
          </form>
        )}
        {aiResponse && (
          <div style={{ marginTop: '15px', background: '#fff', padding: '15px', borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '14px' }}>
            <strong>System Summary Log:</strong>
            <p style={{ margin: '5px 0 0 0', whiteSpace: 'pre-wrap', color: '#4a5568' }}>{aiResponse}</p>
          </div>
        )}
      </section>

      {/* --- NEW SECTION: PHARMACY ASSISTANT TRAINING MODULE ENGINE --- */}
      <section style={{ marginBottom: '40px', padding: '25px', background: '#f0fff4', border: '1px solid #c6f6d5', borderRadius: '8px' }}>
        <h2 style={{ color: '#22543d', margin: '0 0 10px 0' }}>🎓 Pharmacy Assistant Training Academy</h2>
        <p style={{ fontSize: '14px', margin: '0 0 15px 0', color: '#2f855a' }}>
          Select an official study track below or search a custom concept to generate an automated interactive curriculum.
        </p>

        <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
          {/* Preset drop-down picker */}
          <select 
            onChange={(e) => handleGenerateTraining(e.target.value)}
            defaultValue=""
            style={{ padding: '10px', flex: 1, borderRadius: '4px', border: '1px solid #cbd5e0', fontSize: '14px' }}
          >
            <option value="" disabled>-- Select an Instant Training Track --</option>
            {TRAINING_TOPICS.map((topic, i) => <option key={i} value={topic}>{topic}</option>)}
          </select>

          {/* Manual Input Field */}
          <input 
            type="text"
            placeholder="Or type a custom topic and press Enter..."
            onKeyDown={(e) => { if (e.key === 'Enter') handleGenerateTraining(e.target.value); }}
            style={{ padding: '10px', flex: 1, borderRadius: '4px', border: '1px solid #cbd5e0', fontSize: '14px' }}
          />
        </div>

        {isGeneratingModule && (
          <div style={{ padding: '15px', background: '#fff', borderRadius: '6px', textAlign: 'center', border: '1px dashed #38a169' }}>
            ⏳ <strong>Local AI is drafting your interactive curriculum...</strong> Please wait roughly 10-15 seconds for local execution tokens to process.
          </div>
        )}

        {/* Training Layout Presentation */}
        {trainingContent && (
          <div style={{ background: '#fff', padding: '20px', borderRadius: '6px', border: '1px solid #c6f6d5', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
            <h3 style={{ color: '#234e52', marginTop: '0' }}>📋 Module: {trainingContent.topic}</h3>
            <p style={{ lineHeight: '1.6', fontSize: '15px', color: '#2d3748' }}>{trainingContent.core_lesson}</p>
            
            <div style={{ background: '#fffaf0', borderLeft: '4px solid #dd6b20', padding: '12px', margin: '15px 0', borderRadius: '0 4px 4px 0' }}>
              <strong>⚠️ CRITICAL SAFETY TAKEAWAY:</strong>
              <p style={{ margin: '5px 0 0 0', fontStyle: 'italic', color: '#7b341e' }}>{trainingContent.safety_takeaway}</p>
            </div>

            {/* Interactive Module Quiz Elements */}
            <div style={{ marginTop: '25px', paddingTop: '20px', borderTop: '2px dashed #e2e8f0' }}>
              <h4 style={{ color: '#2c5282', margin: '0 0 15px 0' }}>🧠 Knowledge Check Verification Quiz</h4>
              {trainingContent.quiz.map((q, qIdx) => (
                <div key={qIdx} style={{ marginBottom: '20px', background: '#f7fafc', padding: '15px', borderRadius: '6px' }}>
                  <p style={{ fontWeight: 'bold', margin: '0 0 10px 0' }}>Q{qIdx + 1}: {q.question}</p>
                  {q.options.map((opt, oIdx) => (
                    <label key={oIdx} style={{ display: 'block', margin: '8px 0', cursor: 'pointer', fontSize: '14px' }}>
                      <input 
                        type="radio" 
                        name={`question-${qIdx}`} 
                        disabled={quizSubmitted}
                        checked={userAnswers[qIdx] === oIdx}
                        onChange={() => setUserAnswers({ ...userAnswers, [qIdx]: oIdx })}
                        style={{ marginRight: '8px' }}
                      />
                      {opt}
                    </label>
                  ))}
                  {quizSubmitted && (
                    <div style={{ marginTop: '10px', fontSize: '13px', color: userAnswers[qIdx] === q.correct_index ? '#2f855a' : '#c53030' }}>
                      {userAnswers[qIdx] === q.correct_index ? "✅ Correct!" : `❌ Incorrect (Correct Answer: ${q.options[q.correct_index]})`}<br/>
                      <span style={{ color: '#4a5568', fontStyle: 'italic' }}><strong>Rationale:</strong> {q.explanation}</span>
                    </div>
                  )}
                </div>
              ))}
              
              {!quizSubmitted ? (
                <button 
                  onClick={() => setQuizSubmitted(true)}
                  style={{ padding: '10px 20px', background: '#2b6cb0', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Submit Quiz Answers
                </button>
              ) : (
                <button 
                  onClick={() => handleGenerateTraining(selectedTopic)}
                  style={{ padding: '10px 20px', background: '#4a5568', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Reset & Retry New Scenarios
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* SEARCH MATRIX */}
      <section style={{ marginBottom: '30px' }}>
        <h2>🔍 Live Grounded Reference Verification</h2>
        <form onSubmit={handleClinicalRegistryVerification} style={{ display: 'flex', gap: '10px' }}>
          <input type="text" placeholder="Enter Generic Name for live calculation boundaries (e.g., Flucloxacillin)..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ flex: 1, padding: '12px', fontSize: '16px', borderRadius: '4px', border: '1px solid #cbd5e0' }} />
          <button type="submit" disabled={isVerifying} style={{ padding: '12px 24px', background: '#00a3c4', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
            {isVerifying ? "Querying..." : "Verify Online Registry"}
          </button>
        </form>

        {verificationResult && (
          <div style={{ marginTop: '20px', padding: '20px', background: '#fff', border: '1px solid #cbd5e0', borderRadius: '8px' }}>
            <h2 style={{ margin: '0 0 5px 0', color: '#2c5282' }}>{verificationResult.generic_name}</h2>
            <p style={{ fontSize: '14px', color: '#718096', margin: '0 0 15px 0' }}><strong>Registry Brand Identifier:</strong> {verificationResult.brand_name}</p>

            <div style={{ background: '#ebf8ff', padding: '15px', borderRadius: '6px', border: '1px solid #bee3f8', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 10px 0', color: '#2b6cb0' }}>👶 Clinical Pediatric Calculator Layer</h3>
              <input type="number" placeholder="Weight in kg" value={childWeight} onChange={(e) => handleWeightCalculation(e.target.value, verificationResult)} style={{ padding: '8px', width: '150px', borderRadius: '4px', border: '1px solid #cbd5e0' }} />
              {calcResults && (
                <div style={{ marginTop: '12px', background: '#fff', padding: '10px', borderRadius: '4px', border: '1px solid #bee3f8' }}>
                  🟢 Grounded Baseline Target Dose: <strong>{calcResults.targetDaily} mg / day</strong> total.<br />
                  🔴 Maximum Safety Cap Limit: <strong>{calcResults.maxDaily} mg / day</strong> total.
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}