const { isHebrewLetter, countHebrewChars, detectBrokenHebrew, analyzeText } = require('../src/hebrewUtils');

describe('isHebrewLetter', () => {
  test('returns true for Hebrew aleph', () => {
    expect(isHebrewLetter('א')).toBe(true);
  });

  test('returns true for Hebrew tav', () => {
    expect(isHebrewLetter('ת')).toBe(true);
  });

  test('returns false for Latin letter', () => {
    expect(isHebrewLetter('a')).toBe(false);
  });

  test('returns false for digit', () => {
    expect(isHebrewLetter('3')).toBe(false);
  });
});

describe('countHebrewChars', () => {
  test('counts Hebrew characters correctly', () => {
    expect(countHebrewChars('שלום')).toBe(4);
  });

  test('returns 0 for non-Hebrew text', () => {
    expect(countHebrewChars('hello')).toBe(0);
  });

  test('counts only Hebrew in mixed text', () => {
    expect(countHebrewChars('abc שלום xyz')).toBe(4);
  });
});

describe('detectBrokenHebrew', () => {
  test('returns not broken for pure Hebrew text', () => {
    const result = detectBrokenHebrew('שלום עולם');
    expect(result.broken).toBe(false);
    expect(result.issues).toHaveLength(0);
  });

  test('returns not broken for pure ASCII text', () => {
    const result = detectBrokenHebrew('hello world');
    expect(result.broken).toBe(false);
  });

  test('detects mixed Hebrew and Latin as an issue', () => {
    const result = detectBrokenHebrew('Hello שלום');
    expect(result.broken).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('analyzeText', () => {
  test('reports correct hebrewRatio for pure Hebrew', () => {
    const report = analyzeText('שלום');
    expect(report.hebrewRatio).toBe(1);
    expect(report.hebrewCharacters).toBe(4);
  });

  test('reports 0 hebrewRatio for empty string', () => {
    const report = analyzeText('');
    expect(report.hebrewRatio).toBe(0);
    expect(report.totalCharacters).toBe(0);
  });

  test('isBroken is false for clean Hebrew text', () => {
    const report = analyzeText('מחשב');
    expect(report.isBroken).toBe(false);
  });
});
