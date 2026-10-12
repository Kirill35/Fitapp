import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './ui/App'
import { LocalStorageRepository } from './data/LocalStorageRepository'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App repo={new LocalStorageRepository()} />
  </StrictMode>,
)
