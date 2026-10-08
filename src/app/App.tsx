import React, { useEffect, useRef, useState } from 'react';
import { WebGLRenderer, GaussianRenderStats } from '../renderer';
import { generateProceduralGaussianScene } from '../demo';

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);

  const [webglStatus, setWebglStatus] = useState<'INITIALIZING' | 'READY' | 'ERROR'>('INITIALIZING');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stats, setStats] = useState<GaussianRenderStats>({
    fps: 0,
    frameTimeMs: 0,
    gaussianCount: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  });

  const [autoRotate, setAutoRotate] = useState<boolean>(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      // Initialize our custom WebGL2 Renderer
      const renderer = new WebGLRenderer(canvas, (newStats) => {
        setStats(newStats);
      });
      rendererRef.current = renderer;

      // Generate procedural 3D Gaussian scene (600 Gaussians)
      const sceneGaussians = generateProceduralGaussianScene(600);
      renderer.setGaussians(sceneGaussians);
      renderer.start();

      setWebglStatus('READY');
    } catch (err) {
      console.error('[App] WebGL2 Initialization Failed:', err);
      setWebglStatus('ERROR');
      setErrorMessage(err instanceof Error ? err.message : 'Unknown WebGL2 error');
    }

    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, []);

  const toggleAutoRotate = () => {
    if (rendererRef.current) {
      const next = !autoRotate;
      rendererRef.current.setAutoRotate(next);
      setAutoRotate(next);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100vw',
      height: '100vh',
      backgroundColor: '#0a0d14',
      color: '#e2e8f0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflow: 'hidden',
      userSelect: 'none'
    }}>
      {/* Top Navigation Bar */}
      <header style={{
        height: '46px',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(8px)',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '9px',
            height: '9px',
            borderRadius: '50%',
            backgroundColor: webglStatus === 'READY' ? '#10b981' : webglStatus === 'ERROR' ? '#ef4444' : '#f59e0b',
            boxShadow: webglStatus === 'READY' ? '0 0 8px #10b981' : 'none'
          }} />
          <span style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '0.08em', color: '#f8fafc' }}>
            4DV PLAYER <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 500, marginLeft: '4px' }}>PHASE 2</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px' }}>
          <button
            onClick={toggleAutoRotate}
            style={{
              background: autoRotate ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${autoRotate ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
              color: autoRotate ? '#38bdf8' : '#94a3b8',
              padding: '4px 10px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 500
            }}
          >
            {autoRotate ? 'Orbit: Active' : 'Orbit: Paused'}
          </button>
          <div style={{
            padding: '3px 8px',
            borderRadius: '4px',
            backgroundColor: webglStatus === 'READY' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            color: webglStatus === 'READY' ? '#34d399' : '#f87171',
            fontWeight: 600,
            fontSize: '11px'
          }}>
            WebGL2: {webglStatus}
          </div>
        </div>
      </header>

      {/* Main Viewport */}
      <main style={{
        flex: 1,
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#04060a'
      }}>
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block'
          }}
        />

        {/* On-Screen HUD Overlay */}
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          padding: '10px 14px',
          borderRadius: '6px',
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          fontSize: '12px',
          lineHeight: '1.6',
          color: '#cbd5e1',
          pointerEvents: 'none'
        }}>
          <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '2px', fontSize: '11px', letterSpacing: '0.04em' }}>
            SCENE DIAGNOSTICS
          </div>
          <div>Gaussians: <span style={{ color: '#38bdf8', fontWeight: 600 }}>{stats.gaussianCount.toLocaleString()}</span></div>
          <div>FPS: <span style={{ color: stats.fps >= 50 ? '#34d399' : '#fbbf24', fontWeight: 600 }}>{stats.fps}</span> ({stats.frameTimeMs} ms)</div>
          <div>Viewport: <span style={{ color: '#94a3b8' }}>{stats.viewportWidth} × {stats.viewportHeight}</span></div>
        </div>

        {/* Error Fallback Banner */}
        {webglStatus === 'ERROR' && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '24px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '8px',
            color: '#fca5a5',
            textAlign: 'center',
            maxWidth: '450px'
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>WebGL2 Unavailable</h3>
            <p style={{ fontSize: '13px' }}>{errorMessage}</p>
          </div>
        )}
      </main>

      {/* Bottom Status Bar */}
      <footer style={{
        height: '30px',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        backgroundColor: '#0a0e1a',
        fontSize: '11px',
        color: '#64748b'
      }}>
        <div>Renderer: Custom WebGL2 Instanced Splatting</div>
        <div>Mode: Phase 2 Procedural 3D Verification</div>
        <div>Pipeline: GPU Instanced Quads + Radial Exponential Decay</div>
      </footer>
    </div>
  );
};
