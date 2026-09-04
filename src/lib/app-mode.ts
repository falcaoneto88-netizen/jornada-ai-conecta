import { useSyncExternalStore } from "react";

/**
 * Estado do modo da aplicação.
 * "demo" = dados de demonstração, nenhuma chamada real ao GoHighLevel.
 * "conectado" = só após validação real da ligação pelo backend (Fase 2).
 * Nenhuma credencial é guardada aqui nem no navegador.
 */
export type AppMode = "demo" | "conectado";

let modo: AppMode = "demo";
const listeners = new Set<() => void>();

export function setAppMode(next: AppMode) {
  modo = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppMode(): AppMode {
  return useSyncExternalStore(
    subscribe,
    () => modo,
    () => "demo" as AppMode,
  );
}
