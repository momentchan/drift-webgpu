import { useRef, useEffect, useMemo } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useFBO } from "@react-three/drei";
import * as THREE from "three/webgpu";
import { WebGPURenderer } from "three/webgpu";
import {
  uniform,
  pass,
  mix,
  int,
  hash,
  time,
  screenCoordinate,
  vec3,
  vec4,
  texture,
  storageTexture,
  textureStore,
  textureLoad,
  Fn,
  instanceIndex,
  ivec2,
  NodeAccess,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { useEffectsControls } from "./useEffectsControls";

/**
 * WebGPU TSL post-processing: scene pass (color + depth + viewZ), optional trail
 * from a compute pass, then DoF, bloom, and film grain. Trail reads a separate
 * base FBO so post-processed bloom/noise does not feed back into history.
 */

// Closer to the origin = stronger bokeh; at this distance, bokeh matches the Leva "bokehScale" slider.
const BOKEH_DISTANCE_REF = 5;

export default function Effects() {
  // Leva-driven knobs (bloom, DoF, tone mapping, noise, trail).
  const {
    bloom: bloomCfg,
    dof: dofCfg,
    toneMapping: tmCfg,
    noise: noiseCfg,
    trail: trailCfg,
  } = useEffectsControls();
  const { gl, scene, camera, size } = useThree();

  // Trail FBO + storage textures: quarter of physical pixel size (CSS × DPR × 0.25).
  const dpr = gl.getPixelRatio();
  const resW = Math.max(1, Math.floor(size.width * dpr * 0.25));
  const resH = Math.max(1, Math.floor(size.height * dpr * 0.25));

  const postProcessingRef = useRef<THREE.PostProcessing | null>(null);
  const focusTarget = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const cameraWorldPos = useMemo(() => new THREE.Vector3(), []);

  /* ============================================================
   * 1. Dedicated Source FBO for the Trail compute pass.
   *    Holds the pristine scene render (no bloom / no noise).
   *    Feeding the *post-processed* image back into the compute
   *    would create an infinite feedback loop where bloom keeps
   *    blooming itself and noise keeps stacking forever.
   *    Linear color space avoids a double sRGB encode at present.
   * ============================================================ */
  const fboParams = useMemo(
    () => ({
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
    }),
    []
  );
  const baseFbo = useFBO(resW, resH, fboParams);

  /* ============================================================
   * 2. Trail uniforms (stable refs; values updated from Leva in useEffect below).
   * ============================================================ */
  const trailDecayNode = useRef(uniform(trailCfg.decay));
  const trailIntensityNode = useRef(uniform(trailCfg.intensity));

  /* ============================================================
   * 3. Compute pipeline + ping-pong StorageTextures.
   * ============================================================ */
  const usePing = useRef(true);

  const computeAssets = useMemo(() => {
    const ping = new THREE.StorageTexture(resW, resH);
    const pong = new THREE.StorageTexture(resW, resH);
    ping.type = THREE.HalfFloatType;
    pong.type = THREE.HalfFloatType;
    ping.colorSpace = THREE.LinearSRGBColorSpace;
    pong.colorSpace = THREE.LinearSRGBColorSpace;

    const wPing = storageTexture(ping).setAccess(NodeAccess.WRITE_ONLY);
    const rPing = storageTexture(ping).setAccess(NodeAccess.READ_ONLY);
    const wPong = storageTexture(pong).setAccess(NodeAccess.WRITE_ONLY);
    const rPong = storageTexture(pong).setAccess(NodeAccess.READ_ONLY);

    const computeTrail = Fn(([readTex, writeTex]: any) => {
      const x = int(instanceIndex.mod(resW));
      const y = int(instanceIndex.div(resW));
      const uv = ivec2(x, y);

      const current = textureLoad(baseFbo.texture, uv);
      const prev = readTex.load(uv);

      const blended = current.rgb.add(prev.rgb.mul(trailDecayNode.current)).max(0);

      textureStore(writeTex, uv, vec4(blended, 1.0));
    }) as unknown as (readTex: any, writeTex: any) => any;

    const totalPixels = resW * resH;

    const trailTexNode = texture(ping);

    return {
      pingTex: ping,
      pongTex: pong,
      computeToPong: computeTrail(rPing, wPong).compute(totalPixels),
      computeToPing: computeTrail(rPong, wPing).compute(totalPixels),
      trailTexNode,
    };
  }, [resW, resH, baseFbo]);

  useEffect(() => {
    return () => {
      computeAssets.pingTex.dispose();
      computeAssets.pongTex.dispose();
    };
  }, [computeAssets]);

  useEffect(() => {
    usePing.current = true;
  }, [computeAssets]);

  const uParams = useRef({
    focusDist: uniform(0),
    focalLen: uniform(0),
    bokeh: uniform(0),
    bloomThresh: uniform(0),
    bloomStr: uniform(0),
    bloomRad: uniform(0),
    dofEnabled: uniform(1),
    bloomEnabled: uniform(1),
    noiseIntensity: uniform(0.1),
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
    uParams.current.dofEnabled.value = dofCfg.enabled ? 1 : 0;

    uParams.current.noiseIntensity.value = noiseCfg.intensity;

    trailDecayNode.current.value = trailCfg.decay;
    trailIntensityNode.current.value = trailCfg.intensity;

    if (gl instanceof WebGPURenderer) {
      gl.toneMappingExposure = Math.pow(tmCfg.exposure, 4.0);
      gl.toneMapping = tmCfg.enabled ? THREE.ReinhardToneMapping : THREE.NoToneMapping;
    }
  }, [bloomCfg, dofCfg, tmCfg, noiseCfg, trailCfg, gl]);

  useEffect(() => {
    if (!gl || !(gl instanceof WebGPURenderer)) {
      console.error("WebGPURenderer is required for TSL Effects.");
      return;
    }

    const pp = new THREE.PostProcessing(gl);
    postProcessingRef.current = pp;

    const scenePass = pass(scene, camera);
    const scenePassColor = scenePass.getTextureNode("output");
    const scenePassViewZ = scenePass.getViewZNode();

    let compositedBase: any = scenePassColor;

    if (trailCfg.enabled) {
      const trailNode = computeAssets.trailTexNode;
      const trail = vec3(trailNode.rgb).mul(trailIntensityNode.current);

      switch (trailCfg.blendMode) {
        case "max":
          compositedBase = scenePassColor.max(trail);
          break;
        case "screen": {
          const one = vec3(1.0);
          compositedBase = one.sub(one.sub(scenePassColor).mul(one.sub(trail)));
          break;
        }
        case "mix":
          compositedBase = mix(scenePassColor, trail, trailIntensityNode.current);
          break;
        case "additive":
        default:
          compositedBase = scenePassColor.add(trail);
          break;
      }
    }

    let finalNode: any = compositedBase;

    const dofNode = dof(
      finalNode,
      scenePassViewZ,
      uParams.current.focusDist,
      uParams.current.focalLen,
      uParams.current.bokeh
    );
    finalNode = mix(finalNode, dofNode as any, uParams.current.dofEnabled);

    const bloomNode = bloom(finalNode);
    bloomNode.threshold = uParams.current.bloomThresh;
    bloomNode.strength = uParams.current.bloomStr;
    bloomNode.radius = uParams.current.bloomRad;
    finalNode = finalNode.add(bloomNode.mul(uParams.current.bloomEnabled));

    if (noiseCfg.enabled) {
      const grainSeed = screenCoordinate.x.toUint().mul(73)
        .add(screenCoordinate.y.toUint().mul(997))
        .add(time.mul(60).toUint());
      const grain = hash(grainSeed).mul(uParams.current.noiseIntensity);
      const noiseContribution = noiseCfg.premultiply
        ? vec3(grain).mul(finalNode)
        : vec3(grain);
      finalNode = finalNode.add(noiseContribution);
    }

    pp.outputNode = finalNode;
    pp.needsUpdate = true;

    return () => {
      postProcessingRef.current = null;
    };
  }, [
    gl,
    scene,
    camera,
    noiseCfg.enabled,
    noiseCfg.premultiply,
    trailCfg.enabled,
    trailCfg.blendMode,
    computeAssets,
  ]);

  useFrame(() => {
    camera.getWorldPosition(cameraWorldPos);
    const camDist = Math.max(1e-3, cameraWorldPos.distanceTo(focusTarget));

    if (dofCfg.enabled) {
      uParams.current.bokeh.value =
        dofCfg.bokehScale * (BOKEH_DISTANCE_REF / camDist);
    }

    if (dofCfg.enabled && dofCfg.autofocus) {
      uParams.current.focusDist.value = camDist;
    }

    const pp = postProcessingRef.current;
    if (!pp) return;

    const prevTarget = gl.getRenderTarget();

    if (trailCfg.enabled) {
      gl.setRenderTarget(baseFbo);
      gl.clear();
      gl.render(scene, camera);

      const computeNode = usePing.current
        ? computeAssets.computeToPong
        : computeAssets.computeToPing;
      (gl as unknown as WebGPURenderer).compute(computeNode);

      computeAssets.trailTexNode.value = usePing.current
        ? computeAssets.pongTex
        : computeAssets.pingTex;

      usePing.current = !usePing.current;
    }

    gl.setRenderTarget(prevTarget);
    pp.render();
  }, 1);

  return null;
}
