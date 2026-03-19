export const metadata = {
  title: '留学招生 CRM',
  description: 'Supabase 版 CRM',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>{children}</body>
    </html>
  )
}
