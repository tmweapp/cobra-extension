/**
 * COBRA v5.2 — Tool Registry
 * Tool definitions (OpenAI function calling format) + risk classification.
 * Extracted from bg-chat.js for modularity.
 */

const COBRA_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Naviga il browser a un URL specifico. Usa per aprire siti web, pagine di ricerca, etc.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL completo da visitare (es: https://www.google.com/search?q=voli+milano+bangkok)' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'google_search',
      description: 'Cerca su Google e restituisce i risultati. Usa per qualsiasi ricerca web.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'La query di ricerca Google' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_page',
      description: 'Legge e restituisce il contenuto testuale della pagina web corrente nel browser.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scrape_url',
      description: 'Apre un URL in background, estrae il contenuto testuale e lo restituisce.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL da scrappare' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_js',
      description: 'Esegue codice JavaScript nella pagina corrente. Usa per interagire con la pagina: cliccare bottoni, compilare form, estrarre dati specifici.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Codice JavaScript da eseguire nella pagina' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'click_element',
      description: 'Clicca su un elemento nella pagina. Usa per premere bottoni, link, tab, opzioni. Cerca l\'elemento per testo visibile o selettore CSS.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Selettore CSS (es: "button.book-btn", "a[href*=booking]", "#submit") oppure testo visibile preceduto da text: (es: "text:Prenota ora", "text:Book")' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fill_form',
      description: 'Compila campi di un form nella pagina. Passa un oggetto con selettore->valore per ogni campo da riempire.',
      parameters: {
        type: 'object',
        properties: {
          fields: { type: 'string', description: 'JSON oggetto {"selettore": "valore"}. Es: {"#origin": "Bangkok", "#destination": "Milano", "#date": "2026-04-08"}' }
        },
        required: ['fields']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_page_elements',
      description: 'Analizza la pagina corrente e restituisce gli elementi interattivi: bottoni, link, input, form. Usa SEMPRE questo tool dopo navigate per capire come interagire con la pagina.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Filtra per tipo: "buttons", "links", "inputs", "forms", "all" (default: "all")' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'screenshot',
      description: 'Cattura uno screenshot della pagina corrente.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'crawl_website',
      description: 'Effettua crawling di un sito web: visita più pagine, estrae contenuto da ciascuna. Usa per analizzare un intero sito.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL di partenza del crawl' },
          maxPages: { type: 'number', description: 'Numero massimo di pagine da visitare (default: 10)' },
          sameDomain: { type: 'boolean', description: 'Restare sullo stesso dominio (default: true)' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'extract_data',
      description: 'Estrae dati strutturati dalla pagina corrente usando selettori CSS o XPath. Usa per estrarre tabelle, liste, prezzi, etc.',
      parameters: {
        type: 'object',
        properties: {
          schema: { type: 'object', description: 'Mappa nome_campo -> selettore CSS/XPath. Es: {"prezzo": ".price", "titolo": "h1"}' }
        },
        required: ['schema']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_to_kb',
      description: 'Salva informazioni nella Knowledge Base di COBRA per uso futuro. Salva regole, pattern, dati appresi, selettori CSS, procedure.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Dominio o categoria (es: "booking.com", "voli", "procedure-lavoro")' },
          type: { type: 'string', description: 'Tipo: rule, selector, prompt, procedure, data' },
          name: { type: 'string', description: 'Nome della regola/dato' },
          content: { type: 'string', description: 'Il contenuto da salvare' },
          tags: { type: 'string', description: 'Tags separati da virgola' }
        },
        required: ['domain', 'type', 'name', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_kb',
      description: 'Cerca nella Knowledge Base di COBRA per recuperare informazioni salvate in precedenza.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Termine di ricerca' },
          domain: { type: 'string', description: 'Filtra per dominio specifico (opzionale)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Crea e scarica un file. Supporta JSON, CSV, TXT, HTML, Markdown.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Nome del file con estensione (es: risultati.csv, report.json)' },
          content: { type: 'string', description: 'Contenuto del file' },
          type: { type: 'string', description: 'MIME type (es: text/csv, application/json, text/html)' }
        },
        required: ['filename', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Crea un task/job multi-step che COBRA eseguirà. Usa per operazioni complesse in più fasi che vanno ricordate e completate.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nome del task' },
          steps: {
            type: 'string',
            description: 'JSON array di step. Ogni step: {"action": "navigate|scrape|extract|wait|click", "params": {...}, "description": "..."}'
          },
          schedule: { type: 'string', description: 'Cron expression per esecuzione periodica (opzionale). Es: "0 */6 * * *" per ogni 6 ore' }
        },
        required: ['name', 'steps']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: 'Elenca tutti i task/job salvati, il loro stato e progresso.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'Salva un ricordo/nota nella memoria persistente di COBRA. Usa per ricordare preferenze, risultati, informazioni importanti.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Titolo breve del ricordo' },
          content: { type: 'string', description: 'Contenuto dettagliato' },
          tags: { type: 'string', description: 'Tags separati da virgola' }
        },
        required: ['title', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'batch_scrape',
      description: 'Scrapea più URL in parallelo. Usa per raccogliere dati da più pagine contemporaneamente.',
      parameters: {
        type: 'object',
        properties: {
          urls: { type: 'string', description: 'JSON array di URL da scrappare. Es: ["https://...", "https://..."]' }
        },
        required: ['urls']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_local_files',
      description: 'Elenca i file nella cartella connessa del computer dell\'utente. L\'utente deve prima connettere una cartella.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Sottocartella da esplorare (opzionale, vuoto = root connessa)' },
          pattern: { type: 'string', description: 'Filtro per nome file (es: ".pdf", ".csv", "report")' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_local_file',
      description: 'Legge il contenuto di un file dal computer dell\'utente. Per file di testo restituisce il contenuto, per binari restituisce info.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Percorso del file relativo alla cartella connessa (es: "documenti/report.txt")' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_local_file',
      description: 'Salva un file nella cartella connessa del computer dell\'utente.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Percorso dove salvare il file (es: "output/risultati.csv")' },
          content: { type: 'string', description: 'Contenuto del file' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_local_files',
      description: 'Cerca file per nome o contenuto nella cartella connessa.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Testo da cercare nei nomi dei file o nel contenuto' },
          content_search: { type: 'boolean', description: 'Se true, cerca anche dentro i file di testo (più lento)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'kb_update',
      description: 'Aggiorna o crea una entry nella Knowledge Base. Usa per salvare nuovi pattern, correzioni, selettori appresi.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Titolo breve della entry (es: "selettore_prezzo_amazon")' },
          content: { type: 'string', description: 'Contenuto della entry (max 10 righe)' },
          category: { type: 'string', description: 'Categoria: tool, workflow, behavior, selector, pattern, correction' },
          domain: { type: 'string', description: 'Dominio specifico (es: "amazon.it") o null per globale' },
          tags: { type: 'string', description: 'Tags separati da virgola' }
        },
        required: ['title', 'content', 'category']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'kb_delete',
      description: 'Disattiva una entry della Knowledge Base per titolo.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Titolo della entry da disattivare' }
        },
        required: ['title']
      }
    }
  }
];

// Risk classification for tool safety
const TOOL_RISK_MAP = {
  navigate: 'safe',
  google_search: 'safe',
  read_page: 'safe',
  scrape_url: 'safe',
  screenshot: 'safe',
  get_page_elements: 'safe',
  crawl_website: 'safe',
  extract_data: 'safe',
  search_kb: 'safe',
  list_tasks: 'safe',
  list_local_files: 'safe',
  read_local_file: 'safe',
  search_local_files: 'safe',
  batch_scrape: 'safe',
  click_element: 'risky',
  fill_form: 'risky',
  save_to_kb: 'risky',
  kb_update: 'risky',
  kb_delete: 'risky',
  create_file: 'risky',
  create_task: 'risky',
  save_memory: 'risky',
  save_local_file: 'risky',
  execute_js: 'destructive'
};

// ── Communication Hub Tools ──
COBRA_TOOLS.push(
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Invia una email tramite SMTP. Richiede configurazione email attiva.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Indirizzo email destinatario' },
          subject: { type: 'string', description: 'Oggetto della email' },
          body: { type: 'string', description: 'Corpo del messaggio' },
          cc: { type: 'string', description: 'CC opzionale' }
        },
        required: ['to', 'subject', 'body']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_whatsapp',
      description: 'Invia un messaggio WhatsApp. Apre WhatsApp Web con il messaggio precompilato.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Numero di telefono con prefisso internazionale (es: +39335...)' },
          text: { type: 'string', description: 'Testo del messaggio (max 4096 caratteri)' }
        },
        required: ['phone', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_linkedin',
      description: 'Invia un messaggio LinkedIn. Accetta URL profilo o nome della persona.',
      parameters: {
        type: 'object',
        properties: {
          recipient: { type: 'string', description: 'URL profilo LinkedIn o nome della persona' },
          text: { type: 'string', description: 'Testo del messaggio (max 8000 caratteri)' }
        },
        required: ['recipient', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_emails',
      description: 'Controlla e sincronizza le email dalla casella di posta configurata.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_inbox',
      description: 'Legge le email recenti dalla casella di posta (max 200 cached).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Numero massimo di email da restituire (default 10)' }
        },
        required: []
      }
    }
  }
);

TOOL_RISK_MAP.send_email = 'risky';
TOOL_RISK_MAP.send_whatsapp = 'risky';
TOOL_RISK_MAP.send_linkedin = 'risky';
TOOL_RISK_MAP.check_emails = 'safe';
TOOL_RISK_MAP.read_inbox = 'safe';

self.COBRA_TOOLS = COBRA_TOOLS;
self.TOOL_RISK_MAP = TOOL_RISK_MAP;
console.log('[tool-registry.js] Loaded:', COBRA_TOOLS.length, 'tools registered');
