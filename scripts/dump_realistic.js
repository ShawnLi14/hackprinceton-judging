// Dumps a fresh realization of the "Realistic — JRR / LAS / Robertson"
// scenario data (rooms + teams) to scripts/realistic_rooms.txt and
// scripts/realistic_teams.txt. Mirrors the constants/generators in
// test/run-simulation.js. Run with: `node scripts/dump_realistic.js`.

const fs = require('fs');
const path = require('path');

const PROJECTS = [
  'AI Assistant', 'Health Tracker', 'Study Buddy', 'Food Finder', 'Transit App',
  'Budget Planner', 'Eco Monitor', 'Music Generator', 'AR Navigator', 'Chat Platform',
];

const REALISTIC_TRACKS = [
  'Health', 'Education', 'Sustainability', 'Social Good',
  'Finance', 'Entertainment + Media', 'Business and Enterprise',
];

const REALISTIC_PRIZES = [
  'Best Use of Gemini API',
  'Best AI-Powered App',
  'Best Domain Name from GoDaddy Registry',
  'AI Research and Alignment Environments',
  'Best Use of K2 Think V2',
  'Best Use of Knot API',
  'AI & Tech for Clinical Trials by Regeneron',
  'Best Hardware Hack',
  'Most Creative Use of Anthropic API',
  'Best Sustainability Hack',
];

const REALISTIC_ROOMS = [
  { name: 'JRR A97',                       number:  1, floor: 1, capacity: 35 },
  { name: 'JRR A98',                       number:  2, floor: 1, capacity: 35 },
  { name: 'JRR 101',                       number:  3, floor: 2, capacity: 48 },
  { name: 'JRR 198',                       number:  4, floor: 2, capacity: 35 },
  { name: 'JRR 201',                       number:  5, floor: 3, capacity: 24 },
  { name: 'JRR 217',                       number:  6, floor: 3, capacity: 40 },
  { name: 'JRR 298',                       number:  7, floor: 3, capacity: 24 },
  { name: 'JRR 301',                       number:  8, floor: 4, capacity: 18 },
  { name: 'JRR 397',                       number:  9, floor: 4, capacity: 18 },
  { name: 'JRR 399 (Ruehl Family Room)',   number: 10, floor: 4, capacity: 74 },
  { name: 'LAS 144',                       number: 11, floor: 5, capacity: 28 },
  { name: 'LAS A71',                       number: 12, floor: 5, capacity: 60 },
  { name: 'LAS B60A',                      number: 13, floor: 5, capacity: 24 },
  { name: 'LAS B60B',                      number: 14, floor: 5, capacity: 48 },
  { name: 'LAS B60C',                      number: 15, floor: 5, capacity: 24 },
  { name: 'Robertson 001',                 number: 16, floor: 6, capacity: 70 },
  { name: 'Robertson 002',                 number: 17, floor: 6, capacity: 70 },
  { name: 'Robertson 005',                 number: 18, floor: 6, capacity: 24 },
  { name: 'Robertson 010',                 number: 19, floor: 6, capacity: 16 },
  { name: 'Robertson 012',                 number: 20, floor: 6, capacity: 16 },
  { name: 'Robertson 014',                 number: 21, floor: 6, capacity: 16 },
  { name: 'Robertson 015',                 number: 22, floor: 6, capacity: 30 },
  { name: 'Robertson 016',                 number: 23, floor: 6, capacity: 80 },
  { name: 'Robertson 020',                 number: 24, floor: 6, capacity: 25 },
  { name: 'Robertson 023',                 number: 25, floor: 6, capacity: 40 },
  { name: 'Robertson 029',                 number: 26, floor: 6, capacity: 25 },
  { name: 'Robertson 035',                 number: 27, floor: 6, capacity: 25 },
];

function generateRoomsText(rooms) {
  const lines = ['# Room Name, Room Number, Floor'];
  for (const r of rooms) lines.push(`${r.name}, ${r.number}, ${r.floor}`);
  return lines.join('\n') + '\n';
}

function generateRealisticTeamsText(count, rooms) {
  const totalCapacity = rooms.reduce((s, r) => s + r.capacity, 0);
  const exact = rooms.map(r => (count * r.capacity) / totalCapacity);
  const floors = exact.map(x => Math.floor(x));
  const remainder = count - floors.reduce((s, n) => s + n, 0);
  const fracOrder = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) floors[fracOrder[k % fracOrder.length].i] += 1;

  const lines = [
    '# Project Name, Track, Team Number, Room Name, Devpost URL, Prize1|Prize2|...',
  ];
  let teamNum = 1;
  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r];
    for (let j = 0; j < floors[r]; j++) {
      const project = `${PROJECTS[Math.floor(Math.random() * PROJECTS.length)]} #${teamNum}`;
      const track = REALISTIC_TRACKS[Math.floor(Math.random() * REALISTIC_TRACKS.length)];
      const numPrizes = Math.floor(Math.random() * 4);
      const shuffled = REALISTIC_PRIZES.slice().sort(() => Math.random() - 0.5);
      const prizes = shuffled.slice(0, numPrizes).sort((a, b) => a.localeCompare(b));
      lines.push(`${project}, ${track}, ${teamNum}, ${room.name}, , ${prizes.join('|')}`);
      teamNum += 1;
    }
  }
  return lines.join('\n') + '\n';
}

const outDir = path.resolve(__dirname);
const roomsPath = path.join(outDir, 'realistic_rooms.txt');
const teamsPath = path.join(outDir, 'realistic_teams.txt');
fs.writeFileSync(roomsPath, generateRoomsText(REALISTIC_ROOMS));
fs.writeFileSync(teamsPath, generateRealisticTeamsText(150, REALISTIC_ROOMS));
console.log(`Wrote ${REALISTIC_ROOMS.length} rooms -> ${roomsPath}`);
console.log(`Wrote 150 teams -> ${teamsPath}`);
