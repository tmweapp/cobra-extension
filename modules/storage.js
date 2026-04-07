/**
 * COBRA v5.2 — Storage Module
 * Extracted from sidepanel.js.
 * Chrome storage.local wrapper with state hydration.
 * Requires: global `state` object defined before this module loads.
 */
const Storage = {
  async load(key) {
    return new Promise(resolve => {
      chrome.storage.local.get(key, data => resolve(data[key] || null));
    });
  },
  async save(key, value) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  },
  async loadAll() {
    state.chatHistory = (await this.load('cobra_chat_history')) || [];
    state.memories = (await this.load('cobra_memories')) || [];
    state.habits = (await this.load('cobra_habits')) || state.habits;
    const saved = await this.load('cobra_settings');
    if (saved) Object.assign(state.settings, saved);
    // Load agents config
    const agents = await this.load('cobra_agents');
    if (agents) state.agents = agents;
    const leader = await this.load('cobra_leader');
    if (leader) state.leaderAgentId = leader;
  },
  async saveChat() { await this.save('cobra_chat_history', state.chatHistory); },
  async saveMemories() { await this.save('cobra_memories', state.memories); },
  async saveHabits() { await this.save('cobra_habits', state.habits); },
  async saveSettings() { await this.save('cobra_settings', state.settings); }
};
