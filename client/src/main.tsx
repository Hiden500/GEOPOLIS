import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import './i18n'
import App from './App.tsx'
import { PrimitivesShowcase } from './dev/PrimitivesShowcase.tsx'
import { SystemShowcase } from './dev/SystemShowcase.tsx'
import { Prototype } from './proto/Prototype.tsx'
import { ShapeGallery } from './dev/ShapeGallery.tsx'

// Витрины — dev-only, вне игрового потока.
//   ?showcase=ui         — дизайн-система пересборки интерфейса;
//   ?showcase=screen     — кликабельный макет игрового экрана (витрина
//                          встраивает его в iframe заданного размера,
//                          поэтому он отдельный вход);
//   ?showcase=shapes     — выбор силуэта ШАПКИ (варианты формы рядом);
//   ?showcase=primitives — витрина отменённого слоя primitives/, до его удаления.
const showcase = new URLSearchParams(window.location.search).get('showcase')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showcase === 'ui' ? (
      <SystemShowcase />
    ) : showcase === 'screen' ? (
      <Prototype />
    ) : showcase === 'shapes' ? (
      <ShapeGallery />
    ) : showcase === 'primitives' ? (
      <PrimitivesShowcase />
    ) : (
      <App />
    )}
  </StrictMode>,
)
