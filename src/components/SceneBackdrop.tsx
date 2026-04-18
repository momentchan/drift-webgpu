import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import * as THREE from "three/webgpu";
import {
  add,
  color as tslColor,
  float,
  mix,
  mul,
  mx_noise_float,
  normalize,
  positionLocal,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";

export default function SceneBackdrop() {
  const backdrop = useControls(
    "Scene.Backdrop",
    {
      radius: { value: 15, min: 5, max: 80, step: 0.5 },
      widthSegments: { value: 32, min: 8, max: 128, step: 1 },
      heightSegments: { value: 32, min: 8, max: 128, step: 1 },
      color: { value: "#000000", label: "Gradient dark" },
      gradientColor: { value: "#171717", label: "Gradient light" },
      noiseScale: { value: 0.9, min: 0.2, max: 16, step: 0.1 },
      noiseSpeed: { value: 1.3, min: 0, max: 15, step: 0.01 },
    },
    { collapsed: true },
  );

  const uNoisePhase = useMemo(() => uniform(0), []);
  const noiseSpeedRef = useRef(backdrop.noiseSpeed);
  noiseSpeedRef.current = backdrop.noiseSpeed;

  useFrame((_, delta) => {
    uNoisePhase.value += delta * noiseSpeedRef.current;
  });

  const material = useMemo(() => {
    const dir = normalize(positionLocal);
    const drift = vec3(
      mul(uNoisePhase, float(0.13)),
      mul(uNoisePhase, float(-0.17)),
      mul(uNoisePhase, float(0.09)),
    );
    const p = add(mul(dir, float(backdrop.noiseScale)), drift);
    const n = mx_noise_float(p);
    const mixT = smoothstep(float(0.08), float(0.92), n);
    const baseRgb = mix(
      tslColor(backdrop.color),
      tslColor(backdrop.gradientColor),
      mixT,
    );
    const colorNode = baseRgb;

    return new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      fog: false,
      colorNode,
    });
  }, [
    backdrop.color,
    backdrop.gradientColor,
    backdrop.noiseScale,
    backdrop.noiseSpeed,
  ]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  return (
    <mesh material={material}>
      <sphereGeometry
        args={[
          backdrop.radius,
          backdrop.widthSegments,
          backdrop.heightSegments,
        ]}
      />
    </mesh>
  );
}
