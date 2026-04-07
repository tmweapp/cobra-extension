/**
 * COBRA v5.2 — Communication Hub Module
 * Extracted from sidepanel.js.
 * WhatsApp, Email, LinkedIn messaging integration.
 * Requires: global `state`, `Chat`, `Toast`, `sanitizeHTML` objects.
 */
const commActiveChannel = 'email';

const CommChat = {
  activeChannel: 'whatsapp',
  activeContact: null,

  init() {
    document.querySelectorAll('.comm-tab').forEach(btn => {
      btn.onclick = () => {
        this.activeChannel = btn.dataset.channel;
        document.querySelectorAll('.comm-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.showChannelView();
      };
    });

    document.getElementById('commBackBtn')?.addEventListener('click', () => this.showContactList());
    document.getElementById('commSyncBtn')?.addEventListener('click', () => this.syncContacts());
    document.getElementById('commRefreshChat')?.addEventListener('click', () => this.loadActiveMessages());
    document.getElementById('commChatSendBtn')?.addEventListener('click', () => this.sendChatMessage());
    document.getElementById('commChatInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendChatMessage(); }
    });
    document.getElementById('commNewChatBtn')?.addEventListener('click', () => this.newChat());
    document.getElementById('commSearchContacts')?.addEventListener('input', (e) => this.filterContacts(e.target.value));
    document.getElementById('commSendEmailBtn')?.addEventListener('click', () => this.sendEmail());
    document.getElementById('commSendLiBtn')?.addEventListener('click', () => this.sendLinkedIn());
  },

  showChannelView() {
    const contactList = document.getElementById('commContactList');
    const chatView = document.getElementById('commChatView');
    const emailView = document.getElementById('commEmailView');
    const linkedinView = document.getElementById('commLinkedinView');
    [contactList, chatView, emailView, linkedinView].forEach(el => { if (el) el.style.display = 'none'; });

    if (this.activeChannel === 'whatsapp') {
      if (contactList) contactList.style.display = 'flex';
      this.loadContacts();
    } else if (this.activeChannel === 'email') {
      if (emailView) emailView.style.display = 'block';
      this.loadEmailInbox();
    } else if (this.activeChannel === 'linkedin') {
      if (linkedinView) linkedinView.style.display = 'block';
    }
  },

  async loadContacts() {
    const container = document.getElementById('commContactItems');
    if (!container) return;
    chrome.runtime.sendMessage({ action: 'COMM_WA_GET_CHATS' }, (res) => {
      if (!res?.success) return;
      this.renderContactList(res.chats || {});
    });
  },

  async syncContacts() {
    const syncBtn = document.getElementById('commSyncBtn');
    if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = '...'; }
    chrome.runtime.sendMessage({ action: 'COMM_WA_CHAT_LIST' }, (res) => {
      if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = 'Sync'; }
      if (res?.success && res.chats) {
        chrome.runtime.sendMessage({ action: 'COMM_WA_GET_CHATS' }, (existing) => {
          const chats = existing?.chats || {};
          for (const c of res.chats) {
            const key = c.name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
            if (!chats[key]) chats[key] = { name: c.name, messages: [], lastTs: Date.now() };
            chats[key].lastMsg = c.lastMsg;
            chats[key].time = c.time;
            chats[key].unread = c.unread;
          }
          chrome.storage.local.set({ comm_wa_chats: chats }, () => {
            this.renderContactList(chats);
          });
        });
      } else {
        Chat.addMessage('system', res?.error || 'Apri web.whatsapp.com per sincronizzare le chat.');
      }
    });
  },

  renderContactList(chats) {
    const container = document.getElementById('commContactItems');
    if (!container) return;
    const sorted = Object.entries(chats).sort((a, b) => (b[1].lastTs || 0) - (a[1].lastTs || 0));
    if (!sorted.length) { container.innerHTML = ''; return; }
    container.innerHTML = sorted.map(([key, chat]) => {
      const initial = (chat.name || '?').charAt(0).toUpperCase();
      const name = sanitizeHTML(chat.name || key);
      const preview = sanitizeHTML(chat.lastMsg || (chat.messages?.length ? chat.messages[chat.messages.length - 1]?.text?.slice(0, 50) : '') || '');
      const time = sanitizeHTML(chat.time || '');
      const unreadDot = chat.unread ? '<div class="comm-contact-badge"></div>' : '';
      return `<div class="comm-contact-row" data-key="${sanitizeHTML(key)}" data-name="${name}">
        <div class="comm-contact-avatar">${initial}</div>
        <div class="comm-contact-body">
          <div class="comm-contact-name">${name}</div>
          <div class="comm-contact-preview">${preview}</div>
        </div>
        <div class="comm-contact-meta">
          <div class="comm-contact-time">${time}</div>
          ${unreadDot}
        </div>
      </div>`;
    }).join('');
    container.querySelectorAll('.comm-contact-row').forEach(row => {
      row.onclick = () => this.openChat(row.dataset.key, row.dataset.name);
    });
  },

  filterContacts(query) {
    const rows = document.querySelectorAll('.comm-contact-row');
    const q = (query || '').toLowerCase();
    rows.forEach(row => {
      const name = (row.dataset.name || '').toLowerCase();
      row.style.display = !q || name.includes(q) ? 'flex' : 'none';
    });
  },

  openChat(key, name) {
    this.activeContact = { key, name };
    document.getElementById('commContactList').style.display = 'none';
    document.getElementById('commChatView').style.display = 'flex';
    document.getElementById('commChatName').textContent = name || key;
    document.getElementById('commChatStatus').textContent = '';
    chrome.runtime.sendMessage({ action: 'COMM_WA_GET_CHATS' }, (res) => {
      const chats = res?.chats || {};
      const chat = chats[key];
      if (chat?.messages?.length) {
        this.renderMessages(chat.messages);
      } else {
        document.getElementById('commChatMessages').innerHTML = '';
      }
    });
    chrome.runtime.sendMessage({ action: 'COMM_WA_OPEN_CHAT', name }, () => {
      setTimeout(() => this.loadActiveMessages(), 2000);
    });
  },

  showContactList() {
    this.activeContact = null;
    document.getElementById('commChatView').style.display = 'none';
    document.getElementById('commContactList').style.display = 'flex';
  },

  async loadActiveMessages() {
    if (!this.activeContact) return;
    const refreshBtn = document.getElementById('commRefreshChat');
    if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = '...'; }
    chrome.runtime.sendMessage({ action: 'COMM_WA_MESSAGES' }, (res) => {
      if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = 'Aggiorna'; }
      if (res?.success && res.messages) {
        this.renderMessages(res.messages);
        if (res.chatName) document.getElementById('commChatName').textContent = res.chatName;
      }
    });
  },

  renderMessages(messages) {
    const container = document.getElementById('commChatMessages');
    if (!container) return;
    container.innerHTML = messages.map(m => {
      const cls = m.from === 'me' ? 'comm-msg-out' : 'comm-msg-in';
      const text = sanitizeHTML(m.text || '');
      const time = sanitizeHTML(m.time || '');
      return `<div class="comm-msg ${cls}">
        <div>${text}</div>
        ${time ? `<div class="comm-msg-time">${time}</div>` : ''}
      </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  },

  sendChatMessage() {
    const input = document.getElementById('commChatInput');
    const text = input?.value?.trim();
    if (!text || !this.activeContact) return;
    const name = this.activeContact.name;
    input.value = '';
    const container = document.getElementById('commChatMessages');
    if (container) {
      const el = document.createElement('div');
      el.className = 'comm-msg comm-msg-out';
      el.innerHTML = `<div>${sanitizeHTML(text)}</div><div class="comm-msg-time">Invio...</div>`;
      container.appendChild(el);
      container.scrollTop = container.scrollHeight;
    }
    chrome.runtime.sendMessage({ action: 'COMM_SEND_WHATSAPP', phone: name, text }, (res) => {
      if (res?.success) {
        const lastMsg = container?.lastElementChild?.querySelector('.comm-msg-time');
        if (lastMsg) lastMsg.textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        Toast.success('Messaggio WhatsApp inviato');
      } else {
        Toast.error('Invio WhatsApp fallito');
      }
    });
  },

  newChat() {
    const phone = prompt('Inserisci numero di telefono (es. +39335...)');
    if (!phone) return;
    this.openChat(phone.replace(/\D/g, ''), phone);
  },

  loadEmailInbox() {
    chrome.runtime.sendMessage({ action: 'COMM_GET_EMAILS' }, (res) => {
      const list = document.getElementById('commInboxList');
      if (!list || !res?.success) return;
      const emails = (res.emails || []).slice(0, 10);
      if (!emails.length) { list.innerHTML = ''; return; }
      list.innerHTML = emails.map(e => {
        const fromName = sanitizeHTML((e.from || '').split('<')[0].trim() || 'Sconosciuto');
        const initial = fromName.charAt(0).toUpperCase();
        const subj = sanitizeHTML(e.subject || '(nessun oggetto)');
        const dateStr = e.date ? new Date(e.date).toLocaleDateString('it-IT', {day:'2-digit',month:'short'}) : '';
        return `<div class="comm-list-item">
          <div class="comm-list-avatar">${initial}</div>
          <div class="comm-list-body">
            <div class="comm-list-from">${fromName}</div>
            <div class="comm-list-snippet">${subj}</div>
          </div>
          <div class="comm-list-time">${dateStr}</div>
        </div>`;
      }).join('');
    });
    chrome.runtime.sendMessage({ action: 'COMM_GET_SENT_LOG' }, (res) => {
      const el = document.getElementById('commSentLog');
      if (!el || !res?.success) return;
      const log = (res.log || []).slice(0, 5);
      if (!log.length) { el.innerHTML = ''; return; }
      el.innerHTML = log.map(l => {
        const icon = l.channel === 'email' ? '📧' : l.channel === 'whatsapp' ? '💬' : '💼';
        const time = new Date(l.sentAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        return `<div class="comm-list-item">
          <div class="comm-list-avatar">${icon}</div>
          <div class="comm-list-body">
            <div class="comm-list-from">${sanitizeHTML(l.recipient || '')}</div>
            <div class="comm-list-snippet">${sanitizeHTML(l.preview || '')}</div>
          </div>
          <div class="comm-list-time">${time}</div>
        </div>`;
      }).join('');
    });
  },

  sendEmail() {
    const btn = document.getElementById('commSendEmailBtn');
    const to = document.getElementById('commEmailTo')?.value?.trim();
    const subject = document.getElementById('commEmailSubject')?.value?.trim();
    const body = document.getElementById('commEmailBody')?.value?.trim();
    if (!to) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Invio...'; }
    chrome.runtime.sendMessage({ action: 'COMM_SEND_EMAIL', to, subject, body }, (res) => {
      if (btn) { btn.disabled = false; btn.textContent = 'Invia Email'; }
      if (res?.success) {
        document.getElementById('commEmailTo').value = '';
        document.getElementById('commEmailSubject').value = '';
        document.getElementById('commEmailBody').value = '';
        this.loadEmailInbox();
      }
    });
  },

  sendLinkedIn() {
    const btn = document.getElementById('commSendLiBtn');
    const recipient = document.getElementById('commLiRecipient')?.value?.trim();
    const text = document.getElementById('commLiText')?.value?.trim();
    if (!recipient || !text) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Invio...'; }
    chrome.runtime.sendMessage({ action: 'COMM_SEND_LINKEDIN', recipient, text }, (res) => {
      if (btn) { btn.disabled = false; btn.textContent = 'Invia LinkedIn'; }
      if (res?.success) {
        document.getElementById('commLiRecipient').value = '';
        document.getElementById('commLiText').value = '';
      }
    });
  }
};

function renderCommsView() {
  CommChat.showChannelView();
}
