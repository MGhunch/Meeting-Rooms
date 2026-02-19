import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { JWT } from 'google-auth-library'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'

const TIMEZONE = process.env.TIMEZONE || 'Pacific/Auckland'
const TALKING_CALENDAR_ID = process.env.TALKING_CALENDAR_ID!
const BOARD_CALENDAR_ID = process.env.BOARD_CALENDAR_ID!
const WINDOW_START = process.env.BOOKING_WINDOW_START || '09:00'
const WINDOW_END = process.env.BOOKING_WINDOW_END || '18:00'

interface BusyBlock {
  start: string
  end: string
  title: string
}

interface RoomAvailability {
  busyBlocks: BusyBlock[]
  freeNow: boolean
  nextAvailable: string | null
  error?: string
}

interface AvailabilityResponse {
  talkingRoom: RoomAvailability
  boardRoom: RoomAvailability
  date: string
}

function getAuthClient(): JWT {
  const base64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
  if (!base64) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 not set')
  const json = JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'))
  return new JWT({
    email: json.client_email,
    key: json.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  })
}

function parseWindowTime(dateStr: string, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const zonedDate = toZonedTime(new Date(dateStr + 'T00:00:00'), TIMEZONE)
  zonedDate.setHours(hours, minutes, 0, 0)
  return fromZonedTime(zonedDate, TIMEZONE)
}

function mergeBlocks(blocks: { start: Date; end: Date; title: string }[]): { start: Date; end: Date; title: string }[] {
  if (blocks.length === 0) return []
  const sorted = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime())
  const merged = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    if (sorted[i].start <= last.end) {
      last.end = new Date(Math.max(last.end.getTime(), sorted[i].end.getTime()))
    } else {
      merged.push(sorted[i])
    }
  }
  return merged
}

async function getRoomAvailability(
  auth: JWT,
  calendarId: string,
  dateStr: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<RoomAvailability> {
  try {
    const calendar = google.calendar({ version: 'v3', auth })
    const res = await calendar.events.list({
      calendarId,
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    })

    const events = res.data.items || []
    const rawBlocks = events
      .filter((e) => e.start?.dateTime && e.end?.dateTime)
      .map((e) => ({
        start: new Date(Math.max(new Date(e.start!.dateTime!).getTime(), windowStart.getTime())),
        end: new Date(Math.min(new Date(e.end!.dateTime!).getTime(), windowEnd.getTime())),
        title: e.summary || 'Booked',
      }))
      .filter((b) => b.start < b.end)

    const merged = mergeBlocks(rawBlocks)
    const now = new Date()

    const busyBlocks: BusyBlock[] = merged.map((b) => ({
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      title: b.title,
    }))

    // freeNow: is the room free at this exact moment (if today)?
    const isToday = dateStr === toZonedTime(now, TIMEZONE).toISOString().slice(0, 10)
    let freeNow = false
    let nextAvailable: string | null = null

    if (isToday && now >= windowStart && now < windowEnd) {
      freeNow = !merged.some((b) => b.start <= now && b.end > now)
      if (!freeNow) {
        // Find when current block ends
        const currentBlock = merged.find((b) => b.start <= now && b.end > now)
        if (currentBlock) nextAvailable = currentBlock.end.toISOString()
      }
    }

    return { busyBlocks, freeNow, nextAvailable }
  } catch (err) {
    console.error('Calendar error for', calendarId, err)
    return {
      busyBlocks: [],
      freeNow: false,
      nextAvailable: null,
      error: 'Could not load calendar data',
    }
  }
}

// Simple in-memory cache
const cache = new Map<string, { data: AvailabilityResponse; ts: number }>()
const CACHE_TTL = 60_000

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateParam = searchParams.get('date')

  // Default to today in NZ time
  const nowNZ = toZonedTime(new Date(), TIMEZONE)
  const dateStr = dateParam || nowNZ.toISOString().slice(0, 10)

  const cacheKey = dateStr
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.data)
  }

  const windowStart = parseWindowTime(dateStr, WINDOW_START)
  const windowEnd = parseWindowTime(dateStr, WINDOW_END)

  let auth: JWT
  try {
    auth = getAuthClient()
  } catch (err) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const [talkingRoom, boardRoom] = await Promise.all([
    getRoomAvailability(auth, TALKING_CALENDAR_ID, dateStr, windowStart, windowEnd),
    getRoomAvailability(auth, BOARD_CALENDAR_ID, dateStr, windowStart, windowEnd),
  ])

  const data: AvailabilityResponse = { talkingRoom, boardRoom, date: dateStr }
  cache.set(cacheKey, { data, ts: Date.now() })

  return NextResponse.json(data)
}
