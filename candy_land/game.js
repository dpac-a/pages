const COLORS = [
  { name: 'Red', hex: '#ff595e' },
  { name: 'Orange', hex: '#ff924c' },
  { name: 'Yellow', hex: '#ffca3a' },
  { name: 'Green', hex: '#8ac926' },
  { name: 'Blue', hex: '#1982c4' },
  { name: 'Purple', hex: '#6a4c93' },
  { name: 'Pink', hex: '#ff5d8f' },
];

const TOTAL_TILES = 72;
const PLAYER_OFFSETS = [
  { x: -12, y: -10 },
  { x: 12, y: 10 },
];

const state = {
  points: [],
  tiles: [],
  players: [
    { name: 'Player 1', pos: 0, color: '#ff006e' },
    { name: 'Player 2', pos: 0, color: '#3a86ff' },
  ],
  currentPlayer: 0,
  busy: false,
  gameOver: false,
};

let audioCtx = null;

const boardEl = document.getElementById('board');
const drawBtn = document.getElementById('draw-btn');
const cardEl = document.getElementById('card');
const cardBackEl = document.getElementById('card-back');
const turnPill = document.getElementById('turn-pill');
const logList = document.getElementById('log-list');
const p1PosEl = document.getElementById('p1-pos');
const p2PosEl = document.getElementById('p2-pos');
const p1Card = document.getElementById('p1-card');
const p2Card = document.getElementById('p2-card');
const winOverlay = document.getElementById('win-overlay');
const winnerText = document.getElementById('winner-text');
const restartBtn = document.getElementById('restart-btn');
const playAgainBtn = document.getElementById('play-again-btn');

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playTone(freq, type, offset, duration, volume) {
  const ac = getAudioCtx();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime + offset);
  gain.gain.setValueAtTime(volume, ac.currentTime + offset);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + offset + duration);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(ac.currentTime + offset);
  osc.stop(ac.currentTime + offset + duration);
}

function soundCardDraw() {
  [430, 560, 740].forEach((f, i) => playTone(f, 'triangle', i * 0.08, 0.14, 0.15));
}

function soundStep() {
  playTone(520 + Math.random() * 80, 'sine', 0, 0.07, 0.07);
}

function soundWin() {
  [523, 659, 784, 1047].forEach((f, i) => playTone(f, 'square', i * 0.1, 0.22, 0.15));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clearBoard() {
  boardEl.innerHTML = '';
  state.tiles = [];
  state.points = [];
}

function buildPathAndTiles() {
  clearBoard();

  const rect = boardEl.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const pad = 32;

  const pathSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  pathSvg.classList.add('path-line');
  pathSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  pathSvg.setAttribute('preserveAspectRatio', 'none');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  for (let i = 0; i < TOTAL_TILES; i++) {
    const t = i / (TOTAL_TILES - 1);
    const sway = Math.sin(t * Math.PI * 6.5 + 0.25);
    const sway2 = Math.sin(t * Math.PI * 11.4 + 1.2);
    const x = pad + (width - pad * 2) * (0.5 + sway * 0.38 + sway2 * 0.06);
    const y = height - pad - (height - pad * 2) * t;
    state.points.push({ x, y });
  }

  let d = '';
  state.points.forEach((pt, i) => {
    d += `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y} `;
  });

  path.setAttribute('d', d.trim());
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'rgba(95, 61, 196, 0.25)');
  path.setAttribute('stroke-width', '14');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  pathSvg.appendChild(path);
  boardEl.appendChild(pathSvg);

  for (let i = 0; i < TOTAL_TILES; i++) {
    const pt = state.points[i];
    const tile = document.createElement('div');
    const color = COLORS[i % COLORS.length];
    tile.className = 'tile';
    tile.style.left = `${pt.x}px`;
    tile.style.top = `${pt.y}px`;
    tile.style.background = color.hex;
    tile.dataset.colorIndex = String(i % COLORS.length);

    if (i === 0) {
      tile.classList.add('start');
      tile.dataset.label = 'START';
    }
    if (i === TOTAL_TILES - 1) {
      tile.classList.add('finish');
      tile.dataset.label = 'DESTINATION';
    }

    boardEl.appendChild(tile);
    state.tiles.push(tile);
  }
}

function createTokens() {
  state.players.forEach((player, idx) => {
    const token = document.createElement('div');
    token.className = 'token';
    token.style.background = player.color;
    token.dataset.player = String(idx + 1);
    boardEl.appendChild(token);
    player.tokenEl = token;
  });
}

function getTokenPoint(playerIndex) {
  const player = state.players[playerIndex];
  const base = state.points[player.pos];
  const off = PLAYER_OFFSETS[playerIndex];
  return { x: base.x + off.x, y: base.y + off.y };
}

function placeToken(playerIndex) {
  const player = state.players[playerIndex];
  const p = getTokenPoint(playerIndex);
  player.tokenEl.style.left = `${p.x}px`;
  player.tokenEl.style.top = `${p.y}px`;
}

function updatePositionsUI() {
  p1PosEl.textContent = state.players[0].pos === 0 ? 'Start' : String(state.players[0].pos + 1);
  p2PosEl.textContent = state.players[1].pos === 0 ? 'Start' : String(state.players[1].pos + 1);
}

function updateTurnUI() {
  const cp = state.players[state.currentPlayer];
  turnPill.textContent = `${cp.name}'s turn`;
  p1Card.classList.toggle('active', state.currentPlayer === 0);
  p2Card.classList.toggle('active', state.currentPlayer === 1);
}

function addLog(msg) {
  const li = document.createElement('li');
  li.textContent = msg;
  logList.prepend(li);
  while (logList.children.length > 24) {
    logList.removeChild(logList.lastChild);
  }
}

function randomColorCard() {
  return Math.floor(Math.random() * COLORS.length);
}

function nextTileForColor(fromPos, colorIndex) {
  for (let i = fromPos + 1; i < state.tiles.length; i++) {
    if (Number(state.tiles[i].dataset.colorIndex) === colorIndex) {
      return i;
    }
  }
  return state.tiles.length - 1;
}

async function animateCardDraw(colorIndex) {
  const color = COLORS[colorIndex];
  cardEl.classList.remove('reveal');
  cardEl.classList.add('drawing');
  await wait(420);
  cardEl.style.setProperty('--drawn-color', color.hex);
  cardBackEl.textContent = color.name;
  cardEl.classList.remove('drawing');
  cardEl.classList.add('reveal');
  soundCardDraw();
  await wait(480);
}

async function animateMove(playerIndex, targetPos) {
  const player = state.players[playerIndex];
  while (player.pos < targetPos) {
    player.pos += 1;
    player.tokenEl.classList.add('moving');
    placeToken(playerIndex);
    updatePositionsUI();
    soundStep();
    await wait(170);
    player.tokenEl.classList.remove('moving');
  }
}

function handleWin(playerIndex) {
  state.gameOver = true;
  state.busy = false;
  drawBtn.disabled = true;
  const winner = state.players[playerIndex].name;
  winnerText.textContent = `${winner} wins!`;
  winOverlay.classList.remove('hidden');
  addLog(`${winner} reached the destination and won the game.`);
  soundWin();
}

async function takeTurn() {
  if (state.busy || state.gameOver) return;

  state.busy = true;
  drawBtn.disabled = true;

  const playerIndex = state.currentPlayer;
  const player = state.players[playerIndex];
  const cardColorIndex = randomColorCard();
  const colorName = COLORS[cardColorIndex].name;

  await animateCardDraw(cardColorIndex);

  const target = nextTileForColor(player.pos, cardColorIndex);
  addLog(`${player.name} drew ${colorName} and moves to square ${target + 1}.`);

  await animateMove(playerIndex, target);

  if (target >= TOTAL_TILES - 1) {
    handleWin(playerIndex);
    return;
  }

  state.currentPlayer = (state.currentPlayer + 1) % 2;
  updateTurnUI();
  state.busy = false;
  drawBtn.disabled = false;
}

function resetStateOnly() {
  state.players[0].pos = 0;
  state.players[1].pos = 0;
  state.currentPlayer = 0;
  state.busy = false;
  state.gameOver = false;
}

function resetGame() {
  resetStateOnly();
  winOverlay.classList.add('hidden');
  logList.innerHTML = '';
  addLog('Game started. Player 1 draws first.');
  updateTurnUI();
  updatePositionsUI();
  placeToken(0);
  placeToken(1);
  drawBtn.disabled = false;
  cardEl.classList.remove('reveal', 'drawing');
  cardEl.style.removeProperty('--drawn-color');
  cardBackEl.textContent = '?';
}

function setupBoardAndGame() {
  buildPathAndTiles();
  createTokens();
  resetGame();
}

drawBtn.addEventListener('click', takeTurn);
restartBtn.addEventListener('click', resetGame);
playAgainBtn.addEventListener('click', resetGame);

window.addEventListener('keydown', event => {
  if (event.code === 'Space') {
    event.preventDefault();
    takeTurn();
  }
});

window.addEventListener('resize', () => {
  const oldPos = [state.players[0].pos, state.players[1].pos];
  boardEl.innerHTML = '';
  buildPathAndTiles();
  createTokens();
  state.players[0].pos = oldPos[0];
  state.players[1].pos = oldPos[1];
  placeToken(0);
  placeToken(1);
});

setupBoardAndGame();