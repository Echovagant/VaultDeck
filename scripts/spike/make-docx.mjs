import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';

import { ZipFile } from 'yazl';

const target = path.resolve(process.argv[2] ?? '_private/tmp/sample.docx');
mkdirSync(path.dirname(target), { recursive: true });

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>VaultDeck Office 预览测试</w:t></w:r></w:p>
    <w:p><w:r><w:t>第二段：转换后应可在浏览器内直接查看。</w:t></w:r></w:p>
  </w:body>
</w:document>`;

const zip = new ZipFile();
zip.addBuffer(Buffer.from(contentTypes, 'utf8'), '[Content_Types].xml');
zip.addBuffer(Buffer.from(relationships, 'utf8'), '_rels/.rels');
zip.addBuffer(Buffer.from(documentXml, 'utf8'), 'word/document.xml');
zip.end();

await new Promise((resolve, reject) => {
  const output = createWriteStream(target);
  output.on('close', resolve);
  output.on('error', reject);
  zip.outputStream.on('error', reject);
  zip.outputStream.pipe(output);
});

console.log(target);
