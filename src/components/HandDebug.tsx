import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { positionLocal, attribute, color } from "three/tsl";
import { handStore } from "@core/interaction/store";

// Define a safe maximum number of hands to track simultaneously
const MAX_HANDS = 10;
const POINTS_PER_HAND = 21;
const MAX_INSTANCES = MAX_HANDS * POINTS_PER_HAND;

export default function HandDebugTSL() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  
  // 1. Allocate buffer for maximum possible instances
  const posArray = useMemo(() => new Float32Array(MAX_INSTANCES * 3), []);
  const posAttr = useMemo(() => {
    const attr = new THREE.InstancedBufferAttribute(posArray, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    return attr;
  }, [posArray]);

  // 2. Create the Node Material
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial({ depthTest: false });
    mat.colorNode = color(0xff0000);
    
    const instancePos = attribute('instancePos', 'vec3');
    mat.positionNode = positionLocal.add(instancePos);
    
    return mat;
  }, []);

  useFrame((state) => {
    // Expected to be an array of arrays: HandLandmark[][]
    const hands = handStore.landmarks; 
    const { size } = state; 

    if (!hands || hands.length === 0) {
        if (meshRef.current) meshRef.current.visible = false;
        return;
    }

    if (meshRef.current) meshRef.current.visible = true;

    // Track how many points we actually process
    let instanceCount = 0;

    // Loop through each detected hand
    for (let h = 0; h < hands.length; h++) {
        // Prevent buffer overflow if tracker finds more hands than MAX_HANDS
        if (h >= MAX_HANDS) break; 
        
        const handLandmarks = hands[h];

        // Loop through the 21 points of the current hand
        for (let i = 0; i < handLandmarks.length; i++) {
            const p = handLandmarks[i];
            
            const xRaw = 1 - p.x;

            // Calculate the flat array index
            const bufferIndex = (h * POINTS_PER_HAND + i) * 3;

            posArray[bufferIndex + 0] = (xRaw - 0.5) * size.width;
            posArray[bufferIndex + 1] = -(p.y - 0.5) * size.height;
            posArray[bufferIndex + 2] = 0; 
            
            instanceCount++;
        }
    }

    // 3. Dynamically update the count to only render active joints
    if (meshRef.current) {
        meshRef.current.count = instanceCount;
    }

    posAttr.needsUpdate = true;
  });

  return (
    // Initialize with MAX_INSTANCES
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_INSTANCES]} frustumCulled={false}>
      <sphereGeometry args={[5, 16, 16]}>
        <primitive object={posAttr} attach="attributes-instancePos" />
      </sphereGeometry>
      <primitive object={material} attach="material" />
    </instancedMesh>
  );
}