import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { color, instanceIndex, mix, float, sin, uniform, positionLocal } from "three/tsl";
import {
  handStore,
  sharedHandPosNode,
  MAX_HANDS,
  MAX_INSTANCES,
} from "@core/interaction/store";

const getDistance3D = (p1: any, p2: any) => {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = p1.z - p2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

// Return 1 for open, -1 for close
const getOpenCloseState = (landmarks: any[]) => {
  const wrist = landmarks[0];

  const isIndexFolded = getDistance3D(landmarks[8], wrist) < getDistance3D(landmarks[6], wrist);
  const isMiddleFolded = getDistance3D(landmarks[12], wrist) < getDistance3D(landmarks[10], wrist);
  const isRingFolded = getDistance3D(landmarks[16], wrist) < getDistance3D(landmarks[14], wrist);
  const isPinkyFolded = getDistance3D(landmarks[20], wrist) < getDistance3D(landmarks[18], wrist);

  const foldedCount = [isIndexFolded, isMiddleFolded, isRingFolded, isPinkyFolded].filter(Boolean).length;

  return foldedCount >= 3 ? -1 : 1;
};

const MARKER_DEPTH = 1.0;
const MARKER_RADIUS = 0.008;

const instanceDummy = new THREE.Object3D();
const markerDirection = new THREE.Vector3();

export default function HandMarker() {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const { material, uTime } = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
    });

    const uTimeNode = uniform(0.0);

    const handPosNode = sharedHandPosNode.element(instanceIndex);
    const openCloseBlend = handPosNode.z.add(1.0).mul(0.5);

    const colorClosed = color("#ff4d26");
    const colorOpen = color("#66b3ff");

    // Breathing intensity via sin wave
    const breath = sin(uTimeNode).mul(float(0.5)).add(float(0.5));

    mat.colorNode = mix(colorClosed, colorOpen, openCloseBlend).mul(mix(5, 10, breath));
    mat.positionNode = positionLocal.mul(mix(0.5, 1.0, breath));

    return { material: mat, uTime: uTimeNode };
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;

    uTime.value = state.clock.elapsedTime;

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
        const handState = getOpenCloseState(handLandmarks);

        const ndcX = (xRaw - 0.5) * 2.0;
        const ndcY = -(center.y - 0.5) * 2.0;

        posArray[bufferIndex + 0] = ndcX;
        posArray[bufferIndex + 1] = ndcY;
        posArray[bufferIndex + 2] = handState;

        markerDirection.set(ndcX, ndcY, 0.5).unproject(cam).sub(cam.position).normalize();
        instanceDummy.position.copy(cam.position).addScaledVector(markerDirection, MARKER_DEPTH);
        instanceDummy.updateMatrix();
        meshRef.current.setMatrixAt(instanceCount, instanceDummy.matrix);

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
