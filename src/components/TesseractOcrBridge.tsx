import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { OcrLanguageCode, RoiBox } from '../types';

export interface PreprocessStats {
  rot90?: number;
  skewAngle: number;
  curveShiftPx: number;
  width: number;
  height: number;
}

export interface TesseractOcrBridgeHandle {
  recognizeRois: (
    rois: RoiBox[],
    langs: OcrLanguageCode[],
    preprocess?: boolean
  ) => void;
  enhanceImage: (base64: string) => void;
  /** Stack cropped regions into one JPEG, raw base64, for a single paste. */
  stitchImages: (images: string[]) => Promise<string>;
}

interface TesseractOcrBridgeProps {
  onProgress: (status: string, percent: number) => void;
  onComplete: (
    text: string,
    processedRois?: string[],
    stats?: PreprocessStats[]
  ) => void;
  onEnhanceComplete?: (
    base64: string,
    stats: PreprocessStats
  ) => void;
  onError: (err: string) => void;
}

const TESSERACT_WEBVIEW_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script>
    // 1. Prevent SecurityError when accessing storage getters in WebView about:blank origin
    try { Object.defineProperty(window, 'indexedDB', { get: function() { return undefined; }, configurable: true }); } catch (e) {}
    try { Object.defineProperty(window, 'localStorage', { get: function() { return undefined; }, configurable: true }); } catch (e) {}
    try { Object.defineProperty(window, 'sessionStorage', { get: function() { return undefined; }, configurable: true }); } catch (e) {}
    try { Object.defineProperty(window, 'caches', { get: function() { return undefined; }, configurable: true }); } catch (e) {}

    // 2. Inject the same indexedDB/caches guard inside Tesseract's Blob Web Worker
    var OrigBlob = window.Blob;
    window.Blob = function(parts, options) {
      if (Array.isArray(parts) && typeof parts[0] === 'string' && parts[0].indexOf('importScripts') !== -1) {
        var workerShim = [
          "try { Object.defineProperty(self, 'indexedDB', { get: function() { return undefined; }, configurable: true }); } catch (e) {}",
          "try { Object.defineProperty(self, 'caches', { get: function() { return undefined; }, configurable: true }); } catch (e) {}",
          "try { Object.defineProperty(self, 'localStorage', { get: function() { return undefined; }, configurable: true }); } catch (e) {}"
        ].join('\\n') + '\\n';
        parts = [workerShim + parts[0]].concat(parts.slice(1));
      }
      return new OrigBlob(parts, options);
    };
    window.Blob.prototype = OrigBlob.prototype;
  </script>
  <script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
</head>
<body>
<script>
  var isJobRunning = false;
  // Keep initialized workers cached in memory by language string so we do NOT re-download or re-init WASM every time
  var workersByLang = {};

  function postToRN(payload) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  function base64ToUint8Array(b64) {
    var clean = b64.indexOf(',') !== -1 ? b64.split(',')[1] : b64;
    var bin = window.atob(clean);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }

  function loadImageFromBase64(b64) {
    return new Promise(function(resolve, reject) {
      var img = new Image();
      img.onload = function() { resolve(img); };
      img.onerror = function() { reject(new Error('Failed to decode image for preprocessing')); };
      var clean = b64.indexOf('data:image') === 0 ? b64 : 'data:image/jpeg;base64,' + b64;
      img.src = clean;
    });
  }

  // Build 1-based Summed-Area Table (Integral Image) of dimensions (W+1) x (H+1)
  function buildIntegralUint32(src, W, H) {
    var stride = W + 1;
    var sat = new Uint32Array(stride * (H + 1));
    for (var y = 0; y < H; y++) {
      var rowSum = 0;
      var srcRow = y * W;
      var satRow = (y + 1) * stride;
      var prevSatRow = y * stride;
      for (var x = 0; x < W; x++) {
        rowSum += src[srcRow + x];
        sat[satRow + x + 1] = sat[prevSatRow + x + 1] + rowSum;
      }
    }
    return sat;
  }

  function buildIntegralSquaresFloat64(src, W, H) {
    var stride = W + 1;
    var satSq = new Float64Array(stride * (H + 1));
    for (var y = 0; y < H; y++) {
      var rowSum = 0;
      var srcRow = y * W;
      var satRow = (y + 1) * stride;
      var prevSatRow = y * stride;
      for (var x = 0; x < W; x++) {
        var v = src[srcRow + x];
        rowSum += v * v;
        satSq[satRow + x + 1] = satSq[prevSatRow + x + 1] + rowSum;
      }
    }
    return satSq;
  }

  function boxSum(sat, stride, x0, y0, x1, y1) {
    var A = y0 * stride + x0;
    var B = y0 * stride + (x1 + 1);
    var C = (y1 + 1) * stride + x0;
    var D = (y1 + 1) * stride + (x1 + 1);
    return sat[D] - sat[B] - sat[C] + sat[A];
  }

  function rotate90CCW(src, W, H) {
    var newW = H;
    var newH = W;
    var dst = new Uint8Array(newW * newH);
    for (var y = 0; y < H; y++) {
      var srcRow = y * W;
      for (var x = 0; x < W; x++) {
        var dstY = W - 1 - x;
        dst[dstY * newW + y] = src[srcRow + x];
      }
    }
    return { data: dst, width: newW, height: newH };
  }

  function rotate180(src, W, H) {
    var len = W * H;
    var dst = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      dst[i] = src[len - 1 - i];
    }
    return dst;
  }

  // Check if straightened horizontal text lines are upside down using baseline vs ascender derivative asymmetry
  function isTextUpsideDown(norm, W, H) {
    var x0 = Math.floor(W * 0.25);
    var x1 = Math.floor(W * 0.75);
    var y0 = Math.floor(H * 0.20);
    var y1 = Math.floor(H * 0.80);
    if (x1 - x0 < 60 || y1 - y0 < 60) return false;

    var prof = new Float64Array(H);
    for (var y = y0; y < y1; y++) {
      var row = y * W;
      var s = 0;
      for (var x = x0; x < x1; x++) {
        var v = norm[row + x];
        if (v < 195) s += 195 - v;
      }
      prof[y] = s;
    }

    var rise3 = 0;
    var fall3 = 0;
    for (var y2 = y0 + 2; y2 < y1 - 2; y2++) {
      var d = prof[y2] - prof[y2 - 2];
      if (d > 0) rise3 += d * d * d;
      else fall3 += (-d) * (-d) * (-d);
    }
    return rise3 > fall3 * 1.2;
  }

  // Rotate grayscale buffer by -angleDeg using bilinear interpolation with white fill
  function rotateGrayscale(src, W, H, angleDeg) {
    if (Math.abs(angleDeg) < 0.4) return src;
    var dst = new Uint8Array(W * H);
    var rad = (angleDeg * Math.PI) / 180.0;
    var cosA = Math.cos(rad);
    var sinA = Math.sin(rad);
    var cx = W * 0.5;
    var cy = H * 0.5;

    for (var y = 0; y < H; y++) {
      var dy = y - cy;
      var dstRow = y * W;
      for (var x = 0; x < W; x++) {
        var dx = x - cx;
        var sx = dx * cosA - dy * sinA + cx;
        var sy = dx * sinA + dy * cosA + cy;
        if (sx < 0 || sx >= W - 1 || sy < 0 || sy >= H - 1) {
          dst[dstRow + x] = 255;
        } else {
          var x0 = sx | 0;
          var y0 = sy | 0;
          var fx = sx - x0;
          var fy = sy - y0;
          var idx00 = y0 * W + x0;
          var v00 = src[idx00];
          var v10 = src[idx00 + 1];
          var v01 = src[idx00 + W];
          var v11 = src[idx00 + W + 1];
          var top = v00 + fx * (v10 - v00);
          var bot = v01 + fx * (v11 - v01);
          dst[dstRow + x] = Math.round(top + fy * (bot - top));
        }
      }
    }
    return dst;
  }

  // Book-photo cleanup for OCR.
  // Shadows are lifted by dividing by the local paper color (a small max-filter,
  // wider than a pen stroke and narrower than a shadow). Letters stay grayscale:
  // Tesseract's own binarizer keeps accents and thin strokes, a hard threshold does not.
  // A sideways page is turned upright only when text-line spacing is clearly vertical.
  // A small tilt is deskewed. Each text line is fitted with its own cubic and pulled flat.

  function solveSymmetric3(a00, a01, a02, a11, a12, a22, b0, b1, b2) {
    var r11 = a11;
    var r12 = a12;
    var c1 = b1;
    var r21 = a12;
    var r22 = a22;
    var c2 = b2;
    if (Math.abs(a00) < 1e-10) return null;
    var k1 = a01 / a00;
    r11 -= k1 * a01;
    r12 -= k1 * a02;
    c1 -= k1 * b0;
    var k2 = a02 / a00;
    r21 -= k2 * a01;
    r22 -= k2 * a02;
    c2 -= k2 * b0;
    if (Math.abs(r11) < 1e-10) return null;
    var k3 = r21 / r11;
    r22 -= k3 * r12;
    c2 -= k3 * c1;
    if (Math.abs(r22) < 1e-10) return null;
    var c = c2 / r22;
    var b = (c1 - r12 * c) / r11;
    var a = (b0 - a01 * b - a02 * c) / a00;
    return { a: a, b: b, c: c };
  }

  function estimatePaperBackground(lum, W, H, radiusPx) {
    var factor = 6;
    var wS = Math.max(1, Math.ceil(W / factor));
    var hS = Math.max(1, Math.ceil(H / factor));
    var small = new Uint8Array(wS * hS);
    for (var by = 0; by < hS; by++) {
      var y0 = by * factor;
      var y1 = Math.min(H, y0 + factor);
      for (var bx = 0; bx < wS; bx++) {
        var x0 = bx * factor;
        var x1 = Math.min(W, x0 + factor);
        var maxV = 0;
        var sum = 0;
        var n = 0;
        for (var y = y0; y < y1; y++) {
          var row = y * W;
          for (var x = x0; x < x1; x++) {
            var v = lum[row + x];
            if (v > maxV) maxV = v;
            sum += v;
            n++;
          }
        }
        var mean = sum / Math.max(1, n);
        small[by * wS + bx] = maxV > mean + 40 ? Math.min(255, Math.round(mean + 22)) : maxV;
      }
    }

    var autoRadius = Math.max(22, Math.min(36, Math.round(Math.min(W, H) / 42)));
    var desired = radiusPx > 0 ? radiusPx : autoRadius;
    var rad = Math.max(2, Math.round(desired / factor));
    var tmp = new Uint8Array(wS * hS);
    var dil = new Uint8Array(wS * hS);
    for (var y = 0; y < hS; y++) {
      var rowS = y * wS;
      for (var x = 0; x < wS; x++) {
        var m = 0;
        var xa = x - rad; if (xa < 0) xa = 0;
        var xb = x + rad; if (xb >= wS) xb = wS - 1;
        for (var xx = xa; xx <= xb; xx++) {
          if (small[rowS + xx] > m) m = small[rowS + xx];
        }
        tmp[rowS + x] = m;
      }
    }
    for (var y2 = 0; y2 < hS; y2++) {
      var ya = y2 - rad; if (ya < 0) ya = 0;
      var yb = y2 + rad; if (yb >= hS) yb = hS - 1;
      for (var x2 = 0; x2 < wS; x2++) {
        var m2 = 0;
        for (var yy = ya; yy <= yb; yy++) {
          if (tmp[yy * wS + x2] > m2) m2 = tmp[yy * wS + x2];
        }
        dil[y2 * wS + x2] = m2;
      }
    }

    var satS = buildIntegralUint32(dil, wS, hS);
    var strideS = wS + 1;
    var bgSmall = new Uint8Array(wS * hS);
    for (var y3 = 0; y3 < hS; y3++) {
      var by0 = y3 - 1; if (by0 < 0) by0 = 0;
      var by1 = y3 + 1; if (by1 >= hS) by1 = hS - 1;
      for (var x3 = 0; x3 < wS; x3++) {
        var bx0 = x3 - 1; if (bx0 < 0) bx0 = 0;
        var bx1 = x3 + 1; if (bx1 >= wS) bx1 = wS - 1;
        var count = (bx1 - bx0 + 1) * (by1 - by0 + 1);
        bgSmall[y3 * wS + x3] = boxSum(satS, strideS, bx0, by0, bx1, by1) / count;
      }
    }

    var bg = new Uint8Array(W * H);
    var maxX = wS - 1;
    var maxY = hS - 1;
    for (var y4 = 0; y4 < H; y4++) {
      var gy = (y4 + 0.5) / factor - 0.5;
      if (gy < 0) gy = 0;
      if (gy > maxY) gy = maxY;
      var iy = gy | 0;
      var iy2 = iy < maxY ? iy + 1 : iy;
      var fy = gy - iy;
      var rowOut = y4 * W;
      var rowA = iy * wS;
      var rowB = iy2 * wS;
      for (var x4 = 0; x4 < W; x4++) {
        var gx = (x4 + 0.5) / factor - 0.5;
        if (gx < 0) gx = 0;
        if (gx > maxX) gx = maxX;
        var ix = gx | 0;
        var ix2 = ix < maxX ? ix + 1 : ix;
        var fx = gx - ix;
        var v00 = bgSmall[rowA + ix];
        var v10 = bgSmall[rowA + ix2];
        var v01 = bgSmall[rowB + ix];
        var v11 = bgSmall[rowB + ix2];
        var top = v00 + fx * (v10 - v00);
        var bot = v01 + fx * (v11 - v01);
        bg[rowOut + x4] = top + fy * (bot - top) + 0.5;
      }
    }
    return bg;
  }

  function flattenIllumination(lum, bg, gentle) {
    var n = lum.length;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var b = bg[i];
      if (b < 16) b = 16;
      var ratio = lum[i] / b;
      if (ratio > 1.2) ratio = 1.2;
      var lifted;
      if (ratio >= 0.94) lifted = 255;
      else if (gentle) lifted = ratio * 255;
      else lifted = Math.pow(ratio, 0.8) * 255;
      if (lifted < 0) lifted = 0;
      else if (lifted > 255) lifted = 255;
      out[i] = lifted + 0.5;
    }
    return out;
  }

  function contrastStretch(src) {
    var n = src.length;
    var hist = new Uint32Array(256);
    for (var i = 0; i < n; i++) hist[src[i]]++;
    var loCount = n * 0.004;
    var hiCount = n * 0.992;
    var seen = 0;
    var lo = 0;
    var hi = 255;
    for (var g = 0; g < 256; g++) {
      seen += hist[g];
      if (seen >= loCount) { lo = g; break; }
    }
    seen = 0;
    for (var g2 = 0; g2 < 256; g2++) {
      seen += hist[g2];
      if (seen >= hiCount) { hi = g2; break; }
    }
    if (hi - lo < 36) return src;
    var scale = 255 / (hi - lo);
    var dst = new Uint8Array(n);
    for (var j = 0; j < n; j++) {
      var v = (src[j] - lo) * scale;
      if (v < 0) v = 0;
      else if (v > 255) v = 255;
      dst[j] = v + 0.5;
    }
    return dst;
  }

  function unsharpMask(src, W, H) {
    var sat = buildIntegralUint32(src, W, H);
    var stride = W + 1;
    var dst = new Uint8Array(src.length);
    for (var y = 0; y < H; y++) {
      var y0 = y > 0 ? y - 1 : 0;
      var y1 = y + 1 < H ? y + 1 : H - 1;
      var row = y * W;
      for (var x = 0; x < W; x++) {
        var x0 = x > 0 ? x - 1 : 0;
        var x1 = x + 1 < W ? x + 1 : W - 1;
        var count = (x1 - x0 + 1) * (y1 - y0 + 1);
        var blur = boxSum(sat, stride, x0, y0, x1, y1) / count;
        var v = src[row + x];
        var sharp = v + (v - blur) * 0.35;
        if (sharp < 0) sharp = 0;
        else if (sharp > 255) sharp = 255;
        dst[row + x] = sharp + 0.5;
      }
    }
    return dst;
  }

  function profileScore(seg, n) {
    var rad = Math.max(4, (n / 28) | 0);
    var prefix = new Float64Array(n + 1);
    for (var i = 0; i < n; i++) prefix[i + 1] = prefix[i] + seg[i];
    var hp = new Float64Array(n);
    var energy = 0;
    for (var i2 = 0; i2 < n; i2++) {
      var lo = i2 - rad; if (lo < 0) lo = 0;
      var hi = i2 + rad + 1; if (hi > n) hi = n;
      var d = seg[i2] - (prefix[hi] - prefix[lo]) / (hi - lo);
      hp[i2] = d;
      energy += d * d;
    }
    if (energy < 1) return { s: 0, peaks: 0 };
    var thr = Math.sqrt(energy / n) * 0.85;
    var peaks = 0;
    for (var i3 = 1; i3 < n - 1; i3++) {
      if (hp[i3] > hp[i3 - 1] && hp[i3] >= hp[i3 + 1] && hp[i3] > thr) peaks++;
    }
    if (peaks < 5) return { s: 0, peaks: peaks };
    var best = 0;
    var bestLag = 0;
    var loLag = Math.max(5, (n / 90) | 0);
    var hiLag = Math.max(loLag + 1, (n / 8) | 0);
    for (var lag = loLag; lag < hiLag; lag++) {
      var c = 0;
      var last = n - lag;
      for (var i4 = 0; i4 < last; i4++) c += hp[i4] * hp[i4 + lag];
      c /= energy;
      if (c > best) {
        best = c;
        bestLag = lag;
      }
    }
    return { s: best * Math.min(1, peaks / 8), peaks: peaks, lag: bestLag };
  }

  function textLineGapPx(norm, W, H) {
    var x0 = (W * 0.2) | 0;
    var x1 = (W * 0.8) | 0;
    var y0 = (H * 0.12) | 0;
    var y1 = (H * 0.88) | 0;
    var n = y1 - y0;
    if (n < 40 || x1 - x0 < 40) return 0;
    var row = new Float64Array(n);
    for (var y = y0; y < y1; y++) {
      var srcRow = y * W;
      var ink = 0;
      for (var x = x0; x < x1; x += 2) {
        if (norm[srcRow + x] < 150) ink++;
      }
      row[y - y0] = ink;
    }
    var scored = profileScore(row, n);
    if (scored.s < 0.35 || scored.lag < 12) return 0;
    return scored.lag;
  }

  function scaleGrayscale(src, W, H, scale) {
    var nW = Math.max(1, Math.round(W * scale));
    var nH = Math.max(1, Math.round(H * scale));
    var dst = new Uint8Array(nW * nH);
    for (var y = 0; y < nH; y++) {
      var sy = (y + 0.5) / scale - 0.5;
      if (sy < 0) sy = 0;
      if (sy > H - 1) sy = H - 1;
      var y0 = sy | 0;
      var y1 = y0 + 1 < H ? y0 + 1 : y0;
      var fy = sy - y0;
      var row0 = y0 * W;
      var row1 = y1 * W;
      var outRow = y * nW;
      for (var x = 0; x < nW; x++) {
        var sx = (x + 0.5) / scale - 0.5;
        if (sx < 0) sx = 0;
        if (sx > W - 1) sx = W - 1;
        var x0 = sx | 0;
        var x1 = x0 + 1 < W ? x0 + 1 : x0;
        var fx = sx - x0;
        var v00 = src[row0 + x0];
        var v10 = src[row0 + x1];
        var v01 = src[row1 + x0];
        var v11 = src[row1 + x1];
        var top = v00 + fx * (v10 - v00);
        var bot = v01 + fx * (v11 - v01);
        dst[outRow + x] = top * (1 - fy) + bot * fy + 0.5;
      }
    }
    return { data: dst, width: nW, height: nH };
  }

  function detect90DegRotation(norm, W, H) {
    if (W < 160 || H < 160) return 0;
    var x0 = (W * 0.12) | 0;
    var x1 = (W * 0.88) | 0;
    var y0 = (H * 0.12) | 0;
    var y1 = (H * 0.88) | 0;
    if (x1 - x0 < 40 || y1 - y0 < 40) return 0;
    var rowN = y1 - y0;
    var colN = x1 - x0;
    var row = new Float64Array(rowN);
    var col = new Float64Array(colN);
    var xStep = W * H > 1600000 ? 2 : 1;
    for (var y = y0; y < y1; y++) {
      var srcRow = y * W;
      for (var x = x0; x < x1; x += xStep) {
        if (norm[srcRow + x] < 140) {
          row[y - y0] += 1;
          col[x - x0] += 1;
        }
      }
    }
    var rowScore = profileScore(row, rowN);
    var colScore = profileScore(col, colN);
    // Rotate only when vertical line-spacing is strong AND horizontal
    // line-spacing is weak. An upright page with a dark gutter still has
    // a real horizontal rhythm, so it must stay put.
    var ratio = rowScore.s < 0.05 ? 99 : colScore.s / rowScore.s;
    if (
      ratio > 3.2 &&
      colScore.s > 0.7 &&
      rowScore.s < 0.22 &&
      colScore.peaks >= 10 &&
      colScore.peaks > rowScore.peaks * 1.4
    ) {
      return 90;
    }
    return 0;
  }

  function detectSkewAngleDeg(norm, W, H) {
    var step = Math.max(2, (Math.max(W, H) / 450) | 0);
    var marginX = (W * 0.12) | 0;
    var marginY = (H * 0.10) | 0;
    var ptsX = [];
    var ptsY = [];
    var cx = W * 0.5;
    var cy = H * 0.5;
    for (var y = marginY; y < H - marginY; y += step) {
      var row = y * W;
      for (var x = marginX; x < W - marginX; x += step) {
        if (norm[row + x] < 145) {
          ptsX.push(x - cx);
          ptsY.push(y - cy);
        }
      }
    }
    var nPts = ptsX.length;
    if (nPts < 40) return 0;
    var histLen = ((Math.sqrt(W * W + H * H) / step) | 0) + 8;
    var halfHist = histLen >> 1;
    var hist = new Int32Array(histLen);

    function scoreAngle(deg) {
      var rad = (deg * Math.PI) / 180;
      var sinA = Math.sin(rad);
      var cosA = Math.cos(rad);
      hist.fill(0);
      for (var i = 0; i < nPts; i++) {
        var r = Math.round((-ptsX[i] * sinA + ptsY[i] * cosA) / step) + halfHist;
        if (r >= 0 && r < histLen) hist[r]++;
      }
      var score = 0;
      for (var j = 1; j < histLen; j++) {
        var diff = hist[j] - hist[j - 1];
        score += diff * diff;
      }
      return score;
    }

    var baseScore = scoreAngle(0);
    var bestAngle = 0;
    var bestScore = baseScore;
    for (var deg = -12; deg <= 12.001; deg += 0.5) {
      if (deg === 0) continue;
      var sc = scoreAngle(deg);
      if (sc > bestScore) {
        bestScore = sc;
        bestAngle = deg;
      }
    }
    if (bestScore < baseScore * 1.1) return 0;
    var center = bestAngle;
    for (var delta = -1; delta <= 1.001; delta += 0.2) {
      var fineDeg = Math.round((center + delta) * 10) / 10;
      var scFine = scoreAngle(fineDeg);
      if (scFine > bestScore) {
        bestScore = scFine;
        bestAngle = fineDeg;
      }
    }
    if (Math.abs(bestAngle) < 0.7 || bestScore < baseScore * 1.1) return 0;
    return bestAngle;
  }

  function straightenTextLines(src, W, H) {
    if (W < 180 || H < 80) return { data: src, maxShift: 0 };
    var yStep = 2;
    var hS = Math.ceil(H / yStep);
    var numStrips = 15;
    var marginX = (W * 0.08) | 0;
    var usableW = Math.max(1, W - 2 * marginX);
    var stripW = Math.max(8, (usableW / numStrips) | 0);
    numStrips = Math.max(5, Math.min(numStrips, (usableW / stripW) | 0));
    var ref = numStrips >> 1;
    var energy = new Float32Array(numStrips * hS);
    for (var s = 0; s < numStrips; s++) {
      var x0 = marginX + s * stripW;
      var x1 = Math.min(W - 1, x0 + stripW);
      var off = s * hS;
      for (var y = 0; y < H; y++) {
        var row = y * W;
        var ink = 0;
        for (var x = x0; x < x1; x += 2) {
          if (src[row + x] < 145) ink++;
        }
        energy[off + (y >> 1)] += ink;
      }
    }
    var prof = new Float32Array(numStrips * hS);
    for (var s2 = 0; s2 < numStrips; s2++) {
      var off2 = s2 * hS;
      var acc = 0;
      for (var i = 0; i < hS; i++) acc += energy[off2 + i];
      var mean = acc / hS;
      for (var i2 = 1; i2 < hS - 1; i2++) {
        prof[off2 + i2] =
          (energy[off2 + i2 - 1] + energy[off2 + i2] * 2 + energy[off2 + i2 + 1]) * 0.25 - mean;
      }
    }

    var maxSearchPx = Math.max(6, Math.min(36, Math.round(H * 0.045)));
    var maxSearch = Math.max(3, Math.round(maxSearchPx / yStep));
    var refOff = ref * hS;

    function ncc(stripOff, y0, y1, shift) {
      var sab = 0;
      var sa = 0;
      var sb = 0;
      var n = 0;
      for (var y = y0; y < y1; y++) {
        var yy = y + shift;
        if (yy < 1 || yy >= hS - 1) continue;
        var pa = prof[refOff + y];
        var pb = prof[stripOff + yy];
        sab += pa * pb;
        sa += pa * pa;
        sb += pb * pb;
        n++;
      }
      if (n < 8 || sa < 1e-3 || sb < 1e-3) return -1;
      return sab / Math.sqrt(sa * sb);
    }

    function bandCoef(y0, y1) {
      var a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0;
      var b0 = 0, b1 = 0, b2 = 0;
      var meanAbs = 0;
      var wsum = 0;
      var used = 0;
      for (var s = 0; s < numStrips; s++) {
        var xn = ((s + 0.5) / numStrips) * 2 - 1;
        var shiftPx = 0;
        var weight = 1;
        if (s !== ref) {
          var bestD = 0;
          var bestC = -1;
          var off = s * hS;
          for (var d = -maxSearch; d <= maxSearch; d++) {
            var c = ncc(off, y0, y1, d);
            if (c > bestC) {
              bestC = c;
              bestD = d;
            }
          }
          // A hit on the search limit is another text block, not a curve.
          if (bestC < 0.72 || Math.abs(bestD) >= maxSearch) continue;
          shiftPx = bestD * yStep;
          weight = bestC * bestC;
        }
        var x2 = xn * xn;
        a00 += weight * x2 * x2;
        a01 += weight * x2 * xn;
        a02 += weight * x2;
        a11 += weight * xn * xn;
        a12 += weight * xn;
        a22 += weight;
        b0 += weight * x2 * shiftPx;
        b1 += weight * xn * shiftPx;
        b2 += weight * shiftPx;
        meanAbs += weight * Math.abs(shiftPx);
        wsum += weight;
        used++;
      }
      if (used < 6 || wsum < 1 || meanAbs / wsum < 1.5) return null;
      return solveSymmetric3(a00, a01, a02, a11, a12, a22, b0, b1, b2);
    }

    var yText0 = (hS * 0.18) | 0;
    var yText1 = (hS * 0.82) | 0;
    if (yText1 - yText0 < 16) return { data: src, maxShift: 0 };
    var yMid = (yText0 + yText1) >> 1;
    var topCoef = bandCoef(yText0, yMid);
    var botCoef = bandCoef(yMid, yText1);
    if (!topCoef && !botCoef) return { data: src, maxShift: 0 };
    if (!topCoef) topCoef = botCoef;
    if (!botCoef) botCoef = topCoef;

    function ev(coef, xn) {
      return (coef.a * xn + coef.b) * xn + coef.c;
    }
    var topMid = ev(topCoef, 0);
    var botMid = ev(botCoef, 0);
    var shiftTop = new Float32Array(W);
    var shiftBot = new Float32Array(W);
    var peak = 0;
    for (var x = 0; x < W; x++) {
      var xn = (x / Math.max(1, W - 1)) * 2 - 1;
      var st = ev(topCoef, xn) - topMid;
      var sb = ev(botCoef, xn) - botMid;
      if (st > maxSearchPx) st = maxSearchPx;
      else if (st < -maxSearchPx) st = -maxSearchPx;
      if (sb > maxSearchPx) sb = maxSearchPx;
      else if (sb < -maxSearchPx) sb = -maxSearchPx;
      shiftTop[x] = st;
      shiftBot[x] = sb;
      var aa = Math.abs(st);
      var bb = Math.abs(sb);
      if (aa > peak) peak = aa;
      if (bb > peak) peak = bb;
    }
    if (peak < 2) return { data: src, maxShift: 0 };

    var dst = new Uint8Array(W * H);
    var span = Math.max(1, (yText1 - yText0) * yStep);
    var yBase = yText0 * yStep;
    for (var yOut = 0; yOut < H; yOut++) {
      var t = (yOut - yBase) / span;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      var outRow = yOut * W;
      var omt = 1 - t;
      for (var xOut = 0; xOut < W; xOut++) {
        var sy = yOut + shiftTop[xOut] * omt + shiftBot[xOut] * t;
        if (sy <= 0 || sy >= H - 1) {
          dst[outRow + xOut] = 255;
        } else {
          var y0i = sy | 0;
          var fy = sy - y0i;
          var v0 = src[y0i * W + xOut];
          var v1 = src[(y0i + 1) * W + xOut];
          dst[outRow + xOut] = v0 + fy * (v1 - v0) + 0.5;
        }
      }
    }
    return { data: dst, maxShift: Math.round(peak * 10) / 10 };
  }

  function clahe(src, W, H) {
    var tilesX = Math.max(2, Math.round(W / 72));
    var tilesY = Math.max(2, Math.round(H / 72));
    var tileW = W / tilesX;
    var tileH = H / tilesY;
    var bins = 256;
    var clip = 1.8;
    var maps = new Uint8Array(tilesX * tilesY * bins);
    for (var ty = 0; ty < tilesY; ty++) {
      var y0 = Math.floor(ty * tileH);
      var y1 = Math.min(H, Math.floor((ty + 1) * tileH));
      if (y1 <= y0) y1 = Math.min(H, y0 + 1);
      for (var tx = 0; tx < tilesX; tx++) {
        var x0 = Math.floor(tx * tileW);
        var x1 = Math.min(W, Math.floor((tx + 1) * tileW));
        if (x1 <= x0) x1 = Math.min(W, x0 + 1);
        var hist = new Uint32Array(bins);
        var count = 0;
        var sum = 0;
        for (var y = y0; y < y1; y++) {
          var row = y * W;
          for (var x = x0; x < x1; x++) {
            var pv = src[row + x];
            hist[pv]++;
            sum += pv;
            count++;
          }
        }
        var mapOff = (ty * tilesX + tx) * bins;
        if (count < 8) {
          for (var id = 0; id < bins; id++) maps[mapOff + id] = id;
          continue;
        }
        var mean = sum / count;
        var varSum = 0;
        for (var b = 0; b < bins; b++) {
          var diff = b - mean;
          varSum += hist[b] * diff * diff;
        }
        if (varSum / count < 160) {
          for (var id2 = 0; id2 < bins; id2++) maps[mapOff + id2] = id2;
          continue;
        }
        var limit = Math.max(1, (clip * count / bins) | 0);
        var excess = 0;
        for (var b2 = 0; b2 < bins; b2++) {
          if (hist[b2] > limit) {
            excess += hist[b2] - limit;
            hist[b2] = limit;
          }
        }
        var redist = (excess / bins) | 0;
        var rem = excess - redist * bins;
        for (var b3 = 0; b3 < bins; b3++) hist[b3] += redist;
        for (var ri = 0; ri < rem; ri++) hist[ri % bins]++;
        var acc = 0;
        var scale = 255 / count;
        for (var b4 = 0; b4 < bins; b4++) {
          acc += hist[b4];
          var mapped = acc * scale;
          if (mapped < 0) mapped = 0;
          else if (mapped > 255) mapped = 255;
          maps[mapOff + b4] = mapped + 0.5;
        }
      }
    }
    var dst = new Uint8Array(src.length);
    var maxTileX = tilesX - 1;
    var maxTileY = tilesY - 1;
    for (var yOut = 0; yOut < H; yOut++) {
      var gy = (yOut + 0.5) / tileH - 0.5;
      if (gy < 0) gy = 0;
      if (gy > maxTileY) gy = maxTileY;
      var ty0 = gy | 0;
      if (ty0 >= maxTileY) ty0 = maxTileY > 0 ? maxTileY - 1 : 0;
      var ty1 = ty0 + 1 <= maxTileY ? ty0 + 1 : ty0;
      var fy = gy - ty0;
      if (fy < 0) fy = 0;
      else if (fy > 1) fy = 1;
      var rowOut = yOut * W;
      for (var xOut = 0; xOut < W; xOut++) {
        var gx = (xOut + 0.5) / tileW - 0.5;
        if (gx < 0) gx = 0;
        if (gx > maxTileX) gx = maxTileX;
        var tx0 = gx | 0;
        if (tx0 >= maxTileX) tx0 = maxTileX > 0 ? maxTileX - 1 : 0;
        var tx1 = tx0 + 1 <= maxTileX ? tx0 + 1 : tx0;
        var fx = gx - tx0;
        if (fx < 0) fx = 0;
        else if (fx > 1) fx = 1;
        var v = src[rowOut + xOut];
        var m00 = maps[(ty0 * tilesX + tx0) * bins + v];
        var m10 = maps[(ty0 * tilesX + tx1) * bins + v];
        var m01 = maps[(ty1 * tilesX + tx0) * bins + v];
        var m11 = maps[(ty1 * tilesX + tx1) * bins + v];
        var top = m00 + fx * (m10 - m00);
        var bot = m01 + fx * (m11 - m01);
        dst[rowOut + xOut] = top + fy * (bot - top) + 0.5;
      }
    }
    return dst;
  }

  function medianOf(values) {
    if (!values.length) return 0;
    var copy = values.slice();
    copy.sort(function(p, q) { return p - q; });
    var mid = copy.length >> 1;
    if (copy.length % 2) return copy[mid];
    return (copy[mid - 1] + copy[mid]) * 0.5;
  }

  function straightenByLineTracking(src, W, H, lineGap) {
    if (W < 220 || H < 90) return { data: src, maxShift: 0 };
    var strips = 21;
    var marginX = (W * 0.05) | 0;
    var usable = Math.max(1, W - 2 * marginX);
    var stripW = Math.max(12, (usable / strips) | 0);
    strips = Math.max(8, Math.min(strips, (usable / stripW) | 0));
    var ref = strips >> 1;
    var energy = new Float32Array(strips * H);
    for (var s = 0; s < strips; s++) {
      var x0 = marginX + s * stripW;
      var x1 = Math.min(W, x0 + stripW);
      var off = s * H;
      for (var y = 0; y < H; y++) {
        var row = y * W;
        var ink = 0;
        for (var x = x0; x < x1; x += 2) {
          if (src[row + x] < 160) ink++;
        }
        energy[off + y] = ink;
      }
    }
    var smooth = new Float32Array(strips * H);
    for (var s2 = 0; s2 < strips; s2++) {
      var off2 = s2 * H;
      for (var y2 = 1; y2 < H - 1; y2++) {
        smooth[off2 + y2] = energy[off2 + y2 - 1] * 0.25 + energy[off2 + y2] * 0.5 + energy[off2 + y2 + 1] * 0.25;
      }
    }
    var refOff = ref * H;
    var mean = 0;
    for (var i = 0; i < H; i++) mean += smooth[refOff + i];
    mean /= H;
    var thr = mean * 1.2;
    var minSep = lineGap > 16 ? Math.max(10, (lineGap * 0.55) | 0) : 14;
    var peaks = [];
    for (var py = 2; py < H - 2; py++) {
      var peakVal = smooth[refOff + py];
      if (peakVal < thr) continue;
      if (peakVal < smooth[refOff + py - 1] || peakVal < smooth[refOff + py + 1]) continue;
      if (peaks.length && py - peaks[peaks.length - 1] < minSep) {
        if (peakVal > smooth[refOff + peaks[peaks.length - 1]]) peaks[peaks.length - 1] = py;
      } else {
        peaks.push(py);
      }
    }
    if (peaks.length < 4) return { data: src, maxShift: 0 };
    var win = Math.max(5, (minSep * 0.4) | 0);
    function searchAt(strip, guess) {
      var band = strip * H;
      var yLo = guess - win;
      var yHi = guess + win;
      if (yLo < 1) yLo = 1;
      if (yHi > H - 2) yHi = H - 2;
      var best = -1;
      var bestY = -1;
      for (var yy = yLo; yy <= yHi; yy++) {
        var ev = smooth[band + yy];
        if (ev > best) {
          best = ev;
          bestY = yy;
        }
      }
      if (best < thr * 0.45) return -1;
      return bestY;
    }
    var tracks = [];
    for (var p = 0; p < peaks.length; p++) {
      var ys = new Array(strips);
      for (var z = 0; z < strips; z++) ys[z] = -1;
      ys[ref] = peaks[p];
      for (var sr = ref + 1; sr < strips; sr++) {
        ys[sr] = ys[sr - 1] < 0 ? -1 : searchAt(sr, ys[sr - 1]);
      }
      for (var sl = ref - 1; sl >= 0; sl--) {
        ys[sl] = ys[sl + 1] < 0 ? -1 : searchAt(sl, ys[sl + 1]);
      }
      var valid = 0;
      for (var c = 0; c < strips; c++) if (ys[c] >= 0) valid++;
      if (valid >= strips * 0.6) tracks.push(ys);
    }
    if (tracks.length < 4) return { data: src, maxShift: 0 };

    function stripXn(strip) {
      var x = marginX + (strip + 0.5) * stripW;
      return (x / Math.max(1, W - 1)) * 2 - 1;
    }
    function solve4(M, B) {
      var A = M.slice();
      var b = B.slice();
      for (var col = 0; col < 4; col++) {
        var pivot = col;
        var best = Math.abs(A[col * 4 + col]);
        for (var r = col + 1; r < 4; r++) {
          var av = Math.abs(A[r * 4 + col]);
          if (av > best) { best = av; pivot = r; }
        }
        if (best < 1e-8) return null;
        if (pivot !== col) {
          for (var c = col; c < 4; c++) {
            var tmp = A[col * 4 + c];
            A[col * 4 + c] = A[pivot * 4 + c];
            A[pivot * 4 + c] = tmp;
          }
          var tb = b[col];
          b[col] = b[pivot];
          b[pivot] = tb;
        }
        var div = A[col * 4 + col];
        for (var r2 = col + 1; r2 < 4; r2++) {
          var f = A[r2 * 4 + col] / div;
          b[r2] -= f * b[col];
          for (var c2 = col; c2 < 4; c2++) A[r2 * 4 + c2] -= f * A[col * 4 + c2];
        }
      }
      var coef = [0, 0, 0, 0];
      for (var i = 3; i >= 0; i--) {
        var s = b[i];
        for (var j = i + 1; j < 4; j++) s -= A[i * 4 + j] * coef[j];
        coef[i] = s / A[i * 4 + i];
      }
      return coef;
    }
    function fitCubic(xs, ys) {
      var M = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      var Bv = [0, 0, 0, 0];
      for (var i = 0; i < xs.length; i++) {
        var x = xs[i];
        var x2 = x * x;
        var x3 = x2 * x;
        var p = [x3, x2, x, 1];
        for (var r = 0; r < 4; r++) {
          Bv[r] += p[r] * ys[i];
          for (var c = 0; c < 4; c++) M[r * 4 + c] += p[r] * p[c];
        }
      }
      return solve4(M, Bv);
    }
    function evCubic(coef, xn) {
      return ((coef[0] * xn + coef[1]) * xn + coef[2]) * xn + coef[3];
    }
    var jumpLim = Math.max(18, lineGap > 0 ? lineGap * 0.7 : 28);
    var lines = [];
    for (var ti = 0; ti < tracks.length; ti++) {
      var ys = tracks[ti];
      var xs = [];
      var yy = [];
      var broken = false;
      var prevY = -1;
      var leftN = 0;
      var rightN = 0;
      for (var s = 0; s < strips; s++) {
        if (ys[s] < 0) continue;
        if (prevY >= 0 && Math.abs(ys[s] - prevY) > jumpLim) { broken = true; break; }
        prevY = ys[s];
        if (s < ref) leftN++;
        if (s > ref) rightN++;
        xs.push(stripXn(s));
        yy.push(ys[s]);
      }
      if (broken || xs.length < strips * 0.7 || leftN < 2 || rightN < 2) continue;
      var coef = fitCubic(xs, yy);
      if (!coef) continue;
      var err = 0;
      for (var k = 0; k < xs.length; k++) err += Math.abs(yy[k] - evCubic(coef, xs[k]));
      err /= xs.length;
      if (err > 3.2) continue;
      var yTarget = ys[ref] >= 0 ? ys[ref] : evCubic(coef, stripXn(ref));
      var edge = 0;
      for (var probe = 0; probe <= 8; probe++) {
        var pull = Math.abs(evCubic(coef, probe / 4 - 1) - yTarget);
        if (pull > edge) edge = pull;
      }
      if (edge > H * 0.16) continue;
      lines.push({ coef: coef, yTarget: yTarget, err: err, edge: edge });
    }
    lines.sort(function(a, b) { return a.yTarget - b.yTarget; });
    var kept = [];
    for (var li = 0; li < lines.length; li++) {
      var prev = kept.length ? kept[kept.length - 1] : null;
      if (prev && lines[li].yTarget - prev.yTarget < Math.max(10, minSep * 0.8)) {
        if (lines[li].err < prev.err) kept[kept.length - 1] = lines[li];
        continue;
      }
      kept.push(lines[li]);
    }
    function worstFold(list) {
      var worstI = -1;
      var worstAmt = 0;
      for (var a = 0; a < list.length - 1; a++) {
        for (var probe2 = 0; probe2 <= 8; probe2++) {
          var gap = evCubic(list[a + 1].coef, probe2 / 4 - 1) - evCubic(list[a].coef, probe2 / 4 - 1);
          var fold = 2 - gap;
          if (fold > worstAmt) {
            worstAmt = fold;
            worstI = list[a].err >= list[a + 1].err ? a : a + 1;
          }
        }
      }
      return worstI;
    }
    var guard = 0;
    while (kept.length >= 4 && guard < 12) {
      var foldAt = worstFold(kept);
      if (foldAt < 0) break;
      kept.splice(foldAt, 1);
      guard++;
    }
    if (kept.length < 4 || worstFold(kept) >= 0) return { data: src, maxShift: 0 };
    var peak = 0;
    for (var e = 0; e < kept.length; e++) if (kept[e].edge > peak) peak = kept[e].edge;
    if (peak < 2.5) return { data: src, maxShift: 0 };

    var curves = new Array(W);
    for (var x = 0; x < W; x++) {
      var xn = (x / Math.max(1, W - 1)) * 2 - 1;
      var col = new Float32Array(kept.length);
      for (var n = 0; n < kept.length; n++) col[n] = evCubic(kept[n].coef, xn);
      curves[x] = col;
    }
    var dst = new Uint8Array(W * H);
    var last = kept.length - 1;
    for (var yOut = 0; yOut < H; yOut++) {
      var outRow = yOut * W;
      for (var xOut = 0; xOut < W; xOut++) {
        var colY = curves[xOut];
        var sy;
        if (yOut <= kept[0].yTarget) {
          sy = colY[0] + (yOut - kept[0].yTarget);
        } else if (yOut >= kept[last].yTarget) {
          sy = colY[last] + (yOut - kept[last].yTarget);
        } else {
          var hi = 1;
          while (hi < last && kept[hi].yTarget < yOut) hi++;
          var lo = hi - 1;
          var spanY = kept[hi].yTarget - kept[lo].yTarget;
          var t = spanY > 0.5 ? (yOut - kept[lo].yTarget) / spanY : 0;
          sy = colY[lo] + t * (colY[hi] - colY[lo]);
        }
        if (sy <= 0 || sy >= H - 1) {
          dst[outRow + xOut] = 255;
        } else {
          var y0i = sy | 0;
          var fy = sy - y0i;
          var v0 = src[y0i * W + xOut];
          var v1 = src[(y0i + 1) * W + xOut];
          dst[outRow + xOut] = v0 + fy * (v1 - v0) + 0.5;
        }
      }
    }
    return { data: dst, maxShift: Math.round(peak * 10) / 10 };
  }

  function whitenPaper(src, W, H) {
    var rad = 7;
    var sat = buildIntegralUint32(src, W, H);
    var satSq = buildIntegralSquaresFloat64(src, W, H);
    var stride = W + 1;
    var dst = new Uint8Array(src.length);
    for (var y = 0; y < H; y++) {
      var y0 = y - rad; if (y0 < 0) y0 = 0;
      var y1 = y + rad; if (y1 >= H) y1 = H - 1;
      var row = y * W;
      for (var x = 0; x < W; x++) {
        var x0 = x - rad; if (x0 < 0) x0 = 0;
        var x1 = x + rad; if (x1 >= W) x1 = W - 1;
        var count = (x1 - x0 + 1) * (y1 - y0 + 1);
        var sum = boxSum(sat, stride, x0, y0, x1, y1);
        var sumSq = boxSum(satSq, stride, x0, y0, x1, y1);
        var mean = sum / count;
        var variance = sumSq / count - mean * mean;
        if (variance < 0) variance = 0;
        var std = Math.sqrt(variance);
        var v = src[row + x];
        if (std < 11 && v >= 158) {
          v = 255;
        } else if (std < 18 && v >= 196) {
          var t = (18 - std) / 18;
          v = v + (255 - v) * t;
        }
        dst[row + x] = v + 0.5;
      }
    }
    return dst;
  }

  function sharpenText(src, W, H) {
    var rad = 2;
    var amount = 1.45;
    var threshold = 9;
    var sat = buildIntegralUint32(src, W, H);
    var stride = W + 1;
    var dst = new Uint8Array(src.length);
    for (var y = 0; y < H; y++) {
      var y0 = y - rad; if (y0 < 0) y0 = 0;
      var y1 = y + rad; if (y1 >= H) y1 = H - 1;
      var row = y * W;
      for (var x = 0; x < W; x++) {
        var x0 = x - rad; if (x0 < 0) x0 = 0;
        var x1 = x + rad; if (x1 >= W) x1 = W - 1;
        var count = (x1 - x0 + 1) * (y1 - y0 + 1);
        var blur = boxSum(sat, stride, x0, y0, x1, y1) / count;
        var v = src[row + x];
        var delta = v - blur;
        var ad = delta < 0 ? -delta : delta;
        var sharp = v;
        if (ad >= threshold) sharp = v + delta * amount;
        if (sharp < 0) sharp = 0;
        else if (sharp > 255) sharp = 255;
        dst[row + x] = sharp + 0.5;
      }
    }
    return dst;
  }

  async function preprocessBookImage(b64, options) {
    var opts = options || {};
    var pad = typeof opts.padding === 'number' ? opts.padding : 24;
    var skipUpright = !!opts.skipUpright;
    var img = await loadImageFromBase64(b64);
    var w0 = img.naturalWidth || img.width || 800;
    var h0 = img.naturalHeight || img.height || 600;
    var maxDim = Math.max(w0, h0);
    var minDim = Math.min(w0, h0);
    var scale = 1;
    if (maxDim > 2600) {
      scale = 2600 / maxDim;
    } else if (maxDim < 1200 || minDim < 320) {
      scale = Math.min(2.4, Math.max(1200 / Math.max(1, maxDim), 320 / Math.max(1, minDim)));
      if (maxDim * scale > 2600) scale = 2600 / maxDim;
    }
    var W = Math.max(24, Math.round(w0 * scale));
    var H = Math.max(24, Math.round(h0 * scale));

    var workCanvas = document.createElement('canvas');
    workCanvas.width = W;
    workCanvas.height = H;
    var ctx = workCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = scale < 0.999;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);

    var rgba = ctx.getImageData(0, 0, W, H).data;
    var n0 = W * H;
    var lum = new Uint8Array(n0);
    for (var i = 0, p = 0; i < n0; i++, p += 4) {
      lum[i] = (77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2]) >> 8;
    }

    postToRN({ type: 'progress', status: 'Removing page shadows...', percent: 18 });
    var coarseR = Math.max(56, Math.min(120, Math.round(Math.min(W, H) / 12)));
    var fineR = Math.max(22, Math.min(36, Math.round(Math.min(W, H) / 42)));
    var lifted = flattenIllumination(lum, estimatePaperBackground(lum, W, H, coarseR), false);
    await new Promise(function(r) { setTimeout(r, 0); });
    var norm = contrastStretch(flattenIllumination(lifted, estimatePaperBackground(lifted, W, H, fineR), true));
    postToRN({ type: 'progress', status: 'Whitening the paper...', percent: 32 });
    await new Promise(function(r) { setTimeout(r, 0); });
    norm = whitenPaper(norm, W, H);

    var rot90 = 0;
    if (detect90DegRotation(norm, W, H) !== 0) {
      var rotated90 = rotate90CCW(norm, W, H);
      norm = rotated90.data;
      W = rotated90.width;
      H = rotated90.height;
      rot90 = -90;
    }

    var lineGap = textLineGapPx(norm, W, H);
    if (lineGap > 0 && lineGap < 40) {
      var textScale = 46 / lineGap;
      if (textScale > 2.4) textScale = 2.4;
      if (Math.max(W, H) * textScale > 2600) textScale = 2600 / Math.max(W, H);
      if (textScale >= 1.12) {
        postToRN({ type: 'progress', status: 'Enlarging the text for reading...', percent: 46 });
        await new Promise(function(r) { setTimeout(r, 0); });
        var scaled = scaleGrayscale(norm, W, H, textScale);
        norm = scaled.data;
        W = scaled.width;
        H = scaled.height;
        lineGap = textLineGapPx(norm, W, H) || Math.round(lineGap * textScale);
      }
    }

    postToRN({ type: 'progress', status: 'Straightening the page and the lines...', percent: 58 });
    await new Promise(function(r) { setTimeout(r, 0); });
    var skewAngle = detectSkewAngleDeg(norm, W, H);
    if (Math.abs(skewAngle) >= 0.7) {
      norm = rotateGrayscale(norm, W, H, skewAngle);
    }

    var curveRes = straightenByLineTracking(norm, W, H, lineGap);
    norm = curveRes.data;

    if (rot90 !== 0 && !skipUpright && isTextUpsideDown(norm, W, H)) {
      norm = rotate180(norm, W, H);
      rot90 = 90;
    }

    postToRN({ type: 'progress', status: 'Sharpening the letters...', percent: 74 });
    await new Promise(function(r) { setTimeout(r, 0); });
    norm = sharpenText(norm, W, H);
    norm = whitenPaper(norm, W, H);

    var numPixels = norm.length;
    workCanvas.width = W;
    workCanvas.height = H;
    var finalImgData = ctx.createImageData(W, H);
    var finalRgba = finalImgData.data;
    for (var m = 0, q = 0; m < numPixels; m++, q += 4) {
      var g = norm[m];
      finalRgba[q] = g;
      finalRgba[q + 1] = g;
      finalRgba[q + 2] = g;
      finalRgba[q + 3] = 255;
    }
    ctx.putImageData(finalImgData, 0, 0);

    var outW = W + pad * 2;
    var outH = H + pad * 2;
    var outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    var outCtx = outCanvas.getContext('2d');
    outCtx.fillStyle = '#FFFFFF';
    outCtx.fillRect(0, 0, outW, outH);
    outCtx.drawImage(workCanvas, pad, pad);

    var ocrUrl = opts.forOcr ? outCanvas.toDataURL('image/png') : outCanvas.toDataURL('image/jpeg', 0.92);
    var rawBase64 = ocrUrl.indexOf(',') !== -1 ? ocrUrl.split(',')[1] : ocrUrl;
    var dataUrl = ocrUrl;
    if (opts.forOcr) {
      var previewScale = Math.min(1, 2000 / Math.max(outW, outH));
      var preview = document.createElement('canvas');
      preview.width = Math.max(1, Math.round(outW * previewScale));
      preview.height = Math.max(1, Math.round(outH * previewScale));
      var previewCtx = preview.getContext('2d');
      previewCtx.fillStyle = '#FFFFFF';
      previewCtx.fillRect(0, 0, preview.width, preview.height);
      previewCtx.drawImage(outCanvas, 0, 0, preview.width, preview.height);
      dataUrl = preview.toDataURL('image/jpeg', 0.92);
    }
    return {
      base64: rawBase64,
      dataUrl: dataUrl,
      stats: {
        rot90: rot90,
        skewAngle: skewAngle,
        curveShiftPx: curveRes.maxShift,
        lineGap: lineGap || 0,
        width: outW,
        height: outH
      }
    };
  }

  async function waitForTesseractScript() {
    for (var attempt = 0; attempt < 150; attempt++) {
      if (typeof Tesseract !== 'undefined') {
        return;
      }
      await new Promise(function(r) { setTimeout(r, 200); });
    }
    throw new Error('Could not load tesseract.min.js from CDN. Check emulator internet connection.');
  }

  async function getOrCreateWorker(langString) {
    if (workersByLang[langString]) {
      return workersByLang[langString];
    }

    var langs = langString.split('+').filter(Boolean);
    var worker = await Tesseract.createWorker(langs, 1, {
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      cacheMethod: 'none',
      logger: function(m) {
        if (m && m.status) {
          var pct = typeof m.progress === 'number' ? Math.round(m.progress * 100) : 15;
          postToRN({
            type: 'progress',
            status: m.status + ' (' + pct + '%)',
            percent: pct
          });
        }
      }
    });

    try {
      await worker.setParameters({
        preserve_interword_spaces: '1'
      });
    } catch (e) {}

    workersByLang[langString] = worker;
    return worker;
  }

  async function runEnhanceJob(b64) {
    if (isJobRunning) return;
    isJobRunning = true;
    try {
      postToRN({
        type: 'progress',
        status: 'Cleaning the page for OCR (shadows and contrast)...',
        percent: 35
      });
      var res = await preprocessBookImage(b64, { padding: 8 });
      postToRN({
        type: 'enhance_complete',
        base64: res.base64,
        stats: res.stats
      });
    } catch (e) {
      var errMsg = (e && e.message) || 'Image preprocessing failed';
      postToRN({
        type: 'error',
        error: errMsg
      });
    } finally {
      isJobRunning = false;
    }
  }

  function preferRecognition(current, next) {
    if (!current || !current.text) return next;
    if (!next || !next.text) return current;
    if (next.conf > current.conf + 4) return next;
    if (current.conf > next.conf + 4) return current;
    return next.text.length > current.text.length ? next : current;
  }

  async function recognizeBest(worker, imgBytes, langString, prefix, index, total, lineGap) {
    var passes = ['6', '4'];
    var best = { text: '', conf: -1 };
    var useDpi = lineGap >= 28;
    for (var pass = 0; pass < passes.length; pass++) {
      var label = passes[pass] === '6' ? 'paragraph' : 'column';
      postToRN({
        type: 'progress',
        status: prefix + 'Reading pass ' + (pass + 1) + ' of 2 (' + label + ', ' + langString + ')...',
        percent: Math.round(((index + 0.45 + pass * 0.2) / total) * 100)
      });
      try {
        var params = {
          tessedit_pageseg_mode: passes[pass],
          preserve_interword_spaces: '1'
        };
        params.user_defined_dpi = useDpi ? '300' : '0';
        await worker.setParameters(params);
      } catch (e) {}
      var result = await worker.recognize(imgBytes);
      var text = (result && result.data && result.data.text ? result.data.text : '').trim();
      var conf = result && result.data && typeof result.data.confidence === 'number' ? result.data.confidence : 0;
      best = preferRecognition(best, { text: text, conf: conf });
      if (best.conf >= 92 && best.text.length > 40) break;
    }
    if (best.conf < 78) {
      postToRN({
        type: 'progress',
        status: prefix + 'Reading pass 3 (full page, ' + langString + ')...',
        percent: Math.round(((index + 0.9) / total) * 100)
      });
      try {
        var pageParams = {
          tessedit_pageseg_mode: '3',
          preserve_interword_spaces: '1'
        };
        pageParams.user_defined_dpi = useDpi ? '300' : '0';
        await worker.setParameters(pageParams);
      } catch (e2) {}
      var result3 = await worker.recognize(imgBytes);
      var text3 = (result3 && result3.data && result3.data.text ? result3.data.text : '').trim();
      var conf3 = result3 && result3.data && typeof result3.data.confidence === 'number' ? result3.data.confidence : 0;
      best = preferRecognition(best, { text: text3, conf: conf3 });
    }
    return best;
  }

  async function runOcrJob(rois, langString, shouldPreprocess) {
    if (isJobRunning) return;
    isJobRunning = true;

    try {
      await waitForTesseractScript();

      var isCached = Boolean(workersByLang[langString]);
      postToRN({
        type: 'progress',
        status: isCached
          ? 'Using ready OCR worker (' + langString + ')...'
          : 'Initializing OCR worker (' + langString + ')...',
        percent: isCached ? 20 : 10
      });

      var worker = await getOrCreateWorker(langString);

      var blocks = [];
      var processedRois = [];
      var statsList = [];

      for (var i = 0; i < rois.length; i++) {
        var b64 = rois[i];
        var prefix = rois.length > 1 ? '[ROI #' + (i + 1) + '/' + rois.length + '] ' : '';

        var targetBase64 = b64;
        if (shouldPreprocess !== false) {
          postToRN({
            type: 'progress',
            status: prefix + 'Cleaning the page for OCR (shadows and contrast)...',
            percent: Math.round(((i + 0.15) / rois.length) * 100)
          });
          var primaryLang = (langString || 'fra').split('+')[0];
          var pre = await preprocessBookImage(b64, {
            padding: 32,
            skipUpright: primaryLang === 'heb',
            forOcr: true
          });
          targetBase64 = pre.base64;
          processedRois.push(pre.dataUrl);
          statsList.push(pre.stats);
        }

        var imgBytes = base64ToUint8Array(targetBase64);
        var measuredGap = 0;
        if (statsList.length > i && statsList[i] && statsList[i].lineGap) {
          measuredGap = statsList[i].lineGap;
        }
        var recognized = await recognizeBest(worker, imgBytes, langString, prefix, i, rois.length, measuredGap);
        var cleaned = recognized.text;
        if (cleaned) {
          blocks.push(rois.length > 1 ? '--- Region ' + (i + 1) + ' ---\\n' + cleaned : cleaned);
        }
      }

      postToRN({
        type: 'complete',
        text: blocks.join('\\n\\n'),
        processedRois: processedRois,
        stats: statsList
      });
    } catch (e) {
      delete workersByLang[langString];
      var errMsg =
        (e && e.message) ||
        (e && e.error && e.error.message) ||
        (typeof e === 'string' ? e : '') ||
        'OCR worker failed';
      postToRN({
        type: 'error',
        error: errMsg
      });
    } finally {
      isJobRunning = false;
    }
  }

  function stitchImages(list) {
    if (!list || !list.length) {
      postToRN({ type: 'stitch_error', error: 'No image' });
      return;
    }
    Promise.all(list.map(loadImageFromBase64)).then(function(imgs) {
      var gap = 28;
      var width = 0;
      var height = 0;
      for (var i = 0; i < imgs.length; i++) {
        width = Math.max(width, imgs[i].naturalWidth || imgs[i].width);
        height += imgs[i].naturalHeight || imgs[i].height;
      }
      height += gap * (imgs.length - 1);
      var scale = width > 1600 ? 1600 / width : 1;
      if (height * scale > 5000) scale = 5000 / height;
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      var y = 0;
      for (var j = 0; j < imgs.length; j++) {
        var w = imgs[j].naturalWidth || imgs[j].width;
        var h = imgs[j].naturalHeight || imgs[j].height;
        ctx.drawImage(imgs[j], Math.round((width - w) / 2), y);
        y += h + gap;
      }
      postToRN({ type: 'stitch', base64: canvas.toDataURL('image/jpeg', 0.9) });
    }).catch(function(err) {
      postToRN({
        type: 'stitch_error',
        error: (err && err.message) || 'Could not join the crops'
      });
    });
  }

  window.runOcrJobFromRN = function(payload) {
    if (!payload) return;
    if (payload.command === 'run_ocr') {
      runOcrJob(payload.rois, payload.lang, payload.preprocess);
    } else if (payload.command === 'enhance_image') {
      runEnhanceJob(payload.base64);
    } else if (payload.command === 'stitch') {
      stitchImages(payload.images);
    }
  };

  function handleIncoming(raw) {
    try {
      var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      window.runOcrJobFromRN(msg);
    } catch (e) {}
  }

  window.addEventListener('message', function(ev) {
    handleIncoming(ev.data);
  });

  document.addEventListener('message', function(ev) {
    handleIncoming(ev.data);
  });
</script>
</body>
</html>
`;

export const TesseractOcrBridge = forwardRef<
  TesseractOcrBridgeHandle,
  TesseractOcrBridgeProps
>(({ onProgress, onComplete, onEnhanceComplete, onError }, ref) => {
  const webviewRef = useRef<WebView>(null);
  const stitchWait = useRef<{
    resolve: (base64: string) => void;
    reject: (err: Error) => void;
  } | null>(null);

  useImperativeHandle(ref, () => ({
    recognizeRois: (
      rois: RoiBox[],
      langs: OcrLanguageCode[],
      preprocess = true
    ) => {
      const base64List = rois
        .map((r) => r.base64 || '')
        .filter((b) => b.length > 0);

      if (base64List.length === 0) {
        onError('No cropped ROI image data found. Please draw a box on the photo.');
        return;
      }

      const langString = langs.length > 0 ? langs.join('+') : 'fra+eng';
      const payload = JSON.stringify({
        command: 'run_ocr',
        rois: base64List,
        lang: langString,
        preprocess
      });

      webviewRef.current?.injectJavaScript(
        `if (window.runOcrJobFromRN) { window.runOcrJobFromRN(${payload}); } true;`
      );
    },
    enhanceImage: (base64: string) => {
      if (!base64) {
        onError('No image data available to enhance.');
        return;
      }
      const payload = JSON.stringify({
        command: 'enhance_image',
        base64
      });
      webviewRef.current?.injectJavaScript(
        `if (window.runOcrJobFromRN) { window.runOcrJobFromRN(${payload}); } true;`
      );
    },
    stitchImages: (images: string[]) =>
      new Promise<string>((resolve, reject) => {
        if (images.length === 0) {
          reject(new Error('No cropped image to copy.'));
          return;
        }
        if (images.length === 1) {
          resolve(images[0]);
          return;
        }
        if (!webviewRef.current) {
          reject(new Error('The page image is not ready.'));
          return;
        }
        const timer = setTimeout(() => {
          if (!stitchWait.current) return;
          stitchWait.current = null;
          reject(new Error('Could not join the crops.'));
        }, 12000);
        stitchWait.current = {
          resolve: (base64) => {
            clearTimeout(timer);
            resolve(base64);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          }
        };
        const payload = JSON.stringify({ command: 'stitch', images });
        webviewRef.current.injectJavaScript(
          `if (window.runOcrJobFromRN) { window.runOcrJobFromRN(${payload}); } true;`
        );
      })
  }));

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'progress') {
        onProgress(data.status, data.percent);
      } else if (data.type === 'complete') {
        onComplete(data.text || '', data.processedRois, data.stats);
      } else if (data.type === 'enhance_complete') {
        onEnhanceComplete?.(data.base64, data.stats);
      } else if (data.type === 'stitch') {
        const wait = stitchWait.current;
        stitchWait.current = null;
        const raw = String(data.base64 || '');
        const clean = raw.includes(',') ? raw.split(',')[1] : raw;
        if (!clean) wait?.reject(new Error('Could not join the crops.'));
        else wait?.resolve(clean);
      } else if (data.type === 'stitch_error') {
        const wait = stitchWait.current;
        stitchWait.current = null;
        wait?.reject(new Error(data.error || 'Could not join the crops.'));
      } else if (data.type === 'error') {
        onError(data.error || 'Unknown OCR error');
      }
    } catch {
      // Ignore malformed messages
    }
  };

  return (
    <View style={styles.hiddenContainer} pointerEvents="none">
      <WebView
        key="tesseract-webview-v12"
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: TESSERACT_WEBVIEW_HTML }}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        mixedContentMode="always"
        allowFileAccess
        onMessage={handleMessage}
        onError={(e) => onError(`WebView error: ${e.nativeEvent.description}`)}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  hiddenContainer: {
    width: 1,
    height: 1,
    opacity: 0,
    position: 'absolute',
    left: -1000,
    top: -1000
  }
});

