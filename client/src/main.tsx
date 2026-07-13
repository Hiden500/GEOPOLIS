import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import './i18n'
import App from './App.tsx'
import { PrimitivesShowcase } from './dev/PrimitivesShowcase.tsx'

// Витрина примитивов (Срез 1, docs/plans/12_UI_REDESIGN.md §4) — dev-only,
// вне игрового потока: ?showcase=primitives вместо App.
const isPrimitivesShowcase = new URLSearchParams(window.location.search).get('showcase') === 'primitives'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPrimitivesShowcase ? <PrimitivesShowcase /> : <App />}
  </StrictMode>,
)
