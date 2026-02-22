/**
 * Hebrew text utilities for the Broken Hebrew Dashboard.
 * Provides functions to detect, analyze, and report on malformed Hebrew text.
 */

const HEBREW_RANGE = { start: 0x05D0, end: 0x05EA };

/**
 * Checks if a character is a Hebrew letter.
 * @param {string} char - Single character to check
 * @returns {boolean}
 */
function isHebrewLetter(char) {
  const code = char.charCodeAt(0);
  return code >= HEBREW_RANGE.start && code <= HEBREW_RANGE.end;
}

/**
 * Counts Hebrew characters in a string.
 * @param {string} text - Input text
 * @returns {number} Number of Hebrew characters
 */
function countHebrewChars(text) {
  return [...text].filter(isHebrewLetter).length;
}

/**
 * Detects potentially broken Hebrew sequences (mixed RTL/LTR without proper markers).
 * @param {string} text - Input text
 * @returns {{ broken: boolean, issues: string[] }}
 */
function detectBrokenHebrew(text) {
  const issues = [];
  const hebrewCount = countHebrewChars(text);

  if (hebrewCount === 0) {
    return { broken: false, issues: [] };
  }

  // Check for Hebrew mixed with ASCII without Unicode directional markers
  const hasAscii = /[a-zA-Z]/.test(text);
  const hasHebrewNumerals = /[\u05D0-\u05EA].*\d|\d.*[\u05D0-\u05EA]/.test(text);

  if (hasAscii && hebrewCount > 0) {
    issues.push('Mixed Hebrew and Latin characters without directional markers');
  }

  if (hasHebrewNumerals) {
    issues.push('Hebrew text mixed with numerals — possible rendering issue');
  }

  // Check for incomplete Hebrew words (single isolated Hebrew chars)
  const isolatedHebrew = text.match(/(?<!\p{Script=Hebrew})[\u05D0-\u05EA](?!\p{Script=Hebrew})/gu);
  if (isolatedHebrew && isolatedHebrew.length > 2) {
    issues.push(`${isolatedHebrew.length} isolated Hebrew characters detected`);
  }

  return {
    broken: issues.length > 0,
    issues,
  };
}

/**
 * Generates a summary report for a piece of text.
 * @param {string} text - Input text
 * @returns {object} Analysis report
 */
function analyzeText(text) {
  const hebrewCharCount = countHebrewChars(text);
  const totalChars = text.replace(/\s/g, '').length;
  const hebrewRatio = totalChars > 0 ? hebrewCharCount / totalChars : 0;
  const { broken, issues } = detectBrokenHebrew(text);

  return {
    totalCharacters: totalChars,
    hebrewCharacters: hebrewCharCount,
    hebrewRatio: Math.round(hebrewRatio * 100) / 100,
    isBroken: broken,
    issues,
  };
}

module.exports = { isHebrewLetter, countHebrewChars, detectBrokenHebrew, analyzeText };
