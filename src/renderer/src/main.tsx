import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import '@fontsource-variable/source-sans-3'
import App from './App'
import { QuitConfirmation } from './components/layout/QuitConfirmation'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <QuitConfirmation />
    </ErrorBoundary>
  </React.StrictMode>
)
