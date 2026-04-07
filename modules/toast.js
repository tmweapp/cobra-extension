/**
 * COBRA v5.2 — Toast Notification Module
 * Extracted from sidepanel.js for modular architecture.
 * Provides non-blocking user feedback (success, error, warning, info).
 */
const Toast = {
  _container: null,

  _getContainer() {
    if (!this._container) this._container = document.getElementById('toastContainer');
    return this._container;
  },

  /**
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} type
   * @param {number} duration - ms (default 4000)
   */
  show(message, type = 'info', duration = 4000) {
    const container = this._getContainer();
    if (!container) return;

    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ'}</span>
      <span class="toast-text">${message}</span>
      <span class="toast-close">✕</span>
    `;

    el.querySelector('.toast-close').onclick = () => this._dismiss(el);
    el.onclick = (e) => { if (!e.target.classList.contains('toast-close')) this._dismiss(el); };

    container.appendChild(el);

    // Auto-dismiss
    setTimeout(() => this._dismiss(el), duration);

    // Max 5 toasts
    while (container.children.length > 5) {
      container.removeChild(container.firstChild);
    }
  },

  _dismiss(el) {
    if (!el || !el.parentNode) return;
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 300);
  },

  success(msg, dur) { this.show(msg, 'success', dur); },
  error(msg, dur)   { this.show(msg, 'error', dur || 6000); },
  warning(msg, dur) { this.show(msg, 'warning', dur || 5000); },
  info(msg, dur)    { this.show(msg, 'info', dur); }
};

// Export for Node.js/Jest environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Toast;
}

// Export for browser environment
if (typeof self !== 'undefined') {
  self.Toast = Toast;
}
