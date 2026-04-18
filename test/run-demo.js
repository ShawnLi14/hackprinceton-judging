/**
 * HackPrinceton Judging — Slow Demo Simulation
 * 
 * A smaller, slower simulation (~5 minutes) designed for visually
 * watching the organizer dashboard in real time.
 * 
 * - 5 judges, 30 teams, 6 rooms across 3 floors
 * - Judges take 30-60s per set (visiting + thinking + ranking)
 * - Some judges take random breaks between sets
 * - Target: 3 judgings per team
 * 
 * Usage: node test/run-demo.js [BASE_URL]
 *   Default BASE_URL: http://localhost:3000
 *
 * The demo event is deleted automatically once the run completes (or on
 * SIGINT/crash). Set KEEP_EVENTS=1 to retain it for inspection.
 * Set SITE_PASSWORD=... if your /api/events password isn't 'hehe1414'.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const DATA_DIR = path.join(__dirname, 'data');

// ============================================
// Config — tune these for desired duration
// ============================================
const VISIT_DELAY_MIN = 5000;    // 5s min per team visit
const VISIT_DELAY_MAX = 10000;   // 10s max per team visit
const RANK_THINK_TIME = 3000;    // 3s to "think" before ranking
const BETWEEN_SETS_MIN = 3000;   // 3s min between sets
const BETWEEN_SETS_MAX = 8000;   // 8s max between sets
const BREAK_CHANCE = 0.25;       // 25% chance of taking a break after a set
const BREAK_DURATION_MIN = 10000; // 10s min break
const BREAK_DURATION_MAX = 25000; // 25s max break
const MAX_SETS_PER_JUDGE = 6;    // stop after this many sets

// ============================================
// Helpers
// ============================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

function log(msg, level = 'INFO') {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const prefix = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : level === 'OK' ? '✅' : level === 'BREAK' ? '☕' : '📋';
  console.log(`[${elapsed.padStart(6)}s] ${prefix} ${msg}`);
}

let startTime = Date.now();

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
    log(`Cleaned up event ${eventId}`, 'OK');
  } catch (e) {
    log(`Cleanup: failed to delete event ${eventId}: ${e.message}`, 'WARN');
  }
}

// ============================================
// Setup
// ============================================
async function setupEvent() {
  log('Creating demo event...');
  const event = await apiPost('/api/events', {
    name: `Demo ${new Date().toLocaleTimeString()}`,
    set_size: 5,
    target_judgings_per_team: 3,
    max_judging_minutes: 5,
    admin_code: 'DEMO-ADMIN',
    password: SITE_PASSWORD,
  });
  log(`Event created: ${event.name} (${event.id})`);
  return event;
}

async function importData(eventId) {
  const roomsData = fs.readFileSync(path.join(DATA_DIR, 'demo-rooms.txt'), 'utf-8');
  log('Importing rooms...');
  const roomsResult = await apiPost('/api/import', { event_id: eventId, type: 'rooms', data: roomsData });
  log(`  ${roomsResult.imported} rooms imported`);

  const teamsData = fs.readFileSync(path.join(DATA_DIR, 'demo-teams.txt'), 'utf-8');
  log('Importing teams...');
  const teamsResult = await apiPost('/api/import', { event_id: eventId, type: 'teams', data: teamsData });
  log(`  ${teamsResult.imported} teams imported`);
  if (teamsResult.errors?.length > 0) {
    teamsResult.errors.forEach(e => log(`  Team import error: ${e}`, 'WARN'));
  }

  const judgesData = fs.readFileSync(path.join(DATA_DIR, 'demo-judges.txt'), 'utf-8');
  log('Importing judges...');
  const judgesResult = await apiPost('/api/import', { event_id: eventId, type: 'judges', data: judgesData });
  log(`  ${judgesResult.imported} judges imported`);

  return { rooms: roomsResult, teams: teamsResult, judges: judgesResult };
}

async function startEvent(eventId) {
  log('Starting event...');
  await apiPost('/api/organizer/start', { event_id: eventId, action: 'start' });
  log('Event is now ACTIVE — open the dashboard to watch!', 'OK');
}

// ============================================
// Judge Bot (slow & visual)
// ============================================
class DemoJudgeBot {
  constructor(name, accessCode, eventId, botId) {
    this.name = name;
    this.accessCode = accessCode;
    this.eventId = eventId;
    this.botId = botId;
    this.judgeId = null;
    this.setsCompleted = 0;
    this.running = true;
  }

  log(msg, level = 'INFO') {
    log(`[${this.name}] ${msg}`, level);
  }

  async login() {
    try {
      const result = await apiPost('/api/judges/login', {
        access_code: this.accessCode,
        event_id: this.eventId,
      });
      this.judgeId = result.judge.id;
      this.log('Logged in');
      return true;
    } catch (e) {
      this.log(`Login failed: ${e.message}`, 'ERROR');
      return false;
    }
  }

  async requestSet() {
    try {
      const result = await apiPost('/api/judges/assign', {
        judge_id: this.judgeId,
        event_id: this.eventId,
      });

      if (!result.set) {
        this.log('No teams available', 'WARN');
        return null;
      }

      const teams = result.set.judging_set_teams || [];
      const teamNames = teams
        .sort((a, b) => a.visit_order - b.visit_order)
        .map(st => `${st.team?.project_name || 'Untitled'} (${st.team?.room?.name} #${st.team?.team_number})`)
        .join(', ');

      this.log(`Got set with ${teams.length} teams: ${teamNames}`);
      return result.set;
    } catch (e) {
      if (e.message.includes('404')) {
        this.log('No teams available for assignment');
        return null;
      }
      this.log(`Assignment failed: ${e.message}`, 'ERROR');
      return null;
    }
  }

  async visitTeams(set) {
    const teams = (set.judging_set_teams || []).sort((a, b) => a.visit_order - b.visit_order);

    for (let i = 0; i < teams.length; i++) {
      const st = teams[i];
      const teamName = st.team?.project_name || 'Untitled';
      const room = st.team?.room?.name || '?';
      const teamNum = st.team?.team_number || '?';

      this.log(`  Visiting ${i + 1}/${teams.length}: ${teamName} at ${room} #${teamNum}...`);

      // Simulate walking + judging time
      const delay = randBetween(VISIT_DELAY_MIN, VISIT_DELAY_MAX);
      await sleep(delay);

      try {
        await apiPost('/api/judges/visit', {
          judging_set_id: set.id,
          team_id: st.team_id,
        });
        this.log(`  ✓ Visited ${teamName} (${(delay / 1000).toFixed(1)}s)`);
      } catch (e) {
        this.log(`  Visit failed for ${teamName}: ${e.message}`, 'ERROR');
      }
    }
  }

  async submitRankings(set) {
    this.log('  Thinking about rankings...');
    await sleep(RANK_THINK_TIME);

    const teams = set.judging_set_teams || [];
    const shuffled = [...teams].sort(() => Math.random() - 0.5);
    const rankings = teams.map(st => {
      const rankIdx = shuffled.findIndex(s => s.team_id === st.team_id);
      return {
        team_id: st.team_id,
        rank: rankIdx + 1,
        notes: `Demo ranking by ${this.name}`,
        is_absent: false,
      };
    });

    try {
      await apiPost('/api/judges/submit', {
        judging_set_id: set.id,
        rankings,
      });

      this.setsCompleted++;
      this.log(`Submitted rankings! (${this.setsCompleted} sets done)`, 'OK');
      return true;
    } catch (e) {
      this.log(`Submit failed: ${e.message}`, 'ERROR');
      return false;
    }
  }

  async maybeBreak() {
    if (Math.random() < BREAK_CHANCE) {
      const breakDuration = randBetween(BREAK_DURATION_MIN, BREAK_DURATION_MAX);
      this.log(`Taking a ${(breakDuration / 1000).toFixed(0)}s break...`, 'BREAK');

      try {
        await apiPost('/api/judges/break', {
          judge_id: this.judgeId,
          action: 'break',
        });
      } catch (e) { /* ignore */ }

      await sleep(breakDuration);

      try {
        await apiPost('/api/judges/break', {
          judge_id: this.judgeId,
          action: 'resume',
        });
      } catch (e) { /* ignore */ }

      this.log('Back from break!', 'BREAK');
    }
  }

  async run() {
    const loggedIn = await this.login();
    if (!loggedIn) return;

    // Stagger start — judges don't all begin at the same time
    const stagger = randBetween(1000, 5000);
    this.log(`Starting in ${(stagger / 1000).toFixed(1)}s...`);
    await sleep(stagger);

    let consecutiveFailures = 0;

    while (this.running && this.setsCompleted < MAX_SETS_PER_JUDGE) {
      const set = await this.requestSet();

      if (!set) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          this.log('No more sets available, stopping.');
          break;
        }
        await sleep(5000);
        continue;
      }

      consecutiveFailures = 0;

      // Visit each team (the slow visual part)
      await this.visitTeams(set);

      // Submit rankings
      await this.submitRankings(set);

      // Maybe take a break
      await this.maybeBreak();

      // Wait a bit before requesting next set
      const wait = randBetween(BETWEEN_SETS_MIN, BETWEEN_SETS_MAX);
      this.log(`Waiting ${(wait / 1000).toFixed(1)}s before next set...`);
      await sleep(wait);
    }

    this.log(`Done! Completed ${this.setsCompleted} sets total.`, 'OK');
  }

  stop() {
    this.running = false;
  }
}

// ============================================
// Main
// ============================================
let demoEventId = null;

async function main() {
  startTime = Date.now();
  log('╔══════════════════════════════════════════╗');
  log('║   HackPrinceton Judging — Demo Mode      ║');
  log('║   Open the dashboard to watch live!       ║');
  log('╚══════════════════════════════════════════╝');
  log(`Target: ${BASE_URL}`);
  if (process.env.KEEP_EVENTS) log('KEEP_EVENTS set — demo event will NOT be cleaned up.');
  log('');

  // 1. Setup
  const event = await setupEvent();
  demoEventId = event.id;
  await importData(event.id);

  log('');
  log('═══════════════════════════════════════════');
  log(`Dashboard URL: ${BASE_URL}/organizer/dashboard?event=${event.id}`);
  log('═══════════════════════════════════════════');
  log('');

  // 2. Start event
  await startEvent(event.id);
  log('');

  // 3. Parse the judges list from the data file
  const judgesData = fs.readFileSync(path.join(DATA_DIR, 'demo-judges.txt'), 'utf-8');
  const judgeLines = judgesData
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  const judges = judgeLines.map(line => {
    const [name, access_code] = line.split(',').map(s => s.trim());
    return { name, access_code };
  });

  log(`Spawning ${judges.length} judge bots (max ${MAX_SETS_PER_JUDGE} sets each)...`);
  log(`Expected duration: ~5 minutes`);
  log('');

  const bots = judges.map((j, i) =>
    new DemoJudgeBot(j.name, j.access_code, event.id, i + 1)
  );

  // 4. Run all bots concurrently
  await Promise.all(bots.map(bot => bot.run()));

  // 5. Summary
  const duration = (Date.now() - startTime) / 1000;
  log('');
  log('═══════════════════════════════════════════');
  log('DEMO COMPLETE');
  log('═══════════════════════════════════════════');
  log(`Duration: ${(duration / 60).toFixed(1)} minutes (${duration.toFixed(0)}s)`);
  log(`Total sets completed: ${bots.reduce((s, b) => s + b.setsCompleted, 0)}`);
  for (const bot of bots) {
    log(`  ${bot.name}: ${bot.setsCompleted} sets`);
  }

  // Fetch final team stats
  try {
    const results = await api(`/api/organizer/results?event_id=${event.id}`);
    const judgeCounts = results.map(r => r.times_judged);
    const min = Math.min(...judgeCounts);
    const max = Math.max(...judgeCounts);
    const avg = (judgeCounts.reduce((a, b) => a + b, 0) / judgeCounts.length).toFixed(1);
    log(`Team judging stats — min: ${min}, max: ${max}, avg: ${avg}`);
  } catch (e) {
    log(`Could not fetch results: ${e.message}`, 'WARN');
  }

  // Complete event
  try {
    await apiPost('/api/organizer/start', { event_id: event.id, action: 'complete' });
    log('Event marked as completed.', 'OK');
  } catch (e) {
    log(`Failed to complete event: ${e.message}`, 'WARN');
  }
}

async function cleanup() {
  if (demoEventId && !process.env.KEEP_EVENTS) {
    await deleteEvent(demoEventId);
  }
}

main()
  .catch(e => {
    log(`Demo crashed: ${e.message}`, 'ERROR');
    console.error(e);
    process.exitCode = 1;
  })
  .finally(cleanup);

// Best-effort cleanup if the user kills the process mid-run.
const interrupt = async (signal) => {
  log(`Caught ${signal}, cleaning up...`, 'WARN');
  await cleanup();
  process.exit(130);
};
process.on('SIGINT', () => interrupt('SIGINT'));
process.on('SIGTERM', () => interrupt('SIGTERM'));
