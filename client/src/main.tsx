import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import './i18n'
import App from './App.tsx'
import { PrimitivesShowcase } from './dev/PrimitivesShowcase.tsx'
import { SystemShowcase } from './dev/SystemShowcase.tsx'

// Витрины — dev-only, вне игрового потока.
//   ?showcase=ui         — дизайн-система пересборки интерфейса (актуальная);
//   ?showcase=primitives — витрина отменённого слоя primitives/, до его удаления.
const showcase = new URLSearchParams(window.location.search).get('showcase')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showcase === 'ui' ? (
      <SystemShowcase />
    ) : showcase === 'primitives' ? (
      <PrimitivesShowcase />
    ) : (
      <App />
    )}
  </StrictMode>,
)
