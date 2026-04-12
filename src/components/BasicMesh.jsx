import { useMemo, useRef, useLayoutEffect } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { uv, vec4, uniform } from "three/tsl";
import { NodeMaterial } from "three/webgpu";
import { extend } from "@react-three/fiber";

extend({ NodeMaterial });

export default function BasicMesh() {
  const materialRef = useRef(null);

  const { alpha } = useControls("Material", {
    alpha: { value: 1, min: 0, max: 1, step: 0.01 },
  });

  const uAlpha = useMemo(() => uniform(alpha), []);

  useLayoutEffect(() => {
    uAlpha.value = alpha;
  }, [alpha, uAlpha]);

  const materialProps = useMemo(() => {
    return {
      colorNode: vec4(uv(), 0, uAlpha),
      transparent: true,
      side: THREE.DoubleSide
    };
  }, [uAlpha]); 

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <nodeMaterial ref={materialRef} {...materialProps} />
    </mesh>
  );
}
