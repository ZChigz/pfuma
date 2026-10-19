import { create } from 'zustand';

/** Names for dynamic routes (student, class, asset...) registered by the page itself. */
interface CrumbStore {
  labels: Record<string, string>;
  set: (path: string, label: string) => void;
  clear: (path: string) => void;
}

export const useCrumbStore = create<CrumbStore>((set) => ({
  labels: {},
  set: (path, label) => set((s) => (s.labels[path] === label ? s : { labels: { ...s.labels, [path]: label } })),
  clear: (path) =>
    set((s) => {
      if (!(path in s.labels)) return s;
      const next = { ...s.labels };
      delete next[path];
      return { labels: next };
    }),
}));
