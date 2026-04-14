/**
 * ui/charts.js — Tous les Graphiques (Chart.js)
 *
 * Responsabilités :
 *  - Instancier et mettre à jour tous les charts du dashboard
 *  - Charts de session (modale)
 *  - Gestion du thème (jour/nuit) sur les charts
 */

import { state }   from '../core/state.js';
import { Storage } from '../core/storage.js';
import { Carbon }  from '../modules/carbon.js';
import { AI }      from '../modules/ai.js';

// ──────────────────────────────────────────────────────────
//  REGISTRE DES INSTANCES (pour destroy propre)
// ──────────────────────────────────────────────────────────

const _instances = {};

function _destroy(id) {
  if (_instances[id]) { _instances[id].destroy(); delete _instances[id]; }
}

// ──────────────────────────────────────────────────────────
//  COULEURS & THÈME
// ──────────────────────────────────────────────────────────

const COLORS = {
  FR:          '#0057B8',
  ETR:         '#8B46C1',
  voitures:    '#0057B8',
  utilitaires: '#F5A623',
  motos:       '#D93025',
  camions:     '#8B46C1',
  camping:     '#2EAD4B',
  bus:         '#0597A7',
  engins:      '#795548',
  velos:       '#2EAD4B',
};

const LABELS = {
  FR:          '🇫🇷 FR',
  ETR:         '🌍 ETR',
  voitures:    '🚗 Voitures',
  utilitaires: '🚐 Utilitaires',
  motos:       '🏍️ Motos',
  camions:     '🚛 Camions',
  camping:     '🏕️ Camping',
  bus:         '🚌 Bus',
  engins:      '🚜 Engins',
  velos:       '🚲 Vélos',
};

function _gridColor() {
  return document.body.classList.contains('dark')
    ? 'rgba(255,255,255,0.07)'
    : 'rgba(0,0,0,0.07)';
}
function _textColor() {
  return document.body.classList.contains('dark') ? '#7A8899' : '#65676B';
}

function _baseScaleOptions() {
  return {
    grid: { color: _gridColor() },
    ticks: { color: _textColor(), font: { family: "'Barlow Condensed', sans-serif", size: 11 } },
  };
}

function _pluginOptions(title = '') {
  return {
    legend: {
      labels: { color: _textColor(), font: { family: "'Barlow Condensed', sans-serif", size: 11 }, boxWidth: 12 },
    },
    title: title ? { display: true, text: title, color: _textColor() } : { display: false },
    tooltip: {
      backgroundColor: document.body.classList.contains('dark') ? 'rgba(18,24,35,0.95)' : 'rgba(255,255,255,0.95)',
      titleColor: document.body.classList.contains('dark') ? '#E4ECF7' : '#1C1E21',
      bodyColor:  document.body.classList.contains('dark') ? '#7A8899'  : '#65676B',
      borderColor: document.body.classList.contains('dark') ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      borderWidth: 1,
    },
  };
}

function _makeChart(canvasId, config) {
  _destroy(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const chart = new Chart(canvas, config);
  _instances[canvasId] = chart;
  return chart;
}

// ──────────────────────────────────────────────────────────
//  API PUBLIQUE
// ──────────────────────────────────────────────────────────

export const Charts = {

  /**
   * Rendu principal du dashboard (camions ou véhicules)
   */
  renderDashboard(mode, sessions) {
    if (mode === 'trucks') {
      this._renderTrucksDashboard(sessions);
    } else if (mode === 'cars') {
      this._renderCarsDashboard(sessions);
    } else if (mode === 'env') {
      this._renderEnvDashboard();
    }
  },

  // ── Dashboard Camions ──────────────────────────────────────

  _renderTrucksDashboard(sessions) {
    const totals   = { FR: 0, ETR: 0 };
    const byHour   = Array(24).fill(0).map(() => ({ FR: 0, ETR: 0 }));
    const byDay    = Array(7).fill(0).map(() => ({ FR: 0, ETR: 0 }));
    const byMonth  = Array(12).fill(0).map(() => ({ FR: 0, ETR: 0 }));
    const aiScores = [];

    for (const s of sessions) {
      totals.FR  += s.FR  || 0;
      totals.ETR += s.ETR || 0;
      const d = new Date(s.date);
      (s.entries || []).forEach(e => {
        const eh = new Date(e.ts || s.date).getHours();
        if (e.type === 'FR')  { byHour[eh].FR++;  byDay[d.getDay()].FR++;  byMonth[d.getMonth()].FR++; }
        if (e.type === 'ETR') { byHour[eh].ETR++; byDay[d.getDay()].ETR++; byMonth[d.getMonth()].ETR++; }
      });
      if (s.aiScore != null) aiScores.push({ date: s.date, score: s.aiScore });
    }

    // Total bar
    _makeChart('dashboardMainChart', {
      type: 'bar',
      data: {
        labels: ['🇫🇷 FR', '🌍 ETR'],
        datasets: [{
          label: 'Camions',
          data: [totals.FR, totals.ETR],
          backgroundColor: [COLORS.FR, COLORS.ETR],
          borderRadius: 6,
        }],
      },
      options: { plugins: _pluginOptions(), scales: { x: _baseScaleOptions(), y: { ..._baseScaleOptions(), beginAtZero: true } }, responsive: true, maintainAspectRatio: false },
    });

    // Répartition 24h
    this._render24hChart('dashboard24hChart', byHour, ['FR', 'ETR']);

    // Hebdo
    this._renderWeeklyChart('weeklyChart', byDay, ['FR', 'ETR']);

    // Mensuel
    this._renderMonthlyChart('monthlyChart', byMonth, ['FR', 'ETR']);

    // IA évolution
    this._renderAiEvolutionChart(aiScores);

    // Séquences
    this._renderSequences(sessions, 'trucks');

    // Nationalité (si présent)
    const natContainer = document.getElementById('dash-nat-container');
    if (natContainer) natContainer.style.display = 'block';
    this._renderNatChart(totals);
  },

  // ── Dashboard Véhicules ────────────────────────────────────

  _renderCarsDashboard(sessions) {
    const CAR_TYPES = ['voitures','utilitaires','motos','camions','camping','bus','engins','velos'];
    const totals  = {};
    CAR_TYPES.forEach(t => totals[t] = 0);

    const byHour  = Array(24).fill(0).map(() => Object.fromEntries(CAR_TYPES.map(t => [t, 0])));
    const byDay   = Array(7).fill(0).map(()  => Object.fromEntries(CAR_TYPES.map(t => [t, 0])));
    const byMonth = Array(12).fill(0).map(() => Object.fromEntries(CAR_TYPES.map(t => [t, 0])));
    const byAlt   = { 'Plaine (<200m)': 0, 'Colline (200-800m)': 0, 'Montagne (>800m)': 0 };
    const byRoad  = { Autoroute: 0, 'Route Nationale': 0, 'Route Dept.': 0 };
    const aiScores = [];

    for (const s of sessions) {
      CAR_TYPES.forEach(t => { totals[t] += s[t] || 0; });
      const d = new Date(s.date);
      (s.entries || []).forEach(e => {
        const eh = new Date(e.ts || s.date).getHours();
        if (CAR_TYPES.includes(e.type)) {
          byHour[eh][e.type]++;
          byDay[d.getDay()][e.type]++;
          byMonth[d.getMonth()][e.type]++;
        }
        // Altitude
        const alt = e.altitude || 0;
        if (alt < 200)       byAlt['Plaine (<200m)']++;
        else if (alt < 800)  byAlt['Colline (200-800m)']++;
        else                 byAlt['Montagne (>800m)']++;
        // Route
        const spd = e.speed || 0;
        if (spd > 100)       byRoad['Autoroute']++;
        else if (spd > 60)   byRoad['Route Nationale']++;
        else                 byRoad['Route Dept.']++;
      });
      if (s.aiScore != null) aiScores.push({ date: s.date, score: s.aiScore });
    }

    // Doughnut total
    const totalAll = CAR_TYPES.reduce((s, t) => s + totals[t], 0);
    _makeChart('dashboardMainChart', {
      type: 'doughnut',
      data: {
        labels: CAR_TYPES.map(t => LABELS[t]),
        datasets: [{ data: CAR_TYPES.map(t => totals[t]), backgroundColor: CAR_TYPES.map(t => COLORS[t]), borderWidth: 2 }],
      },
      options: { plugins: { ..._pluginOptions(), legend: { position: 'bottom', labels: { color: _textColor(), font: { family: "'Barlow Condensed', sans-serif" }, boxWidth: 12 } } }, responsive: true, maintainAspectRatio: false },
    });

    // Stat list
    const listEl = document.getElementById('dashboard-main-list');
    if (listEl) {
      listEl.innerHTML = CAR_TYPES.map(t => `
        <div class="stat-card">
          <span class="stat-card-title">${LABELS[t]}</span>
          <span class="stat-card-value" style="color:${COLORS[t]}">${totals[t]}</span>
          <span class="stat-card-extra">${totalAll > 0 ? (totals[t]/totalAll*100).toFixed(1) : 0}%</span>
        </div>`).join('');
    }

    this._render24hChart('dashboard24hChart', byHour, CAR_TYPES);
    this._renderWeeklyChart('weeklyChart', byDay, CAR_TYPES);
    this._renderMonthlyChart('monthlyChart', byMonth, CAR_TYPES);
    this._renderAiEvolutionChart(aiScores);
    this._renderAltitudeChart(byAlt);
    this._renderRoadTypeChart(byRoad);
    this._renderSequences(sessions, 'cars');

    const natContainer = document.getElementById('dash-nat-container');
    if (natContainer) natContainer.style.display = 'none';
  },

  // ── Dashboard Environnement ────────────────────────────────

  _renderEnvDashboard() {
    const bilan = Carbon.getGlobalBilan();

    document.getElementById('dash-env-co2')?.textContent && (
      document.getElementById('dash-env-co2').textContent = `${(bilan.emitted/1000).toFixed(2)} kg`
    );
    document.getElementById('dash-env-quota')?.textContent && (
      document.getElementById('dash-env-quota').textContent = `${(bilan.quota/1000).toFixed(2)} kg`
    );
    const diffEl = document.getElementById('dash-env-diff');
    if (diffEl) {
      const diffKg = (bilan.diff/1000).toFixed(2);
      diffEl.textContent = bilan.positive
        ? `✅ Bilan positif : ${diffKg} kg sous la limite`
        : `❌ Dépassement : ${Math.abs(diffKg)} kg au-dessus`;
      diffEl.className = bilan.positive ? 'text-green' : 'text-red';
    }

    // CO2 par type — sessions récentes
    const sessions = Storage.getSessions('cars');
    const co2ByType = {};
    sessions.forEach(s => (s.entries||[]).forEach(e => {
      if (e.co2) co2ByType[e.type] = (co2ByType[e.type] || 0) + e.co2;
    }));
    const envTypes = Object.keys(co2ByType);

    _makeChart('envCo2PieChart', {
      type: 'pie',
      data: {
        labels: envTypes.map(t => LABELS[t] || t),
        datasets: [{ data: envTypes.map(t => co2ByType[t]), backgroundColor: envTypes.map(t => COLORS[t] || '#999'), borderWidth: 2 }],
      },
      options: { plugins: { ..._pluginOptions(), legend: { position: 'bottom', labels: { color: _textColor(), font: { family: "'Barlow Condensed', sans-serif" }, boxWidth: 12 } } }, responsive: true, maintainAspectRatio: false },
    });

    // Evolution ratio CO2/Quota
    const evolution = Carbon.getCo2Evolution();
    _makeChart('envCo2EvolutionChart', {
      type: 'line',
      data: {
        labels: evolution.map(e => new Date(e.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })),
        datasets: [{
          label: 'CO2 / Quota (%)',
          data: evolution.map(e => e.ratio),
          borderColor: '#2EAD4B',
          backgroundColor: 'rgba(46,173,75,0.12)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#2EAD4B',
        }],
      },
      options: {
        plugins: _pluginOptions(),
        scales: {
          x: _baseScaleOptions(),
          y: { ..._baseScaleOptions(), beginAtZero: true, max: 150,
               ticks: { ..._baseScaleOptions().ticks, callback: v => `${v}%` } },
        },
        responsive: true, maintainAspectRatio: false,
      },
    });
  },

  // ── Graphiques communs ─────────────────────────────────────

  _render24hChart(canvasId, byHour, types) {
    const hours = Array.from({ length: 24 }, (_, i) => `${i}h`);
    _makeChart(canvasId, {
      type: 'bar',
      data: {
        labels: hours,
        datasets: types.map(t => ({
          label: LABELS[t],
          data: byHour.map(h => h[t] || 0),
          backgroundColor: COLORS[t] + 'CC',
          borderRadius: 3,
        })),
      },
      options: {
        plugins: _pluginOptions(),
        scales: { x: { ..._baseScaleOptions(), stacked: true }, y: { ..._baseScaleOptions(), stacked: true, beginAtZero: true } },
        responsive: true, maintainAspectRatio: false,
      },
    });
  },

  _renderWeeklyChart(canvasId, byDay, types) {
    const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    _makeChart(canvasId, {
      type: 'bar',
      data: {
        labels: days,
        datasets: types.slice(0, 4).map(t => ({
          label: LABELS[t],
          data: byDay.map(d => d[t] || 0),
          backgroundColor: COLORS[t] + 'CC',
          borderRadius: 4,
        })),
      },
      options: {
        plugins: _pluginOptions(),
        scales: { x: _baseScaleOptions(), y: { ..._baseScaleOptions(), beginAtZero: true } },
        responsive: true, maintainAspectRatio: false,
      },
    });
  },

  _renderMonthlyChart(canvasId, byMonth, types) {
    const months = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    _makeChart(canvasId, {
      type: 'line',
      data: {
        labels: months,
        datasets: types.slice(0, 4).map(t => ({
          label: LABELS[t],
          data: byMonth.map(m => m[t] || 0),
          borderColor: COLORS[t],
          backgroundColor: COLORS[t] + '22',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
        })),
      },
      options: {
        plugins: _pluginOptions(),
        scales: { x: _baseScaleOptions(), y: { ..._baseScaleOptions(), beginAtZero: true } },
        responsive: true, maintainAspectRatio: false,
      },
    });
  },

  _renderAiEvolutionChart(scores) {
    const last10 = scores.slice(-10);
    _makeChart('aiEvolutionChart', {
      type: 'line',
      data: {
        labels: last10.map(s => new Date(s.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })),
        datasets: [{
          label: 'Précision IA (%)',
          data: last10.map(s => s.score),
          borderColor: '#8B46C1',
          backgroundColor: 'rgba(139,70,193,0.12)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#8B46C1',
        }],
      },
      options: {
        plugins: _pluginOptions(),
        scales: {
          x: _baseScaleOptions(),
          y: { ..._baseScaleOptions(), beginAtZero: true, max: 100, ticks: { ..._baseScaleOptions().ticks, callback: v => `${v}%` } },
        },
        responsive: true, maintainAspectRatio: false,
      },
    });
  },

  _renderAltitudeChart(byAlt) {
    _makeChart('altitudeChart', {
      type: 'doughnut',
      data: {
        labels: Object.keys(byAlt),
        datasets: [{ data: Object.values(byAlt), backgroundColor: ['#2EAD4B','#F5A623','#D93025'], borderWidth: 2 }],
      },
      options: { plugins: { ..._pluginOptions(), legend: { position: 'bottom', labels: { color: _textColor(), font: { family: "'Barlow Condensed', sans-serif" }, boxWidth: 12 } } }, responsive: true, maintainAspectRatio: false },
    });
  },

  _renderRoadTypeChart(byRoad) {
    _makeChart('roadTypeChart', {
      type: 'bar',
      data: {
        labels: Object.keys(byRoad),
        datasets: [{ label: 'Véhicules', data: Object.values(byRoad), backgroundColor: ['#0057B8','#F5A623','#2EAD4B'], borderRadius: 6 }],
      },
      options: {
        plugins: _pluginOptions(),
        scales: { x: _baseScaleOptions(), y: { ..._baseScaleOptions(), beginAtZero: true } },
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      },
    });
  },

  _renderNatChart(totals) {
    _makeChart('natChart', {
      type: 'pie',
      data: {
        labels: ['🇫🇷 France', '🌍 Étranger'],
        datasets: [{ data: [totals.FR, totals.ETR], backgroundColor: [COLORS.FR, COLORS.ETR], borderWidth: 2 }],
      },
      options: { plugins: { ..._pluginOptions(), legend: { position: 'bottom', labels: { color: _textColor(), font: { family: "'Barlow Condensed', sans-serif" }, boxWidth: 12 } } }, responsive: true, maintainAspectRatio: false },
    });
  },

  _renderSequences(sessions, mode) {
    const seqMap = {};
    for (const s of sessions) {
      const entries = (s.entries || []).map(e => e.type);
      for (let i = 0; i < entries.length - 1; i++) {
        const key = `${entries[i]} → ${entries[i+1]}`;
        seqMap[key] = (seqMap[key] || 0) + 1;
      }
    }

    const top5 = Object.entries(seqMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const container = document.getElementById('sequence-container');
    if (!container) return;
    container.innerHTML = top5.length
      ? top5.map(([seq, count]) => `
          <div class="sequence-item">
            <span class="sequence-flow">${seq}</span>
            <span class="sequence-count">×${count}</span>
          </div>`).join('')
      : '<p class="text-muted" style="font-size:.85em;padding:8px">Pas encore assez de données.</p>';
  },

  // ── Charts de session (modale) ────────────────────────────

  renderSessionCharts(session) {
    const entries = session.entries || [];

    // Densité temporelle (par tranche de 5 min)
    const density = {};
    entries.forEach(e => {
      const min = Math.floor((new Date(e.ts || session.date).getMinutes()) / 5) * 5;
      density[min] = (density[min] || 0) + 1;
    });
    const densityLabels = Object.keys(density).map(k => `${k}min`);
    const densityData   = Object.values(density);

    _makeChart('temporalDensityChart', {
      type: 'bar',
      data: {
        labels: densityLabels,
        datasets: [{ label: 'Passages', data: densityData, backgroundColor: '#0057B8CC', borderRadius: 4 }],
      },
      options: {
        plugins: _pluginOptions(),
        scales: { x: _baseScaleOptions(), y: { ..._baseScaleOptions(), beginAtZero: true } },
        responsive: true, maintainAspectRatio: false,
      },
    });
  },

  // ── Mise à jour thème sur tous les charts ─────────────────

  updateTheme() {
    Object.values(_instances).forEach(chart => {
      try { chart.update(); } catch (_) {}
    });
  },
};
