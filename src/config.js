// Configuration file - all hardcoded values in one place

// Game constants
const TILES = {
    0: 'abcdefghijklmnopqrstuvwxyz'.split(''), // Wild tile - any letter
    1: ['b', 'd', 'f', 'h', 'i', 'k', 'l', 't'],
    2: ['a', 'c', 'e', 'm', 'n', 'o', 'r', 's', 'u', 'v', 'w', 'x', 'z'],
    3: ['g', 'p', 'q', 'y'],
    4: ['j']
};

// Scoring thresholds
const SCORE_THRESHOLDS = {
    good: 0.30,      // 30%
    better: 0.50,    // 50%
    best: 0.80       // 80%
};

// LocalStorage keys
const STORAGE_KEYS = {
    pattern: 'shadowgrams_current_pattern',
    history: 'shadowgrams_history',
    foundWords: 'shadowgrams_found_words',
    bestModal: 'shadowgrams_best_modal_shown',
    typeToBegin: 'shadowgrams_type_to_begin_completed',
    userId: 'shadowgrams_user_id'
};

// File paths
const FILE_PATHS = {
    expandedList: '2of12inf.txt'  // Used for word validation only
};

// Success messages by puzzle length
const SUCCESS_MESSAGES = {
    3: ['wow!', 'yay!', 'one!', 'yes!', 'fab!'],
    4: ['nice!', 'okay!', 'neat!', 'good!', 'cool!'],
    5: ['nifty!', 'dandy!', 'swell!', 'bravo!', 'bingo!'],
    6: ['groovy!', 'peachy!', 'superb!', 'lovely!', 'genius!']
};

// Game settings
const GAME_CONFIG = {
    inactivityTimeout: 10 * 60 * 1000, // 10 minutes
    puzzleVersion: '2plus-v2',
    minWordLength: 3,
    maxWordLength: 6,
    minPatternWords: 4
};

// API settings
const API_CONFIG = {
    port: 3000,
    rateLimit: {
        windowMs: 60000,      // 1 minute
        maxRequests: 30       // 30 requests per minute
    }
};

// Game launch date
const GAME_LAUNCH_DATE = 'February 15, 2026'; // Used in comments
const GAME_LAUNCH_UTC = new Date('2026-02-15');

// Timezone
const TIMEZONE = 'America/Chicago';

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TILES,
        SCORE_THRESHOLDS,
        STORAGE_KEYS,
        FILE_PATHS,
        SUCCESS_MESSAGES,
        GAME_CONFIG,
        API_CONFIG,
        GAME_LAUNCH_UTC,
        TIMEZONE
    };
}
