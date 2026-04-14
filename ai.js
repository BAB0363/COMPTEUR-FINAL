/**
 * modules/ai.js — Intelligence Artificielle (TensorFlow.js)
 *
 * Responsabilités :
 *  - Entraîner un modèle de séquence (LSTM simplifié) par mode
 *  - Prédire le prochain type de véhicule
 *  - Exposer : prediction, confidence, podium, journal
 *  - Émettre ai:prediction-ready
 */

import { state }   from '../core/state.js';
import { Events }  from '../core/events.js';
import { Storage } from '../core/storage.js';

// ──────────────────────────────────────────────────────────
//  CONFIGURATION
// ──────────────────────────────────────────────────────────

const TRUCK_TYPES = ['FR', 'ETR'];
const CAR_TYPES   = ['voitures', 'utilitaires', 'motos', 'camions', 'camping', 'bus', 'engins', 'velos'];
const SEQ_LEN     = 5;    // Longueur de la séquence d'entrée
const EPOCHS      = 40;
const BATCH_SIZE  = 16;

// ──────────────────────────────────────────────────────────
//  ÉTAT INTERNE
// ──────────────────────────────────────────────────────────

const _models  = { trucks: null, cars: null };
const _history = { trucks: [], cars: [] };   // séquences de types (string[])
const _trained = { trucks: false, cars: false };

// ──────────────────────────────────────────────────────────
//  UTILITAIRES
// ──────────────────────────────────────────────────────────

function _getTypes(mode) {
  return mode === 'trucks' ? TRUCK_TYPES : CAR_TYPES;
}

function _typeToIndex(mode, type) {
  return _getTypes(mode).indexOf(type);
}

function _oneHot(index, size) {
  const arr = new Array(size).fill(0);
  arr[index] = 1;
  return arr;
}

function _prepareDataset(mode) {
  const hist  = _history[mode];
  const types = _getTypes(mode);
  const size  = types.length;

  if (hist.length <= SEQ_LEN) return null;

  const xs = [], ys = [];
  for (let i = 0; i < hist.length - SEQ_LEN; i++) {
    const seq  = hist.slice(i, i + SEQ_LEN);
    const next = hist[i + SEQ_LEN];
    const seqEncoded = seq.map(t => _oneHot(_typeToIndex(mode, t), size)).flat();
    xs.push(seqEncoded);
    ys.push(_oneHot(_typeToIndex(mode, next), size));
  }

  return {
    xs: window.tf.tensor2d(xs, [xs.length, SEQ_LEN * size]),
    ys: window.tf.tensor2d(ys, [ys.length, size]),
    inputSize: SEQ_LEN * size,
    outputSize: size,
  };
}

function _buildModel(inputSize, outputSize) {
  const model = window.tf.sequential();
  model.add(window.tf.layers.dense({ units: 32, activation: 'relu',    inputShape: [inputSize] }));
  model.add(window.tf.layers.dropout({ rate: 0.2 }));
  model.add(window.tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(window.tf.layers.dense({ units: outputSize, activation: 'softmax' }));
  model.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
  return model;
}

// ──────────────────────────────────────────────────────────
//  API PUBLIQUE
// ──────────────────────────────────────────────────────────

export const AI = {

  isAvailable() { return typeof window.tf !== 'undefined'; },

  isTrained(mode) { return _trained[mode]; },

  /**
   * Enregistre un type dans l'historique de séquence
   * (appelé par vehicle:counted)
   */
  record(mode, type) {
    _history[mode].push(type);
    if (_history[mode].length > 500) _history[mode].shift();

    // Auto-entraînement tous les 20 nouveaux points
    if (_history[mode].length % 20 === 0 && _history[mode].length >= SEQ_LEN + 1) {
      this.train(mode, true); // silent = true
    }
  },

  /**
   * Entraîne le modèle.
   * @param {boolean} silent — Si true, pas de toast
   */
  async train(mode, silent = false) {
    if (!this.isAvailable()) return;
    const data = _prepareDataset(mode);
    if (!data) return;

    Events.emit('ai:training-started', { mode });

    const model = _buildModel(data.inputSize, data.outputSize);
    await model.fit(data.xs, data.ys, {
      epochs: EPOCHS,
      batchSize: BATCH_SIZE,
      shuffle: true,
      verbose: 0,
    });

    data.xs.dispose();
    data.ys.dispose();

    _models[mode]  = model;
    _trained[mode] = true;

    // Sauvegarde des métadonnées
    Storage.saveAiMeta(mode, { trained: true, historyLen: _history[mode].length });

    Events.emit('ai:training-done', { mode, silent });

    // Lance une prédiction immédiatement
    this.predict(mode);
  },

  /**
   * Lance une prédiction et émet ai:prediction-ready
   */
  predict(mode) {
    if (!_models[mode] || !_trained[mode]) {
      Events.emit('ai:prediction-ready', {
        mode,
        prediction: null,
        confidence: 0,
        podium: [],
        journal: 'Modèle non entraîné — continuez à compter !',
      });
      return;
    }

    const types = _getTypes(mode);
    const hist  = _history[mode];
    if (hist.length < SEQ_LEN) {
      Events.emit('ai:prediction-ready', {
        mode, prediction: null, confidence: 0, podium: [],
        journal: `Besoin de ${SEQ_LEN - hist.length} passages de plus...`,
      });
      return;
    }

    const seq  = hist.slice(-SEQ_LEN);
    const size = types.length;
    const input = seq.map(t => _oneHot(_typeToIndex(mode, t), size)).flat();
    const tensor = window.tf.tensor2d([input], [1, SEQ_LEN * size]);

    const probs = Array.from(_models[mode].predict(tensor).dataSync());
    tensor.dispose();

    // Podium top 3
    const sorted = probs
      .map((p, i) => ({ type: types[i], prob: p }))
      .sort((a, b) => b.prob - a.prob);

    const best       = sorted[0];
    const confidence = best.prob;
    const podium     = sorted.slice(0, 3);
    const journal    = `Seq: ${seq.slice(-3).join('→')} | Conf: ${(confidence*100).toFixed(0)}%`;

    // Stock dans state
    state.ai[mode] = { prediction: best.type, confidence, podium, journal };

    Events.emit('ai:prediction-ready', { mode, prediction: best.type, confidence, podium, journal });
  },

  /**
   * Vérifie si la prédiction correspond au véhicule compté
   * et applique les malus/bonus correspondants.
   */
  checkPrediction(mode, actualType) {
    const aiState = state.ai[mode];
    if (!aiState.prediction) return;

    const correct = aiState.prediction === actualType;
    const confident = aiState.confidence > 0.70;

    Events.emit('ai:prediction-checked', { mode, correct, confident, actualType, predicted: aiState.prediction });

    // Malus si l'IA était sûre et qu'on a mis quelque chose de différent
    // (le module finance s'abonne à cet événement)
    if (!correct && confident) {
      Events.emit('ai:confident-wrong', { mode });
    }
  },

  // ── Entraînement forcé (depuis les paramètres) ────────────

  async forceTraining() {
    Events.emit('ai:training-started', { mode: 'all' });
    await this.train('trucks', false);
    await this.train('cars',   false);
  },

  // ── Chargement des historiques depuis les sessions ────────

  loadHistoryFromSessions(mode, sessions) {
    const hist = [];
    for (const session of sessions) {
      if (session.entries) {
        for (const entry of session.entries) {
          if (entry.type) hist.push(entry.type);
        }
      }
    }
    _history[mode] = hist.slice(-500);
    if (_history[mode].length > SEQ_LEN + 5) {
      this.train(mode, true);
    }
  },

  getStatus(mode) {
    const meta = Storage.getAiMeta(mode);
    return { trained: _trained[mode], historyLen: _history[mode].length, meta };
  },
};
