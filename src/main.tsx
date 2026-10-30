import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './ui/App'
import { browserKV } from './data/kv'
import { LocalStorageRepository } from './data/LocalStorageRepository'
import { SyncedRepository } from './data/SyncedRepository'
import type { WorkoutRepository } from './data/WorkoutRepository'

// The shareable preview build has no server behind it, so it stays on-device only.
function createRepository(): WorkoutRepository {
  const kv = browserKV()
  const local = new LocalStorageRepository(kv)
  if (import.meta.env.MODE === 'single') return local
  const synced = new SyncedRepository(local, kv)
  synced.start()
  return synced
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App repo={createRepository()} />
  </StrictMode>,
)
