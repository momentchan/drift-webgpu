import * as THREE from 'three/webgpu';
import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Fn, If, instancedArray, instanceIndex, length, positionLocal, uniform,
  Loop, vec3, vec4, vec2, float, normalize, cross, mix, mx_noise_float, clamp, dot, smoothstep
} from 'three/tsl';
import { getRandomVectorInsideSphere } from "@core/utils/tsl/math";
import { WebGPURenderer } from 'three/webgpu';
import { folder, useControls } from 'leva';
import { curlNoise3D } from '@core/utils/tsl/noise';
import { MAX_INSTANCES, sharedHandPosNode } from '@core/interaction/store';
import { useGLTF } from '@react-three/drei';

interface BoidsProps {
  radius: number;
  count: number;
}

export default function Boids({ radius, count }: BoidsProps) {

  const pyramid = useGLTF('/models/pyramid.glb');



  const props = useControls({
    'Boids': folder({
      separationDistance: { value: 1, min: 0, max: 5 },
      alignmentDistance: { value: 1, min: 0, max: 5 },
      cohesionDistance: { value: 2, min: 0, max: 5 },

      separationWeight: { value: 1, min: 0, max: 10 },
      alignmentWeight: { value: 2, min: 0, max: 10 },
      cohesionWeight: { value: 0.5, min: 0, max: 10 },
      avoidWallWeight: { value: 5, min: 0, max: 10 },
      noiseWeight: { value: 1.2, min: 0, max: 5 },

      touchWeight: { value: 200, min: 0, max: 200 },
      touchRange: { value: 0.5, min: 0, max: 5 },

      centerWeight: { value: 5, min: 0, max: 10 },

      noiseFrequency: { value: 0.05, min: 0, max: 0.2 },
      noiseSpeed: { value: 0.1, min: 0, max: 0.5 },

      maxSpeed: { value: 2.5, min: 0, max: 20 },
      maxForce: { value: 10, min: 0, max: 20 },

      openColor: { value: '#66b3ff' },
      closeColor: { value: '#ff4d26' },
      baseColor: { value: '#ffffff' },
    }),
  });

  const { computeNode, mesh, uniforms } = useMemo(() => {
    // Initialize buffers
    const posData = new Float32Array(count * 4);
    const velData = new Float32Array(count * 4);

    for (let i = 0; i < posData.length; i += 4) {
      const pos = getRandomVectorInsideSphere(radius);
      posData[i] = pos.x; posData[i + 1] = pos.y; posData[i + 2] = pos.z;
      posData[i + 3] = 0.0; // hand state: -1 close, 0 neutral, +1 open

      const vel = getRandomVectorInsideSphere(2);
      velData[i] = vel.x; velData[i + 1] = vel.y; velData[i + 2] = vel.z;
      velData[i + 3] = 0.0; // interaction intensity (0..1)
    }

    const posBuffer = instancedArray(posData, 'vec4');
    const velBuffer = instancedArray(velData, 'vec4');

    // Create uniforms
    const uTime = uniform(0.0);
    const uDelta = uniform(0.016);
    const uRadius = uniform(radius);

    const uMVP = uniform(new THREE.Matrix4());
    const uInvMVP = uniform(new THREE.Matrix4());
    const uAspect = uniform(1.0);

    const uSepDist = uniform(props.separationDistance);
    const uAliDist = uniform(props.alignmentDistance);
    const uCohDist = uniform(props.cohesionDistance);
    const uSepWeight = uniform(props.separationWeight);
    const uAliWeight = uniform(props.alignmentWeight);
    const uCohWeight = uniform(props.cohesionWeight);
    const uAvoidWallWeight = uniform(props.avoidWallWeight);

    const uTouchRange = uniform(props.touchRange);
    const uTouchWeight = uniform(props.touchWeight);

    const uCenterWeight = uniform(props.centerWeight);

    const uNoiseWeight = uniform(props.noiseWeight);
    const uNoiseFreq = uniform(props.noiseFrequency);
    const uNoiseSpeed = uniform(props.noiseSpeed);

    const uMaxSpeed = uniform(props.maxSpeed);
    const uMaxForce = uniform(props.maxForce);
    const uOpenColor = uniform(new THREE.Color(props.openColor));
    const uCloseColor = uniform(new THREE.Color(props.closeColor));
    const uBaseColor = uniform(new THREE.Color(props.baseColor));

    // Limit function
    const limit = Fn((inputs: any) => {
      const vec = inputs[0];
      const maxVal = inputs[1];
      const l = length(vec);
      return l.greaterThan(maxVal).and(l.greaterThan(0.0)).select(vec.mul(maxVal).div(l), vec);
    }) as any;

    // Avoid wall boundary
    const avoidWall = Fn((inputs: any) => {
      const pos = inputs[0];
      return length(pos).greaterThan(uRadius).select(normalize(pos).negate(), vec3(0.0));
    }) as any;

    const computeMovement = Fn(() => {
      const pos = posBuffer.element(instanceIndex);
      const velDataEl = velBuffer.element(instanceIndex);
      const vel = velDataEl.xyz;

      const force = vec3(0.0).toVar();

      const sepPosSum = vec3(0.0).toVar();
      const sepCount = float(0.0).toVar();

      const aliVelSum = vec3(0.0).toVar();
      const aliCount = float(0.0).toVar();

      const cohPosSum = vec3(0.0).toVar();
      const cohCount = float(0.0).toVar();

      // Flocking rules
      Loop({ type: 'uint', start: 0, end: count, condition: '<' }, ({ i }) => {
        If(i.notEqual(instanceIndex), () => {
          const np = posBuffer.element(i).xyz;
          const nv = velBuffer.element(i).xyz;
          const diff = pos.xyz.sub(np);
          const dist = length(diff);

          If(dist.greaterThan(0.0).and(dist.lessThan(uSepDist)), () => {
            const repulse = normalize(diff).div(dist);
            sepPosSum.addAssign(repulse);
            sepCount.addAssign(1.0);
          });

          If(dist.greaterThan(0.0).and(dist.lessThan(uAliDist)), () => {
            aliVelSum.addAssign(nv);
            aliCount.addAssign(1.0);
          });

          If(dist.greaterThan(0.0).and(dist.lessThan(uCohDist)), () => {
            cohPosSum.addAssign(np);
            cohCount.addAssign(1.0);
          });
        });
      });

      // Apply steering forces
      const sepSteer = vec3(0.0).toVar();
      If(sepCount.greaterThan(0.0), () => {
        sepSteer.assign(sepPosSum.div(sepCount));
        sepSteer.assign(normalize(sepSteer).mul(uMaxSpeed));
        sepSteer.assign(sepSteer.sub(vel));
        sepSteer.assign(limit(sepSteer, uMaxForce));
      });

      const aliSteer = vec3(0.0).toVar();
      If(aliCount.greaterThan(0.0), () => {
        aliSteer.assign(aliVelSum.div(aliCount));
        aliSteer.assign(normalize(aliSteer).mul(uMaxSpeed));
        aliSteer.assign(aliSteer.sub(vel));
        aliSteer.assign(limit(aliSteer, uMaxForce));
      });

      const cohSteer = vec3(0.0).toVar();
      If(cohCount.greaterThan(0.0), () => {
        cohPosSum.assign(cohPosSum.div(cohCount));
        cohSteer.assign(cohPosSum.sub(pos.xyz));
        cohSteer.assign(normalize(cohSteer).mul(uMaxSpeed));
        cohSteer.assign(cohSteer.sub(vel));
        cohSteer.assign(limit(cohSteer, uMaxForce));
      });

      force.addAssign(sepSteer.mul(uSepWeight));
      force.addAssign(aliSteer.mul(uAliWeight));
      force.addAssign(cohSteer.mul(uCohWeight));
      force.addAssign(avoidWall(pos.xyz).mul(uAvoidWallWeight));

      // Center avoid logic
      const orthBase = normalize(cross(pos.xyz, vec3(0.0, 1.0, 0.0)));
      const orth = orthBase.mul(dot(vel, orthBase).mul(0.2));
      const forward = normalize(pos.xyz);
      const centerSteer = smoothstep(1.0, 0.0, length(pos.xyz)).mul(forward.add(orth));

      // Touch interaction logic (repel from hands in NDC space)
      const pp_clip = uMVP.mul(vec4(pos.xyz, 1.0));
      const pp_ndc = pp_clip.xy.div(pp_clip.w);
      const touchSteer = vec3(0.0).toVar();

      const interactiveVal = velDataEl.w.toVar();
      const handState = pos.w.toVar();

      Loop({ type: 'uint', start: 0, end: MAX_INSTANCES, condition: '<' }, ({ i }) => {
        const touchPos = sharedHandPosNode.element(i)

        // Only process if touchPos is active
        If(touchPos.z.notEqual(0), () => {
          const dirNdc = pp_ndc.sub(touchPos.xy).mul(vec2(uAspect, 1.0));
          const dist = length(dirNdc);
          const decay = smoothstep(uTouchRange, 0.0, dist);
          const steerWorld = uInvMVP.mul(vec4(dirNdc, 0.0, 0.0)).xyz;
          touchSteer.addAssign(steerWorld.mul(decay).mul(touchPos.z));

          interactiveVal.addAssign(decay.mul(uDelta).mul(5.0));
          handState.addAssign(touchPos.z.mul(decay).mul(uDelta).mul(10.0));
        });
      });

      // Combine center avoid and touch steer
      force.addAssign(touchSteer.mul(uTouchWeight));
      force.addAssign(centerSteer.mul(uCenterWeight));

      // Curl noise field
      const baseNoiseField = Fn((inputs: any) => {
        const p = inputs[0];
        return vec3(
          mx_noise_float(p),
          mx_noise_float(p.add(vec3(19.1, 33.4, 47.2))),
          mx_noise_float(p.add(vec3(74.2, -124.5, 99.4)))
        );
      }) as any;

      const noiseInput = pos.xyz.mul(uNoiseFreq).add(uTime.mul(uNoiseSpeed));
      const noiseSteer = (curlNoise3D as any)(noiseInput, baseNoiseField);
      force.addAssign(noiseSteer.mul(uNoiseWeight));

      // Update velocity and apply smoothing
      let newVel = vel.add(force.mul(uDelta)).toVar();
      // newVel.assign(limit(newVel, uMaxSpeed));
      vel.assign(mix(vel, newVel, 0.5));

      pos.xyz.addAssign(vel.mul(uDelta));

      interactiveVal.subAssign(uDelta.mul(1.0));
      interactiveVal.assign(clamp(interactiveVal, 0.0, 1.0));
      velDataEl.w.assign(interactiveVal);

      handState.assign(mix(handState, float(0.0), uDelta.mul(2.0)));
      handState.assign(clamp(handState, -1.0, 1.0));
      pos.w.assign(handState);
    });

    const compute = computeMovement().compute(count);

    const material = new THREE.MeshStandardNodeMaterial({
      roughness: 0.5,
      metalness: 0.2,
    });

    // --- Vertex Node: Scale & Rotation ---
    const wpos = posBuffer.element(instanceIndex).xyz;
    const velDataEl = velBuffer.element(instanceIndex);
    const vel = velDataEl.xyz;

    // Scale based on world position and noise
    const n = mx_noise_float(wpos.yz.mul(0.2)).add(1.0).mul(0.5);
    const interactiveVal = velDataEl.w;  // 0..1 intensity
    const handState = posBuffer.element(instanceIndex).w; // -1..1 open/close

    const scale = vec3(1.0, 1.0, mix(5, 0.5, n))
      .mul(mix(1.0, 10.0, n))
      .mul(mix(1.0, 2.0, interactiveVal));

    // const s = mix(5, 0.5, n)

    // const scale = vec3(s, s, 1.0)
    //   .mul(mix(1.0, 10.0, n))
    //   .mul(mix(1.0, 3.0, debug)).mul(10);

    const scaledPos = positionLocal.mul(scale);

    // Rotation based on velocity
    const dir = normalize(vel.add(vec3(0.00001)));
    const up = normalize(vec3(0.00001, 1.0, 0.00001));

    const xAxis = normalize(cross(up, dir));
    const yAxis = cross(dir, xAxis);
    const zAxis = dir;

    const rotatedPos = xAxis.mul(scaledPos.x)
      .add(yAxis.mul(scaledPos.y))
      .add(zAxis.mul(scaledPos.z));

    material.positionNode = rotatedPos.add(wpos);

    const handStateNorm = handState.mul(0.5).add(0.5); // [-1,1] -> [0,1]
    const handColor = mix(uCloseColor, uOpenColor, handStateNorm);
    const baseColor = vec3(uBaseColor.r, uBaseColor.g, uBaseColor.b);
    material.colorNode = baseColor;
    material.emissiveNode = handColor.mul(interactiveVal).mul(2);

    const geometry = new THREE.BoxGeometry(0.002, 0.02, 0.02); 
    // const sourceMesh = pyramid.scene.children.find(
    //   (child): child is THREE.Mesh => child instanceof THREE.Mesh
    // );

    // if (!sourceMesh) {
    //   throw new Error('Pyramid model does not contain a mesh.');
    // }

    // const geometry = sourceMesh.geometry.clone();

    const standardMesh = new THREE.Mesh(geometry, material);
    standardMesh.count = count;
    standardMesh.castShadow = true;
    standardMesh.receiveShadow = true;
    standardMesh.frustumCulled = false;

    return {
      computeNode: compute,
      mesh: standardMesh,
      uniforms: {
        uTime, uDelta, uMaxSpeed, uMaxForce, uSepDist, uAliDist, uCohDist,
        uSepWeight, uAliWeight, uCohWeight, uAvoidWallWeight,
        uNoiseWeight, uNoiseFreq, uNoiseSpeed, uMVP, uInvMVP, uAspect, uTouchRange, uTouchWeight, uCenterWeight,
        uOpenColor, uCloseColor, uBaseColor
      }
    };
  }, [count, radius, pyramid]);

  useFrame((state, delta) => {
    // Update MVP matrices for touch interaction
    const proj = state.camera.projectionMatrix;
    const view = state.camera.matrixWorldInverse;
    const mvp = new THREE.Matrix4().multiplyMatrices(proj, view);

    uniforms.uMVP.value.copy(mvp);
    uniforms.uInvMVP.value.copy(mvp).invert();
    uniforms.uAspect.value = state.size.width / state.size.height;

    // Update uniform values
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uDelta.value = Math.min(delta, 1 / 30);

    uniforms.uMaxSpeed.value = props.maxSpeed;
    uniforms.uMaxForce.value = props.maxForce;

    uniforms.uSepDist.value = props.separationDistance;
    uniforms.uAliDist.value = props.alignmentDistance;
    uniforms.uCohDist.value = props.cohesionDistance;

    uniforms.uSepWeight.value = props.separationWeight;
    uniforms.uAliWeight.value = props.alignmentWeight;
    uniforms.uCohWeight.value = props.cohesionWeight;
    uniforms.uAvoidWallWeight.value = props.avoidWallWeight;

    uniforms.uTouchRange.value = props.touchRange;
    uniforms.uTouchWeight.value = props.touchWeight;
    uniforms.uCenterWeight.value = props.centerWeight;

    uniforms.uNoiseWeight.value = props.noiseWeight;
    uniforms.uNoiseFreq.value = props.noiseFrequency;
    uniforms.uNoiseSpeed.value = props.noiseSpeed;
    uniforms.uOpenColor.value.set(props.openColor);
    uniforms.uCloseColor.value.set(props.closeColor);
    uniforms.uBaseColor.value.set(props.baseColor);

    const renderer = state.gl as unknown as WebGPURenderer;
    renderer.compute(computeNode);
  });

  return <primitive object={mesh} />;
}