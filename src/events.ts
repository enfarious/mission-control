type Handler = (data: any) => void;

export function createEventBus() {
  const listeners = new Map<string, Set<Handler>>();

  function on(event: string, handler: Handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(handler);
    return () => listeners.get(event)?.delete(handler);
  }

  function emit(event: string, data: any) {
    listeners.get(event)?.forEach((h) => {
      try {
        h(data);
      } catch (err) {
        console.error(`[events] Handler error for ${event}:`, err);
      }
    });
  }

  return { on, emit };
}

export type EventBus = ReturnType<typeof createEventBus>;
