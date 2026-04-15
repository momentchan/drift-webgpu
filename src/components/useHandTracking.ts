import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CameraManager } from 'camera-manager';
import type { HandLandmarkManagerOptions } from '@core/interaction/index.ts';
import { handStore } from '@core/interaction/store';

type Landmark = { x: number; y: number; z: number };
type HandLandmarks = Landmark[][];

// Lower = snappier, higher = smoother.  Tuned for 30 fps detection → 60+ fps render.
const SMOOTHING = 0.75;

/**
 * Exponentially smooth `current` toward `target`.
 * Frame-rate independent: `alpha` is pre-computed from delta time.
 */
function smoothToward(
  current: HandLandmarks,
  target: HandLandmarks,
  alpha: number,
): HandLandmarks {
  const out: HandLandmarks = [];
  for (let h = 0; h < target.length; h++) {
    const hand = target[h];
    const prev = current[h];
    if (!prev || prev.length !== hand.length) {
      // First frame for this hand — snap immediately
      out.push(hand.map((p) => ({ x: p.x, y: p.y, z: p.z })));
      continue;
    }
    const result: Landmark[] = new Array(hand.length);
    for (let i = 0; i < hand.length; i++) {
      const s = prev[i];
      const t = hand[i];
      result[i] = {
        x: s.x + (t.x - s.x) * alpha,
        y: s.y + (t.y - s.y) * alpha,
        z: s.z + (t.z - s.z) * alpha,
      };
    }
    out.push(result);
  }
  return out;
}

/**
 * Offloads MediaPipe hand detection to a Web Worker and smooths landmarks
 * every render frame for jitter-free, full-framerate hand positions.
 *
 * Frame capture uses requestVideoFrameCallback so detection is perfectly
 * aligned with the camera's native framerate — no wasted captures and
 * no polling overhead in the render loop.
 */
export function useHandTracking(
  options: HandLandmarkManagerOptions = { modelType: 'LITE', mirror: true },
) {
  const workerRef = useRef<Worker | null>(null);
  const cameraRef = useRef<CameraManager | null>(null);
  const ready = useRef(false);
  const pendingDetect = useRef(false);
  const vfcId = useRef(0);

  // Latest raw result from the worker (target to smooth toward)
  const targetLandmarks = useRef<HandLandmarks>([]);
  const targetWorld = useRef<HandLandmarks>([]);

  // Smoothed state carried across frames
  const smoothedLandmarks = useRef<HandLandmarks>([]);
  const smoothedWorld = useRef<HandLandmarks>([]);

  useEffect(() => {
    let disposed = false;

    // Fires every time the camera produces a new video frame.
    // Captures an ImageBitmap and transfers it to the worker.
    const onVideoFrame = () => {
      const video = cameraRef.current?.video;
      const worker = workerRef.current;
      if (!video || !worker || !ready.current || disposed) {
        if (video && !disposed) {
          vfcId.current = (video as any).requestVideoFrameCallback(onVideoFrame);
        }
        return;
      }

      if (!pendingDetect.current && video.readyState >= 2) {
        createImageBitmap(video).then((frame) => {
          if (!workerRef.current || disposed) { frame.close(); return; }
          pendingDetect.current = true;
          workerRef.current.postMessage(
            { type: 'detect', data: { frame, timestamp: performance.now() } },
            [frame],
          );
        });
      }

      vfcId.current = (video as any).requestVideoFrameCallback(onVideoFrame);
    };

    const setup = async () => {
      const camera = new CameraManager();
      await camera.start();
      if (disposed) { camera.dispose(); return; }

      cameraRef.current = camera;

      if (camera.video) {
        document.body.appendChild(camera.video);
        camera.video.style.display = 'none';
      }

      const worker = new Worker('/handTracking.worker.js');

      worker.onmessage = (e: MessageEvent) => {
        if (disposed) return;

        switch (e.data.type) {
          case 'ready':
            ready.current = true;
            if (camera.video) {
              vfcId.current = (camera.video as any).requestVideoFrameCallback(onVideoFrame);
            }
            break;

          case 'results': {
            const d = e.data.data;
            targetLandmarks.current = d.landmarks ?? [];
            targetWorld.current = d.worldLandmarks ?? [];
            pendingDetect.current = false;
            break;
          }

          case 'error':
            console.error('[useHandTracking] worker error:', e.data.data);
            break;
        }
      };

      worker.postMessage({
        type: 'init',
        data: { numHands: options.numHands ?? 2 },
      });

      workerRef.current = worker;
    };

    setup().catch((e) => console.error('[useHandTracking] init error:', e));

    return () => {
      disposed = true;
      const video = cameraRef.current?.video;
      if (video && vfcId.current) {
        (video as any).cancelVideoFrameCallback(vfcId.current);
      }
      workerRef.current?.postMessage({ type: 'dispose' });
      workerRef.current?.terminate();
      workerRef.current = null;
      cameraRef.current?.dispose();
      cameraRef.current = null;
      ready.current = false;
    };
  }, []);

  useFrame((_state, delta) => {
    const target = targetLandmarks.current;
    const targetW = targetWorld.current;

    if (target.length === 0) {
      handStore.landmarks = [];
      handStore.worldLandmarks = [];
      smoothedLandmarks.current = [];
      smoothedWorld.current = [];
      return;
    }

    // Frame-rate independent smoothing factor
    const alpha = 1 - Math.pow(SMOOTHING, delta * 60);

    smoothedLandmarks.current = smoothToward(smoothedLandmarks.current, target, alpha);
    smoothedWorld.current = smoothToward(smoothedWorld.current, targetW, alpha);

    handStore.landmarks = smoothedLandmarks.current;
    handStore.worldLandmarks = smoothedWorld.current;
  });
}
