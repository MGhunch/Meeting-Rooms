'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { fromZonedTime } from 'date-fns-tz'

const NZ_TZ = 'Pacific/Auckland'

// ─── Types ────────────────────────────────────────────────────────────────────

type Business = 'Baker' | 'Clarity' | 'Hunch' | 'Navigate'
type Room = 'talking' | 'board'
type Duration = 30 | 60 | 180 | 240 | 480
type ModalState = 'booking' | 'confirmed'

interface BusyBlock { start: string; end: string; title: string; eventId?: string }
interface RoomData { busyBlocks: BusyBlock[]; freeNow: boolean; nextAvailable: string | null; error?: string }
interface AvailabilityData { talkingRoom: RoomData; boardRoom: RoomData; date: string }
interface BookingTarget { room: Room; slotStart: Date }
interface ViewTarget { room: Room; block: BusyBlock }

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

const TALKING_CALENDAR_ID = process.env.NEXT_PUBLIC_TALKING_CALENDAR_ID!
const BOARD_CALENDAR_ID   = process.env.NEXT_PUBLIC_BOARD_CALENDAR_ID!
const TALKING_VIEW_URL    = process.env.NEXT_PUBLIC_TALKING_VIEW_URL!
const BOARD_VIEW_URL      = process.env.NEXT_PUBLIC_BOARD_VIEW_URL!

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

function durationConflicts(dateStr: string, slotStart: Date, durationMins: number, blocks: BusyBlock[]): BusyBlock | null {
  const start = durationMins === 480 ? fromZonedTime(`${dateStr}T09:00:00`, NZ_TZ) : slotStart
  const end   = new Date(start.getTime() + durationMins * 60_000)
  for (const b of blocks) {
    if (new Date(b.start) < end && new Date(b.end) > start) return b
  }
  return null
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
  const [showMoreDropdown, setShowMoreDropdown]  = useState(false)
  const [booking_error, setBookingError]        = useState<string | null>(null)
  const [viewing, setViewing]                   = useState<ViewTarget | null>(null)
  const [removing, setRemoving]                 = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const moreRef   = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setShowMoreDropdown(false)
    }
    if (showMoreDropdown) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMoreDropdown])

  const today   = todayNZ()
  const canBack = currentDate > today
  const canFwd  = true

  const openModal = (room: Room, slotIndex: number) => {
    setSelectedDuration(30)
    setBookingError(null)
    setIsFlipped(false)
    setModalState('booking')
    setShowMoreDropdown(false)
    setBooking({ room, slotStart: slotIndexToDate(currentDate, slotIndex) })
  }

  const handleBookNow = async () => {
    if (!booking) return
    setBookingError(null)

    // Front-end conflict check using already-loaded busy blocks
    const rd = booking.room === 'talking' ? data?.talkingRoom : data?.boardRoom
    const blocks = rd?.busyBlocks || []
    const conflict = durationConflicts(currentDate, booking.slotStart, selectedDuration, blocks)
    if (conflict) {
      const conflictStart = formatTime12(new Date(conflict.start))
      const roomName_ = booking.room === 'talking' ? 'Talking Room' : 'Board Room'
      setBookingError(`${roomName_} is booked from ${conflictStart}.`)
      return
    }

    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: booking.room,
          start: selectedDuration === 480
            ? new Date(booking.slotStart.getFullYear(), booking.slotStart.getMonth(), booking.slotStart.getDate(), 9, 0, 0).toISOString()
            : booking.slotStart.toISOString(),
          durationMins: selectedDuration,
          business: selectedBusiness,
        }),
      })
      if (!res.ok) throw new Error('Booking failed')
      // Optimistic update — add busy block instantly without waiting for API
      const actualStart = selectedDuration === 480
        ? fromZonedTime(`${currentDate}T09:00:00`, NZ_TZ)
        : booking.slotStart
      const endTime = new Date(actualStart.getTime() + (selectedDuration as number) * 60000)
      const newBlock: BusyBlock = {
        start: actualStart.toISOString(),
        end: endTime.toISOString(),
        title: selectedBusiness,
      }
      setData(prev => {
        if (!prev) return prev
        const key = booking.room === 'talking' ? 'talkingRoom' : 'boardRoom'
        return { ...prev, [key]: { ...prev[key], busyBlocks: [...prev[key].busyBlocks, newBlock] } }
      })
      setIsFlipped(true)
      setTimeout(() => setModalState('confirmed'), 220)
    } catch {
      setBookingError('Something went wrong. Please try again.')
    }
  }

  const handleICS = () => {
    if (!booking) return
    downloadICS(booking.room, booking.slotStart, selectedDuration as number, selectedBusiness, currentDate)
  }

  const handleRemove = async () => {
    if (!viewing) return
    setRemoving(true)
    try {
      const res = await fetch('/api/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: viewing.room, eventId: viewing.block.eventId, start: viewing.block.start }),
      })
      if (!res.ok) throw new Error('Remove failed')
      // Optimistic update — remove block from state immediately
      setData(prev => {
        if (!prev) return prev
        const key = viewing.room === 'talking' ? 'talkingRoom' : 'boardRoom'
        return { ...prev, [key]: { ...prev[key], busyBlocks: prev[key].busyBlocks.filter(b => b.start !== viewing.block.start) } }
      })
      setViewing(null)
    } catch {
      // silently fail — block will re-appear on next poll
      setViewing(null)
    } finally {
      setRemoving(false)
    }
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
      const isLast     = false // all slots are bookable; 5:30pm + 30min ends at 6pm which is within window

      let label: React.ReactNode = null
      if (isBusy && busyBlock && !seen.has(busyBlock.start)) {
        seen.add(busyBlock.start)
        const h   = blockHeightSlots(currentDate, i, busyBlock) * 20 - 4
        const biz = extractBusiness(busyBlock.title)
        const c   = BUSINESS_BLOCK_COLORS[biz] || BUSINESS_BLOCK_COLORS['Booked']
        label = (
          <div
            onClick={(e) => { e.stopPropagation(); setViewing({ room, block: busyBlock }) }}
            style={{
              position: 'absolute', left: 3, right: 3, top: 2, height: h,
              borderRadius: 4, background: c.bg,
              borderLeft: `2.5px solid ${c.color}`,
              zIndex: 2, cursor: 'pointer',
              padding: '3px 6px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-start',
            }}>
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: c.color, letterSpacing: '0.4px',
              textTransform: 'uppercase', lineHeight: 1.2,
            }}>
              {biz !== 'Booked' ? biz : ''}
            </span>
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
          paddingTop: 1, paddingRight: 6, justifyContent: 'flex-end',
          borderTop: i % 2 === 0 ? '1px solid var(--line)' : 'none',
          borderBottom: isMidday(i) ? '1px solid var(--line)' : '1px solid var(--line-light)',
          background: '#fff',
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

  const optBtn = (active: boolean, extra?: React.CSSProperties, conflicted?: boolean): React.CSSProperties => ({
    fontFamily: 'Instrument Sans, sans-serif', fontSize: 12, fontWeight: 600,
    padding: '7px 0', borderRadius: 6, flex: 1, textAlign: 'center' as const,
    border: `1.5px solid ${active ? 'var(--text)' : conflicted ? 'var(--line)' : 'var(--line)'}`,
    background: active ? 'var(--text)' : 'transparent',
    color: active ? '#fff' : conflicted ? 'var(--text-light)' : 'var(--text-muted)',
    cursor: conflicted ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
    opacity: conflicted ? 0.45 : 1, ...extra,
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
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 24px 60px', background: 'var(--bg)' }}>

      {/* ── Header ── */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>
          Meeting Rooms
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <button style={navBtn(canBack)} onClick={() => canBack && setCurrentDate(addDays(currentDate, -1))}>
            <svg width="18" height="18" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1L3 5L7 9"/></svg>
          </button>
          <div style={{ position: 'relative', flex: 1 }}>
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
        Just click a start time to book. Or jump in if the room's free.
      </div>

      {/* ── White card ── */}
      <div style={{
        background: '#fff', borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)',
        overflow: 'hidden', marginBottom: 24,
      }}>
        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr 1fr', borderBottom: '1.5px solid var(--text)' }}>
          <div style={{ background: '#fff' }} />
          <div style={{ padding: '12px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#fff' }}>
            <TalkingIcon />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.3px' }}>Talking Room</span>
          </div>
          <div style={{ padding: '12px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#fff' }}>
            <BoardIcon />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.3px' }}>Board Room</span>
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr 1fr' }}>
            <div style={{ background: '#fff' }}>{renderTimeLabels()}</div>
            <div style={{ position: 'relative', flex: 1 }}>
              {data?.talkingRoom.error
                ? <div style={{ padding: '20px 10px', fontSize: 11, color: 'var(--text-muted)' }}>Could not load calendar</div>
                : renderSlots('talking')}
            </div>
            <div style={{ position: 'relative', flex: 1 }}>
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
        Powered by Google Calendar. Re-syncs every minute.
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
              position: 'relative', width: '100%', height: 360,
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
                <div style={{ display: 'flex', gap: 6, marginBottom: 18, position: 'relative' }}>
                  {([30, 60] as Duration[]).map(d => {
                    const rd_ = booking.room === 'talking' ? data?.talkingRoom : data?.boardRoom
                    const conflicted = !!durationConflicts(currentDate, booking.slotStart, d, rd_?.busyBlocks || [])
                    return (
                      <button key={String(d)} onClick={() => { if (!conflicted) { setSelectedDuration(d); setBookingError(null) } }} style={optBtn(selectedDuration === d, undefined, conflicted)}>
                        {d === 30 ? '30 min' : '1 hr'}
                      </button>
                    )
                  })}
                  <div style={{ position: 'relative', flex: 1 }} ref={moreRef}>
                    {(() => {
                      const rd_ = booking.room === 'talking' ? data?.talkingRoom : data?.boardRoom
                      const moreConflicted = !!durationConflicts(currentDate, booking.slotStart, selectedDuration, rd_?.busyBlocks || []) && [180,240,480].includes(selectedDuration)
                      return (
                        <button
                          onClick={() => setShowMoreDropdown(p => !p)}
                          style={optBtn([180,240,480].includes(selectedDuration as number), { width: '100%' }, moreConflicted)}>
                          {[180,240,480].includes(selectedDuration as number)
                            ? (selectedDuration === 180 ? '3 hr' : selectedDuration === 240 ? '4 hr' : 'All day')
                            : 'More ▾'}
                        </button>
                      )
                    })()}
                    {showMoreDropdown && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, marginTop: 4,
                        background: '#fff', border: '1.5px solid var(--line)', borderRadius: 8,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, overflow: 'hidden', minWidth: 80,
                      }}>
                        {([180, 240, 480] as number[]).map(mins => {
                          const rd_ = booking.room === 'talking' ? data?.talkingRoom : data?.boardRoom
                          const conflicted = !!durationConflicts(currentDate, booking.slotStart, mins, rd_?.busyBlocks || [])
                          return (
                            <button key={mins} onClick={() => { if (!conflicted) { setSelectedDuration(mins as Duration); setBookingError(null) } setShowMoreDropdown(false) }} style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              padding: '8px 12px', border: 'none', background: selectedDuration === mins ? '#f8f6f3' : 'transparent',
                              fontFamily: 'Instrument Sans, sans-serif', fontSize: 12, fontWeight: 600,
                              cursor: conflicted ? 'not-allowed' : 'pointer', color: conflicted ? 'var(--text-light)' : 'var(--text)',
                              opacity: conflicted ? 0.45 : 1,
                            }}>
                              {mins === 180 ? '3 hours' : mins === 240 ? '4 hours' : 'All day'}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
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
                  Book now
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
                  {[`${selectedDuration === 30 ? '30 minutes' : selectedDuration === 60 ? '1 hour' : selectedDuration === 180 ? '3 hours' : selectedDuration === 240 ? '4 hours' : selectedDuration === 480 ? 'All day' : ''}`, `${selectedBusiness}`].map((line, i) => (
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

      {/* ── View / Remove modal ── */}
      {viewing && (() => {
        const biz       = extractBusiness(viewing.block.title)
        const c         = BUSINESS_COLORS[biz as Business] || { color: '#999', bg: 'rgba(120,120,120,0.1)', border: '#999' }
        const start     = new Date(viewing.block.start)
        const end       = new Date(viewing.block.end)
        const durMins   = Math.round((end.getTime() - start.getTime()) / 60_000)
        const durLabel  = durMins === 30 ? '30 minutes' : durMins === 60 ? '1 hour' : durMins === 180 ? '3 hours' : durMins === 240 ? '4 hours' : durMins >= 480 ? 'All day' : `${durMins} min`
        const viewRoom  = viewing.room === 'talking' ? 'Talking Room' : 'Board Room'
        const timeLabel = formatTime12(start)

        return (
          <div
            onClick={() => setViewing(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div style={{ width: 300 }} onClick={e => e.stopPropagation()}>
              <div style={{
                background: '#fff', borderRadius: 12,
                boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
                padding: '28px 24px 24px', position: 'relative',
              }}>
                <button onClick={() => setViewing(null)} style={{
                  position: 'absolute', top: 14, right: 14, background: 'none', border: 'none',
                  cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 4, display: 'flex',
                }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
                </button>

                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: 4 }}>{viewRoom.toUpperCase()}</div>
                <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-1px', color: 'var(--text)', marginBottom: 2 }}>{timeLabel}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>{formatDateHeading(currentDate)}</div>
                <div style={{ borderTop: '1px solid var(--line)', margin: '0 -24px 20px' }} />

                <div style={{ marginBottom: 24 }}>
                  {[durLabel, biz !== 'Booked' ? biz : 'Unknown'].map((line, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, padding: '1px 0' }}>
                      <span style={{ color: c.color }}>●</span>
                      <span style={{ color: 'var(--text)' }}>{line}</span>
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: '1px solid var(--line)', margin: '0 -24px 20px' }} />

                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setViewing(null)} style={{
                    flex: 1, fontFamily: 'Instrument Sans, sans-serif',
                    fontSize: 12, fontWeight: 600, padding: '9px 0', borderRadius: 6,
                    border: '1.5px solid var(--line)', background: 'transparent', color: 'var(--text-muted)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                    Edit
                  </button>
                  <button onClick={handleRemove} disabled={removing} style={{
                    flex: 2, fontFamily: 'Instrument Sans, sans-serif',
                    fontSize: 13, fontWeight: 600, padding: '9px 0', borderRadius: 6,
                    border: 'none', background: removing ? 'var(--text-muted)' : 'var(--text)', color: '#fff',
                    cursor: removing ? 'default' : 'pointer', transition: 'opacity 0.15s',
                  }}>
                    {removing ? 'Removing…' : 'Remove'}
                  </button>
                </div>

              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
