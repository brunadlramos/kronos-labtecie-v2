// ── KRONOS · XLSX-LITE ──────────────────────────────────────────────────────
// Gerador de planilhas .xlsx (Excel) autocontido — sem CDN, sem bibliotecas.
// Monta um pacote OOXML mínimo (workbook + 1 aba) e o empacota num ZIP "store"
// (sem compressão) com CRC32. Abre no Excel/LibreOffice/Google Sheets sem aviso
// de formato. Uso: downloadXlsx('arquivo.xlsx', 'Aba', aoa) onde aoa é um array
// de linhas; cada célula pode ser string (texto) ou number (numérica).

// ── CRC32 ───────────────────────────────────────────────────────────────────
const _CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = _CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const _enc = new TextEncoder();
function xmlEsc(s) {
  return String(s)
    // Remove caracteres de controle inválidos em XML 1.0 (só \t \n \r são permitidos
    // abaixo de 0x20); um único caractere inválido corromperia a planilha inteira.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}
function colLetter(i) { // 0 -> A, 25 -> Z, 26 -> AA …
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// ── Monta o XML da planilha a partir do array-de-arrays ────────────────────────
function sheetXml(aoa) {
  let rows = '';
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] || [];
    let cells = '';
    for (let c = 0; c < row.length; c++) {
      const ref = colLetter(c) + (r + 1);
      const v = row[c];
      if (v == null || v === '') { continue; }
      if (typeof v === 'number' && isFinite(v)) {
        cells += `<c r="${ref}"><v>${v}</v></c>`;
      } else {
        cells += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      }
    }
    rows += `<row r="${r + 1}">${cells}</row>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

function workbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

const _RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const _WB_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
const _CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

// ── ZIP (método "store", sem compressão) ───────────────────────────────────────
function u16(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]); }
function u32(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]); }

function zip(files) { // files: [{name, data:Uint8Array}]
  const chunks = [];
  const central = [];
  let offset = 0;
  const push = (arr) => { chunks.push(arr); offset += arr.length; };

  for (const f of files) {
    const nameBytes = _enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const localOffset = offset;
    // Local file header
    push(u32(0x04034b50));
    push(u16(20));          // version needed
    push(u16(0));           // flags
    push(u16(0));           // compression = store
    push(u16(0)); push(u16(0)); // mod time / date
    push(u32(crc));
    push(u32(size));        // compressed size
    push(u32(size));        // uncompressed size
    push(u16(nameBytes.length));
    push(u16(0));           // extra len
    push(nameBytes);
    push(f.data);
    // Central directory record (guardado p/ o fim)
    const c = [];
    c.push(u32(0x02014b50));
    c.push(u16(20)); c.push(u16(20)); // version made by / needed
    c.push(u16(0)); c.push(u16(0));   // flags / compression
    c.push(u16(0)); c.push(u16(0));   // mod time / date
    c.push(u32(crc)); c.push(u32(size)); c.push(u32(size));
    c.push(u16(nameBytes.length));
    c.push(u16(0)); c.push(u16(0));   // extra / comment len
    c.push(u16(0)); c.push(u16(0));   // disk start / internal attrs
    c.push(u32(0));                   // external attrs
    c.push(u32(localOffset));
    c.push(nameBytes);
    central.push(...c);
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const arr of central) { push(arr); cdSize += arr.length; }

  // End of central directory
  push(u32(0x06054b50));
  push(u16(0)); push(u16(0));         // disk numbers
  push(u16(files.length)); push(u16(files.length));
  push(u32(cdSize)); push(u32(cdStart));
  push(u16(0));                       // comment len

  // Concatena tudo
  const total = chunks.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const a of chunks) { out.set(a, p); p += a.length; }
  return out;
}

// ── API pública ────────────────────────────────────────────────────────────────
export function buildXlsx(sheetName, aoa) {
  const files = [
    { name: '[Content_Types].xml', data: _enc.encode(_CONTENT_TYPES) },
    { name: '_rels/.rels', data: _enc.encode(_RELS) },
    { name: 'xl/workbook.xml', data: _enc.encode(workbookXml(sheetName || 'Planilha')) },
    { name: 'xl/_rels/workbook.xml.rels', data: _enc.encode(_WB_RELS) },
    { name: 'xl/worksheets/sheet1.xml', data: _enc.encode(sheetXml(aoa || [])) },
  ];
  return zip(files);
}

export function downloadXlsx(filename, sheetName, aoa) {
  const bytes = buildXlsx(sheetName, aoa);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
