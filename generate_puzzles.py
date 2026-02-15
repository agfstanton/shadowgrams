import csv
from itertools import product

# Define tile-to-letter mapping
tile_letters = {
    1: set(['t', 'i', 'd', 'f', 'h', 'k', 'l', 'b']),
    2: set(['w', 'e', 'r', 'u', 'o', 'a', 's', 'z', 'x', 'c', 'v', 'n', 'm']),
    3: set(['q', 'p', 'g', 'y']),
    4: set(['j'])
}

# Create reverse mapping (letter to tile)
letter_to_tile = {}
for tile, letters in tile_letters.items():
    for letter in letters:
        letter_to_tile[letter] = tile

# Load wordlist
wordlist = []
with open('./data/wordlist-20260215.txt', 'r') as f:
    for line in f:
        word = line.strip().lower()
        if word and 3 <= len(word) <= 6:
            if all(letter in letter_to_tile for letter in word):
                wordlist.append(word)

print(f"Loaded {len(wordlist)} valid words")

# First, group words by their tile pattern
perm_to_words = {}
for word in wordlist:
    word_tiles = tuple(letter_to_tile[letter] for letter in word)
    if word_tiles not in perm_to_words:
        perm_to_words[word_tiles] = []
    perm_to_words[word_tiles].append(word)

print(f"Found {len(perm_to_words)} permutations with valid words")

# Write CSV
with open('./data/valid-puzzles.csv', 'w', newline='') as csvfile:
    writer = csv.DictWriter(csvfile, fieldnames=['pattern', 'count', 'words'])
    writer.writeheader()
    for perm in sorted(perm_to_words.keys()):
        words = sorted(perm_to_words[perm])
        writer.writerow({
            'pattern': str(list(perm)),
            'count': len(words),
            'words': ', '.join(words)
        })

print(f"CSV saved to ./data/valid-puzzles.csv")
