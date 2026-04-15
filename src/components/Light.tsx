import { Environment, useHelper } from "@react-three/drei";
import { forwardRef, useImperativeHandle, useRef } from "react";
import * as THREE from "three";

interface LightProps {
  radius: number;
  lightPos: [number, number, number];
}

export interface LightRef {
  getDirectionalLight: () => THREE.DirectionalLight | null;
}

const Light = forwardRef<LightRef, LightProps>(function Light(props, ref) {
  const directionalLight = useRef<THREE.DirectionalLight>(null!);
  const shadowCamera = useRef<THREE.OrthographicCamera>(null!);
  // useHelper(directionalLight, THREE.DirectionalLightHelper, 1, "hotpink");
  // useHelper(shadowCamera, THREE.CameraHelper);

  const shadowExtent = props.radius * 1.2;

  useImperativeHandle(ref, () => ({
    getDirectionalLight() {
      return directionalLight.current;
    }
  }));

  return (
    <>
      <ambientLight intensity={0.05} />

      <directionalLight
        ref={directionalLight}
        intensity={6}
        position={props.lightPos}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.001}
      >
        <orthographicCamera
          ref={shadowCamera}
          attach="shadow-camera"
          frustumCulled={false}
          args={[-shadowExtent, shadowExtent, shadowExtent, -shadowExtent, 0.1, 200]}
        />
      </directionalLight>

      <Environment preset="city" environmentIntensity={0.5} />
    </>
  );
});

export default Light;
