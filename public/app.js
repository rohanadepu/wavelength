/* ═══════════════════════════════════════════════════════════════
   WAVELENGTH — Main Application JS
   WebSocket client, game flow, dial interaction, emoji reactions
   ═══════════════════════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────
let ws = null;
let myPlayerId = null;
let myRoomCode = null;
let gameState = null;
let isCreating = false; // true = create, false = join
let selectedEmoji = '😎';
let selectedColor = '#7c3aed';
let myName = '';
let isDragging = false;
let myDialPosition = 50;

// ─── DOM Refs ───────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Screens
const screens = {
  landing: $('#screen-landing'),
  name: $('#screen-name'),
  lobby: $('#screen-lobby'),
  game: $('#screen-game'),
  reveal: $('#screen-reveal'),
  gameover: $('#screen-gameover'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  // Show/hide emoji bar only during game
  const emojiBar = $('#emoji-bar');
  if (name === 'game') {
    emojiBar.style.display = 'flex';
  } else {
    emojiBar.style.display = 'none';
  }
}

// ─── WebSocket ──────────────────────────────────
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}`);

  ws.onopen = () => console.log('🌊 Connected');

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

  ws.onclose = () => {
    console.log('Disconnected, reconnecting...');
    setTimeout(connectWS, 2000);
  };

  ws.onerror = () => {};
}

function send(data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

// ─── Message Handler ────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'room_created':
      myPlayerId = msg.playerId;
      myRoomCode = msg.roomCode;
      gameState = msg.state;
      showLobby();
      break;

    case 'room_joined':
      myPlayerId = msg.playerId;
      myRoomCode = msg.roomCode;
      gameState = msg.state;
      showLobby();
      break;

    case 'player_joined':
      if (gameState) {
        gameState.players = msg.players;
      }
      renderLobbyPlayers();
      break;

    case 'player_left':
      if (gameState) {
        gameState.players = msg.players;
      }
      renderLobbyPlayers();
      break;

    case 'game_state':
      gameState = msg.state;
      renderGameState();
      break;

    case 'clue_submitted':
      // Will be handled via game_state
      break;

    case 'dial_update':
      if (gameState) {
        gameState.averageDialPosition = msg.averageDialPosition;
        updateDialDisplay(msg.averageDialPosition);
      }
      break;

    case 'ready_update':
      if (gameState) {
        gameState.readyCount = msg.readyCount;
        gameState.totalGuessers = msg.totalGuessers;
      }
      updateReadyDisplay();
      break;

    case 'reveal_target':
      handleReveal(msg);
      break;

    case 'emoji_broadcast':
      spawnFloatingEmoji(msg.emoji);
      break;

    case 'error':
      showError(msg.message);
      break;
  }
}

// ─── Landing Screen ─────────────────────────────
$('#btn-create').addEventListener('click', () => {
  isCreating = true;
  showScreen('name');
});

$('#btn-join-show').addEventListener('click', () => {
  const joinForm = $('#join-form');
  joinForm.classList.toggle('hidden');
  if (!joinForm.classList.contains('hidden')) {
    $('#input-room-code').focus();
  }
});

$('#btn-join').addEventListener('click', () => {
  const code = $('#input-room-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    showError('Enter a 4-letter room code');
    return;
  }
  myRoomCode = code;
  isCreating = false;
  showScreen('name');
});

$('#input-room-code').addEventListener('keyup', (e) => {
  if (e.key === 'Enter') $('#btn-join').click();
});

// ─── Name Entry ─────────────────────────────────
// Emoji picker
$$('.emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.emoji-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedEmoji = btn.dataset.emoji;
  });
});

// Color picker
$$('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.color-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedColor = btn.dataset.color;
  });
});

$('#btn-confirm-name').addEventListener('click', () => {
  myName = $('#input-name').value.trim() || 'Player';
  connectWS();
  // Wait for connection then send
  const waitForOpen = setInterval(() => {
    if (ws && ws.readyState === 1) {
      clearInterval(waitForOpen);
      if (isCreating) {
        send({ type: 'create_room', name: myName, emoji: selectedEmoji, color: selectedColor });
      } else {
        send({ type: 'join_room', roomCode: myRoomCode, name: myName, emoji: selectedEmoji, color: selectedColor });
      }
    }
  }, 100);
});

$('#input-name').addEventListener('keyup', (e) => {
  if (e.key === 'Enter') $('#btn-confirm-name').click();
});

// ─── Lobby ──────────────────────────────────────
function showLobby() {
  showScreen('lobby');
  $('#lobby-room-code').textContent = myRoomCode;
  renderLobbyPlayers();
}

function renderLobbyPlayers() {
  if (!gameState) return;
  const list = $('#lobby-players');
  list.innerHTML = '';

  const players = gameState.players || [];
  players.forEach(p => {
    const item = document.createElement('div');
    item.className = 'player-item';
    item.innerHTML = `
      <div class="player-avatar" style="background:${p.color}">${p.emoji}</div>
      <span class="player-name">${escapeHtml(p.name)}</span>
      ${p.isHost ? '<span class="player-host-badge">HOST</span>' : ''}
      ${p.id === myPlayerId ? '<span class="player-you-badge">YOU</span>' : ''}
    `;
    list.appendChild(item);
  });

  $('#lobby-count').textContent = players.length;

  // Show start button only for host
  const amHost = players.find(p => p.id === myPlayerId)?.isHost;
  const startBtn = $('#btn-start-game');
  const waitingText = $('#lobby-waiting');
  if (amHost) {
    startBtn.classList.remove('hidden');
    waitingText.classList.add('hidden');
  } else {
    startBtn.classList.add('hidden');
    waitingText.classList.remove('hidden');
  }
}

$('#btn-copy-code').addEventListener('click', () => {
  navigator.clipboard.writeText(myRoomCode).then(() => {
    showCopied();
  }).catch(() => {});
});

$('#btn-start-game').addEventListener('click', () => {
  send({ type: 'start_game' });
});

// ─── Game Rendering ─────────────────────────────
function renderGameState() {
  if (!gameState) return;

  switch (gameState.phase) {
    case 'lobby':
      showLobby();
      break;

    case 'psychic_clue':
      showScreen('game');
      renderGameUI();
      break;

    case 'dial':
      showScreen('game');
      renderGameUI();
      break;

    case 'reveal':
      // Stay on game screen briefly, then show reveal
      showScreen('reveal');
      renderRevealScreen();
      break;

    case 'game_over':
      showScreen('gameover');
      renderGameOver();
      break;
  }
}

function renderGameUI() {
  // Top bar
  $('#game-round').textContent = gameState.currentRound;
  $('#game-total-rounds').textContent = gameState.totalRounds;
  $('#game-score').textContent = gameState.totalScore;

  // Spectrum card labels
  if (gameState.currentCard) {
    $('#spectrum-left').textContent = gameState.currentCard[0];
    $('#spectrum-right').textContent = gameState.currentCard[1];
  }

  const isPsychic = gameState.isPsychic;
  const phase = gameState.phase;

  // Hide all conditional sections
  $('#psychic-section').classList.add('hidden');
  $('#waiting-clue-section').classList.add('hidden');
  $('#clue-display').classList.add('hidden');
  $('#ready-section').classList.add('hidden');
  $('#psychic-watching').classList.add('hidden');

  // Disable dial canvas interaction for psychic
  const canvas = $('#dial-canvas');
  canvas.style.pointerEvents = isPsychic ? 'none' : 'auto';

  // Show/hide target for psychic
  if (gameState.targetPosition !== null) {
    showTargetOnDial(gameState.targetPosition);
  } else {
    hideTargetOnDial();
  }

  if (phase === 'psychic_clue') {
    if (isPsychic) {
      $('#psychic-section').classList.remove('hidden');
      $('#input-clue').value = '';
      setTimeout(() => $('#input-clue').focus(), 100);
    } else {
      $('#waiting-clue-section').classList.remove('hidden');
      const psychic = (gameState.players || []).find(p => p.id === gameState.psychicId);
      $('#psychic-name').textContent = psychic ? psychic.name : 'Psychic';
    }
    // Reset dial
    myDialPosition = 50;
    drawDial();
  }

  if (phase === 'dial') {
    // Show clue
    $('#clue-display').classList.remove('hidden');
    $('#clue-text').textContent = `"${gameState.clue}"`;
    const psychic = (gameState.players || []).find(p => p.id === gameState.psychicId);
    $('#clue-by').textContent = psychic ? psychic.name : 'Psychic';

    if (isPsychic) {
      $('#psychic-watching').classList.remove('hidden');
      $('#psychic-ready-count').textContent = gameState.readyCount;
      $('#psychic-ready-total').textContent = gameState.totalGuessers;
    } else {
      $('#ready-section').classList.remove('hidden');
      updateReadyDisplay();
      // Update dial to average
      updateDialDisplay(gameState.averageDialPosition);
    }
  }
}

// ─── Dial — Canvas Rendering ────────────────────
const DIAL_W = 380;
const DIAL_H = 220;
const CX = DIAL_W / 2;       // centre-X of the semicircle
const CY = DIAL_H - 10;      // centre-Y (bottom, with padding)
const RADIUS = 165;           // outer radius of the arc
const BULLSEYE_R = 38;        // red circle radius

let dialTargetPos = null;     // null = hidden, 0-100 = visible
let dialNeedlePos = 50;       // 0-100 current needle position
let showScoreZones = false;

function posToAngle(pos) {
  // Convert 0-100 position to CANVAS angle in radians.
  // Canvas: 0=right, π/2=down, π=left, 3π/2=up. Angles increase clockwise.
  // Upper semicircle spans [π, 2π]: π=left, 3π/2=top, 2π=right.
  // pos 0 = left (π), pos 50 = top (3π/2), pos 100 = right (2π)
  return Math.PI + (pos / 100) * Math.PI;
}

function drawDial() {
  const canvas = $('#dial-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // 1. Draw cream/beige semicircle background (upper half)
  ctx.beginPath();
  ctx.moveTo(CX - RADIUS, CY);
  ctx.arc(CX, CY, RADIUS, Math.PI, 2 * Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = '#f5f0e1';
  ctx.fill();

  // 2. Draw teal/cyan fill when target is hidden (guessing phase)
  if (!showScoreZones) {
    ctx.beginPath();
    ctx.moveTo(CX - (RADIUS - 2), CY);
    ctx.arc(CX, CY, RADIUS - 2, Math.PI, 2 * Math.PI, false);
    ctx.closePath();
    ctx.fillStyle = '#5fbfb8';
    ctx.fill();
  }

  // 3. Draw scoring wedges if target is visible
  if (showScoreZones && dialTargetPos !== null) {
    const targetAngle = posToAngle(dialTargetPos);
    
    // Zone definitions — draw outermost to innermost so inner paints over outer
    const zones = [
      { halfDeg: 18, color: '#3a8fd4', label: '2' },   // 2pt — blue (outermost)
      { halfDeg: 12, color: '#e67e22', label: '3' },   // 3pt — orange
      { halfDeg: 6,  color: '#e74c3c', label: '4' },   // 4pt — red (centre)
    ];

    zones.forEach(zone => {
      const halfRad = (zone.halfDeg / 180) * Math.PI;
      let startA = targetAngle - halfRad;
      let endA = targetAngle + halfRad;
      
      // Clamp to upper semicircle [π, 2π]
      startA = Math.max(Math.PI, startA);
      endA = Math.min(2 * Math.PI, endA);
      
      if (startA < endA) {
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.arc(CX, CY, RADIUS - 3, startA, endA, false);
        ctx.closePath();
        ctx.fillStyle = zone.color;
        ctx.fill();
      }
    });

    // Draw scoring labels (2, 3, 4, 3, 2) on the wedges
    const labelZones = [
      { offset: -15, label: '2' },
      { offset: -9,  label: '3' },
      { offset: 0,   label: '4' },
      { offset: 9,   label: '3' },
      { offset: 15,  label: '2' },
    ];
    
    ctx.font = 'bold 14px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    
    labelZones.forEach(lz => {
      const offsetRad = (lz.offset / 180) * Math.PI;
      const labelAngle = targetAngle + offsetRad;
      // Only draw if within upper semicircle
      if (labelAngle >= Math.PI && labelAngle <= 2 * Math.PI) {
        const labelR = RADIUS * 0.72;
        const lx = CX + Math.cos(labelAngle) * labelR;
        const ly = CY + Math.sin(labelAngle) * labelR;
        ctx.fillText(lz.label, lx, ly);
      }
    });
  }

  // 4. Draw semicircle border
  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS, Math.PI, 2 * Math.PI, false);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#1a1a2e';
  ctx.stroke();

  // 5. Draw baseline
  ctx.beginPath();
  ctx.moveTo(CX - RADIUS, CY);
  ctx.lineTo(CX + RADIUS, CY);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#1a1a2e';
  ctx.stroke();

  // 6. Draw needle
  const needleAngle = posToAngle(dialNeedlePos);
  const needleLen = RADIUS - 8;
  const nx = CX + Math.cos(needleAngle) * needleLen;
  const ny = CY + Math.sin(needleAngle) * needleLen;
  
  ctx.beginPath();
  ctx.moveTo(CX, CY);
  ctx.lineTo(nx, ny);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#c0392b';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.lineCap = 'butt';

  // 7. Draw bullseye (large red circle at pivot)
  ctx.beginPath();
  ctx.arc(CX, CY, BULLSEYE_R, 0, Math.PI * 2);
  ctx.fillStyle = '#c0392b';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#a93226';
  ctx.stroke();
}

function initDial() {
  const canvas = $('#dial-canvas');
  if (!canvas) return;

  // High-DPI support
  const dpr = window.devicePixelRatio || 1;
  canvas.width = DIAL_W * dpr;
  canvas.height = DIAL_H * dpr;
  canvas.style.width = DIAL_W + 'px';
  canvas.style.height = DIAL_H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  let lastSendTime = 0;
  const SEND_INTERVAL = 50;

  function getAngleFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = DIAL_W / rect.width;
    const scaleY = DIAL_H / rect.height;
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;
    
    const dx = canvasX - CX;
    const dy = canvasY - CY;
    
    // atan2 gives angle in [-π, π]. Upper semicircle has dy < 0.
    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += 2 * Math.PI; // Convert to [0, 2π]
    // Clamp to upper semicircle [π, 2π]
    angle = Math.max(Math.PI, Math.min(2 * Math.PI, angle));
    // Convert to 0-100: π→0, 2π→100
    return ((angle - Math.PI) / Math.PI) * 100;
  }

  function onStart(e) {
    if (gameState?.phase !== 'dial' || gameState?.isPsychic) return;
    if (gameState?.isReady) return;
    isDragging = true;
    e.preventDefault();
    const pos = getAngleFromEvent(e);
    myDialPosition = pos;
    dialNeedlePos = pos;
    drawDial();
    sendDialPosition(pos);
  }

  function onMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    const pos = getAngleFromEvent(e);
    myDialPosition = pos;
    dialNeedlePos = pos;
    drawDial();

    const now = Date.now();
    if (now - lastSendTime >= SEND_INTERVAL) {
      sendDialPosition(pos);
      lastSendTime = now;
    }
  }

  function onEnd() {
    if (!isDragging) return;
    isDragging = false;
    sendDialPosition(myDialPosition);
  }

  canvas.addEventListener('mousedown', onStart);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseup', onEnd);
  canvas.addEventListener('mouseleave', onEnd);

  canvas.addEventListener('touchstart', onStart, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onEnd);

  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';

  // Initial draw
  drawDial();
}

function sendDialPosition(pos) {
  send({ type: 'move_dial', position: pos });
}

function updateDialDisplay(averagePosition) {
  if (!isDragging || gameState?.isPsychic) {
    dialNeedlePos = averagePosition;
    drawDial();
  }
}

function showTargetOnDial(targetPos) {
  dialTargetPos = targetPos;
  showScoreZones = true;
  drawDial();
}

function hideTargetOnDial() {
  dialTargetPos = null;
  showScoreZones = false;
  drawDial();
}

// ─── Clue Submission ────────────────────────────
$('#btn-submit-clue').addEventListener('click', () => {
  const clue = $('#input-clue').value.trim();
  if (!clue) {
    showError('Enter a clue!');
    return;
  }
  send({ type: 'submit_clue', clue });
});

$('#input-clue').addEventListener('keyup', (e) => {
  if (e.key === 'Enter') $('#btn-submit-clue').click();
});

// ─── Ready ──────────────────────────────────────
$('#btn-ready').addEventListener('click', () => {
  send({ type: 'set_ready' });
  $('#btn-ready').classList.add('btn-ready-locked');
  $('#btn-ready').textContent = '✓ Locked In!';
  // Disable dial
  $('#dial-canvas').style.pointerEvents = 'none';
});

function updateReadyDisplay() {
  if (!gameState) return;
  $('#ready-count').textContent = gameState.readyCount;
  $('#ready-total').textContent = gameState.totalGuessers;
  if (gameState.isPsychic) {
    $('#psychic-ready-count').textContent = gameState.readyCount;
    $('#psychic-ready-total').textContent = gameState.totalGuessers;
  }
}

// ─── Reveal ─────────────────────────────────────
function handleReveal(msg) {
  // Show on game screen first with target animation
  if (gameState) {
    showTargetOnDial(msg.target, true);
  }

  // After a short delay, show the reveal screen
  setTimeout(() => {
    showScreen('reveal');
    renderRevealFromMsg(msg);
  }, 1500);
}

function renderRevealFromMsg(msg) {
  const pts = msg.points;
  let title = 'Miss...';
  if (pts === 4) title = '🎯 BULLSEYE!';
  else if (pts === 3) title = '🔥 So Close!';
  else if (pts === 2) title = '👏 Not Bad!';
  else title = '😬 Missed it!';

  $('#reveal-title').textContent = title;
  $('#reveal-points').textContent = pts;
  $('#reveal-target').textContent = Math.round(msg.target);
  $('#reveal-dial').textContent = Math.round(msg.dial);
  $('#reveal-distance').textContent = Math.round(msg.distance);
  $('#reveal-total-score').textContent = msg.totalScore;

  // Show next round / waiting
  const amHost = gameState?.players?.find(p => p.id === myPlayerId)?.isHost;
  if (amHost) {
    $('#btn-next-round').classList.remove('hidden');
    $('#reveal-waiting').classList.add('hidden');
  } else {
    $('#btn-next-round').classList.add('hidden');
    $('#reveal-waiting').classList.remove('hidden');
  }
}

function renderRevealScreen() {
  if (!gameState || !gameState.scores || gameState.scores.length === 0) return;
  const lastScore = gameState.scores[gameState.scores.length - 1];
  renderRevealFromMsg({
    points: lastScore.points,
    target: lastScore.target,
    dial: lastScore.dial,
    distance: lastScore.distance,
    totalScore: gameState.totalScore,
  });
}

$('#btn-next-round').addEventListener('click', () => {
  send({ type: 'next_round' });
});

// ─── Game Over ──────────────────────────────────
function renderGameOver() {
  if (!gameState) return;
  const maxScore = gameState.totalRounds * 4;
  const score = gameState.totalScore;

  $('#final-score').textContent = score;
  $('#final-max').textContent = maxScore;

  const pct = score / maxScore;
  let grade = '🌊 Keep Practicing!';
  if (pct >= 0.9) grade = '🏆 Wavelength Legends!';
  else if (pct >= 0.75) grade = '🌊 Wavelength Masters!';
  else if (pct >= 0.6) grade = '🔥 Great Minds!';
  else if (pct >= 0.4) grade = '✨ Getting There!';
  else if (pct >= 0.2) grade = '🤔 Room for Growth';

  $('#gameover-grade').textContent = grade;

  // Round summary
  const summary = $('#round-summary');
  summary.innerHTML = '';
  (gameState.scores || []).forEach(s => {
    const item = document.createElement('div');
    item.className = 'round-summary-item';
    item.innerHTML = `
      <span class="round-num">R${s.round}</span>
      <span class="round-clue">"${escapeHtml(s.clue)}" — ${escapeHtml(s.psychicName)}</span>
      <span class="round-points">+${s.points}</span>
    `;
    summary.appendChild(item);
  });

  // Show play again button for host
  const amHost = gameState.players?.find(p => p.id === myPlayerId)?.isHost;
  if (amHost) {
    $('#btn-play-again').classList.remove('hidden');
  } else {
    $('#btn-play-again').classList.add('hidden');
  }

  // Confetti!
  spawnConfetti();
}

$('#btn-play-again').addEventListener('click', () => {
  send({ type: 'play_again' });
});

// ─── Emoji Reactions ────────────────────────────
$$('.emoji-react-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.reaction;
    send({ type: 'emoji_reaction', emoji });
    spawnFloatingEmoji(emoji);
    // Button pop animation
    btn.style.transform = 'scale(0.8)';
    setTimeout(() => btn.style.transform = '', 150);
  });
});

function spawnFloatingEmoji(emoji) {
  const container = $('#floating-emojis');
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = (20 + Math.random() * 60) + '%';
  el.style.bottom = '100px';
  container.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

// ─── Confetti ───────────────────────────────────
function spawnConfetti() {
  const container = $('#gameover-confetti');
  container.innerHTML = '';
  const colors = ['#7c3aed', '#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (2 + Math.random() * 3) + 's';
    piece.style.animationDelay = Math.random() * 2 + 's';
    piece.style.width = (6 + Math.random() * 8) + 'px';
    piece.style.height = (6 + Math.random() * 8) + 'px';
    if (Math.random() > 0.5) piece.style.borderRadius = '50%';
    container.appendChild(piece);
  }
}

// ─── Utilities ──────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showError(msg) {
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showCopied() {
  const toast = document.createElement('div');
  toast.className = 'copied-toast';
  toast.textContent = '✓ Copied!';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// ─── Init ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDial();
  showScreen('landing');
});
