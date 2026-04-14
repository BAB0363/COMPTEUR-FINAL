/**
 * modules/sponsor.js — Contrats Sponsors
 *
 * Responsabilités :
 *  - Générer des offres de sponsoring aléatoires
 *  - Gérer le cycle : offre → signature → progression → validation
 *  - Intégrer le talent Négociateur (+20% avances)
 */

import { state } from '../core/state.js';
import { Events } from '../core/events.js';
import { Finance } from './finance.js';

// ──────────────────────────────────────────────────────────
//  CATALOGUE DES SPONSORS
// ──────────────────────────────────────────────────────────

const SPONSORS = [
  { id: 'diesel_king',  name: '⛽ Diesel King',   type: 'trucks', target: 15, reward: 80,  objective: 'Compter {n} camions' },
  { id: 'route66',      name: '🛣️ Route 66',       type: 'cars',   target: 30, reward: 60,  objective: 'Compter {n} véhicules' },
  { id: 'eco_drive',    name: '🌿 Éco Drive',      type: 'velos',  target: 5,  reward: 40,  objective: 'Compter {n} vélos' },
  { id: 'turbo_motos',  name: '🏍️ Turbo Motos',    type: 'motos',  target: 10, reward: 55,  objective: 'Compter {n} motos' },
  { id: 'bigload',      name: '🚛 Big Load Co.',   type: 'FR',     target: 20, reward: 90,  objective: 'Compter {n} camions FR' },
  { id: 'bus_express',  name: '🚌 Bus Express',    type: 'bus',    target: 8,  reward: 70,  objective: 'Compter {n} bus' },
  { id: 'agri_partner', name: '🚜 Agri Partner',   type: 'engins', target: 6,  reward: 65,  objective: 'Compter {n} engins agri' },
];

// ──────────────────────────────────────────────────────────
//  API PUBLIQUE
// ──────────────────────────────────────────────────────────

export const Sponsor = {

  /**
   * Génère une offre aléatoire et la place dans state.sponsor.pendingOffer
   * Appelé par le module GPS au démarrage de la session cars.
   */
  generateOffer() {
    if (state.sponsor.active) return; // Contrat déjà en cours
    const candidate = SPONSORS[Math.floor(Math.random() * SPONSORS.length)];
    state.sponsor.pendingOffer = {
      ...candidate,
      progress: 0,
      objective: candidate.objective.replace('{n}', candidate.target),
    };
    Events.emit('sponsor:offer-ready', state.sponsor.pendingOffer);
  },

  /** L'utilisateur accepte l'offre */
  accept() {
    const offer = state.sponsor.pendingOffer;
    if (!offer) return;

    // Avance : 20% du reward (talent Négociateur +20%)
    let advance = offer.reward * 0.20;
    if (state.gami.talents.nego) advance *= 1.20;

    state.sponsor.active      = { ...offer };
    state.sponsor.pendingOffer = null;

    Finance.transact(advance, `🤝 Avance Sponsor : ${offer.name}`, 'sponsor');
    Events.emit('sponsor:signed', state.sponsor.active);
  },

  /** L'utilisateur refuse l'offre */
  refuse() {
    state.sponsor.pendingOffer = null;
    Events.emit('sponsor:refused');
  },

  /**
   * Met à jour la progression du contrat actif.
   * Appelé par le handler vehicle:counted.
   */
  onVehicleCounted({ type }) {
    const contract = state.sponsor.active;
    if (!contract) return;

    if (type === contract.type || contract.type === 'cars') {
      contract.progress++;
      Events.emit('sponsor:progress-updated', { contract });

      if (contract.progress >= contract.target) {
        Events.emit('sponsor:objective-reached', { contract });
      }
    }
  },

  /** L'utilisateur valide et encaisse */
  validate() {
    const contract = state.sponsor.active;
    if (!contract || contract.progress < contract.target) return;

    // Solde final = reward - avance déjà versée
    const remaining = contract.reward * 0.80;
    let final = remaining;
    if (state.gami.talents.nego) final *= 1.20;

    Finance.transact(final, `💰 Solde Sponsor : ${contract.name}`, 'sponsor');
    state.sponsor.active = null;
    Events.emit('sponsor:validated');
  },

  getActive() { return state.sponsor.active; },
  getPending() { return state.sponsor.pendingOffer; },
};
