import { create } from 'zustand';

interface SidebarStore {
  isMobileExpanded: boolean;
  /** Desktop only: icons without labels. */
  collapsed: boolean;
  toggle: () => void;
  close: () => void;
  toggleCollapsed: () => void;
  restore: () => void;
}

const KEY = 'pfuma.sidebar.collapsed';

// Remembered per browser; the sidebar works the same without it.
const read = () => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
};
const write = (v: boolean) => {
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private window */ }
};

export const useSidebarStore = create<SidebarStore>((set, get) => ({
  isMobileExpanded: false,
  collapsed: false,
  toggle: () => set((s) => ({ isMobileExpanded: !s.isMobileExpanded })),
  close: () => set({ isMobileExpanded: false }),
  toggleCollapsed: () => {
    const next = !get().collapsed;
    write(next);
    set({ collapsed: next });
  },
  restore: () => set({ collapsed: read() }),
}));
