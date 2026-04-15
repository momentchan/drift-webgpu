import { useEffect, useRef, useState, useCallback } from 'react';
import { handStore } from '@core/interaction/store';

const CANVAS_W = 320;
const CANVAS_H = 240;
const DOT_RADIUS = 8;

export default function HandDebugCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const [visible, setVisible] = useState(false);

  const toggle = useCallback((e: KeyboardEvent) => {
    if (e.key === 'd' || e.key === 'D') setVisible(v => !v);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, [toggle]);

  useEffect(() => {
    if (!visible) return;

    const draw = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const video = handStore.video;
      if (!canvas || !ctx) { rafRef.current = requestAnimationFrame(draw); return; }

      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      if (video && video.readyState >= 2) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const scale = Math.max(CANVAS_W / vw, CANVAS_H / vh);
        const sw = vw * scale;
        const sh = vh * scale;
        const ox = (CANVAS_W - sw) / 2;
        const oy = (CANVAS_H - sh) / 2;

        ctx.save();
        if (handStore.mirror) {
          ctx.translate(CANVAS_W, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, ox, oy, sw, sh);
        ctx.restore();

        const hands = handStore.landmarks;
        if (hands?.length) {
          for (const hand of hands) {
            const center = hand[9];
            if (!center) continue;

            const xRaw = handStore.mirror ? (1 - center.x) : center.x;
            const px = xRaw * vw * scale + ox;
            const py = center.y * vh * scale + oy;

            ctx.beginPath();
            ctx.arc(px, py, DOT_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = '#00ff88';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      } else {
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#666';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('waiting for camera...', CANVAS_W / 2, CANVAS_H / 2);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [visible]);

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        width: CANVAS_W,
        height: CANVAS_H,
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.2)',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    />
  );
}
