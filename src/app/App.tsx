import React, { useState } from 'react';

export const App: React.FC = () => {
  const [status] = useState('4DV Player initialized');

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100vw',
      height: '100vh',
      backgroundColor: '#0d0f14',
      color: '#e2e8f0',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      {/* Header */}
      <header style={{
        height: '48px',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #1e293b',
        backgroundColor: '#0f172a'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: '#38bdf8'
          }} />
          <span style={{ fontWeight: 600, fontSize: '14px', letterSpacing: '0.05em' }}>
            4DV PLAYER <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 400 }}>v0.1.0</span>
          </span>
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8' }}>
          {status}
        </div>
      </header>

      {/* Main Viewport Container */}
      <main style={{
        flex: 1,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#05070a'
      }}>
        <div style={{
          textAlign: 'center',
          padding: '24px',
          border: '1px dashed #334155',
          borderRadius: '8px',
          color: '#64748b'
        }}>
          <p style={{ fontSize: '14px', marginBottom: '8px' }}>WebGL2 Viewport Ready</p>
          <p style={{ fontSize: '12px' }}>Phase 1 Setup Completed — Ready for WebGL2 Renderer (Phase 2)</p>
        </div>
      </main>

      {/* Status Footer */}
      <footer style={{
        height: '32px',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTop: '1px solid #1e293b',
        backgroundColor: '#0f172a',
        fontSize: '11px',
        color: '#64748b'
      }}>
        <div>Camera: 6-DoF Standby</div>
        <div>Scene: Not Loaded</div>
        <div>Renderer: WebGL2 (Pending Init)</div>
      </footer>
    </div>
  );
};
