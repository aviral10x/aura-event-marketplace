import type { Metadata } from 'next'
import { Inter, Space_Grotesk, Playfair_Display, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  style: ['italic', 'normal'],
  variable: '--font-playfair',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'Aura - Event Content Marketplace',
  description: 'The first peer-to-peer marketplace for event content. Upload your photos, download others, earn 50% revenue share.',
  keywords: 'event photos, peer-to-peer marketplace, buy event photos, sell event photos, aura',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${spaceGrotesk.variable} ${playfair.variable} ${jetbrainsMono.variable} font-sans antialiased bg-black text-white min-h-screen flex flex-col`}>
        <div className="bg-noise mix-blend-overlay" aria-hidden="true" />
        {children}
        <Toaster 
          position="top-right"
          toastOptions={{
            style: {
              background: '#18181b',
              color: '#fff',
              border: '1px solid #27272a',
            },
            className: 'dark-toast',
          }}
        />
      </body>
    </html>
  )
}
