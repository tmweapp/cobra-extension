# ADR-0010: Tooltip-Based Progressive Onboarding

**Status**: Accepted

**Date**: 2024-03-27

---

## Context

New users were overwhelmed by COBRA's 4 views and rich feature set:
- Home (chat, quick actions)
- Archive (memory, jobs, KB)
- AI (agent orchestration)
- Settings (API keys, configuration)

Without guidance, users couldn't discover features.

---

## Decision

Implement **progressive onboarding** via tooltips:

```javascript
// onboarding.js

const OnboardingSteps = [
  {
    view: 'home',
    target: '#chat-input',
    title: 'Chat with AI',
    text: 'Type your request here. COBRA will help you automate tasks on this website.',
    position: 'top'
  },
  {
    view: 'home',
    target: '.quick-actions',
    title: 'Quick Actions',
    text: 'These buttons let you scrape content, interact with forms, and more.',
    position: 'top'
  },
  {
    view: 'archive',
    target: '#memories-list',
    title: 'Your Memory',
    text: 'COBRA learns from your actions and saves useful information here.',
    position: 'top'
  },
  {
    view: 'archive',
    target: '#jobs-list',
    title: 'Scheduled Jobs',
    text: 'Create recurring tasks that run automatically on a schedule.',
    position: 'top'
  },
  {
    view: 'settings',
    target: '#api-keys',
    title: 'Configure AI Providers',
    text: 'Add your API keys to enable chat with OpenAI, Anthropic, Groq, or Gemini.',
    position: 'bottom'
  }
];

// Track progress
let onboardingStep = 0;
let completedOnboarding = false;

function showTooltip() {
  const step = OnboardingSteps[onboardingStep];
  if (!step) {
    completedOnboarding = true;
    return;
  }

  const target = document.querySelector(step.target);
  if (!target) return;

  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.innerHTML = `
    <h3>${step.title}</h3>
    <p>${step.text}</p>
    <button onclick="nextOnboardingStep()">Next</button>
  `;

  target.parentElement.insertBefore(tooltip, target);
}

function nextOnboardingStep() {
  onboardingStep++;
  showTooltip();
}

function skipOnboarding() {
  completedOnboarding = true;
  chrome.storage.local.set({completedOnboarding: true});
}

// On first launch
if (!completedOnboarding) {
  showTooltip();
}
```

---

## Consequences

### Positive

1. **Discovery**: Users learn about features naturally
2. **Non-intrusive**: Tooltips don't block UI
3. **Skippable**: Users can dismiss and explore on own
4. **Progressive**: Introduce features gradually

### Negative

1. **Implementation**: Tooltips must be positioned correctly
2. **Maintenance**: Steps must track UI changes
3. **Testing**: Tooltip positioning varies by viewport

---

## Tooltip Styling

```css
.tooltip {
  position: absolute;
  background: #2563eb;
  color: white;
  padding: 12px 16px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  max-width: 250px;
  z-index: 10000;
}

.tooltip h3 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
}

.tooltip p {
  margin: 0 0 12px 0;
  font-size: 12px;
  line-height: 1.4;
}

.tooltip button {
  background: white;
  color: #2563eb;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.tooltip button:hover {
  opacity: 0.8;
}
```

---

## Future Enhancement: Interactive Tours

```javascript
// Tour integrations (e.g., Shepherd.js)
const tour = new Tour({
  steps: OnboardingSteps.map(step => ({
    element: step.target,
    popover: {
      title: step.title,
      description: step.text,
      position: step.position
    }
  }))
});

tour.start();
```

---

## References

- Web Onboarding Patterns: https://www.useronboarding.com/
- Shepherd.js: https://shepherdjs.dev/
- Tooltip Libraries: https://popper.js.org/
