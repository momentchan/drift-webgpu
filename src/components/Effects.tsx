import { useRef, useEffect, useState, useMemo } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useFBO } from "@react-three/drei";
import * as THREE from "three/webgpu";
import { WebGPURenderer } from "three/webgpu";
import {
  uniform,
  pass,
  mix,
  color,
  int,
  float,
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
import { godrays } from "three/addons/tsl/display/GodraysNode.js";
import { bilateralBlur } from "three/addons/tsl/display/BilateralBlurNode.js";
import { depthAwareBlend } from "three/addons/tsl/display/depthAwareBlend.js";
import { useEffectsControls } from "./useEffectsControls";

/**
 * WebGPU TSL post-processing: scene pass (color + depth + viewZ), optional trail
 * from a compute pass, then godrays, DoF, bloom, and film grain. Trail reads a
 * separate base FBO so post-processed bloom/noise does not feed back into history.
 */

// Closer to the origin = stronger bokeh; at this distance, bokeh matches the Leva "bokehScale" slider.
const BOKEH_DISTANCE_REF = 5;

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
  // Leva-driven knobs (bloom, DoF, tone mapping, godrays, noise, trail).
  const {
    bloom: bloomCfg,
    dof: dofCfg,
    toneMapping: tmCfg,
    godrays: grCfg,
    noise: noiseCfg,
    trail: trailCfg,
  } = useEffectsControls();
  const { gl, scene, camera, size } = useThree();

  const sunLight = useShadowLight(scene);

  // Resolve physical pixel resolution so compute dispatch matches FBO/StorageTexture extents.
  const dpr = gl.getPixelRatio();
  const resW = Math.max(1, Math.floor(size.width * dpr * 0.25));
  const resH = Math.max(1, Math.floor(size.height * dpr * 0.25));

  const postProcessingRef = useRef<THREE.PostProcessing | null>(null);
  const godraysPassRef = useRef<any>(null);
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
   *    The trail TextureNode is consumed by the PP graph below;
   *    we just swap its `.value` each frame to point at whichever
   *    storage texture was just written, without recompiling.
   * ============================================================ */
  const usePing = useRef(true);

  // Ping-pong storage + two prebuilt compute dispatches; rebuilt when resW/resH/baseFbo change.
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

    // Compute kernel: read the clean base scene + previous trail,
    // accumulate with decay, write to the next storage texture.
    const computeTrail = Fn(([readTex, writeTex]: any) => {
      const x = int(instanceIndex.mod(resW));
      const y = int(instanceIndex.div(resW));
      const uv = ivec2(x, y);

      const current = textureLoad(baseFbo.texture, uv);
      const prev = readTex.load(uv);

      // .max(0) instead of .clamp(0, 1) keeps HDR highlights alive for Bloom.
      const blended = current.rgb.add(prev.rgb.mul(trailDecayNode.current)).max(0);

      textureStore(writeTex, uv, vec4(blended, 1.0));
    }) as unknown as (readTex: any, writeTex: any) => any;

    const totalPixels = resW * resH;

    // The dynamic trail texture node injected into the PP graph.
    // Defaults to `ping`; updated to ping/pong each frame.
    const trailTexNode = texture(ping);

    return {
      pingTex: ping,
      pongTex: pong,
      computeToPong: computeTrail(rPing, wPong).compute(totalPixels),
      computeToPing: computeTrail(rPong, wPing).compute(totalPixels),
      trailTexNode,
    };
  }, [resW, resH, baseFbo]);

  // Dispose previous compute assets when the resolution changes or on unmount.
  useEffect(() => {
    return () => {
      computeAssets.pingTex.dispose();
      computeAssets.pongTex.dispose();
    };
  }, [computeAssets]);

  // Reset ping-pong selector whenever resolution changes so the new
  // buffers don't show stale GPU memory on the first frame.
  useEffect(() => {
    usePing.current = true;
  }, [computeAssets]);

  /* ========================================================= */

  // TSL uniforms wired into the PP graph; scalar toggles use 0/1 for mix() weights.
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
    noiseIntensity: uniform(0.1),
  });

  // Push Leva values into uniforms each frame the controls object changes.
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

    if (godraysPassRef.current) {
      godraysPassRef.current.raymarchSteps.value = grCfg.raymarchSteps;
      godraysPassRef.current.density.value = grCfg.density;
      godraysPassRef.current.maxDensity.value = grCfg.maxDensity;
      godraysPassRef.current.distanceAttenuation.value = grCfg.distanceAttenuation;
    }

    uParams.current.grBlendColor.value.set(grCfg.blendColor);
    uParams.current.grEdgeRadius.value = Math.round(grCfg.edgeRadius);
    uParams.current.grEdgeStrength.value = grCfg.edgeStrength;

    uParams.current.noiseIntensity.value = noiseCfg.intensity;

    trailDecayNode.current.value = trailCfg.decay;
    trailIntensityNode.current.value = trailCfg.intensity;

    if (gl instanceof WebGPURenderer) {
      gl.toneMappingExposure = Math.pow(tmCfg.exposure, 4.0);
      gl.toneMapping = tmCfg.enabled ? THREE.ReinhardToneMapping : THREE.NoToneMapping;
    }
  }, [bloomCfg, dofCfg, tmCfg, grCfg, noiseCfg, trailCfg, gl]);

  // Build PostProcessing output node graph. Rebuild when deps change (pass() is recreated).
  useEffect(() => {
    if (!gl || !(gl instanceof WebGPURenderer)) {
      console.error("WebGPURenderer is required for TSL Effects.");
      return;
    }

    const pp = new THREE.PostProcessing(gl);
    postProcessingRef.current = pp;

    // Single internal scene rasterization supplies color, depth, and per-pixel viewZ for DoF/godrays.
    const scenePass = pass(scene, camera);
    const scenePassColor = scenePass.getTextureNode("output");
    const scenePassDepthTex = scenePass.getTextureNode("depth");
    const scenePassViewZ = scenePass.getViewZNode();

    /* ============================================================
     * Trail composite: inject the compute-shader trail into the
     * pipeline upstream of Godrays/DoF/Bloom so downstream effects
     * apply to the trail too (e.g. trails get bloomed, blurred...).
     * ============================================================ */
    let compositedBase: any = scenePassColor;

    if (trailCfg.enabled) {
      const trailNode = computeAssets.trailTexNode;
      const trail = vec3(trailNode.rgb).mul(trailIntensityNode.current);

      switch (trailCfg.blendMode) {
        case "max":
          compositedBase = scenePassColor.max(trail);
          break;
        case "screen": {
          // Screen: 1 - (1 - a) * (1 - b)
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

    // 1. Godrays (requires a shadow-casting light).
    // Note: depth-aware blend mixes the original scene color with the godrays
    // glow, so trails composited above remain visible underneath the volume.
    if (grCfg.enabled && sunLight) {
      const godraysNode = godrays(scenePassDepthTex, camera, sunLight);
      godraysPassRef.current = godraysNode;

      const blurPass = bilateralBlur(godraysNode.getTextureNode());

      finalNode = depthAwareBlend(
        finalNode,
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

    // 2. Depth of Field (focusDist / focalLen / bokeh uniforms updated in useFrame / useEffect).
    const dofNode = dof(
      finalNode,
      scenePassViewZ,
      uParams.current.focusDist,
      uParams.current.focalLen,
      uParams.current.bokeh
    );
    finalNode = mix(finalNode, dofNode as any, uParams.current.dofEnabled);

    // 3. Bloom on the current color (includes trail when trail is enabled).
    const bloomNode = bloom(finalNode);
    bloomNode.threshold = uParams.current.bloomThresh;
    bloomNode.strength = uParams.current.bloomStr;
    bloomNode.radius = uParams.current.bloomRad;
    finalNode = finalNode.add(bloomNode.mul(uParams.current.bloomEnabled));

    // 4. Film grain (screen-space hash; seed uses integer pixel coords + time).
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
    grCfg.enabled,
    noiseCfg.enabled,
    noiseCfg.premultiply,
    sunLight,
    trailCfg.enabled,
    trailCfg.blendMode,
    computeAssets,
  ]);

  // Order: optional trail prep (extra scene render to baseFbo + compute), then PP (scene pass inside pp.render).
  useFrame(() => {
    camera.getWorldPosition(cameraWorldPos);
    const camDist = Math.max(1e-3, cameraWorldPos.distanceTo(focusTarget));

    // Bokeh strength scales with inverse camera distance so the slider feels consistent at different ranges.
    if (dofCfg.enabled) {
      uParams.current.bokeh.value =
        dofCfg.bokehScale * (BOKEH_DISTANCE_REF / camDist);
    }

    // Autofocus: drive DoF focus distance from camera-to-focusTarget distance (world units).
    if (dofCfg.enabled && dofCfg.autofocus) {
      uParams.current.focusDist.value = camDist;
    }

    const pp = postProcessingRef.current;
    if (!pp) return;

    const prevTarget = gl.getRenderTarget();

    if (trailCfg.enabled) {
      // Extra full scene draw at low res: color for trail accumulation (no PP yet).
      gl.setRenderTarget(baseFbo);
      gl.clear();
      gl.render(scene, camera);

      // Accumulate trail into the opposite ping-pong buffer; swap trailTexNode to the write target.
      const computeNode = usePing.current
        ? computeAssets.computeToPong
        : computeAssets.computeToPing;
      (gl as unknown as WebGPURenderer).compute(computeNode);

      computeAssets.trailTexNode.value = usePing.current
        ? computeAssets.pongTex
        : computeAssets.pingTex;

      usePing.current = !usePing.current;
    }

    // PostProcessing to the default target. pass() causes an internal scene rasterization here.
    // When trail is on, an extra gl.render to baseFbo already ran above for trail-only input.
    gl.setRenderTarget(prevTarget);
    pp.render();
  }, 1);

  return null;
}
