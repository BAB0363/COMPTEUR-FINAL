/**
 * ui/ui.js — Rendu DOM Principal
 *
 * Responsabilités :
 *  - Gérer les onglets (switching)
 *  - Basculer le thème jour/nuit
 *  - Mettre à jour toutes les zones d'affichage réactif
 *  - S'abonner aux Events pour se rafraîchir automatiquement
 */

import { state }         from '../core/state.js';
import { Events }        from '../core/events.js';
import { Storage }       from '../core/storage.js';
import { Counter, VEHICLE_SPECS } from '../modules/counter.js';
import { Finance }       from '../modules/finance.js';
import { Gami }          from '../modules/gamification.js';
import { GPS, formatElapsed } from '../modules/gps.js';
import { Carbon }        from '../modules/carbon.js';
import { Tycoon }        from '../modules/tycoon.js';
import { Toasts }        from './toasts.js';
import { Modals }        from './modals.js';

// ──────────────────────────────────────────────────────────
//  COULEURS DES TYPES DE VÉHICULES
// ──────────────────────────────────────────────────────────

const TYPE_COLORS = {
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

// ──────────────────────────────────────────────────────────
//  ONGLETS
// ──────────────────────────────────────────────────────────

let _currentTab = 'trucks';
let _carStatsOpen   = false;
let _truckStatsOpen = false;

export const UI = {

  // ── Thème ─────────────────────────────────────────────────

  initTheme() {
    const dark = Storage.getDarkMode();
    state.darkMode = dark;
    document.body.classList.toggle('dark', dark);
    this._updateThemeBtn();
  },

  toggleTheme() {
    state.darkMode = !state.darkMode;
    document.body.classList.toggle('dark', state.darkMode);
    Storage.saveDarkMode(state.darkMode);
    this._updateThemeBtn();
  },

  _updateThemeBtn() {
    const btn = document.getElementById('btn-theme');
    if (btn) btn.textContent = state.darkMode ? '☀️ Jour' : '🌙 Nuit';
  },

  // ── Onglets ────────────────────────────────────────────────

  switchTab(tab) {
    _currentTab = tab;

    // Désactiver tous les panels et onglets
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.main-tabs .tab').forEach(t => t.classList.remove('active'));

    // Activer le bon
    const section = document.getElementById(`section-${tab}`);
    const tabBtn  = document.getElementById(`tab-${tab}`);
    if (section) section.classList.add('active');
    if (tabBtn)  tabBtn.classList.add('active');

    Events.emit('ui:tab-changed', { tab });
  },

  // ── Mise à jour du chrono ──────────────────────────────────

  updateChrono(mode, elapsed) {
    const id = mode === 'trucks' ? 'truck-chrono' : 'car-chrono';
    const el = document.getElementById(id);
    if (el) el.textContent = `⏱️ ${formatElapsed(elapsed)}`;

    const distId = mode === 'trucks' ? 'truck-dist' : 'car-dist';
    const distEl = document.getElementById(distId);
    if (distEl) {
      const km = state.sessions[mode].distanceKm || 0;
      distEl.textContent = `📍 ${km.toFixed(2)} km`;
    }
  },

  // ── Totaux & barres ────────────────────────────────────────

  updateTruckTotals() {
    const total  = Counter.getTotal('trucks');
    const { FR, ETR } = state.counts.trucks;
    const weight = state.weight.trucks;

    document.getElementById('grand-total').textContent = total;
    document.getElementById('truck-weight').textContent = `${(weight/1000).toFixed(1)} t`;
    document.getElementById('leader-name').textContent = Counter.getTruckLeader();

    // Barre de proportion FR/ETR
    const barFr  = document.getElementById('bar-fr');
    const barEtr = document.getElementById('bar-etr');
    if (barFr && barEtr && total > 0) {
      barFr.style.width  = `${(FR/total*100).toFixed(1)}%`;
      barEtr.style.width = `${(ETR/total*100).toFixed(1)}%`;
      barFr.style.background  = TYPE_COLORS.FR;
      barEtr.style.background = TYPE_COLORS.ETR;
    }
  },

  updateCarTotals() {
    const total  = Counter.getTotal('cars');
    const counts = state.counts.cars;
    const weight = state.weight.cars;

    const el = document.getElementById('car-grand-total');
    if (el) el.textContent = total;
    const wEl = document.getElementById('car-weight');
    if (wEl) wEl.textContent = `${(weight/1000).toFixed(1)} t`;

    // Barre de proportion multi-couleurs
    const types = Object.keys(counts);
    types.forEach(type => {
      const bar = document.getElementById(`bar-${type}`);
      if (bar) {
        bar.style.width = total > 0 ? `${(counts[type]/total*100).toFixed(1)}%` : '0%';
        bar.style.background = TYPE_COLORS[type] || '#999';
      }
    });

    // Mise à jour des compteurs individuels
    types.forEach(type => {
      const countEl = document.getElementById(`count-${type}`);
      if (countEl) countEl.textContent = counts[type];
    });
  },

  updateTruckCounts() {
    const { FR, ETR } = state.counts.trucks;
    const elFr  = document.getElementById('count-FR');
    const elEtr = document.getElementById('count-ETR');
    if (elFr)  elFr.textContent  = FR;
    if (elEtr) elEtr.textContent = ETR;
  },

  // ── Boutons chrono ─────────────────────────────────────────

  updateChronoBtn(mode) {
    const id  = mode === 'trucks' ? 'btn-truck-chrono' : 'btn-car-chrono';
    const btn = document.getElementById(id);
    if (!btn) return;
    const running = state.sessions[mode].running;
    btn.textContent = running ? '⏸️ Pause' : '▶️ Start';
    btn.classList.toggle('running', running);
  },

  // ── Badge banque ───────────────────────────────────────────

  updateBankBadge() {
    const badge = document.getElementById('bank-badge');
    const span  = document.getElementById('display-bank');
    if (!badge || !span) return;

    const balance = Finance.getBalance();
    span.textContent = `${balance >= 0 ? '' : '-'}${Math.abs(balance).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    badge.style.display = 'flex';
    badge.classList.toggle('positive', balance >= 0);
    badge.classList.toggle('negative', balance < 0);
  },

  // ── Badge profil ───────────────────────────────────────────

  updateProfileBadge() {
    const userEl = document.getElementById('display-user');
    const modeEl = document.getElementById('display-mode');
    if (userEl) userEl.textContent = state.currentUser;
    if (modeEl) modeEl.textContent = state.currentMode === 'camion' ? '🚛 Camion' : '🚗 Voiture';
  },

  // ── Prédiction IA ─────────────────────────────────────────

  updatePrediction(mode, { prediction, confidence, podium, journal }) {
    const suffix  = mode === 'trucks' ? 'trucks' : 'cars';
    const spec    = VEHICLE_SPECS[prediction];
    const mainEl  = document.getElementById(`pred-main-${suffix}`);
    const gauge   = document.getElementById(`pred-gauge-${suffix}`);
    const podiumEl= document.getElementById(`pred-podium-${suffix}`);
    const journalEl= document.getElementById(`pred-journal-${suffix}`);

    if (mainEl) {
      mainEl.innerHTML = prediction
        ? `🔮 Prédiction : <span class="text-purple">${spec?.emoji ?? ''} ${spec?.label ?? prediction}</span>`
        : `🔮 Prédiction : <span class="text-purple">En attente...</span>`;
    }

    if (gauge) {
      const pct = (confidence * 100).toFixed(0);
      gauge.style.width = `${pct}%`;
      gauge.style.background =
        confidence > 0.7 ? 'var(--clr-green)' :
        confidence > 0.4 ? 'var(--clr-primary)' :
                           'var(--clr-red)';
    }

    if (podiumEl) {
      podiumEl.innerHTML = podium.slice(0, 3).map((p, i) => {
        const s = VEHICLE_SPECS[p.type];
        return `<span>${['🥇','🥈','🥉'][i]} ${s?.emoji ?? ''} ${s?.label ?? p.type}<br><span class="pred-podium-score">${(p.prob*100).toFixed(0)}%</span></span>`;
      }).join('');
    }

    if (journalEl) journalEl.textContent = `🔍 ${journal}`;
  },

  // ── Jauge carbone ──────────────────────────────────────────

  updateCarbonGauge() {
    const container = document.getElementById('carbon-gauge-container');
    const bilan     = Carbon.getSessionBilan();
    if (!container) return;

    container.style.display = 'block';
    const fill = document.getElementById('carbon-gauge-fill');
    const text = document.getElementById('carbon-gauge-text');

    if (fill) fill.style.width = `${(bilan.ratio * 100).toFixed(0)}%`;
    if (text) {
      const em = (bilan.emitted/1000).toFixed(1);
      const qt = (bilan.quota/1000).toFixed(1);
      text.textContent = `${em} kg / ${qt} kg autorisés`;
      text.className   = bilan.positive ? 'carbon-text text-green' : 'carbon-text text-red';
    }
  },

  // ── Statut GPS & Wake Lock ─────────────────────────────────

  updateStatusBar() {
    document.getElementById('gps-status')?.textContent && (
      document.getElementById('gps-status').textContent = GPS.getStatusLabel()
    );
    document.getElementById('wake-lock-status')?.textContent && (
      document.getElementById('wake-lock-status').textContent = GPS.getWakeLockLabel()
    );
  },

  // ── Toggle vue carte/compteurs ─────────────────────────────

  toggleTruckStats() {
    _truckStatsOpen = !_truckStatsOpen;
    document.getElementById('truck-main-view').style.display  = _truckStatsOpen ? 'none' : 'block';
    document.getElementById('truck-stats-view').style.display = _truckStatsOpen ? 'block' : 'none';
    document.getElementById('btn-truck-stats').textContent    = _truckStatsOpen ? '⬅️ Retour' : '🗺️ Carte';
  },

  toggleCarStats() {
    _carStatsOpen = !_carStatsOpen;
    document.getElementById('car-main-view').style.display  = _carStatsOpen ? 'none' : 'block';
    document.getElementById('car-stats-view').style.display = _carStatsOpen ? 'block' : 'none';
    document.getElementById('btn-car-stats').textContent    = _carStatsOpen ? '⬅️ Retour' : '🗺️ Carte';
  },

  // ── Panneau Gamification ───────────────────────────────────

  updateGamiPanel() {
    const level  = Gami.getLevel();
    const xp     = Gami.getXP();
    const maxXp  = Gami.getXPForCurrentLevel();
    const season = Gami.getSeason();
    const talents= Gami.getTalents();

    document.getElementById('gami-lvl-text').textContent   = level;
    document.getElementById('gami-xp-label').textContent   = `${xp} / ${maxXp} XP`;
    document.getElementById('gami-xp-bar').style.width     = `${(xp/maxXp*100).toFixed(1)}%`;
    document.getElementById('gami-season-name').textContent = season.name;
    document.getElementById('gami-season-dates').textContent = `${_formatDate(season.start)} → ${_formatDate(season.end)}`;

    // Talents
    ['oeil','nego','eco'].forEach(key => {
      document.getElementById(`talent-${key}`)?.classList.toggle('unlocked', talents[key]);
      document.getElementById(`talent-${key}`)?.classList.toggle('locked',  !talents[key]);
    });

    // Quêtes
    this._renderQuests('gami-daily-container',   Gami.getDailyQuests(),    true);
    this._renderQuests('gami-weekly-container',  Gami.getWeeklyQuests(),   false);
    this._renderQuests('gami-season-container',  Gami.getSeasonChallenges(),false);
  },

  _renderQuests(containerId, quests, canReroll) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = quests.map(q => `
      <div class="quest-card ${q.done ? 'done' : ''}">
        <div class="quest-info">
          <div class="quest-title">${q.title}</div>
          <div class="quest-desc">${q.desc}</div>
          <div class="quest-progress">${q.progress} / ${q.target} — 🎁 ${q.reward}€ + ${q.xp} XP</div>
        </div>
        ${canReroll && !q.done ? `<button class="btn-quest-reroll" onclick="window.App.rerollQuest('${q.id}')">🔀</button>` : ''}
      </div>`).join('');
  },

  // ── Tycoon ────────────────────────────────────────────────

  updateTycoon() {
    const pending = Tycoon.getPending();
    const rate    = Tycoon.getRate();
    const slots   = Tycoon.getUsedSlots();
    const maxSlots= Tycoon.getMaxSlots();

    const pendingEl = document.getElementById('company-pending-income');
    if (pendingEl) pendingEl.textContent = `${pending.toFixed(2)} €`;
    const rateEl = document.getElementById('company-rate-display');
    if (rateEl) rateEl.textContent = `Rythme actuel : + ${rate.toFixed(2)} € / min`;
    const slotsUsed = document.getElementById('company-slots-used');
    const slotsMax  = document.getElementById('company-slots-max');
    if (slotsUsed) slotsUsed.textContent = slots;
    if (slotsMax)  slotsMax.textContent  = maxSlots;

    // Bâtiments
    const buildEl = document.getElementById('company-buildings-list');
    if (buildEl) {
      buildEl.innerHTML = Tycoon.getBuildingDefs().map(b => {
        const owned = !!Tycoon.ownedBuildings()[b.id];
        const canAfford = Finance.getBalance() >= b.price;
        const slotsOk   = slots < maxSlots;
        return `
          <div class="tycoon-card ${owned ? 'owned' : ''} ${owned || (canAfford && slotsOk) ? '' : 'locked'}">
            ${owned ? '<span class="tycoon-badge">✅ Possédé</span>' : ''}
            <span class="tycoon-title">${b.emoji} ${b.name}</span>
            <span class="tycoon-revenue">+${b.revenue} €/min</span>
            <span class="tycoon-price">${owned ? 'Déjà acquis' : b.price.toLocaleString('fr-FR') + ' €'}</span>
            <p style="font-size:.8em;color:var(--text-muted);margin:0">${b.desc}</p>
            ${!owned ? `<button class="btn-buy" onclick="window.App.buyBuilding('${b.id}')" ${!canAfford || !slotsOk ? 'disabled' : ''}>Acheter</button>` : ''}
          </div>`;
      }).join('');
    }

    // Flotte
    const fleetEl = document.getElementById('company-fleet-list');
    if (fleetEl) {
      fleetEl.innerHTML = Tycoon.getFleetDefs().map(t => {
        const count = Tycoon.ownedFleet()[t.id] || 0;
        const canAfford = Finance.getBalance() >= t.price;
        return `
          <div class="tycoon-card">
            <span class="tycoon-title">${t.emoji} ${t.name} ${count > 0 ? `<span style="color:var(--clr-green)">×${count}</span>` : ''}</span>
            <span class="tycoon-revenue">+${(t.bonus*100).toFixed(0)}% gains</span>
            <span class="tycoon-price">${t.price.toLocaleString('fr-FR')} €</span>
            <p style="font-size:.8em;color:var(--text-muted);margin:0">${t.desc}</p>
            <button class="btn-buy" onclick="window.App.buyTruck('${t.id}')" ${!canAfford ? 'disabled' : ''}>Acheter</button>
          </div>`;
      }).join('');
    }
  },

  // ── IA Status (page Paramètres) ───────────────────────────

  updateAiStatus(trucks, cars) {
    const trEl = document.getElementById('ai-status-trucks');
    const caEl = document.getElementById('ai-status-cars');
    if (trEl) {
      trEl.textContent  = trucks ? 'Entraîné ✅' : 'Non entraîné ❌';
      trEl.className    = trucks ? 'text-green bold' : 'text-red bold';
    }
    if (caEl) {
      caEl.textContent  = cars ? 'Entraîné ✅' : 'Non entraîné ❌';
      caEl.className    = cars ? 'text-green bold' : 'text-red bold';
    }
  },

  // ── Utilitaires ────────────────────────────────────────────

  getCurrentTab() { return _currentTab; },
};

function _formatDate(iso) {
  if (!iso) return '?';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}
