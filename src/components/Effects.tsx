import { useRef, useEffect, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { WebGPURenderer } from "three/webgpu";
import { uniform, pass, mix, color, int, float } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { godrays } from "three/addons/tsl/display/GodraysNode.js";
import { bilateralBlur } from "three/addons/tsl/display/BilateralBlurNode.js";
import { depthAwareBlend } from "three/addons/tsl/display/depthAwareBlend.js";
import { useEffectsControls } from "./useEffectsControls";

/**
 * Scans the scene tree once per frame until a shadow-casting
 * DirectionalLight or PointLight is found, then stops scanning.
 */
function useShadowLight(scene: THREE.Scene) {
  const [light, setLight] = useState<THREE.DirectionalLight | THREE.PointLight | null>(null);
  const found = useRef(false);

  useEffect(() => {
    found.current = false;
    setLight(null);
  }, [scene]);

  useFrame(() => {
    if (found.current) return;
    scene.traverse((obj: any) => {
      if (
        !found.current &&
        (obj.isDirectionalLight || obj.isPointLight) &&
        obj.castShadow
      ) {
        found.current = true;
        setLight(obj);
      }
    });
  });

  return light;
}

export default function Effects() {
  const {
    bloom: bloomCfg,
    dof: dofCfg,
    toneMapping: tmCfg,
    smaa: smaaEnabled,
    godrays: grCfg
  } = useEffectsControls();
  const { gl, scene, camera } = useThree();

  const sunLight = useShadowLight(scene);

  const postProcessingRef = useRef<THREE.PostProcessing | null>(null);
  const godraysPassRef = useRef<any>(null);

  const uParams = useRef({
    focusDist: uniform(0),
    focalLen: uniform(0),
    bokeh: uniform(0),
    bloomThresh: uniform(0),
    bloomStr: uniform(0),
    bloomRad: uniform(0),
    dofEnabled: uniform(1),
    bloomEnabled: uniform(1),
    grBlendColor: uniform(color(0xffffff)),
    grEdgeRadius: uniform(int(2)),
    grEdgeStrength: uniform(float(2)),
  });

  useEffect(() => {
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

    if (godraysPassRef.current) {
      godraysPassRef.current.raymarchSteps.value = grCfg.raymarchSteps;
      godraysPassRef.current.density.value = grCfg.density;
      godraysPassRef.current.maxDensity.value = grCfg.maxDensity;
      godraysPassRef.current.distanceAttenuation.value = grCfg.distanceAttenuation;
    }

    uParams.current.grBlendColor.value.set(grCfg.blendColor);
    uParams.current.grEdgeRadius.value = Math.round(grCfg.edgeRadius);
    uParams.current.grEdgeStrength.value = grCfg.edgeStrength;

    if (gl instanceof WebGPURenderer) {
      gl.toneMappingExposure = Math.pow(tmCfg.exposure, 4.0);
      gl.toneMapping = tmCfg.enabled ? THREE.ReinhardToneMapping : THREE.NoToneMapping;
    }
  }, [bloomCfg, dofCfg, tmCfg, grCfg, gl]);

  // Build the shader node graph; rebuilds when sunLight / toggle changes
  useEffect(() => {
    if (!gl || !(gl instanceof WebGPURenderer)) {
      console.error("WebGPURenderer is required for TSL Effects.");
      return;
    }

    const pp = new THREE.PostProcessing(gl);
    postProcessingRef.current = pp;

    const scenePass = pass(scene, camera);
    const scenePassColor = scenePass.getTextureNode("output");
    const scenePassDepthTex = scenePass.getTextureNode("depth");
    const scenePassViewZ = scenePass.getViewZNode();

    let finalNode: any = scenePassColor;

    // 1. Godrays (requires a shadow-casting light)
    if (grCfg.enabled && sunLight) {
      const godraysNode = godrays(scenePassDepthTex, camera, sunLight);
      godraysPassRef.current = godraysNode;

      const blurPass = bilateralBlur(godraysNode.getTextureNode());

      finalNode = depthAwareBlend(
        scenePassColor,
        blurPass.getTextureNode(),
        scenePassDepthTex,
        camera,
        {
          blendColor: uParams.current.grBlendColor,
          edgeRadius: uParams.current.grEdgeRadius,
          edgeStrength: uParams.current.grEdgeStrength,
        }
      );
    } else {
      godraysPassRef.current = null;
    }

    // 2. Depth of Field
    const dofNode = dof(
      finalNode,
      scenePassViewZ,
      uParams.current.focusDist,
      uParams.current.focalLen,
      uParams.current.bokeh
    );
    finalNode = mix(finalNode, dofNode as any, uParams.current.dofEnabled);

    // 3. Bloom
    const bloomNode = bloom(finalNode);
    bloomNode.threshold = uParams.current.bloomThresh;
    bloomNode.strength = uParams.current.bloomStr;
    bloomNode.radius = uParams.current.bloomRad;
    finalNode = finalNode.add(bloomNode.mul(uParams.current.bloomEnabled));

    // 4. SMAA
    if (smaaEnabled) {
      finalNode = smaa(finalNode);
    }

    pp.outputNode = finalNode;
    pp.needsUpdate = true;

    return () => {
      postProcessingRef.current = null;
    };
  }, [gl, scene, camera, smaaEnabled, grCfg.enabled, sunLight]);

  useFrame(() => {
    if (postProcessingRef.current) {
      postProcessingRef.current.render();
    }
  }, 1);

  return null;
}
