import React, { useEffect, useState, useRef } from 'react';
import { Peer } from 'peerjs';
import { QRCodeSVG } from 'qrcode.react';

export function SyncModule({ onImageReceived, onRemotePrintTriggered }) {
  const [peerId, setPeerId] = useState('');
  const [targetPeerId, setTargetPeerId] = useState('');
  const [connection, setConnection] = useState(null);
  const [connStatus, setConnStatus] = useState('Disconnected');
  const [isMobile, setIsMobile] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  
  const fileInputRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerInstanceRef = useRef(null);

  useEffect(() => {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const mobileCheck = /android|iphone|ipad|ipod/i.test(userAgent.toLowerCase());
    setIsMobile(mobileCheck);

    const newPeer = new Peer();
    peerInstanceRef.current = newPeer;

    newPeer.on('open', (id) => {
      setPeerId(id);
      setConnStatus('Ready to pair. Scan QR or enter ID.');
      
      const urlParams = new URLSearchParams(window.location.search);
      const pairId = urlParams.get('pair');
      if (pairId && mobileCheck) {
        connectToPeer(pairId, newPeer);
      }
    });

    newPeer.on('connection', (conn) => {
      setupConnectionListeners(conn);
    });

    // Mobile Side: Handle incoming screen stream from Desktop
    newPeer.on('call', (call) => {
      call.answer(); 
      call.on('stream', (remoteStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      });
    });

    return () => newPeer.destroy();
  }, []);

  const setupConnectionListeners = (conn) => {
    setConnection(conn);
    setConnStatus('Connected securely P2P!');

    conn.on('data', (data) => {
      if (data.type === 'PRESCRIPTION_IMAGE') {
        const blob = new Blob([data.file], { type: data.fileType });
        const imageUrl = URL.createObjectURL(blob);
        onImageReceived(imageUrl);
      }
      if (data.type === 'REMOTE_PRINT_CMD') {
        onRemotePrintTriggered(data.labelId);
      }
      if (data.type === 'REMOTE_INPUT_CLICK') {
        const targetX = window.innerWidth * data.xPercent;
        const targetY = window.innerHeight * data.yPercent;
        const elementAtPoint = document.elementFromPoint(targetX, targetY);
        
        if (elementAtPoint) {
          elementAtPoint.click();
          if (elementAtPoint.tagName === 'INPUT' || elementAtPoint.tagName === 'TEXTAREA') {
            elementAtPoint.focus();
          }
        }
      }
    });

    conn.on('close', () => setConnStatus('Disconnected'));
  };

  const connectToPeer = (idToConnect = targetPeerId, peerInstance = null) => {
    setConnStatus('Connecting...');
    const activePeer = peerInstance || peerInstanceRef.current;
    const conn = activePeer.connect(idToConnect);
    setupConnectionListeners(conn);
  };

  const handleMobileCameraCapture = (e) => {
    const file = e.target.files[0];
    if (!file || !connection) return;

    const reader = new FileReader();
    reader.onload = () => {
      connection.send({
        type: 'PRESCRIPTION_IMAGE',
        file: reader.result,
        fileType: file.type
      });
      alert("Image pushed to desktop workspace!");
    };
    reader.readAsArrayBuffer(file);
  };

  // Desktop Side: Broadcast browser window
  const startLiveScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false
      });
      
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setIsStreaming(true);

      if (connection && peerInstanceRef.current) {
        peerInstanceRef.current.call(connection.peer, stream);
      }
    } catch (err) {
      console.error("Screen share fail: ", err);
    }
  };

  const handleTouchOverlayClick = (e) => {
    if (!connection || !remoteVideoRef.current) return;

    const rect = remoteVideoRef.current.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;

    connection.send({
      type: 'REMOTE_INPUT_CLICK',
      xPercent: clickX,
      yPercent: clickY
    });
  };

  const pairingUrl = `${window.location.origin}${window.location.pathname}?pair=${peerId}`;

  return (
    <div style={{ background: '#eef2f7', padding: '15px', borderRadius: '6px', marginBottom: '25px', border: '1px solid #bcccdc' }}>
      <h4>🔗 P2P Link & Remote Mirror Dashboard ({isMobile ? "Mobile Control Terminal" : "Desktop Base Station"})</h4>
      <p style={{ fontSize: '13px' }}>Link Status: <span style={{ color: connection ? 'green' : 'orange', fontWeight: 'bold' }}>{connStatus}</span></p>

      {!isMobile ? (
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: '12px', margin: '0 0 5px 0' }}>Scan to connect mobile camera/remote viewer instantly:</p>
            {peerId ? <QRCodeSVG value={pairingUrl} size={100} /> : 'Generating ID...'}
          </div>
          <div>
            <small>ID: <code>{peerId}</code></small>
            <div style={{ marginTop: '10px' }}>
              <button type="button" onClick={startLiveScreenShare} style={{ background: '#e50914', color: '#fff', padding: '6px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                {isStreaming ? "🔴 Screen Casting Active" : "📡 Share Desktop Screen with Phone"}
              </button>
              <video ref={localVideoRef} autoPlay playsInline muted style={{ display: 'none' }} />
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '10px' }}>
          {!connection && (
            <div style={{ display: 'flex', gap: '5px' }}>
              <input type="text" placeholder="Paste Desktop ID" value={targetPeerId} onChange={e => setTargetPeerId(e.target.value)} style={{ padding: '8px', flex: 1 }} />
              <button type="button" onClick={() => connectToPeer()} style={{ padding: '8px', background: '#0070f3', color: 'white', border: 'none' }}>Connect</button>
            </div>
          )}

          {connection && (
            <div style={{ background: '#fff', padding: '10px', borderRadius: '4px' }}>
              <button type="button" onClick={() => fileInputRef.current.click()} style={{ padding: '12px', width: '100%', background: '#28a745', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>
                📸 Snap & Upload Prescription to Desktop
              </button>
              <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handleMobileCameraCapture} style={{ display: 'none' }} />
              
              <div style={{ marginTop: '15px' }}>
                <small style={{ color: '#666' }}>Tap inside the live window frame below to issue remote mouse clicks to the PC:</small>
                <div onClick={handleTouchOverlayClick} style={{ position: 'relative', marginTop: '5px', border: '2px solid #0070f3', background: '#000' }}>
                  <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', display: 'block' }} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}