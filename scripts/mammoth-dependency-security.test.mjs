// Dependency compatibility guard. No network, credentials, or live application data.
// Runtime is deliberately bounded; all documents and outputs are disposable fixtures.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(process.env.RA_MAMMOTH_TEST_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const req = createRequire(path.join(root, 'package.json'));
const mammoth = req('mammoth');
const mammothReq = createRequire(req.resolve('mammoth'));
const JSZip = mammothReq('jszip');
const packagePath = req.resolve('mammoth/package.json');
const mammothDir = path.dirname(packagePath);
const cli = path.join(mammothDir, 'bin', 'mammoth');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-mammoth-check-'));
after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const input = path.join(temporary, 'document with spaces.docx');
const expected = '<p><strong>RideArrivo</strong> dependency check</p><p>Safe &amp; readable.</p>';
const zip = new JSZip();
zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>RideArrivo</w:t></w:r><w:r><w:t xml:space="preserve"> dependency check</w:t></w:r></w:p><w:p><w:r><w:t>Safe &amp; readable.</w:t></w:r></w:p></w:body></w:document>');
const buffer = await zip.generateAsync({ type: 'nodebuffer' });
fs.writeFileSync(input, buffer);
let reportedWarnings = false;
function invoke(t, args, status = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: temporary, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `CLI terminated by ${result.signal}`);
  assert.equal(result.status, status, `CLI status mismatch. stderr:\n${result.stderr}`);
  if (!reportedWarnings && /DeprecationWarning/.test(result.stderr)) {
    t.diagnostic('Mammoth CLI uses legacy argparse aliases. These deprecation warnings are retained, not treated as a security fix.');
    t.diagnostic(result.stderr.trim());
    reportedWarnings = true;
  }
  return result;
}

test('security: the locked Mammoth parser chain excludes sprintf-js', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.ok(lock.packages, 'Expected an npm lockfile with a packages map.');
  const offenders = Object.keys(lock.packages).filter(key => /(^|\/)node_modules\/sprintf-js$/.test(key));
  assert.deepEqual(offenders, [], 'SPRINTF_DEPENDENCY_PRESENT');
  assert.equal(JSON.parse(fs.readFileSync(packagePath, 'utf8')).version, '1.13.0');
  const parser = mammothReq('argparse/package.json');
  assert.equal(parser.version, '2.0.1', 'The parser resolved by Mammoth must be the tested version.');
  assert.equal(parser.dependencies?.['sprintf-js'], undefined);
});
test('Node DOCX conversion preserves text, bold formatting and escaping', { timeout: 10000 }, async () => {
  const result = await mammoth.convertToHtml({ buffer }, { externalFileAccess: false });
  assert.equal(result.value, expected);
});
test('browser bundle converts an ArrayBuffer DOCX', { timeout: 10000 }, async () => {
  const browser = req('mammoth/mammoth.browser.js');
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const result = await browser.convertToHtml({ arrayBuffer }, { externalFileAccess: false });
  assert.equal(result.value, expected);
});
test('CLI help still lists input and output options', t => {
  const result = invoke(t, ['--help']);
  assert.match(result.stdout, /docx-path/);
  assert.match(result.stdout, /--style-map/);
  assert.match(result.stdout, /--output-dir/);
});
test('CLI converts a DOCX with spaces in its path to stdout', t => {
  assert.equal(invoke(t, [input]).stdout.trim(), expected);
});
test('CLI writes to an explicit output file', t => {
  const output = path.join(temporary, 'chosen output.html');
  invoke(t, [input, output]);
  assert.equal(fs.readFileSync(output, 'utf8').trim(), expected);
});
test('CLI output-dir still chooses the correct output filename', t => {
  const directory = path.join(temporary, 'export');
  fs.mkdirSync(directory);
  invoke(t, [input, '--output-dir', directory]);
  assert.equal(fs.readFileSync(path.join(directory, 'document with spaces.html'), 'utf8').trim(), expected);
});
test('CLI applies an explicit style-map file', t => {
  const mapping = path.join(temporary, 'styles.txt');
  fs.writeFileSync(mapping, 'p => h2:fresh\n');
  assert.equal(invoke(t, [input, '--style-map', mapping]).stdout.trim(), expected.replace(/<p>/g, '<h2>').replace(/<\/p>/g, '</h2>'));
});
test('CLI accepts the documented Markdown output choice', t => {
  const result = invoke(t, [input, '--output-format', 'markdown']);
  assert.match(result.stdout, /RideArrivo/);
  assert.match(result.stdout, /dependency check/);
  assert.doesNotMatch(result.stdout, /<p>|<strong>/);
});
test('CLI rejects an invalid output format before conversion', t => {
  assert.match(invoke(t, [input, '--output-format', 'invalid'], 2).stderr, /invalid choice/i);
});
test('CLI rejects mutually exclusive output options', t => {
  assert.match(invoke(t, [input, path.join(temporary, 'unused.html'), '--output-dir', temporary], 2).stderr, /not allowed with|mutually exclusive/i);
});
test('CLI rejects a missing input file argument', t => {
  assert.match(invoke(t, [], 2).stderr, /required|too few arguments/i);
});
