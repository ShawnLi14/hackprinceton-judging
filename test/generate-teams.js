// Generate 200 teams spread across rooms
// Output: test/data/teams.txt

const rooms = [
  // Floor 1
  'Friend 101', 'Friend 103', 'Friend 105', 'Friend 108', 'Friend 110',
  // Floor 2
  'Friend 201', 'Friend 203', 'Friend 205', 'Friend 206',
  // Floor 3
  'Sherrerd 301', 'Sherrerd 303', 'Sherrerd 305',
];

const projectTypes = [
  'AI Assistant', 'Health Tracker', 'Study Buddy', 'Food Finder', 'Transit App',
  'Budget Planner', 'Eco Monitor', 'Music Generator', 'AR Navigator', 'Chat Platform',
  'Code Reviewer', 'Recipe AI', 'Fitness Coach', 'Language Tutor', 'Job Matcher',
  'Volunteer Hub', 'Event Planner', 'Safety Alert', 'Mood Tracker', 'Plant Care',
  'Smart Calendar', 'Note Taker', 'Habit Builder', 'Sleep Analyzer', 'Water Reminder',
  'Carbon Calculator', 'Donation Platform', 'Skill Swap', 'Lost & Found', 'Parking Finder',
  'Reading List', 'Meal Prep', 'Weather Alert', 'Accessibility Tool', 'Price Tracker',
  'Virtual Tutor', 'Waste Sorter', 'Commute Optimizer', 'Mental Health App', 'Pet Finder',
];

const tracks = ['Health', 'Education', 'Sustainability', 'Social Good', 'Finance'];

// Sample opt-in prizes (mirrors Devpost-style "Opt-In Prize" values).
// Each team independently opts into 0-3 of these. Teams have one track but
// many prizes — that asymmetry is exactly what the importer/UI handles.
const prizes = [
  'Best Use of Gemini API',
  'Best AI-Powered App',
  'Best Domain Name from GoDaddy Registry',
  'AI Research and Alignment Environments',
  'Best Use of K2 Think V2',
  'Best Use of Knot API',
];

const lines = ['# Project Name, Track, Table Number, Room Name, Devpost URL, Prize1|Prize2|...'];

for (let i = 1; i <= 200; i++) {
  const project = `${projectTypes[Math.floor(Math.random() * projectTypes.length)]} #${i}`;
  const track = tracks[Math.floor(Math.random() * tracks.length)];
  // Distribute teams across rooms roughly evenly (~16-17 per room)
  const room = rooms[(i - 1) % rooms.length];
  const tableInRoom = Math.floor((i - 1) / rooms.length) + 1;
  const tableNumber = `T${tableInRoom}`;

  // 0-3 distinct prizes, kept in a stable alphabetical order so re-runs
  // don't churn the file just because Math.random shuffled.
  const numPrizes = Math.floor(Math.random() * 4); // 0, 1, 2, or 3
  const shuffled = prizes.slice().sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, numPrizes).sort((a, b) => a.localeCompare(b));
  const prizeField = picked.join('|');

  // Devpost URL stays empty for synthetic teams; field is still emitted so
  // the line is unambiguously the 6-field format.
  lines.push(`${project}, ${track}, ${tableNumber}, ${room}, , ${prizeField}`);
}

const fs = require('fs');
const path = require('path');
fs.writeFileSync(path.join(__dirname, 'data', 'teams.txt'), lines.join('\n') + '\n');
console.log(`Generated ${lines.length - 1} teams`);
