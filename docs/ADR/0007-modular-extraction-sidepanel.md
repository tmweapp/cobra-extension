# ADR-0007: Modular UI Extraction to Sidepanel Canvas

**Status**: Accepted

**Date**: 2024-03-27

---

## Context

Sidepanel started as single HTML + inline script. Growth required:
1. State management (chat, memories, jobs, settings)
2. Multi-view navigation (home, archive, ai, settings)
3. Reusable UI components (messages, forms, modals)
4. Module-based architecture

---

## Decision

Implement **sidepanel-canvas-app.js** with:
- **Centralized state** (single source of truth)
- **View routing** (currentView tracks active screen)
- **Module loading** (on-demand imports)
- **Message-based communication** with service worker

```javascript
const state = {
  currentView: 'home',  // 'home'|'archive'|'ai'|'settings'
  chatHistory: [],
  memories: [],
  habits: {sites: {}, actions: {}, hours: {}},
  agents: [
    {id: 'analyst', name: 'Analyst', provider: 'openai', active: true},
    {id: 'strategist', name: 'Strategist', provider: 'anthropic', active: false}
  ],
  settings: {openaiKey, anthropicKey, rateLimit, language, ...}
};

// View routing
function switchView(newView) {
  state.currentView = newView;
  renderView();
}

function renderView() {
  const viewEl = document.getElementById('app');
  switch (state.currentView) {
    case 'home': return renderHome(viewEl);
    case 'archive': return renderArchive(viewEl);
    case 'ai': return renderAI(viewEl);
    case 'settings': return renderSettings(viewEl);
  }
}

// Module loading
async function loadModule(name) {
  const module = await import(`./modules/${name}.js`);
  return module.default || module;
}
```

---

## Consequences

### Positive

1. **Scalability**: Easy to add views without touching core
2. **State management**: Centralized, time-travelable
3. **Testing**: Each view/module testable independently
4. **Performance**: Lazy-loaded modules

### Negative

1. **State size**: All state in memory (mitigated by chrome.storage sync)
2. **Re-render cost**: Full UI refresh on state change (mitigated by virtual DOM in future)

---

## File Structure

```
sidepanel/
├── sidepanel.html              # Entry point
├── sidepanel.js                # Main controller
├── sidepanel-canvas-app.js     # State + routing
├── modules/
│   ├── storage.js              # Persistence layer
│   ├── toast.js                # Notifications
│   ├── error-boundary.js       # Error handling
│   ├── onboarding.js           # First-time setup
│   └── ... (other modules)
├── views/
│   ├── home.js                 # Chat view
│   ├── archive.js              # Memory/job browser
│   ├── ai.js                   # Orchestration
│   └── settings.js             # Configuration
└── styles.css                  # Shared styles
```

---

## References

- State Management Patterns: https://redux.js.org/understanding/thinking-in-redux
- View Routing: https://developer.mozilla.org/en-US/docs/Web/API/History_API
