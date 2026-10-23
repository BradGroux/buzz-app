import { useCallback, useSyncExternalStore } from "react";
import { useToastNotification } from "../../shared/design-system/ui/Toast";
import { downloadNativeMedia } from "./native-download";

type State = "downloading" | "failed";
const operations = new Map<string, State>();
const observers = new Map<string, Set<() => void>>();

function changed(key: string) {
  for (const listener of observers.get(key) ?? []) listener();
}

/** Cards can be virtualized or replaced while the host is still saving. */
export function useFileDownload(source: string | undefined, name: string) {
  const key = JSON.stringify([source, name]);
  const notify = useToastNotification();
  const subscribe = useCallback(
    (listener: () => void) => {
      const listeners = observers.get(key) ?? new Set<() => void>();
      observers.set(key, listeners);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        observers.delete(key);
        if (operations.get(key) !== "downloading") operations.delete(key);
      };
    },
    [key],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => operations.get(key),
    () => undefined,
  );
  return {
    downloading: state === "downloading",
    downloadError: state === "failed",
    download() {
      if (!source || operations.get(key) === "downloading") return;
      operations.set(key, "downloading");
      changed(key);
      void downloadNativeMedia(source, name).then(
        () => {
          operations.delete(key);
          changed(key);
          notify("File saved to Downloads", "success");
        },
        () => {
          if (observers.has(key)) operations.set(key, "failed");
          else operations.delete(key);
          changed(key);
        },
      );
    },
  };
}
