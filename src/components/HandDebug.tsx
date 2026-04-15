import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { color, instanceIndex, mix } from "three/tsl";
import { 
  handStore, 
  sharedHandPosNode, 
  MAX_HANDS, 
  MAX_INSTANCES 
} from "@core/interaction/store";

const getDist = (p1: any, p2: any) => {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = p1.z - p2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

// Return 1 for open, -1 for close
const getHandState = (landmarks: any[]) => {
    const wrist = landmarks[0];
    
    const isIndexFolded = getDist(landmarks[8], wrist) < getDist(landmarks[6], wrist);
    const isMiddleFolded = getDist(landmarks[12], wrist) < getDist(landmarks[10], wrist);
    const isRingFolded = getDist(landmarks[16], wrist) < getDist(landmarks[14], wrist);
    const isPinkyFolded = getDist(landmarks[20], wrist) < getDist(landmarks[18], wrist);

    const foldedCount = [isIndexFolded, isMiddleFolded, isRingFolded, isPinkyFolded].filter(Boolean).length;

    return foldedCount >= 3 ? -1 : 1;
};

// Fixed depth from camera so markers stay a consistent screen size
const MARKER_DEPTH = 1.0;
const MARKER_RADIUS = 0.008;

const _dummy = new THREE.Object3D();
const _dir = new THREE.Vector3();

export default function HandDebugTSL() {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
    });
    
    const normalizedPos = sharedHandPosNode.element(instanceIndex);
    const blendFactor = normalizedPos.z.add(1.0).mul(0.5);
    
    const colorClosed = color(0x00ff00);
    const colorOpen = color(0xff0000);
    mat.colorNode = mix(colorClosed, colorOpen, blendFactor);
    
    return mat;
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;

    const cam = state.camera;
    const hands = handStore.landmarks; 
    const posArray = sharedHandPosNode.value.array as Float32Array;

    if (!hands || hands.length === 0) {
        meshRef.current.visible = false;
        for (let i = 0; i < MAX_HANDS; i++) {
            posArray[i * 3 + 2] = 0; 
        }
        sharedHandPosNode.value.needsUpdate = true;
        return;
    }

    meshRef.current.visible = true;
    let instanceCount = 0;

    for (let h = 0; h < MAX_HANDS; h++) {
        const bufferIndex = h * 3;

        if (h < hands.length) {
            const handLandmarks = hands[h];
            const center = handLandmarks[9];

            if (!center) {
                posArray[bufferIndex + 2] = 0; 
                continue;
            }

            const xRaw = handStore.mirror ? (1 - center.x) : center.x;
            const handState = getHandState(handLandmarks);

            const ndcX = (xRaw - 0.5) * 2.0;
            const ndcY = -(center.y - 0.5) * 2.0;
            
            posArray[bufferIndex + 0] = ndcX; 
            posArray[bufferIndex + 1] = ndcY; 
            posArray[bufferIndex + 2] = handState;

            // Unproject NDC → world-space, then place at a fixed depth from camera
            _dir.set(ndcX, ndcY, 0.5).unproject(cam).sub(cam.position).normalize();
            _dummy.position.copy(cam.position).addScaledVector(_dir, MARKER_DEPTH);
            _dummy.updateMatrix();
            meshRef.current.setMatrixAt(instanceCount, _dummy.matrix);

            instanceCount++;
        } else {
            posArray[bufferIndex + 2] = 0; 
        }
    }

    meshRef.current.count = instanceCount;
    meshRef.current.instanceMatrix.needsUpdate = true;
    sharedHandPosNode.value.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, MAX_INSTANCES]}
      frustumCulled={false}
      renderOrder={999}
    >
      <sphereGeometry args={[MARKER_RADIUS, 16, 16]} /> 
      <primitive object={material} attach="material" />
    </instancedMesh>
  );
}
