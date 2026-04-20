import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { handStore } from '@core/interaction/store';

type Landmark = { x: number; y: number; z: number };
type HandLandmarks = Landmark[][];

// Lower = snappier, higher = smoother.
const SMOOTHING = 0.5;

const ALIVE_DURATION_MS = 150;

function smoothTowardInPlace(
  current: HandLandmarks,
  target: HandLandmarks,
  alpha: number,
) {
  if (current.length !== target.length) {
    current.length = 0;
    for (let h = 0; h < target.length; h++) {
      const src = target[h];
      const copy: Landmark[] = new Array(src.length);
      for (let i = 0; i < src.length; i++) {
        const p = src[i];
        copy[i] = { x: p.x, y: p.y, z: p.z };
      }
      current.push(copy);
    }
    return;
  }

  for (let h = 0; h < target.length; h++) {
    const tHand = target[h];
    const cHand = current[h];
    // Hand landmark count is fixed at 21 by MediaPipe, but guard anyway
    if (cHand.length !== tHand.length) {
      cHand.length = 0;
      for (let i = 0; i < tHand.length; i++) {
        const p = tHand[i];
        cHand.push({ x: p.x, y: p.y, z: p.z });
      }
      continue;
    }
    for (let i = 0; i < tHand.length; i++) {
      const c = cHand[i];
      const t = tHand[i];
      c.x += (t.x - c.x) * alpha;
      c.y += (t.y - c.y) * alpha;
      c.z += (t.z - c.z) * alpha;
    }
  }
}

export interface WebSocketTrackingOptions {
  url?: string;
}

/**
 * Receives hand tracking data via WebSocket from a local Python backend.
 * Bypasses browser camera and heavy ML calculations entirely.
 */
export function useHandTracking(options: WebSocketTrackingOptions = {}) {
  // Default to localhost, port 8765 as set in the Python server
  const { url = 'ws://127.0.0.1:8765' } = options;

  // Latest raw result from the WebSocket (target to smooth toward)
  const targetLandmarks = useRef<HandLandmarks>([]);
  const targetWorld = useRef<HandLandmarks>([]);

  // Smoothed state carried across frames
  const smoothedLandmarks = useRef<HandLandmarks>([]);
  const smoothedWorld = useRef<HandLandmarks>([]);

  const hasConnectedOnce = useRef(false);
  const lastUpdateTime = useRef(0);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (disposed) return;

      ws = new WebSocket(url);

      ws.onopen = () => {
        hasConnectedOnce.current = true;
        console.log(`[HandTracking] WebSocket connected to ${url}`);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Fallback to empty array if data fields are missing
          targetLandmarks.current = data.landmarks ?? [];
          targetWorld.current = data.worldLandmarks ?? [];

          // Only stamp when we actually have hands — empty packets shouldn't
          // keep the "alive" timer refreshed.
          if (targetLandmarks.current.length > 0) {
            lastUpdateTime.current = performance.now();
          }

        } catch (err) {
          console.error('[HandTracking] Error parsing WebSocket message:', err);
        }
      };

      ws.onerror = (err) => {
        // Stay silent during startup (backend not up yet). Only surface
        // the error if we were previously connected and got dropped.
        if (hasConnectedOnce.current) {
          // console.error('[HandTracking] WebSocket error:', err);
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          if (hasConnectedOnce.current) {
            console.warn('[HandTracking] Connection lost. Retrying in 2 seconds...');
          } else {
            console.log('[HandTracking] Waiting for tracking backend to initialize...');
          }
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    };

    // Initial connection
    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
      
      // Reset store on unmount
      handStore.landmarks = [];
      handStore.worldLandmarks = [];
    };
  }, [url]);

  useFrame((_state, delta) => {
    const target = targetLandmarks.current;
    const targetW = targetWorld.current;
    const timedOut =
      performance.now() - lastUpdateTime.current > ALIVE_DURATION_MS;

    if (target.length === 0 || timedOut) {
      if (smoothedLandmarks.current.length !== 0) {
        smoothedLandmarks.current.length = 0;
        smoothedWorld.current.length = 0;
        handStore.landmarks = smoothedLandmarks.current;
        handStore.worldLandmarks = smoothedWorld.current;
      }
      return;
    }

    // Frame-rate independent smoothing factor
    const alpha = 1 - Math.pow(SMOOTHING, delta * 60);

    smoothTowardInPlace(smoothedLandmarks.current, target, alpha);
    smoothTowardInPlace(smoothedWorld.current, targetW, alpha);

    // Store holds a stable reference; consumers should read values fresh each frame
    handStore.landmarks = smoothedLandmarks.current;
    handStore.worldLandmarks = smoothedWorld.current;
  });
}