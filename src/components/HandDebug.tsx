// components/HandDebugTSL.tsx
import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { positionLocal, color, instanceIndex, vec3, uniform, mix } from "three/tsl";
import { 
  handStore, 
  sharedHandPosNode, 
  MAX_HANDS, 
  MAX_INSTANCES 
} from "@core/interaction/store";

// Helper to calculate 3D Euclidean distance
const getDist = (p1: any, p2: any) => {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = p1.z - p2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

// Return 1 for open, -1 for close
const getHandState = (landmarks: any[]) => {
    const wrist = landmarks[0];
    
    // Check if fingers are folded (tip is closer to wrist than PIP joint)
    const isIndexFolded = getDist(landmarks[8], wrist) < getDist(landmarks[6], wrist);
    const isMiddleFolded = getDist(landmarks[12], wrist) < getDist(landmarks[10], wrist);
    const isRingFolded = getDist(landmarks[16], wrist) < getDist(landmarks[14], wrist);
    const isPinkyFolded = getDist(landmarks[20], wrist) < getDist(landmarks[18], wrist);

    const foldedCount = [isIndexFolded, isMiddleFolded, isRingFolded, isPinkyFolded].filter(Boolean).length;

    // If 3 or more fingers are folded, consider it a fist (-1), else open (1)
    return foldedCount >= 3 ? -1 : 1;
};

export default function HandDebugTSL() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { size } = useThree();

  const screenHalfWidth = useMemo(() => uniform(size.width / 2), []);
  const screenHalfHeight = useMemo(() => uniform(size.height / 2), []);

  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial({ depthTest: false });
    
    const normalizedPos = sharedHandPosNode.element(instanceIndex);


    const blendFactor = normalizedPos.z.add(1.0).mul(0.5);
    
    const colorClosed = color(0x00ff00); // Green
    const colorOpen = color(0xff0000);   // Red
    
    // Mix the colors based on the state factor
    mat.colorNode = mix(colorClosed, colorOpen, blendFactor);
    
    // Z is used as state now, so multiply by 0 in visual space to keep it flat on screen
    const pixelPos = normalizedPos.mul(vec3(screenHalfWidth, screenHalfHeight, 0.0));
    
    mat.positionNode = positionLocal.add(pixelPos);
    
    return mat;
  }, [screenHalfWidth, screenHalfHeight]);

  useFrame((state) => {
    // Update uniforms for resize
    screenHalfWidth.value = state.size.width / 2;
    screenHalfHeight.value = state.size.height / 2;

    const hands = handStore.landmarks; 
    const posArray = sharedHandPosNode.value.array as Float32Array;

    // Handle no hands detected
    if (!hands || hands.length === 0) {
        if (meshRef.current) meshRef.current.visible = false;
        
        // Reset all states to 0 (not detected)
        for (let i = 0; i < MAX_HANDS; i++) {
            posArray[i * 3 + 2] = 0; 
        }
        sharedHandPosNode.value.needsUpdate = true;
        return;
    }

    if (meshRef.current) meshRef.current.visible = true;
    let instanceCount = 0;

    // Loop through ALL max capacity to clear unused slots
    for (let h = 0; h < MAX_HANDS; h++) {
        const bufferIndex = h * 3;

        // If this slot has an active hand
        if (h < hands.length) {
            const handLandmarks = hands[h];
            const center = handLandmarks[9];

            if (!center) {
                posArray[bufferIndex + 2] = 0; 
                continue;
            }

            const xRaw = handStore.mirror ? (1 - center.x) : center.x;
            const handState = getHandState(handLandmarks);
            
            posArray[bufferIndex + 0] = (xRaw - 0.5) * 2.0; 
            posArray[bufferIndex + 1] = -(center.y - 0.5) * 2.0; 
            posArray[bufferIndex + 2] = handState; // Store state in Z (1 or -1)
            
            instanceCount++;
        } else {
            // Unused slot: explicitly set state to 0
            posArray[bufferIndex + 2] = 0; 
        }
    }

    if (meshRef.current) {
        meshRef.current.count = instanceCount;
    }

    sharedHandPosNode.value.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_INSTANCES]} frustumCulled={false}>
      <sphereGeometry args={[5, 16, 16]} /> 
      <primitive object={material} attach="material" />
    </instancedMesh>
  );
}