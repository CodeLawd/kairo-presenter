import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import '@fontsource-variable/source-sans-3'
import App from './App'
import { QuitConfirmation } from './components/layout/QuitConfirmation'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// Match the main window's native material before React's first paint.
if (navigator.platform.startsWith('Mac')) {
  document.documentElement.dataset.windowMaterial = 'vibrancy'
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <QuitConfirmation />
    </ErrorBoundary>
  </React.StrictMode>
)
