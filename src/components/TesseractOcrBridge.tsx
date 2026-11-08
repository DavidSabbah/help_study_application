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

  // Detect if text lines run vertically (90 deg sideways camera orientation)
  // Uses short integral-image ribbons in the central 50% of the image
  function detect90DegRotation(norm, W, H) {
    if (W < 120 || H < 120) return 0;
    var stride = W + 1;
    var sat = buildIntegralUint32(norm, W, H);
    var halfLen = Math.max(16, Math.min(36, Math.round(Math.min(W, H) / 36)));
    var halfThick = 1;
    var step = Math.max(4, Math.round(halfLen / 4));
    var boxArea = (2 * halfLen + 1) * (2 * halfThick + 1);

    var x0 = Math.max(halfLen + step + 2, Math.floor(W * 0.25));
    var x1 = Math.min(W - halfLen - step - 3, Math.floor(W * 0.75));
    var y0 = Math.max(halfLen + step + 2, Math.floor(H * 0.25));
    var y1 = Math.min(H - halfLen - step - 3, Math.floor(H * 0.75));

    var horizScore = 0;
    var vertScore = 0;

    for (var y = y0; y < y1; y += step) {
      for (var x = x0; x < x1; x += step) {
        var hAbove = boxSum(sat, stride, x - halfLen, y - step - halfThick, x + halfLen, y - step + halfThick) / boxArea;
        var hBelow = boxSum(sat, stride, x - halfLen, y + step - halfThick, x + halfLen, y + step + halfThick) / boxArea;
        var dh = hBelow - hAbove;
        horizScore += dh * dh;

        var vLeft = boxSum(sat, stride, x - step - halfThick, y - halfLen, x - step + halfThick, y + halfLen) / boxArea;
        var vRight = boxSum(sat, stride, x + step - halfThick, y - halfLen, x + step + halfThick, y + halfLen) / boxArea;
        var dv = vRight - vLeft;
        vertScore += dv * dv;
      }
    }

    if (vertScore > horizScore * 1.5) {
      return 90;
    }
    return 0;
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
    return rise3 > fall3 * 1.08;
  }

  // Detect global skew angle in degrees (-12..+12) via horizontal projection profile gradient variance
  function detectSkewAngleDeg(norm, W, H) {
    var step = Math.max(1, Math.floor(Math.max(W, H) / 420));
    var marginX = Math.floor(W * 0.16);
    var marginY = Math.floor(H * 0.10);
    var ptsX = [];
    var ptsY = [];
    var cx = W * 0.5;
    var cy = H * 0.5;

    for (var y = marginY; y < H - marginY; y += step) {
      var row = y * W;
      for (var x = marginX; x < W - marginX; x += step) {
        if (norm[row + x] < 195) {
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

    for (var deg = -12; deg <= 12; deg += 1.0) {
      if (deg === 0) continue;
      var sc = scoreAngle(deg);
      if (sc > bestScore) {
        bestScore = sc;
        bestAngle = deg;
      }
    }

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

  // 2D Multi-Band Locked-Template Book Curvature & Perspective Fan Straightening
  function straightenBookCurvature2D(src, W, H) {
    if (W < 160 || H < 80) {
      return { data: src, maxShift: 0 };
    }

    var numStrips = 28;
    var marginX = Math.floor(W * 0.06);
    var usableW = W - 2 * marginX;
    var stripW = Math.max(6, Math.floor(usableW / numStrips));
    var refStrip = Math.floor(numStrips * 0.55);

    var stripRowEnergy = new Float32Array(numStrips * H);
    var rowTextEnergy = new Float32Array(H);

    for (var s = 0; s < numStrips; s++) {
      var sx0 = Math.max(2, marginX + s * stripW);
      var sx1 = Math.min(W - 2, s === numStrips - 1 ? W - marginX : sx0 + stripW);
      var stripLen = Math.max(1, sx1 - sx0);
      var sOff = s * H;

      for (var y = 4; y < H - 4; y++) {
        var row = y * W;
        var sum = 0;
        var inkCount = 0;
        for (var x = sx0; x < sx1; x++) {
          var v = src[row + x];
          if (v < 195) {
            inkCount++;
            var gradX = Math.abs(src[row + x + 1] - src[row + x - 1]);
            if (gradX > 18) {
              sum += gradX;
            }
          }
        }
        if (inkCount > stripLen * 0.82) {
          sum = 0;
        }
        stripRowEnergy[sOff + y] = sum;
        if (s >= 5 && s <= numStrips - 6) {
          rowTextEnergy[y] += sum;
        }
      }
    }

    var meanRowEnergy = 0;
    for (var ry = 0; ry < H; ry++) meanRowEnergy += rowTextEnergy[ry];
    meanRowEnergy /= H;
    var rowThresh = meanRowEnergy * 0.25;

    var yTextMin = Math.floor(H * 0.08);
    var yTextMax = Math.floor(H * 0.92);
    for (var ty = Math.floor(H * 0.04); ty < H * 0.45; ty++) {
      if (rowTextEnergy[ty] > rowThresh) {
        yTextMin = Math.max(8, ty - 16);
        break;
      }
    }
    for (var by = Math.floor(H * 0.96); by > H * 0.55; by--) {
      if (rowTextEnergy[by] > rowThresh) {
        yTextMax = Math.min(H - 8, by + 16);
        break;
      }
    }

    var textSpanH = Math.max(80, yTextMax - yTextMin);
    var numBands = textSpanH > 450 ? 8 : 3;
    var bandCentersY = new Float32Array(numBands);
    var bandOffsets = [];
    var globalMaxShift = 0;

    for (var b = 0; b < numBands; b++) {
      var by0 = Math.max(4, Math.floor(yTextMin + ((b - 0.35) / numBands) * textSpanH));
      var by1 = Math.min(H - 4, Math.floor(yTextMin + ((b + 1.35) / numBands) * textSpanH));
      var bandH = by1 - by0;
      bandCentersY[b] = yTextMin + ((b + 0.5) / numBands) * textSpanH;

      var profiles = [];
      var energies = [];

      for (var s2 = 0; s2 < numStrips; s2++) {
        var sOff2 = s2 * H;
        var sx0_2 = marginX + s2 * stripW;
        var sx1_2 = s2 === numStrips - 1 ? W - marginX : Math.min(W - marginX, sx0_2 + stripW);
        var rawProf = new Float32Array(bandH);
        var totalEnergy = 0;

        for (var y2 = by0; y2 < by1; y2++) {
          var val = stripRowEnergy[sOff2 + y2];
          rawProf[y2 - by0] = val;
          totalEnergy += val;
        }

        var smoothProf = new Float32Array(bandH);
        var meanP = 0;
        for (var i = 1; i < bandH - 1; i++) {
          smoothProf[i] = 0.25 * rawProf[i - 1] + 0.5 * rawProf[i] + 0.25 * rawProf[i + 1];
          meanP += smoothProf[i];
        }
        meanP /= Math.max(1, bandH);

        var normSq = 0;
        for (var i2 = 0; i2 < bandH; i2++) {
          var centered = smoothProf[i2] - meanP;
          smoothProf[i2] = centered;
          normSq += centered * centered;
        }
        var invNorm = normSq > 1e-3 ? 1.0 / Math.sqrt(normSq) : 0;
        for (var i3 = 0; i3 < bandH; i3++) {
          smoothProf[i3] *= invNorm;
        }

        profiles.push(smoothProf);
        energies.push(totalEnergy / Math.max(1, (sx1_2 - sx0_2) * bandH));
      }

      var maxStepDelta = Math.max(4, Math.min(11, Math.round(H / 90)));
      var maxTotalShift = Math.round(H * 0.085);
      var offsets = new Float32Array(numStrips);
      offsets[refStrip] = 0;

      var template = new Float32Array(bandH);
      for (var tIdx = 0; tIdx < bandH; tIdx++) {
        template[tIdx] = profiles[refStrip][tIdx];
      }

      function alignStripToTemplate(prof, prevProf, prevOffset) {
        var bestShift = prevOffset;
        var bestScore = -1e9;
        var minD = Math.max(-maxTotalShift, Math.round(prevOffset) - maxStepDelta);
        var maxD = Math.min(maxTotalShift, Math.round(prevOffset) + maxStepDelta);
        var scores = new Float64Array(maxD - minD + 1);

        for (var d = minD; d <= maxD; d++) {
          var corrTemplate = 0;
          var corrPrev = 0;
          var yStart = Math.max(4, -d + 4, Math.round(-prevOffset) + 4);
          var yEnd = Math.min(bandH - 4, bandH - 4 - d, bandH - 4 - Math.round(prevOffset));
          var prevInt = Math.round(prevOffset);
          for (var y3 = yStart; y3 < yEnd; y3++) {
            var pVal = prof[y3 + d];
            corrTemplate += template[y3] * pVal;
            corrPrev += prevProf[y3 + prevInt] * pVal;
          }
          var stepDiff = d - prevOffset;
          var score = 0.55 * corrTemplate + 0.45 * corrPrev - 0.0025 * stepDiff * stepDiff;
          scores[d - minD] = score;
          if (score > bestScore) {
            bestScore = score;
            bestShift = d;
          }
        }

        if (bestScore < 0.16) {
          return prevOffset;
        }

        var subShift = bestShift;
        var idx = bestShift - minD;
        if (idx > 0 && idx < maxD - minD) {
          var sL = scores[idx - 1];
          var sM = scores[idx];
          var sR = scores[idx + 1];
          var denom = 2 * (2 * sM - sL - sR);
          if (denom > 1e-6) {
            subShift += (sR - sL) / denom;
          }
        }

        var shiftInt = Math.round(subShift);
        for (var y4 = 4; y4 < bandH - 4; y4++) {
          var sy = y4 + shiftInt;
          if (sy >= 0 && sy < bandH) {
            template[y4] = 0.78 * template[y4] + 0.22 * prof[sy];
          }
        }

        return subShift;
      }

      for (var sr = refStrip + 1; sr < numStrips; sr++) {
        if (energies[sr] < 1.2) {
          var slopeR = sr >= refStrip + 2 ? (offsets[sr - 1] - offsets[sr - 2]) * 0.5 : 0;
          offsets[sr] = offsets[sr - 1] + slopeR;
        } else {
          offsets[sr] = alignStripToTemplate(profiles[sr], profiles[sr - 1], offsets[sr - 1]);
        }
      }

      for (var tIdx2 = 0; tIdx2 < bandH; tIdx2++) {
        template[tIdx2] = profiles[refStrip][tIdx2];
      }
      for (var sl = refStrip - 1; sl >= 0; sl--) {
        if (energies[sl] < 1.2) {
          var slopeL = sl <= refStrip - 2 ? (offsets[sl + 1] - offsets[sl + 2]) * 0.5 : 0;
          offsets[sl] = offsets[sl + 1] + slopeL;
        } else {
          offsets[sl] = alignStripToTemplate(profiles[sl], profiles[sl + 1], offsets[sl + 1]);
        }
      }

      var smoothed = new Float32Array(numStrips);
      for (var sm = 0; sm < numStrips; sm++) {
        var p0 = offsets[Math.max(0, sm - 1)];
        var p1 = offsets[sm];
        var p2 = offsets[Math.min(numStrips - 1, sm + 1)];
        var smVal = 0.25 * p0 + 0.5 * p1 + 0.25 * p2;
        smoothed[sm] = smVal;
        if (Math.abs(smVal) > globalMaxShift) {
          globalMaxShift = Math.abs(smVal);
        }
      }
      bandOffsets.push(smoothed);
    }

    if (globalMaxShift < 0.5) {
      return { data: src, maxShift: 0 };
    }

    var sIdx0 = new Int32Array(W);
    var sIdx1 = new Int32Array(W);
    var sFrac = new Float32Array(W);
    for (var col = 0; col < W; col++) {
      var pos = ((col - marginX) / Math.max(1, stripW)) - 0.5;
      if (pos <= 0) {
        sIdx0[col] = 0;
        sIdx1[col] = 0;
        sFrac[col] = 0;
      } else if (pos >= numStrips - 1) {
        sIdx0[col] = numStrips - 1;
        sIdx1[col] = numStrips - 1;
        sFrac[col] = 0;
      } else {
        var idx0 = pos | 0;
        sIdx0[col] = idx0;
        sIdx1[col] = idx0 + 1;
        sFrac[col] = pos - idx0;
      }
    }

    var dst = new Uint8Array(W * H);
    for (var yOut = 0; yOut < H; yOut++) {
      var b0 = 0;
      var b1 = 0;
      var bf = 0;
      if (yOut <= bandCentersY[0]) {
        b0 = 0;
        b1 = 0;
        bf = 0;
      } else if (yOut >= bandCentersY[numBands - 1]) {
        b0 = numBands - 1;
        b1 = numBands - 1;
        bf = 0;
      } else {
        for (var bIdx = 0; bIdx < numBands - 1; bIdx++) {
          if (yOut >= bandCentersY[bIdx] && yOut <= bandCentersY[bIdx + 1]) {
            b0 = bIdx;
            b1 = bIdx + 1;
            bf = (yOut - bandCentersY[bIdx]) / Math.max(1, bandCentersY[bIdx + 1] - bandCentersY[bIdx]);
            break;
          }
        }
      }

      var offB0 = bandOffsets[b0];
      var offB1 = bandOffsets[b1];
      var outRow = yOut * W;

      for (var xOut = 0; xOut < W; xOut++) {
        var i0 = sIdx0[xOut];
        var i1 = sIdx1[xOut];
        var sf = sFrac[xOut];

        var shift0 = offB0[i0] * (1 - sf) + offB0[i1] * sf;
        var shift1 = offB1[i0] * (1 - sf) + offB1[i1] * sf;
        var shiftY = shift0 * (1 - bf) + shift1 * bf;

        var syOut = yOut + shiftY;
        if (syOut < 0 || syOut >= H - 1) {
          dst[outRow + xOut] = 252;
        } else {
          var y0 = syOut | 0;
          var fy = syOut - y0;
          var v0 = src[y0 * W + xOut];
          var v1 = src[(y0 + 1) * W + xOut];
          dst[outRow + xOut] = Math.round(v0 + fy * (v1 - v0));
        }
      }
    }

    return {
      data: dst,
      maxShift: Math.round(globalMaxShift * 10) / 10
    };
  }

  function sharpenGrayscale3x3(src, W, H) {
    var dst = new Uint8Array(src);
    for (var y = 1; y < H - 1; y++) {
      var r = y * W;
      for (var x = 1; x < W - 1; x++) {
        var idx = r + x;
        var c = src[idx];
        var blur =
          (src[idx - W - 1] + src[idx - W] * 2 + src[idx - W + 1] +
           src[idx - 1] * 2 + c * 4 + src[idx + 1] * 2 +
           src[idx + W - 1] + src[idx + W] * 2 + src[idx + W + 1]) >> 4;
        var val = c + (((c - blur) * 3) >> 2);
        dst[idx] = val < 0 ? 0 : val > 255 ? 255 : val;
      }
    }
    return dst;
  }

  /**
   * Standard Document / Book Image Processing Pipeline:
   * 1. Resolution normalization (upscales small ROIs, caps very large images)
   * 2. 2-Pass Integral Image Background Estimation & Division Normalization (removes shadows & uneven lighting)
   * 3. Auto 90-deg sideways rotation detection + 180-deg baseline-asymmetry upright check
   * 4. Global Skew Detection & Bilinear Deskewing
   * 5. 2D Multi-Band Locked-Template Book Curvature & Perspective Fan Straightening
   * 6. 3x3 Unsharp Mask + Bleed-Through Suppressing Sauvola Adaptive Contrast + 3x3 Despeckle
   * 7. Pure White Border Padding for optimal Tesseract LSTM recognition
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
    var rBg = Math.max(18, Math.min(75, Math.round(Math.min(W, H) / 14)));
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
        bgOnly[rowOffset + x] = v < localMean - 7 ? Math.min(255, Math.round(localMean + 4)) : v;
      }
    }

    var sat2 = buildIntegralUint32(bgOnly, W, H);
    var norm = new Uint8Array(numPixels);
    var rBgFine = Math.max(12, Math.round(rBg * 0.65));

    for (var y2 = 0; y2 < H; y2++) {
      var by0 = Math.max(0, y2 - rBgFine);
      var by1 = Math.min(H - 1, y2 + rBgFine);
      var rOff = y2 * W;
      for (var x2 = 0; x2 < W; x2++) {
        var bx0 = Math.max(0, x2 - rBgFine);
        var bx1 = Math.min(W - 1, x2 + rBgFine);
        var bCount = (bx1 - bx0 + 1) * (by1 - by0 + 1);
        var bgVal = Math.max(30, boxSum(sat2, stride, bx0, by0, bx1, by1) / bCount);
        var normVal = Math.round((lum[rOff + x2] / bgVal) * 250);
        norm[rOff + x2] = normVal > 255 ? 255 : normVal;
      }
    }

    // 3. Auto 90-degree sideways rotation check
    var rot90 = detect90DegRotation(norm, W, H);
    if (rot90 !== 0) {
      var rotated90 = rotate90CCW(norm, W, H);
      norm = rotated90.data;
      W = rotated90.width;
      H = rotated90.height;
      stride = W + 1;
      rot90 = -90;
    }

    // 4. Global Skew Detection & Rotation Deskewing
    var skewAngle = detectSkewAngleDeg(norm, W, H);
    if (Math.abs(skewAngle) >= 0.2) {
      norm = rotateGrayscale(norm, W, H, skewAngle);
    }

    // 5. 2D Multi-Band Book Line Straightening (De-warping curvature & perspective fan)
    var curveRes = straightenBookCurvature2D(norm, W, H);
    norm = curveRes.data;

    // If rotated 90 degrees, verify upright vs upside-down using baseline derivative asymmetry
    if (rot90 !== 0 && isTextUpsideDown(norm, W, H)) {
      norm = rotate180(norm, W, H);
      rot90 = 90;
    }

    // 6. 3x3 Unsharp Mask + Bleed-Through Suppressing Sauvola Local Adaptive Contrast
    norm = sharpenGrayscale3x3(norm, W, H);
    var satNorm = buildIntegralUint32(norm, W, H);
    var satNormSq = buildIntegralSquaresFloat64(norm, W, H);
    var rLocal = Math.max(12, Math.min(28, Math.round(Math.min(W, H) / 28)));
    var sauvolaK = 0.20;
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
        // Suppress reverse-page bleed-through and shadow grain in paper background
        if (pVal >= 214 || (std < 8.5 && pVal > 190)) {
          enhanced[row3 + x3] = 255;
          continue;
        }

        var threshold = mean * (1.0 + sauvolaK * (std / 128.0 - 1.0)) - 4.0;
        if (threshold > 212) threshold = 212;

        if (pVal >= threshold) {
          enhanced[row3 + x3] = 255;
        } else {
          var diff = threshold - pVal;
          var ramp = Math.max(10.0, std * 0.7);
          if (diff >= ramp) {
            enhanced[row3 + x3] = 0;
          } else {
            enhanced[row3 + x3] = Math.round(255 * Math.pow(1.0 - diff / ramp, 1.9) * 0.4);
          }
        }
      }
    }

    // 7. 3x3 Morphological Despeckle (remove isolated 1px specks & fill 1px stroke pinholes)
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

    workCanvas.width = W;
    workCanvas.height = H;
    var finalImgData = ctx.createImageData(W, H);
    var finalRgba = finalImgData.data;
    for (var m = 0, q = 0; m < numPixels; m++, q += 4) {
      var g = cleaned[m];
      finalRgba[q] = g;
      finalRgba[q + 1] = g;
      finalRgba[q + 2] = g;
      finalRgba[q + 3] = 255;
    }
    ctx.putImageData(finalImgData, 0, 0);

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
        rot90: rot90,
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

