import * as THREE from 'three/webgpu';
import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { 
  Fn, If, instancedArray, instanceIndex, length, positionLocal, uniform, 
  Loop, vec3, float, normalize, cross, mix, sin 
} from 'three/tsl';
import { getRandomVectorInsideSphere } from "@core/utils/tsl/math"; // Adjust path if needed
import { WebGPURenderer } from 'three/webgpu';
import { folder, useControls } from 'leva';

interface BoidsProps {
  radius: number;
  count: number;
}

export default function Boids({ radius, count }: BoidsProps) {
  // Setup Leva controls
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

      noiseFrequency: { value: 0.05, min: 0, max: 0.1 },
      noiseSpeed: { value: 0.1, min: 0, max: 0.5 },

      maxSpeed: { value: 2, min: 0, max: 20 },
      maxForce: { value: 10, min: 0, max: 20 },
    }),
  });

  const { computeNode, mesh, uniforms } = useMemo(() => {
    // Initialize data
    const posData = new Float32Array(count * 4);
    const velData = new Float32Array(count * 4);

    for (let i = 0; i < posData.length; i += 4) {
      const pos = getRandomVectorInsideSphere(radius);
      posData[i] = pos.x; posData[i + 1] = pos.y; posData[i + 2] = pos.z; posData[i + 3] = 1.0; 

      const vel = getRandomVectorInsideSphere(2); 
      velData[i] = vel.x; velData[i + 1] = vel.y; velData[i + 2] = vel.z; velData[i + 3] = 0.0;
    }

    // Create storage buffers
    const posBuffer = instancedArray(posData, 'vec4');
    const velBuffer = instancedArray(velData, 'vec4');

    // Create TSL uniforms
    const uTime = uniform(0.0);
    const uDelta = uniform(0.016);
    const uRadius = uniform(radius);

    const uSepDist = uniform(props.separationDistance);
    const uAliDist = uniform(props.alignmentDistance);
    const uCohDist = uniform(props.cohesionDistance);
    const uSepWeight = uniform(props.separationWeight);
    const uAliWeight = uniform(props.alignmentWeight);
    const uCohWeight = uniform(props.cohesionWeight);
    const uAvoidWallWeight = uniform(props.avoidWallWeight);
    
    const uNoiseWeight = uniform(props.noiseWeight);
    const uNoiseFreq = uniform(props.noiseFrequency);
    const uNoiseSpeed = uniform(props.noiseSpeed);

    const uMaxSpeed = uniform(props.maxSpeed);
    const uMaxForce = uniform(props.maxForce);

    // Limit vector magnitude
    const limit = Fn(([vec, maxVal]) => {
      const l = length(vec);
      return l.greaterThan(maxVal).and(l.greaterThan(0.0)).select(vec.mul(maxVal).div(l), vec);
    });

    // Avoid boundary
    const avoidWall = Fn(([pos]) => {
      return length(pos).greaterThan(uRadius).select(normalize(pos).negate(), vec3(0.0));
    });

    // Main compute logic
    const computeMovement = Fn(() => {
      const pos = posBuffer.element(instanceIndex);
      const vel = velBuffer.element(instanceIndex);

      const force = vec3(0.0).toVar();

      const sepPosSum = vec3(0.0).toVar();
      const sepCount = float(0.0).toVar();

      const aliVelSum = vec3(0.0).toVar();
      const aliCount = float(0.0).toVar();

      const cohPosSum = vec3(0.0).toVar();
      const cohCount = float(0.0).toVar();

      // Neighbor check
      Loop({ type: 'uint', start: 0, end: count, condition: '<' }, ({ i }) => {
        If(i.notEqual(instanceIndex), () => {
          const np = posBuffer.element(i).xyz;
          const nv = velBuffer.element(i).xyz;
          const diff = pos.xyz.sub(np);
          const dist = length(diff);

          // Separation
          If(dist.greaterThan(0.0).and(dist.lessThan(uSepDist)), () => {
            const repulse = normalize(diff).div(dist);
            sepPosSum.addAssign(repulse);
            sepCount.addAssign(1.0);
          });

          // Alignment
          If(dist.greaterThan(0.0).and(dist.lessThan(uAliDist)), () => {
            aliVelSum.addAssign(nv);
            aliCount.addAssign(1.0);
          });

          // Cohesion
          If(dist.greaterThan(0.0).and(dist.lessThan(uCohDist)), () => {
            cohPosSum.addAssign(np);
            cohCount.addAssign(1.0);
          });
        });
      });

      // Separation steer
      const sepSteer = vec3(0.0).toVar();
      If(sepCount.greaterThan(0.0), () => {
        sepSteer.assign(sepPosSum.div(sepCount));
        sepSteer.assign(normalize(sepSteer).mul(uMaxSpeed));
        sepSteer.assign(sepSteer.sub(vel.xyz));
        sepSteer.assign(limit(sepSteer, uMaxForce));
      });

      // Alignment steer
      const aliSteer = vec3(0.0).toVar();
      If(aliCount.greaterThan(0.0), () => {
        aliSteer.assign(aliVelSum.div(aliCount));
        aliSteer.assign(normalize(aliSteer).mul(uMaxSpeed));
        aliSteer.assign(aliSteer.sub(vel.xyz));
        aliSteer.assign(limit(aliSteer, uMaxForce));
      });

      // Cohesion steer
      const cohSteer = vec3(0.0).toVar();
      If(cohCount.greaterThan(0.0), () => {
        cohPosSum.assign(cohPosSum.div(cohCount));
        cohSteer.assign(cohPosSum.sub(pos.xyz));
        cohSteer.assign(normalize(cohSteer).mul(uMaxSpeed));
        cohSteer.assign(cohSteer.sub(vel.xyz));
        cohSteer.assign(limit(cohSteer, uMaxForce));
      });

      // Accumulate forces
      force.addAssign(sepSteer.mul(uSepWeight));
      force.addAssign(aliSteer.mul(uAliWeight));
      force.addAssign(cohSteer.mul(uCohWeight));
      force.addAssign(avoidWall(pos.xyz).mul(uAvoidWallWeight));
      
      // Simple noise (replace with curl noise if needed)
      const noise = sin(pos.xyz.mul(uNoiseFreq).add(uTime.mul(uNoiseSpeed)));
      force.addAssign(noise.mul(uNoiseWeight));

      // Update velocity with smoothing
      let newVel = vel.xyz.add(force.mul(uDelta)).toVar();
      newVel.assign(limit(newVel, uMaxSpeed));
      vel.xyz.assign(mix(vel.xyz, newVel, 0.5)); 

      // Update position
      pos.xyz.addAssign(vel.xyz.mul(uDelta));
    });

    const compute = computeMovement().compute(count);

    // Create material
    const material = new THREE.MeshStandardNodeMaterial({
      roughness: 0.5,
      metalness: 0.2,
    });
    
    // Calculate rotation in vertex shader based on velocity
    const instVel = velBuffer.element(instanceIndex).xyz;
    const dir = normalize(instVel.add(vec3(0.00001))); 
    const up = normalize(vec3(0.00001, 1.0, 0.00001)); 

    const xAxis = normalize(cross(up, dir));
    const yAxis = cross(dir, xAxis);
    const zAxis = dir;

    const rotatedPos = xAxis.mul(positionLocal.x)
      .add(yAxis.mul(positionLocal.y))
      .add(zAxis.mul(positionLocal.z));

    material.positionNode = rotatedPos.add(posBuffer.element(instanceIndex).xyz);

    // Create standard mesh (acts as instanced in WebGPU when count is set)
    const geometry = new THREE.BoxGeometry(0.02, 0.2, 0.2); 
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
        uNoiseWeight, uNoiseFreq, uNoiseSpeed
      }
    };
  }, [count, radius]);

  useFrame((state, delta) => {
    // Update uniforms per frame
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

    uniforms.uNoiseWeight.value = props.noiseWeight;
    uniforms.uNoiseFreq.value = props.noiseFrequency;
    uniforms.uNoiseSpeed.value = props.noiseSpeed;

    const renderer = state.gl as unknown as WebGPURenderer;
    renderer.compute(computeNode);
  });

  return <primitive object={mesh} />;
}