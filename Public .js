// public/client.js
const socket = io();

// UI refs
const $ = id => document.getElementById(id);
const btnRegister = $('btnRegister');
const usernameInput = $('username');
const heroSelect = $('hero');
const btnSetHero = $('btnSetHero');
const lobbyDiv = $('lobby');
const messages = $('messages');
const btnInvite = $('btnInvite');
const friendName = $('friendName');
const btnTopup = $('btnTopup');
const balanceSpan = $('balance');

function log(msg){
  const d = document.createElement('div'); d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; messages.prepend(d);
}

// Register -> join lobby
btnRegister.onclick = async () => {
  const username = usernameInput.value.trim();
  if (!username) return alert('enter username');
  // call backend register (idempotent)
  await fetch('/api/register', { method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username })});
  // register socket and join lobby
  socket.emit('registerSocket', { username });
  log('Registered & joined lobby as ' + username);
};

// set hero
btnSetHero.onclick = () => {
  const hero = heroSelect.value;
  socket.emit('updateHero', { hero });
  log('Hero set to ' + hero);
};

// invite friend to voice/match
btnInvite.onclick = () => {
  const to = friendName.value.trim();
  const username = usernameInput.value.trim();
  if (!to || !username) return alert('enter friend and your name');
  // create a room id and send invite
  const roomId = 'room_' + Math.random().toString(36).slice(2,8);
  socket.emit('inviteFriend', { toUsername: to, roomId });
  log('Invite sent to ' + to);
};

// topup demo
btnTopup.onclick = async () => {
  const username = usernameInput.value.trim();
  if (!username) return alert('enter username');
  const res = await fetch('/api/topup', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ username, amount:100 })});
  const j = await res.json();
  if (j.ok){ balanceSpan.textContent = j.balance; log('Top-up +100 (demo)'); }
};

// socket listeners
socket.on('lobbyUpdate', d => {
  lobbyDiv.textContent = `Lobby players: ${d.count}`;
  log('Lobby updated: ' + JSON.stringify(d.players.map(p=>p.username)));
});
socket.on('matchCountdown', d => log('Waiting for match — auto-fill in ' + d.waitSec + 's'));
socket.on('info', d => log('Info: ' + d.msg));
socket.on('matchStarted', d => log('Match started at ' + new Date(d.startedAt).toLocaleTimeString()));
socket.on('friendRequest', d => log('Friend request from ' + d.requester));
socket.on('friendInvite', async ({ from, roomId }) => {
  log(`Invite from ${from} to join ${roomId}`);
  if (confirm(`${from} invited you to room ${roomId}. Accept?`)) {
    // join room and optionally start voice
    socket.emit('joinRoom', { room: roomId });
    startVoiceCall(roomId, from);
  }
});

// ========== WebRTC voice helpers (basic P2P using signaling) ==========
let localStream = null;
const peers = {}; // peerUsername -> RTCPeerConnection

async function ensureLocalStream(){
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      log('Microphone access granted');
    } catch(e){
      log('Microphone access denied: ' + e.message);
    }
  }
}

// start voice call with one peer (toUsername)
async function startVoiceCall(roomId, toUsername){
  await ensureLocalStream();
  const myName = usernameInput.value.trim();
  if (!myName) return;
  // create offer
  const pc = new RTCPeerConnection();
  // add local tracks
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.ontrack = (ev) => {
    // play incoming audio
    const aud = document.createElement('audio');
    aud.autoplay = true;
    aud.srcObject = ev.streams[0];
    document.body.appendChild(aud);
  };
  pc.onicecandidate = (ev) => {
    if (ev.candidate) socket.emit('webrtc-ice', { to: toUsername, candidate: ev.candidate });
  };
  peers[toUsername] = pc;
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('webrtc-offer', { to: toUsername, offer });
  log('Sent WebRTC offer to ' + toUsername);
}

// handle incoming signaling
socket.on('webrtc-offer', async ({ from, offer }) => {
  await ensureLocalStream();
  const pc = new RTCPeerConnection();
  peers[from] = pc;
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.ontrack = (ev) => {
    const aud = document.createElement('audio');
    aud.autoplay = true;
    aud.srcObject = ev.streams[0];
    document.body.appendChild(aud);
  };
  pc.onicecandidate = (ev) => {
    if (ev.candidate) socket.emit('webrtc-ice', { to: from, candidate: ev.candidate });
  };
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('webrtc-answer', { to: from, answer });
  log('Answered WebRTC offer from ' + from);
});

socket.on('webrtc-answer', async ({ from, answer }) => {
  const pc = peers[from];
  if (!pc) return;
  await pc.setRemoteDescription(answer);
  log('Received WebRTC answer from ' + from);
});

socket.on('webrtc-ice', async ({ from, candidate }) => {
  const pc = peers[from];
  if (!pc) return;
  try { await pc.addIceCandidate(candidate); } catch(e){ console.warn(e); }
});

// ======================================================================

// Simple canvas arena demo (client-side only)
const canvas = $('arenaCanvas');
const ctx = canvas.getContext('2d');
function resizeCanvas(){ canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resizeCanvas); resizeCanvas();

const player = { x: 100, y: 300, color: '#3b82f6' };
const bots = [];
for (let i=0;i<3;i++) bots.push({ x: 600 + i*60, y: 200 + i*40, color:'#f97316' });

function draw(){
  ctx.fillStyle = '#04121a';
  ctx.fillRect(0,0,canvas.width, canvas.height);
  // lanes
  ctx.strokeStyle = '#0f5160';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, canvas.height/3); ctx.lineTo(canvas.width, canvas.height/3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, canvas.height/2); ctx.lineTo(canvas.width, canvas.height/2); ctx.stroke();
  // player
  ctx.fillStyle = player.color; ctx.fillRect(player.x, player.y, 32, 32);
  // bots
  bots.forEach(b => { ctx.fillStyle = b.color; ctx.fillRect(b.x, b.y, 28, 28); });
  requestAnimationFrame(draw);
}
draw();
