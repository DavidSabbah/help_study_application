import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { OcrLanguageCode, RoiBox } from '../types';

export interface PreprocessStats {
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

  // Detect global skew angle in degrees (-12..+12) via horizontal projection profile gradient variance
  function detectSkewAngleDeg(norm, W, H) {
    var step = Math.max(1, Math.floor(Math.max(W, H) / 420));
    var marginX = Math.floor(W * 0.05);
    var marginY = Math.floor(H * 0.05);
    var ptsX = [];
    var ptsY = [];
    var cx = W * 0.5;
    var cy = H * 0.5;

    for (var y = marginY; y < H - marginY; y += step) {
      var row = y * W;
      for (var x = marginX; x < W - marginX; x += step) {
        if (norm[row + x] < 200) {
          ptsX.push(x - cx);
          ptsY.push(y - cy);
        }
      }
    }

    var nPts = ptsX.length;
    if (nPts < 40) {
      return 0;
    }

    var histLen = Math.ceil(Math.sqrt(W * W + H * H) / step) + 8;
    var halfHist = histLen >> 1;
    var hist = new Int32Array(histLen);
    var invStep = 1.0 / step;

    function scoreAngle(deg) {
      var rad = (deg * Math.PI) / 180.0;
      var sinA = Math.sin(rad);
      var cosA = Math.cos(rad);
      hist.fill(0);
      for (var i = 0; i < nPts; i++) {
        var r = Math.round((-ptsX[i] * sinA + ptsY[i] * cosA) * invStep) + halfHist;
        if (r >= 0 && r < histLen) {
          hist[r]++;
        }
      }
      var score = 0;
      for (var j = 1; j < histLen; j++) {
        var diff = hist[j] - hist[j - 1];
        score += diff * diff;
      }
      return score;
    }

    var bestAngle = 0;
    var bestScore = scoreAngle(0);

    // Coarse search: -12 to +12 deg by 1.0 deg
    for (var deg = -12; deg <= 12; deg += 1.0) {
      if (deg === 0) continue;
      var sc = scoreAngle(deg);
      if (sc > bestScore) {
        bestScore = sc;
        bestAngle = deg;
      }
    }

    // Fine search around bestAngle: +/- 1.0 deg by 0.2 deg
    var center = bestAngle;
    for (var delta = -1.0; delta <= 1.001; delta += 0.2) {
      var fineDeg = Math.round((center + delta) * 10) / 10;
      var scFine = scoreAngle(fineDeg);
      if (scFine > bestScore) {
        bestScore = scFine;
        bestAngle = fineDeg;
      }
    }

    return Math.abs(bestAngle) < 0.2 ? 0 : bestAngle;
  }

  // Rotate grayscale buffer by -angleDeg using bilinear interpolation with white (252) fill
  function rotateGrayscale(src, W, H, angleDeg) {
    if (Math.abs(angleDeg) < 0.2) return src;
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
        // Inverse mapping from destination (x, y) to source (sx, sy)
        var sx = dx * cosA - dy * sinA + cx;
        var sy = dx * sinA + dy * cosA + cy;
        if (sx < 0 || sx >= W - 1 || sy < 0 || sy >= H - 1) {
          dst[dstRow + x] = 252;
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

  // Straighten curved book text lines across horizontal strips (de-warping page curvature near spine)
  function straightenBookCurvature(src, W, H) {
    var numStrips = 16;
    if (W < 160 || H < 80) {
      return { data: src, maxShift: 0 };
    }

    var marginX = Math.floor(W * 0.04);
    var usableW = W - 2 * marginX;
    var stripW = Math.max(8, Math.floor(usableW / numStrips));
    var profiles = [];
    var energies = [];

    for (var s = 0; s < numStrips; s++) {
      var sx0 = marginX + s * stripW;
      var sx1 = s === numStrips - 1 ? W - marginX : Math.min(W - marginX, sx0 + stripW);
      var rawProf = new Float32Array(H);
      var totalEnergy = 0;

      for (var y = 4; y < H - 4; y++) {
        var row = y * W;
        var sum = 0;
        for (var x = sx0; x < sx1; x++) {
          var v = src[row + x];
          if (v < 210) {
            sum += 210 - v;
          }
        }
        rawProf[y] = sum;
        totalEnergy += sum;
      }

      // Smooth profile with [1, 2, 1] filter
      var smoothProf = new Float32Array(H);
      for (var y2 = 1; y2 < H - 1; y2++) {
        smoothProf[y2] = 0.25 * rawProf[y2 - 1] + 0.5 * rawProf[y2] + 0.25 * rawProf[y2 + 1];
      }
      profiles.push(smoothProf);
      energies.push(totalEnergy / Math.max(1, (sx1 - sx0) * H));
    }

    var maxDelta = Math.max(3, Math.min(12, Math.round(H / 45)));
    var stripOffsets = new Float32Array(numStrips);
    stripOffsets[0] = 0;

    for (var sIdx = 1; sIdx < numStrips; sIdx++) {
      if (energies[sIdx - 1] < 1.2 || energies[sIdx] < 1.2) {
        stripOffsets[sIdx] = stripOffsets[sIdx - 1];
        continue;
      }
      var pPrev = profiles[sIdx - 1];
      var pCurr = profiles[sIdx];
      var bestShift = 0;
      var bestCorr = -1;
      var corrByShift = new Float64Array(2 * maxDelta + 1);

      for (var d = -maxDelta; d <= maxDelta; d++) {
        var corr = 0;
        var yStart = Math.max(8, -d + 8);
        var yEnd = Math.min(H - 8, H - 8 - d);
        for (var y3 = yStart; y3 < yEnd; y3++) {
          corr += pPrev[y3] * pCurr[y3 + d];
        }
        // Slight prior favoring small shifts to avoid jumping a full line
        var penalty = 1.0 - 0.008 * d * d;
        var weighted = corr * penalty;
        corrByShift[d + maxDelta] = weighted;
        if (weighted > bestCorr) {
          bestCorr = weighted;
          bestShift = d;
        }
      }

      // Sub-pixel parabolic refinement
      var subShift = bestShift;
      if (bestShift > -maxDelta && bestShift < maxDelta) {
        var cLeft = corrByShift[bestShift - 1 + maxDelta];
        var cMid = corrByShift[bestShift + maxDelta];
        var cRight = corrByShift[bestShift + 1 + maxDelta];
        var denom = 2 * (2 * cMid - cLeft - cRight);
        if (denom > 1e-6) {
          subShift += (cRight - cLeft) / denom;
        }
      }

      stripOffsets[sIdx] = stripOffsets[sIdx - 1] + subShift;
    }

    // Zero-mean center the vertical offsets
    var meanOffset = 0;
    for (var k = 0; k < numStrips; k++) {
      meanOffset += stripOffsets[k];
    }
    meanOffset /= numStrips;
    for (var k2 = 0; k2 < numStrips; k2++) {
      stripOffsets[k2] -= meanOffset;
    }

    // Smooth offsets across strips
    var smoothOffsets = new Float32Array(numStrips);
    var maxAbsShift = 0;
    for (var k3 = 0; k3 < numStrips; k3++) {
      var prevO = stripOffsets[Math.max(0, k3 - 1)];
      var currO = stripOffsets[k3];
      var nextO = stripOffsets[Math.min(numStrips - 1, k3 + 1)];
      var val = 0.25 * prevO + 0.5 * currO + 0.25 * nextO;
      // Clamp extreme drift
      val = Math.max(-H * 0.08, Math.min(H * 0.08, val));
      smoothOffsets[k3] = val;
      if (Math.abs(val) > maxAbsShift) {
        maxAbsShift = Math.abs(val);
      }
    }

    if (maxAbsShift < 0.6) {
      return { data: src, maxShift: 0 };
    }

    // Interpolate vertical shift for every pixel column x and warp vertically
    var colShift = new Float32Array(W);
    for (var col = 0; col < W; col++) {
      var pos = ((col - marginX) / Math.max(1, stripW)) - 0.5;
      if (pos <= 0) {
        colShift[col] = smoothOffsets[0];
      } else if (pos >= numStrips - 1) {
        colShift[col] = smoothOffsets[numStrips - 1];
      } else {
        var idx0 = pos | 0;
        var frac = pos - idx0;
        colShift[col] = smoothOffsets[idx0] * (1 - frac) + smoothOffsets[idx0 + 1] * frac;
      }
    }

    var dst = new Uint8Array(W * H);
    for (var yOut = 0; yOut < H; yOut++) {
      var outRow = yOut * W;
      for (var xOut = 0; xOut < W; xOut++) {
        var sy = yOut + colShift[xOut];
        if (sy < 0 || sy >= H - 1) {
          dst[outRow + xOut] = 252;
        } else {
          var y0 = sy | 0;
          var fy = sy - y0;
          var v0 = src[y0 * W + xOut];
          var v1 = src[(y0 + 1) * W + xOut];
          dst[outRow + xOut] = Math.round(v0 + fy * (v1 - v0));
        }
      }
    }

    return {
      data: dst,
      maxShift: Math.round(maxAbsShift * 10) / 10
    };
  }

  /**
   * Standard Document / Book Image Processing Pipeline:
   * 1. Resolution normalization (upscales small ROIs, caps very large images)
   * 2. 2-Pass Integral Image Background Estimation & Division Normalization (removes shadows & uneven lighting)
   * 3. Global Skew Detection & Bilinear Deskewing
   * 4. Book Page Curvature Straightening (vertical strip projection alignment)
   * 5. Sauvola Local Adaptive Thresholding / Contrast Stretching + 3x3 Despeckle
   * 6. 24px Pure White Border Padding for optimal Tesseract LSTM recognition
   */
  async function preprocessBookImage(b64, options) {
    var opts = options || {};
    var pad = typeof opts.padding === 'number' ? opts.padding : 24;
    var img = await loadImageFromBase64(b64);
    var w0 = img.naturalWidth || img.width || 800;
    var h0 = img.naturalHeight || img.height || 600;

    var maxDim = Math.max(w0, h0);
    var minDim = Math.min(w0, h0);
    var scale = 1.0;
    if (maxDim > 2000) {
      scale = 2000 / maxDim;
    } else if (maxDim < 950 || minDim < 260) {
      scale = Math.min(2.0, Math.max(950 / Math.max(1, maxDim), 260 / Math.max(1, minDim)));
      if (maxDim * scale > 2000) {
        scale = 2000 / maxDim;
      }
    }

    var W = Math.max(24, Math.round(w0 * scale));
    var H = Math.max(24, Math.round(h0 * scale));

    var workCanvas = document.createElement('canvas');
    workCanvas.width = W;
    workCanvas.height = H;
    var ctx = workCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);

    var imgData = ctx.getImageData(0, 0, W, H);
    var rgba = imgData.data;
    var numPixels = W * H;

    // 1. Convert RGB to perceptual grayscale luminance
    var lum = new Uint8Array(numPixels);
    for (var i = 0, p = 0; i < numPixels; i++, p += 4) {
      lum[i] = (77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2]) >> 8;
    }

    // 2. Two-Pass Integral-Image Shadow & Uneven Illumination Removal
    var stride = W + 1;
    var rBg = Math.max(20, Math.min(85, Math.round(Math.min(W, H) / 12)));
    var sat1 = buildIntegralUint32(lum, W, H);
    var bgOnly = new Uint8Array(numPixels);

    for (var y = 0; y < H; y++) {
      var y0 = Math.max(0, y - rBg);
      var y1 = Math.min(H - 1, y + rBg);
      var rowOffset = y * W;
      for (var x = 0; x < W; x++) {
        var x0 = Math.max(0, x - rBg);
        var x1 = Math.min(W - 1, x + rBg);
        var count = (x1 - x0 + 1) * (y1 - y0 + 1);
        var localMean = boxSum(sat1, stride, x0, y0, x1, y1) / count;
        var v = lum[rowOffset + x];
        // Exclude dark ink strokes from pulling down the local paper illumination estimate
        bgOnly[rowOffset + x] = v < localMean - 6 ? Math.min(255, Math.round(localMean + 4)) : v;
      }
    }

    var sat2 = buildIntegralUint32(bgOnly, W, H);
    var norm = new Uint8Array(numPixels);

    for (var y2 = 0; y2 < H; y2++) {
      var by0 = Math.max(0, y2 - rBg);
      var by1 = Math.min(H - 1, y2 + rBg);
      var rOff = y2 * W;
      for (var x2 = 0; x2 < W; x2++) {
        var bx0 = Math.max(0, x2 - rBg);
        var bx1 = Math.min(W - 1, x2 + rBg);
        var bCount = (bx1 - bx0 + 1) * (by1 - by0 + 1);
        var bgVal = Math.max(30, boxSum(sat2, stride, bx0, by0, bx1, by1) / bCount);
        var normVal = Math.round((lum[rOff + x2] / bgVal) * 250);
        norm[rOff + x2] = normVal > 255 ? 255 : normVal;
      }
    }

    // 3. Global Skew Detection & Rotation Deskewing
    var skewAngle = detectSkewAngleDeg(norm, W, H);
    if (Math.abs(skewAngle) >= 0.2) {
      norm = rotateGrayscale(norm, W, H, skewAngle);
    }

    // 4. Curved Book Line Straightening (De-warping across vertical strips)
    var curveRes = straightenBookCurvature(norm, W, H);
    norm = curveRes.data;

    // 5. Sauvola Local Adaptive Thresholding & Soft Contrast Enhancement
    var satNorm = buildIntegralUint32(norm, W, H);
    var satNormSq = buildIntegralSquaresFloat64(norm, W, H);
    var rLocal = Math.max(12, Math.min(30, Math.round(Math.min(W, H) / 26)));
    var sauvolaK = 0.16;
    var enhanced = new Uint8Array(numPixels);

    for (var y3 = 0; y3 < H; y3++) {
      var ly0 = Math.max(0, y3 - rLocal);
      var ly1 = Math.min(H - 1, y3 + rLocal);
      var row3 = y3 * W;
      for (var x3 = 0; x3 < W; x3++) {
        var lx0 = Math.max(0, x3 - rLocal);
        var lx1 = Math.min(W - 1, x3 + rLocal);
        var lCount = (lx1 - lx0 + 1) * (ly1 - ly0 + 1);
        var sum = boxSum(satNorm, stride, lx0, ly0, lx1, ly1);
        var sumSq = boxSum(satNormSq, stride, lx0, ly0, lx1, ly1);
        var mean = sum / lCount;
        var variance = Math.max(0, sumSq / lCount - mean * mean);
        var std = Math.sqrt(variance);

        var pVal = norm[row3 + x3];
        // Flat paper background guard: prevents grain/noise in empty shadow areas
        if (std < 6.5 && pVal > 195) {
          enhanced[row3 + x3] = 255;
          continue;
        }

        var threshold = mean * (1.0 + sauvolaK * (std / 128.0 - 1.0)) - 3.0;
        if (threshold > 234) threshold = 234;

        if (pVal >= threshold) {
          enhanced[row3 + x3] = 255;
        } else {
          // Smooth contrast ramp near stroke boundary to preserve anti-aliased character shapes for LSTM
          var diff = threshold - pVal;
          var ramp = Math.max(10.0, std * 0.75);
          if (diff >= ramp) {
            enhanced[row3 + x3] = 0;
          } else {
            enhanced[row3 + x3] = Math.round(255 * Math.pow(1.0 - diff / ramp, 1.8) * 0.45);
          }
        }
      }
    }

    // 6. 3x3 Morphological Despeckle (remove isolated 1px salt-and-pepper specks & fill 1px stroke pinholes)
    var cleaned = new Uint8Array(enhanced);
    for (var y4 = 1; y4 < H - 1; y4++) {
      var r4 = y4 * W;
      for (var x4 = 1; x4 < W - 1; x4++) {
        var idx = r4 + x4;
        var cVal = enhanced[idx];
        var darkNeighbors = 0;
        if (enhanced[idx - W - 1] < 160) darkNeighbors++;
        if (enhanced[idx - W] < 160) darkNeighbors++;
        if (enhanced[idx - W + 1] < 160) darkNeighbors++;
        if (enhanced[idx - 1] < 160) darkNeighbors++;
        if (enhanced[idx + 1] < 160) darkNeighbors++;
        if (enhanced[idx + W - 1] < 160) darkNeighbors++;
        if (enhanced[idx + W] < 160) darkNeighbors++;
        if (enhanced[idx + W + 1] < 160) darkNeighbors++;

        if (cVal < 160 && darkNeighbors <= 1) {
          cleaned[idx] = 255;
        } else if (cVal > 180 && darkNeighbors >= 7) {
          cleaned[idx] = 0;
        }
      }
    }

    // Write back to RGBA imageData
    for (var m = 0, q = 0; m < numPixels; m++, q += 4) {
      var g = cleaned[m];
      rgba[q] = g;
      rgba[q + 1] = g;
      rgba[q + 2] = g;
      rgba[q + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    // Output onto padded canvas (white border helps Tesseract near crop edges)
    var outW = W + pad * 2;
    var outH = H + pad * 2;
    var outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    var outCtx = outCanvas.getContext('2d');
    outCtx.fillStyle = '#FFFFFF';
    outCtx.fillRect(0, 0, outW, outH);
    outCtx.drawImage(workCanvas, pad, pad);

    var dataUrl = outCanvas.toDataURL('image/jpeg', 0.92);
    var rawBase64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;

    return {
      base64: rawBase64,
      dataUrl: dataUrl,
      stats: {
        skewAngle: skewAngle,
        curveShiftPx: curveRes.maxShift,
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
      langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
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
        status: 'Removing shadows, deskewing & straightening book lines...',
        percent: 35
      });
      var res = await preprocessBookImage(b64, { padding: 12 });
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
            status: prefix + 'Cleaning shadows, deskewing & straightening lines...',
            percent: Math.round(((i + 0.15) / rois.length) * 100)
          });
          var pre = await preprocessBookImage(b64, { padding: 24 });
          targetBase64 = pre.base64;
          processedRois.push(pre.dataUrl);
          statsList.push(pre.stats);
        }

        postToRN({
          type: 'progress',
          status: prefix + 'Recognizing text (' + langString + ')...',
          percent: Math.round(((i + 0.45) / rois.length) * 100)
        });

        var imgBytes = base64ToUint8Array(targetBase64);
        var result = await worker.recognize(imgBytes);

        var cleaned = (result && result.data && result.data.text ? result.data.text : '').trim();
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

  window.runOcrJobFromRN = function(payload) {
    if (!payload) return;
    if (payload.command === 'run_ocr') {
      runOcrJob(payload.rois, payload.lang, payload.preprocess);
    } else if (payload.command === 'enhance_image') {
      runEnhanceJob(payload.base64);
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
    }
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
        key="tesseract-webview-v5"
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

