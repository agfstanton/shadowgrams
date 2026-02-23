const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { DAILY_PATTERNS } = require('./daily-patterns');
const { API_CONFIG, TIMEZONE } = require('./config');
const { getCentralDateString, getDaysSinceLaunch, isValidUserId, isValidPuzzleIndex, isValidDateFormat } = require('./utils');

// Load puzzle data once at startup
let puzzleData = null;
let puzzleMap = {}; // pattern key -> puzzle details

try {
  const puzzleDataPath = path.join(__dirname, '../data/puzzle-data.json');
  const puzzleDataText = require('fs').readFileSync(puzzleDataPath, 'utf-8');
  puzzleData = JSON.parse(puzzleDataText);
  
  // Build a lookup map: pattern string -> puzzle object
  puzzleData.puzzles.forEach(puzzle => {
    const key = puzzle.pattern.join(',');
    puzzleMap[key] = puzzle;
  });
  
  console.log(`Loaded ${puzzleData.puzzles.length} puzzles from puzzle-data.json`);
} catch (error) {
  console.error('Error loading puzzle-data.json:', error);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || API_CONFIG.port || 3000;
const LOGS_FILE = path.join(__dirname, '../data/puzzle-logs.json');

app.use((req, res, next) => {
  console.log('>>> Request:', req.method, req.path);
  next();
});

// Rate limiting middleware (simple in-memory implementation)
const requestCounts = new Map();
const rateLimitMiddleware = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!requestCounts.has(ip)) {
        requestCounts.set(ip, []);
    }
    
    const requests = requestCounts.get(ip).filter(time => now - time < API_CONFIG.rateLimit.windowMs);
    
    if (requests.length >= API_CONFIG.rateLimit.maxRequests) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    
    requests.push(now);
    requestCounts.set(ip, requests);
    next();
};

// Enable CORS for local development (lock down for production)
app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: false
}));
app.use(express.json({ limit: '1kb' })); // Limit request body size

// Apply rate limiting to API endpoints
app.use('/api/', rateLimitMiddleware);

// Serve static files from current directory
app.use(express.static(path.join(__dirname, '../public/')));

// Helper function to get or initialize logs
async function getLogs() {
  try {
    const data = await fs.readFile(LOGS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

// Helper function to save logs
async function saveLogs(logs) {
  await fs.writeFile(LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
}

// Endpoint to log a successful word submission
app.post('/api/log/interaction', async (req, res) => {
  // For now, just acknowledge the request (logging can be enhanced later)
  res.json({ success: true });
});

// Endpoint to view puzzle stats
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await getLogs();
    
    // Convert back to proper format with user counts
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
      throw new Error('Invalid puzzle index calculated');
    }
    
    const pattern = DAILY_PATTERNS[puzzleIndex];
    const patternKey = pattern.join(',');
    const puzzleMetadata = puzzleMap[patternKey];
    
    if (!puzzleMetadata) {
      throw new Error(`Puzzle metadata not found for pattern: ${patternKey}`);
    }
    
    res.json({
      pattern: pattern,
      puzzleIndex: puzzleIndex + 1,
      date: getCentralDateString(),
      wordCount: puzzleMetadata.wordCount,
      thresholds: puzzleMetadata.thresholds
    });
  } catch (error) {
    console.error('Error in /api/puzzle/today:', error);
    res.status(500).json({ error: 'Failed to get puzzle' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('Serving Shade and Shadowgrams');
});
