'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Business = 'Baker' | 'Clarity' | 'Hunch' | 'Navigate'
type Room = 'talking' | 'board'

interface BusyBlock {
  start: string
  end: string
  title: string
}

interface RoomData {
  busyBlocks: BusyBlock[]
  freeNow: boolean
  nextAvailable: string | null
  error?: string
}

interface AvailabilityData {
  talkingRoom: RoomData
  boardRoom: RoomData
  date: string
}

interface PopoverState {
  room: Room
  slotStart: Date
  slotEnd: Date
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BUSINESSES: Business[] = ['Baker', 'Clarity', 'Hunch', 'Navigate']

const BUSINESS_COLORS: Record<Business, { color: string; bg: string; border: string }> = {
  Baker:    { color: '#c9956b', bg: 'rgba(201,149,107,0.12)', border: '#c9956b' },
  Clarity:  { color: '#7db88a', bg: 'rgba(125,184,138,0.12)', border: '#7db88a' },
  Hunch:    { color: '#d94040', bg: 'rgba(217,64,64,0.12)',   border: '#d94040' },
  Navigate: { color: '#6b8fc9', bg: 'rgba(107,143,201,0.12)', border: '#6b8fc9' },
}

const BUSINESS_BLOCK_COLORS: Record<string, { color: string; bg: string }> = {
  Baker:    { color: '#c9956b', bg: 'rgba(201,149,107,0.18)' },
  Clarity:  { color: '#7db88a', bg: 'rgba(125,184,138,0.18)' },
  Hunch:    { color: '#d94040', bg: 'rgba(217,64,64,0.18)'   },
  Navigate: { color: '#6b8fc9', bg: 'rgba(107,143,201,0.18)' },
  Booked:   { color: '#777',    bg: 'rgba(120,120,120,0.18)' },
}

const TALKING_CALENDAR_ID = 'c_0c184e684570208106c3138b4c83e5bc355894c812276d51ba97377bd4e38671@group.calendar.google.com'
const BOARD_CALENDAR_ID   = 'c_b1b9fc3c7c8d4482910d0690b45c327588288fdbfa88ad4599f64ba1ab5a0ce1@group.calendar.google.com'

const TALKING_VIEW_URL = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(TALKING_CALENDAR_ID)}`
const BOARD_VIEW_URL   = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(BOARD_CALENDAR_ID)}`

// 09:00 – 18:00 → 18 half-hour slots
const SLOT_START_HOUR = 9
const SLOT_END_HOUR   = 18
const TOTAL_SLOTS     = (SLOT_END_HOUR - SLOT_START_HOUR) * 2 // 18

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayNZ(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function formatDateHeading(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })
}

function formatTime12(date: Date): string {
  return date.toLocaleTimeString('en-NZ', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Pacific/Auckland',
  }).replace(':00', '').toLowerCase()
}

function slotIndexToDate(dateStr: string, slotIndex: number): Date {
  const totalMins = SLOT_START_HOUR * 60 + slotIndex * 30
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  // Build in NZ time
  const d = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+13:00`)
  return d
}

function slotLabel(slotIndex: number): { label: string; isHour: boolean } {
  const totalMins = SLOT_START_HOUR * 60 + slotIndex * 30
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  const isHour = m === 0
  const h12 = h > 12 ? h - 12 : h
  return { label: isHour ? `${h12}.00` : '', isHour }
}

function isMidday(slotIndex: number): boolean {
  // 12:30 divider — slot index for 12:30 = (12:30 - 9:00) / 0.5 = 7
  return slotIndex === 7
}

function isSlotBusy(dateStr: string, slotIndex: number, busyBlocks: BusyBlock[]): BusyBlock | null {
  const slotStart = slotIndexToDate(dateStr, slotIndex)
  const slotEnd   = slotIndexToDate(dateStr, slotIndex + 1)
  for (const block of busyBlocks) {
    const bs = new Date(block.start)
    const be = new Date(block.end)
    if (bs < slotEnd && be > slotStart) return block
  }
  return null
}

function isSlotBlockStart(dateStr: string, slotIndex: number, busyBlocks: BusyBlock[]): BusyBlock | null {
  const slotStart = slotIndexToDate(dateStr, slotIndex)
  for (const block of busyBlocks) {
    const bs = new Date(block.start)
    // Block starts within this slot
    if (bs >= slotStart && bs < slotIndexToDate(dateStr, slotIndex + 1)) return block
    // Or block starts before window but overlaps this slot start
    if (bs <= slotStart && new Date(block.end) > slotStart && slotIndex === 0) return block
  }
  return null
}

function blockHeightSlots(dateStr: string, slotIndex: number, block: BusyBlock): number {
  const slotStart = slotIndexToDate(dateStr, slotIndex)
  const be = new Date(block.end)
  const bs = new Date(block.start)
  const effectiveStart = slotStart > bs ? slotStart : bs
  const durationMs = be.getTime() - effectiveStart.getTime()
  const slots = Math.ceil(durationMs / (30 * 60 * 1000))
  return Math.max(1, slots)
}

function extractBusinessFromTitle(title: string): string {
  const lower = title.toLowerCase()
  if (lower.includes('baker'))    return 'Baker'
  if (lower.includes('clarity'))  return 'Clarity'
  if (lower.includes('hunch'))    return 'Hunch'
  if (lower.includes('navigate')) return 'Navigate'
  return 'Booked'
}

function buildGoogleCalendarUrl(
  room: Room,
  slotStart: Date,
  slotEnd: Date,
  business: Business,
  dateStr: string,
): string {
  const calendarId = room === 'talking' ? TALKING_CALENDAR_ID : BOARD_CALENDAR_ID
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `[${business}]`,
    dates: `${fmt(slotStart)}/${fmt(slotEnd)}`,
    add: calendarId,
    details: 'Booked via RoomHub',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TalkingIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="16" height="12" rx="2" opacity="0.3"/>
      <circle cx="8"  cy="4"  r="2"/>
      <circle cx="16" cy="4"  r="2"/>
      <circle cx="8"  cy="20" r="2"/>
      <circle cx="16" cy="20" r="2"/>
    </svg>
  )
}

function BoardIcon() {
  return (
    <svg width="28" height="18" viewBox="0 0 28 18" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="20" height="12" rx="3" opacity="0.3"/>
      <circle cx="2"  cy="7"    r="1.5"/>
      <circle cx="2"  cy="11"   r="1.5"/>
      <circle cx="26" cy="7"    r="1.5"/>
      <circle cx="26" cy="11"   r="1.5"/>
      <circle cx="10" cy="1.5"  r="1.5"/>
      <circle cx="18" cy="1.5"  r="1.5"/>
      <circle cx="10" cy="16.5" r="1.5"/>
      <circle cx="18" cy="16.5" r="1.5"/>
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginLeft: 3, verticalAlign: -1, opacity: 0.5 }}>
      <path d="M3 9L9 3M9 3H4M9 3V8"/>
    </svg>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RoomHub() {
  const [selectedBusiness, setSelectedBusiness] = useState<Business>('Hunch')
  const [currentDate, setCurrentDate]           = useState<string>(todayNZ())
  const [data, setData]                         = useState<AvailabilityData | null>(null)
  const [loading, setLoading]                   = useState(true)
  const [popover, setPopover]                   = useState<PopoverState | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Restore business from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('roomhub-business') as Business | null
    if (saved && BUSINESSES.includes(saved)) setSelectedBusiness(saved)
  }, [])

  const saveBusiness = (b: Business) => {
    setSelectedBusiness(b)
    localStorage.setItem('roomhub-business', b)
  }

  // Fetch availability
  const fetchData = useCallback(async (date: string) => {
    try {
      const res = await fetch(`/api/availability?date=${date}`)
      const json = await res.json()
      setData(json)
    } catch (e) {
      console.error('Fetch error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll every 60s
  useEffect(() => {
    setLoading(true)
    fetchData(currentDate)
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => fetchData(currentDate), 60_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [currentDate, fetchData])

  // Page Visibility API — refresh on tab focus
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') fetchData(currentDate)
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [currentDate, fetchData])

  // Date navigation
  const today     = todayNZ()
  const maxDate   = addDays(today, 7)
  const canGoBack = currentDate > today
  const canGoFwd  = currentDate < maxDate

  const handlePrevDay = () => { if (canGoBack) setCurrentDate(addDays(currentDate, -1)) }
  const handleNextDay = () => { if (canGoFwd)  setCurrentDate(addDays(currentDate, 1)) }

  // Slot click
  const handleSlotClick = (room: Room, slotIndex: number) => {
    const slotStart = slotIndexToDate(currentDate, slotIndex)
    const slotEnd   = slotIndexToDate(currentDate, slotIndex + 1)
    setPopover({ room, slotStart, slotEnd })
  }

  const handleBook = () => {
    if (!popover) return
    const url = buildGoogleCalendarUrl(
      popover.room,
      popover.slotStart,
      popover.slotEnd,
      selectedBusiness,
      currentDate,
    )
    window.open(url, '_blank')
    setPopover(null)
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const roomData = (room: Room) => (room === 'talking' ? data?.talkingRoom : data?.boardRoom)

  const renderSlots = (room: Room) => {
    const rd = roomData(room)
    const busyBlocks = rd?.busyBlocks || []
    const isTalk = room === 'talking'
    const tint = isTalk ? 'var(--talk-tint)' : 'var(--board-tint)'
    const hoverTint = isTalk ? 'var(--talk-hover)' : 'var(--board-hover)'

    const rendered: React.ReactNode[] = []
    const renderedBlockStarts = new Set<string>()

    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const busyBlock = isSlotBusy(currentDate, i, busyBlocks)
      const isBusy = !!busyBlock
      const isHourStart = i % 2 === 0
      const isMidday = isMidday(i)
      const isLastSlot = i === TOTAL_SLOTS - 1

      // Is this where a busy block label should be rendered?
      let blockLabel: React.ReactNode = null
      if (isBusy && busyBlock) {
        const blockKey = busyBlock.start
        if (!renderedBlockStarts.has(blockKey)) {
          renderedBlockStarts.add(blockKey)
          const heightSlots = blockHeightSlots(currentDate, i, busyBlock)
          const heightPx = heightSlots * 20 - 4
          const business = extractBusinessFromTitle(busyBlock.title)
          const colors = BUSINESS_BLOCK_COLORS[business] || BUSINESS_BLOCK_COLORS['Booked']
          blockLabel = (
            <div style={{
              position: 'absolute',
              left: 3, right: 3, top: 2,
              height: heightPx,
              borderRadius: 4,
              background: colors.bg,
              color: colors.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
              zIndex: 2,
              pointerEvents: 'none',
            }}>
              {business === 'Booked' ? '' : business}
            </div>
          )
        }
      }

      rendered.push(
        <div
          key={`${room}-${i}`}
          onClick={() => !isBusy && !isLastSlot && handleSlotClick(room, i)}
          style={{
            height: 20,
            position: 'relative',
            background: tint,
            borderTop: isHourStart ? '1px solid var(--line)' : 'none',
            borderBottom: isMidday
              ? '1px solid var(--line)'
              : isLastSlot
              ? 'none'
              : '1px solid var(--line-light)',
            cursor: isBusy || isLastSlot ? 'default' : 'pointer',
            transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => {
            if (!isBusy && !isLastSlot) (e.currentTarget as HTMLDivElement).style.background = hoverTint
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = tint
          }}
        >
          {blockLabel}
        </div>
      )
    }
    return rendered
  }

  const renderTimeLabels = () => {
    const labels: React.ReactNode[] = []
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const { label, isHour } = slotLabel(i)
      const isMidday = isMidday(i)
      labels.push(
        <div
          key={`time-${i}`}
          style={{
            fontSize: isHour ? 11 : 10,
            color: isHour ? 'var(--text-muted)' : 'var(--text-light)',
            fontWeight: isHour ? 500 : 400,
            height: 20,
            display: 'flex',
            alignItems: 'flex-start',
            paddingTop: 1,
            paddingLeft: 2,
            borderTop: i % 2 === 0 ? '1px solid var(--line)' : 'none',
            borderBottom: isMidday ? '1px solid var(--line)' : '1px solid var(--line-light)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {label}
        </div>
      )
    }
    return labels
  }

  const popoverRoomName = popover?.room === 'talking' ? 'Talking Room' : 'Board Room'
  const popoverTimeStr  = popover
    ? `${formatTime12(popover.slotStart)} – ${formatTime12(popover.slotEnd)}`
    : ''

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '40px 24px 60px' }}>

      {/* Date heading */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.5px' }}>
          {formatDateHeading(currentDate)}
        </div>
      </div>

      {/* Booking as bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.2px' }}>
          Booking as
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {BUSINESSES.map((b) => {
            const active = selectedBusiness === b
            const c = BUSINESS_COLORS[b]
            return (
              <button
                key={b}
                onClick={() => saveBusiness(b)}
                style={{
                  fontFamily: 'Instrument Sans, sans-serif',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '5px 12px',
                  borderRadius: 3,
                  border: `1.5px solid ${active ? c.border : 'var(--line)'}`,
                  background: active ? c.bg : 'transparent',
                  color: c.color,
                  cursor: 'pointer',
                  letterSpacing: '0.2px',
                  transition: 'all 0.15s',
                }}
              >
                {b}
              </button>
            )
          })}
        </div>
      </div>

      {/* Column header bar with nav arrows */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '42px 32px 1fr 1fr 32px',
        alignItems: 'end',
        borderBottom: '1.5px solid var(--text-muted)',
      }}>
        <div /> {/* spacer */}

        {/* ◀ prev */}
        <button
          onClick={handlePrevDay}
          disabled={!canGoBack}
          style={{
            background: 'none', border: 'none',
            color: 'var(--text-muted)',
            cursor: canGoBack ? 'pointer' : 'default',
            padding: '8px 8px',
            opacity: canGoBack ? 1 : 0.15,
            display: 'flex', alignItems: 'center',
            transition: 'color 0.15s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 1L3 5L7 9"/>
          </svg>
        </button>

        {/* Talking Room header */}
        <div style={{
          fontSize: 12, fontWeight: 600, padding: '8px 10px',
          letterSpacing: '-0.2px', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <TalkingIcon />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>Talking Room</span>
            <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', letterSpacing: '0.1px' }}>2–4 people</span>
          </div>
        </div>

        {/* Board Room header */}
        <div style={{
          fontSize: 12, fontWeight: 600, padding: '8px 10px',
          letterSpacing: '-0.2px', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <BoardIcon />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>Board Room</span>
            <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', letterSpacing: '0.1px' }}>4+ people</span>
          </div>
        </div>

        {/* ▶ next */}
        <button
          onClick={handleNextDay}
          disabled={!canGoFwd}
          style={{
            background: 'none', border: 'none',
            color: 'var(--text-muted)',
            cursor: canGoFwd ? 'pointer' : 'default',
            padding: '8px 8px',
            opacity: canGoFwd ? 1 : 0.15,
            display: 'flex', alignItems: 'center',
            transition: 'color 0.15s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 1L7 5L3 9"/>
          </svg>
        </button>
      </div>

      {/* Timeline grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Loading…
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr 1fr' }}>
          {/* Time labels */}
          <div>{renderTimeLabels()}</div>

          {/* Talking Room slots */}
          <div style={{ position: 'relative' }}>
            {data?.talkingRoom.error ? (
              <div style={{ padding: '20px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                Could not load calendar
              </div>
            ) : renderSlots('talking')}
          </div>

          {/* Board Room slots */}
          <div style={{ position: 'relative' }}>
            {data?.boardRoom.error ? (
              <div style={{ padding: '20px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                Could not load calendar
              </div>
            ) : renderSlots('board')}
          </div>

          {/* Closing line */}
          <div style={{ gridColumn: '1 / -1', borderTop: '1.5px solid var(--text-muted)', height: 0 }} />
        </div>
      )}

      {/* See full calendar links */}
      <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr 1fr' }}>
        <div />
        <a href={TALKING_VIEW_URL} target="_blank" rel="noopener noreferrer" style={{
          fontSize: 10, color: 'var(--text-muted)', textDecoration: 'none',
          padding: '12px 10px', letterSpacing: '0.2px', textAlign: 'center',
          display: 'block', transition: 'color 0.15s',
        }}
          onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text)'}
          onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-muted)'}
        >
          See the full calendar <ExternalLinkIcon />
        </a>
        <a href={BOARD_VIEW_URL} target="_blank" rel="noopener noreferrer" style={{
          fontSize: 10, color: 'var(--text-muted)', textDecoration: 'none',
          padding: '12px 10px', letterSpacing: '0.2px', textAlign: 'center',
          display: 'block', transition: 'color 0.15s',
        }}
          onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text)'}
          onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-muted)'}
        >
          See the full calendar <ExternalLinkIcon />
        </a>
      </div>

      {/* Booking popover */}
      {popover && (
        <div
          onClick={() => setPopover(null)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#1e1e1e',
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: 24,
              width: 280,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
              {popoverRoomName}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.5px', marginBottom: 4 }}>
              {popoverTimeStr}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              {formatDateHeading(currentDate)}
            </div>
            <div style={{
              display: 'inline-block',
              fontSize: 11, fontWeight: 600,
              padding: '4px 12px',
              borderRadius: 3,
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
              marginBottom: 20,
              background: BUSINESS_COLORS[selectedBusiness].bg,
              color: BUSINESS_COLORS[selectedBusiness].color,
            }}>
              {selectedBusiness}
            </div>
            <button
              onClick={handleBook}
              style={{
                display: 'block', width: '100%',
                fontFamily: 'Instrument Sans, sans-serif',
                fontSize: 13, fontWeight: 600,
                padding: '10px 0',
                border: 'none', borderRadius: 5,
                background: 'var(--text)', color: 'var(--bg)',
                cursor: 'pointer', letterSpacing: '-0.2px',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
            >
              Book in Google Calendar →
            </button>
            <button
              onClick={() => setPopover(null)}
              style={{
                display: 'block', marginTop: 10,
                fontFamily: 'Instrument Sans, sans-serif',
                fontSize: 12, color: 'var(--text-muted)',
                background: 'none', border: 'none',
                cursor: 'pointer', width: '100%', padding: '4px 0',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
