// COBRA v3 — Content Script
// Estrae contenuto principale → Markdown pulito
// Fix: usa Array.join() invece di concatenazione O(n²)

(() => {
  const NOISE_SELECTORS = [
    'nav', 'header', 'footer',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '.nav', '.navbar', '.header', '.footer', '.sidebar',
    '.menu', '.breadcrumb', '.pagination',
    '.ad', '.ads', '.advert', '.advertisement', '[class*="ad-"]', '[id*="ad-"]',
    '.cookie', '.cookie-banner', '[class*="cookie"]',
    '.popup', '.modal', '.overlay',
    '.social-share', '.share-buttons', '[class*="social"]',
    '.comments', '#comments', '.comment-section',
    'script', 'style', 'noscript', 'iframe', 'svg',
    '[aria-hidden="true"]',
    '.skip-link', '.sr-only',
    'form:not([role="search"])',
  ];

  const MAIN_SELECTORS = [
    'main', 'article', '[role="main"]',
    '#content', '#main-content', '.main-content',
    '.post-content', '.article-content', '.entry-content',
    '.page-content', '.content',
  ];

  function getMainContent() {
    for (const sel of MAIN_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 200) {
        return el.cloneNode(true);
      }
    }
    return document.body.cloneNode(true);
  }

  function removeNoise(root) {
    for (const sel of NOISE_SELECTORS) {
      root.querySelectorAll(sel).forEach(el => el.remove());
    }
    root.querySelectorAll('[style]').forEach(el => {
      const s = el.style;
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') {
        el.remove();
      }
    });
    return root;
  }

  // --- Conversione HTML → Markdown (con string builder) ---

  function htmlToMarkdown(element) {
    const parts = [];
    for (const node of element.childNodes) {
      parts.push(nodeToMarkdown(node));
    }
    return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  function nodeToMarkdown(node, depth = 0) {
    // Deep recursion guard
    if (depth > 50) return node.textContent || '';

    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const inner = () => {
      const parts = [];
      for (const c of node.childNodes) parts.push(nodeToMarkdown(c, depth + 1));
      return parts.join('');
    };

    switch (tag) {
      case 'h1': return `\n\n# ${inner().trim()}\n\n`;
      case 'h2': return `\n\n## ${inner().trim()}\n\n`;
      case 'h3': return `\n\n### ${inner().trim()}\n\n`;
      case 'h4': return `\n\n#### ${inner().trim()}\n\n`;
      case 'h5': return `\n\n##### ${inner().trim()}\n\n`;
      case 'h6': return `\n\n###### ${inner().trim()}\n\n`;

      case 'p': return `\n\n${inner().trim()}\n\n`;
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';
      case 'blockquote': return `\n\n> ${inner().trim().replace(/\n/g, '\n> ')}\n\n`;

      case 'ul':
      case 'ol':
        return '\n\n' + listToMarkdown(node, tag === 'ol') + '\n\n';
      case 'li':
        return inner().trim();

      case 'strong':
      case 'b': {
        const t = inner().trim();
        return t ? `**${t}**` : '';
      }
      case 'em':
      case 'i': {
        const t = inner().trim();
        return t ? `*${t}*` : '';
      }
      case 'code': return `\`${inner().trim()}\``;
      case 'pre': {
        const code = node.querySelector('code');
        const lang = code?.className?.match(/language-(\w+)/)?.[1] || '';
        const text = (code || node).textContent.trim();
        return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
      }

      case 'a': {
        const href = node.getAttribute('href');
        const text = inner().trim();
        if (!text) return '';
        if (!href || href === '#') return text;
        try {
          const abs = new URL(href, document.location.href).href;
          return `[${text}](${abs})`;
        } catch {
          return text;
        }
      }
      case 'img': {
        const src = node.getAttribute('src');
        const alt = node.getAttribute('alt') || 'image';
        if (!src) return '';
        try {
          const abs = new URL(src, document.location.href).href;
          return `![${alt}](${abs})`;
        } catch {
          return '';
        }
      }

      case 'table': return '\n\n' + tableToMarkdown(node) + '\n\n';

      case 'figure': return `\n\n${inner().trim()}\n\n`;
      case 'figcaption': return `_${inner().trim()}_\n`;
      case 'details':
      case 'summary':
        return `\n\n${inner().trim()}\n\n`;
      case 'mark': return `==${inner().trim()}==`;
      case 'time': {
        const datetime = node.getAttribute('datetime');
        return datetime || inner().trim();
      }
      case 'abbr': {
        const title = node.getAttribute('title');
        const text = inner().trim();
        return title ? `${text} (${title})` : text;
      }
      case 'section':
      case 'aside':
        return `\n\n${inner().trim()}\n\n`;

      default:
        return inner();
    }
  }

  function listToMarkdown(listEl, ordered) {
    const items = [];
    let i = 1;
    for (const li of listEl.children) {
      if (li.tagName?.toLowerCase() === 'li') {
        const text = nodeToMarkdown(li).trim();
        const prefix = ordered ? `${i}. ` : '- ';
        items.push(prefix + text);
        i++;
      }
    }
    return items.join('\n');
  }

  function tableToMarkdown(table) {
    const rows = [];
    table.querySelectorAll('tr').forEach(tr => {
      const cells = [];
      tr.querySelectorAll('th, td').forEach(cell => {
        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
        const content = nodeToMarkdown(cell).trim().replace(/\|/g, '\\|');
        // Repeat content across columns for colspan
        for (let j = 0; j < colspan; j++) {
          cells.push(content);
        }
      });
      rows.push(cells);
    });
    if (rows.length === 0) return '';

    const colCount = Math.max(...rows.map(r => r.length));
    const normalize = row => {
      while (row.length < colCount) row.push('');
      return row;
    };

    const parts = [];
    parts.push('| ' + normalize(rows[0]).join(' | ') + ' |');
    parts.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
    for (let r = 1; r < rows.length; r++) {
      parts.push('| ' + normalize(rows[r]).join(' | ') + ' |');
    }
    return parts.join('\n');
  }

  // --- Metadata ---

  function getMetadata() {
    return {
      title: document.title || '',
      url: document.location.href,
      description: document.querySelector('meta[name="description"]')?.content || '',
      author: document.querySelector('meta[name="author"]')?.content || '',
      date: document.querySelector('meta[property="article:published_time"]')?.content
        || document.querySelector('time[datetime]')?.getAttribute('datetime') || '',
      lang: document.documentElement.lang || '',
    };
  }

  // --- Main ---

  const root = removeNoise(getMainContent());
  const markdown = htmlToMarkdown(root);
  const metadata = getMetadata();

  // Componi output con string builder
  const outputParts = [`# ${metadata.title}\n\n`];
  if (metadata.url) outputParts.push(`> Source: ${metadata.url}\n`);
  if (metadata.author) outputParts.push(`> Author: ${metadata.author}\n`);
  if (metadata.date) outputParts.push(`> Date: ${metadata.date}\n`);
  if (metadata.description) outputParts.push(`> ${metadata.description}\n`);
  outputParts.push('\n---\n\n');
  outputParts.push(markdown);
  const output = outputParts.join('');

  // Word count fix: count from text content, not markdown
  const wordCountText = output.replace(/[#*`\[\]()>-]/g, '').split(/\s+/).filter(w => w.length > 0).length;

  return { markdown: output, metadata, stats: {
    chars: output.length,
    words: wordCountText,
    readingTime: Math.ceil(wordCountText / 200) + ' min'
  }};
})();
