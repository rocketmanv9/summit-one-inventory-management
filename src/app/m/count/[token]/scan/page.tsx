import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Scan Items' };

/**
 * Mobile scan page — pure server component with inline script.
 * NO 'use client', NO React hydration, NO external JS chunks from Vercel.
 * Loads html5-qrcode from jsDelivr CDN (not blocked by Vercel deploy protection).
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
            background: #000; color: #fff;
          }
          .wrap { display: flex; flex-direction: column; min-height: 100dvh; }
          .top {
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px; padding-top: calc(env(safe-area-inset-top, 0px) + 16px);
            z-index: 10; position: relative; background: #000;
          }
          .top-title { color: #fff; font-weight: 600; font-size: 17px; }
          .close-btn {
            width: 40px; height: 40px; background: rgba(255,255,255,0.2);
            border-radius: 50%; display: flex; align-items: center; justify-content: center;
            border: none; cursor: pointer; -webkit-tap-highlight-color: transparent;
            text-decoration: none;
          }
          .toast {
            padding: 12px 20px; color: #fff; text-align: center;
            font-size: 15px; font-weight: 600; z-index: 20;
            transition: opacity 0.3s;
          }
          .toast-ok { background: rgba(22, 163, 74, 0.95); }
          .toast-err { background: rgba(220, 38, 38, 0.95); }
          .toast-hide { opacity: 0; height: 0; padding: 0; overflow: hidden; }
          .scanner-area {
            flex: 1; display: flex; align-items: center; justify-content: center;
            overflow: hidden; position: relative; background: #000;
            min-height: 300px;
          }
          #scanner-region { width: 100%; }
          #scanner-region video { width: 100% !important; height: auto !important; }
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

          <div className="scanner-area">
            <div id="scanner-region"></div>

            {/* Idle state — shown before user taps Start */}
            <div id="state-idle" className="center-msg">
              <button id="start-btn" className="start-btn" type="button">
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Start Scanner
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

  // Set bypass cookie
  if (BYPASS) {
    document.cookie = "x-vercel-protection-bypass=" + BYPASS + ";path=/;secure;samesite=lax;max-age=86400";
  }

  var toast = document.getElementById('toast');
  var title = document.getElementById('title');
  var hint = document.getElementById('hint');
  var stateIdle = document.getElementById('state-idle');
  var stateStarting = document.getElementById('state-starting');
  var stateError = document.getElementById('state-error');
  var errorMsg = document.getElementById('error-msg');
  var startBtn = document.getElementById('start-btn');
  var retryBtn = document.getElementById('retry-btn');
  var manualInput = document.getElementById('manual-input');
  var goBtn = document.getElementById('go-btn');

  var scanner = null;
  var scanCount = 0;
  var cooldown = false;
  var libLoaded = false;

  // Dynamically load html5-qrcode from CDN
  function loadLib(cb) {
    if (libLoaded) { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
    s.onload = function() { libLoaded = true; cb(); };
    s.onerror = function() {
      errorMsg.textContent = 'Failed to load scanner library. Check internet connection.';
      showState('error');
    };
    document.head.appendChild(s);
  }

  function showState(name) {
    stateIdle.style.display = name === 'idle' ? '' : 'none';
    stateStarting.style.display = name === 'starting' ? '' : 'none';
    stateError.style.display = name === 'error' ? '' : 'none';
    hint.style.display = name === 'scanning' ? '' : 'none';
    // Hide the scanner region when not scanning
    var region = document.getElementById('scanner-region');
    if (region) region.style.display = (name === 'scanning') ? '' : 'none';
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
      if (BYPASS) headers['x-vercel-protection-bypass'] = BYPASS;
      var res = await fetch(API, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ code: code }),
      });
      var data = await res.json();
      if (!res.ok || data.error) {
        var errMsg = (data.error && (data.error.message || (typeof data.error === 'string' ? data.error : null))) || 'Request failed';
        showToast(errMsg, true);
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

  function startScanner() {
    showState('starting');

    // Load library from CDN then init scanner
    loadLib(initScanner);
  }

  function initScanner() {
    if (typeof Html5Qrcode === 'undefined') {
      errorMsg.textContent = 'Scanner library failed to load. Check your internet connection and try again.';
      showState('error');
      return;
    }

    // Clean up previous scanner instance if any
    if (scanner) {
      try { scanner.stop().catch(function(){}); } catch(e) {}
      try { scanner.clear(); } catch(e) {}
      scanner = null;
    }

    // Clear the scanner region
    var region = document.getElementById('scanner-region');
    region.innerHTML = '';

    scanner = new Html5Qrcode('scanner-region');

    scanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: { width: 250, height: 150 },
        aspectRatio: 1.777,
        disableFlip: false,
      },
      function onSuccess(decodedText) {
        if (!cooldown) {
          handleCode(decodedText);
        }
      },
      function onFailure() {
        // Ignore — no barcode in frame
      }
    ).then(function() {
      showState('scanning');
    }).catch(function(err) {
      var msg = String(err || '');
      if (msg.indexOf('NotAllowed') !== -1) {
        msg = 'Camera access denied. Please allow camera in your browser settings and try again.';
      } else if (msg.indexOf('NotFound') !== -1) {
        msg = 'No camera found on this device.';
      } else {
        msg = 'Camera error: ' + msg;
      }
      errorMsg.textContent = msg;
      showState('error');
    });
  }

  // Event listeners
  startBtn.addEventListener('click', startScanner);
  retryBtn.addEventListener('click', startScanner);

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
