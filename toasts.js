/**
 * ui/toasts.js — Notifications In-Game & Particules
 *
 * Responsabilités :
 *  - Afficher des toasts temporaires (success/warning/danger/info)
 *  - Créer des particules de clic (emoji flottants)
 *  - Créer des particules financières (+5€ / -2€)
 */

// ──────────────────────────────────────────────────────────
//  TOAST
// ──────────────────────────────────────────────────────────

const TOAST_DURATION = 2800;

export const Toasts = {

  /**
   * Affiche un toast.
   * @param {string} message
   * @param {'success'|'warning'|'danger'|'info'} type
   */
  show(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);

    // Forcer le reflow pour déclencher l'animation
    void el.offsetHeight;
    el.classList.add('show');

    setTimeout(() => {
      el.classList.remove('show');
      el.classList.add('hide');
      setTimeout(() => el.remove(), 400);
    }, TOAST_DURATION);
  },

  success(msg) { this.show(msg, 'success'); },
  warning(msg) { this.show(msg, 'warning'); },
  danger(msg)  { this.show(msg, 'danger');  },
  info(msg)    { this.show(msg, 'info');    },
};

// ──────────────────────────────────────────────────────────
//  PARTICULES
// ──────────────────────────────────────────────────────────

export const Particles = {

  /**
   * Particule emoji au clic (sur un bouton de comptage)
   * @param {number} x  — clientX
   * @param {number} y  — clientY
   * @param {string} emoji
   */
  spawnEmoji(x, y, emoji = '✅') {
    const el = document.createElement('div');
    el.className = 'click-particle';
    el.textContent = emoji;
    el.style.left = `${x}px`;
    el.style.top  = `${y}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700);
  },

  /**
   * Particule monétaire flottante
   * @param {number} amount  — Positif ou négatif
   * @param {number} x
   * @param {number} y
   */
  spawnMoney(amount, x, y) {
    const el = document.createElement('div');
    el.className = `money-particle ${amount >= 0 ? 'money-up' : 'money-down'}`;
    el.textContent = `${amount >= 0 ? '+' : ''}${amount.toFixed(2)} €`;
    el.style.left = `${x}px`;
    el.style.top  = `${y}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  },

  /**
   * Particule générique (pour les bonus/malus)
   * @param {string} text
   * @param {string} color  — ex: '#00F566'
   */
  spawnText(text, color = '#fff') {
    const x = window.innerWidth  / 2;
    const y = window.innerHeight / 2;
    const el = document.createElement('div');
    el.className = 'click-particle';
    el.textContent = text;
    el.style.left  = `${x}px`;
    el.style.top   = `${y}px`;
    el.style.color = color;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700);
  },
};
