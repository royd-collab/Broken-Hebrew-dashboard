import { describe, it, expect } from 'vitest'

// Unit tests for Hebrew text utility logic

function isHebrewBroken(text: string): boolean {
  // A simple heuristic: if the text contains replacement chars or
  // mostly non-Hebrew printable chars where Hebrew is expected
  return text.includes('?') || text.includes('\uFFFD')
}

function countFixed(entries: Array<{ fixed: string | null }>): number {
  return entries.filter((e) => e.fixed !== null).length
}

describe('Hebrew text utilities', () => {
  it('detects broken Hebrew with question marks', () => {
    expect(isHebrewBroken('???? ????')).toBe(true)
  })

  it('treats valid Hebrew as not broken', () => {
    expect(isHebrewBroken('שלום עולם')).toBe(false)
  })

  it('counts fixed entries correctly', () => {
    const entries = [
      { fixed: 'שלום' },
      { fixed: null },
      { fixed: 'ברוך הבא' },
    ]
    expect(countFixed(entries)).toBe(2)
  })

  it('returns 0 when no entries are fixed', () => {
    const entries = [{ fixed: null }, { fixed: null }]
    expect(countFixed(entries)).toBe(0)
  })
})
