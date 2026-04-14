/**
 * core/events.js — Bus d'Événements Interne
 *
 * Découple les modules entre eux : un module publie un événement,
 * d'autres s'abonnent sans se connaître directement.
 *
 * Usage:
 *   import { Events } from './core/events.js';
 *   Events.on('vehicle:counted', handler);
 *   Events.emit('vehicle:counted', { mode: 'cars', type: 'voitures', weight: 1500 });
 *   Events.off('vehicle:counted', handler);
 *
 * Événements de l'application :
 *   vehicle:counted      — Un véhicule est comptabilisé
 *   session:started      — Chrono démarré
 *   session:stopped      — Chrono arrêté (session sauvegardée)
 *   session:tick         — Tick toutes les secondes
 *   finance:changed      — Solde modifié
 *   gami:xp-gained       — XP reçu
 *   gami:level-up        — Level up
 *   gami:quest-updated   — Progression d'une quête
 *   ui:tab-changed       — Changement d'onglet
 *   ai:prediction-ready  — Prédiction IA prête
 *   profile:changed      — Changement d'utilisateur/mode
 */

const _listeners = {};

export const Events = {
  /**
   * S'abonner à un événement
   * @param {string} event
   * @param {Function} handler
   */
  on(event, handler) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(handler);
  },

  /**
   * Se désabonner
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    if (!_listeners[event]) return;
    _listeners[event] = _listeners[event].filter(h => h !== handler);
  },

  /**
   * Émettre un événement (synchrone)
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    (_listeners[event] || []).forEach(handler => {
      try { handler(data); }
      catch (e) { console.error(`[Events] Erreur dans handler de "${event}":`, e); }
    });
  },

  /**
   * S'abonner une seule fois
   * @param {string} event
   * @param {Function} handler
   */
  once(event, handler) {
    const wrapped = (data) => {
      handler(data);
      this.off(event, wrapped);
    };
    this.on(event, wrapped);
  },
};
