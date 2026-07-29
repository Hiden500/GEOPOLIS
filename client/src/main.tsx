import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import './i18n'
import App from './App.tsx'
import { PrimitivesShowcase } from './dev/PrimitivesShowcase.tsx'
import { SystemShowcase } from './dev/SystemShowcase.tsx'
import { ScreenMock } from './dev/ScreenMock.tsx'

// Витрины — dev-only, вне игрового потока.
//   ?showcase=ui         — дизайн-система пересборки интерфейса;
//   ?showcase=screen     — макет игрового экрана (витрина встраивает его в
//                          iframe заданного размера, поэтому он отдельный);
//   ?showcase=primitives — витрина отменённого слоя primitives/, до его удаления.
const showcase = new URLSearchParams(window.location.search).get('showcase')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showcase === 'ui' ? (
      <SystemShowcase />
    ) : showcase === 'screen' ? (
      <ScreenMock />
    ) : showcase === 'primitives' ? (
      <PrimitivesShowcase />
    ) : (
      <App />
    )}
  </StrictMode>,
)
