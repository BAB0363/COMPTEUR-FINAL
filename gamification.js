/**
 * modules/gamification.js — Système de Gamification
 *
 * Responsabilités :
 *  - XP et niveaux (avec déblocage de talents)
 *  - Génération et gestion des quêtes journalières/hebdo
 *  - Défis de saison
 *  - Émission d'événements gami:xp-gained, gami:level-up
 */

import { state } from '../core/state.js';
import { Events } from '../core/events.js';
import { Storage } from '../core/storage.js';

// ──────────────────────────────────────────────────────────
//  CONFIGURATION XP
// ──────────────────────────────────────────────────────────

/** XP nécessaire pour passer au niveau N */
function xpForLevel(level) {
  return Math.floor(1000 * Math.pow(1.35, level - 1));
}

const TALENT_THRESHOLDS = { oeil: 5, nego: 10, eco: 15 };

// ──────────────────────────────────────────────────────────
//  CATALOGUE DE QUÊTES
// ──────────────────────────────────────────────────────────

const DAILY_QUEST_POOL = [
  { id: 'd_trucks_10',  title: 'Routier du Jour',    desc: 'Compter 10 camions',          type: 'trucks_total',  target: 10,  reward: 50,  xp: 30 },
  { id: 'd_cars_20',    title: 'Compteur Assidu',     desc: 'Compter 20 véhicules',         type: 'cars_total',    target: 20,  reward: 40,  xp: 25 },
  { id: 'd_motos_5',    title: 'Fan de Motos',        desc: 'Compter 5 motos',              type: 'motos',         target: 5,   reward: 35,  xp: 20 },
  { id: 'd_velos_3',    title: 'Éco-Citoyen',         desc: 'Compter 3 vélos',              type: 'velos',         target: 3,   reward: 30,  xp: 20 },
  { id: 'd_session_30', title: '30 Minutes Non-Stop', desc: 'Tenir 30 min de session',      type: 'session_time',  target: 30,  reward: 60,  xp: 40 },
  { id: 'd_balance_50', title: 'Petit Capitaliste',   desc: 'Gagner 50€ en une session',    type: 'session_earn',  target: 50,  reward: 50,  xp: 35 },
  { id: 'd_bus_3',      title: 'Arrêt de Bus',        desc: 'Compter 3 bus',                type: 'bus',           target: 3,   reward: 35,  xp: 20 },
  { id: 'd_engins_2',   title: 'Chantier en Vue',     desc: 'Compter 2 engins agricoles',   type: 'engins',        target: 2,   reward: 35,  xp: 20 },
  { id: 'd_rainbow',    title: 'Arc-en-Ciel Express', desc: 'Déclencher le bonus Arc-en-Ciel',type:'bonus_rainbow', target: 1,   reward: 80,  xp: 50 },
];

const WEEKLY_QUEST_POOL = [
  { id: 'w_trucks_100', title: 'La Semaine du Routier', desc: 'Compter 100 camions en une semaine', type: 'trucks_total',  target: 100, reward: 250, xp: 120 },
  { id: 'w_cars_200',   title: 'Grand Recensement',     desc: 'Compter 200 véhicules',              type: 'cars_total',    target: 200, reward: 200, xp: 100 },
  { id: 'w_sessions_5', title: 'Fidèle au Poste',       desc: 'Faire 5 sessions cette semaine',     type: 'sessions_count',target: 5,   reward: 180, xp: 90 },
  { id: 'w_earn_300',   title: 'Semaine Fructueuse',    desc: 'Gagner 300€ cette semaine',          type: 'week_earn',     target: 300, reward: 300, xp: 150 },
  { id: 'w_km_20',      title: 'Baroudeur',             desc: 'Parcourir 20 km cumulés',            type: 'km_total',      target: 20,  reward: 220, xp: 110 },
];

const SEASON_CHALLENGE_POOL = [
  { id: 's_trucks_500', title: 'Légende de la Route',   desc: '500 camions cette saison',   type: 'trucks_total',   target: 500,  reward: 1000, xp: 500 },
  { id: 's_level_10',   title: 'Vétéran Saisonnier',    desc: 'Atteindre le niveau 10',     type: 'level',          target: 10,   reward: 800,  xp: 400 },
  { id: 's_earn_2000',  title: 'Magnat de l\'Asphalte', desc: 'Cumuler 2000€ de gains',     type: 'total_earn',     target: 2000, reward: 1200, xp: 600 },
  { id: 's_sessions_20',title: 'Marathon du Trafic',    desc: '20 sessions cette saison',   type: 'sessions_count', target: 20,   reward: 900,  xp: 450 },
];

// ──────────────────────────────────────────────────────────
//  SAISONS (par trimestre)
// ──────────────────────────────────────────────────────────

function _getCurrentSeason() {
  const now    = new Date();
  const year   = now.getFullYear();
  const month  = now.getMonth(); // 0-11

  const seasons = [
    { name: '❄️ Saison Hiver',   months: [0,1,2],  start: `${year}-01-01`, end: `${year}-03-31` },
    { name: '🌸 Saison Printemps',months: [3,4,5],  start: `${year}-04-01`, end: `${year}-06-30` },
    { name: '☀️ Saison Été',      months: [6,7,8],  start: `${year}-07-01`, end: `${year}-09-30` },
    { name: '🍂 Saison Automne', months: [9,10,11], start: `${year}-10-01`, end: `${year}-12-31` },
  ];

  return seasons.find(s => s.months.includes(month)) || seasons[0];
}

function _pickRandom(pool, count) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ──────────────────────────────────────────────────────────
//  API PUBLIQUE
// ──────────────────────────────────────────────────────────

export const Gami = {

  /** Charge depuis Storage */
  load() {
    const saved = Storage.getGami();
    state.gami.xp      = saved.xp      || 0;
    state.gami.level   = saved.level   || 1;
    state.gami.talents = saved.talents || { oeil: false, nego: false, eco: false };

    // Quêtes journalières
    const today = new Date().toDateString();
    if (saved.lastDailyReset !== today) {
      state.gami.dailyQuests = _pickRandom(DAILY_QUEST_POOL, 3).map(q => ({ ...q, progress: 0, done: false }));
    } else {
      state.gami.dailyQuests = saved.dailyQuests || [];
    }

    // Quêtes hebdomadaires
    const weekStart = _getWeekStart().toDateString();
    if (saved.lastWeeklyReset !== weekStart) {
      state.gami.weeklyQuests = _pickRandom(WEEKLY_QUEST_POOL, 2).map(q => ({ ...q, progress: 0, done: false }));
    } else {
      state.gami.weeklyQuests = saved.weeklyQuests || [];
    }

    // Défis de saison
    state.gami.season = _getCurrentSeason();
    if (!saved.seasonChallenges || saved.seasonChallenges.length === 0) {
      state.gami.seasonChallenges = _pickRandom(SEASON_CHALLENGE_POOL, 3).map(q => ({ ...q, progress: 0, done: false }));
    } else {
      state.gami.seasonChallenges = saved.seasonChallenges;
    }
  },

  /** Sauvegarde */
  save() {
    Storage.saveGami({
      xp:                state.gami.xp,
      level:             state.gami.level,
      talents:           state.gami.talents,
      dailyQuests:       state.gami.dailyQuests,
      weeklyQuests:      state.gami.weeklyQuests,
      seasonChallenges:  state.gami.seasonChallenges,
      lastDailyReset:    new Date().toDateString(),
      lastWeeklyReset:   _getWeekStart().toDateString(),
    });
  },

  // ── XP & Niveaux ──────────────────────────────────────────

  gainXP(amount) {
    state.gami.xp += amount;
    let leveledUp = false;

    while (state.gami.xp >= xpForLevel(state.gami.level)) {
      state.gami.xp -= xpForLevel(state.gami.level);
      state.gami.level++;
      leveledUp = true;
      this._checkTalents();
    }

    Events.emit('gami:xp-gained', { amount, level: state.gami.level, xp: state.gami.xp });
    if (leveledUp) Events.emit('gami:level-up', { level: state.gami.level });
    this.save();
  },

  getXPForCurrentLevel() { return xpForLevel(state.gami.level); },

  _checkTalents() {
    const level = state.gami.level;
    for (const [key, threshold] of Object.entries(TALENT_THRESHOLDS)) {
      if (level >= threshold && !state.gami.talents[key]) {
        state.gami.talents[key] = true;
        Events.emit('gami:talent-unlocked', { talent: key });
      }
    }
  },

  // ── Quêtes ────────────────────────────────────────────────

  /**
   * Notifie le système de gamification d'un événement
   * (appelé par les autres modules via Events)
   */
  onVehicleCounted({ mode, type }) {
    const total  = this._getTotal(mode);
    const update = (quests) => {
      quests.forEach(q => {
        if (q.done) return;
        const hit = (q.type === 'trucks_total' && mode === 'trucks') ||
                    (q.type === 'cars_total'   && mode === 'cars')   ||
                    (q.type === type);
        if (hit) {
          q.progress = Math.min(q.progress + 1, q.target);
          if (q.progress >= q.target) this._completeQuest(q);
          Events.emit('gami:quest-updated', q);
        }
      });
    };
    update(state.gami.dailyQuests);
    update(state.gami.weeklyQuests);
    update(state.gami.seasonChallenges);
  },

  onBonusEarned(bonusType) {
    if (bonusType === 'rainbow') {
      this._updateQuestsByType('bonus_rainbow');
    }
  },

  onSessionStopped() {
    // session_count + km
    this._updateQuestsByType('sessions_count');
  },

  _updateQuestsByType(type) {
    [state.gami.dailyQuests, state.gami.weeklyQuests, state.gami.seasonChallenges].forEach(quests => {
      quests.forEach(q => {
        if (q.done || q.type !== type) return;
        q.progress = Math.min(q.progress + 1, q.target);
        if (q.progress >= q.target) this._completeQuest(q);
        Events.emit('gami:quest-updated', q);
      });
    });
  },

  _completeQuest(quest) {
    quest.done = true;
    this.gainXP(quest.xp);
    Events.emit('gami:quest-completed', quest);
  },

  /** Reroll d'une quête journalière non terminée */
  rerollDailyQuest(questId) {
    const idx = state.gami.dailyQuests.findIndex(q => q.id === questId && !q.done);
    if (idx === -1) return;
    const usedIds = state.gami.dailyQuests.map(q => q.id);
    const pool    = DAILY_QUEST_POOL.filter(q => !usedIds.includes(q.id));
    if (!pool.length) return;
    const newQuest = { ...pool[Math.floor(Math.random() * pool.length)], progress: 0, done: false };
    state.gami.dailyQuests[idx] = newQuest;
    Events.emit('gami:quest-rerolled', newQuest);
    this.save();
  },

  // ── Getters ───────────────────────────────────────────────

  getLevel()   { return state.gami.level; },
  getXP()      { return state.gami.xp; },
  getSeason()  { return state.gami.season || _getCurrentSeason(); },
  getDailyQuests()    { return state.gami.dailyQuests; },
  getWeeklyQuests()   { return state.gami.weeklyQuests; },
  getSeasonChallenges(){ return state.gami.seasonChallenges; },
  getTalents()        { return state.gami.talents; },

  _getTotal(mode) {
    if (mode === 'trucks') return state.counts.trucks.FR + state.counts.trucks.ETR;
    return Object.values(state.counts.cars).reduce((s,v)=>s+v, 0);
  },
};

function _getWeekStart() {
  const now = new Date();
  const day = now.getDay(); // 0=dim
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0,0,0,0);
  return monday;
}
