const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { DAILY_PATTERNS } = require('../src/daily-patterns');
const { API_CONFIG, TIMEZONE } = require('../src/config');
const { getCentralDateString, getDaysSinceLaunch, isValidUserId, isValidPuzzleIndex, isValidDateFormat } = require('../src/utils');

// Load puzzle data once at startup
let puzzleData = null;
let puzzleMap = {};

try {
  const puzzleDataPath = path.join(__dirname, '../data/puzzle-data.json');
  const puzzleDataText = require('fs').readFileSync(puzzleDataPath, 'utf-8');
  puzzleData = JSON.parse(puzzleDataText);
  puzzleData.puzzles.forEach(puzzle => {
    const key = puzzle.pattern.join(',');
    puzzleMap[key] = puzzle;
  });
  console.log(`Loaded ${puzzleData.puzzles.length} puzzles`);
} catch (error) {
  console.error('Error loading puzzles:', error);
}

const app = express();

app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: false
}));
app.use(express.json({ limit: '1kb' }));
app.use(express.static(path.join(__dirname, '../public/')));

const LOGS_FILE = path.join(__dirname, '../data/puzzle-logs.json');

async function getLogs() {
  try {
    const data = await fs.readFile(LOGS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

async function saveLogs(logs) {
  await fs.writeFile(LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
}

app.post('/api/log/interaction', async (req, res) => {
  res.json({ success: true });
});

app.get('/api/logs', async (req, res) => {
  try {
    const logs = await getLogs();
    const stats = {};
    for (const [date, data] of Object.entries(logs)) {
      stats[date] = {
        puzzleIndex: data.puzzleIndex,
        date: data.date,
        uniqueUsers: Array.isArray(data.uniqueUsers) ? data.uniqueUsers.length : data.uniqueUsers.size,
        totalSubmissions: data.totalSubmissions
      };
    }
    res.json(stats);
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

app.get('/api/puzzle/today', (req, res) => {
  try {
    const daysSinceLaunch = getDaysSinceLaunch();
    const puzzleIndex = daysSinceLaunch % DAILY_PATTERNS.length;
    
    if (!DAILY_PATTERNS[puzzleIndex]) {
      throw new Error('Invalid puzzle index');
    }
    
    const pattern = DAILY_PATTERNS[puzzleIndex];
    const patternKey = pattern.join(',');
    const puzzleMetadata = puzzleMap[patternKey];
    
    if (!puzzleMetadata) {
      throw new Error(`Puzzle not found: ${patternKey}`);
    }
    
    res.json({
      pattern: pattern,
      puzzleIndex: puzzleIndex + 1,
      date: getCentralDateString(),
      wordCount: puzzleMetadata.wordCount,
      thresholds: puzzleMetadata.thresholds
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to get puzzle' });
  }
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
