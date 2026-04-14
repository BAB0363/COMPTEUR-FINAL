/**
 * ui/modals.js — Gestion des Modales
 *
 * Responsabilités :
 *  - Ouvrir/fermer les modales par ID
 *  - Construire le contenu des modales dynamiquement
 *  - Modale détail session, banque, guide des règles
 */

import { Finance } from '../modules/finance.js';
import { Storage } from '../core/storage.js';

// ──────────────────────────────────────────────────────────
//  UTILITAIRES
// ──────────────────────────────────────────────────────────

function _fmt(n) { return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function _fmtDate(iso) { return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }

// ──────────────────────────────────────────────────────────
//  API PUBLIQUE
// ──────────────────────────────────────────────────────────

export const Modals = {

  /** Ouvre une modale par son ID */
  open(id) {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'flex'; el.classList.add('open'); }
  },

  /** Ferme une modale par son ID */
  close(id) {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.classList.remove('open'); }
  },

  /** Ferme toutes les modales */
  closeAll() {
    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.style.display = 'none';
      el.classList.remove('open');
    });
  },

  // ── Modale Banque ──────────────────────────────────────

  openBank() {
    const gains  = Finance.getTotalGains();
    const losses = Math.abs(Finance.getTotalLosses());
    const history = Finance.getHistory();

    document.getElementById('bank-total-gains').textContent  = `${_fmt(gains)} €`;
    document.getElementById('bank-total-losses').textContent = `${_fmt(losses)} €`;

    const list = document.getElementById('bank-history-list');
    list.innerHTML = history.length
      ? history.slice(0, 50).map(e => `
          <div class="detail-row">
            <span class="detail-label">${_fmtDate(e.date)}<br><small style="font-weight:400">${e.label}</small></span>
            <span class="detail-value ${e.amount >= 0 ? 'text-green' : 'text-red'}">${e.amount >= 0 ? '+' : ''}${_fmt(e.amount)} €</span>
          </div>`).join('')
      : '<p class="text-muted center" style="padding:20px">Aucune transaction</p>';

    this.open('bank-modal');
  },

  // ── Modale Détail Session ─────────────────────────────

  openSession(session, charts) {
    const el = document.getElementById('session-detail-modal');
    if (!el) return;

    const title = document.getElementById('modal-session-title');
    const content = document.getElementById('modal-session-content');

    title.textContent = `📋 Session du ${_fmtDate(session.date)}`;

    // Informations générales
    const rows = [
      ['📅 Date',       _fmtDate(session.date)],
      ['⏱️ Durée',      session.duration || '—'],
      ['📍 Distance',   session.distanceKm ? `${session.distanceKm.toFixed(2)} km` : '—'],
      ['🚗 Total',      session.total || 0],
      ['⚖️ Poids',      session.weight ? `${(session.weight/1000).toFixed(1)} t` : '—'],
      ['🌿 CO2 émis',   session.co2 ? `${(session.co2/1000).toFixed(2)} kg` : '—'],
      ['💰 Gains sess.',session.sessionBalance ? `${_fmt(session.sessionBalance)} €` : '—'],
    ];

    content.innerHTML = rows.map(([label, value]) => `
      <div class="detail-row">
        <span class="detail-label">${label}</span>
        <span class="detail-value">${value}</span>
      </div>`).join('');

    this.open('session-detail-modal');

    // Graphiques (délayés pour attendre le rendu)
    setTimeout(() => charts?.renderSessionCharts(session), 100);
  },

  // ── Guide des règles ───────────────────────────────────

  openGuide() {
    this.open('guide-modal');
  },
};
