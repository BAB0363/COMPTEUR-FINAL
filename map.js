/**
 * ui/map.js — Carte Leaflet + Heatmap
 *
 * Responsabilités :
 *  - Initialiser les cartes Leaflet (trucks et cars)
 *  - Ajouter des points GPS en temps réel
 *  - Afficher la heatmap depuis l'historique des sessions
 *  - Gérer le thème de la carte (tiles claires/sombres)
 */

// ──────────────────────────────────────────────────────────
//  INSTANCES
// ──────────────────────────────────────────────────────────

const _maps  = {};    // { trucks: L.Map, cars: L.Map }
const _heats = {};    // { trucks: L.HeatLayer, cars: L.HeatLayer }
const _markers = {};  // { trucks: L.Marker, cars: L.Marker }

// Tiles jour et nuit
const TILES = {
  light: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  dark:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
const ATTRIBUTION = '© <a href="https://openstreetmap.org">OSM</a>';

// ──────────────────────────────────────────────────────────
//  API PUBLIQUE
// ──────────────────────────────────────────────────────────

export const MapUI = {

  /**
   * Initialise (ou réinitialise) la carte d'un mode.
   * @param {'trucks'|'cars'} mode
   * @param {Array} heatPoints  — Coordonnées GPS de l'historique [{lat, lng}]
   */
  init(mode, heatPoints = []) {
    const containerId = `map-${mode}`;
    const container = document.getElementById(containerId);
    if (!container) return;

    // Détruire la carte existante si présente
    if (_maps[mode]) {
      _maps[mode].remove();
      delete _maps[mode];
      delete _heats[mode];
      delete _markers[mode];
    }

    const dark = document.body.classList.contains('dark');
    const tileUrl = dark ? TILES.dark : TILES.light;

    const map = L.map(containerId, { zoomControl: true, attributionControl: false });
    L.tileLayer(tileUrl, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
    L.control.attribution({ prefix: false }).addTo(map);

    _maps[mode] = map;

    // Vue initiale : France
    map.setView([46.6, 2.3], 6);

    // Heatmap depuis l'historique
    if (heatPoints.length > 0) {
      const latlngs = heatPoints.map(p => [p.lat, p.lng, 0.5]);
      if (window.L.heatLayer) {
        const heat = L.heatLayer(latlngs, {
          radius: 22, blur: 15, maxZoom: 14,
          gradient: dark
            ? { 0.4: '#00D4FF', 0.65: '#C026FE', 1.0: '#FF3131' }
            : { 0.4: '#2EAD4B', 0.65: '#F5A623', 1.0: '#D93025' },
        });
        heat.addTo(map);
        _heats[mode] = heat;

        // Fitbounds sur les points
        if (latlngs.length > 1) {
          try { map.fitBounds(latlngs.map(p => [p[0], p[1]])); }
          catch (_) {}
        }
      }
    }
  },

  /**
   * Ajoute un point GPS en temps réel et déplace le marqueur.
   * @param {'trucks'|'cars'} mode
   * @param {number} lat
   * @param {number} lng
   */
  addPoint(mode, lat, lng) {
    const map = _maps[mode];
    if (!map) return;

    // Marqueur position actuelle
    if (_markers[mode]) {
      _markers[mode].setLatLng([lat, lng]);
    } else {
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:14px;height:14px;border-radius:50%;
          background:${document.body.classList.contains('dark') ? '#00F566' : '#0057B8'};
          border:3px solid white;
          box-shadow:0 0 8px rgba(0,0,0,0.4);
        "></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      _markers[mode] = L.marker([lat, lng], { icon }).addTo(map);
    }

    // Ajouter le point à la heatmap
    if (_heats[mode]) {
      _heats[mode].addLatLng([lat, lng, 1.0]);
    }

    // Recentrer doucement
    map.panTo([lat, lng], { animate: true, duration: 0.8 });
  },

  /**
   * Met à jour le thème des tiles lors du changement jour/nuit.
   */
  updateTheme() {
    const dark = document.body.classList.contains('dark');
    const tileUrl = dark ? TILES.dark : TILES.light;

    Object.values(_maps).forEach(map => {
      map.eachLayer(layer => {
        if (layer instanceof L.TileLayer) {
          map.removeLayer(layer);
        }
      });
      L.tileLayer(tileUrl, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);

      // Mise à jour gradient heatmap
      const mode = Object.keys(_maps).find(k => _maps[k] === map);
      if (mode && _heats[mode]) {
        _heats[mode].setOptions({
          gradient: dark
            ? { 0.4: '#00D4FF', 0.65: '#C026FE', 1.0: '#FF3131' }
            : { 0.4: '#2EAD4B', 0.65: '#F5A623', 1.0: '#D93025' },
        });
      }
    });
  },

  /**
   * Force le redimensionnement des cartes (après toggle de vue).
   */
  invalidateSize(mode) {
    if (_maps[mode]) {
      setTimeout(() => _maps[mode].invalidateSize(), 100);
    }
  },

  /**
   * Extrait tous les points GPS des sessions sauvegardées.
   * @param {Array} sessions
   * @returns {Array} [{lat, lng}]
   */
  extractHeatPoints(sessions) {
    const points = [];
    sessions.forEach(s => {
      (s.coords || []).forEach(c => {
        if (c.lat && c.lng) points.push({ lat: c.lat, lng: c.lng });
      });
    });
    return points;
  },
};
