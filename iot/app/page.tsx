'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { IoTDevice, PRODUCT_OPTIONS } from '@/lib/device-data';

export default function IoTPortalPage() {
  const [devices, setDevices] = useState<IoTDevice[]>([]);
  const [summary, setSummary] = useState<any>({ totalDevices: 0, onlineCount: 0, warningCount: 0, avgTemp: '0.0' });
  const [loading, setLoading] = useState(true);
  const [autoStream, setAutoStream] = useState(true);
  const [streamIntervalMs, setStreamIntervalMs] = useState(4000);
  const [logs, setLogs] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // New device form modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newProduct, setNewProduct] = useState(PRODUCT_OPTIONS[0].name);
  const [newTargetTemp, setNewTargetTemp] = useState(3.5);

  const autoStreamRef = useRef(autoStream);
  autoStreamRef.current = autoStream;

  const appendLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 49)]);
  };

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/devices');
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices || []);
        if (data.summary) setSummary(data.summary);
      }
    } catch (e: any) {
      appendLog(`Fetch error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // Handle single device stream
  const handleStreamDevice = async (deviceId: string) => {
    try {
      const res = await fetch('/api/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      const data = await res.json();
      if (data.success && data.device) {
        setDevices((current) => current.map((d) => (d.id === deviceId ? data.device : d)));
        const resObj = data.result?.enrichedResult;
        const delivery = data.result?.deliveryStatus;
        const label = delivery === 'accepted_by_outbox' ? 'AI/ML outbox accepted' :
          delivery === 'unconfirmed' ? 'AI/ML prediction received, downstream delivery unconfirmed' : 'Local estimate';
        appendLog(`${data.device.connectionNumber} · ${label} · Risk ${resObj?.spoilage_risk ?? 'unavailable'}`);
      }
    } catch (e: any) {
      appendLog(`Stream error for ${deviceId}: ${e.message}`);
    }
  };

  // Broadcast all online devices
  const handleBroadcastAll = async () => {
    try {
      const res = await fetch('/api/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success && data.devices) {
        setDevices(data.devices);
        const accepted = (data.results ?? []).filter((result: { deliveryStatus?: string }) => result.deliveryStatus === 'accepted_by_outbox').length;
        appendLog(`Processed ${data.processedCount || 0} devices · ${accepted} accepted by the durable outbox`);
      }
    } catch (e: any) {
      appendLog(`Broadcast error: ${e.message}`);
    }
  };

  // Auto-stream loop
  useEffect(() => {
    if (!autoStream) return;
    const interval = setInterval(() => {
      if (autoStreamRef.current) {
        handleBroadcastAll();
      }
    }, streamIntervalMs);
    return () => clearInterval(interval);
  }, [autoStream, streamIntervalMs]);

  // Power toggle
  const togglePower = async (device: IoTDevice) => {
    const nextState = !device.powerOn;
    try {
      const res = await fetch('/api/devices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: device.id, powerOn: nextState }),
      });
      const data = await res.json();
      if (data.success && data.device) {
        setDevices((current) => current.map((d) => (d.id === device.id ? data.device : d)));
        appendLog(
          nextState
            ? `🟢 Device ${device.name} [${device.connectionNumber}] POWERED ON (Connection ready)`
            : `🔴 Device ${device.name} [${device.connectionNumber}] POWERED OFF`,
        );
      }
    } catch (e: any) {
      appendLog(`Power toggle error: ${e.message}`);
    }
  };

  // Anomaly trigger
  const setAnomaly = async (deviceId: string, anomaly: string) => {
    try {
      const res = await fetch('/api/devices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deviceId, anomaly }),
      });
      const data = await res.json();
      if (data.success && data.device) {
        setDevices((current) => current.map((d) => (d.id === deviceId ? data.device : d)));
        appendLog(`⚡ Device ${data.device.connectionNumber} anomaly set to "${anomaly}"`);
        // Immediately stream to reflect change in AI/ML
        handleStreamDevice(deviceId);
      }
    } catch (e: any) {
      appendLog(`Anomaly trigger error: ${e.message}`);
    }
  };

  // Add device
  const handleAddDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName || undefined,
          productType: newProduct,
          targetTemp: Number(newTargetTemp),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setDevices(data.devices);
        setShowAddModal(false);
        setNewName('');
        appendLog(`✨ Added new device ${data.device.name} with code [${data.device.connectionNumber}]`);
      }
    } catch (e: any) {
      appendLog(`Add device error: ${e.message}`);
    }
  };

  // Adjust device count
  const handleSetCount = async (count: number) => {
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_count', count }),
      });
      const data = await res.json();
      if (data.success) {
        setDevices(data.devices);
        appendLog(`Adjusted fleet size to ${count} devices.`);
      }
    } catch (e: any) {
      appendLog(`Set count error: ${e.message}`);
    }
  };

  // Reset demo
  const handleResetDemo = async () => {
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_demo' }),
      });
      const data = await res.json();
      if (data.success) {
        setDevices(data.devices);
        appendLog('Reset to default demo IoT devices.');
      }
    } catch (e: any) {
      appendLog(`Reset error: ${e.message}`);
    }
  };

  // Copy connection code
  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(code);
    setTimeout(() => setCopiedId(null), 2000);
    appendLog(`📋 Copied connection code "${code}" to clipboard!`);
  };

  return (
    <main className="dashboard-shell">
      {/* Top Bar */}
      <div className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>ColdChain IoT Hardware Simulator & Gateway</span>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className={`secondary-button ${autoStream ? 'active' : ''}`}
            onClick={() => setAutoStream(!autoStream)}
            style={{
              background: autoStream ? 'rgba(52, 211, 153, 0.2)' : undefined,
              borderColor: autoStream ? '#34d399' : undefined,
              color: autoStream ? '#34d399' : undefined,
            }}
          >
            {autoStream ? '🟢 Auto-Streaming (Active)' : '▶ Start Auto-Stream'}
          </button>
          <button className="primary-button" onClick={handleBroadcastAll}>
            📡 Broadcast All
          </button>
          <button className="secondary-button" onClick={handleResetDemo}>
            Reset
          </button>
        </div>
      </div>

      {/* Architecture Pipeline Banner */}
      <div className="pipeline-banner">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>
            Real-Time Data Pipeline Architecture
          </span>
          <div className="pipeline-steps">
            <span className="step-node">📡 IoT Layer (Simulated Devices)</span>
            <span className="step-arrow">➔</span>
            <span className="step-node" style={{ borderColor: '#7dd3fc', color: '#7dd3fc' }}>
              🤖 AI/ML Prediction (FastAPI :8000)
            </span>
            <span className="step-arrow">➔</span>
            <span className="step-node" style={{ borderColor: '#34d399', color: '#34d399' }}>
              ⚙️ Fleet Backend Ingest (NestJS :4000)
            </span>
            <span className="step-arrow">➔</span>
            <span className="step-node" style={{ borderColor: '#fbbf24', color: '#fbbf24' }}>
              📱 Driver & Fleet Dashboard (Next.js :3000)
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="primary-button" onClick={() => setShowAddModal(true)} style={{ fontSize: 13, padding: '7px 14px' }}>
            + Add Device
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
            <span>Devices:</span>
            {[2, 4, 6, 8].map((n) => (
              <button
                key={n}
                onClick={() => handleSetCount(n)}
                className="copy-btn"
                style={{ fontWeight: devices.length === n ? 700 : 400 }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Metric Tiles */}
      <section className="portal-grid">
        <div className="card">
          <h2>Fleet Devices</h2>
          <div className="metric-row">
            <span className="muted">Total configured</span>
            <span className="metric-value">{devices.length}</span>
          </div>
          <div className="metric-row">
            <span className="muted">Broadcasting online</span>
            <span className="metric-value" style={{ color: '#34d399' }}>
              {devices.filter((d) => d.powerOn).length}
            </span>
          </div>
        </div>

        <div className="card">
          <h2>Sensors & Health</h2>
          <div className="metric-row">
            <span className="muted">Warnings / Excursions</span>
            <span
              className="metric-value"
              style={{
                color: devices.some((d) => d.status === 'warning') ? '#fbbf24' : '#34d399',
              }}
            >
              {devices.filter((d) => d.status === 'warning').length}
            </span>
          </div>
          <div className="metric-row">
            <span className="muted">Average temp</span>
            <span className="metric-value">
              {devices.length
                ? (devices.reduce((acc, d) => acc + d.temp, 0) / devices.length).toFixed(1)
                : summary.avgTemp}
              °C
            </span>
          </div>
        </div>

        <div className="card">
          <h2>Gateway Pipeline</h2>
          <div className="metric-row">
            <span className="muted">AI Service Status</span>
            <span className="status-pill status-live">Active (:8000)</span>
          </div>
          <div className="metric-row">
            <span className="muted">Backend Ingest</span>
            <span className="status-pill status-on">Ready (:4000)</span>
          </div>
        </div>
      </section>

      {/* Multi-Device Cards Grid */}
      <section className="device-grid">
        {devices.map((device) => {
          const tempDeviation = Math.abs(device.temp - device.targetTemp);
          const isWarning = tempDeviation > 2.0 || device.doorOpen;
          const isCritical = tempDeviation > 6.0;

          return (
            <div key={device.id} className="device-card" style={{ opacity: device.powerOn ? 1 : 0.65 }}>
              {/* Header */}
              <div className="device-card-header">
                <div>
                  <h3 style={{ fontSize: 16, margin: 0, color: '#edf6ff' }}>{device.name}</h3>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    {device.productType}
                  </div>
                </div>

                <button
                  className="toggle"
                  onClick={() => togglePower(device)}
                  style={{
                    fontSize: 12,
                    padding: '6px 12px',
                    borderColor: device.powerOn ? '#34d399' : '#f87171',
                    color: device.powerOn ? '#34d399' : '#f87171',
                  }}
                >
                  {device.powerOn ? '⚡ Power ON' : '⭕ Power OFF'}
                </button>
              </div>

              {/* Connection Number Banner */}
              {device.powerOn ? (
                <div
                  style={{
                    background: 'rgba(52, 211, 153, 0.08)',
                    border: '1px solid rgba(52, 211, 153, 0.3)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9bb0c4' }}>
                      Connection Number (Pair with Truck)
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#34d399', fontFamily: 'monospace' }}>
                      {device.connectionNumber}
                    </div>
                  </div>
                  <button className="copy-btn" onClick={() => copyCode(device.connectionNumber)}>
                    {copiedId === device.connectionNumber ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    background: 'rgba(248, 113, 113, 0.08)',
                    border: '1px solid rgba(248, 113, 113, 0.2)',
                    borderRadius: 10,
                    padding: '8px 12px',
                    fontSize: 12,
                    color: '#f87171',
                  }}
                >
                  Device powered off. Turn ON to broadcast connection number.
                </div>
              )}

              {/* Live Sensor Metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="sensor-stat">
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Temperature</span>
                  <span
                    className="sensor-val"
                    style={{
                      color: isCritical ? '#f87171' : isWarning ? '#fbbf24' : '#34d399',
                    }}
                  >
                    {device.temp.toFixed(1)}°C
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>Target: {device.targetTemp}°C</span>
                </div>

                <div className="sensor-stat">
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Humidity & Battery</span>
                  <span className="sensor-val">{device.humidity}%</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>🔋 {device.battery}%</span>
                </div>

                <div className="sensor-stat">
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Door Status</span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      marginTop: 4,
                      color: device.doorOpen ? '#f87171' : '#34d399',
                    }}
                  >
                    {device.doorOpen ? '🚨 OPEN' : '🔒 Closed'}
                  </span>
                </div>

                <div className="sensor-stat">
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>GPS / Speed</span>
                  <span style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: '#edf6ff' }}>
                    {device.gps.speed_kmh} km/h
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {device.gps.lat.toFixed(2)}N, {device.gps.lng.toFixed(2)}E
                  </span>
                </div>
              </div>

              {/* Anomaly Stress Testing Controls */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Inject Condition / Anomaly:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { key: 'normal', label: 'Normal' },
                    { key: 'temp_spike', label: '🌡️ Spike (+8°C)' },
                    { key: 'door_open', label: '🚪 Door Open' },
                    { key: 'compressor_failure', label: '⚠️ Fail (+18°C)' },
                    { key: 'rapid_defrost', label: '❄️ Defrost' },
                  ].map((a) => (
                    <button
                      key={a.key}
                      className={`anomaly-pill ${device.anomaly === a.key ? 'active' : ''}`}
                      onClick={() => setAnomaly(device.id, a.key)}
                      disabled={!device.powerOn}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI/ML Pipeline Feedback Box */}
              {device.lastPipelineResult && (
                <div className="ai-feedback-box">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: '#7dd3fc', fontWeight: 600 }}>🤖 AI Spoilage & RSL Feedback</span>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 700,
                        background:
                          device.lastPipelineResult.spoilageRiskLevel === 'CRITICAL'
                            ? 'rgba(248, 113, 113, 0.2)'
                            : device.lastPipelineResult.spoilageRiskLevel === 'HIGH'
                            ? 'rgba(251, 191, 36, 0.2)'
                            : 'rgba(52, 211, 153, 0.2)',
                        color:
                          device.lastPipelineResult.spoilageRiskLevel === 'CRITICAL'
                            ? '#f87171'
                            : device.lastPipelineResult.spoilageRiskLevel === 'HIGH'
                            ? '#fbbf24'
                            : '#34d399',
                      }}
                    >
                      RISK: {device.lastPipelineResult.spoilageRiskLevel} ({device.lastPipelineResult.spoilageRisk})
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#edf6ff', fontSize: 12 }}>
                    <span>Remaining Shelf Life:</span>
                    <strong>{device.lastPipelineResult.rslHours} hrs</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#edf6ff', fontSize: 12, marginTop: 2 }}>
                    <span>Quality Retention:</span>
                    <strong>{device.lastPipelineResult.qualityRetentionPct}%</strong>
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      padding: '6px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      background: device.lastPipelineResult.rerouteSuggested
                        ? 'rgba(248, 113, 113, 0.15)'
                        : 'rgba(52, 211, 153, 0.1)',
                      color: device.lastPipelineResult.rerouteSuggested ? '#fca5a5' : '#a7f3d0',
                    }}
                  >
                    {device.lastPipelineResult.routeRecommendation}
                  </div>
                </div>
              )}

              {/* Single device action */}
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button
                  className="secondary-button"
                  style={{ flex: 1, fontSize: 12, padding: '8px' }}
                  onClick={() => handleStreamDevice(device.id)}
                  disabled={!device.powerOn}
                >
                  📡 Emit Telemetry Step
                </button>
              </div>
            </div>
          );
        })}
      </section>

      {/* Real-Time Pipeline Event Log */}
      <section className="console-box">
        <div style={{ color: '#7dd3fc', fontWeight: 700, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
          <span>LIVE PIPELINE INGESTION CONSOLE</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>Auto-updates on telemetry stream</span>
        </div>
        {logs.length === 0 ? (
          <div style={{ color: 'var(--muted)' }}>Waiting for telemetry transmissions… Click "Broadcast All" or turn on Auto-Stream.</div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} style={{ lineHeight: 1.5 }}>
              {log}
            </div>
          ))
        )}
      </section>

      {/* Add Device Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 20,
          }}
        >
          <div className="card" style={{ maxWidth: 460, width: '100%', background: '#101f2d' }}>
            <h3 style={{ fontSize: 18, marginBottom: 16 }}>Add New Simulated IoT Device</h3>
            <form onSubmit={handleAddDevice} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                  Device Name / Driver Tag
                </label>
                <input
                  type="text"
                  placeholder="e.g. ESP32 Unit #5 (Driver E)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    background: '#07131f',
                    border: '1px solid var(--border)',
                    color: '#edf6ff',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                  Cargo / Product Type
                </label>
                <select
                  value={newProduct}
                  onChange={(e) => {
                    setNewProduct(e.target.value);
                    const found = PRODUCT_OPTIONS.find((p) => p.name === e.target.value);
                    if (found) setNewTargetTemp(found.targetTemp);
                  }}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    background: '#07131f',
                    border: '1px solid var(--border)',
                    color: '#edf6ff',
                  }}
                >
                  {PRODUCT_OPTIONS.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.targetTemp}°C)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                  Target Temperature (°C)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={newTargetTemp}
                  onChange={(e) => setNewTargetTemp(parseFloat(e.target.value))}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    background: '#07131f',
                    border: '1px solid var(--border)',
                    color: '#edf6ff',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="secondary-button" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button">
                  Create Device
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
