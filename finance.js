/**
 * modules/finance.js — La Bourse de l'Asphalte
 *
 * Responsabilités :
 *  - Gérer le solde bancaire
 *  - Calculer et appliquer tous les bonus et malus
 *  - Péages, TUR, Agios, Congestion
 *  - Émettre finance:changed avec les détails
 */

import { state } from '../core/state.js';
import { Events } from '../core/events.js';
import { Storage } from '../core/storage.js';
import { VEHICLE_SPECS } from './counter.js';

// ──────────────────────────────────────────────────────────
//  CONSTANTES
// ──────────────────────────────────────────────────────────

// Gain de base par véhicule (€)
const BASE_GAIN = {
  FR:          2.50,
  ETR:         3.00,
  voitures:    0.80,
  utilitaires: 1.20,
  motos:       0.60,
  camions:     2.50,
  camping:     1.00,
  bus:         1.80,
  engins:      2.00,
  velos:       0.40,
};

const TOLL_INTERVAL_MS       = 60_000;  // Péage toutes les 60s
const TOLL_BASE              = 1.50;    // € de base
const RUSH_HOUR_TOLL_MULT    = 2.0;
const TUR_THRESHOLD_KG       = 100_000; // 100 tonnes
const TUR_AMOUNT             = 50;
const AGIO_RATE              = 0.05;    // 5%
const MARKET_CONGESTION_AT   = 4;       // 4 du même type = congestion
const CONGESTION_COST        = 2.0;

// Bonus spéciaux
const BONUS_POIDS_PLUME      = 30;   // 4 véhicules < 500 kg
const BONUS_REGULARITE       = 100;  // 10 véhicules espacés 5-30s
const BONUS_RAINBOW          = 200;  // 5 types différents consécutifs
const BONUS_CONVOI_EXCEPT    = 50;   // 3 camions en < 15s
const MALUS_GEGE             = 20;   // IA sûre > 70% et contredite

// Multiplicateur d'altitude
const ALTITUDE_THRESHOLD     = 800;  // m
const ALTITUDE_BONUS_RATE    = 0.10; // +10%

// ──────────────────────────────────────────────────────────
//  TRACKING RAINBOW (5 types différents)
// ──────────────────────────────────────────────────────────
let _rainbowBuffer = []; // derniers types (max 5)

// ──────────────────────────────────────────────────────────
//  UTILITAIRES PRIVÉS
// ──────────────────────────────────────────────────────────

function _isRushHour() {
  const h = new Date().getHours();
  return (h >= 7 && h < 9) || (h >= 17 && h < 19);
}

function _isDawn() {
  const h = new Date().getHours();
  return h >= 5 && h < 7;
}

function _applyTalentMultiplier(amount, context) {
  let mult = 1;
  if (context === 'ai'     && state.gami.talents.oeil) mult += 0.10;
  if (context === 'sponsor'&& state.gami.talents.nego) mult += 0.20;
  return amount * mult;
}

// ──────────────────────────────────────────────────────────
//  API PUBLIQUE
// ──────────────────────────────────────────────────────────

export const Finance = {

  /**
   * Charge le solde depuis le stockage dans state.finance
   */
  load() {
    const saved = Storage.getFinance();
    state.finance.balance  = saved.balance  || 0;
    state.finance.history  = saved.history  || [];
  },

  /**
   * Sauvegarde le state.finance dans le stockage
   */
  save() {
    Storage.saveFinance({
      balance: state.finance.balance,
      history: state.finance.history,
    });
  },

  // ── Transaction brute ────────────────────────────────────

  /**
   * Modifie le solde et enregistre l'historique.
   * @param {number} amount   — Positif = gain, négatif = perte
   * @param {string} label    — Description
   * @param {string} type     — 'bonus'|'malus'|'toll'|'tax'|'income'|'sponsor'
   * @param {boolean} silent  — Si true, n'émet pas de particule
   */
  transact(amount, label, type = 'misc', silent = false) {
    state.finance.balance += amount;
    const entry = {
      id:     Date.now(),
      date:   new Date().toISOString(),
      label,
      amount,
      type,
      balance: state.finance.balance,
    };
    state.finance.history.unshift(entry);
    if (state.finance.history.length > 200) state.finance.history.pop();
    this.save();
    Events.emit('finance:changed', { amount, label, type, balance: state.finance.balance, silent });
    return entry;
  },

  // ── Gain par véhicule compté ──────────────────────────────

  /**
   * Calcule et applique le gain pour un véhicule comptabilisé.
   * Appelé par le handler de vehicle:counted.
   */
  onVehicleCounted({ mode, type, kg, altitude }) {
    let gain = BASE_GAIN[type] ?? 1.00;

    // Bonus aube (×2)
    if (_isDawn()) gain *= 2;

    // Bonus altitude (> 800m)
    if (altitude > ALTITUDE_THRESHOLD) gain *= (1 + ALTITUDE_BONUS_RATE);

    // Bonus flotte (tycoon - +5% par camion possédé, plafonné à +50%)
    const fleetCount = Object.values(state.company.fleet).reduce((s, v) => s + v, 0);
    if (fleetCount > 0) gain *= (1 + Math.min(fleetCount * 0.05, 0.5));

    // Talent négociateur sponsor (si contrat actif)
    if (state.sponsor.active) gain = _applyTalentMultiplier(gain, 'sponsor');

    this.transact(gain, `${VEHICLE_SPECS[type]?.emoji ?? ''} ${VEHICLE_SPECS[type]?.label ?? type}`, 'income');

    // ── Bonus spéciaux ────────────────────────────────────────

    // Poids Plume : 4 véhicules < 500 kg
    if (state.gami.streaks.lightweight >= 4) {
      state.gami.streaks.lightweight = 0;
      this.transact(BONUS_POIDS_PLUME, '🪶 Prime Poids Plume (×4 < 500 kg)', 'bonus');
    }

    // Convoi Exceptionnel : 3 camions < 15s
    if (state.gami.streaks.fastTrucks.count >= 3) {
      state.gami.streaks.fastTrucks.count = 0;
      this.transact(BONUS_CONVOI_EXCEPT, '🚛 Convoi Exceptionnel (×3 camions)', 'bonus');
    }

    // Arc-en-ciel
    if (mode === 'cars') {
      _rainbowBuffer.push(type);
      if (_rainbowBuffer.length > 5) _rainbowBuffer.shift();
      if (_rainbowBuffer.length === 5 && new Set(_rainbowBuffer).size === 5) {
        _rainbowBuffer = [];
        this.transact(BONUS_RAINBOW, '🌈 Combo Arc-en-Ciel (×5 types)', 'bonus');
      }
    }

    // Congestion du marché
    if (state.market[mode].streak >= MARKET_CONGESTION_AT) {
      this.transact(-CONGESTION_COST, '📉 Congestion du Marché', 'malus');
    }

    // TUR (Taxe Usure Routes) — tous les 100 tonnes
    const wKey = mode === 'trucks' ? 'trucks' : 'cars';
    const prevTonnage = state.finance.tolls[mode]?.cumTonnage ?? 0;
    const newTonnage  = prevTonnage + kg;
    const crossings   = Math.floor(newTonnage / TUR_THRESHOLD_KG) - Math.floor(prevTonnage / TUR_THRESHOLD_KG);
    if (!state.finance.tolls[mode]) state.finance.tolls[mode] = { lastTollTime: 0, cumTonnage: 0 };
    state.finance.tolls[mode].cumTonnage = newTonnage;
    if (crossings > 0) {
      this.transact(-TUR_AMOUNT * crossings, '🚧 T.U.R. (Usure des Routes)', 'tax');
    }
  },

  // ── Péages périodiques ────────────────────────────────────

  /**
   * À appeler à chaque tick (session:tick) si la session est active.
   */
  onTick(mode) {
    if (!state.sessions[mode].running) return;

    const toll = state.finance.tolls[mode] || (state.finance.tolls[mode] = { lastTollTime: 0, cumTonnage: 0 });
    const now  = Date.now();

    if (now - toll.lastTollTime >= TOLL_INTERVAL_MS) {
      toll.lastTollTime = now;
      const amount = _isRushHour() ? -(TOLL_BASE * RUSH_HOUR_TOLL_MULT) : -TOLL_BASE;
      this.transact(amount, `💸 Péage${_isRushHour() ? ' (Heure de Pointe)' : ''}`, 'toll');
    }

    // Agios si solde négatif
    if (state.finance.balance < 0) {
      const agios = Math.abs(state.finance.balance) * AGIO_RATE / 60; // par minute
      this.transact(-agios, '🏦 Agios (découvert)', 'tax', true);
    }
  },

  // ── Malus Gégé (IA contredite) ───────────────────────────

  applyMalusGege(mode) {
    this.transact(-MALUS_GEGE, '📉 Malus Gégé (IA contredite)', 'malus');
  },

  // ── Sponsor ───────────────────────────────────────────────

  creditSponsor(amount, contractName) {
    const final = _applyTalentMultiplier(amount, 'sponsor');
    this.transact(final, `🤝 Contrat Sponsor : ${contractName}`, 'sponsor');
  },

  // ── Revenus Tycoon ────────────────────────────────────────

  creditCompanyIncome(amount) {
    this.transact(amount, '🏢 Revenus Passifs (Empire)', 'income');
  },

  // ── Getters ───────────────────────────────────────────────

  getBalance()     { return state.finance.balance; },
  getHistory()     { return state.finance.history; },

  getTotalGains() {
    return state.finance.history
      .filter(e => e.amount > 0)
      .reduce((s, e) => s + e.amount, 0);
  },

  getTotalLosses() {
    return state.finance.history
      .filter(e => e.amount < 0)
      .reduce((s, e) => s + e.amount, 0);
  },
};
