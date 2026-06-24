import { useRef, type ReactNode } from "react";

interface Props {
  title: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  zIndex: number;
  onMove: (position: { x: number; y: number }) => void;
  onResize: (size: { width: number; height: number }) => void;
  onFocus: () => void;
  onClose: () => void;
  children: ReactNode;
}

// Сколько окна гарантированно остаётся в пределах вьюпорта при перетаскивании,
// чтобы его нельзя было утащить за край и потерять (титулбар всегда доступен).
const KEEP_VISIBLE = 48;
const TITLEBAR_REACH = 36;

export function Window({ title, position, size, zIndex, onMove, onResize, onFocus, onClose, children }: Props) {
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Ограничивает позицию так, чтобы окно не ушло целиком за пределы экрана:
  // минимум KEEP_VISIBLE px по горизонтали остаётся видимым, а титулбар —
  // всегда в пределах высоты вьюпорта (иначе окно не за что схватить).
  const clampToViewport = (x: number, y: number) => {
    const w = windowRef.current?.offsetWidth ?? 320;
    return {
      x: Math.min(Math.max(x, KEEP_VISIBLE - w), window.innerWidth - KEEP_VISIBLE),
      y: Math.min(Math.max(y, 0), window.innerHeight - TITLEBAR_REACH),
    };
  };

  const handleDragStart = (e: React.MouseEvent) => {
    onFocus();
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: position.x, originY: position.y };
    window.addEventListener("mousemove", handleDragMove);
    window.addEventListener("mouseup", handleDragEnd);
  };

  const handleDragMove = (e: MouseEvent) => {
    const drag = dragState.current;
    if (!drag) return;
    onMove(clampToViewport(drag.originX + (e.clientX - drag.startX), drag.originY + (e.clientY - drag.startY)));
  };

  const handleDragEnd = () => {
    dragState.current = null;
    window.removeEventListener("mousemove", handleDragMove);
    window.removeEventListener("mouseup", handleDragEnd);
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFocus();
    const rect = bodyRef.current?.getBoundingClientRect();
    resizeState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: size?.width ?? rect?.width ?? 320,
      startHeight: size?.height ?? rect?.height ?? 200,
    };
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
  };

  const handleResizeMove = (e: MouseEvent) => {
    const resize = resizeState.current;
    if (!resize) return;
    onResize({
      width: Math.max(220, resize.startWidth + (e.clientX - resize.startX)),
      height: Math.max(120, resize.startHeight + (e.clientY - resize.startY)),
    });
  };

  const handleResizeEnd = () => {
    resizeState.current = null;
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", handleResizeEnd);
  };

  return (
    <div
      ref={windowRef}
      className="window"
      style={{
        left: position.x,
        top: position.y,
        zIndex,
        width: size?.width,
        height: size?.height,
        // Дефолтный max-width/max-height из CSS — это лимит для авто-подбора
        // по содержимому. Если пользователь сам потянул за уголок — он явно
        // выбрал размер, лимит снимаем (иначе ресайз бесполезен).
        maxWidth: size ? "calc(100vw - 32px)" : undefined,
        maxHeight: size ? "calc(100vh - 32px)" : undefined,
      }}
      onMouseDown={onFocus}
    >
      <div className="window-titlebar" onMouseDown={handleDragStart}>
        <span className="window-title">{title}</span>
        <button className="window-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>
      <div className="window-body" ref={bodyRef}>
        {children}
      </div>
      <div className="window-resize-handle" onMouseDown={handleResizeStart} />
    </div>
  );
}
