import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { JWT } from 'google-auth-library'
import { toZonedTime } from 'date-fns-tz'
import { availabilityCache } from '../cache'

const TALKING_CALENDAR_ID = (process.env.NEXT_PUBLIC_TALKING_CALENDAR_ID || process.env.TALKING_CALENDAR_ID)!
const BOARD_CALENDAR_ID   = (process.env.NEXT_PUBLIC_BOARD_CALENDAR_ID || process.env.BOARD_CALENDAR_ID)!
const TIMEZONE = process.env.TIMEZONE || 'Pacific/Auckland'

function getAuthClient(): JWT {
  const email = process.env.GOOGLE_CLIENT_EMAIL
  const key   = process.env.GOOGLE_PRIVATE_KEY
  const subject = process.env.GOOGLE_SUBJECT
  if (!email || !key) throw new Error('Missing credentials')
  return new JWT({
    email,
    key: key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
    subject,
  })
}

export async function POST(req: NextRequest) {
  try {
    const { room, start, durationMins, business } = await req.json()

    if (!room || !start || !durationMins || !business) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const calendarId = room === 'talking' ? TALKING_CALENDAR_ID : BOARD_CALENDAR_ID
    const startDate  = new Date(start)
    const endDate    = new Date(startDate.getTime() + durationMins * 60_000)

    const auth     = getAuthClient()
    const calendar = google.calendar({ version: 'v3', auth })

    await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `[${business}]`,
        start: { dateTime: startDate.toISOString(), timeZone: TIMEZONE },
        end:   { dateTime: endDate.toISOString(),   timeZone: TIMEZONE },
      },
    })

    // Invalidate the availability cache for this date so the next poll
    // gets fresh data rather than a 60s stale response.
    const dateStr = toZonedTime(startDate, TIMEZONE).toISOString().slice(0, 10)
    availabilityCache.delete(dateStr)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Book error', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
