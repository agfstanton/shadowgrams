#!/usr/bin/env python3
import json
import math

# Read the current puzzle-data.json
with open('/Users/audreystanton/Downloads/files(2)/data/puzzle-data.json', 'r') as f:
    data = json.load(f)

# New threshold percentages
thresholds_percent = {
    'good': 0.25,
    'better': 0.50,
    'best': 0.75
}

# Recalculate thresholds for each puzzle
for puzzle in data['puzzles']:
    word_count = puzzle['wordCount']
    puzzle['thresholds'] = {
        'good': math.ceil(word_count * thresholds_percent['good']),
        'better': math.ceil(word_count * thresholds_percent['better']),
        'best': math.ceil(word_count * thresholds_percent['best'])
    }

# Write back to puzzle-data.json
with open('/Users/audreystanton/Downloads/files(2)/data/puzzle-data.json', 'w') as f:
    json.dump(data, f, indent=2)

print(f"Updated {len(data['puzzles'])} puzzles with new thresholds (25%, 50%, 75%)")
print("Sample updates:")
for puzzle in data['puzzles'][:3]:
    print(f"  Pattern {puzzle['pattern']}: wordCount={puzzle['wordCount']}, thresholds={puzzle['thresholds']}")
