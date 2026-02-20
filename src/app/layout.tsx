import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RoomHub',
  description: 'Meeting room availability for Hunch studio',
  icons: { icon: '/favicon.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
