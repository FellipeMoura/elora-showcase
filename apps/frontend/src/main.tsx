import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { registerServiceWorker } from '@/lib/pushNotifications'

// Service worker só de notificações push (sem cache) — ver public/sw.js.
void registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultMode="system">
      <App />
    </ThemeProvider>
  </StrictMode>,
)
