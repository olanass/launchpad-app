const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('sell files: preview follows file/text precedence without publishing or revealing private text', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/client/index.html'), 'utf8');
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, {
    value: '', textContent: '', style: {}, events: {}, attributes: {},
    addEventListener(type, fn) { this.events[type] = fn; },
    setAttribute(key, value) { this.attributes[key] = value; },
    focus() {}, contains() { return false; },
    classList: { add() {}, remove() {} }
  }]));
  const get = id => nodes.get(id);
  get('assetCurrency').value = 'USDC';
  get('textInputWrapper').style.display = 'none';
  const context = vm.createContext({
    state: { selectedFile: null },
    document: { getElementById: get },
    fetch() { assert.fail('Editing a listing preview must not publish content'); }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/client/scripts/creator.js'), 'utf8'), context);
  vm.runInContext('initFileUpload()', context);
  get('textContentInput').value = 'PRIVATE PAID CONTENT';
  get('textContentInput').events.input();
  assert.equal(get('sellPreviewFile').textContent, 'Text content');
  assert.ok(![...nodes.values()].some(node => node.textContent.includes('PRIVATE PAID CONTENT')));
  vm.runInContext("handleFileSelected({name: 'report.pdf', size: 1024})", context);
  assert.equal(get('sellPreviewFile').textContent, 'report.pdf');
  assert.equal(get('sellPreviewTitle').textContent, 'report');
  get('assetPrice').value = '0.025';
  get('assetCurrency').value = 'ETH';
  get('assetCurrency').events.input();
  assert.equal(get('sellPreviewPrice').textContent, '0.025 ETH');
  get('btnRemoveFile').events.click({ stopPropagation() {} });
  assert.equal(get('sellPreviewFile').textContent, 'Text content');
  get('textContentInput').value = '';
  get('textContentInput').events.input();
  assert.equal(get('sellPreviewFile').textContent, 'No content selected');
  get('btnToggleTextInput').events.click();
  assert.equal(get('btnToggleTextInput').attributes['aria-expanded'], 'true');
  get('btnToggleTextInput').events.click();
  assert.equal(get('btnToggleTextInput').attributes['aria-expanded'], 'false');
  let pickerOpens = 0;
  get('fileInput').click = () => { pickerOpens++; };
  get('dropZone').events.click({ target: get('btnBrowseFile') });
  get('dropZone').events.click({ target: get('fileInput') });
  assert.equal(pickerOpens, 1);
});
