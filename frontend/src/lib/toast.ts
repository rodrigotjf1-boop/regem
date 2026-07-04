// Toast global via pub/sub singleton — chamável de qualquer lugar (sem hook/context):
//   import { toast } from '@/lib/toast'; toast.success('Ficha salva');
export type ToastType = 'success' | 'error' | 'info';
export type ToastItem = { id: number; type: ToastType; msg: string };

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
let seq = 1;

function emitir() {
  for (const l of listeners) l(items);
}

export function subscribe(l: Listener) {
  listeners.add(l);
  l(items);
  return () => {
    listeners.delete(l);
  };
}

export function dismiss(id: number) {
  items = items.filter((i) => i.id !== id);
  emitir();
}

function push(type: ToastType, msg: string, timeout: number) {
  const id = seq++;
  items = [...items, { id, type, msg }];
  emitir();
  if (timeout > 0) setTimeout(() => dismiss(id), timeout);
  return id;
}

export const toast = {
  success: (msg: string, timeout = 4000) => push('success', msg, timeout),
  error: (msg: string, timeout = 6000) => push('error', msg, timeout),
  info: (msg: string, timeout = 4000) => push('info', msg, timeout),
};
