/**
 * QrScanner — Camera-based QR code scanner modal.
 * Uses jsQR for browser-based decoding via getUserMedia.
 */
import { useRef, useState, useEffect } from 'react';
import './QrScanner.css';

export default function QrScanner({ onCode, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Starting camera…');

  useEffect(() => {
    let active = true;

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };

    const scan = async () => {
      let jsQR;
      try {
        const mod = await import('jsqr');
        jsQR = mod.default || mod;
      } catch {
        if (active) setError('QR scanner library not available');
        return;
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch {
        if (active) setError('Camera access denied. Please allow camera permission.');
        return;
      }

      if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setStatus('Point at the QR code on the TV…');
      }

      const tick = () => {
        if (!active) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video && video.readyState === video.HAVE_ENOUGH_DATA && canvas) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) {
            const match = code.data.match(/[?&]session=([A-Z0-9]{4,24})/i);
            const extracted = match
              ? match[1].toUpperCase()
              : code.data.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
            if (extracted.length >= 4) {
              stop();
              if (active) onCode(extracted);
              return;
            }
          }
        }  
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    scan();
    return () => { active = false; stop(); };
  }, [onCode]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal qr-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <h3 className="text-lg font-semibold">Scan TV QR Code</h3>
          <button className="btn-icon btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="qr-viewport">
          {error ? (
            <div className="qr-error text-sm text-secondary">{error}</div>
          ) : (
            <>
              <video ref={videoRef} className="qr-video" playsInline muted />
              <canvas ref={canvasRef} className="qr-canvas" />
              <div className="qr-reticle">
                <span /><span /><span /><span />
              </div>
              <div className="qr-status">
                <span className="qr-status-dot" />
                <span className="qr-status-dot" />
                <span className="qr-status-dot" />
              </div>
            </>
          )}
        </div>
        <p className="text-xs text-dim text-center" style={{ marginTop: 8 }}>
          {error || status}
          {/* report an issue by email to  lumpsam47@gmail.com or submit a new issue at https://github.com/chainuser1/scicp/issues/new */}
          <a className="text-primary" href="https://github.com/chainuser1/scicp/issues/new" target="_blank" rel="noreferrer">
            Submit an issue
          </a>
        </p>
      </div>
    </div>
  );
}
