/**
 * modules/tycoon.js — Empire Tycoon
 *
 * Responsabilités :
 *  - Catalogue des bâtiments et véhicules de flotte
 *  - Achat et gestion des propriétés
 *  - Calcul des revenus passifs (€/min)
 *  - Versement des revenus en fin de session
 */

import { state } from '../core/state.js';
import { Events } from '../core/events.js';
import { Storage } from '../core/storage.js';
import { Finance } from './finance.js';

// ──────────────────────────────────────────────────────────
//  CATALOGUE
// ──────────────────────────────────────────────────────────

export const BUILDINGS = [
  { id: 'poste_peage',    emoji: '🛤️',  name: 'Poste de Péage',     price: 500,   revenue: 2.0, desc: '+2€/min. Incontournable.' },
  { id: 'station_service',emoji: '⛽',  name: 'Station-Service',    price: 1200,  revenue: 4.5, desc: '+4.5€/min. Plein les poches.' },
  { id: 'relais_routier',  emoji: '🍽️', name: 'Relais Routier',     price: 2000,  revenue: 7.0, desc: '+7€/min. Camionneur VIP.' },
  { id: 'entrepot',        emoji: '🏭', name: 'Entrepôt Logistique',price: 4000,  revenue: 12.0,desc: '+12€/min. La vraie industrie.' },
  { id: 'autoroute',       emoji: '🛣️', name: 'Concession A.',      price: 8000,  revenue: 22.0,desc: '+22€/min. Péage d\'auteur.' },
  { id: 'datacenter',      emoji: '💻', name: 'DataCenter Trafic',  price: 15000, revenue: 40.0,desc: '+40€/min. Intelligence pure.' },
];

export const FLEET_TRUCKS = [
  { id: 'camion_benne',    emoji: '🚚', name: 'Camion Benne',       price: 3000,  bonus: 0.05, desc: '+5% gains par camion compté.' },
  { id: 'semi_remorque',   emoji: '🚛', name: 'Semi-Remorque',      price: 6000,  bonus: 0.08, desc: '+8% gains PL.' },
  { id: 'convoi_spec',     emoji: '🏗️', name: 'Convoi Spécial',     price: 12000, bonus: 0.12, desc: '+12% et bonus convoi exceptionnel.' },
];

// Slots max de bâtiments par palier
const SLOT_THRESHOLDS = [
  { minBalance: 0,      slots: 2 },
  { minBalance: 1000,   slots: 4 },
  { minBalance: 5000,   slots: 6 },
  { minBalance: 20000,  slots: 8 },
];

// ──────────────────────────────────────────────────────────
//  API PUBLIQUE
// ──────────────────────────────────────────────────────────

export const Tycoon = {

  /** Charge les données depuis Storage dans state.company */
  load() {
    const saved = Storage.getCompany();
    state.company.buildings = saved.buildings || {};
    state.company.fleet     = saved.fleet     || {};
    state.company.pendingIncome = 0;
    this._recalcRate();
  },

  /** Sauvegarde state.company */
  save() {
    Storage.saveCompany({
      buildings: state.company.buildings,
      fleet:     state.company.fleet,
    });
  },

  // ── Slots ─────────────────────────────────────────────────

  getMaxSlots() {
    const balance = state.finance.balance;
    let slots = 2;
    for (const t of SLOT_THRESHOLDS) {
      if (balance >= t.minBalance) slots = t.slots;
    }
    return slots;
  },

  getUsedSlots() {
    return Object.values(state.company.buildings).reduce((s, v) => s + v, 0);
  },

  // ── Achat ─────────────────────────────────────────────────

  buyBuilding(id) {
    const def = BUILDINGS.find(b => b.id === id);
    if (!def) return { ok: false, reason: 'Introuvable' };
    if (state.finance.balance < def.price) return { ok: false, reason: 'Solde insuffisant' };
    if (this.getUsedSlots() >= this.getMaxSlots()) return { ok: false, reason: 'Plus de place' };
    if (state.company.buildings[id]) return { ok: false, reason: 'Déjà possédé' };

    Finance.transact(-def.price, `🏗️ Achat : ${def.name}`, 'company');
    state.company.buildings[id] = 1;
    this._recalcRate();
    this.save();
    Events.emit('tycoon:building-bought', { id, def });
    return { ok: true };
  },

  buyTruck(id) {
    const def = FLEET_TRUCKS.find(t => t.id === id);
    if (!def) return { ok: false, reason: 'Introuvable' };
    if (state.finance.balance < def.price) return { ok: false, reason: 'Solde insuffisant' };

    Finance.transact(-def.price, `🚚 Achat flotte : ${def.name}`, 'company');
    state.company.fleet[id] = (state.company.fleet[id] || 0) + 1;
    this._recalcRate();
    this.save();
    Events.emit('tycoon:truck-bought', { id, def });
    return { ok: true };
  },

  // ── Revenus passifs ───────────────────────────────────────

  _recalcRate() {
    let rate = 0;
    for (const [id, owned] of Object.entries(state.company.buildings)) {
      if (!owned) continue;
      const def = BUILDINGS.find(b => b.id === id);
      if (def) rate += def.revenue;
    }
    state.company.incomeRatePerMin = rate;
  },

  /**
   * Tick (session:tick) — accumule les revenus passifs
   * @param {number} elapsedMs
   */
  onTick(elapsedMs) {
    if (state.company.incomeRatePerMin <= 0) return;
    const deltaMin = 1 / 60; // 1 tick = 1 seconde = 1/60 minute
    state.company.pendingIncome += state.company.incomeRatePerMin * deltaMin;
    Events.emit('tycoon:income-updated', { pending: state.company.pendingIncome, rate: state.company.incomeRatePerMin });
  },

  /**
   * Verse les revenus accumulés (appelé à session:stopped)
   */
  settlePendingIncome() {
    const amount = state.company.pendingIncome;
    if (amount <= 0) return;
    Finance.creditCompanyIncome(parseFloat(amount.toFixed(2)));
    state.company.pendingIncome = 0;
    Events.emit('tycoon:income-settled', { amount });
  },

  // ── Getters ───────────────────────────────────────────────

  getBuildingDefs() { return BUILDINGS; },
  getFleetDefs()    { return FLEET_TRUCKS; },
  getRate()         { return state.company.incomeRatePerMin; },
  getPending()      { return state.company.pendingIncome; },
  ownedBuildings()  { return state.company.buildings; },
  ownedFleet()      { return state.company.fleet; },
};
