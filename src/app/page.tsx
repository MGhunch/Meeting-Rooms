'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Business = 'Baker' | 'Clarity' | 'Hunch' | 'Navigate'
type Room = 'talking' | 'board'
type Duration = 30 | 60 | 120

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

interface ModalState {
  room: Room
  slotStart: Date
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BUSINESSES: Business[] = ['Baker', 'Clarity', 'Hunch', 'Navigate']

const BUSINESS_COLORS: Record<Business, { color: string; bg: string; border: string }> = {
  Baker:    { color: '#b87d4b', bg: 'rgba(184,125,75,0.12)',  border: '#b87d4b' },
  Clarity:  { color: '#4a9a5e', bg: 'rgba(74,154,94,0.12)',   border: '#4a9a5e' },
  Hunch:    { color: '#d94040', bg: 'rgba(217,64,64,0.10)',   border: '#d94040' },
  Navigate: { color: '#4a72b8', bg: 'rgba(74,114,184,0.12)',  border: '#4a72b8' },
}

const BUSINESS_BLOCK_COLORS: Record<string, { color: string; bg: string }> = {
  Baker:    { color: '#b87d4b', bg: 'rgba(184,125,75,0.14)'  },
  Clarity:  { color: '#4a9a5e', bg: 'rgba(74,154,94,0.12)'   },
  Hunch:    { color: '#d94040', bg: 'rgba(217,64,64,0.12)'   },
  Navigate: { color: '#4a72b8', bg: 'rgba(74,114,184,0.12)'  },
  Booked:   { color: '#999',    bg: 'rgba(120,120,120,0.12)' },
}

const TALKING_CALENDAR_ID = 'c_0c184e684570208106c3138b4c83e5bc355894c812276d51ba97377bd4e38671@group.calendar.google.com'
const BOARD_CALENDAR_ID   = 'c_b1b9fc3c7c8d4482910d0690b45c327588288fdbfa88ad4599f64ba1ab5a0ce1@group.calendar.google.com'
const TALKING_VIEW_URL    = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(TALKING_CALENDAR_ID)}`
const BOARD_VIEW_URL      = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(BOARD_CALENDAR_ID)}`

const SLOT_START_HOUR = 9
const SLOT_END_HOUR   = 18
const TOTAL_SLOTS     = (SLOT_END_HOUR - SLOT_START_HOUR) * 2

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
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Pacific/Auckland',
  }).replace(':00', '').toLowerCase()
}

function slotIndexToDate(dateStr: string, slotIndex: number): Date {
  const totalMins = SLOT_START_HOUR * 60 + slotIndex * 30
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  return new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+13:00`)
}

function slotLabel(slotIndex: number): { label: string; isHour: boolean } {
  const totalMins = SLOT_START_HOUR * 60 + slotIndex * 30
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  const isHour = m === 0
  const h12 = h > 12 ? h - 12 : h
  return { label: isHour ? `${h12}.00` : '', isHour }
}

function isMidday(slotIndex: number): boolean { return slotIndex === 7 }

function isSlotBusy(dateStr: string, slotIndex: number, busyBlocks: BusyBlock[]): BusyBlock | null {
  const slotStart = slotIndexToDate(dateStr, slotIndex)
  const slotEnd   = slotIndexToDate(dateStr, slotIndex + 1)
  for (const block of busyBlocks) {
    const bs = new Date(block.start), be = new Date(block.end)
    if (bs < slotEnd && be > slotStart) return block
  }
  return null
}

function isSlotBlockStart(dateStr: string, slotIndex: number, busyBlocks: BusyBlock[]): BusyBlock | null {
  const slotStart = slotIndexToDate(dateStr, slotIndex)
  for (const block of busyBlocks) {
    const bs = new Date(block.start)
    if (bs >= slotStart && bs < slotIndexToDate(dateStr, slotIndex + 1)) return block
    if (bs <= slotStart && new Date(block.end) > slotStart && slotIndex === 0) return block
  }
  return null
}

function blockHeightSlots(dateStr: string, slotIndex: number, block: BusyBlock): number {
  const slotStart = slotIndexToDate(dateStr, slotIndex)
  const be = new Date(block.end), bs = new Date(block.start)
  const effectiveStart = slotStart > bs ? slotStart : bs
  const slots = Math.ceil((be.getTime() - effectiveStart.getTime()) / (30 * 60 * 1000))
  return Math.max(1, slots)
}

function extractBusiness(title: string): string {
  const l = title.toLowerCase()
  if (l.includes('baker'))    return 'Baker'
  if (l.includes('clarity'))  return 'Clarity'
  if (l.includes('hunch'))    return 'Hunch'
  if (l.includes('navigate')) return 'Navigate'
  return 'Booked'
}

function buildGCalUrl(room: Room, start: Date, durationMins: number, business: Business): string {
  const end = new Date(start.getTime() + durationMins * 60_000)
  const calendarId = room === 'talking' ? TALKING_CALENDAR_ID : BOARD_CALENDAR_ID
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\\.\\d{3}/, '')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `[${business}]`,
    dates: `${fmt(start)}/${fmt(end)}`,
    add: calendarId,
    details: 'Booked via RoomHub',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function TalkingIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
      <circle cx="11" cy="11" r="6" opacity="0.35"/>
      <circle cx="11" cy="3"  r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="11" cy="19" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="3"  cy="11" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="19" cy="11" r="1.8" fill="currentColor" stroke="none"/>
    </svg>
  )
}

function BoardIcon() {
  return (
    <svg width="28" height="18" viewBox="0 0 28 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
      <rect x="4" y="3" width="20" height="12" rx="3" opacity="0.35"/>
      <circle cx="2"  cy="7"    r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="2"  cy="11"   r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="26" cy="7"    r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="26" cy="11"   r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="10" cy="1.5"  r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="18" cy="1.5"  r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="10" cy="16.5" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="18" cy="16.5" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RoomHub() {
  const [currentDate, setCurrentDate] = useState<string>(todayNZ())
  const [data, setData]               = useState<AvailabilityData | null>(null)
  const [loading, setLoading]         = useState(true)
  const [modal, setModal]             = useState<ModalState | null>(null)
  const [selectedBusiness, setSelectedBusiness] = useState<Business>('Hunch')
  const [selectedDuration, setSelectedDuration] = useState<Duration>(30)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('roomhub-business') as Business | null
    if (saved && BUSINESSES.includes(saved)) setSelectedBusiness(saved)
  }, [])

  const saveBusiness = (b: Business) => {
    setSelectedBusiness(b)
    localStorage.setItem('roomhub-business', b)
  }

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

  useEffect(() => {
    setLoading(true)
    fetchData(currentDate)
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => fetchData(currentDate), 60_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [currentDate, fetchData])

  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') fetchData(currentDate) }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [currentDate, fetchData])

  const today   = todayNZ()
  const maxDate = addDays(today, 7)
  const canBack = currentDate > today
  const canFwd  = currentDate < maxDate

  const openModal = (room: Room, slotIndex: number) => {
    setSelectedDuration(30)
    setModal({ room, slotStart: slotIndexToDate(currentDate, slotIndex) })
  }

  const handleBook = () => {
    if (!modal) return
    const url = buildGCalUrl(modal.room, modal.slotStart, selectedDuration, selectedBusiness)
    window.open(url, '_blank')
    setModal(null)
  }

  const renderSlots = (room: Room) => {
    const rd = room === 'talking' ? data?.talkingRoom : data?.boardRoom
    const busyBlocks = rd?.busyBlocks || []
    const tint = room === 'talking' ? 'var(--talk-tint)' : 'var(--board-tint)'
    const hover = room === 'talking' ? 'var(--talk-hover)' : 'var(--board-hover)'
    const rendered: React.ReactNode[] = []
    const seen = new Set<string>()

    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const busyBlock = isSlotBusy(currentDate, i, busyBlocks)
      const isBusy = !!busyBlock
      const isHourStart = i % 2 === 0
      const isMiddaySlot = isMidday(i)
      const isLastSlot = i === TOTAL_SLOTS - 1

      let blockLabel: React.ReactNode = null
      if (isBusy && busyBlock && !seen.has(busyBlock.start)) {
        seen.add(busyBlock.start)
        const h = blockHeightSlots(currentDate, i, busyBlock) * 20 - 4
        const biz = extractBusiness(busyBlock.title)
        const c = BUSINESS_BLOCK_COLORS[biz] || BUSINESS_BLOCK_COLORS['Booked']
        blockLabel = (
          <div style={{
            position: 'absolute', left: 3, right: 3, top: 2, height: h,
            borderRadius: 4, background: c.bg, color: c.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 600, letterSpacing: '0.3px',
            textTransform: 'uppercase', zIndex: 2, pointerEvents: 'none',
          }}>
            {biz !== 'Booked' ? biz : ''}
          </div>
        )
      }

      rendered.push(
        <div
          key={`${room}-${i}`}
          onClick={() => !isBusy && !isLastSlot && openModal(room, i)}
          style={{
            height: 20, position: 'relative', background: tint,
            borderTop: isHourStart ? '1px solid var(--line)' : 'none',
            borderBottom: isMiddaySlot ? '1px solid var(--line)' : isLastSlot ? 'none' : '1px solid var(--line-light)',
            cursor: isBusy || isLastSlot ? 'default' : 'pointer',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => { if (!isBusy && !isLastSlot) (e.currentTarget as HTMLDivElement).style.background = hover }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = tint }}
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
      const isMiddaySlot = isMidday(i)
      labels.push(
        <div key={`t-${i}`} style={{
          fontSize: isHour ? 11 : 10,
          color: isHour ? 'var(--text-muted)' : 'var(--text-light)',
          fontWeight: isHour ? 500 : 400,
          height: 20, display: 'flex', alignItems: 'flex-start',
          paddingTop: 1, paddingLeft: 2,
          borderTop: i % 2 === 0 ? '1px solid var(--line)' : 'none',
          borderBottom: isMiddaySlot ? '1px solid var(--line)' : '1px solid var(--line-light)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {label}
        </div>
      )
    }
    return labels
  }

  const modalRoomName = modal?.room === 'talking' ? 'Talking Room' : 'Board Room'
  const modalTimeStr  = modal ? formatTime12(modal.slotStart) : ''

  // nav button style
  const navBtn = (enabled: boolean): React.CSSProperties => ({
    background: 'none', border: 'none',
    color: 'var(--text-muted)', cursor: enabled ? 'pointer' : 'default',
    padding: '4px 8px', borderRadius: 4,
    opacity: enabled ? 1 : 0.2,
    display: 'flex', alignItems: 'center', transition: 'all 0.15s',
  })

  // col header style
  const colHeader = (room: 'talk' | 'board'): React.CSSProperties => ({
    padding: '12px 12px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    background: room === 'talk' ? 'var(--talk-tint)' : 'var(--board-tint)',
  })

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '40px 24px 60px' }}>

      {/* ── Header ── */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>
          Meeting Rooms
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <button style={navBtn(canBack)} onClick={() => canBack && setCurrentDate(addDays(currentDate, -1))}>
            <svg width="18" height="18" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1L3 5L7 9"/></svg>
          </button>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px', minWidth: 240, textAlign: 'center' }}>
            {formatDateHeading(currentDate)}
          </div>
          <button style={navBtn(canFwd)} onClick={() => canFwd && setCurrentDate(addDays(currentDate, 1))}>
            <svg width="18" height="18" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 1L7 5L3 9"/></svg>
          </button>
        </div>
      </div>

      {/* ── Hint ── */}
      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginBottom: 28, letterSpacing: '0.1px' }}>
        Click a start time to book. Or just jump in if the room is free.
      </div>

      {/* ── Column headers ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr 1fr', borderBottom: '1.5px solid var(--text)' }}>
        <div />
        <div style={colHeader('talk')}>
          <TalkingIcon />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.3px' }}>Talking Room</span>
        </div>
        <div style={colHeader('board')}>
          <BoardIcon />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.3px' }}>Board Room</span>
        </div>
      </div>

      {/* ── Grid ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr 1fr' }}>
          <div>{renderTimeLabels()}</div>
          <div style={{ position: 'relative' }}>
            {data?.talkingRoom.error
              ? <div style={{ padding: '20px 10px', fontSize: 11, color: 'var(--text-muted)' }}>Could not load calendar</div>
              : renderSlots('talking')}
          </div>
          <div style={{ position: 'relative' }}>
            {data?.boardRoom.error
              ? <div style={{ padding: '20px 10px', fontSize: 11, color: 'var(--text-muted)' }}>Could not load calendar</div>
              : renderSlots('board')}
          </div>
          <div style={{ gridColumn: '1 / -1', borderTop: '1.5px solid var(--text)', height: 0 }} />
        </div>
      )}

      {/* ── Footer links ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr 1fr', marginBottom: 32 }}>
        <div />
        {[TALKING_VIEW_URL, BOARD_VIEW_URL].map((url, i) => (
          <div key={i} style={{ padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <a href={url} target="_blank" rel="noopener noreferrer" style={{
              fontFamily: 'Instrument Sans, sans-serif',
              fontSize: 10, fontWeight: 500, color: 'var(--text-muted)',
              background: 'none', border: '1px solid var(--line)', borderRadius: 3,
              padding: '4px 10px', letterSpacing: '0.2px', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text)'; (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--text-muted)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--line)' }}
            >
              See the calendar ↗
            </a>
          </div>
        ))}
      </div>

      {/* ── Page footer ── */}
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-light)', letterSpacing: '0.1px', paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        This calendar is view only. You&apos;ll go through to Google Calendar to book.
      </div>

      {/* ── Modal ── */}
      {modal && (
        <div
          onClick={() => setModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 12,
            padding: '28px 24px 24px', width: 300,
            boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
            position: 'relative',
          }}>
            {/* × close */}
            <button onClick={() => setModal(null)} style={{
              position: 'absolute', top: 14, right: 14,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 4, borderRadius: 4,
              display: 'flex', alignItems: 'center', transition: 'color 0.15s',
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 3l10 10M13 3L3 13"/>
              </svg>
            </button>

            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 4 }}>
              {modalRoomName}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-1px', color: 'var(--text)', marginBottom: 2 }}>
              {modalTimeStr}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>
              {formatDateHeading(currentDate)}
            </div>

            <div style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '0 -24px 22px' }} />

            {/* How long */}
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 8 }}>
              How long?
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 22 }}>
              {([30, 60, 120] as Duration[]).map(d => (
                <button key={d} onClick={() => setSelectedDuration(d)} style={{
                  fontFamily: 'Instrument Sans, sans-serif',
                  fontSize: 12, fontWeight: 600,
                  padding: '7px 0', borderRadius: 6, flex: 1, textAlign: 'center',
                  border: `1.5px solid ${selectedDuration === d ? 'var(--text)' : 'var(--line)'}`,
                  background: selectedDuration === d ? 'var(--text)' : 'transparent',
                  color: selectedDuration === d ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  {d === 30 ? '30 min' : d === 60 ? '1 hr' : 'Longer'}
                </button>
              ))}
            </div>

            {/* Who for */}
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 8 }}>
              Who for?
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 22 }}>
              {BUSINESSES.map(b => {
                const active = selectedBusiness === b
                const c = BUSINESS_COLORS[b]
                return (
                  <button key={b} onClick={() => saveBusiness(b)} style={{
                    fontFamily: 'Instrument Sans, sans-serif',
                    fontSize: 12, fontWeight: 600,
                    padding: '7px 0', borderRadius: 6, flex: 1, textAlign: 'center',
                    border: `1.5px solid ${active ? c.border : 'var(--line)'}`,
                    background: active ? c.bg : 'transparent',
                    color: c.color,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                    {b}
                  </button>
                )
              })}
            </div>

            {/* Book button */}
            <button onClick={handleBook} style={{
              display: 'block', width: '100%',
              fontFamily: 'Instrument Sans, sans-serif',
              fontSize: 13, fontWeight: 600,
              padding: '13px 16px', border: 'none', borderRadius: 8,
              background: 'var(--text)', color: '#fff',
              cursor: 'pointer', letterSpacing: '-0.2px', transition: 'opacity 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0.8'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
            >
              Save in Calendar →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
