import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.tsx'
import './index.css'

const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
const sentryEnabled = import.meta.env.MODE !== 'development' && Boolean(sentryDsn)

if (sentryEnabled) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE ?? 'production',
    enabled: true,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Mask all text + block all images for privacy (GDPR)
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // Performance: capture 10% of transactions
    tracesSampleRate: 0.1,
    // Session Replay: 5% normal sessions, 100% on error
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
