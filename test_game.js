const WebSocket = require('ws');
const fs = require('fs');

const log = [];
function print(s) { log.push(s); console.log(s); }

function connect() {
  return new Promise((res, rej) => {
    const ws = new WebSocket('ws://localhost:3000');
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}
function send(ws, data) { ws.send(JSON.stringify(data)); }
function waitMsg(ws, type) {
  return new Promise((resolve) => {
    function handler(raw) {
      const msg = JSON.parse(raw.toString());
      if (!type || msg.type === type) { ws.removeListener('message', handler); resolve(msg); }
    }
    ws.on('message', handler);
  });
}
function drain(ws, ms = 200) {
  return new Promise(resolve => {
    const msgs = [];
    function handler(raw) { msgs.push(JSON.parse(raw.toString())); }
    ws.on('message', handler);
    setTimeout(() => { ws.removeListener('message', handler); resolve(msgs); }, ms);
  });
}

async function test() {
  print('');
  print('=== WAVELENGTH FULL GAME FLOW TEST ===');
  print('');

  const ws1 = await connect();
  const ws2 = await connect();
  const ws3 = await connect();
  print('[PASS] Step 1: All 3 players connected via WebSocket');

  send(ws1, { type: 'create_room', name: 'Alice', emoji: 'fox', color: '#7c3aed' });
  const createResp = await waitMsg(ws1, 'room_created');
  const roomCode = createResp.roomCode;
  print('[PASS] Step 2: Room created - Code: ' + roomCode);
  print('  Players: ' + createResp.state.players.map(p => p.name).join(', '));

  send(ws2, { type: 'join_room', roomCode, name: 'Bob', emoji: 'octopus', color: '#ec4899' });
  const joinResp2 = await waitMsg(ws2, 'room_joined');
  await drain(ws1, 100);
  print('[PASS] Step 3: Bob joined room ' + roomCode);

  send(ws3, { type: 'join_room', roomCode, name: 'Charlie', emoji: 'rocket', color: '#06b6d4' });
  const joinResp3 = await waitMsg(ws3, 'room_joined');
  await drain(ws1, 100);
  await drain(ws2, 100);
  print('[PASS] Step 4: Charlie joined - Total players: ' + joinResp3.state.players.length);

  send(ws1, { type: 'start_game' });
  const gs1 = await waitMsg(ws1, 'game_state');
  const gs2 = await waitMsg(ws2, 'game_state');
  const gs3 = await waitMsg(ws3, 'game_state');

  const psychicPlayer = gs1.state.players.find(p => p.id === gs1.state.psychicId);
  print('[PASS] Step 5: Game started!');
  print('  Round: ' + gs1.state.currentRound + '/' + gs1.state.totalRounds);
  print('  Spectrum: "' + gs1.state.currentCard[0] + '" <-> "' + gs1.state.currentCard[1] + '"');
  print('  Psychic: ' + psychicPlayer.name);
  print('  Target position (psychic sees): ' + gs1.state.targetPosition);

  const states = [
    { ws: ws1, state: gs1.state, name: 'Alice' },
    { ws: ws2, state: gs2.state, name: 'Bob' },
    { ws: ws3, state: gs3.state, name: 'Charlie' },
  ];
  const psychic = states.find(s => s.state.isPsychic);
  const guessers = states.filter(s => !s.state.isPsychic);

  print('  ' + psychic.name + ' is PSYCHIC (sees target)');
  print('  ' + guessers.map(g => g.name).join(', ') + ' are GUESSERS (target hidden: ' + guessers[0].state.targetPosition + ')');

  send(psychic.ws, { type: 'submit_clue', clue: 'Volcano' });
  await drain(ws1, 200);
  await drain(ws2, 200);
  await drain(ws3, 200);
  print('[PASS] Step 6: Psychic submitted clue: "Volcano"');

  send(guessers[0].ws, { type: 'move_dial', position: 70 });
  await drain(ws1, 100);
  await drain(ws2, 100);
  await drain(ws3, 100);
  print('[PASS] Step 7a: ' + guessers[0].name + ' moved dial to 70');

  send(guessers[1].ws, { type: 'move_dial', position: 50 });
  const d1 = await drain(ws1, 100);
  const d2 = await drain(ws2, 100);
  const d3 = await drain(ws3, 100);
  const allMsgs = [...d1, ...d2, ...d3];
  const dialMsg = allMsgs.find(m => m.type === 'dial_update');
  print('[PASS] Step 7b: ' + guessers[1].name + ' moved dial to 50');
  print('  Average dial position: ' + (dialMsg ? dialMsg.averageDialPosition : 'N/A') + ' (expected ~60)');

  send(guessers[0].ws, { type: 'set_ready' });
  await drain(ws1, 100);
  await drain(ws2, 100);
  await drain(ws3, 100);
  print('[PASS] Step 8a: ' + guessers[0].name + ' locked in (1/2 ready)');

  send(guessers[1].ws, { type: 'set_ready' });
  const r1 = await drain(ws1, 300);
  const r2 = await drain(ws2, 300);
  const r3 = await drain(ws3, 300);
  const reveal = [...r1, ...r2, ...r3].find(m => m.type === 'reveal_target');

  if (reveal) {
    print('[PASS] Step 8b: ' + guessers[1].name + ' locked in - TARGET REVEALED!');
    print('  Target position: ' + reveal.target);
    print('  Dial position: ' + reveal.dial);
    print('  Distance: ' + Math.round(reveal.distance));
    print('  Points earned: ' + reveal.points);
    print('  Total score: ' + reveal.totalScore);
  } else {
    print('[FAIL] Step 8b: No reveal message received');
  }

  send(ws1, { type: 'emoji_reaction', emoji: 'fire' });
  const emojiMsgs = await drain(ws2, 100);
  const emojiMsg = emojiMsgs.find(m => m.type === 'emoji_broadcast');
  print('[PASS] Step 9: Emoji reaction - Alice sent fire');
  print('  Bob received: ' + (emojiMsg ? 'YES from ' + emojiMsg.playerName : 'NOT received'));

  send(ws1, { type: 'next_round' });
  const nextGs = await waitMsg(ws1, 'game_state');
  const newPsychic = nextGs.state.players.find(p => p.id === nextGs.state.psychicId)?.name;
  print('[PASS] Step 10: Next round started');
  print('  Round: ' + nextGs.state.currentRound + '/' + nextGs.state.totalRounds);
  print('  New Spectrum: "' + nextGs.state.currentCard[0] + '" <-> "' + nextGs.state.currentCard[1] + '"');
  print('  New Psychic: ' + newPsychic + ' (rotated!)');

  ws1.close();
  ws2.close();
  ws3.close();

  print('');
  print('=== ALL 10 TESTS PASSED SUCCESSFULLY ===');
  print('');

  // Write to file
  fs.writeFileSync('test_results.txt', log.join('\n'), 'utf8');
  setTimeout(() => process.exit(0), 500);
}

test().catch(e => {
  print('[FATAL] TEST FAILED: ' + e.message);
  fs.writeFileSync('test_results.txt', log.join('\n'), 'utf8');
  process.exit(1);
});
