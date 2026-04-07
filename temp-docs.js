/**
 * COBRA v5.3 — Temp Docs Module
 * Gestisce documenti lunghi temporanei in IndexedDB
 * Usato per prompt lunghi e document references
 */

const TempDocs = {

  _dbName: 'cobra_temp_docs',
  _dbVersion: 1,
  _storeName: 'docs',
  _db: null,

  /**
   * Inizializza il database IndexedDB
   */
  async init() {
    if (this._db) {
      try {
        const tx = this._db.transaction(this._storeName, 'readonly');
        tx.abort();
        return this._db;
      } catch (e) {
        this._db = null;
      }
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this._dbName, this._dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this._storeName)) {
          const store = db.createObjectStore(this._storeName, { keyPath: 'id' });
          store.createIndex('sessionId', 'sessionId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
        }
      };

      request.onsuccess = () => {
        this._db = request.result;
        this._db.onclose = () => {
          this._db = null;
        };
        resolve(this._db);
      };

      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Salva un documento nel temp store
   * { id, content, title, words, sessionId, createdAt, lastAccessedAt }
   */
  async save(id, content, metadata = {}) {
    const db = await this.init();

    const doc = {
      id,
      content,
      title: metadata.title || 'document',
      words: metadata.words || 0,
      tokenCount: metadata.tokenCount || 0,
      sessionId: metadata.sessionId || '',
      createdAt: metadata.createdAt || new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      const store = tx.objectStore(this._storeName);
      const request = store.put(doc);

      request.onsuccess = () => resolve(doc);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Legge un documento dal temp store
   * Aggiorna lastAccessedAt
   */
  async read(id) {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      const store = tx.objectStore(this._storeName);
      const request = store.get(id);

      request.onsuccess = () => {
        const doc = request.result;
        if (doc) {
          // Aggiorna lastAccessedAt
          doc.lastAccessedAt = new Date().toISOString();
          const updateRequest = store.put(doc);
          updateRequest.onsuccess = () => resolve(doc);
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Rimuove documenti più vecchi di N ore
   */
  async purgeOlderThan(hours = 24) {
    const db = await this.init();
    const threshold = hours * 60 * 60 * 1000;
    const now = Date.now();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      const store = tx.objectStore(this._storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const docs = request.result || [];
        const toDelete = docs.filter(doc => {
          const age = now - new Date(doc.createdAt).getTime();
          return age > threshold;
        });

        let deleted = 0;
        for (const doc of toDelete) {
          const delRequest = store.delete(doc.id);
          delRequest.onsuccess = () => {
            deleted++;
            if (deleted === toDelete.length) {
              tx.oncomplete = () => resolve({ deleted });
            }
          };
        }

        if (toDelete.length === 0) {
          tx.oncomplete = () => resolve({ deleted: 0 });
        }
      };

      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Lista metadati dei documenti per una sessione
   */
  async listForSession(sessionId) {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readonly');
      const store = tx.objectStore(this._storeName);
      const index = store.index('sessionId');
      const request = index.getAll(sessionId);

      request.onsuccess = () => {
        const docs = (request.result || []).map(doc => ({
          id: doc.id,
          title: doc.title,
          words: doc.words,
          tokenCount: doc.tokenCount,
          createdAt: doc.createdAt,
          lastAccessedAt: doc.lastAccessedAt,
          // Non ritornare content qui
        }));
        resolve(docs);
      };

      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Cancella un documento specifico
   */
  async delete(id) {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      const store = tx.objectStore(this._storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Cancella tutti i documenti di una sessione
   */
  async clearSession(sessionId) {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this._storeName, 'readwrite');
      const store = tx.objectStore(this._storeName);
      const index = store.index('sessionId');
      const request = index.getAll(sessionId);

      request.onsuccess = () => {
        const docs = request.result || [];
        let deleted = 0;

        for (const doc of docs) {
          const delRequest = store.delete(doc.id);
          delRequest.onsuccess = () => {
            deleted++;
            if (deleted === docs.length) {
              tx.oncomplete = () => resolve({ deleted });
            }
          };
        }

        if (docs.length === 0) {
          tx.oncomplete = () => resolve({ deleted: 0 });
        }
      };

      request.onerror = () => reject(request.error);
    });
  },
};

// Rendi disponibile globalmente
if (typeof self !== 'undefined') {
  self.cobraTempDocs = TempDocs;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TempDocs;
}
