import { useEffect, useMemo, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import './App.css'
import { auth, db } from './firebase'

const PAGE_SIZE = 25
const numberFormatter = new Intl.NumberFormat('en-US')
const parseCSVLine = (line) => {
  const values = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"'
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }

    current += char
  }

  values.push(current)
  return values
}

const parseCSV = (text) => {
  const lines = text.trim().split(/\r?\n/)
  if (!lines.length) return { headers: [], rows: [] }

  const headers = parseCSVLine(lines[0]).map((header) => header.trim())
  const rows = lines.slice(1).map((line) => {
    const values = parseCSVLine(line)
    return headers.reduce((acc, header, index) => {
      acc[header] = values[index] ?? ''
      return acc
    }, {})
  })

  return { headers, rows }
}

const toNumber = (value) => {
  const parsed = Number.parseFloat(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function App() {
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [selectedWarehouse, setSelectedWarehouse] = useState('All')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [user, setUser] = useState(null)
  const [authMode, setAuthMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [voteCounts, setVoteCounts] = useState({ yes: 0, no: 0 })
  const [userVote, setUserVote] = useState(null)
  const [selectedVote, setSelectedVote] = useState(null)
  const [voteError, setVoteError] = useState('')
  const [voteLoading, setVoteLoading] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser)
      setAuthError('')
      setVoteError('')
      setUserVote(null)
      setSelectedVote(null)

      if (!currentUser) return

      try {
        const voteSnap = await getDoc(doc(db, 'votes', currentUser.uid))
        if (voteSnap.exists()) {
          setUserVote(voteSnap.data().choice)
        }
      } catch (err) {
        setVoteError('')
      }
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'votes'), (snapshot) => {
      let yes = 0
      let no = 0
      snapshot.forEach((voteDoc) => {
        const choice = voteDoc.data().choice
        if (choice === 'yes') yes += 1
        if (choice === 'no') no += 1
      })
      setVoteCounts({ yes, no })
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadCSV = async () => {
      try {
        const response = await fetch('/data/Warehouse_and_Retail_Sales.csv')
        if (!response.ok) {
          throw new Error('Failed to load CSV data.')
        }
        const text = await response.text()
        const { headers: csvHeaders, rows: csvRows } = parseCSV(text)
        if (isMounted) {
          setHeaders(csvHeaders)
          setRows(csvRows)
        }
      } catch (err) {
        if (isMounted) {
          setError(err)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadCSV()

    return () => {
      isMounted = false
    }
  }, [])

  const warehouses = useMemo(() => {
    const unique = new Set(rows.map((row) => row.SUPPLIER).filter(Boolean))
    return ['All', ...Array.from(unique).sort()]
  }, [rows])

  const categories = useMemo(() => {
    const unique = new Set(rows.map((row) => row['ITEM TYPE']).filter(Boolean))
    return ['All', ...Array.from(unique).sort()]
  }, [rows])

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const warehouseMatch =
        selectedWarehouse === 'All' || row.SUPPLIER === selectedWarehouse
      const categoryMatch =
        selectedCategory === 'All' || row['ITEM TYPE'] === selectedCategory
      return warehouseMatch && categoryMatch
    })
  }, [rows, selectedWarehouse, selectedCategory])

  useEffect(() => {
    setPage(1)
  }, [selectedWarehouse, selectedCategory])

  const monthlyTotals = useMemo(() => {
    const totals = new Map()
    filteredRows.forEach((row) => {
      const year = Number.parseInt(row.YEAR, 10)
      const month = Number.parseInt(row.MONTH, 10)
      if (!Number.isFinite(year) || !Number.isFinite(month)) return

      const key = year * 100 + month
      const label = `${year}-${String(month).padStart(2, '0')}`
      const retail = toNumber(row['RETAIL SALES'])
      const warehouse = toNumber(row['WAREHOUSE SALES'])
      const total = retail + warehouse

      const current = totals.get(key) || { label, value: 0 }
      current.value += total
      totals.set(key, current)
    })

    return Array.from(totals.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => value)
  }, [filteredRows])

  const pagedRows = useMemo(() => {
    const startIndex = (page - 1) * PAGE_SIZE
    return filteredRows.slice(startIndex, startIndex + PAGE_SIZE)
  }, [filteredRows, page])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))

  const handleAuthSubmit = async (event) => {
    event.preventDefault()
    setAuthLoading(true)
    setAuthError('')
    try {
      if (authMode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        await createUserWithEmailAndPassword(auth, email, password)
      }
      setEmail('')
      setPassword('')
    } catch (err) {
      const message =
        err?.message?.replace('Firebase: ', '') ||
        'Unable to authenticate. Please try again.'
      setAuthError(message)
    } finally {
      setAuthLoading(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut(auth)
    } catch (err) {
      setAuthError('Unable to sign out. Please refresh and try again.')
    }
  }

  const handleVote = async (choice) => {
    if (!choice) {
      setVoteError('Please choose Yes or No before confirming.')
      return
    }
    if (!user) {
      setVoteError('Please sign in to vote.')
      return
    }
    if (userVote) {
      setVoteError('You already voted.')
      return
    }

    setVoteLoading(true)
    setVoteError('')
    try {
      await setDoc(doc(db, 'votes', user.uid), {
        choice,
        email: user.email,
        createdAt: serverTimestamp(),
      })
      setUserVote(choice)
      setSelectedVote(null)
    } catch (err) {
      setVoteError('Unable to record your vote. Please try again.')
    } finally {
      setVoteLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="page-header">
        <div className="title-block">
          <p className="eyebrow">Warehouse + Retail Sales Dashboard</p>
          <h1>Maryland Warehouse & Retail Sales Trends</h1>
        </div>
        <div className="auth-panel">
          {!user ? (
            <>
              <div className="auth-buttons">
                <button
                  type="button"
                  className={authMode === 'signin' ? 'active' : ''}
                  onClick={() => setAuthMode('signin')}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={authMode === 'signup' ? 'active' : ''}
                  onClick={() => setAuthMode('signup')}
                >
                  Sign up
                </button>
              </div>
              <form className="auth-form" onSubmit={handleAuthSubmit}>
                <label htmlFor="auth-email">
                  Email
                  <input
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </label>
                <label htmlFor="auth-password">
                  Password
                  <input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </label>
                <button type="submit" disabled={authLoading}>
                  {authLoading
                    ? 'Working...'
                    : authMode === 'signin'
                      ? 'Sign in'
                      : 'Create account'}
                </button>
              </form>
              {authError && <p className="auth-message error">{authError}</p>}
            </>
          ) : (
            <div className="signed-in">
              <p className="signed-in-email">{user.email}</p>
              <p className="auth-message">Thank you for your support.</p>
              <button type="button" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <section className="card vote-card">
        <div className="section-header">
          <div>
            <h2>Stance Poll</h2>
            <p className="stance-question">
              This dashboard presents monthly combined warehouse and retail sales
              data for the State of Maryland, giving the public a clear view of
              how goods move across our economy by supplier and product category.
              While sales levels rise and fall across different months and
              sectors, the overall volume makes one thing clear: strong and
              reliable distribution infrastructure is essential to keeping our
              shelves stocked and our economy moving. I believe Maryland must
              take a proactive approach by investing in our distribution and
              logistics capacity. Doing so will strengthen supply reliability,
              reduce bottlenecks during high-volume periods, and help ensure that
              families and businesses can count on a resilient supply chain.
              Smart, data-informed planning today will keep Maryland competitive
              and prepared for the demands of tomorrow.
              <br />
              <br />
              Do you support expanding Maryland’s distribution and warehousing
              capacity to improve supply reliability based on the observed
              warehouse and retail sales trends?
            </p>
            <div className="vote-totals">
              <span>Support: {voteCounts.yes}</span>
              <span>Against: {voteCounts.no}</span>
            </div>
          </div>
        </div>

        {!user && (
          <p className="state">
            Sign in or sign up to cast your vote.
          </p>
        )}

        {user && (
          <>
            <p className="auth-message success">
              Thank you for your support. You can cast your vote below.
            </p>
            <div className="vote-actions">
              <button
                type="button"
                className={selectedVote === 'yes' ? 'active' : ''}
                onClick={() => setSelectedVote('yes')}
                disabled={voteLoading || Boolean(userVote)}
              >
                Support
              </button>
              <button
                type="button"
                className={selectedVote === 'no' ? 'active' : ''}
                onClick={() => setSelectedVote('no')}
                disabled={voteLoading || Boolean(userVote)}
              >
                Against
              </button>
            </div>
            <button
              type="button"
              className="vote-confirm"
              onClick={() => handleVote(selectedVote)}
              disabled={voteLoading || Boolean(userVote) || !selectedVote}
            >
              {voteLoading ? 'Submitting...' : 'Confirm Vote'}
            </button>
          </>
        )}

        {userVote && (
          <p className="auth-message success">
            Your vote has been recorded:{' '}
            {userVote === 'yes' ? 'SUPPORT' : 'AGAINST'}.
          </p>
        )}
        {voteError && <p className="auth-message error">{voteError}</p>}
      </section>

      <section className="card filter-card">
        <div className="filter-row">
          <div className="filter-group">
            <label htmlFor="warehouse-select">Warehouse (Supplier)</label>
            <select
              id="warehouse-select"
              value={selectedWarehouse}
              onChange={(event) => setSelectedWarehouse(event.target.value)}
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse} value={warehouse}>
                  {warehouse}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="category-select">Drug/Product Category</label>
            <select
              id="category-select"
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-summary">
            <span className="summary-label">Rows matched</span>
            <span className="summary-value">
              {numberFormatter.format(filteredRows.length)}
            </span>
          </div>
        </div>
      </section>

      <section className="card chart-card">
        <div className="section-header">
          <div>
            <h2>Monthly Total Sales</h2>
            <p>
              Aggregated by year and month for the selected warehouse and
              category filters.
            </p>
          </div>
        </div>

        {isLoading && <p className="state">Loading sales data...</p>}
        {error && (
          <p className="state error">
            Unable to load the CSV data. Please refresh and try again.
          </p>
        )}

        {!isLoading && !error && monthlyTotals.length === 0 && (
          <p className="state">No data matches the selected filters.</p>
        )}

        {!isLoading && !error && monthlyTotals.length > 0 && (
          <div className="chart-scroll">
            <MonthlyBarChart data={monthlyTotals} />
          </div>
        )}
      </section>

      <section className="card table-card">
        <div className="section-header">
          <div>
            <h2>Raw Sales Data</h2>
            <p>
              Showing {PAGE_SIZE} rows per page. Use the pagination controls to
              browse the filtered results.
            </p>
          </div>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row, index) => (
                <tr key={`${row['ITEM CODE']}-${index}`}>
                  {headers.map((header) => (
                    <td key={`${header}-${index}`}>{row[header]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page === 1}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={page === totalPages}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  )
}

const MonthlyBarChart = ({ data }) => {
  const chartHeight = 240
  const chartPadding = { top: 20, right: 24, bottom: 50, left: 64 }
  const barSizing =
    data.length <= 6
      ? { width: 60, gap: 30 }
      : data.length <= 12
        ? { width: 44, gap: 20 }
        : { width: 30, gap: 14 }
  const barWidth = barSizing.width
  const barGap = barSizing.gap
  const width = Math.max(960, data.length * (barWidth + barGap) + 200)
  const height = chartHeight + chartPadding.top + chartPadding.bottom

  const maxValue = Math.max(...data.map((item) => item.value), 0)
  const scaledMax = maxValue || 1
  const yScale = (value) =>
    chartPadding.top +
    (chartHeight - (value / scaledMax) * chartHeight)

  const gridLines = 4
  const estimatedLabelWidth = 52
  const xLabelInterval = Math.max(
    1,
    Math.ceil(estimatedLabelWidth / (barWidth + barGap))
  )
  const xOffset = -6

  return (
    <svg width={width} height={height} className="chart">
      <defs>
        <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="transparent"
        rx="16"
      />
      {Array.from({ length: gridLines + 1 }).map((_, index) => {
        const value = (scaledMax / gridLines) * index
        const y = yScale(value)
        return (
          <g key={`grid-${value}`}>
            <line
              x1={chartPadding.left}
              x2={width - chartPadding.right}
              y1={y}
              y2={y}
              stroke="rgba(148, 163, 184, 0.25)"
            />
            <text
              x={chartPadding.left - 12}
              y={y + 4}
              textAnchor="end"
              className="axis-label"
            >
              {numberFormatter.format(Math.round(value))}
            </text>
          </g>
        )
      })}

      {data.map((item, index) => {
        const x = chartPadding.left + index * (barWidth + barGap) + xOffset
        const y = yScale(item.value)
        const barHeight = chartPadding.top + chartHeight - y
        const showLabel = index % xLabelInterval === 0
        const labelShift = index === data.length - 1 ? -8 : 0
        return (
          <g key={item.label}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx="6"
              className="bar"
            />
            {showLabel && (
              <text
                x={x + barWidth / 2 + labelShift}
                y={chartPadding.top + chartHeight + 20}
                textAnchor="middle"
                className="axis-label"
              >
                {item.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export default App
