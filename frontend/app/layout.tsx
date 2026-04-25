import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Akash Notebooks',
  description: 'Run Jupyter notebooks on Akash Network GPU compute',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg text-text font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
