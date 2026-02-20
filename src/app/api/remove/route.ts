import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { JWT } from 'google-auth-library'
import { toZonedTime } from 'date-fns-tz'
import { availabilityCache } from '../cache'

const TALKING_CALENDAR_ID = (process.env.NEXT_PUBLIC_TALKING_CALENDAR_ID || process.env.TALKING_CALENDAR_ID)!
const BOARD_CALENDAR_ID   = (process.env.NEXT_PUBLIC_BOARD_CALENDAR_ID || process.env.BOARD_CALENDAR_ID)!
const TIMEZONE = process.env.TIMEZONE || 'Pacific/Auckland'

function getAuthClient(): JWT {
  const email   = process.env.GOOGLE_CLIENT_EMAIL
  const key     = process.env.GOOGLE_PRIVATE_KEY
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
    const { room, eventId, start } = await req.json()

    if (!room || !eventId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const calendarId = room === 'talking' ? TALKING_CALENDAR_ID : BOARD_CALENDAR_ID
    const auth       = getAuthClient()
    const calendar   = google.calendar({ version: 'v3', auth })

    await calendar.events.delete({ calendarId, eventId })

    // Invalidate the correct date's cache entry.
    // Use the booking's start date if provided, otherwise clear everything.
    if (start) {
      const dateStr = toZonedTime(new Date(start), TIMEZONE).toISOString().slice(0, 10)
      availabilityCache.delete(dateStr)
    } else {
      availabilityCache.clear()
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Remove error', err)
    return NextResponse.json({ error: 'Failed to remove booking' }, { status: 500 })
  }
}
