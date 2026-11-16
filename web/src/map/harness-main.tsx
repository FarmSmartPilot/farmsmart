// Dev-only entry for MapHarness: open http://localhost:5173/src/map/harness.html while `npm run dev` runs.
import { createRoot } from 'react-dom/client'
import '../design'
import { MapHarness } from './MapHarness'

createRoot(document.getElementById('root')!).render(<MapHarness />)
