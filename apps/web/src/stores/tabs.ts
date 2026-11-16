import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface OpenTab {
  projectId: string;
  projectName: string;
}

const STORAGE_KEY = 'vd_open_tabs';

function loadTabs(): OpenTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OpenTab[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<OpenTab[]>(loadTabs());

  function persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.value));
  }

  function add(projectId: string, projectName: string): void {
    const existing = tabs.value.find((tab) => tab.projectId === projectId);
    if (existing) {
      if (existing.projectName !== projectName) {
        existing.projectName = projectName;
        persist();
      }
      return;
    }
    tabs.value.push({ projectId, projectName });
    persist();
  }

  function remove(projectId: string): void {
    tabs.value = tabs.value.filter((tab) => tab.projectId !== projectId);
    persist();
  }

  function clear(): void {
    tabs.value = [];
    persist();
  }

  return { tabs, add, remove, clear };
});
