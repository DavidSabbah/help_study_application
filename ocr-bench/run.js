const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const Tesseract = require('tesseract.js');

const root = path.join(__dirname, '..');
const fixtureDir = path.join(__dirname, 'fixtures');
const cases = [
  {
    name: 'monde-paien',
    roi: path.join(fixtureDir, 'roi.jpg'),
    expected: path.join(fixtureDir, 'expected.txt'),
    outText: path.join(__dirname, 'last-ocr.txt'),
    outImage: path.join(__dirname, 'last-cleaned.png')
  },
  {
    name: 'ombre',
    roi: path.join(fixtureDir, 'ombre', 'roi.jpg'),
    expected: path.join(fixtureDir, 'ombre', 'expected.txt'),
    outText: path.join(__dirname, 'last-ombre-ocr.txt'),
    outImage: path.join(__dirname, 'last-ombre-cleaned.png')
  }
];

function wrapCtx(ctx) {
  if (!ctx || ctx.__ocrWrapped) return ctx;
  const orig = ctx.drawImage.bind(ctx);
  ctx.drawImage = (img, ...rest) => orig(img && img.__napi ? img.__napi : img, ...rest);
  ctx.__ocrWrapped = true;
  return ctx;
}

function ImageShim() {
  this.onload = null;
  this.onerror = null;
  this.__napi = null;
  this.width = 0;
  this.height = 0;
  this.naturalWidth = 0;
  this.naturalHeight = 0;
}

Object.defineProperty(ImageShim.prototype, 'src', {
  set(value) {
    loadImage(value)
      .then((img) => {
        this.__napi = img;
        this.width = img.width;
        this.height = img.height;
        this.naturalWidth = img.width;
        this.naturalHeight = img.height;
        if (this.onload) this.onload();
      })
      .catch((err) => {
        if (this.onerror) this.onerror(err);
        else console.error(err);
      });
  }
});

function createDomCanvas() {
  const canvas = createCanvas(1, 1);
  const orig = canvas.getContext.bind(canvas);
  canvas.getContext = (type) => wrapCtx(orig(type));
  return canvas;
}

function loadAppScript() {
  const source = fs.readFileSync(
    path.join(root, 'src', 'components', 'TesseractOcrBridge.tsx'),
    'utf8'
  );
  const marker = 'const TESSERACT_WEBVIEW_HTML = ';
  const start = source.indexOf(marker);
  const end = source.indexOf('`;', start);
  if (start < 0 || end < 0) throw new Error('Could not find the OCR script in TesseractOcrBridge.tsx');
  const html = eval(source.slice(start + marker.length, end + 1));
  const codeStart = html.indexOf('var isJobRunning');
  const codeEnd = html.lastIndexOf('</script>');
  return html.slice(codeStart, codeEnd);
}

function normalizeText(value) {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[«»“”"'’.,;:!?()\[\]\-—–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  const n = left.length;
  const m = right.length;
  if (n === 0 && m === 0) return 1;
  if (n === 0 || m === 0) return 0;
  let prev = new Uint32Array(m + 1);
  let curr = new Uint32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    const ca = left.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ca === right.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  const dist = prev[m];
  return 1 - dist / Math.max(n, m);
}

async function main() {
  const code = loadAppScript();
  global.Image = ImageShim;
  global.addEventListener = function() {};
  global.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') throw new Error('Unsupported element ' + tag);
      return createDomCanvas();
    },
    addEventListener() {}
  };
  global.window = global;
  global.Tesseract = Tesseract;
  eval(code);

  let worker = null;
  for (let i = 0; i < cases.length; i++) {
    const item = cases[i];
    if (!fs.existsSync(item.roi)) {
      console.log('Missing ' + item.roi);
      continue;
    }
    console.log('');
    console.log('=== ' + item.name + ' ===');
    const jpeg = fs.readFileSync(item.roi);
    const b64 = jpeg.toString('base64');
    console.log('Preprocessing the saved ROI...');
    const pre = await preprocessBookImage(b64, {
      padding: 32,
      skipUpright: false,
      forOcr: true
    });
    const cleaned = Buffer.from(pre.base64, 'base64');
    fs.writeFileSync(item.outImage, cleaned);
    console.log(
      'Cleaned image ' +
        pre.stats.width +
        'x' +
        pre.stats.height +
        '  skew ' +
        pre.stats.skewAngle +
        '°  curve ' +
        pre.stats.curveShiftPx +
        'px'
    );
    console.log('Wrote ' + path.relative(root, item.outImage));

    console.log('Reading with Tesseract (fra)...');
    const bytes = base64ToUint8Array(pre.base64);
    if (!worker) worker = await getOrCreateWorker('fra');
    const recognized = await recognizeBest(worker, bytes, 'fra', '', 0, 1, pre.stats.lineGap || 0);
    const text = recognized.text || '';
    fs.writeFileSync(item.outText, text + (text.endsWith('\n') ? '' : '\n'), 'utf8');
    console.log('Confidence ' + Math.round(recognized.conf) + '%');
    console.log('Wrote ' + path.relative(root, item.outText));
    console.log('');
    console.log(text);

    if (fs.existsSync(item.expected)) {
      const expected = fs.readFileSync(item.expected, 'utf8');
      const score = similarity(text, expected);
      console.log('');
      console.log('Baseline similarity ' + Math.round(score * 1000) / 10 + '%');
      console.log('Baseline file ' + path.relative(root, item.expected));
    }
  }

  if (worker) await worker.terminate();
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
