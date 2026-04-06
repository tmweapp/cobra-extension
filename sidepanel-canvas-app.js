// COBRA v5.0 — Canvas Mode Controller
// External script for CSP compliance

(function() {
  'use strict';

  // DOM elements
  let commandInput, suggestionsContainer, contentCards, emptyState;

  document.addEventListener('DOMContentLoaded', () => {
    commandInput = document.getElementById('commandInput');
    suggestionsContainer = document.getElementById('suggestions');
    contentCards = document.querySelector('.content-cards');
    emptyState = document.getElementById('emptyState');

    if (commandInput) {
      setupEventListeners();
      setTimeout(() => commandInput.focus(), 500);
    }

    // Onboarding check
    if (typeof OnboardingWizard !== 'undefined') {
      OnboardingWizard.shouldShow().then(show => {
        if (show) OnboardingWizard.launch(document.body);
      }).catch(() => {});
    }

    // Mode switcher
    const classicBtn = document.getElementById('switchClassicBtn');
    if (classicBtn) {
      classicBtn.addEventListener('click', () => {
        window.location.href = 'sidepanel.html';
      });
    }
  });

  function setupEventListeners() {
    commandInput.addEventListener('focus', showSuggestions);
    commandInput.addEventListener('blur', () => setTimeout(hideSuggestions, 100));
    commandInput.addEventListener('input', (e) => {
      if (e.target.value.length > 0) showSuggestions();
    });
    commandInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const message = commandInput.value.trim();
        if (message) {
          sendMessage(message);
          commandInput.value = '';
          hideSuggestions();
        }
      }
    });

    document.querySelectorAll('.suggestion-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        commandInput.value = e.target.textContent;
        commandInput.focus();
        hideSuggestions();
      });
    });
  }

  function showSuggestions() {
    if (suggestionsContainer) suggestionsContainer.classList.add('active');
  }

  function hideSuggestions() {
    if (suggestionsContainer) suggestionsContainer.classList.remove('active');
  }

  function sendMessage(message) {
    console.log('Sending message:', message);
    addMessageCard('You', message, 'sender');

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage(
        { type: 'CHAT_MESSAGE', text: message, timestamp: new Date().toISOString() },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error:', chrome.runtime.lastError);
            addMessageCard('COBRA', 'Errore di comunicazione.', 'receiver');
            return;
          }
          if (response && response.text) {
            addMessageCard('COBRA', response.text, 'receiver');
          } else if (response && response.error) {
            addMessageCard('COBRA', `Errore: ${response.error}`, 'receiver');
          }
        }
      );
    } else {
      addMessageCard('COBRA', 'Chrome runtime non disponibile.', 'receiver');
    }
  }

  function addMessageCard(sender, text, type) {
    if (!contentCards) return;

    const card = document.createElement('div');
    card.className = `message-card ${type}`;
    card.innerHTML = `
      <div class="message-header">${escapeHtml(sender)}</div>
      <div class="message-text">${escapeHtml(text)}</div>
    `;
    contentCards.appendChild(card);

    setTimeout(() => {
      card.style.animation = 'slide-up 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) forwards';
    }, 10);

    // Keep max 8 cards
    const cards = contentCards.querySelectorAll('.message-card');
    if (cards.length > 8) cards[0].remove();

    updateEmptyState();
  }

  function updateEmptyState() {
    if (!emptyState || !contentCards) return;
    const hasCards = contentCards.querySelectorAll('.message-card').length > 0;
    emptyState.classList.toggle('hidden', hasCards);
  }

  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
})();
