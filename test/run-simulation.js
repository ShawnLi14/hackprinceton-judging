/**
 * HackPrinceton Judging — Multi-Scenario Simulation
 *
 * Runs a matrix of scenarios with different team counts, room layouts,
 * judge counts, and set sizes to stress-test the judging system.
 *
 * Each scenario creates a fresh event, imports generated data, runs
 * judge bots, and validates correctness:
 *   - No team is judged by two judges simultaneously
 *   - All teams get judged roughly equally
 *   - No errors in the flow
 *   - Rankings are properly recorded
 *
 * Usage: node test/run-simulation.js [BASE_URL]
 *   Default BASE_URL: http://localhost:3000
 *
 * Each scenario's event is deleted as soon as the scenario finishes (pass or
 * fail). Set KEEP_EVENTS=1 to retain events for post-mortem inspection.
 * Set SITE_PASSWORD=... if your /api/events password isn't 'hehe1414'.
 */

const BASE_URL = process.argv[2] || 'http://localhost:3000';

// ============================================
// Realistic room layout (referenced by the "Realistic" scenario below)
// ============================================
// `capacity` is the number of *people* a room fits (used to distribute teams
// proportionally). `floor` is a per-building grouping the assign RPC uses to
// keep judging localized — judges shouldn't have to walk between buildings,
// so each building gets its own floor group(s):
//   1 = JRR basement (A-level)
//   2 = JRR 1st floor (1xx)
//   3 = JRR 2nd floor (2xx)
//   4 = JRR 3rd floor (3xx)
//   5 = LAS (A/B basement + 1st)
//   6 = Robertson (0xx)
// `number` is sequential because the schema requires INTEGER and only uses
// it as a sort key for room proximity within a floor.
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

// ============================================
// Scenarios
// ============================================
const SCENARIOS = [
  {
    name: 'Tiny — single room',
    teams: 5,
    rooms: [{ name: 'Room A', number: '101', floor: 1 }],
    judges: 3,
    set_size: 3,
    target_judgings: 2,
    max_sets_per_judge: 4,
  },
  {
    name: 'Small — fewer teams than judges',
    teams: 8,
    rooms: [
      { name: 'Room A', number: '101', floor: 1 },
      { name: 'Room B', number: '102', floor: 1 },
    ],
    judges: 12,
    set_size: 4,
    target_judgings: 3,
    max_sets_per_judge: 4,
  },
  {
    name: 'Medium — balanced',
    teams: 50,
    rooms: [
      { name: 'Friend 101', number: '101', floor: 1 },
      { name: 'Friend 103', number: '103', floor: 1 },
      { name: 'Friend 201', number: '201', floor: 2 },
      { name: 'Friend 203', number: '203', floor: 2 },
      { name: 'Sherrerd 301', number: '301', floor: 3 },
      { name: 'Sherrerd 303', number: '303', floor: 3 },
    ],
    judges: 10,
    set_size: 5,
    target_judgings: 3,
    max_sets_per_judge: 8,
  },
  {
    name: 'Medium — many rooms, sparse teams',
    teams: 30,
    rooms: [
      { name: 'Room A', number: '101', floor: 1 },
      { name: 'Room B', number: '102', floor: 1 },
      { name: 'Room C', number: '103', floor: 1 },
      { name: 'Room D', number: '201', floor: 2 },
      { name: 'Room E', number: '202', floor: 2 },
      { name: 'Room F', number: '203', floor: 2 },
      { name: 'Room G', number: '301', floor: 3 },
      { name: 'Room H', number: '302', floor: 3 },
      { name: 'Room I', number: '303', floor: 3 },
      { name: 'Room J', number: '304', floor: 3 },
    ],
    judges: 8,
    set_size: 5,
    target_judgings: 3,
    max_sets_per_judge: 8,
  },
  {
    name: 'Medium — small sets',
    teams: 40,
    rooms: [
      { name: 'Lab 1', number: '101', floor: 1 },
      { name: 'Lab 2', number: '102', floor: 1 },
      { name: 'Lab 3', number: '201', floor: 2 },
    ],
    judges: 15,
    set_size: 3,
    target_judgings: 3,
    max_sets_per_judge: 10,
  },
  {
    name: 'Large — full hackathon',
    teams: 200,
    rooms: [
      { name: 'Friend 101', number: '101', floor: 1 },
      { name: 'Friend 103', number: '103', floor: 1 },
      { name: 'Friend 105', number: '105', floor: 1 },
      { name: 'Friend 108', number: '108', floor: 1 },
      { name: 'Friend 110', number: '110', floor: 1 },
      { name: 'Friend 201', number: '201', floor: 2 },
      { name: 'Friend 203', number: '203', floor: 2 },
      { name: 'Friend 205', number: '205', floor: 2 },
      { name: 'Friend 206', number: '206', floor: 2 },
      { name: 'Sherrerd 301', number: '301', floor: 3 },
      { name: 'Sherrerd 303', number: '303', floor: 3 },
      { name: 'Sherrerd 305', number: '305', floor: 3 },
    ],
    judges: 20,
    set_size: 5,
    target_judgings: 3,
    max_sets_per_judge: 8,
  },
  {
    name: 'Edge — teams equal to set size',
    teams: 5,
    rooms: [{ name: 'Room A', number: '101', floor: 1 }],
    judges: 3,
    set_size: 5,
    target_judgings: 3,
    max_sets_per_judge: 4,
  },
  {
    name: 'Edge — large sets',
    teams: 60,
    rooms: [
      { name: 'Hall A', number: '101', floor: 1 },
      { name: 'Hall B', number: '102', floor: 1 },
      { name: 'Hall C', number: '201', floor: 2 },
      { name: 'Hall D', number: '202', floor: 2 },
    ],
    judges: 6,
    set_size: 8,
    target_judgings: 2,
    max_sets_per_judge: 6,
  },
  {
    // Real-world layout: 27 rooms across JRR / LAS / Robertson, sized by
    // actual capacity. Teams are allocated proportional to room capacity
    // (largest-remainder). Every team also gets 0-3 opt-in prizes so the
    // results-page prize filter has meaningful data to chew on.
    name: 'Realistic — JRR / LAS / Robertson',
    teams: 150,
    rooms: REALISTIC_ROOMS,
    judges: 30,
    set_size: 5,
    target_judgings: 3,
    max_sets_per_judge: 10,
    generateTeams: (count, rooms) => generateRealisticTeamsText(count, rooms),
  },
];

// ============================================
// Data Generation
// ============================================
const PROJECTS = [
  'AI Assistant', 'Health Tracker', 'Study Buddy', 'Food Finder', 'Transit App',
  'Budget Planner', 'Eco Monitor', 'Music Generator', 'AR Navigator', 'Chat Platform',
];
const TRACKS = ['Health', 'Education', 'Sustainability', 'Social Good', 'Finance'];

// Realistic Devpost-style opt-in prize names. Each team independently opts
// into 0-3 of these (a team has one track but many prizes — that asymmetry
// is what the importer + results UI handle).
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
const REALISTIC_TRACKS = [
  'Health', 'Education', 'Sustainability', 'Social Good',
  'Finance', 'Entertainment + Media', 'Business and Enterprise',
];
const JUDGE_FIRST = [
  'Alice', 'Bob', 'Carol', 'David', 'Emma', 'Frank', 'Grace', 'Henry',
  'Iris', 'James', 'Karen', 'Larry', 'Maria', 'Nathan', 'Olivia', 'Pat',
  'Quinn', 'Rachel', 'Steven', 'Tracy', 'Uma', 'Victor', 'Wendy', 'Xavier',
  'Yuki', 'Zara',
];
const JUDGE_LAST = [
  'Chen', 'Martinez', 'Williams', 'Kim', 'Johnson', 'Liu', 'Patel', 'Wilson',
  'Thompson', 'Garcia', 'Lee', 'Brown', 'Rodriguez', 'Davis', 'Moore', 'Taylor',
  'Anderson', 'Thomas', 'White', 'Harris', 'Clark', 'Lewis', 'Hall', 'Young',
  'King', 'Wright',
];

function generateRoomsText(rooms) {
  const lines = ['# Room Name, Room Number, Floor'];
  for (const r of rooms) {
    lines.push(`${r.name}, ${r.number}, ${r.floor}`);
  }
  return lines.join('\n') + '\n';
}

function generateTeamsText(count, rooms) {
  const lines = ['# Project Name, Track, Team Number, Room Name'];
  for (let i = 1; i <= count; i++) {
    const project = `${PROJECTS[Math.floor(Math.random() * PROJECTS.length)]} #${i}`;
    const track = TRACKS[Math.floor(Math.random() * TRACKS.length)];
    const room = rooms[(i - 1) % rooms.length];
    lines.push(`${project}, ${track}, ${i}, ${room.name}`);
  }
  return lines.join('\n') + '\n';
}

// Distributes `count` teams across `rooms` proportional to each room's
// `capacity`. Uses largest-remainder rounding so the sum is exactly `count`,
// then assigns 0-3 random opt-in prizes per team. Emits the 6-field format
// (project, track, number, room, devpost_url, prizes).
function generateRealisticTeamsText(count, rooms) {
  const totalCapacity = rooms.reduce((s, r) => s + r.capacity, 0);

  // Largest-remainder allocation: floor() each share, then hand out the
  // leftover seats to whichever rooms had the largest fractional remainder.
  const exact = rooms.map(r => (count * r.capacity) / totalCapacity);
  const floors = exact.map(x => Math.floor(x));
  let remainder = count - floors.reduce((s, n) => s + n, 0);
  const fracOrder = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) {
    floors[fracOrder[k % fracOrder.length].i] += 1;
  }
  const perRoom = floors;

  const lines = [
    '# Project Name, Track, Team Number, Room Name, Devpost URL, Prize1|Prize2|...',
  ];
  let teamNum = 1;
  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r];
    for (let j = 0; j < perRoom[r]; j++) {
      const project = `${PROJECTS[Math.floor(Math.random() * PROJECTS.length)]} #${teamNum}`;
      const track = REALISTIC_TRACKS[Math.floor(Math.random() * REALISTIC_TRACKS.length)];

      // 0-3 distinct prizes, alphabetized so re-runs of the test produce
      // stable diffs when nothing else changed.
      const numPrizes = Math.floor(Math.random() * 4);
      const shuffled = REALISTIC_PRIZES.slice().sort(() => Math.random() - 0.5);
      const prizes = shuffled.slice(0, numPrizes).sort((a, b) => a.localeCompare(b));
      const prizeField = prizes.join('|');

      lines.push(`${project}, ${track}, ${teamNum}, ${room.name}, , ${prizeField}`);
      teamNum += 1;
    }
  }

  return lines.join('\n') + '\n';
}

function generateJudgesText(count) {
  const lines = ['# Judge Name, Access Code'];
  const usedNames = new Set();
  for (let i = 1; i <= count; i++) {
    let name;
    do {
      const first = JUDGE_FIRST[Math.floor(Math.random() * JUDGE_FIRST.length)];
      const last = JUDGE_LAST[Math.floor(Math.random() * JUDGE_LAST.length)];
      name = `${first} ${last}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    lines.push(`${name}, JUDGE-${String(i).padStart(3, '0')}`);
  }
  return lines.join('\n') + '\n';
}

// ============================================
// Logging
// ============================================
function log(msg, level = 'INFO') {
  const timestamp = new Date().toISOString().slice(11, 23);
  const prefix = level === 'ERROR' ? '!!!' : level === 'WARN' ? '???' : level === 'OK' ? '>>>' : '---';
  console.log(`[${timestamp}] ${prefix} ${msg}`);
}

// ============================================
// HTTP Helpers
// ============================================
async function api(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`API ${endpoint}: ${res.status} - ${JSON.stringify(data)}`);
  }
  return data;
}

async function apiPost(endpoint, body) {
  return api(endpoint, { method: 'POST', body: JSON.stringify(body) });
}

const SITE_PASSWORD = process.env.SITE_PASSWORD || 'hehe1414';

async function deleteEvent(eventId) {
  if (!eventId) return;
  try {
    await api(`/api/events?id=${eventId}&password=${encodeURIComponent(SITE_PASSWORD)}`, { method: 'DELETE' });
  } catch (e) {
    log(`  Cleanup: failed to delete event ${eventId}: ${e.message}`, 'WARN');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Judge Bot
// ============================================
class JudgeBot {
  constructor(name, accessCode, eventId, botId, stats) {
    this.name = name;
    this.accessCode = accessCode;
    this.eventId = eventId;
    this.botId = botId;
    this.stats = stats;
    this.judgeId = null;
    this.setsCompleted = 0;
    this.running = true;
  }

  async login() {
    try {
      const result = await apiPost('/api/judges/login', {
        access_code: this.accessCode,
        event_id: this.eventId,
      });
      this.judgeId = result.judge.id;
      return true;
    } catch (e) {
      log(`[${this.name}] Login failed: ${e.message}`, 'ERROR');
      this.stats.totalErrors++;
      return false;
    }
  }

  async requestSet() {
    try {
      const result = await apiPost('/api/judges/assign', {
        judge_id: this.judgeId,
        event_id: this.eventId,
      });

      if (!result.set) return null;

      this.stats.totalSetsAssigned++;
      const set = result.set;

      for (const st of set.judging_set_teams || []) {
        const existingJudge = this.stats.activeTeamLocks.get(st.team_id);
        if (existingJudge) {
          const violation = `Team ${st.team?.project_name || st.team_id} assigned to BOTH ${existingJudge} AND ${this.name}`;
          log(violation, 'ERROR');
          this.stats.concurrencyViolations.push(violation);
        }
        this.stats.activeTeamLocks.set(st.team_id, this.name);
      }

      return set;
    } catch (e) {
      if (e.message.includes('404')) return null;
      this.stats.assignmentErrors.push(`${this.name}: ${e.message}`);
      return null;
    }
  }

  async visitTeams(set) {
    const teams = (set.judging_set_teams || []).sort((a, b) => a.visit_order - b.visit_order);
    for (const st of teams) {
      await sleep(100 + Math.random() * 200);
      try {
        await apiPost('/api/judges/visit', {
          judging_set_id: set.id,
          team_id: st.team_id,
        });
      } catch (e) {
        log(`[${this.name}] Visit failed: ${e.message}`, 'ERROR');
        this.stats.totalErrors++;
      }
    }
  }

  async submitRankings(set) {
    // Build a contiguous 1..K ranking among present teams. Absent teams get rank=null.
    const presentTeams = (set.judging_set_teams || []).filter(st => !st.is_absent);
    const shuffled = [...presentTeams].sort(() => Math.random() - 0.5);
    const rankByTeam = new Map();
    shuffled.forEach((st, idx) => rankByTeam.set(st.team_id, idx + 1));

    const evaluations = (set.judging_set_teams || []).map(st => ({
      team_id: st.team_id,
      rank: rankByTeam.get(st.team_id) ?? null,
      notes: `Bot ${this.botId} auto-ranking`,
      is_absent: !rankByTeam.has(st.team_id),
    }));

    for (const st of set.judging_set_teams || []) {
      this.stats.activeTeamLocks.delete(st.team_id);
    }

    try {
      await apiPost('/api/judges/submit', {
        judging_set_id: set.id,
        evaluations,
      });
      this.stats.totalSetsCompleted++;
      this.setsCompleted++;
      for (const st of set.judging_set_teams || []) {
        this.stats.teamJudgeCounts[st.team_id] = (this.stats.teamJudgeCounts[st.team_id] || 0) + 1;
      }
      return true;
    } catch (e) {
      log(`[${this.name}] Submit failed: ${e.message}`, 'ERROR');
      this.stats.submissionErrors.push(`${this.name}: ${e.message}`);
      return false;
    }
  }

  async run(maxSets) {
    const loggedIn = await this.login();
    if (!loggedIn) return;

    await sleep(Math.random() * 500);
    let consecutiveFailures = 0;

    while (this.running && this.setsCompleted < maxSets) {
      const set = await this.requestSet();
      if (!set) {
        consecutiveFailures++;
        if (consecutiveFailures >= 5) break;
        await sleep(500 + Math.random() * 1000);
        continue;
      }
      consecutiveFailures = 0;
      await this.visitTeams(set);
      await sleep(50 + Math.random() * 100);
      await this.submitRankings(set);
      await sleep(100 + Math.random() * 200);
    }

    this.stats.judgeSetCounts[this.name] = this.setsCompleted;
  }
}

// ============================================
// Run a single scenario
// ============================================
function freshStats() {
  return {
    totalSetsAssigned: 0,
    totalSetsCompleted: 0,
    totalErrors: 0,
    assignmentErrors: [],
    submissionErrors: [],
    concurrencyViolations: [],
    teamJudgeCounts: {},
    judgeSetCounts: {},
    activeTeamLocks: new Map(),
  };
}

async function runScenario(scenario) {
  const stats = freshStats();
  const tag = scenario.name;
  let event = null;

  try {
    log(`Creating event for: ${tag}`);
    event = await apiPost('/api/events', {
      name: `Test: ${tag} — ${new Date().toLocaleTimeString()}`,
      set_size: scenario.set_size,
      target_judgings_per_team: scenario.target_judgings,
      max_judging_minutes: 30,
      admin_code: 'TEST-ADMIN',
      password: SITE_PASSWORD,
    });

    const roomsText = generateRoomsText(scenario.rooms);
    const teamsText = scenario.generateTeams
      ? scenario.generateTeams(scenario.teams, scenario.rooms)
      : generateTeamsText(scenario.teams, scenario.rooms);
    const judgesText = generateJudgesText(scenario.judges);

    const roomsResult = await apiPost('/api/import', { event_id: event.id, type: 'rooms', data: roomsText });
    const teamsResult = await apiPost('/api/import', { event_id: event.id, type: 'teams', data: teamsText });
    if (teamsResult.errors?.length > 0) {
      teamsResult.errors.forEach(e => { log(`  Team import error: ${e}`, 'ERROR'); stats.totalErrors++; });
    }
    const judgesResult = await apiPost('/api/import', { event_id: event.id, type: 'judges', data: judgesText });

    log(`  Imported ${roomsResult.imported} rooms, ${teamsResult.imported} teams, ${judgesResult.imported} judges`);

    await apiPost('/api/organizer/start', { event_id: event.id, action: 'start' });

    const judgeList = judgesResult.items;
    const startTime = Date.now();

    const bots = judgeList.map((j, i) =>
      new JudgeBot(j.name, j.access_code, event.id, i + 1, stats)
    );
    await Promise.all(bots.map(bot => bot.run(scenario.max_sets_per_judge)));

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Validate
    let results;
    try {
      results = await api(`/api/organizer/results?event_id=${event.id}`);
    } catch (e) {
      log(`  Failed to fetch results: ${e.message}`, 'ERROR');
      stats.totalErrors++;
      try { await apiPost('/api/organizer/start', { event_id: event.id, action: 'complete' }); } catch (_) {}
      return { scenario: tag, passed: false, stats, duration };
    }

    const judgeCounts = results.map(r => r.times_judged);
    const minJudged = Math.min(...judgeCounts);
    const maxJudged = Math.max(...judgeCounts);
    const avgJudged = (judgeCounts.reduce((a, b) => a + b, 0) / judgeCounts.length).toFixed(1);
    const unjudged = judgeCounts.filter(c => c === 0).length;
    const spread = maxJudged - minJudged;
    const scored = results.filter(r => r.score !== null).length;

    if (spread > 4) {
      log(`  Fairness: poor (spread = ${spread})`, 'ERROR');
      stats.totalErrors++;
    }

    try { await apiPost('/api/organizer/start', { event_id: event.id, action: 'complete' }); } catch (_) {}

    const passed = stats.totalErrors === 0 && stats.concurrencyViolations.length === 0;

    return {
      scenario: tag,
      passed,
      duration,
      teams: scenario.teams,
      rooms: scenario.rooms.length,
      judges: scenario.judges,
      set_size: scenario.set_size,
      setsCompleted: stats.totalSetsCompleted,
      minJudged,
      maxJudged,
      avgJudged,
      spread,
      unjudged,
      scored,
      totalTeams: results.length,
      errors: stats.totalErrors,
      concurrencyViolations: stats.concurrencyViolations.length,
      assignmentErrors: stats.assignmentErrors.length,
      submissionErrors: stats.submissionErrors.length,
    };
  } finally {
    if (event?.id && !process.env.KEEP_EVENTS) {
      await deleteEvent(event.id);
    }
  }
}

// ============================================
// Main
// ============================================
async function main() {
  log('========================================================');
  log('  HackPrinceton Judging — Multi-Scenario Simulation');
  log(`  Target: ${BASE_URL}`);
  log(`  Scenarios: ${SCENARIOS.length}`);
  log('========================================================\n');

  const results = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    log(`\n[${ i + 1}/${SCENARIOS.length}] ${scenario.name}`);
    log(`  Config: ${scenario.teams} teams, ${scenario.rooms.length} rooms, ${scenario.judges} judges, set_size=${scenario.set_size}, target=${scenario.target_judgings}`);

    try {
      const result = await runScenario(scenario);
      results.push(result);

      const status = result.passed ? '>>> PASSED' : '!!! FAILED';
      log(`  ${status} in ${result.duration}s — ${result.setsCompleted} sets, judged ${result.minJudged}-${result.maxJudged} (avg ${result.avgJudged}), spread=${result.spread}, errors=${result.errors}`,
        result.passed ? 'OK' : 'ERROR');
    } catch (e) {
      log(`  Scenario crashed: ${e.message}`, 'ERROR');
      results.push({ scenario: scenario.name, passed: false, duration: '?', error: e.message });
    }
  }

  // Final report
  log('\n\n========================================================');
  log('  FINAL REPORT');
  log('========================================================\n');

  const colW = { name: 36, teams: 6, rooms: 6, judges: 7, set: 4, sets: 5, judged: 12, spread: 7, time: 7, result: 8 };
  const header =
    'Scenario'.padEnd(colW.name) +
    'Teams'.padStart(colW.teams) +
    'Rooms'.padStart(colW.rooms) +
    'Judges'.padStart(colW.judges) +
    'Set'.padStart(colW.set) +
    ' Sets'.padStart(colW.sets) +
    '  Judged'.padStart(colW.judged) +
    'Spread'.padStart(colW.spread) +
    '  Time'.padStart(colW.time) +
    '  Result'.padStart(colW.result);
  log(header);
  log('-'.repeat(header.length));

  for (const r of results) {
    if (r.error) {
      log(`${r.scenario.padEnd(colW.name)}  CRASHED: ${r.error}`, 'ERROR');
      continue;
    }
    const judgedRange = `${r.minJudged}-${r.maxJudged} (${r.avgJudged})`;
    const line =
      r.scenario.padEnd(colW.name) +
      String(r.teams).padStart(colW.teams) +
      String(r.rooms).padStart(colW.rooms) +
      String(r.judges).padStart(colW.judges) +
      String(r.set_size).padStart(colW.set) +
      String(r.setsCompleted).padStart(colW.sets) +
      judgedRange.padStart(colW.judged) +
      String(r.spread).padStart(colW.spread) +
      `${r.duration}s`.padStart(colW.time) +
      (r.passed ? '  PASS' : '  FAIL').padStart(colW.result);
    log(line, r.passed ? 'OK' : 'ERROR');
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;

  log('');
  if (failedCount === 0) {
    log(`ALL ${passedCount} SCENARIOS PASSED`, 'OK');
  } else {
    log(`${failedCount}/${results.length} SCENARIOS FAILED`, 'ERROR');
  }

  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch(e => {
  log(`Simulation crashed: ${e.message}`, 'ERROR');
  console.error(e);
  process.exit(1);
});

// Note: per-scenario `finally` blocks delete events as soon as a scenario ends,
// so SIGINT in the middle of a scenario will only leak that one in-progress event.
process.on('SIGINT', () => {
  log('Caught SIGINT — exiting (in-progress event may need manual cleanup).', 'WARN');
  process.exit(130);
});
