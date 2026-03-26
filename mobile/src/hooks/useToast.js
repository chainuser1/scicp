/**
 * useToast.js — Minimal toast notification system.
 */
import { useState, useCallback, useRef } from 'react';

let globalAddToast = null;

export function addToast(message, type = 'info') {
  if (globalAddToast) globalAddToast(message, type);
}

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const add = useCallback((message, type = 'info') => {
    const id = ++idRef.current;
    setToasts(prev => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  globalAddToast = add;

  return { toasts, addToast: add };
}
