'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { fromZonedTime } from 'date-fns-tz'

const NZ_TZ = 'Pacific/Auckland'

// ─── Types ────────────────────────────────────────────────────────────────────

type Business = 'Baker' | 'Clarity' | 'Hunch' | 'Navigate'
type Room = 'talking' | 'board'
type Duration = 30 | 60 | 'longer'
type ModalState = 'booking' | 'confirmed'

interface BusyBlock { start: string; end: string; title: string }
interface RoomData { busyBlocks: BusyBlock[]; freeNow: boolean; nextAvailable: string | null; error?: string }
interface AvailabilityData { talkingRoom: RoomData; boardRoom: RoomData; date: string }
interface BookingTarget { room: Room; slotStart: Date }

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
  return new Date().toLocaleDateString('en-CA', { timeZone: NZ_TZ })
}

function addDays(dateStr: string, n: number): string {
  const [y, m, day] = dateStr.split('-').map(Number)
  const d = new Date(y, m - 1, day + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDateHeading(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const parts = d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })
  return parts.replace(',', '')
}

function formatTime12(date: Date): string {
  return date.toLocaleTimeString('en-NZ', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: NZ_TZ,
  }).replace(':00', '').toLowerCase()
}

function slotIndexToDate(dateStr: string, slotIndex: number): Date {
  const totalMins = SLOT_START_HOUR * 60 + slotIndex * 30
  const h = Math.floor(totalMins / 60), m = totalMins % 60
  const localStr = `${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`
  return fromZonedTime(localStr, NZ_TZ)
}

function slotLabel(i: number): { label: string; isHour: boolean } {
  const totalMins = SLOT_START_HOUR * 60 + i * 30
  const h = Math.floor(totalMins / 60), m = totalMins % 60
  const h12 = h > 12 ? h - 12 : h
  return { label: m === 0 ? `${h12}.00` : '', isHour: m === 0 }
}

function isMidday(i: number): boolean { return i === 7 }

function isSlotBusy(dateStr: string, i: number, blocks: BusyBlock[]): BusyBlock | null {
  const s = slotIndexToDate(dateStr, i), e = slotIndexToDate(dateStr, i + 1)
  for (const b of blocks) {
    if (new Date(b.start) < e && new Date(b.end) > s) return b
  }
  return null
}

function blockHeightSlots(dateStr: string, i: number, block: BusyBlock): number {
  const slotStart = slotIndexToDate(dateStr, i)
  const bs = new Date(block.start), be = new Date(block.end)
  const eff = slotStart > bs ? slotStart : bs
  return Math.max(1, Math.ceil((be.getTime() - eff.getTime()) / (30 * 60 * 1000)))
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
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const params = new URLSearchParams({
    action: 'TEMPLATE', text: `[${business}]`,
    dates: `${fmt(start)}/${fmt(end)}`, add: calendarId, details: 'Booked via RoomHub',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function downloadICS(room: Room, start: Date, durationMins: number, business: Business, dateStr: string) {
  const end = new Date(start.getTime() + durationMins * 60_000)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const roomName = room === 'talking' ? 'Talking Room' : 'Board Room'
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RoomHub//EN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:[${business}] ${roomName}`,
    `DESCRIPTION:Booked via RoomHub`,
    `LOCATION:${roomName}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  const blob = new Blob([ics], { type: 'text/calendar' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `${roomName.replace(' ', '-')}-${dateStr}.ics`
  a.click()
  URL.revokeObjectURL(url)
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function RoomHub() {
  const [currentDate, setCurrentDate]           = useState<string>(todayNZ())
  const [data, setData]                         = useState<AvailabilityData | null>(null)
  const [loading, setLoading]                   = useState(true)
  const [booking, setBooking]                   = useState<BookingTarget | null>(null)
  const [modalState, setModalState]             = useState<ModalState>('booking')
  const [isFlipped, setIsFlipped]               = useState(false)
  const [selectedBusiness, setSelectedBusiness] = useState<Business>('Hunch')
  const [selectedDuration, setSelectedDuration] = useState<Duration>(30)
  const [showPicker, setShowPicker]             = useState(false)
  const [booking_error, setBookingError]        = useState<string | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)

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
      const res  = await fetch(`/api/availability?date=${date}`)
      const json = await res.json()
      setData(json)
    } catch (e) { console.error(e) } finally { setLoading(false) }
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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false)
    }
    if (showPicker) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  const today   = todayNZ()
  const canBack = currentDate > today
  const canFwd  = true

  const openModal = (room: Room, slotIndex: number) => {
    setSelectedDuration(30)
    setBookingError(null)
    setIsFlipped(false)
    setModalState('booking')
    setBooking({ room, slotStart: slotIndexToDate(currentDate, slotIndex) })
  }

  const handleBookNow = async () => {
    if (!booking) return
    if (selectedDuration === 'longer') {
      window.open(buildGCalUrl(booking.room, booking.slotStart, 120, selectedBusiness), '_blank')
      setBooking(null)
      return
    }
    setBookingError(null)
    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: booking.room,
          start: booking.slotStart.toISOString(),
          durationMins: selectedDuration,
          business: selectedBusiness,
        }),
      })
      if (!res.ok) throw new Error('Booking failed')
      setIsFlipped(true)
      setTimeout(() => setModalState('confirmed'), 220)
      fetchData(currentDate)
    } catch {
      setBookingError('Something went wrong. Please try again.')
    }
  }

  const handleICS = () => {
    if (!booking || selectedDuration === 'longer') return
    downloadICS(booking.room, booking.slotStart, selectedDuration as number, selectedBusiness, currentDate)
  }

  const renderSlots = (room: Room) => {
    const rd = room === 'talking' ? data?.talkingRoom : data?.boardRoom
    const blocks = rd?.busyBlocks || []
    const tint   = room === 'talking' ? 'var(--talk-tint)' : 'var(--board-tint)'
    const hover  = room === 'talking' ? 'var(--talk-hover)' : 'var(--board-hover)'
    const seen   = new Set<string>()
    const out: React.ReactNode[] = []

    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const busyBlock  = isSlotBusy(currentDate, i, blocks)
      const isBusy     = !!busyBlock
      const isHour     = i % 2 === 0
      const isMiddaySlot = isMidday(i)
      const isLast     = i === TOTAL_SLOTS - 1

      let label: React.ReactNode = null
      if (isBusy && busyBlock && !seen.has(busyBlock.start)) {
        seen.add(busyBlock.start)
        const h   = blockHeightSlots(currentDate, i, busyBlock) * 20 - 4
        const biz = extractBusiness(busyBlock.title)
        const c   = BUSINESS_BLOCK_COLORS[biz] || BUSINESS_BLOCK_COLORS['Booked']
        label = (
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

      out.push(
        <div key={`${room}-${i}`}
          onClick={() => !isBusy && !isLast && openModal(room, i)}
          style={{
            height: 20, position: 'relative', background: tint,
            borderTop: isHour ? '1px solid var(--line)' : 'none',
            borderBottom: isMiddaySlot ? '1px solid var(--line)' : isLast ? 'none' : '1px solid var(--line-light)',
            cursor: isBusy || isLast ? 'default' : 'pointer', transition: 'background 0.1s',
          }}
          onMouseEnter={e => { if (!isBusy && !isLast) (e.currentTarget as HTMLDivElement).style.background = hover }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = tint }}
        >
          {label}
        </div>
      )
    }
    return out
  }

  const renderTimeLabels = () => {
    const out: React.ReactNode[] = []
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const { label, isHour } = slotLabel(i)
      out.push(
        <div key={`t-${i}`} style={{
          fontSize: isHour ? 11 : 10, color: isHour ? 'var(--text-muted)' : 'var(--text-light)',
          fontWeight: isHour ? 500 : 400, height: 20, display: 'flex', alignItems: 'flex-start',
          paddingTop: 1, paddingLeft: 2,
          borderTop: i % 2 === 0 ? '1px solid var(--line)' : 'none',
          borderBottom: isMidday(i) ? '1px solid var(--line)' : '1px solid var(--line-light)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {label}
        </div>
      )
    }
    return out
  }

  const roomName = booking?.room === 'talking' ? 'Talking Room' : 'Board Room'
  const timeStr  = booking ? formatTime12(booking.slotStart) : ''

  const navBtn = (on: boolean): React.CSSProperties => ({
    background: 'none', border: 'none', color: 'var(--text-muted)',
    cursor: on ? 'pointer' : 'default', padding: '4px 8px', borderRadius: 4,
    opacity: on ? 1 : 0.2, display: 'flex', alignItems: 'center', transition: 'all 0.15s',
  })

  const optBtn = (active: boolean, extra?: React.CSSProperties): React.CSSProperties => ({
    fontFamily: 'Instrument Sans, sans-serif', fontSize: 12, fontWeight: 600,
    padding: '7px 0', borderRadius: 6, flex: 1, textAlign: 'center' as const,
    border: `1.5px solid ${active ? 'var(--text)' : 'var(--line)'}`,
    background: active ? 'var(--text)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    cursor: 'pointer', transition: 'all 0.15s', ...extra,
  })

  const bizBtn = (b: Business): React.CSSProperties => {
    const active = selectedBusiness === b
    const c = BUSINESS_COLORS[b]
    return {
      fontFamily: 'Instrument Sans, sans-serif', fontSize: 12, fontWeight: 600,
      padding: '7px 0', borderRadius: 6, flex: 1, textAlign: 'center' as const,
      border: `1.5px solid ${active ? c.border : 'var(--line)'}`,
      background: active ? c.bg : 'transparent', color: c.color,
      cursor: 'pointer', transition: 'all 0.15s',
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '40px 24px 60px', background: 'var(--bg)' }}>

      {/* ── Header ── */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>
          Meeting Rooms
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <button style={navBtn(canBack)} onClick={() => canBack && setCurrentDate(addDays(currentDate, -1))}>
            <svg width="18" height="18" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1L3 5L7 9"/></svg>
          </button>
          <div style={{ position: 'relative' }}>
            <div onClick={() => setShowPicker(p => !p)} style={{
              fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px', minWidth: 240, textAlign: 'center',
              cursor: 'pointer', textDecoration: showPicker ? 'underline' : 'none',
              textUnderlineOffset: 3, textDecorationColor: 'var(--line)',
            }}>
              {formatDateHeading(currentDate)}
            </div>
            {showPicker && (
              <div ref={pickerRef} style={{
                position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                marginTop: 8, zIndex: 20, background: '#fff', borderRadius: 10,
                boxShadow: '0 4px 24px rgba(0,0,0,0.10)', border: '1px solid var(--line)', padding: 8,
              }}>
                <style>{`.rdp-root { --rdp-accent-color: #1a1a1a; --rdp-accent-background-color: rgba(26,26,26,0.08); --rdp-day-height: 36px; --rdp-day-width: 36px; --rdp-day_button-border-radius: 6px; font-family: 'Instrument Sans', sans-serif; font-size: 13px; } .rdp-month_caption { font-size: 13px; font-weight: 600; }`}</style>
                <DayPicker
                  mode="single"
                  selected={new Date(currentDate + 'T00:00:00')}
                  onSelect={(day) => {
                    if (day) {
                      const y = day.getFullYear(), m = String(day.getMonth() + 1).padStart(2,'0'), d = String(day.getDate()).padStart(2,'0')
                      setCurrentDate(`${y}-${m}-${d}`)
                      setShowPicker(false)
                    }
                  }}
                  disabled={[{ before: new Date(today + 'T00:00:00') }]}
                />
              </div>
            )}
          </div>
          <button style={navBtn(canFwd)} onClick={() => setCurrentDate(addDays(currentDate, 1))}>
            <svg width="18" height="18" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 1L7 5L3 9"/></svg>
          </button>
        </div>
      </div>

      {/* ── Hint ── */}
      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, letterSpacing: '0.1px' }}>
        Click a start time to book. Or just jump in if the room is free.
      </div>

      {/* ── White card ── */}
      <div style={{
        background: '#fff', borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)',
        overflow: 'hidden', marginBottom: 24,
      }}>
        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr 1fr', borderBottom: '1.5px solid var(--text)' }}>
          <div />
          <div style={{ padding: '12px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'var(--talk-tint)' }}>
            <TalkingIcon />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.3px' }}>Talking Room</span>
          </div>
          <div style={{ padding: '12px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'var(--board-tint)' }}>
            <BoardIcon />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.3px' }}>Board Room</span>
          </div>
        </div>

        {/* Grid */}
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

        {/* Footer links inside card */}
        <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr 1fr' }}>
          <div />
          {[TALKING_VIEW_URL, BOARD_VIEW_URL].map((url, i) => (
            <div key={i} style={{ padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <a href={url} target="_blank" rel="noopener noreferrer" style={{
                fontFamily: 'Instrument Sans, sans-serif', fontSize: 10, fontWeight: 500,
                color: 'var(--text-muted)', background: 'none', border: '1px solid var(--line)',
                borderRadius: 3, padding: '4px 10px', letterSpacing: '0.2px', textDecoration: 'none',
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
      </div>

      {/* ── Page footer ── */}
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-light)', letterSpacing: '0.1px' }}>
        This calendar is view only. You&apos;ll go through to Google Calendar to book.
      </div>

      {/* ── Modal ── */}
      {booking && (
        <div
          onClick={() => setBooking(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {/* Flip container */}
          <div style={{ width: 300, perspective: 800 }} onClick={e => e.stopPropagation()}>
            <div style={{
              position: 'relative', width: '100%', height: 420,
              transformStyle: 'preserve-3d',
              transition: 'transform 0.45s cubic-bezier(0.4,0,0.2,1)',
              transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            }}>

              {/* FRONT */}
              <div style={{
                position: 'absolute', inset: 0,
                background: '#fff', borderRadius: 12,
                boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
                backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
                padding: '28px 24px 24px',
              }}>
                <button onClick={() => setBooking(null)} style={{
                  position: 'absolute', top: 14, right: 14, background: 'none', border: 'none',
                  cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 4, display: 'flex',
                }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
                </button>

                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 4 }}>{roomName.toUpperCase()}</div>
                <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-1px', color: 'var(--text)', marginBottom: 2 }}>{timeStr}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>{formatDateHeading(currentDate)}</div>
                <div style={{ borderTop: '1px solid var(--line)', margin: '0 -24px 20px' }} />

                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 8 }}>How long?</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
                  {([30, 60, 'longer'] as Duration[]).map(d => (
                    <button key={String(d)} onClick={() => setSelectedDuration(d)} style={optBtn(selectedDuration === d)}>
                      {d === 30 ? '30 min' : d === 60 ? '1 hr' : 'Longer'}
                    </button>
                  ))}
                </div>

                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 8 }}>Who for?</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
                  {BUSINESSES.map(b => (
                    <button key={b} onClick={() => saveBusiness(b)} style={bizBtn(b)}>{b}</button>
                  ))}
                </div>

                {booking_error && <div style={{ fontSize: 11, color: '#d94040', marginBottom: 8, textAlign: 'center' }}>{booking_error}</div>}

                <button onClick={handleBookNow} style={{
                  display: 'block', width: '100%', fontFamily: 'Instrument Sans, sans-serif',
                  fontSize: 13, fontWeight: 600, padding: '13px 16px', border: 'none', borderRadius: 8,
                  background: 'var(--text)', color: '#fff', cursor: 'pointer', transition: 'opacity 0.15s',
                }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0.8'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
                >
                  {selectedDuration === 'longer' ? 'Book in Google Calendar →' : 'Book now'}
                </button>
              </div>

              {/* BACK */}
              <div style={{
                position: 'absolute', inset: 0,
                background: '#fff', borderRadius: 12,
                boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
                backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
                padding: '28px 24px 24px',
              }}>
                <button onClick={() => setBooking(null)} style={{
                  position: 'absolute', top: 14, right: 14, background: 'none', border: 'none',
                  cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 4, display: 'flex',
                }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
                </button>

                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 4 }}>{roomName.toUpperCase()}</div>
                <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-1px', color: 'var(--text)', marginBottom: 2 }}>{timeStr}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>{formatDateHeading(currentDate)}</div>
                <div style={{ borderTop: '1px solid var(--line)', margin: '0 -24px 20px' }} />

                <div style={{ marginBottom: 20 }}>
                  {[`${selectedDuration === 30 ? '30 minutes' : selectedDuration === 60 ? '1 hour' : ''}`, `By ${selectedBusiness}`].map((line, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text)', padding: '1px 0' }}>
                      <span style={{ color: '#4a9a5e' }}>✓</span> {line}
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: '1px solid var(--line)', margin: '0 -24px 20px' }} />

                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 8 }}>Want a reminder?</div>
                <button onClick={handleICS} style={{
                  display: 'block', width: '100%', fontFamily: 'Instrument Sans, sans-serif',
                  fontSize: 12, fontWeight: 600, padding: '9px 0', borderRadius: 6,
                  border: '1.5px solid var(--line)', background: 'transparent', color: 'var(--text)',
                  cursor: 'pointer', marginBottom: 8, transition: 'all 0.15s',
                }}>
                  Save to my calendar
                </button>
                <button onClick={() => setBooking(null)} style={{
                  display: 'block', width: '100%', fontFamily: 'Instrument Sans, sans-serif',
                  fontSize: 13, fontWeight: 600, padding: '13px 0', borderRadius: 8,
                  border: 'none', background: 'var(--text)', color: '#fff',
                  cursor: 'pointer', transition: 'opacity 0.15s',
                }}>
                  Done
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  )
}
