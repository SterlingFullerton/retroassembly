package search

import (
	"math"
	"sort"
	"strings"
	"unicode/utf16"
)

// The typo-tolerant matching Fuse.js 7.5.0 does, with the options search-roms.ts gives it: keys title and gameName, of
// equal weight, threshold 0.35, location ignored, case ignored. Strings are compared as JavaScript has them, in UTF-16
// code units, and bits are shifted as JavaScript shifts them, in 32-bit integers

const (
	fuseThreshold = 0.35
	fuseMaxBits   = 32
	// Two keys of weight 1, which Fuse makes 0.5 each
	fuseKeyWeight = 0.5
)

func units(text string) []uint16 {
	return utf16.Encode([]rune(text))
}

// jsRound is Math.round: halves up
func jsRound(x float64) float64 {
	return math.Floor(x + 0.5)
}

// fieldNorm is how much a field's length weighs on its score: 1/√(words), to 3 decimals
func fieldNorm(text []uint16) float64 {
	tokens, inWord := 0, false
	for _, unit := range text {
		if (unit >= 9 && unit <= 13) || unit == 32 || unit == 160 {
			inWord = false
		} else if !inWord {
			tokens++
			inWord = true
		}
	}
	if tokens == 0 {
		tokens = 1
	}
	return jsRound(1000/math.Pow(float64(tokens), 0.5)) / 1000
}

type chunk struct {
	alphabet map[uint16]int32
	pattern  []uint16
}

type bitap struct {
	chunks  []chunk
	pattern []uint16
}

func newBitap(query string) bitap {
	pattern := units(strings.ToLower(query))
	b := bitap{pattern: pattern}
	if len(pattern) == 0 {
		return b
	}
	add := func(part []uint16) {
		alphabet := map[uint16]int32{}
		for i, unit := range part {
			alphabet[unit] |= int32(1) << (len(part) - i - 1)
		}
		b.chunks = append(b.chunks, chunk{alphabet: alphabet, pattern: part})
	}
	if len(pattern) > fuseMaxBits {
		remainder := len(pattern) % fuseMaxBits
		end := len(pattern) - remainder
		for i := 0; i < end; i += fuseMaxBits {
			add(pattern[i : i+fuseMaxBits])
		}
		if remainder > 0 {
			add(pattern[len(pattern)-fuseMaxBits:])
		}
	} else {
		add(pattern)
	}
	return b
}

func indexOf(text, pattern []uint16, from int) int {
	for i := max(from, 0); i+len(pattern) <= len(text); i++ {
		match := true
		for j := range pattern {
			if text[i+j] != pattern[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

// bitapSearch is Fuse's search of one chunk of the pattern in a text, location ignored
func bitapSearch(text []uint16, c chunk) (bool, float64) {
	pattern := c.pattern
	patternLen, textLen := len(pattern), len(text)
	expectedLocation := 0
	currentThreshold := fuseThreshold
	score := func(errors int) float64 { return float64(errors) / float64(patternLen) }
	bestLocation := expectedLocation
	for index := indexOf(text, pattern, bestLocation); index > -1; index = indexOf(text, pattern, bestLocation) {
		currentThreshold = math.Min(score(0), currentThreshold)
		bestLocation = index + patternLen
	}
	bestLocation = -1
	var lastBitArr []int32
	finalScore := 1.0
	binMax := patternLen + textLen
	mask := int32(1) << (patternLen - 1)
	at := func(array []int32, i int) int32 {
		if i >= 0 && i < len(array) {
			return array[i]
		}
		return 0
	}
	for i := 0; i < patternLen; i++ {
		binMin, binMid := 0, binMax
		for binMin < binMid {
			if score(i) <= currentThreshold {
				binMin = binMid
			} else {
				binMax = binMid
			}
			binMid = int(math.Floor(float64(binMax-binMin)/2 + float64(binMin)))
		}
		binMax = binMid
		start := max(1, expectedLocation-binMid+1)
		finish := min(expectedLocation+binMid, textLen) + patternLen
		bitArr := make([]int32, finish+2)
		bitArr[finish+1] = (int32(1) << i) - 1
		for j := finish; j >= start; j-- {
			currentLocation := j - 1
			var charMatch int32
			if currentLocation < textLen {
				charMatch = c.alphabet[text[currentLocation]]
			}
			bitArr[j] = (bitArr[j+1]<<1 | 1) & charMatch
			if i > 0 {
				bitArr[j] |= (at(lastBitArr, j+1)|at(lastBitArr, j))<<1 | 1 | at(lastBitArr, j+1)
			}
			if bitArr[j]&mask != 0 {
				finalScore = score(i)
				if finalScore <= currentThreshold {
					currentThreshold = finalScore
					bestLocation = currentLocation
					if bestLocation <= expectedLocation {
						break
					}
					start = max(1, 2*expectedLocation-bestLocation)
				}
			}
		}
		if score(i+1) > currentThreshold {
			break
		}
		lastBitArr = bitArr
	}
	return bestLocation >= 0, math.Max(0.001, finalScore)
}

// searchIn is how well the pattern matches a text: whether it does, and Fuse's score (0 is exact, 1 none)
func (b bitap) searchIn(text string) (bool, float64) {
	lower := units(strings.ToLower(text))
	if string(utf16.Decode(lower)) == string(utf16.Decode(b.pattern)) {
		return true, 0
	}
	total, matched := 0.0, false
	for _, c := range b.chunks {
		isMatch, score := bitapSearch(lower, c)
		if isMatch {
			matched = true
		}
		total += score
	}
	if !matched {
		return false, 1
	}
	return true, total / float64(len(b.chunks))
}

type fuseResult struct {
	candidate *Candidate
	index     int
	score     float64
}

// fuzzy is the candidates Fuse finds for the query, best first, each with a score of 20 for an exact match down to 0
func fuzzy(candidates []*Candidate, query string) []*Candidate {
	searcher := newBitap(query)
	var results []fuseResult
	for index, candidate := range candidates {
		total, matched := 1.0, false
		for _, value := range []string{candidate.Title, candidate.GameName} {
			if strings.TrimSpace(value) == "" {
				continue
			}
			isMatch, score := searcher.searchIn(value)
			if !isMatch {
				continue
			}
			matched = true
			base := score
			if score == 0 {
				base = 2.220446049250313e-16 // Number.EPSILON
			}
			total *= math.Pow(base, fuseKeyWeight*fieldNorm(units(value)))
		}
		if matched {
			results = append(results, fuseResult{candidate: candidate, index: index, score: total})
		}
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].score != results[j].score {
			return results[i].score < results[j].score
		}
		return results[i].index < results[j].index
	})
	matches := make([]*Candidate, len(results))
	for i, result := range results {
		result.candidate.score = 20 * (1 - result.score)
		matches[i] = result.candidate
	}
	return matches
}
