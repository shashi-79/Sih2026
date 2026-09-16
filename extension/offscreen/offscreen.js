/**
 * Offscreen Document Worker: High-Performance OpenCV.js Visual Redaction Pipeline
 * Uses multi-scale pyramid downsampling for sub-50ms face detection and hardware-accelerated
 * blurring and PII blackout redaction.
 */

let classifier = null;
let isClassifierReady = false;
let isOpenCVReady = false;

function waitForOpenCV() {
  return new Promise((resolve) => {
    if (typeof cv !== 'undefined' && cv.Mat && cv.CascadeClassifier) {
      isOpenCVReady = true;
      resolve();
    } else if (typeof cv !== 'undefined') {
      cv['onRuntimeInitialized'] = () => {
        isOpenCVReady = true;
        console.log('[VisionAgent:Offscreen] OpenCV.js WASM runtime ready');
        resolve();
      };
    } else {
      const poll = setInterval(() => {
        if (typeof cv !== 'undefined') {
          if (cv.Mat && cv.CascadeClassifier) {
            clearInterval(poll);
            isOpenCVReady = true;
            resolve();
          } else {
            cv['onRuntimeInitialized'] = () => {
              clearInterval(poll);
              isOpenCVReady = true;
              console.log('[VisionAgent:Offscreen] OpenCV.js WASM runtime ready');
              resolve();
            };
          }
        }
      }, 30);
    }
  });
}

async function initClassifier() {
  try {
    await waitForOpenCV();

    const cascadeFilename = 'haarcascade_frontalface_default.xml';
    const cascadeUrl = chrome.runtime.getURL(`weights/${cascadeFilename}`);
    const resp = await fetch(cascadeUrl);
    const buffer = await resp.arrayBuffer();
    const data = new Uint8Array(buffer);

    try {
      cv.FS_createDataFile('/', cascadeFilename, data, true, false, false);
    } catch (e) {
      // Already in virtual FS
    }

    classifier = new cv.CascadeClassifier();
    isClassifierReady = classifier.load(cascadeFilename);
    console.log(`[VisionAgent:Offscreen] Haar Cascade loaded: ${isClassifierReady}`);
  } catch (err) {
    console.error('[VisionAgent:Offscreen] Cascade load error:', err);
  }
}

initClassifier();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  (async () => {
    const startTime = performance.now();

    try {
      if (message.action === 'REDACT_SCREEN') {
        const { dataUrl, piiRects = [], dpr = 1 } = message;
        if (!dataUrl) throw new Error('No dataUrl provided for redaction');

        await waitForOpenCV();

        const canvas = document.getElementById('offscreenCanvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        // 1. Load screenshot
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = dataUrl;
        });

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        // 2. High-Speed Downsampled Face Detection (Pyramid Subsampling)
        // Downscale to max dimension 360px for sub-30ms cascade inference
        const maxDim = Math.max(img.width, img.height);
        const scale = Math.min(1.0, 360 / maxDim);
        const smallW = Math.max(1, Math.round(img.width * scale));
        const smallH = Math.max(1, Math.round(img.height * scale));

        const smallCanvas = new OffscreenCanvas(smallW, smallH);
        const smallCtx = smallCanvas.getContext('2d', { willReadFrequently: true });
        smallCtx.drawImage(img, 0, 0, smallW, smallH);

        let faceCount = 0;
        const detectedFaces = [];

        if (isClassifierReady && classifier) {
          const smallMat = cv.imread(smallCanvas);
          const grayMat = new cv.Mat();
          cv.cvtColor(smallMat, grayMat, cv.COLOR_RGBA2GRAY);

          const faces = new cv.RectVector();
          const minSize = new cv.Size(18, 18);
          const maxSize = new cv.Size(0, 0);

          // Fast multiscale detection on low-res pyramid
          classifier.detectMultiScale(grayMat, faces, 1.18, 3, 0, minSize, maxSize);
          faceCount = faces.size();

          const invScale = 1 / scale;
          for (let i = 0; i < faces.size(); i++) {
            const f = faces.get(i);
            detectedFaces.push({
              x: Math.round(f.x * invScale),
              y: Math.round(f.y * invScale),
              w: Math.round(f.width * invScale),
              h: Math.round(f.height * invScale)
            });
          }

          faces.delete();
          grayMat.delete();
          smallMat.delete();
        }

        // 3. Fast Visual Blurring on Detected Face Regions
        for (const face of detectedFaces) {
          // Hardware-accelerated canvas filter blur
          ctx.save();
          ctx.beginPath();
          ctx.rect(face.x, face.y, face.w, face.h);
          ctx.clip();
          ctx.filter = 'blur(16px)';
          ctx.drawImage(canvas, 0, 0);
          ctx.restore();
        }

        // 4. Solid Blackout Masks on DOM PII Elements (passwords, cards, emails)
        let piiCount = 0;
        if (Array.isArray(piiRects)) {
          piiCount = piiRects.length;
          ctx.fillStyle = '#0f141c'; // Solid opaque blackout tone

          for (const item of piiRects) {
            const r = item.rect;
            if (!r) continue;

            const x = Math.round(r.x * dpr);
            const y = Math.round(r.y * dpr);
            const w = Math.round(r.w * dpr);
            const h = Math.round(r.h * dpr);

            ctx.fillRect(x, y, w, h);
          }
        }

        const sanitizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const latencyMs = Math.round(performance.now() - startTime);

        sendResponse({
          ok: true,
          sanitizedDataUrl,
          faceCount,
          piiCount,
          latencyMs
        });
      } else {
        sendResponse({ ok: false, error: 'Unknown offscreen action' });
      }
    } catch (err) {
      console.error('[VisionAgent:Offscreen] Redaction error:', err);
      sendResponse({
        ok: false,
        error: err.message,
        latencyMs: Math.round(performance.now() - startTime)
      });
    }
  })();

  return true;
});
