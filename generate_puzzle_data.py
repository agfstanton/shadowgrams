#!/usr/bin/env python3
import json
from collections import defaultdict
from itertools import product

# Tile mappings
TILE_MAP = {
    'b': 1, 'd': 1, 'f': 1, 'h': 1, 'i': 1, 'j': 1, 'k': 1, 'l': 1, 'p': 1, 'q': 1,
    'a': 2, 'c': 2, 'e': 2, 'm': 2, 'n': 2, 'o': 2, 'r': 2, 's': 2, 'u': 2, 'v': 2, 'w': 2, 'x': 2, 'z': 2,
    'g': 3, 'p': 3, 'q': 3, 'y': 3,
    'j': 4
}

def get_pattern(word):
    """Convert a word to its tile pattern"""
    word_lower = word.lower()
    pattern = []
    for char in word_lower:
        if char in TILE_MAP:
            pattern.append(TILE_MAP[char])
        else:
            return None  # Character not in tile map
    return tuple(pattern)

def main():
    # Read wordlist
    print("Reading wordlist...")
    with open('/Users/audreystanton/Downloads/files(2)/data/wordlist-20260215.txt', 'r') as f:
        words = [line.strip().lower() for line in f if line.strip()]
    
    print(f"Loaded {len(words)} words")
    
    # Group words by pattern
    puzzles_by_pattern = defaultdict(list)
    
    print("Processing words...")
    for word in words:
        # Only process words of 3-6 letters (valid puzzle sizes)
        if 3 <= len(word) <= 6:
            pattern = get_pattern(word)
            if pattern:
                puzzles_by_pattern[pattern].append(word)
    
    # Create output structure
    puzzle_data = []
    
    for pattern in sorted(puzzles_by_pattern.keys()):
        words_for_pattern = puzzles_by_pattern[pattern]
        puzzle_data.append({
            'pattern': list(pattern),
            'wordCount': len(words_for_pattern),
            'words': sorted(words_for_pattern)
        })
    
    # Save to JSON
    output_file = '/Users/audreystanton/Downloads/files(2)/data/valid-puzzles.json'
    print(f"Writing {len(puzzle_data)} patterns to {output_file}...")
    
    with open(output_file, 'w') as f:
        json.dump(puzzle_data, f, indent=2)
    
    print(f"Done! Generated {len(puzzle_data)} valid puzzle patterns")
    
    # Print statistics
    total_words = sum(p['wordCount'] for p in puzzle_data)
    pattern_lengths = defaultdict(int)
    for p in puzzle_data:
        pattern_lengths[len(p['pattern'])] += 1
    
    print(f"\nStatistics:")
    print(f"Total words matched: {total_words}")
    print(f"Total patterns: {len(puzzle_data)}")
    for length in sorted(pattern_lengths.keys()):
        print(f"  {length}-tile patterns: {pattern_lengths[length]}")

if __name__ == '__main__':
    main()
