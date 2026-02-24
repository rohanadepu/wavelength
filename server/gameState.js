const { getShuffledCards } = require('./spectrumCards');

class GameState {
  constructor(roomCode, hostId) {
    this.roomCode = roomCode;
    this.hostId = hostId;
    this.players = new Map(); // id -> { id, name, emoji, color, isHost }
    this.phase = 'lobby'; // lobby | psychic_clue | dial | reveal | score | game_over
    this.currentRound = 0;
    this.totalRounds = 10;
    this.scores = []; // per-round scores
    this.totalScore = 0;

    // Round state
    this.cards = [];
    this.currentCard = null;
    this.targetPosition = 0; // 0-100
    this.psychicId = null;
    this.psychicIndex = 0;
    this.clue = '';
    this.dialPositions = new Map(); // playerId -> position (0-100)
    this.averageDialPosition = 50;
    this.readyPlayers = new Set();
  }

  addPlayer(id, name, emoji, color) {
    this.players.set(id, {
      id,
      name: name || `Player ${this.players.size + 1}`,
      emoji: emoji || '😎',
      color: color || '#7c3aed',
      isHost: id === this.hostId,
    });
  }

  removePlayer(id) {
    this.players.delete(id);
    this.dialPositions.delete(id);
    this.readyPlayers.delete(id);

    // If host left, assign new host
    if (id === this.hostId && this.players.size > 0) {
      const newHost = this.players.keys().next().value;
      this.hostId = newHost;
      this.players.get(newHost).isHost = true;
    }

    // Recalculate average if in dial phase
    if (this.phase === 'dial') {
      this.recalculateAverage();
    }
  }

  startGame() {
    this.cards = getShuffledCards();
    this.currentRound = 0;
    this.scores = [];
    this.totalScore = 0;
    this.psychicIndex = 0;
    this.startNewRound();
  }

  startNewRound() {
    this.currentRound++;
    if (this.currentRound > this.totalRounds || this.cards.length === 0) {
      this.phase = 'game_over';
      return false;
    }

    // Pick next psychic (rotate through players)
    const playerIds = Array.from(this.players.keys());
    this.psychicId = playerIds[this.psychicIndex % playerIds.length];
    this.psychicIndex++;

    // Draw a card
    this.currentCard = this.cards.pop();

    // Random target between 5 and 95 (avoid extreme edges)
    this.targetPosition = Math.floor(Math.random() * 81) + 10;

    // Reset round state
    this.clue = '';
    this.dialPositions.clear();
    this.readyPlayers.clear();
    this.averageDialPosition = 50;

    // Initialize all non-psychic dials to center
    for (const [pid] of this.players) {
      if (pid !== this.psychicId) {
        this.dialPositions.set(pid, 50);
      }
    }

    this.phase = 'psychic_clue';
    return true;
  }

  submitClue(playerId, clue) {
    if (playerId !== this.psychicId) return false;
    if (this.phase !== 'psychic_clue') return false;
    this.clue = clue;
    this.phase = 'dial';
    return true;
  }

  moveDial(playerId, position) {
    if (this.phase !== 'dial') return false;
    if (playerId === this.psychicId) return false;
    
    // Clamp position
    const clamped = Math.max(0, Math.min(100, position));
    this.dialPositions.set(playerId, clamped);
    this.recalculateAverage();
    return true;
  }

  recalculateAverage() {
    if (this.dialPositions.size === 0) {
      this.averageDialPosition = 50;
      return;
    }
    let sum = 0;
    for (const pos of this.dialPositions.values()) {
      sum += pos;
    }
    this.averageDialPosition = sum / this.dialPositions.size;
  }

  setReady(playerId) {
    if (this.phase !== 'dial') return false;
    if (playerId === this.psychicId) return false;
    this.readyPlayers.add(playerId);

    // Check if all non-psychic players are ready
    const nonPsychicCount = this.players.size - 1;
    return this.readyPlayers.size >= nonPsychicCount;
  }

  revealAndScore() {
    this.phase = 'reveal';
    const distance = Math.abs(this.averageDialPosition - this.targetPosition);
    
    let points = 0;
    if (distance <= 4) {
      points = 4; // Bulls-eye
    } else if (distance <= 10) {
      points = 3; // Close
    } else if (distance <= 18) {
      points = 2; // Edge
    } else {
      points = 0; // Miss
    }

    this.scores.push({
      round: this.currentRound,
      card: this.currentCard,
      clue: this.clue,
      target: this.targetPosition,
      dial: this.averageDialPosition,
      distance: distance,
      points: points,
      psychicName: this.players.get(this.psychicId)?.name || 'Unknown',
    });

    this.totalScore += points;
    return { points, distance, target: this.targetPosition, dial: this.averageDialPosition };
  }

  getPlayerList() {
    return Array.from(this.players.values());
  }

  getPublicState(forPlayerId) {
    const isPsychic = forPlayerId === this.psychicId;
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      players: this.getPlayerList(),
      currentRound: this.currentRound,
      totalRounds: this.totalRounds,
      totalScore: this.totalScore,
      scores: this.scores,
      psychicId: this.psychicId,
      isPsychic,
      currentCard: this.currentCard,
      targetPosition: isPsychic || this.phase === 'reveal' || this.phase === 'game_over' ? this.targetPosition : null,
      clue: this.clue,
      averageDialPosition: this.averageDialPosition,
      readyCount: this.readyPlayers.size,
      totalGuessers: Math.max(0, this.players.size - 1),
      isReady: this.readyPlayers.has(forPlayerId),
    };
  }
}

module.exports = { GameState };
