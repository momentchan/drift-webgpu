import { HandLandmarkManager } from '@core/interaction/index.ts';

const statusEl = document.getElementById('status');
const handCountEl = document.getElementById('hand-count');
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');

const FINGER_JOINTS = [
    [0, 1, 2, 3, 4], // Thumb
    [0, 5, 6, 7, 8], // Index
    [0, 9, 10, 11, 12], // Middle
    [0, 13, 14, 15, 16], // Ring
    [0, 17, 18, 19, 20] // Pinky
];

(async () => {
    try {
        statusEl.textContent = "Loading model...";
        const options = { modelType: 'full', mirror: true };
        const manager = new HandLandmarkManager(options);

        statusEl.textContent = "Starting camera...";
        await manager.init();

        if (manager.video) {
            document.body.appendChild(manager.video);
        }
        document.body.appendChild(canvas);

        if (options.mirror !== false && manager.video) {
            manager.video.style.transform = 'scaleX(-1)';
        }
        
        const resize = () => {
            if (!manager.video) return;
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            manager.video.style.width = '100%';
            manager.video.style.height = '100%';
        };
        window.addEventListener('resize', resize);
        resize();
        
        manager.addEventListener(HandLandmarkManager.EVENTS.HAND_DETECTED, (e) => {
            const results = e.detail;
            const landmarks = results.landmarks || [];
            const worldLandmarks = results.worldLandmarks || [];
            
            handCountEl.textContent = landmarks.length;
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            if (landmarks.length > 0) {
                statusEl.textContent = "Tracking";
                
                const video = manager.video;
                const videoWidth = video.videoWidth;
                const videoHeight = video.videoHeight;
                
                if (videoWidth === 0 || videoHeight === 0) return;

                const scaleX = canvas.width / videoWidth;
                const scaleY = canvas.height / videoHeight;
                
                // Use cover sizing logic
                const scale = Math.max(scaleX, scaleY);
                const scaledWidth = videoWidth * scale;
                const scaledHeight = videoHeight * scale;
                const offsetX = (canvas.width - scaledWidth) / 2;
                const offsetY = (canvas.height - scaledHeight) / 2;

                landmarks.forEach((handLandmarks, index) => {
                    // Log world landmarks (3D)
                    if (Math.random() < 0.05 && worldLandmarks[index]) {
                        console.log('World Landmarks (3D meters):', worldLandmarks[index]);
                    }

                    const points = handLandmarks.map(p => {
                        // Flip X if mirror is enabled
                        const xRaw = options.mirror ? (1 - p.x) : p.x;
                        return {
                            x: xRaw * videoWidth * scale + offsetX,
                            y: p.y * videoHeight * scale + offsetY
                        };
                    });

                    // Draw joints and links
                    FINGER_JOINTS.forEach(indices => {
                        ctx.beginPath();
                        ctx.strokeStyle = 'cyan';
                        ctx.lineWidth = 2;
                        
                        indices.forEach((jointIndex, i) => {
                            const p = points[jointIndex];
                            
                            if (i === 0) {
                                ctx.moveTo(p.x, p.y);
                            } else {
                                ctx.lineTo(p.x, p.y);
                            }
                        });
                        ctx.stroke();
                    });

                    // Draw keypoints
                    points.forEach(p => {
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                        ctx.fillStyle = 'red';
                        ctx.fill();
                    });
                });

            } else {
                statusEl.textContent = "No hand detected";
            }
        });

        statusEl.textContent = "Running";

    } catch (e) {
        console.error(e);
        statusEl.textContent = "Error: " + e.message;
    }
})();
