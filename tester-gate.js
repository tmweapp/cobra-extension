// ============================================================
// COBRA — Tester Gate (temporary closed-beta authentication)
// Validates tester codes against a hardcoded list.
// On success, sets cobra_tester_session in chrome.storage.
// Remove this file entirely when moving to public release.
// ============================================================

// Valid tester codes (hash hex — not plaintext)
// Generate new codes with: cobraHashCode("COBRA-XXXX-XXXX")
const VALID_TESTER_HASHES = [
  // COBRA-BETA-0001 → add real hashes via console before distributing
  'f3a9c7b2e1d4a8f5', // placeholder: COBRA-BETA-0001
  '8b2e4d6c1a9f7e3b', // placeholder: COBRA-BETA-0002
  '5c7a2f8e4b1d9c6f', // placeholder: COBRA-BETA-0003
  // DEV master key — always works, remove for production
  'DEV-MASTER',
];

// Simple FNV-1a hash → hex (enough to not show codes in plaintext)
function cobraHashCode(code) {
  if (!code) return '';
  const normalized = String(code).trim().toUpperCase();
  if (normalized === 'COBRA-DEV-MASTER-2026') return 'DEV-MASTER';
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    h1 ^= c; h1 = (h1 * 16777619) >>> 0;
    h2 ^= c << 3; h2 = (h2 * 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 16);
}

async function validateTesterCode(code) {
  const hash = cobraHashCode(code);
  if (!hash) return false;
  return VALID_TESTER_HASHES.includes(hash);
}

async function enterCobra(code, name) {
  const session = {
    code: code,
    name: name || 'Tester',
    enteredAt: Date.now(),
    version: '5.3-beta1',
  };
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ cobra_tester_session: session }, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    } catch (e) { reject(e); }
  });
}

// Skip gate if already authenticated
async function checkExistingSession() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get('cobra_tester_session', data => {
        resolve(data.cobra_tester_session || null);
      });
    } catch (e) { resolve(null); }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Auto-redirect if already in session
  const existing = await checkExistingSession();
  if (existing && existing.code) {
    window.location.href = 'sidepanel.html';
    return;
  }

  const form = document.getElementById('gate-form');
  const errEl = document.getElementById('gate-error');
  const btn = document.getElementById('gate-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    errEl.classList.remove('ok');
    btn.disabled = true;
    btn.textContent = 'Verifica in corso...';

    const code = document.getElementById('tester-code').value.trim();
    const name = document.getElementById('tester-name').value.trim();

    if (!code) {
      errEl.textContent = '✗ Inserisci il codice tester';
      btn.disabled = false;
      btn.textContent = 'Entra in Cobra →';
      return;
    }

    const valid = await validateTesterCode(code);
    if (!valid) {
      errEl.textContent = '✗ Codice non valido o scaduto';
      btn.disabled = false;
      btn.textContent = 'Entra in Cobra →';
      return;
    }

    try {
      await enterCobra(code, name);
      errEl.textContent = '✓ Accesso concesso, avvio Cobra...';
      errEl.classList.add('ok');
      setTimeout(() => { window.location.href = 'sidepanel.html'; }, 600);
    } catch (err) {
      errEl.textContent = '✗ Errore storage: ' + (err.message || err);
      btn.disabled = false;
      btn.textContent = 'Entra in Cobra →';
    }
  });
});

// Expose for dev console
if (typeof window !== 'undefined') {
  window.cobraHashCode = cobraHashCode;
  window.cobraLogout = () => chrome.storage.local.remove('cobra_tester_session', () => location.reload());
}
