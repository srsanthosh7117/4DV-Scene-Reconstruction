import React, { useEffect, useRef, useState, useMemo } from 'react';
import { WebGLRenderer, GaussianRenderStats } from '../renderer';
import { CameraTelemetry } from '../camera';
import { generateTemporalGaussianScene } from '../demo';
import { separateStaticDynamicGaussians, SeparationStats } from '../format';

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);

  const [webglStatus, setWebglStatus] = useState<'INITIALIZING' | 'READY' | 'ERROR'>('INITIALIZING');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Stats & Telemetry
  const [stats, setStats] = useState<GaussianRenderStats>({
    fps: 0,
    frameTimeMs: 0,
    gaussianCount: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    currentTime: 0,
    totalDuration: 5.0,
  });

  const [cameraTelemetry, setCameraTelemetry] = useState<CameraTelemetry>({
    position: [0, 1.2, 4.2],
    yawDeg: 0,
    pitchDeg: -5.7,
    fovDeg: 60,
    mode: 'FREE_FLIGHT',
  });

  // Temporal Playback State
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(5.0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [cameraMode, setCameraMode] = useState<'FREE_FLIGHT' | 'ORBIT'>('FREE_FLIGHT');

  // Static / Dynamic Separation Filter
  const [separationMode, setSeparationMode] = useState<'ALL' | 'STATIC_ONLY' | 'DYNAMIC_ONLY'>('ALL');
  const [separationStats, setSeparationStats] = useState<SeparationStats | null>(null);

  // Raw generated dataset
  const generatedData = useMemo(() => {
    return generateTemporalGaussianScene(1200, 5.0, 30);
  }, []);

  // Compute separation on dataset
  const separatedData = useMemo(() => {
    return separateStaticDynamicGaussians(generatedData.polynomials, 0.0001);
  }, [generatedData]);

  useEffect(() => {
    setSeparationStats(separatedData.stats);
  }, [separatedData]);

  // Handle active Gaussian dataset changes (ALL, STATIC_ONLY, DYNAMIC_ONLY)
  useEffect(() => {
    if (!rendererRef.current) return;

    let activeList = generatedData.polynomials;
    if (separationMode === 'STATIC_ONLY') {
      activeList = separatedData.staticGaussians;
    } else if (separationMode === 'DYNAMIC_ONLY') {
      activeList = separatedData.dynamicGaussians;
    }

    rendererRef.current.setGaussians4D(activeList, generatedData.scene.duration);
  }, [separationMode, generatedData, separatedData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const renderer = new WebGLRenderer(canvas, {
        onStats: (newStats) => setStats(newStats),
        onCameraTelemetry: (telemetry) => setCameraTelemetry(telemetry),
        onTimeUpdate: (t, dur) => {
          setCurrentTime(t);
          setDuration(dur);
        },
      });
      rendererRef.current = renderer;

      renderer.setGaussians4D(generatedData.polynomials, generatedData.scene.duration);
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
  }, [generatedData]);

  const handleTogglePlay = () => {
    if (rendererRef.current) {
      const next = !isPlaying;
      rendererRef.current.setPlaying(next);
      setIsPlaying(next);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (rendererRef.current) {
      rendererRef.current.setTime(val);
    }
  };

  const handleSpeedChange = (spd: number) => {
    setPlaybackSpeed(spd);
    if (rendererRef.current) {
      rendererRef.current.setSpeed(spd);
    }
  };

  const handleQuickSeekFraction = (fraction: number) => {
    const t = fraction * duration;
    setCurrentTime(t);
    if (rendererRef.current) {
      rendererRef.current.setTime(t);
    }
  };

  const handleModeChange = (mode: 'FREE_FLIGHT' | 'ORBIT') => {
    if (rendererRef.current) {
      rendererRef.current.cameraController.setMode(mode);
      setCameraMode(mode);
    }
  };

  const handleResetCamera = () => {
    if (rendererRef.current) {
      rendererRef.current.cameraController.reset([0, 1.2, 4.2], 0, -0.1);
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
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
            4DV PLAYER <span style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 600, marginLeft: '4px' }}>PHASE 5: STATIC/DYNAMIC SPLIT</span>
          </span>
        </div>

        {/* View Mode Filters & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Static / Dynamic Filter */}
          <div style={{
            display: 'flex',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '6px',
            padding: '2px',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <button
              onClick={() => setSeparationMode('ALL')}
              style={{
                background: separationMode === 'ALL' ? '#38bdf8' : 'transparent',
                border: 'none',
                color: separationMode === 'ALL' ? '#0f172a' : '#94a3b8',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: 600
              }}
            >
              All (1,200)
            </button>
            <button
              onClick={() => setSeparationMode('STATIC_ONLY')}
              style={{
                background: separationMode === 'STATIC_ONLY' ? '#38bdf8' : 'transparent',
                border: 'none',
                color: separationMode === 'STATIC_ONLY' ? '#0f172a' : '#94a3b8',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: 600
              }}
            >
              Static ({separationStats?.staticCount || 360})
            </button>
            <button
              onClick={() => setSeparationMode('DYNAMIC_ONLY')}
              style={{
                background: separationMode === 'DYNAMIC_ONLY' ? '#38bdf8' : 'transparent',
                border: 'none',
                color: separationMode === 'DYNAMIC_ONLY' ? '#0f172a' : '#94a3b8',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: 600
              }}
            >
              Dynamic ({separationStats?.dynamicCount || 840})
            </button>
          </div>

          {/* Camera Flight vs Orbit Mode */}
          <div style={{
            display: 'flex',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '6px',
            padding: '2px',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <button
              onClick={() => handleModeChange('FREE_FLIGHT')}
              style={{
                background: cameraMode === 'FREE_FLIGHT' ? '#0284c7' : 'transparent',
                border: 'none',
                color: cameraMode === 'FREE_FLIGHT' ? '#ffffff' : '#94a3b8',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: 600
              }}
            >
              6-DoF Flight
            </button>
            <button
              onClick={() => handleModeChange('ORBIT')}
              style={{
                background: cameraMode === 'ORBIT' ? '#0284c7' : 'transparent',
                border: 'none',
                color: cameraMode === 'ORBIT' ? '#ffffff' : '#94a3b8',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: 600
              }}
            >
              Orbit
            </button>
          </div>

          <button
            onClick={handleResetCamera}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#cbd5e1',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: 500
            }}
          >
            Reset Camera
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
        backgroundColor: '#04060a',
        cursor: cameraMode === 'FREE_FLIGHT' ? 'crosshair' : 'grab'
      }}>
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block'
          }}
        />

        {/* Diagnostics & Camera Telemetry Panel */}
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          pointerEvents: 'none'
        }}>
          {/* Scene Diagnostics */}
          <div style={{
            padding: '10px 14px',
            borderRadius: '6px',
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            fontSize: '11px',
            lineHeight: '1.6',
            color: '#cbd5e1',
            minWidth: '240px'
          }}>
            <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '2px', fontSize: '11px', letterSpacing: '0.04em' }}>
              SCENE & SEPARATION STATS
            </div>
            <div>Active Gaussians: <span style={{ color: '#38bdf8', fontWeight: 600 }}>{stats.gaussianCount.toLocaleString()}</span></div>
            <div>Static: <span style={{ color: '#94a3b8' }}>{separationStats?.staticCount} ({((separationStats?.staticRatio || 0) * 100).toFixed(0)}%)</span></div>
            <div>Dynamic: <span style={{ color: '#a78bfa' }}>{separationStats?.dynamicCount} ({((separationStats?.dynamicRatio || 0) * 100).toFixed(0)}%)</span></div>
            <div>Bandwidth Saved: <span style={{ color: '#34d399', fontWeight: 600 }}>{separationStats?.bandwidthSavedPercent}%</span></div>
            <div>FPS: <span style={{ color: stats.fps >= 50 ? '#34d399' : '#fbbf24', fontWeight: 600 }}>{stats.fps}</span> ({stats.frameTimeMs} ms)</div>
          </div>

          {/* Camera Telemetry */}
          <div style={{
            padding: '10px 14px',
            borderRadius: '6px',
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            fontSize: '11px',
            lineHeight: '1.6',
            color: '#cbd5e1',
            minWidth: '240px'
          }}>
            <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '2px', fontSize: '11px', letterSpacing: '0.04em' }}>
              CAMERA TELEMETRY
            </div>
            <div>Position: <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>
              [{cameraTelemetry.position[0].toFixed(2)}, {cameraTelemetry.position[1].toFixed(2)}, {cameraTelemetry.position[2].toFixed(2)}]
            </span></div>
            <div>Yaw: <span style={{ color: '#f1f5f9', fontFamily: 'monospace' }}>{cameraTelemetry.yawDeg}°</span> | Pitch: <span style={{ color: '#f1f5f9', fontFamily: 'monospace' }}>{cameraTelemetry.pitchDeg}°</span></div>
            <div>FOV: <span style={{ color: '#f1f5f9', fontFamily: 'monospace' }}>{cameraTelemetry.fovDeg}°</span></div>
            <div>Mode: <span style={{ color: '#a78bfa', fontWeight: 600 }}>{cameraTelemetry.mode}</span></div>
          </div>
        </div>

        {/* Controls Legend Overlay */}
        <div style={{
          position: 'absolute',
          bottom: '12px',
          left: '12px',
          padding: '8px 12px',
          borderRadius: '6px',
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          fontSize: '11px',
          color: '#94a3b8',
          pointerEvents: 'none',
          lineHeight: '1.5'
        }}>
          <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '2px' }}>Navigation</div>
          <div><kbd style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '3px', color: '#f8fafc' }}>WASD</kbd> Move &nbsp;|&nbsp; <kbd style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '3px', color: '#f8fafc' }}>QE</kbd> Elevation &nbsp;|&nbsp; <kbd style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '3px', color: '#f8fafc' }}>Shift</kbd> Sprint</div>
          <div><kbd style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '3px', color: '#f8fafc' }}>Mouse Drag</kbd> Look &nbsp;|&nbsp; <kbd style={{ background: '#1e293b', padding: '1px 4px', borderRadius: '3px', color: '#f8fafc' }}>Wheel</kbd> FOV Zoom</div>
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
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>WebGL2 Error</h3>
            <p style={{ fontSize: '13px' }}>{errorMessage || 'Unknown WebGL2 error'}</p>
          </div>
        )}
      </main>

      {/* 4D Temporal Playback HUD Bar */}
      <div style={{
        height: '64px',
        padding: '0 20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '6px',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        backgroundColor: '#0e1424',
        zIndex: 10
      }}>
        {/* Timeline Slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#38bdf8', minWidth: '60px' }}>
            {formatTime(currentTime)}
          </span>

          <input
            type="range"
            min="0"
            max={duration}
            step="0.01"
            value={currentTime}
            onChange={handleSeek}
            style={{
              flex: 1,
              accentColor: '#38bdf8',
              cursor: 'pointer',
              height: '5px',
            }}
          />

          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#94a3b8', minWidth: '60px', textAlign: 'right' }}>
            {formatTime(duration)}
          </span>
        </div>

        {/* Playback Controls & Speed & Discrete Verification Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleTogglePlay}
              style={{
                backgroundColor: isPlaying ? '#0284c7' : '#10b981',
                border: 'none',
                color: '#ffffff',
                padding: '4px 12px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>

            {/* Discrete Verification Jumps */}
            <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '6px' }}>Test Points:</span>
            {[0, 0.25, 0.5, 0.75, 1.0].map((frac) => (
              <button
                key={frac}
                onClick={() => handleQuickSeekFraction(frac)}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: Math.abs((currentTime / duration) - frac) < 0.04 ? '#38bdf8' : '#94a3b8',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  fontSize: '10px',
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                t={frac.toFixed(2)}
              </button>
            ))}
          </div>

          {/* Speed Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
            <span style={{ color: '#64748b', marginRight: '4px' }}>Speed:</span>
            {[0.25, 0.5, 1.0, 2.0].map((spd) => (
              <button
                key={spd}
                onClick={() => handleSpeedChange(spd)}
                style={{
                  backgroundColor: playbackSpeed === spd ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  border: `1px solid ${playbackSpeed === spd ? '#38bdf8' : 'rgba(255, 255, 255, 0.1)'}`,
                  color: playbackSpeed === spd ? '#38bdf8' : '#94a3b8',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  fontSize: '10px',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer Status Bar */}
      <footer style={{
        height: '24px',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTop: '1px solid rgba(255, 255, 255, 0.04)',
        backgroundColor: '#090d16',
        fontSize: '10px',
        color: '#64748b'
      }}>
        <div>Separation: Static (360 / 30%) + Dynamic (840 / 70%) Factorization</div>
        <div>Bandwidth Savings: {separationStats?.bandwidthSavedPercent}%</div>
        <div>6-DoF Navigation Active</div>
      </footer>
    </div>
  );
};
