/**
 * FileCreator - Modulo per creazione file scaricabili (Excel, PDF, Documents)
 * COBRA v4.0 - Chrome Extension
 *
 * Gestisce la creazione e il download di file in diversi formati
 * senza dipendenze esterne, utilizzando solo API native del browser.
 */

class FileCreator {
  /**
   * Crea un file CSV dai dati forniti
   * @param {Array<Object>} data - Array di oggetti da convertire in CSV
   * @param {String} filename - Nome del file da scaricare
   */
  static async createCSV(data, filename) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      console.error('Dati CSV non validi');
      return;
    }

    // Estrae le intestazioni dalla prima riga
    const headers = Object.keys(data[0]);

    // Funzione per escapare i campi CSV
    const escapeCSVField = (field) => {
      if (field === null || field === undefined) return '""';
      const stringField = String(field);
      if (stringField.includes('"') || stringField.includes(',') || stringField.includes('\n')) {
        return '"' + stringField.replace(/"/g, '""') + '"';
      }
      return stringField;
    };

    // Costruisce l'intestazione
    let csv = headers.map(escapeCSVField).join(',') + '\n';

    // Costruisce le righe
    data.forEach(row => {
      const rowValues = headers.map(header => escapeCSVField(row[header] ?? ''));
      csv += rowValues.join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    await FileCreator.download(blob, filename);
  }

  /**
   * Crea un file JSON dai dati forniti
   * @param {Object|Array} data - Dati da convertire in JSON
   * @param {String} filename - Nome del file da scaricare
   */
  static async createJSON(data, filename) {
    if (!data) {
      console.error('Dati JSON non validi');
      return;
    }

    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    await FileCreator.download(blob, filename);
  }

  /**
   * Crea un file HTML stilizzato con il contenuto fornito
   * @param {String} content - Contenuto HTML da inserire nel body
   * @param {String} title - Titolo del documento HTML
   * @param {String} filename - Nome del file da scaricare
   */
  static async createHTML(content, title, filename) {
    if (!content || !title) {
      console.error('Contenuto o titolo HTML non validi');
      return;
    }

    const htmlContent = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${FileCreator.escapeHTML(title)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background-color: #ffffff;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    h1 {
      border-bottom: 3px solid #2c3e50;
      padding-bottom: 10px;
      margin-bottom: 20px;
      color: #2c3e50;
    }
    h2 {
      color: #34495e;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    h3 {
      color: #7f8c8d;
      margin-top: 15px;
      margin-bottom: 8px;
    }
    p {
      margin-bottom: 15px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #bdc3c7;
    }
    th {
      background-color: #ecf0f1;
      font-weight: 600;
      color: #2c3e50;
    }
    tr:hover {
      background-color: #f9f9f9;
    }
    code {
      background-color: #ecf0f1;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }
    pre {
      background-color: #2c3e50;
      color: #ecf0f1;
      padding: 15px;
      border-radius: 5px;
      overflow-x: auto;
      margin: 15px 0;
    }
    pre code {
      background-color: transparent;
      padding: 0;
      color: inherit;
    }
    ul, ol {
      margin-left: 20px;
      margin-bottom: 15px;
    }
    li {
      margin-bottom: 8px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #bdc3c7;
      font-size: 12px;
      color: #7f8c8d;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${FileCreator.escapeHTML(title)}</h1>
    ${content}
    <div class="footer">
      <p>Generato da COBRA v4.0 - ${new Date().toLocaleString('it-IT')}</p>
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    await FileCreator.download(blob, filename);
  }

  /**
   * Crea un file Markdown
   * @param {String} content - Contenuto del file Markdown
   * @param {String} filename - Nome del file da scaricare
   */
  static async createMarkdown(content, filename) {
    if (!content) {
      console.error('Contenuto Markdown non valido');
      return;
    }

    const markdown = content + '\n\n---\n' +
      `*Generato da COBRA v4.0 il ${new Date().toLocaleString('it-IT')}*\n`;

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
    await FileCreator.download(blob, filename);
  }

  /**
   * Crea un file Excel (.xlsx) in formato Office Open XML
   * @param {Array<{name, headers, rows}>} sheets - Array di fogli con struttura {name, headers, rows}
   * @param {String} filename - Nome del file da scaricare
   */
  static async createExcel(sheets, filename) {
    if (!sheets || !Array.isArray(sheets) || sheets.length === 0) {
      console.error('Dati Excel non validi');
      return;
    }

    // Crea il file XLSX come archivio ZIP con file XML interni
    const xmlSheets = [];
    const sheetRelationships = [];
    let sheetIndex = 1;

    sheets.forEach((sheet, idx) => {
      const { name, headers, rows } = sheet;

      // Valida i dati del foglio
      if (!name || !headers || !Array.isArray(rows)) {
        console.error(`Foglio ${idx} non valido`);
        return;
      }

      // Converte i dati in formato Excel (XML)
      let sheetXML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
        '<sheetData>\n';

      // Riga di intestazione
      sheetXML += '<row r="1">\n';
      headers.forEach((header, col) => {
        const cellRef = FileCreator.getCellReference(col + 1, 1);
        const escapedHeader = FileCreator.escapeXML(String(header));
        sheetXML += `<c r="${cellRef}" t="inlineStr"><is><t>${escapedHeader}</t></is></c>\n`;
      });
      sheetXML += '</row>\n';

      // Righe dati
      rows.forEach((row, rowIdx) => {
        const rowNum = rowIdx + 2;
        sheetXML += `<row r="${rowNum}">\n`;
        headers.forEach((header, col) => {
          const cellRef = FileCreator.getCellReference(col + 1, rowNum);
          const value = row[header] ?? '';
          const escapedValue = FileCreator.escapeXML(String(value));
          const cellType = typeof row[header] === 'number' ? '' : ' t="inlineStr"';
          sheetXML += `<c r="${cellRef}"${cellType}><is><t>${escapedValue}</t></is></c>\n`;
        });
        sheetXML += '</row>\n';
      });

      sheetXML += '</sheetData>\n</worksheet>';
      xmlSheets.push({ name: `sheet${sheetIndex}.xml`, content: sheetXML });
      sheetRelationships.push({ id: sheetIndex, name: name || `Foglio${sheetIndex}` });
      sheetIndex++;
    });

    // Crea il file [Content_Types].xml
    let contentTypesXML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
      '<Default Extension="xml" ContentType="application/xml"/>\n';
    xmlSheets.forEach(sheet => {
      contentTypesXML += '<Override PartName="/xl/worksheets/' + sheet.name + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n';
    });
    contentTypesXML += '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n' +
      '<Override PartName="/xl/_rels/workbook.xml.rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
      '<Override PartName="/_rels/.rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
      '</Types>';

    // Crea il workbook.xml
    let workbookXML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
      '<sheets>\n';
    sheetRelationships.forEach((rel, idx) => {
      workbookXML += `<sheet name="${FileCreator.escapeXML(rel.name)}" sheetId="${idx + 1}" r:id="rId${rel.id}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>\n`;
    });
    workbookXML += '</sheets>\n</workbook>';

    // Crea il workbook.xml.rels
    let workbookRelsXML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n';
    xmlSheets.forEach((sheet, idx) => {
      workbookRelsXML += `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sheet.name}"/>\n`;
    });
    workbookRelsXML += '<Relationship Id="rId' + (xmlSheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n' +
      '</Relationships>';

    // Crea lo styles.xml minimalista
    const stylesXML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
      '<numFmts count="0"/>\n' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>\n' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>\n' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>\n' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\n' +
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>\n' +
      '</styleSheet>';

    // Crea il .rels root
    const rootRelsXML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n' +
      '</Relationships>';

    // Assembla il file XLSX come ZIP
    await FileCreator.createZipFile(
      [
        { path: '[Content_Types].xml', content: contentTypesXML },
        { path: '_rels/.rels', content: rootRelsXML },
        { path: 'xl/workbook.xml', content: workbookXML },
        { path: 'xl/_rels/workbook.xml.rels', content: workbookRelsXML },
        { path: 'xl/styles.xml', content: stylesXML },
        ...xmlSheets.map(sheet => ({ path: `xl/worksheets/${sheet.name}`, content: sheet.content }))
      ],
      filename
    );
  }

  /**
   * Crea un file PDF minimale con testo, titolo e tabelle
   * @param {String|Object} content - Contenuto del PDF (stringhe, paragrafi, tabelle)
   * @param {String} title - Titolo del documento PDF
   * @param {String} filename - Nome del file da scaricare
   */
  static async createPDF(content, title, filename) {
    if (!content || !title) {
      console.error('Contenuto o titolo PDF non validi');
      return;
    }

    const pdfContent = new PDFBuilder()
      .addTitle(title)
      .addContent(content)
      .build();

    const blob = new Blob([pdfContent], { type: 'application/pdf' });
    await FileCreator.download(blob, filename);
  }

  /**
   * Scarica un blob con il nome file specificato
   * Converte il Blob a data URL e usa chrome.downloads.download API (MV3 service worker compatible)
   * @param {Blob} blob - Blob da scaricare
   * @param {String} filename - Nome del file
   * @returns {Promise<number>} Promise che si risolve con l'ID del download
   */
  static async download(blob, filename) {
    if (!blob || !filename) {
      console.error('Blob o filename non valido');
      throw new Error('Blob o filename non valido');
    }

    // Converti il Blob a data URL usando FileReader
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // Usa chrome.downloads.download API con data URL
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.downloads) {
        reject(new Error('chrome.downloads API non disponibile'));
        return;
      }

      chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      });
    });
  }

  /**
   * Factory method per creare file da un template type
   * @param {String} templateType - Tipo di template ('csv', 'json', 'html', 'excel', 'pdf', 'markdown')
   * @param {Object} data - Dati da usare per la creazione
   * @returns {Promise<void>}
   */
  static async createFromTemplate(templateType, data) {
    if (!templateType || !data) {
      console.error('templateType o data non validi');
      return;
    }

    const type = templateType.toLowerCase();

    switch (type) {
      case 'csv':
        await FileCreator.createCSV(data.rows, data.filename);
        break;
      case 'json':
        await FileCreator.createJSON(data.data, data.filename);
        break;
      case 'html':
        await FileCreator.createHTML(data.content, data.title, data.filename);
        break;
      case 'markdown':
        await FileCreator.createMarkdown(data.content, data.filename);
        break;
      case 'excel':
        await FileCreator.createExcel(data.sheets, data.filename);
        break;
      case 'pdf':
        await FileCreator.createPDF(data.content, data.title, data.filename);
        break;
      default:
        console.error(`Template type non supportato: ${type}`);
    }
  }

  /**
   * Converte colonna e riga numeriche in riferimento cella Excel (es. A1, B2)
   * @private
   * @param {Number} col - Numero colonna (1-based)
   * @param {Number} row - Numero riga (1-based)
   * @returns {String} Riferimento cella
   */
  static getCellReference(col, row) {
    let colRef = '';
    while (col > 0) {
      col--;
      colRef = String.fromCharCode(65 + (col % 26)) + colRef;
      col = Math.floor(col / 26);
    }
    return colRef + row;
  }

  /**
   * Escapa i caratteri speciali XML
   * @private
   * @param {String} str - Stringa da escapare
   * @returns {String} Stringa escapata
   */
  static escapeXML(str) {
    const xmlChars = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;'
    };
    return str.replace(/[&<>"']/g, (char) => xmlChars[char]);
  }

  /**
   * Escapa i caratteri speciali HTML
   * @private
   * @param {String} str - Stringa da escapare
   * @returns {String} Stringa escapata
   */
  static escapeHTML(str) {
    const htmlChars = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return str.replace(/[&<>"']/g, (char) => htmlChars[char]);
  }

  /**
   * Crea un file ZIP da un array di file
   * @private
   * @param {Array<{path, content}>} files - Array di file con path e content
   * @param {String} filename - Nome del file ZIP da scaricare
   * @returns {Promise<number>} Promise che si risolve con l'ID del download
   */
  static async createZipFile(files, filename) {
    // Implementazione minimale di ZIP usando deflate (senza librerie esterne)
    // Per XLSX, usiamo un approccio semplificato usando il formato ZIP

    const zipBlob = FileCreator.buildSimpleZip(files);
    return await FileCreator.download(zipBlob, filename);
  }

  /**
   * Costruisce un file ZIP semplice senza compressione (store method)
   * @private
   * @param {Array<{path, content}>} files - File da includere
   * @returns {Blob} Blob ZIP
   */
  static buildSimpleZip(files) {
    const encoder = new TextEncoder();
    const chunks = [];

    const centralDir = [];
    let offset = 0;

    // Aggiunge ogni file al ZIP
    files.forEach((file, index) => {
      const fileData = typeof file.content === 'string'
        ? encoder.encode(file.content)
        : file.content;

      const filename = file.path;
      const filenameBytes = encoder.encode(filename);

      // Local file header
      const localHeader = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04, // Signature
        0x14, 0x00, // Version needed
        0x00, 0x00, // Flags
        0x00, 0x00, // Compression method (0 = store)
        0x00, 0x00, // Last mod time
        0x00, 0x00, // Last mod date
        0x00, 0x00, 0x00, 0x00, // CRC-32 (non-zero per store)
        0x00, 0x00, 0x00, 0x00, // Compressed size
        0x00, 0x00, 0x00, 0x00, // Uncompressed size
        (filenameBytes.length & 0xFF), ((filenameBytes.length >> 8) & 0xFF), // Filename length
        0x00, 0x00 // Extra field length
      ]);

      // Calcola CRC-32 semplice
      const crc32 = FileCreator.calculateCRC32(fileData);

      // Aggiorna il local header con CRC e dimensioni
      const dataView = new DataView(localHeader.buffer);
      dataView.setUint32(14, crc32, true);
      dataView.setUint32(18, fileData.length, true);
      dataView.setUint32(22, fileData.length, true);

      const localHeaderWithMeta = new Uint8Array(
        localHeader.length + filenameBytes.length + fileData.length
      );
      localHeaderWithMeta.set(localHeader, 0);
      localHeaderWithMeta.set(filenameBytes, localHeader.length);
      localHeaderWithMeta.set(fileData, localHeader.length + filenameBytes.length);

      chunks.push(localHeaderWithMeta);

      // Salva info per central directory
      centralDir.push({
        offset: offset,
        filename: filename,
        filenameBytes: filenameBytes,
        fileData: fileData,
        crc32: crc32,
        size: fileData.length
      });

      offset += localHeaderWithMeta.length;
    });

    // Costruisce la central directory
    const centralDirData = [];
    let centralDirSize = 0;
    const centralDirOffset = offset;

    centralDir.forEach((entry) => {
      const cdEntry = new Uint8Array([
        0x50, 0x4b, 0x01, 0x02, // Central file header signature
        0x14, 0x00, // Version made by
        0x14, 0x00, // Version needed
        0x00, 0x00, // Flags
        0x00, 0x00, // Compression method
        0x00, 0x00, // Last mod time
        0x00, 0x00, // Last mod date
        (entry.crc32 & 0xFF), ((entry.crc32 >> 8) & 0xFF), ((entry.crc32 >> 16) & 0xFF), ((entry.crc32 >> 24) & 0xFF),
        (entry.size & 0xFF), ((entry.size >> 8) & 0xFF), ((entry.size >> 16) & 0xFF), ((entry.size >> 24) & 0xFF),
        (entry.size & 0xFF), ((entry.size >> 8) & 0xFF), ((entry.size >> 16) & 0xFF), ((entry.size >> 24) & 0xFF),
        (entry.filenameBytes.length & 0xFF), ((entry.filenameBytes.length >> 8) & 0xFF),
        0x00, 0x00, // Extra field
        0x00, 0x00, // File comment
        0x00, 0x00, // Disk number
        0x00, 0x00, // Internal attributes
        0x00, 0x00, 0x00, 0x00, // External attributes
        (entry.offset & 0xFF), ((entry.offset >> 8) & 0xFF), ((entry.offset >> 16) & 0xFF), ((entry.offset >> 24) & 0xFF)
      ]);

      const cdEntryWithMeta = new Uint8Array(cdEntry.length + entry.filenameBytes.length);
      cdEntryWithMeta.set(cdEntry, 0);
      cdEntryWithMeta.set(entry.filenameBytes, cdEntry.length);

      centralDirData.push(cdEntryWithMeta);
      centralDirSize += cdEntryWithMeta.length;
    });

    // End of central directory record
    const endOfCD = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, // End of central dir signature
      0x00, 0x00, // Disk number
      0x00, 0x00, // Disk with central directory
      (centralDir.length & 0xFF), ((centralDir.length >> 8) & 0xFF), // Entries on this disk
      (centralDir.length & 0xFF), ((centralDir.length >> 8) & 0xFF), // Total entries
      (centralDirSize & 0xFF), ((centralDirSize >> 8) & 0xFF), ((centralDirSize >> 16) & 0xFF), ((centralDirSize >> 24) & 0xFF),
      (centralDirOffset & 0xFF), ((centralDirOffset >> 8) & 0xFF), ((centralDirOffset >> 16) & 0xFF), ((centralDirOffset >> 24) & 0xFF),
      0x00, 0x00 // Comment length
    ]);

    // Assembla il file ZIP
    const allChunks = [...chunks, ...centralDirData, endOfCD];
    return new Blob(allChunks, { type: 'application/zip' });
  }

  /**
   * Calcola il CRC-32 di un array di byte
   * @private
   * @param {Uint8Array} data - Dati
   * @returns {Number} CRC-32
   */
  static calculateCRC32(data) {
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[n] = c >>> 0;
    }

    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
}

/**
 * Classe ausiliaria per costruire PDF minimali
 * Supporta: titolo, paragrafi, testo semplice
 */
class PDFBuilder {
  constructor() {
    this.content = [];
    this.objects = [];
    this.objectOffsets = [];
  }

  addTitle(title) {
    this.content.push({ type: 'title', text: title });
    return this;
  }

  addContent(content) {
    if (typeof content === 'string') {
      this.content.push({ type: 'paragraph', text: content });
    } else if (Array.isArray(content)) {
      content.forEach(item => {
        if (typeof item === 'string') {
          this.content.push({ type: 'paragraph', text: item });
        } else if (item.type === 'table') {
          this.content.push(item);
        }
      });
    } else if (typeof content === 'object') {
      this.content.push(content);
    }
    return this;
  }

  build() {
    // Crea un PDF minimalista in formato raw
    let pdf = '%PDF-1.4\n';

    // Oggetto 1: Catalogo
    this.addObject('1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n');

    // Oggetto 2: Pagine
    this.addObject('2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n');

    // Genera il contenuto della pagina
    let contentString = 'BT\n';
    contentString += '/F1 24 Tf\n';
    contentString += '50 750 Td\n';
    contentString += `(${this.escapeText(this.content[0]?.text || 'Documento')}) Tj\n`;
    contentString += '0 -30 Td\n';
    contentString += '/F1 12 Tf\n';

    this.content.forEach((item, idx) => {
      if (idx === 0) return; // Salta il titolo già aggiunto
      if (item.type === 'paragraph') {
        contentString += `(${this.escapeText(item.text)}) Tj\n`;
        contentString += '0 -15 Td\n';
      } else if (item.type === 'table') {
        // Tabella semplice
        contentString += '(Tabella:) Tj\n0 -15 Td\n';
      }
    });

    contentString += 'ET\n';

    // Oggetto 3: Pagina
    const contentObj = this.content.length + 3;
    this.addObject('3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ' + contentObj + ' 0 R /Resources <</Font <</F1 4 0 R>>>>>>\nendobj\n');

    // Oggetto 4: Font
    this.addObject('4 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>\nendobj\n');

    // Oggetto contenuto
    this.addObject(contentObj + ' 0 obj\n<</Length ' + contentString.length + '>>\nstream\n' + contentString + '\nendstream\nendobj\n');

    // Calcola gli offset degli oggetti
    const xrefOffset = pdf.length;
    pdf += this.objects.join('');

    // Cross-reference table
    pdf += 'xref\n';
    pdf += '0 ' + (this.objects.length + 1) + '\n';
    pdf += '0000000000 65535 f\n';

    for (const offset of this.objectOffsets) {
      pdf += offset.toString().padStart(10, '0') + ' 00000 n\n';
    }

    // Trailer
    pdf += 'trailer\n';
    pdf += '<</Size ' + (this.objects.length + 1) + ' /Root 1 0 R>>\n';
    pdf += 'startxref\n';
    pdf += xrefOffset + '\n';
    pdf += '%%EOF\n';

    return pdf;
  }

  addObject(obj) {
    this.objectOffsets.push(this.objects.join('').length + '%PDF-1.4\n'.length);
    this.objects.push(obj);
  }

  escapeText(text) {
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
}

if (typeof self !== 'undefined') {
  self.FileCreator = FileCreator;
}
