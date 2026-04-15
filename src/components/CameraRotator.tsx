'use client';

import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three';
export default function CameraRotator() {
  const { camera } = useThree();

  const rotationAngleRef = useRef(0);
  const smoothedPositionRef = useRef(new THREE.Vector3(0, 0, 0));

  const controls = useControls('Camera Rotator', {
    minRadius: { value: 3, min: 0, max: 20, step: 0.5 },
    maxRadius: { value: 14, min: 0, max: 20, step: 0.5 },
    speed: { value: 0.2, min: -5, max: 5, step: 0.1 },
    height: { value: 0, min: -2, max: 2, step: 0.01 },
    enabled: true,
  }, { collapsed: true });

  const rotateLerpRef = useRef({ value: 0 });

  useEffect(() => {
    const currentX = camera.position.x;
    const currentZ = camera.position.z;
    const currentAngle = Math.atan2(currentZ, currentX);

    rotationAngleRef.current = currentAngle;
    smoothedPositionRef.current.copy(camera.position);
  }, [camera]);

  useEffect(() => {
    rotateLerpRef.current.value = 1;
  }, []);

  useFrame((_, delta) => {
    if (!controls.enabled) return;

    const speed = controls.speed * rotateLerpRef.current.value;
    rotationAngleRef.current += Math.min(delta, 1 / 30) * speed;

    const normalizedMinRadius = Math.min(controls.minRadius, controls.maxRadius);
    const normalizedMaxRadius = Math.max(controls.minRadius, controls.maxRadius);
    const radiusBlend = (Math.sin(rotationAngleRef.current) + 1) * 0.5;
    const effectiveRadius = THREE.MathUtils.lerp(normalizedMinRadius, normalizedMaxRadius, radiusBlend);
    const x = effectiveRadius * Math.cos(rotationAngleRef.current);
    const y = effectiveRadius * Math.sin(rotationAngleRef.current * 0.5) + controls.height;
    const z = effectiveRadius * Math.sin(rotationAngleRef.current);

    // Smooth transition when switching from gyro to auto mode
    const targetPosition = new THREE.Vector3(x, y, z);
    smoothedPositionRef.current.lerp(targetPosition, 0.15);
    camera.position.copy(smoothedPositionRef.current);

    camera.lookAt(0, 0, 0);
  });

  return null;
}
