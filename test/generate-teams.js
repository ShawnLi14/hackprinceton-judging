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

const lines = ['# Project Name, Track, Table Number, Room Name'];

for (let i = 1; i <= 200; i++) {
  const project = `${projectTypes[Math.floor(Math.random() * projectTypes.length)]} #${i}`;
  const track = tracks[Math.floor(Math.random() * tracks.length)];
  // Distribute teams across rooms roughly evenly (~16-17 per room)
  const room = rooms[(i - 1) % rooms.length];
  const tableInRoom = Math.floor((i - 1) / rooms.length) + 1;
  const tableNumber = `T${tableInRoom}`;

  lines.push(`${project}, ${track}, ${tableNumber}, ${room}`);
}

const fs = require('fs');
const path = require('path');
fs.writeFileSync(path.join(__dirname, 'data', 'teams.txt'), lines.join('\n') + '\n');
console.log(`Generated ${lines.length - 1} teams`);
