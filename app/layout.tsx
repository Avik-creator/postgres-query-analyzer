import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans, Lora, IBM_Plex_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta' })
const lora = Lora({ subsets: ['latin'], variable: '--font-lora' })
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
})

const SITE_URL = 'https://pganalyzer.avikmukherjee.com'
const TITLE = 'pgxray — Postgres Query Analyzer'
const DESCRIPTION =
  'Paste SQL, visualize the execution plan, and get index suggestions and AI-powered rewrites for your Postgres queries.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  generator: 'v0.app',
  applicationName: 'pgxray',
  keywords: [
    'Postgres',
    'PostgreSQL',
    'query analyzer',
    'EXPLAIN ANALYZE',
    'execution plan',
    'index suggestions',
    'SQL performance',
    'database tuning',
  ],
  authors: [{ name: 'Avik Mukherjee' }],
  alternates: {
    canonical: SITE_URL,
  },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: '/apple-icon.png',
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'pgxray',
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'pgxray — Postgres Query Analyzer',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og-image.png'],
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#000000',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`dark bg-background ${jakarta.variable} ${lora.variable} ${ibmPlexMono.variable}`}
    >
      <body className="font-sans antialiased">
        <TooltipProvider delay={150}>{children}</TooltipProvider>
        <Toaster position="top-center" />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
