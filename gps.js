/**
 * modules/gps.js — GPS, Chronomètre, Wake Lock, Distance
 *
 * Responsabilités :
 *  - Démarrer/arrêter le chronomètre (avec persistance des ms)
 *  - Suivre la position GPS et calculer la distance
 *  - Gérer le Wake Lock (empêcher l'écran de s'éteindre)
 *  - Émettre session:started, session:stopped, session:tick
 */

import { state } from '../core/state.js';
import { Events } from '../core/events.js';

// ──────────────────────────────────────────────────────────
//  UTILITAIRES PRIVÉS
// ──────────────────────────────────────────────────────────

/** Distance entre deux coordonnées GPS en km (formule Haversine) */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Formate des millisecondes en "HH:MM:SS" */
export function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Wake Lock handle global
let _wakeLock = null;

async function _requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    Events.emit('ui:wake-lock-changed', true);
    _wakeLock.addEventListener('release', () => {
      Events.emit('ui:wake-lock-changed', false);
    });
  } catch (e) {
    console.warn('[GPS] Wake Lock non disponible :', e.message);
  }
}

async function _releaseWakeLock() {
  if (_wakeLock) {
    await _wakeLock.release();
    _wakeLock = null;
  }
}

// ──────────────────────────────────────────────────────────
//  API PUBLIQUE
// ──────────────────────────────────────────────────────────

export const GPS = {

  /**
   * Démarre (ou reprend) le chrono d'un mode.
   * @param {'trucks'|'cars'} mode
   */
  async start(mode) {
    const session = state.sessions[mode];
    if (session.running) return;

    session.running = true;
    session.startTime = Date.now();

    // Tick toutes les secondes
    session.intervalId = setInterval(() => {
      session.elapsed = (Date.now() - session.startTime) +
        (session.elapsed || 0);
      // On recalcule proprement depuis le début du tick courant
      const elapsed = Date.now() - session.startTime + (session._baseElapsed || 0);
      Events.emit('session:tick', { mode, elapsed });
    }, 1000);

    // Mémoriser la base avant ce démarrage
    session._baseElapsed = session.elapsed;
    session.elapsed = 0;
    session.startTime = Date.now();

    // GPS
    this._startGPS(mode);

    // Wake Lock
    await _requestWakeLock();

    Events.emit('session:started', { mode });
  },

  /**
   * Met en pause (sans effacer les compteurs).
   * @param {'trucks'|'cars'} mode
   */
  pause(mode) {
    const session = state.sessions[mode];
    if (!session.running) return;

    clearInterval(session.intervalId);
    session.intervalId = null;
    session.elapsed = Date.now() - session.startTime + (session._baseElapsed || 0);
    session._baseElapsed = session.elapsed;
    session.running = false;

    _releaseWakeLock();
    Events.emit('session:paused', { mode });
  },

  /**
   * Arrête complètement la session et émet session:stopped
   * avec les données résumées. C'est le module counter/finance
   * qui appellera Counter.getTotal() etc. pour construire le résumé.
   * @param {'trucks'|'cars'} mode
   */
  stop(mode) {
    const session = state.sessions[mode];
    if (session.intervalId) { clearInterval(session.intervalId); session.intervalId = null; }
    if (session.gpsWatchId) { navigator.geolocation?.clearWatch(session.gpsWatchId); session.gpsWatchId = null; }

    const totalElapsed = session.running
      ? (Date.now() - session.startTime + (session._baseElapsed || 0))
      : (session._baseElapsed || 0);

    session.running = false;
    session._baseElapsed = 0;
    session.elapsed = 0;

    _releaseWakeLock();
    Events.emit('session:stopped', { mode, elapsed: totalElapsed, coords: [...session.coords], distanceKm: session.distanceKm });

    // Reset coords
    session.coords = [];
    session.distanceKm = 0;
  },

  /**
   * Retourne l'elapsed en ms de façon cohérente (running ou non).
   */
  getElapsed(mode) {
    const s = state.sessions[mode];
    if (s.running) {
      return Date.now() - s.startTime + (s._baseElapsed || 0);
    }
    return s._baseElapsed || 0;
  },

  // ── GPS interne ───────────────────────────────────────────

  _startGPS(mode) {
    if (!navigator.geolocation) return;
    const session = state.sessions[mode];

    session.gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, altitude } = pos.coords;
        const coords = session.coords;

        if (coords.length > 0) {
          const last = coords[coords.length - 1];
          session.distanceKm += haversineKm(last.lat, last.lng, lat, lng);
        }

        coords.push({ lat, lng, ts: Date.now() });
        if (altitude !== null) state.altitude = altitude;

        Events.emit('session:gps-updated', {
          mode, lat, lng, altitude,
          distanceKm: session.distanceKm,
        });
      },
      (err) => console.warn('[GPS] Erreur géolocalisation :', err.message),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
  },

  // ── Statut ────────────────────────────────────────────────

  getStatusLabel() {
    if (!navigator.geolocation) return '📍 GPS indisponible';
    if (state.sessions.trucks.gpsWatchId || state.sessions.cars.gpsWatchId) {
      return `📍 GPS actif (${state.altitude ? state.altitude.toFixed(0) + 'm' : '...'})`;
    }
    return '📍 GPS en attente';
  },

  getWakeLockLabel() {
    return _wakeLock ? '🔆 Écran maintenu' : '⚙️ Écran libre';
  },
};
