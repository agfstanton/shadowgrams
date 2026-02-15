// ====== CONFIGURATION ======
// Import from config.js (loaded via script tag before this file)
// TILES, SCORE_THRESHOLDS, STORAGE_KEYS, FILE_PATHS, SUCCESS_MESSAGES, GAME_CONFIG should be available in window scope

// Aliases for backward compatibility and local references
const EXPANDED_LIST_PATH = FILE_PATHS?.expandedList || '2of12inf.txt';
const STORAGE_KEY = STORAGE_KEYS?.pattern || 'shadowgrams_current_pattern';
const HISTORY_KEY = STORAGE_KEYS?.history || 'shadowgrams_history';
const FOUND_WORDS_KEY = STORAGE_KEYS?.foundWords || 'shadowgrams_found_words';
const BEST_MODAL_KEY = STORAGE_KEYS?.bestModal || 'shadowgrams_best_modal_shown';
const TYPE_TO_BEGIN_KEY = STORAGE_KEYS?.typeToBegin || 'shadowgrams_type_to_begin_completed';
const INACTIVITY_TIMEOUT = GAME_CONFIG?.inactivityTimeout || 10 * 60 * 1000;

// ====== GAME STATE ======
let validWords = [];  // Words from CSV (determines thresholds)
let allExpandedWords = [];  // All words from 2of12inf.txt
let expandedValidWords = new Set();  // Words from 2of12inf.txt (used for validation)
let foundWords = new Set();
let score = 0;
let totalWords = 0;
let goodThreshold = 0;
let betterThreshold = 0;
let bestThreshold = 0;
let CURRENT_PATTERN = [1,1,1,1,3]; // Current puzzle pattern (will be selected automatically)

// reverse lookup letter -> tile number (excluding wild tile 0)
const REVERSE_TILES = Object.keys(TILES).reduce((acc,k)=>{
    if (k !== '0') {  // Don't include wild tile in reverse mapping
        TILES[k].forEach(ch => acc[ch] = Number(k));
    }
    return acc;
},{ });

// pattern map: key = "len:tile,tile,..." -> [words]
let patternMap = {};
let rotationTimeoutId = null;
let rotationIntervalId = null;
let typedChars = [];
let invalidPositions = new Set(); // Track positions with letters that don't match the tile
let tileOriginalSrcs = []; // Store original SVG sources
let tileModifiedSrcs = {}; // Cache of color-modified SVG data URLs
let inactivityTimeoutId = null;
let lastActivityTime = Date.now();
let bestModalShown = false;

function trackEvent(eventName, properties) {
    if (typeof window === 'undefined') {
        return;
    }

    if (window.posthog && typeof window.posthog.capture === 'function') {
        window.posthog.capture(eventName, properties || {});
    }
}

/**
 * Save found words to localStorage for today's date
 */
function saveFoundWords() {
    try {
        const now = new Date();
        const todayDateStr = getCentralDateString(now);
        const wordsArray = Array.from(foundWords);
        localStorage.setItem(FOUND_WORDS_KEY, JSON.stringify({
            date: todayDateStr,
            words: wordsArray
        }));
    } catch(e) {
        console.error('Error saving found words:', e);
    }
}

/**
 * Load found words from localStorage if they match today's date
 */
function loadFoundWords() {
    try {
        const now = new Date();
        const todayDateStr = getCentralDateString(now);
        const stored = localStorage.getItem(FOUND_WORDS_KEY);
        if (stored) {
            const data = JSON.parse(stored);
            if (data.date === todayDateStr && Array.isArray(data.words)) {
                // Restore found words
                data.words.forEach(word => {
                    if (expandedValidWords.has(word)) {
                        foundWords.add(word);
                        score++;
                        addWordToGrid(word);
                    }
                });
                updateScore();
            }
        }
    } catch(e) {
        console.error('Error loading found words:', e);
    }
}

/**
 * Log pattern to history
 */
function logPatternToHistory(date, patternKey, patternArray) {
    try {
        let history = [];
        const storedHistory = localStorage.getItem(HISTORY_KEY);
        if (storedHistory) {
            history = JSON.parse(storedHistory);
        }
        
        // Add new entry
        history.push({
            date,
            patternKey,
            patternArray,
            timestamp: new Date().toISOString()
        });
        
        // Keep only last 365 days to manage storage
        if (history.length > 365) {
            history = history.slice(-365);
        }
        
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        
        // Update puzzle number display
        displayPuzzleNumber();
    } catch(e) {
        console.error('Error logging to history:', e);
    }
}

/**
 * Display pattern history in console (hidden feature)
 */
function showPatternHistory() {
    try {
        const storedHistory = localStorage.getItem(HISTORY_KEY);
        if (!storedHistory) {
            console.log('No pattern history found.');
            return;
        }
        
        const history = JSON.parse(storedHistory);
        console.clear();
        console.log('%cShadowgrams Pattern History', 'font-size: 16px; font-weight: bold; color: #667eea;');
        console.log(`Total entries: ${history.length}\n`);
        
        history.forEach((entry, idx) => {
            console.log(`%c${idx + 1}. ${entry.date}`, 'font-weight: bold; color: #764ba2;');
            console.log(`   Pattern: [${entry.patternArray.join(', ')}]`);
            console.log(`   Key: ${entry.patternKey}\n`);
        });
    } catch(e) {
        console.error('Error retrieving history:', e);
    }
}

// ====== WORD VALIDATION ======
/**
 * Check if a word matches the current puzzle pattern
 */
function matchesPattern(word, pattern) {
    // Word must be same length as pattern
    if (word.length !== pattern.length) {
        return false;
    }
    
    // Check each letter against its corresponding tile
    for (let i = 0; i < word.length; i++) {
        const letter = word[i];
        const tileNumber = pattern[i];
        const allowedLetters = TILES[tileNumber];
        
        if (!allowedLetters.includes(letter)) {
            return false;
        }
    }
    
    return true;
}

/**
 * Parse CSV row safely, handling quoted fields
 */
function parseCSVRow(line) {
    // Function no longer needed - puzzle data comes from API
    return [];
}

/**
 * Load validation words from 2of12inf.txt and puzzle data from API
 */
async function loadWordlist() {
    try {
        // Load the expanded wordlist from 2of12inf.txt for validation only
        let expandedWords = [];
        try {
            const expandedResponse = await fetch(EXPANDED_LIST_PATH);
            const expandedText = await expandedResponse.text();
            expandedWords = expandedText.split('\n')
                .map(word => word.trim().toLowerCase())
                .filter(word => word.length > 0);
        } catch (e) {
            console.warn('Could not load 2of12inf.txt for validation:', e);
            console.warn('Word validation will be limited');
        }
        
        allExpandedWords = expandedWords;

        // Choose pattern: try persisted first
        const now = new Date();
        const todayDateStr = getCentralDateString(now);
        
        // Version check for cache invalidation
        const PUZZLE_VERSION = 'server-v1';
        let persisted = null;
        try { 
            persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)); 
            if (persisted && persisted.version !== PUZZLE_VERSION) {
                localStorage.removeItem(STORAGE_KEY);
                persisted = null;
            }
        } catch(e){ persisted = null; }

        // Check if persisted pattern is from today (Central time)
        if (persisted && persisted.date === todayDateStr && persisted.pattern) {
            // Use persisted pattern with thresholds
            applyPattern(persisted.pattern, persisted.wordCount, persisted.thresholds);
        } else {
            // Fetch today's puzzle from the API
            try {
                console.log('Fetching puzzle from /api/puzzle/today...');
                const apiResponse = await fetch('/api/puzzle/today');
                
                if (!apiResponse.ok) {
                    throw new Error(`API returned status ${apiResponse.status}`);
                }
                
                const apiData = await apiResponse.json();
                console.log('Received puzzle data:', apiData);
                
                const todayPattern = apiData.pattern;
                const wordCount = apiData.wordCount;
                const thresholds = apiData.thresholds;
                
                applyPattern(todayPattern, wordCount, thresholds);
                
                try { 
                    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 
                        version: PUZZLE_VERSION,
                        pattern: todayPattern,
                        date: todayDateStr,
                        puzzleIndex: apiData.puzzleIndex,
                        puzzleNumber: apiData.puzzleIndex,
                        wordCount: wordCount,
                        thresholds: thresholds
                    })); 
                    // Log to history
                    const key = `${todayPattern.length}:${todayPattern.join(',')}`;
                    logPatternToHistory(todayDateStr, key, todayPattern);
                } catch(e){}
            } catch (error) {
                console.error('Error fetching puzzle from API:', error);
                // Fallback: If API fails, show error
                alert('Error loading puzzle. Please refresh the page.');
                return false;
            }
        }
        
        // Schedule next rotation for midnight
        scheduleRotation();

        return true;
    } catch (error) {
        console.error('Error loading puzzle:', error);
        alert('Error loading puzzle. Please refresh the page.');
        return false;
    }
}

function getCentralDateString(date) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    return `${year}-${month}-${day}`;
}

function getMsUntilNextMidnightCT() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const ctTimeStr = formatter.format(now);
    const [hours, mins, secs] = ctTimeStr.split(':').map(Number);
    const secondsSinceMidnightCT = hours * 3600 + mins * 60 + secs;
    const secondsUntilMidnightCT = 86400 - secondsSinceMidnightCT;
    return secondsUntilMidnightCT * 1000;
}

function keyToPattern(key) {
    // key format: "len:1,2,3"
    const parts = key.split(':');
    return parts[1].split(',').map(Number);
}

function applyPattern(patternArray, wordCount, thresholds) {
    CURRENT_PATTERN = patternArray.slice();
    validWords = [];  // No longer storing word lists
    totalWords = wordCount;

    // Populate expanded valid words: include all words from expanded wordlist that match the pattern
    expandedValidWords.clear();
    allExpandedWords.forEach(word => {
        if (matchesPattern(word, patternArray)) {
            expandedValidWords.add(word);
        }
    });

    // Reset state
    foundWords = new Set();
    score = 0;
    document.getElementById('score').textContent = score;
    document.getElementById('wordsGrid').innerHTML = '';

    // Use thresholds from CSV
    if (thresholds) {
        goodThreshold = thresholds.good;
        betterThreshold = thresholds.better;
        bestThreshold = thresholds.best;
    } else {
        // Fallback for edge cases (shouldn't happen)
        if (totalWords === 2) {
            goodThreshold = 1;
            betterThreshold = 2;
            bestThreshold = 2;
        } else {
            goodThreshold = Math.ceil(totalWords * 0.30);
            betterThreshold = Math.ceil(totalWords * 0.50);
            bestThreshold = Math.ceil(totalWords * 0.80);
        }
    }

    updateIndicators();

    // Load saved found words for today
    loadFoundWords();

    renderTiles();
    updateIndicators();
    // Initialize typed characters overlay for this pattern
    typedChars = new Array(CURRENT_PATTERN.length).fill('');
    invalidPositions.clear();
    updateTypedDisplay();
}

/**
 * Load an SVG, replace colors, and return a data URL
 */
async function getRecoloredSVG(originalSrc) {
    // Check cache first
    if (tileModifiedSrcs[originalSrc]) {
        return tileModifiedSrcs[originalSrc];
    }
    
    try {
        const response = await fetch(originalSrc);
        const svgText = await response.text();
        
        // Replace colors: #101820 -> #F04F38, #DDDDDD -> #F9B9AF (case insensitive)
        const recolored = svgText
            .replace(/#101820/gi, '#F04F38')
            .replace(/#DDDDDD/gi, '#F9B9AF')
            .replace(/#ddd/gi, '#F9B9AF');
        
        // Create data URL
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(recolored);
        
        // Cache it
        tileModifiedSrcs[originalSrc] = dataUrl;
        
        return dataUrl;
    } catch (error) {
        console.error('Error recoloring SVG:', error);
        return originalSrc; // Fallback to original
    }
}

function updateTypedDisplay() {
    const tiles = document.querySelectorAll('.tiles-display .tile');
    tiles.forEach((tile, idx) => {
        const span = tile.querySelector('.tile-char');
        if (span) span.textContent = typedChars[idx] || '';
        
        const img = tile.querySelector('img');
        // Apply or remove error styling based on validity
        if (invalidPositions.has(idx)) {
            tile.classList.add('invalid-letter');
            // Swap to recolored SVG
            if (img && tileOriginalSrcs[idx]) {
                const originalSrc = tileOriginalSrcs[idx];
                const cachedSrc = tileModifiedSrcs[originalSrc];
                if (cachedSrc) {
                    img.src = cachedSrc;
                    img.classList.add('recolored');
                } else {
                    getRecoloredSVG(originalSrc).then(dataUrl => {
                        img.src = dataUrl;
                        img.classList.add('recolored');
                    });
                }
            }
        } else {
            tile.classList.remove('invalid-letter');
            // Restore original SVG
            if (img && tileOriginalSrcs[idx]) {
                img.src = tileOriginalSrcs[idx];
                img.classList.remove('recolored');
            }
        }
    });
}

function handleKeyDown(e) {
    // Hidden shortcut: Ctrl+Shift+L to view pattern history
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        showPatternHistory();
        return;
    }
    
    // ignore typing inside other inputs/textareas
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey) return;

    if (e.key === 'Enter') {
        e.preventDefault();
        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn) {
            submitBtn.classList.add('active');
            setTimeout(() => submitBtn.classList.remove('active'), 100);
        }
        submitWord();
        return;
    }

    if (e.key === 'Backspace') {
        e.preventDefault();
        // remove last filled char
        for (let i = typedChars.length - 1; i >= 0; i--) {
            if (typedChars[i]) { 
                typedChars[i] = ''; 
                invalidPositions.delete(i); // Clear invalid flag when deleting
                break; 
            }
        }
        updateTypedDisplay();
        return;
    }

    // accept letters only
    const ch = e.key.toLowerCase();
    if (/^[a-z]$/.test(ch)) {
        // Hide "type to get started" message on first character
        hideTypeToBegin();
        markTypeToBeginCompleted();
        
        // find first empty slot
        for (let i = 0; i < typedChars.length; i++) {
            if (!typedChars[i]) {
                // Check if letter matches the tile
                const expectedTile = CURRENT_PATTERN[i];
                const letterTile = REVERSE_TILES[ch];
                
                // Always add the letter
                typedChars[i] = ch;
                
                // Track validity - invalid if tile is not wild (0) AND letter doesn't match
                if (expectedTile !== 0 && letterTile !== expectedTile) {
                    invalidPositions.add(i);
                } else {
                    invalidPositions.delete(i);
                }
                
                updateTypedDisplay();
                break;
            }
        }
    }
}

function scheduleRotation() {
    if (rotationTimeoutId) clearTimeout(rotationTimeoutId);
    if (rotationIntervalId) clearInterval(rotationIntervalId);
    
    const msUntilMidnight = getMsUntilNextMidnightCT();
    console.log(`Puzzle will rotate at next midnight (in ${(msUntilMidnight / 1000 / 3600).toFixed(2)} hours)`);
    
    rotationTimeoutId = setTimeout(() => {
        // Reload the page to get the new daily pattern
        window.location.reload();
    }, msUntilMidnight);
}

// This function is no longer used with the daily pattern system
function pickAndApplyRandomPattern() {
    // Deprecated - kept for reference
    // Pattern selection is now deterministic based on date
}

/**
 * Render the tile display based on current pattern
 */
function renderTiles() {
    const tilesDisplay = document.querySelector('.tiles-display');
    tilesDisplay.innerHTML = '';
    tileOriginalSrcs = []; // Reset original sources
    
    // Recreate message-display div
    const messageDisplay = document.createElement('div');
    messageDisplay.className = 'message-display hidden';
    messageDisplay.id = 'message-display';
    tilesDisplay.appendChild(messageDisplay);
    
    CURRENT_PATTERN.forEach(tileNum => {
        const tile = document.createElement('div');
        tile.className = 'tile';
        const img = document.createElement('img');
        const src = `assets/Tile${tileNum}.svg`;
        img.src = src;
        img.width = 115;
        img.height = 195;
        tileOriginalSrcs.push(src); // Store original source
        getRecoloredSVG(src);
        img.alt = `Tile ${tileNum}`;
        tile.appendChild(img);
        const char = document.createElement('span');
        char.className = 'tile-char';
        char.textContent = '';
        tile.appendChild(char);
        tilesDisplay.appendChild(tile);
    });
    
    // Wait for all images to load, then update gap and font size, then show container
    waitForImagesAndShowContainer();
}

/**
 * Wait for all tile images to load, calculate sizes, then make container visible
 */
function waitForImagesAndShowContainer() {
    const tilesDisplay = document.querySelector('.tiles-display');
    const gameContainer = document.querySelector('.game-container');
    if (!tilesDisplay || !gameContainer) return;
    
    const images = tilesDisplay.querySelectorAll('img');
    let loadedCount = 0;
    
    const onAllImagesLoaded = () => {
        // Add delay to ensure layout is fully settled
        setTimeout(() => {
            // Update calculations
            const firstTileImg = tilesDisplay.querySelector('.tile img');
            if (firstTileImg && firstTileImg.offsetHeight > 0) {
                const gap = firstTileImg.offsetHeight / 39;
                document.documentElement.style.setProperty('--tile-gap', `${gap}px`);
            }

            const firstLegendTile = document.querySelector('.legend-letter');
            if (firstLegendTile) {
                const legendHeight = firstLegendTile.getBoundingClientRect().height;
                if (legendHeight > 0) {
                    const legendGap = legendHeight / 39;
                    document.documentElement.style.setProperty('--legend-gap', `${legendGap}px`);
                }
            }

            const displayHeight = tilesDisplay.offsetHeight;
            if (displayHeight > 0) {
                const fontSize = displayHeight * 0.75;
                document.documentElement.style.setProperty('--tile-font-size', `${fontSize}px`);
            }
            
            // Now make container visible
            gameContainer.style.opacity = '1';
        }, 50);
    };
    
    const checkAllLoaded = () => {
        loadedCount++;
        if (loadedCount === images.length) {
            onAllImagesLoaded();
        }
    };
    
    if (images.length === 0) {
        onAllImagesLoaded();
    } else {
        images.forEach(img => {
            if (img.complete) {
                checkAllLoaded();
            } else {
                img.addEventListener('load', checkAllLoaded, { once: true });
            }
        });
    }
}

/**
 * Update tile font size based on tiles-display height (for window resize events)
 */
function updateTileFontSize() {
    const tilesDisplay = document.querySelector('.tiles-display');
    if (!tilesDisplay) return;
    
    const displayHeight = tilesDisplay.offsetHeight;
    if (displayHeight > 0) {
        const fontSize = displayHeight * 0.75;
        document.documentElement.style.setProperty('--tile-font-size', `${fontSize}px`);
    }
}

/**
 * Update tile gap based on actual rendered tile height (for window resize events)
 */
function updateTileGap() {
    const tilesDisplay = document.querySelector('.tiles-display');
    if (!tilesDisplay) return;
    
    const firstTileImg = tilesDisplay.querySelector('.tile img');
    if (!firstTileImg) return;
    
    const actualHeight = firstTileImg.offsetHeight;
    if (actualHeight > 0) {
        const gap = actualHeight / 39;
        document.documentElement.style.setProperty('--tile-gap', `${gap}px`);
    }

    const firstLegendTile = document.querySelector('.legend-letter');
    if (firstLegendTile) {
        const legendHeight = firstLegendTile.getBoundingClientRect().height;
        if (legendHeight > 0) {
            const legendGap = legendHeight / 39;
            document.documentElement.style.setProperty('--legend-gap', `${legendGap}px`);
        }
    }
}

// ====== GAME LOGIC ======
function displayCentralDate() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const dateStr = formatter.format(now);
    const dateEl = document.getElementById('puzzleDate');
    if (dateEl) dateEl.textContent = dateStr.toLowerCase();
}

function displayPuzzleNumber() {
    try {
        // Try to get puzzle number from current pattern storage first
        const stored = localStorage.getItem(STORAGE_KEY);
        let puzzleNum = 1;
        
        if (stored) {
            const data = JSON.parse(stored);
            if (data.puzzleNumber) {
                puzzleNum = data.puzzleNumber;
            }
        }
        
        const puzzleNumEl = document.getElementById('puzzleNumber');
        if (puzzleNumEl) puzzleNumEl.textContent = `puzzle #${puzzleNum}`;
    } catch(e) {
        console.error('Error displaying puzzle number:', e);
    }
}

async function init() {
    // Display current date in Central time
    displayCentralDate();
    
    // Set copyright year
    const yearEl = document.getElementById('copyrightYear');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    

    
    // Load wordlist and validate
    const loaded = await loadWordlist();
    if (!loaded) {
        return;
    }
    
    // Display puzzle number (after puzzle data is loaded)
    displayPuzzleNumber();
    
    // Initialize best modal state for today (after puzzle data loads)
    // Only set from localStorage if not already shown this session
    if (!bestModalShown) {
        bestModalShown = hasShownBestModal();
    }

    // Update indicators with loaded thresholds
    updateIndicators();
    
    // Keyboard handling for typing over tiles
    document.addEventListener('keydown', handleKeyDown);

    // submit button click
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) submitBtn.addEventListener('click', submitWord);

    // clear button click
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            typedChars.fill('');
            invalidPositions.clear();
            updateTypedDisplay();
            refocusMobileInput();
            trackEvent('clear_clicked', {
                puzzle_number: getCurrentPuzzleNumber(),
                pattern_length: CURRENT_PATTERN.length
            });
        });
    }

    // share button click
    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn) {
        shareBtn.addEventListener('click', shareResults);
    }
    
    // persistent share button click
    const persistentShareBtn = document.getElementById('persistentShareBtn');
    if (persistentShareBtn) {
        persistentShareBtn.addEventListener('click', () => {
            // Only show visual feedback on desktop (not touch devices)
            const isDesktop = !('ontouchstart' in window) && !navigator.maxTouchPoints;
            
            if (isDesktop) {
                const icon = persistentShareBtn.querySelector('.icon-svg');
                const originalSrc = icon.src;
                
                // Change to copy icon and add glow
                icon.src = 'icons/content_copy.svg';
                persistentShareBtn.classList.add('copied');
                
                // Revert after 1 second
                setTimeout(() => {
                    icon.src = originalSrc;
                    persistentShareBtn.classList.remove('copied');
                }, 1000);
            }
            
            shareResults();
        });
    }

    // Best modal handling
    const bestModal = document.getElementById('bestModal');
    if (bestModal) {
        bestModal.addEventListener('click', (e) => {
            const target = e.target;
            if (target && target.id === 'bestShareBtn') {
                shareFromBestModal(target);
                return;
            }
            if (target && target.id === 'bestKeepPlayingBtn') {
                hideBestModal();
                return;
            }
        });
    }

    const bestCloseBtn = document.getElementById('bestCloseBtn');
    if (bestCloseBtn) {
        bestCloseBtn.addEventListener('click', hideBestModal);
    }

    // Info modal handling
    const infoBtn = document.getElementById('infoBtn');
    const infoModal = document.getElementById('infoModal');
    const infoIcon = infoBtn?.querySelector('.icon-svg');
    const logo = document.querySelector('.logo');
    const logoContainer = document.querySelector('.logo-container');
    const copyright = document.querySelector('.copyright');

    if (infoBtn && infoModal && infoIcon) {
        infoBtn.addEventListener('click', () => {
            const isOpen = infoModal.classList.contains('open');
            
            if (isOpen) {
                // Close modal
                infoModal.classList.remove('open');
                if (logo) logo.classList.remove('white');
                if (copyright) copyright.classList.remove('white');
                infoBtn.classList.remove('white');
                infoIcon.src = 'icons/question_mark.svg';
                refocusMobileInput();
            } else {
                // Open modal
                setModalHeight();
                updateTileGap();
                infoModal.classList.add('open');
                if (logo) logo.classList.add('white');
                if (copyright) copyright.classList.add('white');
                infoBtn.classList.add('white');
                infoIcon.src = 'icons/close.svg';
                trackEvent('info_opened', {
                    puzzle_number: getCurrentPuzzleNumber(),
                    pattern_length: CURRENT_PATTERN.length
                });
            }
        });
    }

    // Close modal when clicking outside
    if (infoModal) {
        infoModal.addEventListener('click', (e) => {
            if (e.target === infoModal && infoIcon) {
                infoModal.classList.remove('open');
                if (logo) logo.classList.remove('white');
                if (copyright) copyright.classList.remove('white');
                if (infoBtn) infoBtn.classList.remove('white');
                infoIcon.src = 'icons/question_mark.svg';
                refocusMobileInput();
            }
        });
    }

    // Function to set modal height to match game container
    function setModalHeight() {
        const gameContainer = document.querySelector('.game-container');
        const modalContent = document.querySelector('.modal-content');
        
        if (gameContainer && modalContent) {
            const rect = gameContainer.getBoundingClientRect();
            const bottomGap = Math.max(0, window.innerHeight - rect.bottom);
            const rightGap = Math.max(0, window.innerWidth - rect.right);
            modalContent.style.height = `${rect.height}px`;
            modalContent.style.width = `${rect.width}px`;
            modalContent.style.marginTop = `${rect.top}px`;
            modalContent.style.marginBottom = `${bottomGap}px`;
            modalContent.style.marginLeft = `${rect.left}px`;
            modalContent.style.marginRight = `${rightGap}px`;
        }
    }

    // Update modal height on window resize
    window.addEventListener('resize', () => {
        const infoModal = document.getElementById('infoModal');
        if (infoModal && infoModal.classList.contains('open')) {
            setModalHeight();
        }
    });

    // Initialize inactivity tracking
    initializeInactivityTracking();
    
    // Setup mobile input for keyboard
    setupMobileInput();
    
    // Show "type to get started" message
    showTypeToBegin();
    
    // Update tile gap on window resize
    window.addEventListener('resize', updateTileGap);
    window.addEventListener('resize', updateTileFontSize);
}

function setupMobileInput() {
    const mobileInput = document.getElementById('mobileInput');
    if (!mobileInput) return;
    
    // Detect if mobile/touch device
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isSmallScreen = window.matchMedia('(max-width: 768px)').matches;
    const isMobile = isMobileUA && isSmallScreen;

    document.body.classList.toggle('is-mobile', isMobile);
    
    if (!isMobile) {
        mobileInput.dataset.mobileEnabled = 'false';
        return;
    }
    mobileInput.dataset.mobileEnabled = 'true';
    
    // Focus on tiles display click
    const tilesDisplay = document.querySelector('.tiles-display');
    if (tilesDisplay) {
        tilesDisplay.addEventListener('click', () => {
            mobileInput.focus();
        });
    }
    
    // Show prompt if keyboard is dismissed (unless modal is open)
    mobileInput.addEventListener('blur', () => {
        const infoModal = document.getElementById('infoModal');
        const modalOpen = (infoModal && infoModal.classList.contains('open'));
        
        if (!modalOpen) {
            showTypeToBegin();
        }
    });
    
    // Handle input
    mobileInput.addEventListener('input', (e) => {
        const newValue = e.target.value.toLowerCase();
        
        if (newValue.length > 0) {
            // Character added
            const addedChar = newValue[newValue.length - 1];
            if (/^[a-z]$/.test(addedChar)) {
                hideTypeToBegin();
                markTypeToBeginCompleted();
                
                for (let i = 0; i < typedChars.length; i++) {
                    if (!typedChars[i]) {
                        const expectedTile = CURRENT_PATTERN[i];
                        const letterTile = REVERSE_TILES[addedChar];
                        
                        typedChars[i] = addedChar;
                        
                        if (expectedTile !== 0 && letterTile !== expectedTile) {
                            invalidPositions.add(i);
                        } else {
                            invalidPositions.delete(i);
                        }
                        
                        updateTypedDisplay();
                        break;
                    }
                }
            }
        }
        
        // Always clear the input
        mobileInput.value = '';
    });
    
    // Handle backspace via keydown since input event doesn't catch it when value is empty
    mobileInput.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
            e.preventDefault();
            for (let i = typedChars.length - 1; i >= 0; i--) {
                if (typedChars[i]) {
                    typedChars[i] = '';
                    invalidPositions.delete(i);
                    break;
                }
            }
            updateTypedDisplay();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            submitWord();
        }
    });
}

function animateTilesOut(isAccepted) {
    const tileChars = document.querySelectorAll('.tile-char');
    const animationClass = isAccepted ? 'accepted' : 'rejected';
    
    tileChars.forEach(char => {
        if (char.textContent) {
            char.classList.add(animationClass);
        }
    });
    
    // Clear the animation classes after animation completes
    setTimeout(() => {
        tileChars.forEach(char => {
            char.classList.remove('accepted', 'rejected');
        });
    }, 100);
}

function submitWord() {
    const word = typedChars.join('').trim().toLowerCase();

    const filledCount = typedChars.filter((ch) => ch).length;
    if (filledCount < CURRENT_PATTERN.length) {
        trackEvent('word_submitted', {
            result: 'too_short',
            filled_count: filledCount,
            pattern_length: CURRENT_PATTERN.length,
            puzzle_number: getCurrentPuzzleNumber()
        });
        showMessage(`enter a ${CURRENT_PATTERN.length}-letter word!`, 'error-yellow');
        invalidPositions.clear();
        updateTypedDisplay();
        animateTilesOut(false);
        setTimeout(() => {
            typedChars.fill('');
            updateTypedDisplay();
            refocusMobileInput();
        }, 100);
        return;
    }

    if (foundWords.has(word)) {
        trackEvent('word_submitted', {
            result: 'duplicate',
            pattern_length: CURRENT_PATTERN.length,
            puzzle_number: getCurrentPuzzleNumber()
        });
        showMessage('already found', 'error-yellow');
        invalidPositions.clear();
        updateTypedDisplay();
        animateTilesOut(false);
        setTimeout(() => {
            typedChars.fill('');
            updateTypedDisplay();
            refocusMobileInput();
        }, 100);
        return;
    }

    // Check if word matches the tile pattern
    const patternMatches = matchesPattern(word, CURRENT_PATTERN);

    if (!patternMatches) {
        trackEvent('word_submitted', {
            result: 'invalid_pattern',
            pattern_length: CURRENT_PATTERN.length,
            puzzle_number: getCurrentPuzzleNumber()
        });
        showMessage('doesn\'t fit shadow', 'error-red');
        invalidPositions.clear();
        updateTypedDisplay();
        animateTilesOut(false);
        setTimeout(() => {
            typedChars.fill('');
            updateTypedDisplay();
            refocusMobileInput();
        }, 100);
        return;
    }

    if (expandedValidWords.has(word)) {
        const previousScore = score;
        foundWords.add(word);
        score++;
        updateScore();
        if (previousScore < bestThreshold && score >= bestThreshold && !bestModalShown) {
            showBestModal();
        }
        addWordToGrid(word);
        saveFoundWords();
        showPlusOneMessage();

        trackEvent('word_submitted', {
            result: 'accepted',
            pattern_length: CURRENT_PATTERN.length,
            puzzle_number: getCurrentPuzzleNumber(),
            score: score
        });
        
        // Log this successful submission
        logPuzzleInteraction();
        
        invalidPositions.clear();
        updateTypedDisplay();
        animateTilesOut(true);
        setTimeout(() => {
            typedChars.fill('');
            updateTypedDisplay();
            refocusMobileInput();
        }, 100);
    } else {
        trackEvent('word_submitted', {
            result: 'not_in_list',
            pattern_length: CURRENT_PATTERN.length,
            puzzle_number: getCurrentPuzzleNumber()
        });
        showMessage('not in word list', 'error-red');
        invalidPositions.clear();
        updateTypedDisplay();
        animateTilesOut(false);
        setTimeout(() => {
            typedChars.fill('');
            updateTypedDisplay();
            refocusMobileInput();
        }, 100);
    }
}

function refocusMobileInput() {
    const mobileInput = document.getElementById('mobileInput');
    if (mobileInput && mobileInput.dataset.mobileEnabled === 'true') {
        setTimeout(() => mobileInput.focus(), 10);
    }
}

/**
 * Log successful puzzle interaction to the server
 */
function logPuzzleInteraction() {
    try {
        const userId = getOrCreateUserId();
        const now = new Date();
        const todayDateStr = getCentralDateString(now);
        const stored = localStorage.getItem(STORAGE_KEY);
        let puzzleIndex = 0;
        
        if (stored) {
            try {
                const data = JSON.parse(stored);
                puzzleIndex = (data.puzzleNumber || 1) - 1; // Convert back to 0-indexed
            } catch (parseErr) {
                console.warn('Failed to parse stored puzzle data:', parseErr);
            }
        }
        
        // Send log to server
        fetch('/api/log/interaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId,
                puzzleIndex,
                puzzleDate: todayDateStr
            })
        })
        .then(res => {
            if (!res.ok) {
                throw new Error(`Server responded with ${res.status}`);
            }
            return res.json();
        })
        .catch(err => {
            // Silent fail - don't disrupt gameplay. Log to console for debugging.
            console.debug('Interaction logging failed (non-critical):', err.message);
        });
    } catch (e) {
        console.error('Error in logPuzzleInteraction:', e);
        // Don't throw - this is a non-critical operation
    }
}

function showMessage(text, type) {
    // For "type to get started" message, use the overlay message-display
    if (type === 'type-to-begin') {
        const messageEl = document.getElementById('message-display');
        messageEl.textContent = text;
        messageEl.className = `message-display ${type}`;
        messageEl.classList.remove('hidden');
        return;
    }
    
    // For error and success messages, use the error message display below tiles
    const errorEl = document.getElementById('error-message-display');
    if (errorEl) {
        errorEl.textContent = text;
        errorEl.classList.add('active', type);
        
        const duration = type.includes('error') || type === 'success-green' ? 500 : 3000;
        setTimeout(() => {
            errorEl.classList.remove('active', type);
        }, duration);
    }
}

function showTypeToBegin() {
    const messageEl = document.getElementById('message-display');
    if (!messageEl || hasCompletedTypeToBegin()) {
        return;
    }
    
    // Detect if mobile/touch device
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isSmallScreen = window.matchMedia('(max-width: 768px)').matches;
    const isMobile = isMobileUA && isSmallScreen;
    
    messageEl.textContent = isMobile ? 'tap here to play' : 'start typing';
    messageEl.className = 'message-display type-to-begin';
    messageEl.classList.remove('hidden');
    
    // On mobile, make it tappable to focus the input
    if (isMobile) {
        messageEl.style.cursor = 'pointer';
        messageEl.onclick = () => {
            const mobileInput = document.getElementById('mobileInput');
            if (mobileInput) {
                mobileInput.focus();
            }
            messageEl.textContent = 'start typing';
        };
    }
}

function hideTypeToBegin() {
    const messageEl = document.getElementById('message-display');
    if (messageEl.classList.contains('type-to-begin')) {
        messageEl.classList.add('hidden');
        markTypeToBeginCompleted();
    }
}

function hasCompletedTypeToBegin() {
    try {
        const stored = localStorage.getItem(TYPE_TO_BEGIN_KEY);
        if (!stored) return false;
        const data = JSON.parse(stored);
        const todayDateStr = getCentralDateString(new Date());
        return data.date === todayDateStr;
    } catch (e) {
        return false;
    }
}

function markTypeToBeginCompleted() {
    try {
        const todayDateStr = getCentralDateString(new Date());
        localStorage.setItem(TYPE_TO_BEGIN_KEY, JSON.stringify({
            date: todayDateStr
        }));
    } catch (e) {
        console.error('Error saving type-to-begin state:', e);
    }
}

function shareResults() {
    try {
        trackEvent('share_initiated', {
            context: 'main',
            puzzle_number: getCurrentPuzzleNumber(),
            pattern_length: CURRENT_PATTERN.length,
            score: score
        });
        const shareMessage = buildShareMessage();
        if (!shareMessage) {
            showMessage('failed to share', 'error');
            return;
        }

        tryNativeShare(shareMessage).then((shared) => {
            if (shared) {
                showMessage('shared!', 'success');
            } else {
                // Only try clipboard if native share didn't work
                copyToClipboard(shareMessage).then(() => {
                    showMessage('copied to clipboard!', 'success');
                }).catch(() => {
                    showMessage('failed to copy', 'error');
                });
            }
        });
    } catch(e) {
        console.error('Error sharing results:', e);
        showMessage('failed to share', 'error');
    }
}

function shareFromBestModal(btnEl) {
    trackEvent('share_initiated', {
        context: 'best_modal',
        puzzle_number: getCurrentPuzzleNumber(),
        pattern_length: CURRENT_PATTERN.length,
        score: score
    });
    const shareMessage = buildShareMessage();
    if (!shareMessage) {
        if (btnEl) btnEl.textContent = 'failed to share';
        return;
    }

    if (btnEl) {
        btnEl.textContent = 'opening share...';
    }

    tryNativeShare(shareMessage).then((shared) => {
        if (shared) {
            if (btnEl) btnEl.textContent = 'shared!';
            return;
        }

        if (btnEl) {
            btnEl.textContent = 'copying...';
        }

        copyToClipboard(shareMessage).then(() => {
            if (btnEl) {
                btnEl.innerHTML = '<img src="icons/content_copy.svg" alt="" class="icon-svg" aria-hidden="true"><span>copied!</span>';
            }
        }).catch(() => {
            if (btnEl) btnEl.textContent = 'failed to copy';
        });
    });
}

function tryNativeShare(text) {
    if (!navigator.share) {
        return Promise.resolve(false);
    }

    return navigator.share({ text }).then(() => true).catch(() => false);
}

function buildShareMessage() {
    try {
        const puzzleNum = getCurrentPuzzleNumber();
        const tilePatterns = {
            1: ['b', 'b', 'w'],
            2: ['w', 'b', 'w'],
            3: ['w', 'b', 'b'],
            4: ['b', 'b', 'b']
        };

        const rows = [];
        for (let rowIdx = 0; rowIdx < 3; rowIdx++) {
            let row = '';
            for (let tilePos = 0; tilePos < CURRENT_PATTERN.length; tilePos++) {
                const tileNum = CURRENT_PATTERN[tilePos];
                const pattern = tilePatterns[tileNum];
                if (pattern && pattern[rowIdx]) {
                    row += pattern[rowIdx] === 'b' ? '⬛️' : '⬜️';
                }
            }
            if (row) rows.push(row);
        }

        const visualization = rows.join('\n');
        return `i found ${score} word${score === 1 ? '' : 's'} lurking in shadowgram #${puzzleNum}\n\n${visualization}`;
    } catch (e) {
        console.error('Error building share message:', e);
        return null;
    }
}

function getCurrentPuzzleNumber() {
    const stored = localStorage.getItem(STORAGE_KEY);
    let puzzleNum = 1;
    
    if (stored) {
        const data = JSON.parse(stored);
        if (data.puzzleNumber) {
            puzzleNum = data.puzzleNumber;
        }
    }

    return puzzleNum;
}

function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }

    return new Promise((resolve, reject) => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();

        try {
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            success ? resolve() : reject(new Error('copy failed'));
        } catch (err) {
            document.body.removeChild(textarea);
            reject(err);
        }
    });
}

function updateScore() {
    document.getElementById('score').textContent = score;
    updateIndicators();
}

function updateIndicators() {
    const scoreCircle = document.querySelector('.score-circle');
    const nextLevelCount = document.getElementById('next-level-count');
    const nextLevelName = document.getElementById('next-level-name');
    const nextLevelText = document.querySelector('.next-level-text');
    const wordsFoundLabel = document.querySelector('.words-found-label');
    
    // Update words/word found label
    if (wordsFoundLabel) {
        wordsFoundLabel.textContent = score === 1 ? 'word found' : 'words found';
    }
    
    // Determine current milestone level and next threshold
    let circleColor = 'var(--color-gray)';
    let nextThreshold = goodThreshold;
    let nextThresholdName = 'good';
    let nextThresholdClass = 'yellow';
    
    if (score >= bestThreshold) {
        // At highest level (light-blue)
        circleColor = 'var(--color-light-blue)';
        nextThreshold = null; // No next level
        nextThresholdName = 'best';
        nextThresholdClass = 'light-blue';
        if (wordsFoundLabel) {
            wordsFoundLabel.style.color = 'var(--color-light-blue)';
        }
    } else if (score >= betterThreshold) {
        // At green level
        circleColor = 'var(--color-green)';
        nextThreshold = bestThreshold;
        nextThresholdName = 'best';
        nextThresholdClass = 'light-blue';
        if (wordsFoundLabel) {
            wordsFoundLabel.style.color = 'var(--color-green)';
        }
    } else if (score >= goodThreshold) {
        // At yellow level
        circleColor = 'var(--color-yellow)';
        // If better and best thresholds are the same (e.g., 2-word puzzles), skip to best
        if (betterThreshold === bestThreshold) {
            nextThreshold = bestThreshold;
            nextThresholdName = 'best';
            nextThresholdClass = 'light-blue';
        } else {
            nextThreshold = betterThreshold;
            nextThresholdName = 'better';
            nextThresholdClass = 'green';
        }
        if (wordsFoundLabel) {
            wordsFoundLabel.style.color = 'var(--color-yellow)';
        }
    } else {
        // At gray level (starting)
        circleColor = 'var(--color-gray)';
        nextThreshold = goodThreshold;
        nextThresholdName = 'good';
        nextThresholdClass = 'yellow';
        if (wordsFoundLabel) {
            wordsFoundLabel.style.color = 'var(--color-gray)';
        }
    }
    
    // Update circle color
    if (scoreCircle) {
        scoreCircle.style.background = circleColor;
    }
    
    // Show/hide persistent share button based on best threshold
    const persistentShareBtn = document.getElementById('persistentShareBtn');
    if (persistentShareBtn) {
        if (score >= bestThreshold) {
            persistentShareBtn.style.display = 'flex';
        } else {
            persistentShareBtn.style.display = 'none';
        }
    }
    
    // Update next level text based on achievement status
    if (score >= bestThreshold) {
        // At best level - show celebratory message
        if (nextLevelText) {
            nextLevelText.innerHTML = `you're the <span class="next-level-name light-blue">best</span>!`;
        }
    } else {
        // Show remaining words to next level
        if (nextLevelCount) {
            const remaining = Math.max(0, nextThreshold - score);
            nextLevelCount.textContent = remaining;
        }
        
        // Update next level name and color
        if (nextLevelName) {
            nextLevelName.textContent = nextThresholdName;
            nextLevelName.className = `next-level-name ${nextThresholdClass}`;
        }
    }
}

function updateCurrentLevel(currentScore) {
    // This function is kept for compatibility but no longer used
}

function showBestModal() {
    // Safeguard: don't show if already shown today
    if (hasShownBestModal()) {
        bestModalShown = true;
        return;
    }

    const bestModal = document.getElementById('bestModal');
    const bestCount = document.getElementById('bestModalCount');
    const bestPlural = document.getElementById('bestModalPlural');
    const infoBtn = document.getElementById('infoBtn');

    if (bestCount) bestCount.textContent = score;
    if (bestPlural) bestPlural.textContent = score === 1 ? '' : 's';

    if (bestModal) {
        bestModal.classList.add('open');
        bestModalShown = true;
        markBestModalShown();
        trackEvent('best_modal_shown', {
            puzzle_number: getCurrentPuzzleNumber(),
            pattern_length: CURRENT_PATTERN.length,
            score: score
        });
    }

    if (infoBtn) {
        infoBtn.classList.add('hidden');
    }
}

function hasShownBestModal() {
    try {
        const stored = localStorage.getItem(BEST_MODAL_KEY);
        if (!stored) return false;
        const data = JSON.parse(stored);
        const todayDateStr = getCentralDateString(new Date());
        const puzzleNum = getCurrentPuzzleNumber();
        return data.date === todayDateStr && data.puzzleNumber === puzzleNum;
    } catch (e) {
        return false;
    }
}

function markBestModalShown() {
    try {
        const todayDateStr = getCentralDateString(new Date());
        const puzzleNum = getCurrentPuzzleNumber();
        localStorage.setItem(BEST_MODAL_KEY, JSON.stringify({
            date: todayDateStr,
            puzzleNumber: puzzleNum
        }));
    } catch (e) {
        console.error('Error saving best modal state:', e);
    }
}

function hideBestModal() {
    const bestModal = document.getElementById('bestModal');
    const infoBtn = document.getElementById('infoBtn');
    if (bestModal) {
        bestModal.classList.remove('open');
    }
    if (infoBtn) {
        infoBtn.classList.remove('hidden');
    }
    refocusMobileInput();
}

function addWordToGrid(word) {
    const wordsGrid = document.getElementById('wordsGrid');
    const wordEl = document.createElement('div');
    wordEl.className = 'word-item';
    wordEl.textContent = word;
    
    // Insert word in alphabetical order
    const existingWords = Array.from(wordsGrid.querySelectorAll('.word-item'));
    let inserted = false;
    
    for (const existing of existingWords) {
        if (word.localeCompare(existing.textContent) < 0) {
            wordsGrid.insertBefore(wordEl, existing);
            inserted = true;
            break;
        }
    }
    
    if (!inserted) {
        wordsGrid.appendChild(wordEl);
    }
}

/**
 * Initialize inactivity tracking
 */
function initializeInactivityTracking() {
    // Track user activity
    ['keydown', 'mousedown', 'mousemove', 'click', 'scroll', 'touchstart'].forEach(event => {
        document.addEventListener(event, resetInactivityTimer, true);
    });
    
    // Start inactivity timer
    resetInactivityTimer();
}

/**
 * Reset inactivity timer
 */
function resetInactivityTimer() {
    lastActivityTime = Date.now();
    
    // Clear existing timeout
    if (inactivityTimeoutId) {
        clearTimeout(inactivityTimeoutId);
    }
    
    // Set new timeout for 10 minutes of inactivity (placeholder - was welcome back modal)
    inactivityTimeoutId = setTimeout(() => {
        // Inactivity timeout - can implement different behavior later
    }, INACTIVITY_TIMEOUT);
}


/**
 * Show "+1" message briefly when word is correct
 */
function showPlusOneMessage() {
    const puzzleLength = CURRENT_PATTERN.length;
    const messages = SUCCESS_MESSAGES[puzzleLength] || ['nice!'];
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    showMessage(randomMessage, 'success-green');
}


// Initialize on load
init();