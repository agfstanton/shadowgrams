// Utility functions - moved from game.js for reusability and server-side use
// Works in both browser and Node.js environments

const CONFIG = (typeof module !== 'undefined' && module.exports) ? require('./config') : (typeof window !== 'undefined' ? window : {});

/**
 * Get Central Time date string in YYYY-MM-DD format
 */
function getCentralDateString(date = null) {
    const d = date || new Date();
    const timezone = CONFIG.TIMEZONE || 'America/Chicago';
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(d);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    return `${year}-${month}-${day}`;
}

/**
 * Get days since game launch (Feb 14, 2026)
 */
function getDaysSinceLaunch() {
    const startDate = new Date('2026-02-14');
    startDate.setHours(0, 0, 0, 0);
    
    const now = new Date();
    const todayCST = new Date(getCentralDateString(now));
    todayCST.setHours(0, 0, 0, 0);
    
    return Math.floor((todayCST - startDate) / (1000 * 60 * 60 * 24));
}

/**
 * Generate or retrieve unique user ID
 */
function getOrCreateUserId() {
    const KEY = 'shadowgrams_user_id';
    let userId;
    
    // Browser environment
    if (typeof localStorage !== 'undefined') {
        userId = localStorage.getItem(KEY);
        if (!userId) {
            userId = 'user_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem(KEY, userId);
        }
        return userId;
    }
    
    // Server environment - generate on the fly
    return 'server_user_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Validate user ID format
 */
function isValidUserId(userId) {
    return typeof userId === 'string' && userId.match(/^(user_|server_user_)[a-z0-9]{9}$/);
}

/**
 * Validate puzzle index (1-indexed)
 */
function isValidPuzzleIndex(index) {
    return Number.isInteger(index) && index >= 1 && index <= 2015;
}

/**
 * Validate date format (YYYY-MM-DD)
 */
function isValidDateFormat(dateStr) {
    return typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getCentralDateString,
        getDaysSinceLaunch,
        getOrCreateUserId,
        isValidUserId,
        isValidPuzzleIndex,
        isValidDateFormat
    };
}
