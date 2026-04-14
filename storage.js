/**
 * core/storage.js — Abstraction localStorage
 *
 * Toutes les clés sont préfixées par l'utilisateur courant.
 * Un seul endroit pour lire/écrire/supprimer les données persistantes.
 *
 * Convention de clés :
 *   {user}:sessions:{mode}    — Tableau de sessions sauvegardées
 *   {user}:finance            — { balance, history }
 *   {user}:company            — { buildings, fleet }
 *   {user}:gami               — { xp, level, quests, talents, ... }
 *   app:profiles              — ['Sylvain', 'Paul', ...]
 *   app:currentUser           — 'Sylvain'
 *   app:darkMode              — true|false
 *   {user}:ai:{mode}          — Modèle TF sérialisé
 */

import { state } from './state.js';

// ── Helpers privés ──────────────────────────────────────────

function _key(suffix) {
  return `${state.currentUser}:${suffix}`;
}

function _parse(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  try { return JSON.parse(raw); }
  catch { return fallback; }
}

// ── API publique ──────────────────────────────────────────

export const Storage = {

  // ── Profils ──────────────────────────────────────────────

  getProfiles() {
    return _parse(localStorage.getItem('app:profiles'), ['Sylvain']);
  },

  saveProfiles(profiles) {
    localStorage.setItem('app:profiles', JSON.stringify(profiles));
  },

  getCurrentUser() {
    return localStorage.getItem('app:currentUser') || 'Sylvain';
  },

  saveCurrentUser(name) {
    localStorage.setItem('app:currentUser', name);
  },

  getDarkMode() {
    return _parse(localStorage.getItem('app:darkMode'), false);
  },

  saveDarkMode(val) {
    localStorage.setItem('app:darkMode', JSON.stringify(val));
  },

  // ── Sessions ─────────────────────────────────────────────

  getSessions(mode) {
    return _parse(localStorage.getItem(_key(`sessions:${mode}`)), []);
  },

  saveSessions(mode, sessions) {
    localStorage.setItem(_key(`sessions:${mode}`), JSON.stringify(sessions));
  },

  appendSession(mode, sessionData) {
    const sessions = this.getSessions(mode);
    sessions.push(sessionData);
    this.saveSessions(mode, sessions);
  },

  deleteSessionsByRange(mode, startDate, endDate) {
    let sessions = this.getSessions(mode);
    sessions = sessions.filter(s => {
      const d = new Date(s.date);
      if (startDate && d < new Date(startDate)) return true;
      if (endDate   && d > new Date(endDate))   return true;
      return false;
    });
    this.saveSessions(mode, sessions);
  },

  // ── Finance ──────────────────────────────────────────────

  getFinance() {
    return _parse(localStorage.getItem(_key('finance')), { balance: 0, history: [] });
  },

  saveFinance(data) {
    localStorage.setItem(_key('finance'), JSON.stringify(data));
  },

  // ── Empire Tycoon ─────────────────────────────────────────

  getCompany() {
    return _parse(localStorage.getItem(_key('company')), { buildings: {}, fleet: {} });
  },

  saveCompany(data) {
    localStorage.setItem(_key('company'), JSON.stringify(data));
  },

  // ── Gamification ──────────────────────────────────────────

  getGami() {
    return _parse(localStorage.getItem(_key('gami')), {
      xp: 0, level: 1, talents: { oeil: false, nego: false, eco: false },
      dailyQuests: [], weeklyQuests: [], seasonChallenges: [],
      lastDailyReset: null, lastWeeklyReset: null,
    });
  },

  saveGami(data) {
    localStorage.setItem(_key('gami'), JSON.stringify(data));
  },

  // ── IA ────────────────────────────────────────────────────

  getAiMeta(mode) {
    return _parse(localStorage.getItem(_key(`ai:${mode}`)), null);
  },

  saveAiMeta(mode, meta) {
    localStorage.setItem(_key(`ai:${mode}`), JSON.stringify(meta));
  },

  // ── Maintenance ──────────────────────────────────────────

  /**
   * Supprime des données selon la portée choisie
   * @param {'sessions'|'finance'|'company'|'full'} scope
   * @param {string|null} startDate  format YYYY-MM-DD
   * @param {string|null} endDate    format YYYY-MM-DD
   */
  maintenance(scope, startDate = null, endDate = null) {
    const hasRange = startDate && endDate;

    if (scope === 'sessions' || scope === 'full') {
      if (hasRange) {
        this.deleteSessionsByRange('trucks', startDate, endDate);
        this.deleteSessionsByRange('cars',   startDate, endDate);
      } else {
        this.saveSessions('trucks', []);
        this.saveSessions('cars',   []);
      }
    }

    if (scope === 'finance' || scope === 'full') {
      if (hasRange) {
        const f = this.getFinance();
        f.history = f.history.filter(e => {
          const d = new Date(e.date);
          if (startDate && d < new Date(startDate)) return true;
          if (endDate   && d > new Date(endDate))   return true;
          return false;
        });
        this.saveFinance(f);
      } else {
        this.saveFinance({ balance: 0, history: [] });
      }
    }

    if (scope === 'company' || scope === 'full') {
      this.saveCompany({ buildings: {}, fleet: {} });
    }

    if (scope === 'full') {
      this.saveGami({
        xp: 0, level: 1, talents: { oeil: false, nego: false, eco: false },
        dailyQuests: [], weeklyQuests: [], seasonChallenges: [],
        lastDailyReset: null, lastWeeklyReset: null,
      });
      localStorage.removeItem(_key('ai:trucks'));
      localStorage.removeItem(_key('ai:cars'));
    }
  },

  // ── Export / Import ──────────────────────────────────────

  exportAll() {
    const data = {
      version: 1,
      exportDate: new Date().toISOString(),
      user: state.currentUser,
      sessions_trucks: this.getSessions('trucks'),
      sessions_cars:   this.getSessions('cars'),
      finance:         this.getFinance(),
      company:         this.getCompany(),
      gami:            this.getGami(),
    };
    return JSON.stringify(data, null, 2);
  },

  importAll(json) {
    const data = JSON.parse(json);
    if (!data.version) throw new Error('Format invalide');
    if (data.sessions_trucks) this.saveSessions('trucks', data.sessions_trucks);
    if (data.sessions_cars)   this.saveSessions('cars',   data.sessions_cars);
    if (data.finance)         this.saveFinance(data.finance);
    if (data.company)         this.saveCompany(data.company);
    if (data.gami)            this.saveGami(data.gami);
  },
};
