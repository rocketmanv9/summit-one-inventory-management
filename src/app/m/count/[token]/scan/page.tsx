import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Scan Items' };

/**
 * Mobile scan page — pure server component with inline script.
 * NO 'use client', NO React hydration, NO external JS chunks.
 * Everything runs from a single inline <script> so Vercel deployment
 * protection can't block it.
 */
export default async function MobileScanPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const bypass = (sp['x-vercel-protection-bypass'] as string) || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
  const apiUrl = `/m/count/${token}/scan-api`;
  const countUrl = `/m/count/${token}${bypass ? `?x-vercel-protection-bypass=${encodeURIComponent(bypass)}` : ''}`;

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Scan Items</title>
        <style dangerouslySetInnerHTML={{ __html: `
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #000; color: #fff; overflow: hidden;
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          }
          .wrap { display: flex; flex-direction: column; height: 100dvh; }
          .top {
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px; padding-top: calc(env(safe-area-inset-top, 0px) + 16px);
            z-index: 10; position: relative;
          }
          .top-title { color: #fff; font-weight: 600; font-size: 17px; }
          .close-btn {
            width: 40px; height: 40px; background: rgba(255,255,255,0.2);
            border-radius: 50%; display: flex; align-items: center; justify-content: center;
            border: none; cursor: pointer; -webkit-tap-highlight-color: transparent;
          }
          .toast {
            padding: 12px 20px; color: #fff; text-align: center;
            font-size: 15px; font-weight: 600; z-index: 20;
            transition: opacity 0.3s;
          }
          .toast-ok { background: rgba(22, 163, 74, 0.95); }
          .toast-err { background: rgba(220, 38, 38, 0.95); }
          .toast-hide { opacity: 0; height: 0; padding: 0; overflow: hidden; }
          .cam-area {
            flex: 1; display: flex; align-items: center; justify-content: center;
            overflow: hidden; position: relative;
          }
          .cam-video {
            width: 100%; height: 100%; object-fit: cover; display: none;
          }
          .cam-video.active { display: block; }
          .guide {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 260px; height: 160px; border: 2px solid rgba(255,255,255,0.6);
            border-radius: 12px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.3);
            display: none;
          }
          .guide.active { display: block; }
          .center-msg {
            position: absolute; text-align: center; padding: 24px;
            color: rgba(255,255,255,0.7); font-size: 15px;
          }
          .center-msg.error { color: #fca5a5; }
          .start-btn {
            padding: 20px 40px; background: #2563eb; color: #fff;
            border-radius: 16px; font-weight: 700; font-size: 18px; border: none;
            cursor: pointer; display: inline-flex; align-items: center; gap: 12px;
            box-shadow: 0 4px 14px rgba(37,99,235,0.4);
            -webkit-tap-highlight-color: transparent;
          }
          .retry-btn {
            padding: 12px 24px; background: rgba(255,255,255,0.2); color: #fff;
            border-radius: 10px; font-weight: 600; font-size: 14px; border: none;
            cursor: pointer; margin-top: 16px; -webkit-tap-highlight-color: transparent;
          }
          .bottom {
            padding: 16px 20px;
            padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
            background: rgba(0,0,0,0.85);
          }
          .hint { color: rgba(255,255,255,0.6); font-size: 13px; text-align: center; margin: 0 0 12px; }
          .row { display: flex; gap: 8px; }
          .m-input {
            flex: 1; padding: 12px 16px; font-size: 16px; border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.3); background: rgba(255,255,255,0.15);
            color: #fff; -webkit-appearance: none; appearance: none; outline: none;
          }
          .go-btn {
            padding: 12px 20px; background: #2563eb; color: #fff; border-radius: 10px;
            font-weight: 600; font-size: 14px; border: none; cursor: pointer;
            white-space: nowrap; -webkit-tap-highlight-color: transparent;
          }
          .go-btn:disabled { opacity: 0.5; }
          .back-link {
            display: block; width: 100%; margin-top: 12px; padding: 12px;
            background: none; color: rgba(255,255,255,0.6); font-size: 14px;
            border: none; cursor: pointer; text-decoration: underline; text-align: center;
            -webkit-tap-highlight-color: transparent;
          }
        `}} />
      </head>
      <body>
        <div className="wrap">
          <div className="top">
            <span className="top-title" id="title">Scan Items</span>
            <a href={countUrl} className="close-btn">
              <svg width="24" height="24" fill="none" stroke="#fff" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </a>
          </div>

          <div id="toast" className="toast toast-hide"></div>

          <div className="cam-area">
            <video id="video" className="cam-video" playsInline muted />
            <div id="guide" className="guide"></div>

            {/* Idle state */}
            <div id="state-idle" className="center-msg">
              <button id="start-btn" className="start-btn" type="button">
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Start Camera
              </button>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', marginTop: '16px' }}>
                Tap to open camera and scan barcodes
              </p>
            </div>

            {/* Starting state */}
            <div id="state-starting" className="center-msg" style={{ display: 'none' }}>
              Starting camera...
            </div>

            {/* Error state */}
            <div id="state-error" className="center-msg error" style={{ display: 'none' }}>
              <p id="error-msg"></p>
              <button id="retry-btn" className="retry-btn" type="button">Try Again</button>
            </div>

            {/* No detector */}
            <div id="state-nodetect" style={{
              display: 'none', position: 'absolute', bottom: 16, left: 16, right: 16,
              background: 'rgba(0,0,0,0.7)', borderRadius: 10, padding: 12,
              color: 'rgba(255,255,255,0.8)', fontSize: 13, textAlign: 'center',
            }}>
              Auto-detect not available. Type codes below.
            </div>
          </div>

          <div className="bottom">
            <p id="hint" className="hint" style={{ display: 'none' }}>Point at a barcode or QR code</p>
            <div className="row">
              <input id="manual-input" className="m-input" type="text" inputMode="text"
                placeholder="Type barcode, SKU, or asset tag..." />
              <button id="go-btn" className="go-btn" type="button">Go</button>
            </div>
            <a href={countUrl} className="back-link">Back to count</a>
          </div>
        </div>

        <script dangerouslySetInnerHTML={{ __html: `
(function() {
  var API = ${JSON.stringify(apiUrl)};
  var BYPASS = ${JSON.stringify(bypass)};
  var COUNT_URL = ${JSON.stringify(countUrl)};

  // Set bypass cookie
  if (BYPASS) {
    document.cookie = "x-vercel-protection-bypass=" + BYPASS + ";path=/;secure;samesite=lax;max-age=86400";
  }

  var video = document.getElementById('video');
  var guide = document.getElementById('guide');
  var toast = document.getElementById('toast');
  var title = document.getElementById('title');
  var hint = document.getElementById('hint');
  var stateIdle = document.getElementById('state-idle');
  var stateStarting = document.getElementById('state-starting');
  var stateError = document.getElementById('state-error');
  var stateNodetect = document.getElementById('state-nodetect');
  var errorMsg = document.getElementById('error-msg');
  var startBtn = document.getElementById('start-btn');
  var retryBtn = document.getElementById('retry-btn');
  var manualInput = document.getElementById('manual-input');
  var goBtn = document.getElementById('go-btn');

  var stream = null;
  var scanCount = 0;
  var cooldown = false;
  var detecting = false;
  var frameId = 0;

  function showState(name) {
    stateIdle.style.display = name === 'idle' ? '' : 'none';
    stateStarting.style.display = name === 'starting' ? '' : 'none';
    stateError.style.display = name === 'error' ? '' : 'none';
    stateNodetect.style.display = name === 'nodetect' ? '' : 'none';
    video.className = (name === 'scanning' || name === 'nodetect') ? 'cam-video active' : 'cam-video';
    guide.className = name === 'scanning' ? 'guide active' : 'guide';
    hint.style.display = name === 'scanning' ? '' : 'none';
  }

  var toastTimer = null;
  function showToast(text, isError) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = text;
    toast.className = 'toast ' + (isError ? 'toast-err' : 'toast-ok');
    toastTimer = setTimeout(function() {
      toast.className = 'toast toast-hide';
    }, 2500);
  }

  function updateTitle() {
    title.textContent = 'Scan Items' + (scanCount > 0 ? ' (' + scanCount + ')' : '');
  }

  async function handleCode(code) {
    if (cooldown || !code) return;
    cooldown = true;

    try {
      var headers = { 'Content-Type': 'application/json' };
      if (BYPASS) {
        headers['x-vercel-protection-bypass'] = BYPASS;
      }
      var res = await fetch(API, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ code: code }),
      });
      var data = await res.json();
      if (!res.ok || data.error) {
        showToast(data.error || 'Request failed', true);
      } else {
        showToast(data.itemName + ' \\u2192 ' + data.newQty, false);
        scanCount++;
        updateTitle();
      }
    } catch (err) {
      showToast('Network error: ' + (err.message || 'unknown'), true);
    }

    setTimeout(function() { cooldown = false; }, 2000);
  }

  async function startCamera() {
    showState('starting');

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) {
      var msg = 'Camera error: ' + (err.message || err.name || 'unknown');
      if (err.name === 'NotAllowedError') {
        msg = 'Camera access denied. Please allow camera in your browser settings and try again.';
      } else if (err.name === 'NotFoundError') {
        msg = 'No camera found on this device.';
      }
      errorMsg.textContent = msg;
      showState('error');
      return;
    }

    video.srcObject = stream;
    try {
      await video.play();
    } catch (err) {
      errorMsg.textContent = 'Video playback failed: ' + (err.message || 'unknown');
      showState('error');
      stream.getTracks().forEach(function(t) { t.stop(); });
      stream = null;
      return;
    }

    // Start BarcodeDetector if available
    if ('BarcodeDetector' in window) {
      try {
        var detector = new BarcodeDetector({
          formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'data_matrix'],
        });
        showState('scanning');

        function detect() {
          if (!video || video.readyState < 2) {
            frameId = requestAnimationFrame(detect);
            return;
          }
          if (!detecting && !cooldown) {
            detecting = true;
            detector.detect(video).then(function(barcodes) {
              if (barcodes.length > 0 && !cooldown) {
                handleCode(barcodes[0].rawValue);
              }
              detecting = false;
            }).catch(function() {
              detecting = false;
            });
          }
          frameId = requestAnimationFrame(detect);
        }
        frameId = requestAnimationFrame(detect);
      } catch (e) {
        showState('nodetect');
      }
    } else {
      showState('nodetect');
    }
  }

  // Event listeners
  startBtn.addEventListener('click', startCamera);
  retryBtn.addEventListener('click', startCamera);

  goBtn.addEventListener('click', function() {
    var code = manualInput.value.trim();
    if (code) {
      manualInput.value = '';
      handleCode(code);
    }
  });

  manualInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var code = manualInput.value.trim();
      if (code) {
        manualInput.value = '';
        handleCode(code);
      }
    }
  });
})();
        `}} />
      </body>
    </html>
  );
}
