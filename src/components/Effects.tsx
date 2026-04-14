import { useRef, useEffect, useMemo } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { WebGPURenderer } from "three/webgpu";
import { uniform, pass, mix } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { useEffectsControls } from "./useEffectsControls";

export default function Effects() {
  const { bloom: bloomCfg, dof: dofCfg, toneMapping: tmCfg, smaa: smaaEnabled } = useEffectsControls();
  const { gl, scene, camera } = useThree();
  const postProcessingRef = useRef<THREE.PostProcessing | null>(null);

  // Use uniforms for toggles to avoid rebuilding the pipeline
  const uParams = useRef({
    focusDist: uniform(0),
    focalLen: uniform(0),
    bokeh: uniform(0),
    bloomThresh: uniform(0),
    bloomStr: uniform(0),
    bloomRad: uniform(0),
    // Toggle uniforms (1 = on, 0 = off)
    dofEnabled: uniform(1),
    bloomEnabled: uniform(1),
  });

  useEffect(() => {
    // Update uniforms based on Leva controls
    uParams.current.bloomThresh.value = bloomCfg.threshold;
    uParams.current.bloomStr.value = bloomCfg.strength;
    uParams.current.bloomRad.value = bloomCfg.radius;
    uParams.current.bloomEnabled.value = bloomCfg.enabled ? 1 : 0;

    if (!dofCfg.autofocus) {
      uParams.current.focusDist.value = dofCfg.focusDistance;
    }
    uParams.current.focalLen.value = dofCfg.focalLength;
    uParams.current.bokeh.value = dofCfg.bokehScale;
    uParams.current.dofEnabled.value = dofCfg.enabled ? 1 : 0;

    // if (gl instanceof WebGPURenderer) {
    //   gl.toneMappingExposure = Math.pow(tmCfg.exposure, 4.0);
    //   gl.toneMapping = tmCfg.enabled ? THREE.ReinhardToneMapping : THREE.NoToneMapping;
    // }
  }, [bloomCfg, dofCfg, tmCfg, gl]);

  // Build the node graph ONLY ONCE
  useEffect(() => {
    if (!gl || !(gl instanceof WebGPURenderer)) {
      console.error("WebGPURenderer is required for TSL Effects.");
      return;
    }

    const pp = new THREE.PostProcessing(gl);
    postProcessingRef.current = pp;

    const scenePass = pass(scene, camera);
    const sceneDepth = scenePass.getViewZNode();

    // 1. Base Node
    let finalNode: any = scenePass;

    // 2. Depth of Field (Mix with original based on toggle)
    const dofNode = dof(
      finalNode,
      sceneDepth,
      uParams.current.focusDist,
      uParams.current.focalLen,
      uParams.current.bokeh
    );
    finalNode = mix(finalNode, dofNode as any, uParams.current.dofEnabled);

    // 3. Bloom (Mix with original based on toggle)
    const bloomNode = bloom(finalNode);
    bloomNode.threshold = uParams.current.bloomThresh;
    bloomNode.strength = uParams.current.bloomStr;
    bloomNode.radius = uParams.current.bloomRad;
    // Add bloom to the final node, but multiply by enabled flag
    finalNode = finalNode.add(bloomNode.mul(uParams.current.bloomEnabled));

    // 4. SMAA (SMAA doesn't have a simple uniform toggle in TSL yet, 
    // but building it once is still better. If toggle is strictly needed, 
    // consider re-assigning pp.outputNode and calling pp.needsUpdate)
    if (smaaEnabled) {
       finalNode = smaa(finalNode);
    }

    pp.outputNode = finalNode;

    return () => {
      postProcessingRef.current = null;
    };
  }, [gl, scene, camera]); // Removed control dependencies!

  // Render loop priority 1 overrides R3F default render
  useFrame(() => {
    if (postProcessingRef.current) {
      postProcessingRef.current.render();
    }
  }, 1);

  return null;
}