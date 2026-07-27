"use strict";
/* ============================================================
   QR CODE  —  a small self-contained encoder (byte mode, level M)
   ============================================================
   Written here rather than pulled in, because of the rule the rest of the app
   already follows: nothing is fetched from a third party. Every "QR code API"
   on the web means POSTing the list to a stranger's server to be handed a
   picture back — and a shopping list says where somebody shops, what they eat
   and how many of them there are. That is a poor trade for ~200 lines of
   arithmetic that runs offline.

   Deliberately narrow:
     - byte mode (UTF-8), which encodes anything a shopping list contains;
     - error-correction level M (15%), the usual choice for a screen;
     - versions 1..QR_MAX. Past that the modules are too fine for a phone to
       read off a laptop screen, so qrEncode() returns null and the caller
       offers the text file instead of drawing something that will not scan.

   Everything here is ISO/IEC 18004. The two tables are the parts the standard
   does not let you derive; everything else is computed, which is both shorter
   and harder to typo.
   ============================================================ */

/* 20 is a scannability limit, not a format one — a v20 code is 97×97 modules,
   which is about as fine as a phone camera manages off a laptop screen. */
const QR_MAX = 20;

/* Error-correction codewords per block, and number of blocks, by version, at
   level M. Index 0 is unused so the version number indexes directly. */
const QR_ECC_PER_BLOCK = [0,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26];
const QR_BLOCKS        = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9,10,10,11,13,14,16];

/* Capacity follows from the module count: all the modules, less the function
   patterns, rounded down to whole codewords. */
function qrRawDataModules(ver){
  let n = (16*ver + 128)*ver + 64;
  if(ver >= 2){ const a = Math.floor(ver/7) + 2; n -= (25*a - 10)*a - 55; }   // alignment patterns
  if(ver >= 7) n -= 36;                                                        // the two version blocks
  return n;
}
function qrTotalCodewords(ver){ return Math.floor(qrRawDataModules(ver)/8); }
function qrDataCapacity(ver){ return qrTotalCodewords(ver) - QR_ECC_PER_BLOCK[ver]*QR_BLOCKS[ver]; }

/* ---------- GF(256), for Reed–Solomon ----------
   The field the standard uses, primitive polynomial 0x11D. Log/antilog tables
   turn multiplication into an addition of exponents. */
const QR_EXP = new Uint8Array(512), QR_LOG = new Uint8Array(256);
(function(){
  let x = 1;
  for(let i=0;i<255;i++){ QR_EXP[i] = x; QR_LOG[x] = i; x <<= 1; if(x & 0x100) x ^= 0x11D; }
  for(let i=255;i<512;i++) QR_EXP[i] = QR_EXP[i-255];        // doubled, so log sums never need a modulo
})();
function qrMul(a, b){ return (a === 0 || b === 0) ? 0 : QR_EXP[QR_LOG[a] + QR_LOG[b]]; }

// The divisor polynomial (x−α⁰)(x−α¹)… , descending powers, leading coefficient 1.
function qrGenerator(degree){
  let poly = [1];
  for(let i=0;i<degree;i++){
    const next = new Array(poly.length + 1).fill(0);
    for(let j=0;j<poly.length;j++){ next[j] ^= poly[j]; next[j+1] ^= qrMul(poly[j], QR_EXP[i]); }
    poly = next;
  }
  return poly;
}
// Polynomial long division; the remainder is the block's error-correction codewords.
function qrRemainder(data, degree){
  const gen = qrGenerator(degree), res = new Uint8Array(degree);
  for(const b of data){
    const factor = b ^ res[0];
    res.copyWithin(0, 1); res[degree-1] = 0;
    for(let i=0;i<degree;i++) res[i] ^= qrMul(gen[i+1], factor);
  }
  return res;
}

/* ---------- the data codewords ----------
   Mode indicator, character count, the bytes, a terminator, then alternating
   pad bytes to fill the version exactly. Returns null when it does not fit. */
function qrEncodeData(bytes, ver){
  // The character-count field is 8 bits below version 10, so 256 bytes cannot
  // be *counted* there however much room the version has. Without this the
  // length would silently wrap to 0 and the code would scan as empty.
  if(ver < 10 && bytes.length > 255) return null;
  const capBits = qrDataCapacity(ver) * 8, bits = [];
  const push = (val, len) => { for(let i=len-1;i>=0;i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);                                    // byte mode
  push(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach(b => push(b, 8));
  if(bits.length > capBits) return null;
  push(0, Math.min(4, capBits - bits.length));        // terminator, truncated if it does not fit
  while(bits.length % 8) bits.push(0);
  const out = new Uint8Array(qrDataCapacity(ver));
  for(let i=0;i<bits.length;i+=8){ let v = 0; for(let j=0;j<8;j++) v = (v<<1) | bits[i+j]; out[i>>3] = v; }
  for(let i=bits.length/8, pad=0xEC; i<out.length; i++, pad ^= 0xEC ^ 0x11) out[i] = pad;
  return out;
}

/* Split into blocks, add each block's error correction, then interleave — so a
   scuff on the code damages a few codewords of every block rather than
   destroying one block outright. */
function qrInterleave(data, ver){
  const blocks = QR_BLOCKS[ver], eccLen = QR_ECC_PER_BLOCK[ver];
  const shortLen = Math.floor(data.length / blocks);
  const numShort = blocks - (data.length % blocks);      // the rest carry one codeword more
  const dat = [], ecc = [];
  for(let i=0, off=0; i<blocks; i++){
    const len = shortLen + (i < numShort ? 0 : 1);
    const blk = data.slice(off, off + len); off += len;
    dat.push(blk); ecc.push(qrRemainder(blk, eccLen));
  }
  const out = [];
  for(let i=0;i<=shortLen;i++) dat.forEach(b => { if(i < b.length) out.push(b[i]); });
  for(let i=0;i<eccLen;i++) ecc.forEach(e => out.push(e[i]));
  return Uint8Array.from(out);
}

/* ---------- the module grid ---------- */
// Where the alignment patterns go: always 6 and size−7, evenly spaced between.
function qrAlignPositions(ver){
  if(ver === 1) return [];
  const n = Math.floor(ver/7) + 2, size = ver*4 + 17;
  const step = Math.ceil((ver*4 + 4) / (n*2 - 2)) * 2;
  const pos = [6];
  for(let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
  return pos;
}

const QR_MASKS = [
  (y,x) => (x + y) % 2 === 0,
  (y,x) => y % 2 === 0,
  (y,x) => x % 3 === 0,
  (y,x) => (x + y) % 3 === 0,
  (y,x) => (Math.floor(y/2) + Math.floor(x/3)) % 2 === 0,
  (y,x) => (x*y) % 2 + (x*y) % 3 === 0,
  (y,x) => ((x*y) % 2 + (x*y) % 3) % 2 === 0,
  (y,x) => ((x + y) % 2 + (x*y) % 3) % 2 === 0
];

/* The four penalties from the standard, scoring how hard a masked grid is to
   read. Lowest total wins; that is the whole of mask selection. */
function qrPenalty(mod, size){
  let p = 0;
  const at = (vertical, i, j) => vertical ? mod[j][i] : mod[i][j];
  // 1 — runs of five or more of one colour, along both axes.
  for(let i=0;i<size;i++) for(let v=0;v<2;v++){
    let run = 1, prev = -1;
    for(let j=0;j<size;j++){
      const m = at(v, i, j);
      if(m === prev) run++; else { if(run >= 5) p += 3 + (run - 5); run = 1; prev = m; }
    }
    if(run >= 5) p += 3 + (run - 5);
  }
  // 2 — any 2×2 of one colour.
  for(let y=0;y<size-1;y++) for(let x=0;x<size-1;x++){
    const m = mod[y][x];
    if(m === mod[y][x+1] && m === mod[y+1][x] && m === mod[y+1][x+1]) p += 3;
  }
  // 3 — anything that looks like a finder pattern (1:1:3:1:1 with four light
  //     modules beside it), which is what a scanner hunts for first.
  const A = [1,0,1,1,1,0,1,0,0,0,0], B = [0,0,0,0,1,0,1,1,1,0,1];
  for(let i=0;i<size;i++) for(let v=0;v<2;v++) for(let j=0;j+11<=size;j++){
    let a = true, b = true;
    for(let k=0;k<11;k++){ const m = at(v, i, j+k); if(m !== A[k]) a = false; if(m !== B[k]) b = false; }
    if(a) p += 40;
    if(b) p += 40;
  }
  // 4 — how far off an even dark/light split the whole grid is.
  let dark = 0;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) dark += mod[y][x];
  p += Math.floor(Math.abs(dark*100/(size*size) - 50)/5) * 10;
  return p;
}

/* Builds the grid for one version: function patterns, then the codewords
   zig-zagged into what is left, then the best of the eight masks. */
function qrBuildMatrix(ver, codewords){
  const size = ver*4 + 17;
  const mod = [], fn = [];
  for(let i=0;i<size;i++){ mod.push(new Array(size).fill(0)); fn.push(new Array(size).fill(false)); }
  const set = (x, y, dark) => { if(x>=0 && x<size && y>=0 && y<size){ mod[y][x] = dark ? 1 : 0; fn[y][x] = true; } };

  // Finder patterns with their separators — one 9×9 stamp per corner. Chebyshev
  // distance from the centre gives the rings: 0-1 dark, 2 light, 3 dark, 4 the
  // separator. Off-grid edges are dropped by set().
  [[3,3],[size-4,3],[3,size-4]].forEach(([cx,cy]) => {
    for(let dy=-4;dy<=4;dy++) for(let dx=-4;dx<=4;dx++){
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(cx+dx, cy+dy, d !== 2 && d !== 4);
    }
  });
  // Timing patterns, run only between the finders — the finder rows already
  // carry their own modules and overwriting them would break the parity.
  for(let i=8;i<size-8;i++){ set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // Alignment patterns, minus the three corners already occupied by finders.
  const ap = qrAlignPositions(ver), last = ap.length - 1;
  ap.forEach((y, i) => ap.forEach((x, j) => {
    if((i===0 && j===0) || (i===0 && j===last) || (i===last && j===0)) return;
    for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++)
      set(x+dx, y+dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  set(8, size-8, true);                                     // the module that is always dark

  /* Format info: EC level and mask, BCH(15,5)-protected and XORed with 0x5412
     so an all-zero pattern cannot occur. Drawn twice, in two different places,
     because losing a corner must not cost the reader the mask number. Written
     once here to reserve the modules, then again with the mask that wins. */
  const drawFormat = (mask) => {
    const dataBits = (0 << 3) | mask;                       // 0b00 = level M
    let rem = dataBits;
    for(let i=0;i<10;i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((dataBits << 10) | rem) ^ 0x5412;
    const bit = i => (bits >>> i) & 1;
    for(let i=0;i<=5;i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for(let i=9;i<15;i++) set(14 - i, 8, bit(i));
    for(let i=0;i<8;i++) set(size-1-i, 8, bit(i));
    for(let i=8;i<15;i++) set(8, size-15+i, bit(i));
    set(8, size-8, true);
  };
  drawFormat(0);
  // Version info, from version 7 up: BCH(18,6), again in two places.
  if(ver >= 7){
    let rem = ver;
    for(let i=0;i<12;i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = (ver << 12) | rem;
    for(let i=0;i<18;i++){
      const b = (bits >>> i) & 1, a = size - 11 + i % 3, c = Math.floor(i/3);
      set(a, c, b); set(c, a, b);
    }
  }

  /* The codewords, two modules wide, snaking up and down the right-hand side.
     Column 6 is skipped whole — it is the vertical timing pattern. */
  let bit = 0;
  for(let right = size - 1; right >= 1; right -= 2){
    if(right === 6) right = 5;
    for(let v=0; v<size; v++) for(let j=0;j<2;j++){
      const x = right - j;
      const y = ((right + 1) & 2) === 0 ? size - 1 - v : v;    // alternate direction per column pair
      if(!fn[y][x] && bit < codewords.length*8){
        mod[y][x] = (codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1;
        bit++;
      }
    }
  }

  // Try all eight masks, keep the one the standard's penalties like best.
  let best = 0, bestScore = Infinity;
  for(let m=0;m<8;m++){
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) if(!fn[y][x] && QR_MASKS[m](y,x)) mod[y][x] ^= 1;
    drawFormat(m);
    const score = qrPenalty(mod, size);
    if(score < bestScore){ bestScore = score; best = m; }
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) if(!fn[y][x] && QR_MASKS[m](y,x)) mod[y][x] ^= 1;   // undo
  }
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) if(!fn[y][x] && QR_MASKS[best](y,x)) mod[y][x] ^= 1;
  drawFormat(best);
  return { version:ver, size, mask:best, modules:mod, functions:fn };
}

/* The whole job: text in, grid out. null means it will not fit in a version
   this small — the caller says so rather than drawing an unscannable code. */
function qrEncode(text, maxVersion){
  const bytes = new TextEncoder().encode(String(text == null ? '' : text));
  const max = Math.min(maxVersion || QR_MAX, QR_MAX);
  for(let ver=1; ver<=max; ver++){
    const data = qrEncodeData(bytes, ver);
    if(data) return qrBuildMatrix(ver, qrInterleave(data, ver));
  }
  return null;
}
// How many UTF-8 bytes still fit — for telling someone their list is too long.
function qrCapacityBytes(maxVersion){
  const ver = Math.min(maxVersion || QR_MAX, QR_MAX);
  return qrDataCapacity(ver) - (ver < 10 ? 2 : 3);          // mode + character count
}

/* One <path> rather than a rect per module: a few thousand elements is slow to
   lay out, and adjacent rects show hairline seams when the browser scales them.
   The four-module quiet zone is required — without it a scanner may not find
   the code at all. Black on white explicitly, never themed: the contrast is
   what makes it readable. */
function qrSvg(qr, label){
  const quiet = 4, dim = qr.size + quiet*2;
  let d = '';
  for(let y=0;y<qr.size;y++) for(let x=0;x<qr.size;x++)
    if(qr.modules[y][x]) d += 'M' + (x+quiet) + ' ' + (y+quiet) + 'h1v1h-1z';
  return '<svg class="qr" viewBox="0 0 ' + dim + ' ' + dim + '" xmlns="http://www.w3.org/2000/svg" ' +
         'shape-rendering="crispEdges" role="img" aria-label="' + esc(label || '') + '">' +
         '<rect width="' + dim + '" height="' + dim + '" fill="#fff"/>' +
         '<path d="' + d + '" fill="#000"/></svg>';
}
