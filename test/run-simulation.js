/**
 * HackPrinceton Judging Simulation
 * 
 * This script:
 * 1. Creates a test event
 * 2. Imports rooms, teams, and judges from text files
 * 3. Starts the event
 * 4. Spawns judge bots that simulate the full judging flow
 * 5. Validates correctness throughout:
 *    - No team is judged by two judges simultaneously
 *    - All teams get judged roughly equally
 *    - No errors in the flow
 *    - Rankings are properly recorded
 * 
 * Usage: node test/run-simulation.js [BASE_URL]
 *   Default BASE_URL: http://localhost:3000
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const DATA_DIR = path.join(__dirname, 'data');

// ============================================
// Tracking & Validation
// ============================================
const stats = {
  totalSetsAssigned: 0,
  totalSetsCompleted: 0,
  totalErrors: 0,
  assignmentErrors: [],
  submissionErrors: [],
  concurrencyViolations: [],     // teams judged by 2+ judges at once
  teamJudgeCounts: {},           // team_id -> count
  judgeSetCounts: {},            // judge_name -> count
  activeTeamLocks: new Map(),    // team_id -> judge_name (currently being judged)
  startTime: null,
  endTime: null,
};

function log(msg, level = 'INFO') {
  const timestamp = new Date().toISOString().slice(11, 23);
  const prefix = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : level === 'OK' ? '✅' : '📋';
  console.log(`[${timestamp}] ${prefix} ${msg}`);
}

function logError(msg) { log(msg, 'ERROR'); stats.totalErrors++; }
function logOk(msg) { log(msg, 'OK'); }

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

// ============================================
// Setup: Create event & import data
// ============================================
async function setupEvent() {
  log('Creating test event...');
  const event = await apiPost('/api/events', {
    name: `Simulation Test ${new Date().toLocaleTimeString()}`,
    set_size: 5,
    target_judgings_per_team: 3,
    max_judging_minutes: 30,
    admin_code: 'TEST-ADMIN',
  });
  log(`Event created: ${event.name} (${event.id})`);
  return event;
}

async function importData(eventId) {
  const roomsData = fs.readFileSync(path.join(DATA_DIR, 'rooms.txt'), 'utf-8');
  log('Importing rooms...');
  const roomsResult = await apiPost('/api/import', { event_id: eventId, type: 'rooms', data: roomsData });
  log(`Imported ${roomsResult.imported} rooms`);

  const teamsData = fs.readFileSync(path.join(DATA_DIR, 'teams.txt'), 'utf-8');
  log('Importing teams...');
  const teamsResult = await apiPost('/api/import', { event_id: eventId, type: 'teams', data: teamsData });
  log(`Imported ${teamsResult.imported} teams`);
  if (teamsResult.errors?.length > 0) {
    teamsResult.errors.forEach(e => logError(`Team import: ${e}`));
  }

  const judgesData = fs.readFileSync(path.join(DATA_DIR, 'judges.txt'), 'utf-8');
  log('Importing judges...');
  const judgesResult = await apiPost('/api/import', { event_id: eventId, type: 'judges', data: judgesData });
  log(`Imported ${judgesResult.imported} judges`);

  return { rooms: roomsResult, teams: teamsResult, judges: judgesResult };
}

async function startEvent(eventId) {
  log('Starting event...');
  await apiPost('/api/organizer/start', { event_id: eventId, action: 'start' });
  logOk('Event started');
}

// ============================================
// Judge Bot
// ============================================
class JudgeBot {
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
    log(`[Bot ${this.botId} - ${this.name}] ${msg}`, level);
  }

  async login() {
    try {
      const result = await apiPost('/api/judges/login', {
        access_code: this.accessCode,
        event_id: this.eventId,
      });
      this.judgeId = result.judge.id;
      this.log(`Logged in (id: ${this.judgeId.slice(0, 8)}...)`);
      return true;
    } catch (e) {
      this.log(`Login failed: ${e.message}`, 'ERROR');
      stats.totalErrors++;
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
        this.log('No set returned (may be no available teams)', 'WARN');
        return null;
      }

      stats.totalSetsAssigned++;
      const set = result.set;
      const teamNames = set.judging_set_teams
        ?.map(st => st.team?.name || st.team_id.slice(0, 8))
        .join(', ');

      this.log(`Assigned set ${set.id.slice(0, 8)}... with ${set.judging_set_teams?.length || 0} teams: [${teamNames}]`);

      // Concurrency check: verify no team in this set is already being judged
      for (const st of set.judging_set_teams || []) {
        const existingJudge = stats.activeTeamLocks.get(st.team_id);
        if (existingJudge) {
          const violation = `Team ${st.team?.name || st.team_id} assigned to BOTH ${existingJudge} AND ${this.name}`;
          this.log(violation, 'ERROR');
          stats.concurrencyViolations.push(violation);
        }
        stats.activeTeamLocks.set(st.team_id, this.name);
      }

      return set;
    } catch (e) {
      if (e.message.includes('404')) {
        this.log('No teams available for assignment');
        return null;
      }
      this.log(`Assignment failed: ${e.message}`, 'ERROR');
      stats.assignmentErrors.push(`${this.name}: ${e.message}`);
      return null;
    }
  }

  async visitTeams(set) {
    const teams = (set.judging_set_teams || []).sort((a, b) => a.visit_order - b.visit_order);

    for (const st of teams) {
      await sleep(200 + Math.random() * 300);

      try {
        await apiPost('/api/judges/visit', {
          judging_set_id: set.id,
          team_id: st.team_id,
        });
      } catch (e) {
        this.log(`Visit failed for team ${st.team_id}: ${e.message}`, 'ERROR');
        stats.totalErrors++;
      }
    }
  }

  async submitRankings(set) {
    const teams = (set.judging_set_teams || []).filter(st => !st.is_absent);

    const shuffled = [...teams].sort(() => Math.random() - 0.5);
    const rankings = set.judging_set_teams.map(st => {
      const rankIdx = shuffled.findIndex(s => s.team_id === st.team_id);
      return {
        team_id: st.team_id,
        rank: rankIdx >= 0 ? rankIdx + 1 : teams.length,
        notes: `Bot ${this.botId} auto-ranking`,
        is_absent: false,
      };
    });

    // Release local tracking BEFORE calling submit API.
    // The DB releases locks atomically during the submit RPC,
    // so clearing here prevents false-positive concurrency violations.
    for (const st of set.judging_set_teams || []) {
      stats.activeTeamLocks.delete(st.team_id);
    }

    try {
      await apiPost('/api/judges/submit', {
        judging_set_id: set.id,
        rankings,
      });

      stats.totalSetsCompleted++;
      this.setsCompleted++;

      for (const st of set.judging_set_teams || []) {
        stats.teamJudgeCounts[st.team_id] = (stats.teamJudgeCounts[st.team_id] || 0) + 1;
      }

      this.log(`Submitted rankings for set ${set.id.slice(0, 8)}... (total: ${this.setsCompleted} sets)`);
      return true;
    } catch (e) {
      this.log(`Submit failed: ${e.message}`, 'ERROR');
      stats.submissionErrors.push(`${this.name}: ${e.message}`);
      return false;
    }
  }

  async run(maxSets = 10) {
    const loggedIn = await this.login();
    if (!loggedIn) return;

    await sleep(Math.random() * 1000);

    let consecutiveFailures = 0;

    while (this.running && this.setsCompleted < maxSets) {
      const set = await this.requestSet();

      if (!set) {
        consecutiveFailures++;
        if (consecutiveFailures >= 5) {
          this.log('5 consecutive failures to get a set, stopping');
          break;
        }
        await sleep(1000 + Math.random() * 2000);
        continue;
      }

      consecutiveFailures = 0;

      await this.visitTeams(set);
      await sleep(100 + Math.random() * 200);
      await this.submitRankings(set);
      await sleep(300 + Math.random() * 500);
    }

    stats.judgeSetCounts[this.name] = this.setsCompleted;
    this.log(`Finished. ${this.setsCompleted} sets completed.`);
  }

  stop() {
    this.running = false;
  }
}

// ============================================
// Validation & Reporting
// ============================================
async function validateResults(eventId) {
  log('\n========================================');
  log('VALIDATION & RESULTS');
  log('========================================\n');

  // Check results from the API
  let results;
  try {
    results = await api(`/api/organizer/results?event_id=${eventId}`);
  } catch (e) {
    logError(`Failed to fetch results: ${e.message}`);
    return;
  }

  // Check team judging counts
  const judgeCounts = results.map(r => r.times_judged);
  const minJudged = Math.min(...judgeCounts);
  const maxJudged = Math.max(...judgeCounts);
  const avgJudged = (judgeCounts.reduce((a, b) => a + b, 0) / judgeCounts.length).toFixed(1);
  const unjudged = judgeCounts.filter(c => c === 0).length;

  log(`Teams: ${results.length}`);
  log(`Judging counts — min: ${minJudged}, max: ${maxJudged}, avg: ${avgJudged}`);
  log(`Unjudged teams: ${unjudged}`);

  // Check fairness
  const spread = maxJudged - minJudged;
  if (spread <= 2) {
    logOk(`Fairness: excellent (spread = ${spread})`);
  } else if (spread <= 4) {
    log(`Fairness: acceptable (spread = ${spread})`, 'WARN');
  } else {
    logError(`Fairness: poor (spread = ${spread}), some teams judged much more than others`);
  }

  // Concurrency violations
  if (stats.concurrencyViolations.length === 0) {
    logOk('Concurrency: no double-judging detected');
  } else {
    logError(`Concurrency: ${stats.concurrencyViolations.length} violations detected!`);
    stats.concurrencyViolations.slice(0, 10).forEach(v => logError(`  ${v}`));
    if (stats.concurrencyViolations.length > 10) {
      logError(`  ... and ${stats.concurrencyViolations.length - 10} more`);
    }
  }

  // Check scores exist
  const scored = results.filter(r => r.score !== null);
  if (scored.length === results.length) {
    logOk(`Scoring: all ${results.length} teams have scores`);
  } else {
    log(`Scoring: ${scored.length}/${results.length} teams have scores (${results.length - scored.length} missing)`, 'WARN');
  }

  // Top 5
  log('\nTop 5 teams:');
  results.slice(0, 5).forEach((r, i) => {
    log(`  #${i + 1}: ${r.name} — score: ${r.score?.toFixed(1) || 'N/A'}, judged: ${r.times_judged}x`);
  });

  // Judge workload
  log('\nJudge workload:');
  const judgeEntries = Object.entries(stats.judgeSetCounts).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of judgeEntries) {
    log(`  ${name}: ${count} sets`);
  }

  // Summary
  log('\n========================================');
  log('SUMMARY');
  log('========================================');
  log(`Duration: ${((stats.endTime - stats.startTime) / 1000).toFixed(1)}s`);
  log(`Sets assigned: ${stats.totalSetsAssigned}`);
  log(`Sets completed: ${stats.totalSetsCompleted}`);
  log(`Total errors: ${stats.totalErrors}`);
  log(`Concurrency violations: ${stats.concurrencyViolations.length}`);
  log(`Assignment errors: ${stats.assignmentErrors.length}`);
  log(`Submission errors: ${stats.submissionErrors.length}`);

  if (stats.totalErrors === 0 && stats.concurrencyViolations.length === 0) {
    logOk('ALL TESTS PASSED ✓');
  } else {
    logError('SOME TESTS FAILED ✗');
  }
}

// ============================================
// Main
// ============================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  log(`Starting simulation against ${BASE_URL}`);
  log('========================================\n');

  // 1. Setup
  const event = await setupEvent();
  const { judges } = await importData(event.id);

  // 2. Start event
  await startEvent(event.id);

  // 3. Create judge bots
  const judgeList = judges.items;
  const maxSetsPerJudge = 8;

  log(`\nSpawning ${judgeList.length} judge bots (max ${maxSetsPerJudge} sets each)...\n`);

  stats.startTime = Date.now();

  const bots = judgeList.map((j, i) =>
    new JudgeBot(j.name, j.access_code, event.id, i + 1)
  );

  // 4. Run all bots concurrently
  await Promise.all(bots.map(bot => bot.run(maxSetsPerJudge)));

  stats.endTime = Date.now();

  // 5. Validate
  await validateResults(event.id);

  // Cleanup: complete the event
  try {
    await apiPost('/api/organizer/start', { event_id: event.id, action: 'complete' });
    log('\nEvent marked as completed.');
  } catch (e) {
    log(`Failed to complete event: ${e.message}`, 'WARN');
  }
}

main().catch(e => {
  logError(`Simulation crashed: ${e.message}`);
  console.error(e);
  process.exit(1);
});
