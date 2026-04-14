/**
 * modules/counter.js — Logique de Comptage des Véhicules
 *
 * Responsabilités :
 *  - Définir les specs de chaque type de véhicule (poids, CO2)
 *  - Enregistrer un comptage (poids aléatoire, CO2, timestamp)
 *  - Gérer l'annulation (undo)
 *  - Émettre les événements vehicle:counted et vehicle:undone
 */

import { state } from '../core/state.js';
import { Events } from '../core/events.js';

// ──────────────────────────────────────────────────────────
//  SPECS DES VÉHICULES
// ──────────────────────────────────────────────────────────

/**
 * Pour chaque type : { minKg, maxKg, minCo2, maxCo2 }
 * Les valeurs de CO2 sont en g/km.
 * Les vélos ont CO2 = 0 et donnent un bonus écolo.
 */
export const VEHICLE_SPECS = {
  // Mode Camions
  FR:  { label: '🇫🇷 FR',     emoji: '🚛', minKg: 12000, maxKg: 44000, minCo2: 600,  maxCo2: 1300, mode: 'trucks' },
  ETR: { label: '🌍 ETR',    emoji: '🚛', minKg: 12000, maxKg: 44000, minCo2: 600,  maxCo2: 1300, mode: 'trucks' },

  // Mode Véhicules
  voitures:    { label: 'Voiture',   emoji: '🚗', minKg: 1100,  maxKg: 1900,  minCo2: 90,   maxCo2: 180,  mode: 'cars' },
  utilitaires: { label: 'Utilitaire',emoji: '🚐', minKg: 1700,  maxKg: 3500,  minCo2: 160,  maxCo2: 260,  mode: 'cars' },
  motos:       { label: 'Moto',      emoji: '🏍️', minKg: 150,   maxKg: 400,   minCo2: 60,   maxCo2: 130,  mode: 'cars' },
  camions:     { label: 'Camion',    emoji: '🚛', minKg: 12000, maxKg: 44000, minCo2: 600,  maxCo2: 1300, mode: 'cars' },
  camping:     { label: 'Camping',   emoji: '🏕️', minKg: 2800,  maxKg: 4250,  minCo2: 190,  maxCo2: 320,  mode: 'cars' },
  bus:         { label: 'Bus',       emoji: '🚌', minKg: 12000, maxKg: 19000, minCo2: 800,  maxCo2: 1400, mode: 'cars' },
  engins:      { label: 'Engin',     emoji: '🚜', minKg: 4000,  maxKg: 15000, minCo2: 1000, maxCo2: 2500, mode: 'cars' },
  velos:       { label: 'Vélo',      emoji: '🚲', minKg: 10,    maxKg: 28,    minCo2: 0,    maxCo2: 0,    mode: 'cars', ecoBonus: true },
};

// ──────────────────────────────────────────────────────────
//  UTILITAIRES PRIVÉS
// ──────────────────────────────────────────────────────────

function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateVehicleData(type) {
  const spec = VEHICLE_SPECS[type];
  const kg   = randBetween(spec.minKg, spec.maxKg);
  const co2  = spec.ecoBonus ? 0 : randBetween(spec.minCo2, spec.maxCo2);
  const ecoBonus = spec.ecoBonus ? randBetween(0, 1750) : 0; // g bonus quota
  return { kg, co2, ecoBonus };
}

// ──────────────────────────────────────────────────────────
//  API PUBLIQUE
// ──────────────────────────────────────────────────────────

export const Counter = {

  /**
   * Enregistre un comptage.
   * @param {'trucks'|'cars'} mode
   * @param {string} type  — 'FR', 'ETR', 'voitures', 'motos', etc.
   * @returns {object} Données du véhicule généré
   */
  count(mode, type) {
    const { kg, co2, ecoBonus } = generateVehicleData(type);
    const now = Date.now();
    const altitude = state.altitude || 0;

    // Mise à jour de l'état
    if (mode === 'trucks') {
      state.counts.trucks[type]++;
      state.weight.trucks += kg;
    } else {
      state.counts.cars[type]++;
      state.weight.cars += kg;
      state.weight.co2 += co2;
      if (ecoBonus) state.weight.co2Quota += ecoBonus;
    }

    // Historique undo (max 10)
    const action = { mode, type, kg, co2, ecoBonus, ts: now };
    state.lastActions.unshift(action);
    if (state.lastActions.length > 10) state.lastActions.pop();

    // Mise à jour streaks
    this._updateStreaks(mode, type, kg, now);

    // Mise à jour marché
    this._updateMarket(mode, type);

    // Événement
    Events.emit('vehicle:counted', { mode, type, kg, co2, ecoBonus, altitude, ts: now });

    return { kg, co2, ecoBonus, ts: now };
  },

  /**
   * Annule le dernier comptage.
   * @returns {object|null} L'action annulée, ou null si vide
   */
  undoLast() {
    if (!state.lastActions.length) return null;
    const action = state.lastActions.shift();
    const { mode, type, kg, co2, ecoBonus } = action;

    if (mode === 'trucks') {
      state.counts.trucks[type] = Math.max(0, state.counts.trucks[type] - 1);
      state.weight.trucks = Math.max(0, state.weight.trucks - kg);
    } else {
      state.counts.cars[type] = Math.max(0, state.counts.cars[type] - 1);
      state.weight.cars = Math.max(0, state.weight.cars - kg);
      state.weight.co2 = Math.max(0, state.weight.co2 - co2);
      if (ecoBonus) state.weight.co2Quota = Math.max(0, state.weight.co2Quota - ecoBonus);
    }

    Events.emit('vehicle:undone', action);
    return action;
  },

  /**
   * Calcule le total de véhicules comptés pour un mode.
   */
  getTotal(mode) {
    if (mode === 'trucks') {
      return state.counts.trucks.FR + state.counts.trucks.ETR;
    }
    return Object.values(state.counts.cars).reduce((s, v) => s + v, 0);
  },

  /**
   * Retourne le nom du type leader (mode camions)
   * "FR" si FR >= ETR, "ETR" sinon.
   */
  getTruckLeader() {
    const { FR, ETR } = state.counts.trucks;
    if (FR === 0 && ETR === 0) return 'Aucune';
    return FR >= ETR ? '🇫🇷 FR' : '🌍 ETR';
  },

  // ── Gestion des streaks (gamification) ──────────────────

  _updateStreaks(mode, type, kg, ts) {
    const s = state.gami.streaks;

    // Poids Plume (4 consécutifs < 500 kg)
    if (kg < 500) {
      s.lightweight++;
    } else {
      s.lightweight = 0;
    }

    // Convoi Exceptionnel : 3 camions en < 15 secondes
    if (mode === 'trucks' || type === 'camions') {
      const ft = s.fastTrucks;
      if (ts - ft.lastTs < 15000) {
        ft.count++;
      } else {
        ft.count = 1;
      }
      ft.lastTs = ts;
    }

    // Arc-en-ciel : 5 types différents à la suite
    // (géré côté finance.js qui connaît les 5 derniers types)
  },

  _updateMarket(mode, type) {
    const m = state.market[mode];
    if (m.lastType === type) {
      m.streak++;
    } else {
      m.lastType = type;
      m.streak = 1;
    }
  },
};
