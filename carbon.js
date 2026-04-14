/**
 * modules/carbon.js — Bilan Carbone
 *
 * Responsabilités :
 *  - Calculer les émissions CO2 totales vs quota autorisé
 *  - Calculer le bilan sur l'historique global
 *  - Fournir les données pour le dashboard environnemental
 */

import { state }   from '../core/state.js';
import { Storage } from '../core/storage.js';

// ──────────────────────────────────────────────────────────
//  QUOTA DE BASE (g/session)
// ──────────────────────────────────────────────────────────

const BASE_QUOTA_PER_SESSION = 50_000; // 50 kg équivalent

// ──────────────────────────────────────────────────────────
//  API PUBLIQUE
// ──────────────────────────────────────────────────────────

export const Carbon = {

  /**
   * Retourne le bilan de la session courante (mode cars)
   */
  getSessionBilan() {
    const emitted = state.weight.co2;     // g
    const quota   = BASE_QUOTA_PER_SESSION + state.weight.co2Quota; // g (base + bonus vélos)
    const ratio   = quota > 0 ? Math.min(emitted / quota, 1) : 0;
    const diff    = quota - emitted;
    return { emitted, quota, ratio, diff, positive: diff >= 0 };
  },

  /**
   * Calcule le bilan global depuis toutes les sessions sauvegardées (mode cars)
   */
  getGlobalBilan() {
    const sessions  = Storage.getSessions('cars');
    let totalCo2    = 0;
    let totalQuota  = 0;

    for (const s of sessions) {
      totalCo2   += s.co2    || 0;
      totalQuota += (s.co2Quota || 0) + BASE_QUOTA_PER_SESSION;
    }

    const diff = totalQuota - totalCo2;
    return {
      emitted: totalCo2,
      quota:   totalQuota,
      diff,
      positive: diff >= 0,
      sessions: sessions.length,
    };
  },

  /**
   * Données pour le graphique CO2 par type de véhicule (session courante)
   * @param {Array} sessionEntries  — Liste des entrées { type, co2 }
   */
  getCo2ByType(sessionEntries = []) {
    const by = {};
    for (const entry of sessionEntries) {
      by[entry.type] = (by[entry.type] || 0) + (entry.co2 || 0);
    }
    return by;
  },

  /**
   * Données d'évolution CO2/Quota sur les 10 dernières sessions
   */
  getCo2Evolution() {
    const sessions = Storage.getSessions('cars').slice(-10);
    return sessions.map(s => {
      const quota = (s.co2Quota || 0) + BASE_QUOTA_PER_SESSION;
      return {
        date:  s.date,
        ratio: quota > 0 ? Math.round((s.co2 || 0) / quota * 100) : 0,
      };
    });
  },
};
