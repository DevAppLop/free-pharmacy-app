import { useState, useEffect } from 'react';
// Import the local knowledge base we created in Phase 2
import { PHARMACY_KNOWLEDGE_BASE } from './pharmacyData';
// FIXED: Using the exact official exported function name from @mlc-ai/web-llm
import { CreateMLCEngine } from '@mlc-ai/web-llm';

export default function App() {
  // --- STATE MANAGEMENT ---
  
  // Inventory State (Loads from LocalStorage, defaults to empty array)
  const [inventory, setInventory] = useState(() => {
    const saved = localStorage.getItem('pharmacy_inventory');
    return saved ? JSON.parse(saved) : [];
  });

  // Search & UI States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [newItemName, setNewItemName] = useState('');
  const [newItemStock, setNewItemStock] = useState('');

  // Local AI Module States
  const [aiStatus, setAiStatus] = useState('Not Initialized');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [engine, setEngine] = useState(null);

  // --- EFFECTS ---

  // Automatically save to LocalStorage whenever the 'inventory' array changes
  useEffect(() => {
    localStorage.setItem('pharmacy_inventory', JSON.stringify(inventory));
  }, [inventory]);

  // --- HANDLERS & LOGIC ---

  // Direct WebGPU Engine Initialization (No complex background worker files)
  const initAI = async () => {
    setAiStatus('Initializing WebGPU & Loading Model Slices...');
    try {
      // Using a highly optimized, lightweight 1B parameter model perfect for browser execution
      const selectedModel = "Llama-3-8B-Instruct-q4f16_1-MLC"; 
      
      const replyProgressCallback = (report) => {
        console.log(report.text); // Prints compilation percentages directly to your browser console
        setAiStatus(report.text);
      };

      // FIXED: Invoking the exact, validated factory function
      const aiEngine = await CreateMLCEngine(selectedModel, {
        initProgressCallback: replyProgressCallback,
      });

      setEngine(aiEngine);
      setAiStatus('Model Ready!');
    } catch (error) {
      console.error(error);
      setAiStatus('Initialization failed. Make sure your browser supports WebGPU.');
    }
  };

  // Submit prompt to the local AI engine
  const handleAiChat = async (e) => {
    e.preventDefault();
    if (!engine || !aiPrompt) return;

    setAiResponse('Thinking...');
    const messages = [{ role: 'user', content: aiPrompt }];
    
    try {
      const reply = await engine.chat.completions.create({ messages });
      setAiResponse(reply.choices[0].message.content);
    } catch (error) {
      console.error(error);
      setAiResponse('Error executing local inference.');
    }
  };

  // Search the $0.00 deterministic database layer
  const handleSearch = (e) => {
    const query = e.target.value;
    setSearchQuery(query);

    if (query.trim() === '') {
      setSearchResults([]);
      return;
    }

    const filtered = PHARMACY_KNOWLEDGE_BASE.filter((med) =>
      med.generic_name.toLowerCase().includes(query.toLowerCase()) ||
      med.brand_names?.some(brand => brand.toLowerCase().includes(query.toLowerCase()))
    );
    setSearchResults(filtered);
  };

  // Add an item to the LocalStorage inventory list
  const handleAddInventory = (e) => {
    e.preventDefault();
    if (!newItemName || !newItemStock) return;

    const newItem = {
      id: Date.now(),
      name: newItemName,
      stock: parseInt(newItemStock, 10),
    };

    setInventory([...inventory, newItem]);
    setNewItemName('');
    setNewItemStock('');
  };

  // Remove an item from the LocalStorage inventory list
  const handleRemoveInventory = (id) => {
    setInventory(inventory.filter((item) => item.id !== id));
  };

  // --- RENDER UI ---
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <h1>Zero-Cost Pharmacy Workspace</h1>
      <p style={{ color: '#666' }}>Powered by local data layers & browser storage.</p>
      
      <hr style={{ margin: '20px 0' }} />

      {/* SECTION 1: LOCAL AI ENGINE */}
      <section style={{ marginBottom: '40px', background: '#f4f4f9', padding: '20px', borderRadius: '8px', border: '1px solid #ddd' }}>
        <h2>🤖 Local AI Assistant ($0.00 Server Costs)</h2>
        <p><strong>Status:</strong> <span style={{ color: '#0056b3' }}>{aiStatus}</span></p>
        
        {aiStatus === 'Not Initialized' && (
          <button onClick={initAI} style={{ padding: '10px 20px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            Initialize Local AI Model (WebGPU)
          </button>
        )}

        {(aiStatus === 'Model Ready!' || engine) && (
          <form onSubmit={handleAiChat} style={{ marginTop: '15px' }}>
            <input
              type="text"
              placeholder="Ask the AI helper a safety question..."
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              style={{ width: '78%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <button type="submit" style={{ width: '18%', marginLeft: '2%', padding: '10px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
              Ask
            </button>
          </form>
        )}

        {aiResponse && (
          <div style={{ marginTop: '15px', background: '#fff', padding: '15px', borderRadius: '4px', border: '1px solid #ddd' }}>
            <strong>Response:</strong>
            <p style={{ whiteSpace: 'pre-wrap', margin: '5px 0 0 0', lineHeight: '1.5' }}>{aiResponse}</p>
          </div>
        )}
      </section>

      {/* SECTION 2: KNOWLEDGE BASE SEARCH */}
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
              <div key={index} style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: index !== searchResults.length - 1 ? '1px solid #eee' : 'none' }}>
                <h3 style={{ margin: '0 0 5px 0', color: '#0056b3' }}>{med.generic_name} ({med.brand_names?.join(', ')})</h3>
                <p><strong>Category:</strong> {med.category}</p>
                <p><strong>Standard Dosage:</strong> {med.standard_dosage}</p>
                <p><strong>Major Interactions:</strong> {med.major_interactions?.join(', ')}</p>
                <span style={{ display: 'block', background: '#fff0f0', color: '#c00', padding: '8px', borderRadius: '4px', fontSize: '14px', fontWeight: 'bold' }}>
                  ⚠️ Black Box Warning: {med.black_box_warning}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SECTION 3: LOCAL INVENTORY */}
      <section>
        <h2>📦 Local Inventory Management ($0.00 Database)</h2>
        
        <form onSubmit={handleAddInventory} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          <input
            type="text"
            placeholder="Medication Name"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            style={{ flex: 2, padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
          <input
            type="number"
            placeholder="Stock Qty"
            value={newItemStock}
            onChange={(e) => setNewItemStock(e.target.value)}
            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
          <button type="submit" style={{ padding: '8px 15px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Add Item
          </button>
        </form>

        {inventory.length === 0 ? (
          <p style={{ color: '#888', fontStyle: 'italic' }}>No items currently in stock.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '10px' }}>Medication</th>
                <th style={{ padding: '10px' }}>Stock Quantity</th>
                <th style={{ padding: '10px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '10px' }}>{item.name}</td>
                  <td style={{ padding: '10px' }}>{item.stock} units</td>
                  <td style={{ padding: '10px' }}>
                    <button 
                      onClick={() => handleRemoveInventory(item.id)}
                      style={{ padding: '4px 8px', background: '#dc3545', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}