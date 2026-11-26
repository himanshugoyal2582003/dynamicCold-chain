export interface PdfTruckRow {
  id: string;
  plate_number: string;
  type?: string;
  owner_id?: string;
  owner_name?: string;
  driver_name?: string;
  base_insurance_price?: number | string;
  current_insurance_price?: number | string;
  insurance_risk_score?: number | string;
  insurance_status?: string;
  target_temp_c?: number | string;
}

export interface PdfLstmLogRow {
  id?: string;
  truck_id?: string;
  plate_number?: string;
  owner_name?: string;
  temperature?: number | string;
  target_temp?: number | string;
  humidity?: number | string;
  spoilage_risk?: number | string;
  spoilage_risk_level?: string;
  rsl_hours?: number | string;
  good_env_rsl_hours?: number | string;
  bad_env_rsl_hours?: number | string;
  predicted_insurance_price?: number | string;
  truck_current_price?: number | string;
  model_type?: string;
  recorded_at?: string;
  created_at?: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(v: unknown, fallback = 450): string {
  const n = Number(v);
  return Number.isFinite(n) ? `₹${n.toFixed(2)}` : `₹${fallback.toFixed(2)}`;
}

function formatTime(v?: string): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? escapeHtml(v) : d.toLocaleString();
}

export function openColdChainPdfReport(options: {
  title: string;
  subtitle: string;
  trucks: PdfTruckRow[];
  logs: PdfLstmLogRow[];
  groupByCompany?: boolean;
}) {
  if (typeof window === 'undefined') return;

  const { title, subtitle, trucks, logs, groupByCompany = false } = options;
  const generatedAt = new Date().toLocaleString();

  const avgBase = trucks.length
    ? trucks.reduce((s, t) => s + (Number(t.base_insurance_price) || 450), 0) / trucks.length
    : 0;
  const avgPred = trucks.length
    ? trucks.reduce((s, t) => s + (Number(t.current_insurance_price) || 450), 0) / trucks.length
    : 0;

  const renderTruckRows = (list: PdfTruckRow[]) =>
    list
      .map((t) => {
        const base = Number(t.base_insurance_price) || 450;
        const curr = Number(t.current_insurance_price) || 450;
        const diff = curr - base;
        return `
          <tr>
            <td><strong>${escapeHtml(t.plate_number)}</strong></td>
            <td>${escapeHtml(t.type || 'Cold Reefer')}</td>
            <td>${escapeHtml(t.owner_name || '—')}</td>
            <td>${escapeHtml(t.driver_name || 'Unassigned')}</td>
            <td>${formatMoney(base)}/mo</td>
            <td><strong>${formatMoney(curr)}/mo</strong> (${diff >= 0 ? '+' : ''}${diff.toFixed(2)})</td>
            <td>${Number(t.insurance_risk_score || 15).toFixed(1)} / 100</td>
            <td>${escapeHtml((t.insurance_status || 'standard').toUpperCase())}</td>
          </tr>
        `;
      })
      .join('');

  let companySectionsHtml = '';
  if (groupByCompany) {
    const byOwner = new Map<string, PdfTruckRow[]>();
    for (const t of trucks) {
      const key = t.owner_name || 'Unassigned Company';
      if (!byOwner.has(key)) byOwner.set(key, []);
      byOwner.get(key)!.push(t);
    }

    companySectionsHtml = Array.from(byOwner.entries())
      .map(([company, compTrucks]) => {
        const compLogs = logs.filter((l) =>
          compTrucks.some((t) => t.id === l.truck_id || t.plate_number === l.plate_number),
        );
        return `
          <section class="section">
            <h2>Company: ${escapeHtml(company)} (${compTrucks.length} Truck${compTrucks.length === 1 ? '' : 's'})</h2>
            <table>
              <thead>
                <tr>
                  <th>Plate</th><th>Type</th><th>Company</th><th>Driver</th>
                  <th>Base Price</th><th>LSTM Predicted</th><th>Risk Score</th><th>Status</th>
                </tr>
              </thead>
              <tbody>${renderTruckRows(compTrucks)}</tbody>
            </table>
            ${
              compLogs.length
                ? `<p class="subhead">1-Minute LSTM Logs (${compLogs.length} records)</p>`
                : `<p class="muted">No 1-minute LSTM logs recorded for this company yet.</p>`
            }
          </section>
        `;
      })
      .join('');
  } else {
    companySectionsHtml = `
      <section class="section">
        <h2>Fleet Insurance Summary (${trucks.length} Truck${trucks.length === 1 ? '' : 's'})</h2>
        <table>
          <thead>
            <tr>
              <th>Plate</th><th>Type</th><th>Company</th><th>Driver</th>
              <th>Base Price</th><th>LSTM Predicted</th><th>Risk Score</th><th>Status</th>
            </tr>
          </thead>
          <tbody>${renderTruckRows(trucks)}</tbody>
        </table>
      </section>
    `;
  }

  const logRowsHtml = logs
    .slice(0, 120)
    .map(
      (r) => `
        <tr>
          <td>${formatTime(r.recorded_at || r.created_at)}</td>
          <td><strong>${escapeHtml(r.plate_number || '—')}</strong></td>
          <td>${escapeHtml(r.temperature ?? '—')}°C / ${escapeHtml(r.target_temp ?? '—')}°C</td>
          <td>${escapeHtml(r.humidity ?? '—')}%</td>
          <td>${escapeHtml(r.spoilage_risk_level || 'LOW')} (${escapeHtml(r.spoilage_risk ?? 0)})</td>
          <td class="good">${escapeHtml(r.good_env_rsl_hours ?? r.rsl_hours ?? '—')} hrs</td>
          <td class="bad">${escapeHtml(r.bad_env_rsl_hours ?? '—')} hrs</td>
          <td><strong>${formatMoney(r.predicted_insurance_price ?? r.truck_current_price ?? 450)}/mo</strong></td>
          <td>${escapeHtml(r.model_type || 'PyTorch-LSTM')}</td>
        </tr>
      `,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #14171C; margin: 0; padding: 16px; font-size: 11px; }
    .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #89671F; padding-bottom: 10px; margin-bottom: 14px; }
    .brand { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #89671F; font-weight: 700; }
    h1 { margin: 4px 0 2px; font-size: 20px; }
    .subtitle { color: #5B6470; font-size: 12px; margin: 0; }
    .meta { text-align: right; color: #5B6470; font-size: 10px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
    .kpi { border: 1px solid #E3E1DC; border-radius: 6px; padding: 10px; background: #F7F6F3; }
    .kpi-val { font-size: 16px; font-weight: 700; }
    .kpi-lbl { font-size: 10px; text-transform: uppercase; color: #5B6470; margin-top: 2px; }
    .section { margin-bottom: 18px; break-inside: avoid; }
    h2 { font-size: 13px; margin: 0 0 8px; color: #14171C; border-left: 3px solid #89671F; padding-left: 8px; }
    .subhead { font-size: 11px; font-weight: 600; color: #5B6470; margin: 8px 0 0; }
    .muted { color: #5B6470; font-style: italic; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th, td { border: 1px solid #E3E1DC; padding: 5px 7px; text-align: left; }
    th { background: #F7F6F3; font-size: 10px; text-transform: uppercase; color: #5B6470; }
    .good { color: #2E7D5B; font-weight: 600; }
    .bad { color: #A3262A; font-weight: 600; }
    @media print { .no-print { display: none; } body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">ColdChain Fleet Intelligence · Dual-LSTM Report</div>
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">${escapeHtml(subtitle)}</p>
    </div>
    <div class="meta">
      <div>Generated: ${escapeHtml(generatedAt)}</div>
      <button class="no-print" onclick="window.print()" style="margin-top:6px;padding:6px 12px;cursor:pointer;">Print / Save PDF</button>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="kpi-val">${trucks.length}</div><div class="kpi-lbl">Trucks Included</div></div>
    <div class="kpi"><div class="kpi-val">₹${avgBase.toFixed(2)}/mo</div><div class="kpi-lbl">Avg Base Price</div></div>
    <div class="kpi"><div class="kpi-val">₹${avgPred.toFixed(2)}/mo</div><div class="kpi-lbl">Avg LSTM Price</div></div>
    <div class="kpi"><div class="kpi-val">${logs.length}</div><div class="kpi-lbl">1-Min LSTM Records</div></div>
  </div>

  ${companySectionsHtml}

  <section class="section">
    <h2>1-Minute LSTM Spoilage (Good vs. Bad Env) & Insurance Predictions (${logs.length} Records)</h2>
    ${
      logs.length === 0
        ? '<p class="muted">No 1-minute LSTM logs recorded yet for this selection.</p>'
        : `<table>
            <thead>
              <tr>
                <th>Recorded At</th><th>Truck</th><th>Temp / Target</th><th>Humidity</th>
                <th>Spoilage Risk</th><th>Good Env RSL</th><th>Bad Env RSL</th><th>LSTM Insurance</th><th>Model</th>
              </tr>
            </thead>
            <tbody>${logRowsHtml}</tbody>
          </table>`
    }
  </section>
  <script>
    setTimeout(() => { window.print(); }, 300);
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=1120,height=780');
  if (!win) {
    window.print();
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
