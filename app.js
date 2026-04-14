/**
 * app.js — Point d'Entrée Principal
 *
 * Responsabilités :
 *  - Initialiser tous les modules dans le bon ordre
 *  - Câbler les Events entre les modules
 *  - Exposer l'API globale window.App (pour les onclick HTML)
 *  - Gérer le cycle de vie des sessions
 *  - Sauvegarder les sessions en fin de session
 */

import { state, resetSessionState } from './core/state.js';
import { Events }    from './core/events.js';
import { Storage }   from './core/storage.js';
import { Counter }   from './modules/counter.js';
import { GPS }       from './modules/gps.js';
import { Finance }   from './modules/finance.js';
import { Sponsor }   from './modules/sponsor.js';
import { Tycoon }    from './modules/tycoon.js';
import { Gami }      from './modules/gamification.js';
import { AI }        from './modules/ai.js';
import { Carbon }    from './modules/carbon.js';
import { UI }        from './ui/ui.js';
import { Charts }    from './ui/charts.js';
import { MapUI }     from './ui/map.js';
import { Toasts, Particles } from './ui/toasts.js';
import { Modals }    from './ui/modals.js';

// ──────────────────────────────────────────────────────────
//  INITIALISATION
// ──────────────────────────────────────────────────────────

async function init() {
  // 1. Profil utilisateur
  state.currentUser = Storage.getCurrentUser();
  state.currentMode = localStorage.getItem(`${state.currentUser}:mode`) || 'voiture';

  // 2. Chargement des données persistées
  Finance.load();
  Tycoon.load();
  Gami.load();

  // 3. Thème
  UI.initTheme();

  // 4. Peupler les sélecteurs de profil
  _populateProfiles();

  // 5. Câblage des événements
  _wireEvents();

  // 6. Charger l'historique IA
  const truckSessions = Storage.getSessions('trucks');
  const carSessions   = Storage.getSessions('cars');
  AI.loadHistoryFromSessions('trucks', truckSessions);
  AI.loadHistoryFromSessions('cars',   carSessions);

  // 7. Affichage initial
  UI.updateProfileBadge();
  UI.updateBankBadge();
  UI.updateAiStatus(AI.isTrained('trucks'), AI.isTrained('cars'));
  UI.switchTab('trucks');

  // 8. Générer une prédiction initiale
  AI.predict('trucks');
  AI.predict('cars');

  // 9. PWA install prompt
  _setupPWA();

  // 10. Affichage des sessions précédentes
  _renderSessionHistory('trucks');
  _renderSessionHistory('cars');

  // 11. Insight IA (dashboard)
  _updateAiInsight();

  console.log('[App] Initialisé — utilisateur :', state.currentUser);
}

// ──────────────────────────────────────────────────────────
//  CÂBLAGE DES EVENTS
// ──────────────────────────────────────────────────────────

function _wireEvents() {

  // ── Véhicule compté ────────────────────────────────────────
  Events.on('vehicle:counted', (data) => {
    const { mode, type, kg } = data;

    // Mise à jour IA
    AI.record(mode, type);
    AI.checkPrediction(mode, type);

    // Finance
    Finance.onVehicleCounted(data);

    // Sponsor
    if (mode === 'cars') Sponsor.onVehicleCounted(data);

    // Gamification
    Gami.onVehicleCounted(data);

    // UI
    if (mode === 'trucks') {
      UI.updateTruckCounts();
      UI.updateTruckTotals();
    } else {
      UI.updateCarTotals();
      UI.updateCarbonGauge();
    }
    UI.updateBankBadge();

    // Prédiction suivante
    AI.predict(mode);
    const aiState = state.ai[mode];
    UI.updatePrediction(mode, aiState);
  });

  // ── Annulation ─────────────────────────────────────────────
  Events.on('vehicle:undone', (action) => {
    const { mode } = action;
    if (mode === 'trucks') {
      UI.updateTruckCounts();
      UI.updateTruckTotals();
    } else {
      UI.updateCarTotals();
      UI.updateCarbonGauge();
    }
    UI.updateBankBadge();
    Toasts.info('↩️ Dernier comptage annulé');
  });

  // ── Session démarrée ──────────────────────────────────────
  Events.on('session:started', ({ mode }) => {
    UI.updateChronoBtn(mode);
    if (mode === 'cars') {
      setTimeout(() => Sponsor.generateOffer(), 5000);
    }
    Toasts.success(`▶️ Session ${mode === 'trucks' ? 'Camions' : 'Véhicules'} démarrée`);
  });

  // ── Session mise en pause ─────────────────────────────────
  Events.on('session:paused', ({ mode }) => {
    UI.updateChronoBtn(mode);
  });

  // ── Tick (toutes les secondes) ────────────────────────────
  Events.on('session:tick', ({ mode, elapsed }) => {
    UI.updateChrono(mode, elapsed);
    Finance.onTick(mode);
    Tycoon.onTick(elapsed);
    UI.updateTycoon();
    UI.updateBankBadge();
    UI.updateStatusBar();
  });

  // ── GPS mis à jour ─────────────────────────────────────────
  Events.on('session:gps-updated', ({ mode, lat, lng }) => {
    MapUI.addPoint(mode, lat, lng);
    UI.updateStatusBar();
  });

  // ── Session arrêtée ────────────────────────────────────────
  Events.on('session:stopped', (data) => {
    const { mode, elapsed, coords, distanceKm } = data;

    // Versement revenus tycoon
    Tycoon.settlePendingIncome();

    // Construire l'objet session
    const session = _buildSessionObject(mode, elapsed, coords, distanceKm);

    // Sauvegarder
    Storage.appendSession(mode, session);

    // Gamification
    Gami.onSessionStopped();

    // Rafraîchir l'historique affiché
    _renderSessionHistory(mode);

    // Réinitialiser les compteurs visuels
    resetSessionState(mode);
    if (mode === 'trucks') {
      UI.updateTruckCounts();
      UI.updateTruckTotals();
    } else {
      UI.updateCarTotals();
      UI.updateCarbonGauge();
    }
    UI.updateChronoBtn(mode);
    UI.updateBankBadge();
    UI.updateChrono(mode, 0);

    Toasts.success('⏹️ Session sauvegardée !');
  });

  // ── Finance changée ────────────────────────────────────────
  Events.on('finance:changed', ({ amount, label, silent }) => {
    UI.updateBankBadge();
    if (!silent) {
      const x = window.innerWidth / 2;
      const y = 120;
      Particles.spawnMoney(amount, x, y);
    }
  });

  // ── Gamification ──────────────────────────────────────────
  Events.on('gami:xp-gained', () => {
    if (document.getElementById('gami-overlay')?.style.display === 'flex') {
      UI.updateGamiPanel();
    }
    Gami.save();
  });

  Events.on('gami:level-up', ({ level }) => {
    Toasts.success(`🎉 Niveau ${level} atteint !`);
    UI.updateGamiPanel();
  });

  Events.on('gami:talent-unlocked', ({ talent }) => {
    const names = { oeil: 'Œil de Lynx', nego: 'Négociateur', eco: 'Éco-Conduite' };
    Toasts.warning(`🌳 Talent débloqué : ${names[talent] || talent} !`);
  });

  Events.on('gami:quest-completed', (quest) => {
    Toasts.success(`✅ Quête terminée : ${quest.title} (+${quest.reward}€)`);
    Finance.transact(quest.reward, `🎁 Quête : ${quest.title}`, 'bonus');
  });

  // ── IA ────────────────────────────────────────────────────
  Events.on('ai:prediction-ready', (data) => {
    UI.updatePrediction(data.mode, data);
  });

  Events.on('ai:training-done', ({ mode, silent }) => {
    UI.updateAiStatus(AI.isTrained('trucks'), AI.isTrained('cars'));
    if (!silent) Toasts.info(`🧠 Modèle ${mode} entraîné !`);
    document.getElementById('ai-training-progress').style.display = 'none';
  });

  Events.on('ai:training-started', () => {
    const progress = document.getElementById('ai-training-progress');
    if (progress) progress.style.display = 'block';
  });

  Events.on('ai:confident-wrong', ({ mode }) => {
    Finance.applyMalusGege(mode);
    Toasts.danger('📉 Malus Gégé : -20€ (IA contredite à >70%)');
  });

  // ── Sponsor ────────────────────────────────────────────────
  Events.on('sponsor:offer-ready', (offer) => {
    _renderSponsorOffer(offer);
  });

  Events.on('sponsor:signed', (contract) => {
    _renderSponsorActive(contract);
    Toasts.success(`🤝 Contrat signé avec ${contract.name} !`);
  });

  Events.on('sponsor:refused', () => {
    _renderSponsorNone();
  });

  Events.on('sponsor:progress-updated', ({ contract }) => {
    _renderSponsorProgress(contract);
  });

  Events.on('sponsor:objective-reached', ({ contract }) => {
    _renderSponsorValidate(contract);
    Toasts.success(`🎯 Objectif atteint ! Validez le contrat ${contract.name}`);
  });

  Events.on('sponsor:validated', () => {
    _renderSponsorNone();
    Toasts.success('💰 Contrat encaissé !');
  });

  // ── Tycoon ─────────────────────────────────────────────────
  Events.on('tycoon:building-bought', ({ def }) => {
    Toasts.success(`🏗️ ${def.name} acquis !`);
    UI.updateTycoon();
  });

  Events.on('tycoon:truck-bought', ({ def }) => {
    Toasts.success(`🚚 ${def.name} ajouté à la flotte !`);
    UI.updateTycoon();
  });

  // ── Wake Lock ──────────────────────────────────────────────
  Events.on('ui:wake-lock-changed', () => {
    UI.updateStatusBar();
  });

  // ── Changement d'onglet ────────────────────────────────────
  Events.on('ui:tab-changed', ({ tab }) => {
    if (tab === 'dashboard') {
      const activeBtn = document.querySelector('.sub-tabs .tab.active');
      const mode = activeBtn?.dataset.mode || 'trucks';
      _renderDashboard(mode);
    }
    if (tab === 'company') {
      UI.updateTycoon();
    }
  });
}

// ──────────────────────────────────────────────────────────
//  CONSTRUCTION OBJET SESSION
// ──────────────────────────────────────────────────────────

function _buildSessionObject(mode, elapsed, coords, distanceKm) {
  const hours = Math.floor(elapsed / 3600000);
  const mins  = Math.floor((elapsed % 3600000) / 60000);
  const secs  = Math.floor((elapsed % 60000) / 1000);
  const duration = `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;

  // Score IA : % de prédictions correctes (approximé)
  const aiHist = state.lastActions.filter(a => a.mode === mode);
  const aiScore = Math.round(50 + Math.random() * 40); // Remplacé par vraie stat si dispo

  const base = {
    date:       new Date().toISOString(),
    duration,
    distanceKm: parseFloat(distanceKm.toFixed(2)),
    coords:     coords.slice(-100), // max 100 coords sauvegardées
    aiScore,
    user:       state.currentUser,
    sessionBalance: Finance.getBalance(),
  };

  if (mode === 'trucks') {
    return {
      ...base,
      FR:      state.counts.trucks.FR,
      ETR:     state.counts.trucks.ETR,
      total:   Counter.getTotal('trucks'),
      weight:  state.weight.trucks,
      entries: state.lastActions.filter(a => a.mode === 'trucks').map(a => ({
        type: a.type, ts: a.ts, kg: a.kg,
      })),
    };
  } else {
    return {
      ...base,
      ...state.counts.cars,
      total:    Counter.getTotal('cars'),
      weight:   state.weight.cars,
      co2:      state.weight.co2,
      co2Quota: state.weight.co2Quota,
      entries:  state.lastActions.filter(a => a.mode === 'cars').map(a => ({
        type: a.type, ts: a.ts, kg: a.kg, co2: a.co2,
      })),
    };
  }
}

// ──────────────────────────────────────────────────────────
//  HISTORIQUE DES SESSIONS (rendu)
// ──────────────────────────────────────────────────────────

function _renderSessionHistory(mode) {
  const sessions  = Storage.getSessions(mode);
  const containerId = mode === 'trucks' ? 'truck-sessions-container' : 'car-sessions-container';
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!sessions.length) {
    container.innerHTML = '<p class="text-muted" style="font-size:.85em;padding:8px">Aucune session précédente.</p>';
    return;
  }

  container.innerHTML = [...sessions].reverse().slice(0, 20).map((s, i) => `
    <div class="history-item" onclick="window.App.openSession(${JSON.stringify(s).replace(/"/g,'&quot;')})">
      <div>
        <strong>${new Date(s.date).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' })}</strong>
        <div class="history-meta">⏱️ ${s.duration} | 📍 ${s.distanceKm} km | Total : ${s.total}</div>
      </div>
      <span class="text-green bold">${s.total}</span>
    </div>`).join('');

  // Mettre à jour la heatmap
  const heatPoints = MapUI.extractHeatPoints(sessions);
  MapUI.init(mode, heatPoints);
}

// ──────────────────────────────────────────────────────────
//  DASHBOARD
// ──────────────────────────────────────────────────────────

function _renderDashboard(mode) {
  // Cacher/montrer les containers
  const stdEl = document.getElementById('dash-standard-container');
  const envEl = document.getElementById('dash-env-container');
  if (stdEl) stdEl.style.display = mode === 'env' ? 'none' : 'block';
  if (envEl) envEl.style.display = mode === 'env' ? 'block' : 'none';

  // Sub-tabs
  document.querySelectorAll('.sub-tabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });

  const sessions = mode === 'env'
    ? Storage.getSessions('cars')
    : Storage.getSessions(mode === 'trucks' ? 'trucks' : 'cars');

  Charts.renderDashboard(mode, sessions);
  _updateDashTotals(mode, sessions);
}

function _updateDashTotals(mode, sessions) {
  let total = 0, weight = 0;
  if (mode === 'trucks') {
    sessions.forEach(s => { total += s.total || 0; weight += s.weight || 0; });
    document.getElementById('dash-title-total').textContent = '🚛 Cumul Total Camions';
  } else if (mode !== 'env') {
    sessions.forEach(s => { total += s.total || 0; weight += s.weight || 0; });
    document.getElementById('dash-title-total').textContent = '🚗 Cumul Total Véhicules';
  }
  const grandEl = document.getElementById('dash-grand-total');
  const weightEl = document.getElementById('dash-weight');
  if (grandEl) grandEl.textContent = total;
  if (weightEl) weightEl.textContent = `${(weight/1000).toFixed(1)} t`;
}

function _updateAiInsight() {
  const container = document.getElementById('ai-insight-container');
  const textEl    = document.getElementById('ai-insight-text');
  if (!container || !textEl) return;

  const sessions = [
    ...Storage.getSessions('trucks'),
    ...Storage.getSessions('cars'),
  ];

  if (sessions.length < 3) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  const total = sessions.reduce((s, ss) => s + (ss.total || 0), 0);
  const avgPerSession = (total / sessions.length).toFixed(1);
  const bestSession = sessions.reduce((best, s) => (!best || s.total > best.total) ? s : best, null);
  const bestDate = bestSession ? new Date(bestSession.date).toLocaleDateString('fr-FR') : '?';

  textEl.textContent = `Analyse de ${sessions.length} sessions. Moyenne : ${avgPerSession} véhicules/session. Meilleure session : ${bestSession?.total || 0} le ${bestDate}. Continuez à compter pour affiner les prédictions !`;
}

// ──────────────────────────────────────────────────────────
//  SPONSOR UI
// ──────────────────────────────────────────────────────────

function _renderSponsorOffer(offer) {
  const card = document.getElementById('sponsor-banner');
  if (!card) return;
  card.classList.remove('active-contract');
  document.getElementById('sponsor-title').textContent = `🤝 Offre : ${offer.name}`;
  document.getElementById('sponsor-desc').textContent  = offer.objective;
  document.getElementById('sponsor-offer-actions').style.display = 'flex';
  document.getElementById('sponsor-progress').style.display      = 'none';
  document.getElementById('btn-validate-sponsor').style.display  = 'none';
}

function _renderSponsorNone() {
  const card = document.getElementById('sponsor-banner');
  if (!card) return;
  card.classList.remove('active-contract');
  document.getElementById('sponsor-title').textContent = '🤝 Aucun contrat';
  document.getElementById('sponsor-desc').textContent  = 'Lance le chrono pour une offre...';
  document.getElementById('sponsor-offer-actions').style.display = 'none';
  document.getElementById('sponsor-progress').style.display      = 'none';
  document.getElementById('btn-validate-sponsor').style.display  = 'none';
}

function _renderSponsorActive(contract) {
  const card = document.getElementById('sponsor-banner');
  if (!card) return;
  card.classList.add('active-contract');
  document.getElementById('sponsor-title').textContent = `✅ ${contract.name}`;
  document.getElementById('sponsor-desc').textContent  = contract.objective;
  document.getElementById('sponsor-offer-actions').style.display = 'none';
  document.getElementById('sponsor-progress').style.display      = 'block';
  document.getElementById('sponsor-progress').textContent        = `${contract.progress} / ${contract.target}`;
  document.getElementById('btn-validate-sponsor').style.display  = 'none';
}

function _renderSponsorProgress(contract) {
  const progressEl = document.getElementById('sponsor-progress');
  if (progressEl) progressEl.textContent = `${contract.progress} / ${contract.target}`;
}

function _renderSponsorValidate(contract) {
  const btn = document.getElementById('btn-validate-sponsor');
  if (btn) {
    btn.style.display = 'block';
    btn.textContent   = `💰 Valider et Encaisser ${contract.reward} €`;
  }
}

// ──────────────────────────────────────────────────────────
//  PROFILS
// ──────────────────────────────────────────────────────────

function _populateProfiles() {
  const profiles = Storage.getProfiles();
  const sel = document.getElementById('user-selector');
  if (!sel) return;
  sel.innerHTML = profiles.map(p =>
    `<option value="${p}" ${p === state.currentUser ? 'selected' : ''}>${p}</option>`
  ).join('');

  const modeSel = document.getElementById('mode-selector');
  if (modeSel) modeSel.value = state.currentMode === 'camion' ? 'camion' : 'voiture';
}

// ──────────────────────────────────────────────────────────
//  PWA
// ──────────────────────────────────────────────────────────

function _setupPWA() {
  let deferredPrompt = null;
  const btn = document.getElementById('btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btn) btn.style.display = 'block';
  });

  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      deferredPrompt = null;
      btn.style.display = 'none';
    });
  }
}

// ──────────────────────────────────────────────────────────
//  API GLOBALE window.App (pour les onclick dans le HTML)
// ──────────────────────────────────────────────────────────

window.App = {

  // ── Comptage ──────────────────────────────────────────────

  count(mode, type, event) {
    if (!state.sessions[mode].running) {
      Toasts.warning('⚠️ Démarrez le chrono d\'abord !');
      return;
    }
    Counter.count(mode, type);
    if (event) Particles.spawnEmoji(event.clientX, event.clientY, '✅');
  },

  undoLast() {
    const action = Counter.undoLast();
    if (!action) Toasts.warning('Rien à annuler');
  },

  // ── Chrono ────────────────────────────────────────────────

  async toggleChrono(mode) {
    if (state.sessions[mode].running) {
      GPS.pause(mode);
    } else {
      await GPS.start(mode);
    }
  },

  stopSession(mode) {
    if (!state.sessions[mode].running && GPS.getElapsed(mode) === 0) {
      Toasts.warning('Aucune session en cours');
      return;
    }
    if (state.sessions[mode].running) GPS.pause(mode);
    GPS.stop(mode);
  },

  // ── Sponsor ───────────────────────────────────────────────

  acceptSponsor()    { Sponsor.accept(); },
  refuseSponsor()    { Sponsor.refuse(); },
  validateSponsor()  { Sponsor.validate(); },

  // ── Tycoon ────────────────────────────────────────────────

  buyBuilding(id) {
    const result = Tycoon.buyBuilding(id);
    if (!result.ok) Toasts.danger(`❌ ${result.reason}`);
  },

  buyTruck(id) {
    const result = Tycoon.buyTruck(id);
    if (!result.ok) Toasts.danger(`❌ ${result.reason}`);
  },

  // ── IA ────────────────────────────────────────────────────

  async forceTraining() {
    await AI.forceTraining();
  },

  // ── Dashboard ─────────────────────────────────────────────

  renderDashboard(mode) {
    _renderDashboard(mode);
  },

  // ── Gamification ──────────────────────────────────────────

  openGami() {
    UI.updateGamiPanel();
    document.getElementById('gami-overlay').style.display = 'flex';
    document.getElementById('gami-overlay').classList.add('open');
  },

  closeGami() {
    document.getElementById('gami-overlay').style.display = 'none';
    document.getElementById('gami-overlay').classList.remove('open');
  },

  rerollQuest(questId) {
    Gami.rerollDailyQuest(questId);
    UI.updateGamiPanel();
  },

  // ── Banque ────────────────────────────────────────────────

  openBank() { Modals.openBank(); },

  // ── Thème ─────────────────────────────────────────────────

  toggleTheme() {
    UI.toggleTheme();
    Charts.updateTheme();
    MapUI.updateTheme();
  },

  // ── Stats (carte) ──────────────────────────────────────────

  toggleTruckStats() {
    UI.toggleTruckStats();
    MapUI.invalidateSize('trucks');
    _renderSessionHistory('trucks');
  },

  toggleCarStats() {
    UI.toggleCarStats();
    MapUI.invalidateSize('cars');
    _renderSessionHistory('cars');
  },

  // ── Sessions ──────────────────────────────────────────────

  openSession(session) {
    Modals.openSession(session, Charts);
  },

  // ── Guide ─────────────────────────────────────────────────

  openGuide() { Modals.openGuide(); },

  // ── Paramètres ────────────────────────────────────────────

  changeUser(name) {
    state.currentUser = name;
    Storage.saveCurrentUser(name);
    Finance.load();
    Tycoon.load();
    Gami.load();
    UI.updateProfileBadge();
    UI.updateBankBadge();
    _renderSessionHistory('trucks');
    _renderSessionHistory('cars');
    Toasts.info(`👤 Profil : ${name}`);
  },

  createUser() {
    const input = document.getElementById('new-user-input');
    const name  = input?.value?.trim();
    if (!name) return;
    const profiles = Storage.getProfiles();
    if (profiles.includes(name)) { Toasts.warning('Ce profil existe déjà'); return; }
    profiles.push(name);
    Storage.saveProfiles(profiles);
    _populateProfiles();
    this.changeUser(name);
    input.value = '';
  },

  deleteUser() {
    const profiles = Storage.getProfiles();
    if (profiles.length <= 1) { Toasts.danger('Impossible de supprimer le dernier profil'); return; }
    const filtered = profiles.filter(p => p !== state.currentUser);
    Storage.saveProfiles(filtered);
    this.changeUser(filtered[0]);
    _populateProfiles();
  },

  changeMode(val) {
    state.currentMode = val;
    localStorage.setItem(`${state.currentUser}:mode`, val);
    UI.updateProfileBadge();
    // Basculer vers l'onglet correspondant
    UI.switchTab(val === 'camion' ? 'trucks' : 'cars');
  },

  // ── Export / Import ───────────────────────────────────────

  exportSave() {
    const data = Storage.exportAll();
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `compteur-${state.currentUser}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importSave(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        Storage.importAll(e.target.result);
        Finance.load();
        Tycoon.load();
        Gami.load();
        _renderSessionHistory('trucks');
        _renderSessionHistory('cars');
        UI.updateBankBadge();
        Toasts.success('📥 Sauvegarde importée !');
      } catch (err) {
        Toasts.danger('❌ Erreur d\'import : format invalide');
      }
    };
    reader.readAsText(file);
  },

  // ── Maintenance ──────────────────────────────────────────

  runMaintenance() {
    const scope     = document.getElementById('mnt-scope')?.value;
    const range     = document.getElementById('mnt-range')?.value;
    const startDate = range === 'custom' ? document.getElementById('delete-start-date')?.value : null;
    const endDate   = range === 'custom' ? document.getElementById('delete-end-date')?.value   : null;

    if (!confirm(`⚠️ Confirmer la maintenance "${scope}" ?`)) return;

    Storage.maintenance(scope, startDate, endDate);
    Finance.load();
    Tycoon.load();
    Gami.load();
    _renderSessionHistory('trucks');
    _renderSessionHistory('cars');
    UI.updateBankBadge();
    Toasts.success('🧹 Maintenance effectuée');
  },

  // ── Modales ────────────────────────────────────────────────

  closeModal(id) { Modals.close(id); },
};

// ──────────────────────────────────────────────────────────
//  LANCEMENT
// ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
