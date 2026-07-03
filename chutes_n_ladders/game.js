// ===== Game Configuration =====
const BOARD_SIZE = 640;
const COLS = 10;
const ROWS = 10;
const CELL = BOARD_SIZE / COLS;   // 64px per cell

// Ladders: { bottom: top }
const LADDERS = {
  4: 14,
  9: 31,
  20: 38,
  28: 84,
  40: 59,
  51: 67,
  63: 81,
  71: 91,
};

// Chutes: { top: bottom }
const CHUTES = {
  17: 7,
  54: 34,
  62: 19,
  64: 60,
  87: 24,
  93: 73,
  95: 75,
  99: 78,
};

// Square color palette (alternating pastel groups)
const CELL_COLORS = [
  '#ffeaa7', '#fdcb6e', '#fab1a0', '#e17055',
  '#81ecec', '#00cec9', '#74b9ff', '#0984e3',
  '#a29bfe', '#6c5ce7', '#fd79a8', '#e84393',
  '#55efc4', '#00b894',
];

// Dice face emojis
const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// ===== State =====
let players, currentPlayer, gameOver;
let animOverride = null; // { playerIdx, x, y } — overrides token draw pos during chute/ladder glide

// ===== Audio =====
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, type, startOffset, dur, vol = 0.3) {
  const ac = getAudioCtx();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime + startOffset);
  gain.gain.setValueAtTime(vol, ac.currentTime + startOffset);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + startOffset + dur);
  osc.start(ac.currentTime + startOffset);
  osc.stop(ac.currentTime + startOffset + dur);
}

function soundDiceRoll() {
  for (let i = 0; i < 8; i++) {
    playTone(150 + Math.random() * 300, 'square', i * 0.055, 0.05, 0.08);
  }
}

function soundStep() {
  playTone(600, 'sine', 0, 0.07, 0.1);
}

function soundLadder() {
  // Ascending C-E-G-C arpeggio — positive/triumphant
  [523, 659, 784, 1047].forEach((f, i) => playTone(f, 'sine', i * 0.1, 0.18, 0.22));
}

function soundChute() {
  // Descending sawtooth womp — negative/sad
  const ac = getAudioCtx();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(380, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(70, ac.currentTime + 0.65);
  gain.gain.setValueAtTime(0.25, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.75);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + 0.75);
}

// ===== DOM References =====
const canvas   = document.getElementById('board-canvas');
const ctx      = canvas.getContext('2d');
const rollBtn  = document.getElementById('roll-btn');
const diceEl   = document.getElementById('dice-face');
const diceRes  = document.getElementById('dice-result');
const turnText = document.getElementById('turn-text');
const logList  = document.getElementById('log-list');
const p1Pos    = document.getElementById('p1-pos');
const p2Pos    = document.getElementById('p2-pos');
const p1Card   = document.getElementById('player1-card');
const p2Card   = document.getElementById('player2-card');
const winOverlay  = document.getElementById('win-overlay');
const winMessage  = document.getElementById('win-message');
const rollBtnMain = document.getElementById('roll-btn');

// ===== Utility: Square number → canvas (x, y) center =====
function squareToXY(sq) {
  const idx = sq - 1;
  const row = Math.floor(idx / COLS);       // 0 = bottom
  const colInRow = idx % COLS;
  const col = (row % 2 === 0) ? colInRow : (COLS - 1 - colInRow);
  const canvasRow = ROWS - 1 - row;         // flip vertically (row 0 → bottom on canvas)
  return {
    x: col * CELL + CELL / 2,
    y: canvasRow * CELL + CELL / 2,
  };
}

// ===== Path helpers for smooth chute/ladder animation =====
function linearPath(x1, y1, x2, y2) {
  return t => ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
}

function bezierPath(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y) {
  return t => {
    const u = 1 - t;
    return {
      x: u*u*u*p0x + 3*u*u*t*p1x + 3*u*t*t*p2x + t*t*t*p3x,
      y: u*u*u*p0y + 3*u*u*t*p1y + 3*u*t*t*p2y + t*t*t*p3y,
    };
  };
}

function animateAlongPath(playerIdx, sideOffset, getXY, duration, onDone) {
  const start = performance.now();
  function frame(now) {
    const t = Math.min((now - start) / duration, 1);
    const pos = getXY(t);
    animOverride = { playerIdx, x: pos.x + sideOffset, y: pos.y };
    drawBoard();
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      animOverride = null;
      onDone();
    }
  }
  requestAnimationFrame(frame);
}

// ===== Draw Board =====
function drawBoard() {
  ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);

  // Draw cells
  for (let sq = 1; sq <= 100; sq++) {
    const idx   = sq - 1;
    const row   = Math.floor(idx / COLS);
    const col   = (row % 2 === 0) ? idx % COLS : COLS - 1 - (idx % COLS);
    const cRow  = ROWS - 1 - row;
    const x     = col * CELL;
    const y     = cRow * CELL;

    // Cell fill
    const colorIdx = ((row * 3) + (col % CELL_COLORS.length)) % CELL_COLORS.length;
    ctx.fillStyle = CELL_COLORS[colorIdx];
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, CELL - 2, CELL - 2, 4);
    ctx.fill();

    // Cell number
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.font = `bold ${CELL * 0.22}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(sq, x + 4, y + 3);
  }

  // Highlight chute/ladder squares
  for (const [top, bot] of Object.entries(CHUTES)) {
    highlightSquare(Number(top), 'rgba(231,76,60,0.35)');
    highlightSquare(Number(bot), 'rgba(231,76,60,0.15)');
  }
  for (const [bot, top] of Object.entries(LADDERS)) {
    highlightSquare(Number(bot), 'rgba(39,174,96,0.35)');
    highlightSquare(Number(top), 'rgba(39,174,96,0.15)');
  }

  // Draw ladders
  for (const [bot, top] of Object.entries(LADDERS)) {
    drawLadder(Number(bot), Number(top));
  }

  // Draw chutes (snakes)
  for (const [top, bot] of Object.entries(CHUTES)) {
    drawChute(Number(top), Number(bot));
  }

  // Draw players
  drawPlayers();
}

function highlightSquare(sq, color) {
  const idx   = sq - 1;
  const row   = Math.floor(idx / COLS);
  const col   = (row % 2 === 0) ? idx % COLS : COLS - 1 - (idx % COLS);
  const cRow  = ROWS - 1 - row;
  const x     = col * CELL;
  const y     = cRow * CELL;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, CELL - 2, CELL - 2, 4);
  ctx.fill();
}

function drawLadder(from, to) {
  const p1 = squareToXY(from);
  const p2 = squareToXY(to);
  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const offset = 6;
  const perpX = Math.sin(angle) * offset;
  const perpY = -Math.cos(angle) * offset;
  const totalLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const rungs = Math.max(3, Math.floor(totalLen / 22));

  // Rails
  for (let side = -1; side <= 1; side += 2) {
    ctx.beginPath();
    ctx.moveTo(p1.x + perpX * side, p1.y + perpY * side);
    ctx.lineTo(p2.x + perpX * side, p2.y + perpY * side);
    ctx.strokeStyle = '#27ae60';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Rungs
  for (let i = 1; i < rungs; i++) {
    const t = i / rungs;
    const mx = p1.x + (p2.x - p1.x) * t;
    const my = p1.y + (p2.y - p1.y) * t;
    ctx.beginPath();
    ctx.moveTo(mx + perpX, my + perpY);
    ctx.lineTo(mx - perpX, my - perpY);
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // End caps
  ctx.beginPath();
  ctx.arc(p2.x, p2.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#f9ca24';
  ctx.fill();
}

function drawChute(from, to) {
  const p1 = squareToXY(from);
  const p2 = squareToXY(to);

  // Draw a curvy snake body using bezier curves
  const cx1 = p1.x + (p2.x - p1.x) * 0.3 + 28;
  const cy1 = p1.y + (p2.y - p1.y) * 0.3 - 18;
  const cx2 = p1.x + (p2.x - p1.x) * 0.7 - 28;
  const cy2 = p1.y + (p2.y - p1.y) * 0.7 + 18;

  // Shadow
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.bezierCurveTo(cx1 + 2, cy1 + 2, cx2 + 2, cy2 + 2, p2.x + 2, p2.y + 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Body gradient
  const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
  grad.addColorStop(0, '#e74c3c');
  grad.addColorStop(0.4, '#e67e22');
  grad.addColorStop(0.8, '#e74c3c');
  grad.addColorStop(1, '#c0392b');
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.bezierCurveTo(cx1, cy1, cx2, cy2, p2.x, p2.y);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 9;
  ctx.stroke();

  // Scale pattern on body
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.bezierCurveTo(cx1, cy1, cx2, cy2, p2.x, p2.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 10]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Snake head at 'from'
  ctx.beginPath();
  ctx.arc(p1.x, p1.y, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#c0392b';
  ctx.fill();
  ctx.strokeStyle = '#922b21';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Eyes
  const eyeOffsets = [[-3, -3], [3, -3]];
  for (const [ex, ey] of eyeOffsets) {
    ctx.beginPath();
    ctx.arc(p1.x + ex, p1.y + ey, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p1.x + ex, p1.y + ey, 1, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
  }

  // Tongue
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y + 8);
  ctx.lineTo(p1.x - 3, p1.y + 13);
  ctx.moveTo(p1.x, p1.y + 8);
  ctx.lineTo(p1.x + 3, p1.y + 13);
  ctx.strokeStyle = '#ff79a8';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Tail end
  ctx.beginPath();
  ctx.arc(p2.x, p2.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#922b21';
  ctx.fill();
}

function drawPlayers() {
  const tokens = [
    { pos: players[0].pos, color: '#e74c3c', label: '1', sideOffset: -8 },
    { pos: players[1].pos, color: '#3498db', label: '2', sideOffset:  8 },
  ];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.pos < 1) continue;

    let drawX, drawY;
    if (animOverride && animOverride.playerIdx === i) {
      drawX = animOverride.x;
      drawY = animOverride.y;
    } else {
      const center = squareToXY(t.pos);
      drawX = center.x + t.sideOffset;
      drawY = center.y;
    }

    // Shadow
    ctx.beginPath();
    ctx.arc(drawX + 2, drawY + 2, 12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    // Token body
    ctx.beginPath();
    ctx.arc(drawX, drawY, 12, 0, Math.PI * 2);
    const tGrad = ctx.createRadialGradient(drawX - 3, drawY - 3, 1, drawX, drawY, 12);
    tGrad.addColorStop(0, lighten(t.color, 60));
    tGrad.addColorStop(1, t.color);
    ctx.fillStyle = tGrad;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Token label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.label, drawX, drawY + 1);
  }
}

function lighten(hex, amount) {
  const r = Math.min(255, parseInt(hex.slice(1,3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3,5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5,7), 16) + amount);
  return `rgb(${r},${g},${b})`;
}

// ===== Game Logic =====
function initGame() {
  players = [
    { pos: 1, name: 'Player 1', color: '#e74c3c' },
    { pos: 1, name: 'Player 2', color: '#3498db' },
  ];
  currentPlayer = 0;
  gameOver = false;
  animOverride = null;

  p1Pos.textContent = '1';
  p2Pos.textContent = '1';
  logList.innerHTML = '';
  rollBtn.disabled = false;
  winOverlay.classList.add('hidden');
  updateTurnUI();
  drawBoard();
  addLog('Game started! Player 1 goes first.', '');
}

function updateTurnUI() {
  const cp = players[currentPlayer];
  turnText.textContent = `${cp.name}'s Turn`;
  p1Card.classList.toggle('active-turn', currentPlayer === 0);
  p2Card.classList.toggle('active-turn', currentPlayer === 1);
}

function rollDice() {
  if (gameOver) return;
  rollBtn.disabled = true;
  soundDiceRoll();

  // Animate dice
  diceEl.classList.add('rolling');
  let ticks = 0;
  const animInterval = setInterval(() => {
    const r = Math.ceil(Math.random() * 6);
    diceEl.textContent = DICE_FACES[r];
    ticks++;
    if (ticks >= 8) {
      clearInterval(animInterval);
      diceEl.classList.remove('rolling');
      const roll = Math.ceil(Math.random() * 6);
      diceEl.textContent = DICE_FACES[roll];
      diceRes.textContent = `Rolled a ${roll}`;
      processMove(roll);
    }
  }, 60);
}

function processMove(roll) {
  const cp = players[currentPlayer];
  const oldPos = cp.pos;
  let newPos = cp.pos + roll;

  // Overshoot: bounce back
  if (newPos > 100) {
    newPos = 100 - (newPos - 100);
  }

  addLog(`${cp.name} rolled ${roll}. ${oldPos} → ${newPos}`, '');

  animateMove(currentPlayer, oldPos, newPos, () => {
    cp.pos = newPos;
    updatePosDisplay();
    drawBoard();

    const sideOffset = currentPlayer === 0 ? -8 : 8;

    // Check for chute — animate token gliding along the bezier curve
    if (CHUTES[newPos]) {
      const dest = CHUTES[newPos];
      addLog(`🐍 Oh no! Slid down a chute from ${newPos} to ${dest}!`, 'log-chute');
      soundChute();
      const fromXY = squareToXY(newPos);
      const toXY   = squareToXY(dest);
      const cx1 = fromXY.x + (toXY.x - fromXY.x) * 0.3 + 28;
      const cy1 = fromXY.y + (toXY.y - fromXY.y) * 0.3 - 18;
      const cx2 = fromXY.x + (toXY.x - fromXY.x) * 0.7 - 28;
      const cy2 = fromXY.y + (toXY.y - fromXY.y) * 0.7 + 18;
      const pathFn = bezierPath(fromXY.x, fromXY.y, cx1, cy1, cx2, cy2, toXY.x, toXY.y);
      animateAlongPath(currentPlayer, sideOffset, pathFn, 900, () => {
        cp.pos = dest;
        updatePosDisplay();
        drawBoard();
        afterMoveCheck();
      });
    // Check for ladder — animate token gliding up the straight rail
    } else if (LADDERS[newPos]) {
      const dest = LADDERS[newPos];
      addLog(`🪜 Lucky! Climbed a ladder from ${newPos} to ${dest}!`, 'log-ladder');
      soundLadder();
      const fromXY = squareToXY(newPos);
      const toXY   = squareToXY(dest);
      const pathFn = linearPath(fromXY.x, fromXY.y, toXY.x, toXY.y);
      animateAlongPath(currentPlayer, sideOffset, pathFn, 800, () => {
        cp.pos = dest;
        updatePosDisplay();
        drawBoard();
        afterMoveCheck();
      });
    } else {
      afterMoveCheck();
    }
  });
}

function afterMoveCheck() {
  const cp = players[currentPlayer];
  if (cp.pos >= 100) {
    addLog(`🏆 ${cp.name} wins!`, 'log-win');
    gameOver = true;
    winMessage.textContent = `${cp.name} Wins!`;
    setTimeout(() => winOverlay.classList.remove('hidden'), 400);
    return;
  }

  // Next player's turn
  currentPlayer = (currentPlayer + 1) % 2;
  updateTurnUI();
  setTimeout(() => { rollBtn.disabled = false; }, 300);
}

function animateMove(playerIdx, from, to, callback) {
  // Build path of positions
  const path = [];
  for (let s = from + 1; s <= to; s++) path.push(s);
  if (path.length === 0) { callback(); return; }

  let step = 0;
  const interval = setInterval(() => {
    players[playerIdx].pos = path[step];
    updatePosDisplay();
    drawBoard();
    soundStep();
    step++;
    if (step >= path.length) {
      clearInterval(interval);
      callback();
    }
  }, 140);
}

function updatePosDisplay() {
  p1Pos.textContent = players[0].pos;
  p2Pos.textContent = players[1].pos;
}

function addLog(msg, cssClass) {
  const li = document.createElement('li');
  li.textContent = msg;
  if (cssClass) li.classList.add(cssClass);
  logList.prepend(li);
  // Keep last 30
  while (logList.children.length > 30) logList.removeChild(logList.lastChild);
}

// ===== Events =====
rollBtn.addEventListener('click', rollDice);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !rollBtn.disabled && !gameOver) rollDice();
});
document.getElementById('restart-btn').addEventListener('click', initGame);
document.getElementById('play-again-btn').addEventListener('click', initGame);

// ===== Start =====
initGame();