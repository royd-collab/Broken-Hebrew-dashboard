import { useState } from 'react'
import './App.css'

interface HebrewEntry {
  id: number
  original: string
  broken: string
  fixed: string | null
  category: string
  severity: 'high' | 'medium' | 'low'
}

const SAMPLE_DATA: HebrewEntry[] = [
  {
    id: 1,
    original: 'שלום עולם',
    broken: '???? ????',
    fixed: 'שלום עולם',
    category: 'קידוד',
    severity: 'high',
  },
  {
    id: 2,
    original: 'ברוך הבא',
    broken: 'ברוך הבא',
    fixed: null,
    category: 'ניקוד',
    severity: 'medium',
  },
  {
    id: 3,
    original: 'מה שלומך?',
    broken: 'ìä ùìåîê?',
    fixed: 'מה שלומך?',
    category: 'קידוד',
    severity: 'high',
  },
  {
    id: 4,
    original: 'תודה רבה',
    broken: 'תודה  רבה',
    fixed: null,
    category: 'רווח',
    severity: 'low',
  },
  {
    id: 5,
    original: 'לילה טוב',
    broken: '?????? ?????',
    fixed: 'לילה טוב',
    category: 'קידוד',
    severity: 'high',
  },
]

const SEVERITY_LABELS: Record<HebrewEntry['severity'], string> = {
  high: 'גבוהה',
  medium: 'בינונית',
  low: 'נמוכה',
}

const SEVERITY_COLORS: Record<HebrewEntry['severity'], string> = {
  high: '#ea4335',
  medium: '#fbbc04',
  low: '#34a853',
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="stat-card" style={{ borderTop: `4px solid ${color}` }}>
      <span className="stat-value" style={{ color }}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function SeverityBadge({ severity }: { severity: HebrewEntry['severity'] }) {
  return (
    <span
      className="severity-badge"
      style={{ backgroundColor: SEVERITY_COLORS[severity] + '22', color: SEVERITY_COLORS[severity], border: `1px solid ${SEVERITY_COLORS[severity]}` }}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  )
}

export default function App() {
  const [entries, setEntries] = useState<HebrewEntry[]>(SAMPLE_DATA)
  const [filter, setFilter] = useState<'all' | 'fixed' | 'unfixed'>('all')
  const [search, setSearch] = useState('')

  const total = entries.length
  const fixed = entries.filter((e) => e.fixed !== null).length
  const unfixed = total - fixed
  const highSeverity = entries.filter((e) => e.severity === 'high' && !e.fixed).length

  const filtered = entries.filter((e) => {
    const matchesFilter =
      filter === 'all' || (filter === 'fixed' ? e.fixed !== null : e.fixed === null)
    const matchesSearch =
      search === '' ||
      e.original.includes(search) ||
      e.broken.includes(search) ||
      e.category.includes(search)
    return matchesFilter && matchesSearch
  })

  function markFixed(id: number) {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, fixed: e.original } : e
      )
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1 className="header-title">לוח מחוונים עברי שבור</h1>
          <p className="header-subtitle">מעקב ותיקון טקסט עברי פגום</p>
        </div>
      </header>

      <main className="main">
        <section className="stats-section">
          <StatCard label="סה״כ רשומות" value={total} color="#1a73e8" />
          <StatCard label="תוקנו" value={fixed} color="#34a853" />
          <StatCard label="ממתינות לתיקון" value={unfixed} color="#fbbc04" />
          <StatCard label="חומרה גבוהה" value={highSeverity} color="#ea4335" />
        </section>

        <section className="controls-section">
          <input
            className="search-input"
            type="text"
            placeholder="חיפוש..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            dir="rtl"
          />
          <div className="filter-buttons">
            {(['all', 'unfixed', 'fixed'] as const).map((f) => (
              <button
                key={f}
                className={`filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'הכל' : f === 'fixed' ? 'תוקנו' : 'לא תוקנו'}
              </button>
            ))}
          </div>
        </section>

        <section className="table-section">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>טקסט מקורי</th>
                <th>טקסט פגום</th>
                <th>קטגוריה</th>
                <th>חומרה</th>
                <th>סטטוס</th>
                <th>פעולה</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-row">
                    אין תוצאות
                  </td>
                </tr>
              ) : (
                filtered.map((entry) => (
                  <tr key={entry.id} className={entry.fixed ? 'row-fixed' : 'row-broken'}>
                    <td>{entry.id}</td>
                    <td className="text-hebrew">{entry.original}</td>
                    <td className="text-broken">{entry.broken}</td>
                    <td>{entry.category}</td>
                    <td>
                      <SeverityBadge severity={entry.severity} />
                    </td>
                    <td>
                      {entry.fixed ? (
                        <span className="status-fixed">✓ תוקן</span>
                      ) : (
                        <span className="status-broken">✗ פגום</span>
                      )}
                    </td>
                    <td>
                      {!entry.fixed && (
                        <button
                          className="fix-btn"
                          onClick={() => markFixed(entry.id)}
                        >
                          תקן
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </main>

      <footer className="footer">
        <p>לוח מחוונים עברי שבור &copy; {new Date().getFullYear()}</p>
      </footer>
    </div>
  )
}
