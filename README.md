# RoomHub

Meeting room availability for the Hunch studio. Shows today's bookings for the Talking Room and Board Room, fed live from Google Calendar.

## Setup

### 1. Environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

To encode the service account JSON key:
```bash
base64 -i your-key.json | pbcopy
```
Paste the result into `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`.

### 2. Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 3. Deploy to Railway

1. Push to GitHub
2. Create a new Railway project → Deploy from GitHub repo
3. Add all environment variables from `.env.example`
4. Railway will auto-deploy on push to main

## How it works

- Reads availability from Google Calendar via a service account (read-only)
- Bookings open Google Calendar with the room pre-invited as a guest
- Room calendars auto-accept non-conflicting invitations
- Refreshes every 60 seconds + immediately when you switch back to the tab

## Rooms

| Room | Capacity | Calendar ID |
|------|----------|-------------|
| Talking Room | 2–4 people | `c_0c184e...` |
| Board Room | 4+ people | `c_b1b9fc...` |

## Businesses

Baker · Clarity · Hunch · Navigate
