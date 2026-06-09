import { create } from 'zustand';

interface SidebarStore {
  isMobileExpanded: boolean;
  toggle: () => void;
  close: () => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  isMobileExpanded: false,
  toggle: () => set((s) => ({ isMobileExpanded: !s.isMobileExpanded })),
  close: () => set({ isMobileExpanded: false }),
}));
