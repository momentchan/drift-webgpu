// Classic worker (not ES module) — importScripts() is available,
// which MediaPipe's WASM runtime requires internally.

let handLandmarker = null;
let lastTimestamp = -1;

self.onmessage = async function (e) {
  const { type, data } = e.data;

  switch (type) {
    case 'init': {
      try {
        // Dynamic import() works in classic workers (Chrome 80+).
        // Loading from CDN so the WASM resolver paths stay consistent.
        const { FilesetResolver, HandLandmarker } = await import(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.mjs'
        );

        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm',
        );

        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: data.numHands || 2,
        });

        self.postMessage({ type: 'ready' });
      } catch (err) {
        console.error('[HandTracking worker] init failed:', err);
        self.postMessage({ type: 'error', data: String(err) });
      }
      break;
    }

    case 'detect': {
      if (!handLandmarker) {
        data.frame.close();
        return;
      }

      var frame = data.frame;
      var timestamp = data.timestamp;

      // MediaPipe requires strictly increasing timestamps
      var safeTs = timestamp <= lastTimestamp ? lastTimestamp + 1 : timestamp;
      lastTimestamp = safeTs;

      try {
        var results = handLandmarker.detectForVideo(frame, safeTs);
        self.postMessage({
          type: 'results',
          data: {
            landmarks: results.landmarks,
            worldLandmarks: results.worldLandmarks,
            handedness: results.handedness,
          },
        });
      } catch (_) {
        // drop frame silently on detection error
      }

      frame.close();
      break;
    }

    case 'dispose': {
      if (handLandmarker) {
        handLandmarker.close();
        handLandmarker = null;
      }
      break;
    }
  }
};
