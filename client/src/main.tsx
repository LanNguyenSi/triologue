import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.tsx'
import './index.css'

Sentry.init({
  dsn: 'https://25d6d8ed2094540af62181e002ad0dad@o4510914290384896.ingest.de.sentry.io/4510914295955536',
  environment: import.meta.env.MODE ?? 'production',
  // Only enable in production (skip in local dev to avoid noise)
  enabled: import.meta.env.MODE !== 'development',
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
