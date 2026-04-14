/**
 * core/state.js — État Global Centralisé
 *
 * Point unique de vérité pour toutes les données de l'application.
 * NE PAS importer d'autres modules ici (dépendance zéro).
 *
 * Usage:
 *   import { state } from './core/state.js';
 *   state.currentUser = 'Sylvain';
 */

export const state = {
  // ── Profil utilisateur ──
  currentUser: 'Sylvain',
  currentMode: 'voiture', // 'voiture' | 'camion'
  darkMode: false,

  // ── Sessions actives ──
  sessions: {
    trucks: {
      running: false,
      startTime: null,
      elapsed: 0,         // ms cumulées
      intervalId: null,
      gpsWatchId: null,
      coords: [],         // [{lat, lng, ts}]
      distanceKm: 0,
    },
    cars: {
      running: false,
      startTime: null,
      elapsed: 0,
      intervalId: null,
      gpsWatchId: null,
      coords: [],
      distanceKm: 0,
    },
  },

  // ── Compteurs actifs (session en cours) ──
  counts: {
    trucks: { FR: 0, ETR: 0 },   // total = FR + ETR
    cars: {
      voitures: 0, utilitaires: 0, camions: 0, camping: 0,
      bus: 0, motos: 0, velos: 0, engins: 0,
    },
  },

  // ── Poids & CO2 cumulés (session courante) ──
  weight: {
    trucks: 0,  // kg
    cars: 0,    // kg
    co2: 0,     // g (session cars)
    co2Quota: 0,// g (calculé selon vélos)
  },

  // ── Historique des frappes (pour undo) ──
  lastActions: [],   // max 10 entrées, format: { type, mode, key, weight, co2 }

  // ── IA : prédictions en cours ──
  ai: {
    trucks: { prediction: null, confidence: 0, podium: [], journal: '' },
    cars:   { prediction: null, confidence: 0, podium: [], journal: '' },
  },

  // ── Finance : Bourse de l'Asphalte ──
  finance: {
    balance: 0,
    history: [],     // [{id, date, label, amount, type}]
    tolls: {
      trucks: { lastTollTime: 0, cumTonnage: 0 },
      cars:   { lastTollTime: 0 },
    },
  },

  // ── Sponsor ──
  sponsor: {
    active: null,    // null | { id, name, objective, reward, progress, target, talentBonus }
    pendingOffer: null,
  },

  // ── Empire Tycoon ──
  company: {
    buildings: {},   // { buildingId: { level, count } }
    fleet: {},       // { truckId: count }
    pendingIncome: 0,
    incomeRatePerMin: 0,
  },

  // ── Gamification ──
  gami: {
    xp: 0,
    level: 1,
    season: null,    // { id, name, startDate, endDate }
    talents: {
      oeil:  false,  // Niv. 5
      nego:  false,  // Niv. 10
      eco:   false,  // Niv. 15
    },
    dailyQuests:   [],  // [{ id, title, desc, progress, target, reward, done, rerolled }]
    weeklyQuests:  [],
    seasonChallenges: [],
    streaks: {
      lightweight: 0,    // suite poids < 500kg
      regularityOk: 0,   // espacement régulier
      rainbow: 0,        // catégories différentes à la suite
      fastTrucks: { count: 0, lastTs: 0 },
    },
  },

  // ── Combo IA (pour malus Gégé) ──
  lastIaConfidence: { trucks: 0, cars: 0 },

  // ── Marché (congestion) ──
  market: {
    trucks: { lastType: null, streak: 0 },
    cars:   { lastType: null, streak: 0 },
  },

  // ── Altitude GPS ──
  altitude: 0,

  // ── Heure de pointe / aube ──
  timeBonus: {
    dawnActive: false,    // 5h-7h
    rushActive: false,    // heure de pointe
  },
};

/**
 * Réinitialise les compteurs/session d'un mode (trucks|cars)
 */
export function resetSessionState(mode) {
  const session = state.sessions[mode];
  session.running = false;
  session.startTime = null;
  session.elapsed = 0;
  if (session.intervalId)  { clearInterval(session.intervalId);  session.intervalId = null; }
  if (session.gpsWatchId)  { navigator.geolocation?.clearWatch(session.gpsWatchId); session.gpsWatchId = null; }
  session.coords = [];
  session.distanceKm = 0;

  if (mode === 'trucks') {
    state.counts.trucks = { FR: 0, ETR: 0 };
    state.weight.trucks = 0;
  } else {
    state.counts.cars = { voitures: 0, utilitaires: 0, camions: 0, camping: 0, bus: 0, motos: 0, velos: 0, engins: 0 };
    state.weight.cars = 0;
    state.weight.co2 = 0;
    state.weight.co2Quota = 0;
  }

  state.lastActions = [];
  state.sponsor.active = null;
  state.sponsor.pendingOffer = null;
  state.market[mode] = { lastType: null, streak: 0 };
  state.gami.streaks = { lightweight: 0, regularityOk: 0, rainbow: 0, fastTrucks: { count: 0, lastTs: 0 } };
}
