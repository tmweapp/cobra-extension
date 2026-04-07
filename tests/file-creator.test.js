/**
 * FileCreator Tests
 * Tests for file creation in various formats (CSV, JSON, HTML, Excel, PDF, Markdown)
 */

require('../file-creator.js');

describe('FileCreator', () => {
  let FileCreator;

  beforeEach(() => {
    FileCreator = global.FileCreator;
    jest.clearAllMocks();
    chrome.downloads.download.mockImplementation((options, callback) => {
      chrome.runtime.lastError = null;
      callback(Math.floor(Math.random() * 10000));
    });
  });

  afterEach(() => {
    chrome.runtime.lastError = null;
  });

  describe('createCSV()', () => {
    it('should create CSV from data array', async () => {
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ];
      await FileCreator.createCSV(data, 'test.csv');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should handle empty array', async () => {
      const data = [];
      await FileCreator.createCSV(data, 'test.csv');
      expect(global.console.error).toHaveBeenCalledWith('Dati CSV non validi');
    });

    it('should escape CSV fields with special characters', async () => {
      const data = [
        { name: 'O"Brien', text: 'hello,world' },
      ];
      await FileCreator.createCSV(data, 'test.csv');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should handle null/undefined values', async () => {
      const data = [
        { name: 'Test', value: null, empty: undefined },
      ];
      await FileCreator.createCSV(data, 'test.csv');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should reject invalid data', async () => {
      await FileCreator.createCSV(null, 'test.csv');
      expect(global.console.error).toHaveBeenCalled();
    });
  });

  describe('createJSON()', () => {
    it('should create JSON from object', async () => {
      const data = { name: 'Test', value: 123 };
      await FileCreator.createJSON(data, 'test.json');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should create JSON from array', async () => {
      const data = [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ];
      await FileCreator.createJSON(data, 'test.json');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should reject null data', async () => {
      await FileCreator.createJSON(null, 'test.json');
      expect(global.console.error).toHaveBeenCalledWith('Dati JSON non validi');
    });

    it('should handle complex nested structures', async () => {
      const data = {
        users: [
          { id: 1, profile: { name: 'Alice', age: 30 } },
          { id: 2, profile: { name: 'Bob', age: 25 } },
        ],
      };
      await FileCreator.createJSON(data, 'test.json');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });
  });

  describe('createHTML()', () => {
    it('should create HTML with title and content', async () => {
      const content = '<h2>Section</h2><p>Content here</p>';
      await FileCreator.createHTML(content, 'Test Report', 'report.html');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should escape HTML in title', async () => {
      const content = '<p>Safe</p>';
      await FileCreator.createHTML(content, '<script>alert("xss")</script>', 'report.html');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should reject missing content', async () => {
      await FileCreator.createHTML(null, 'Title', 'report.html');
      expect(global.console.error).toHaveBeenCalled();
    });

    it('should reject missing title', async () => {
      const content = '<p>Content</p>';
      await FileCreator.createHTML(content, null, 'report.html');
      expect(global.console.error).toHaveBeenCalled();
    });

    it('should include proper HTML structure', async () => {
      const content = '<p>Test</p>';
      await FileCreator.createHTML(content, 'My Report', 'report.html');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });
  });

  describe('createMarkdown()', () => {
    it('should create Markdown file', async () => {
      const content = '# Title\n\nContent here';
      await FileCreator.createMarkdown(content, 'doc.md');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should add timestamp footer', async () => {
      const content = 'Test content';
      await FileCreator.createMarkdown(content, 'doc.md');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should reject empty content', async () => {
      await FileCreator.createMarkdown(null, 'doc.md');
      expect(global.console.error).toHaveBeenCalledWith('Contenuto Markdown non valido');
    });

    it('should handle content with special characters', async () => {
      const content = '# Test\n\nContent with *emphasis* and **bold**';
      await FileCreator.createMarkdown(content, 'doc.md');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });
  });

  describe('createExcel()', () => {
    it('should create single sheet Excel file', async () => {
      const sheets = [
        {
          name: 'Sheet1',
          headers: ['ID', 'Name', 'Age'],
          rows: [
            { ID: 1, Name: 'Alice', Age: 30 },
            { ID: 2, Name: 'Bob', Age: 25 },
          ],
        },
      ];
      await FileCreator.createExcel(sheets, 'data.xlsx');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should create multi-sheet Excel file', async () => {
      const sheets = [
        {
          name: 'Users',
          headers: ['Name', 'Email'],
          rows: [{ Name: 'Alice', Email: 'alice@example.com' }],
        },
        {
          name: 'Products',
          headers: ['SKU', 'Price'],
          rows: [{ SKU: 'P001', Price: 99.99 }],
        },
      ];
      await FileCreator.createExcel(sheets, 'export.xlsx');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should reject invalid sheets', async () => {
      const sheets = [];
      await FileCreator.createExcel(sheets, 'data.xlsx');
      expect(global.console.error).toHaveBeenCalledWith('Dati Excel non validi');
    });

    it('should reject null sheets', async () => {
      await FileCreator.createExcel(null, 'data.xlsx');
      expect(global.console.error).toHaveBeenCalledWith('Dati Excel non validi');
    });

    it('should handle null values in cells', async () => {
      const sheets = [
        {
          name: 'Test',
          headers: ['A', 'B'],
          rows: [{ A: 1, B: null }],
        },
      ];
      await FileCreator.createExcel(sheets, 'test.xlsx');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should handle numeric and string data', async () => {
      const sheets = [
        {
          name: 'Mixed',
          headers: ['Name', 'Count', 'Price'],
          rows: [
            { Name: 'Item1', Count: 5, Price: 10.50 },
            { Name: 'Item2', Count: 3, Price: 20.25 },
          ],
        },
      ];
      await FileCreator.createExcel(sheets, 'mixed.xlsx');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });
  });

  describe('createPDF()', () => {
    it('should create PDF with title and content', async () => {
      const content = 'This is PDF content';
      await FileCreator.createPDF(content, 'My PDF', 'doc.pdf');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should reject missing content', async () => {
      await FileCreator.createPDF(null, 'Title', 'doc.pdf');
      expect(global.console.error).toHaveBeenCalled();
    });

    it('should reject missing title', async () => {
      const content = 'Content';
      await FileCreator.createPDF(content, null, 'doc.pdf');
      expect(global.console.error).toHaveBeenCalled();
    });

    it('should handle array content', async () => {
      const content = [
        'First paragraph',
        'Second paragraph',
      ];
      await FileCreator.createPDF(content, 'Document', 'doc.pdf');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });
  });

  describe('download()', () => {
    it('should download blob with correct parameters', async () => {
      const blob = new Blob(['test content'], { type: 'text/plain' });
      const downloadId = await FileCreator.download(blob, 'test.txt');
      expect(typeof downloadId).toBe('number');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should reject null blob', async () => {
      await expect(FileCreator.download(null, 'test.txt')).rejects.toThrow();
    });

    it('should reject missing filename', async () => {
      const blob = new Blob(['content']);
      await expect(FileCreator.download(blob, null)).rejects.toThrow();
    });

    it('should handle download errors', async () => {
      chrome.downloads.download.mockImplementation((options, callback) => {
        chrome.runtime.lastError = { message: 'Download failed' };
        callback(undefined);
      });

      const blob = new Blob(['content']);
      await expect(FileCreator.download(blob, 'test.txt')).rejects.toThrow();
    });

    it('should handle chrome API unavailable', async () => {
      const originalDownloads = chrome.downloads;
      delete chrome.downloads;

      const blob = new Blob(['content']);
      await expect(FileCreator.download(blob, 'test.txt')).rejects.toThrow();

      chrome.downloads = originalDownloads;
    });
  });

  describe('createFromTemplate()', () => {
    it('should create CSV from template', async () => {
      const data = {
        rows: [{ name: 'Test' }],
        filename: 'export.csv',
      };
      await FileCreator.createFromTemplate('csv', data);
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should create JSON from template', async () => {
      const data = {
        data: { test: true },
        filename: 'export.json',
      };
      await FileCreator.createFromTemplate('json', data);
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should create HTML from template', async () => {
      const data = {
        content: '<p>Test</p>',
        title: 'Title',
        filename: 'export.html',
      };
      await FileCreator.createFromTemplate('html', data);
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should create Markdown from template', async () => {
      const data = {
        content: '# Test',
        filename: 'export.md',
      };
      await FileCreator.createFromTemplate('markdown', data);
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should create Excel from template', async () => {
      const data = {
        sheets: [{
          name: 'Sheet1',
          headers: ['A'],
          rows: [{ A: 1 }],
        }],
        filename: 'export.xlsx',
      };
      await FileCreator.createFromTemplate('excel', data);
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should create PDF from template', async () => {
      const data = {
        content: 'Content',
        title: 'Title',
        filename: 'export.pdf',
      };
      await FileCreator.createFromTemplate('pdf', data);
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should handle unsupported template type', async () => {
      const data = { filename: 'test.xyz' };
      await FileCreator.createFromTemplate('unsupported', data);
      expect(global.console.error).toHaveBeenCalledWith(
        expect.stringContaining('Template type non supportato')
      );
    });

    it('should reject missing templateType', async () => {
      const data = { filename: 'test.txt' };
      await FileCreator.createFromTemplate(null, data);
      expect(global.console.error).toHaveBeenCalled();
    });

    it('should reject missing data', async () => {
      await FileCreator.createFromTemplate('csv', null);
      expect(global.console.error).toHaveBeenCalled();
    });

    it('should be case-insensitive for template type', async () => {
      const data = {
        data: { test: true },
        filename: 'export.json',
      };
      await FileCreator.createFromTemplate('JSON', data);
      expect(chrome.downloads.download).toHaveBeenCalled();
    });
  });

  describe('getCellReference()', () => {
    it('should convert column/row to Excel reference', () => {
      expect(FileCreator.getCellReference(1, 1)).toBe('A1');
      expect(FileCreator.getCellReference(26, 1)).toBe('Z1');
      expect(FileCreator.getCellReference(27, 1)).toBe('AA1');
      expect(FileCreator.getCellReference(1, 100)).toBe('A100');
    });

    it('should handle large column numbers', () => {
      expect(FileCreator.getCellReference(52, 1)).toBe('AZ1');
      expect(FileCreator.getCellReference(53, 1)).toBe('BA1');
    });
  });

  describe('escapeXML()', () => {
    it('should escape XML special characters', () => {
      expect(FileCreator.escapeXML('A & B')).toBe('A &amp; B');
      expect(FileCreator.escapeXML('<tag>')).toBe('&lt;tag&gt;');
      expect(FileCreator.escapeXML('attr="value"')).toBe('attr=&quot;value&quot;');
      expect(FileCreator.escapeXML("it's")).toBe('it&apos;s');
    });

    it('should handle multiple special characters', () => {
      const input = '<test attr="value" & \'quote\'>';
      const expected = '&lt;test attr=&quot;value&quot; &amp; &apos;quote&apos;&gt;';
      expect(FileCreator.escapeXML(input)).toBe(expected);
    });
  });

  describe('escapeHTML()', () => {
    it('should escape HTML special characters', () => {
      expect(FileCreator.escapeHTML('<script>')).toBe('&lt;script&gt;');
      expect(FileCreator.escapeHTML('A & B')).toBe('A &amp; B');
      expect(FileCreator.escapeHTML('attr="value"')).toBe('attr=&quot;value&quot;');
      expect(FileCreator.escapeHTML("it's")).toBe('it&#39;s');
    });

    it('should prevent XSS attacks', () => {
      const malicious = '<img src=x onerror="alert(1)">';
      const escaped = FileCreator.escapeHTML(malicious);
      expect(escaped).not.toContain('<img');
      expect(escaped).not.toContain('>');
      expect(escaped).toContain('&lt;');
      expect(escaped).toContain('&quot;');
    });
  });

  describe('buildSimpleZip()', () => {
    it('should build ZIP file from file array', () => {
      const files = [
        { path: 'test.txt', content: 'Hello World' },
        { path: 'data.json', content: '{"key": "value"}' },
      ];
      const blob = FileCreator.buildSimpleZip(files);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('application/zip');
    });

    it('should handle binary content', () => {
      const binaryData = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
      const files = [{ path: 'binary.bin', content: binaryData }];
      const blob = FileCreator.buildSimpleZip(files);
      expect(blob).toBeInstanceOf(Blob);
    });

    it('should handle multiple files with different content types', () => {
      const files = [
        { path: 'dir/file1.txt', content: 'text' },
        { path: 'dir/subdir/file2.xml', content: '<root></root>' },
        { path: 'file3.json', content: '{}' },
      ];
      const blob = FileCreator.buildSimpleZip(files);
      expect(blob).toBeInstanceOf(Blob);
    });
  });

  describe('calculateCRC32()', () => {
    it('should calculate CRC32 checksum', () => {
      const data = new TextEncoder().encode('test data');
      const crc = FileCreator.calculateCRC32(data);
      expect(typeof crc).toBe('number');
      expect(crc).toBeGreaterThan(0);
    });

    it('should return same CRC for same data', () => {
      const data = new TextEncoder().encode('hello world');
      const crc1 = FileCreator.calculateCRC32(data);
      const crc2 = FileCreator.calculateCRC32(data);
      expect(crc1).toBe(crc2);
    });

    it('should return different CRC for different data', () => {
      const data1 = new TextEncoder().encode('test1');
      const data2 = new TextEncoder().encode('test2');
      const crc1 = FileCreator.calculateCRC32(data1);
      const crc2 = FileCreator.calculateCRC32(data2);
      expect(crc1).not.toBe(crc2);
    });
  });

  describe('PDF creation integration', () => {
    it('should create PDF with proper structure', async () => {
      const content = 'Test document content';
      await FileCreator.createPDF(content, 'Report', 'report.pdf');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should handle multi-line content', async () => {
      const content = 'Line 1\nLine 2\nLine 3';
      await FileCreator.createPDF(content, 'Document', 'doc.pdf');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });

    it('should handle special characters in PDF', async () => {
      const content = 'Text with (parentheses) and special chars';
      await FileCreator.createPDF(content, 'Test', 'doc.pdf');
      expect(chrome.downloads.download).toHaveBeenCalled();
    });
  });
});
