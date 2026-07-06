import { useState, useEffect } from 'react';
import { PHARMACY_KNOWLEDGE_BASE } from './pharmacyData';
// Import the CreateWebWorkerEngine from WebLLM
import { CreateWebWorkerEngine } from '@mlc-ai/web-llm';

export default function App() {
  // --- STATE MANAGEMENT ---
  const [inventory, setInventory] = useState(() => {
    const saved = localStorage.getItem('pharmacy_inventory');
    return saved ? JSON.parse(saved) : [];
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [newItemName, setNewItemName] = useState('');
  const [newItemStock, setNewItemStock] = useState('');

  // AI-Specific States
  const [aiStatus, setAiStatus] = useState('Not Initialized');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [engine, setEngine] = useState(null);

  // --- EFFECTS ---
  useEffect(() => {
    localStorage.setItem('pharmacy_inventory', JSON.stringify(inventory));
  }, [inventory]);

  // --- HANDLERS & LOGIC ---
  
  // Initialize the local WebGPU model
  const initAI = async () => {
    setAiStatus('Initializing WebGPU & Loading Model...');
    try {
      // Using a small, fast 1B parameter model optimized for web browsers
      const selectedModel = "Llama-3-8B-Instruct-q4f16_1-MLC"; 
      
      const replyProgressCallback = (report) => {
        console.log(report.text); // This will print directly to your browser console!
        setAiStatus(report.text);
      };

      // Creates the engine inside a background worker thread so the UI doesn't freeze
      const webWorker = new Worker(
        new URL('./ai-worker.js', import.meta.url),
        { type: 'module' }
      );

      const aiEngine = await CreateWebWorkerEngine(webWorker, selectedModel, {
        initProgressCallback: replyProgressCallback,
      });

      setEngine(aiEngine);
      setAiStatus('Model Ready!');
    } catch (error) {
      console.error(error);
      setAiStatus('Initialization failed. Make sure your browser supports WebGPU.');
    }
  };

  const handleAiChat = async (e) => {
    e.preventDefault();
    if (!engine || !aiPrompt) return;

    setAiResponse('Thinking...');
    const messages = [{ role: 'user', content: aiPrompt }];
    
    const reply = await engine.chat.completions.create({ messages });
    setAiResponse(reply.choices[0].message.content);
  };

  const handleSearch = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (query.trim() === '') {
      setSearchResults([]);
      return;
    }
    const filtered = PHARMACY_KNOWLEDGE_BASE.filter((med) =>
      med.generic_name.toLowerCase().includes(query.toLowerCase()) ||
      med.brand_names.some(brand => brand.toLowerCase().includes(query.toLowerCase()))
    );
    setSearchResults(filtered);
  };

  const handleAddInventory = (e) => {
    e.preventDefault();
    if (!newItemName || !newItemStock) return;
    setInventory([...inventory, { id: Date.now(), name: newItemName, stock: parseInt(newItemStock, 10) }]);
    setNewItemName('');
    setNewItemStock('');
  };

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <h1>Zero-Cost Pharmacy Workspace</h1>
      <p style={{ color: '#666' }}>Powered by local data layers & browser storage.</p>
      
      <hr style={{ margin: '20px 0' }} />

      {/* NEW SECTION: LOCAL AI ENGINE */}
      <section style={{ marginBottom: '40px', background: '#f4f4f9', padding: '20px', borderRadius: '8px' }}>
        <h2>🤖 Local AI Assistant ($0.00 Server Costs)</h2>
        <p><strong>Status:</strong> <span style={{ color: '#0056b3' }}>{aiStatus}</span></p>
        
        {aiStatus === 'Not Initialized' && (
          <button onClick={initAI} style={{ padding: '10px 20px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            Initialize Local AI Model (WebGPU)
          </button>
        )}

        {aiStatus === 'Model Ready!' && (
          <form onSubmit={handleAiChat} style={{ marginTop: '15px' }}>
            <input
              type="text"
              placeholder="Ask the AI helper a safety question..."
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              style={{ width: '80%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <button type="submit" style={{ width: '18%', marginLeft: '2%', padding: '10px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Ask
            </button>
          </form>
        )}

        {aiResponse && (
          <div style={{ marginTop: '15px', background: '#fff', padding: '15px', borderRadius: '4px', border: '1px solid #ddd' }}>
            <strong>Response:</strong>
            <p style={{ whiteSpace: 'pre-wrap', margin: '5px 0 0 0' }}>{aiResponse}</p>
          </div>
        )}
      </section>

      {/* DETERMINISTIC SEARCH */}
      <section style={{ marginBottom: '40px' }}>
        <h2>🔍 Deterministic Drug Verification</h2>
        <input
          type="text"
          placeholder="Search Lisinopril, Metformin, Amoxicillin..."
          value={searchQuery}
          onChange={handleSearch}
          style={{ width: '100%', padding: '10px', fontSize: '16px', borderRadius: '4px', border: '1px solid #ccc' }}
        />
        {searchResults.length > 0 && (
          <div style={{ marginTop: '15px', background: '#f9f9f9', padding: '15px', borderRadius: '6px', border: '1px solid #ddd' }}>
            {searchResults.map((med, index) => (
              <div key={index} style={{ marginBottom: '15px' }}>
                <h3 style={{ margin: '0 0 5px 0', color: '#0056b3' }}>{med.generic_name}</h3>
                <p><strong>Category:</strong> {med.category}</p>
                <span style={{ display: 'block', background: '#fff0f0', color: '#c00', padding: '8px', borderRadius: '4px' }}>
                  ⚠️ Warning: {med.black_box_warning}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}