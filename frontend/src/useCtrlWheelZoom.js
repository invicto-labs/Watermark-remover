import { useEffect, useRef } from 'react';

// Use a native non-passive listener so Ctrl+wheel zooms the PDF, not the browser.
export function subscribeCtrlWheelZoom(element, onZoom) {
  const handleWheel = event => {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    onZoom(event.deltaY < 0 ? 1 : -1);
  };
  element.addEventListener('wheel', handleWheel, { passive: false });
  return () => element.removeEventListener('wheel', handleWheel);
}

export default function useCtrlWheelZoom(canvasRef, onZoom, enabled = true) {
  const callbackRef = useRef(onZoom);
  callbackRef.current = onZoom;
  useEffect(() => {
    const element = canvasRef.current;
    if (!enabled || !element) return;
    return subscribeCtrlWheelZoom(element, direction => callbackRef.current(direction));
  }, [canvasRef, enabled]);
}
