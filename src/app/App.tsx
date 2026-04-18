import { AdaptiveDpr } from "@react-three/drei";
import { CanvasCapture } from "@core";
import { LevaWrapper } from "@core";
import { Canvas } from "@react-three/fiber";
import { WebGPURenderer } from "three/webgpu";
import Light from "../components/Light";
import Boids from "../components/Boids";
import HandMarker from "../components/HandMarker";
import { useHandTracking } from "../components/useHandTracking";
import Effects from "../components/Effects";
import { Character } from "../components/character/Character";
import { Inspector } from "three/addons/inspector/Inspector.js";
import CameraRotator from "../components/CameraRotator";
import * as THREE from "three/webgpu";
import HandDebugCanvas from "../components/HandDebugCanvas";
import BGM from "../components/Bgm";
import GlobalState from "../components/GlobalState";
import AI from "../components/ai/AI";
import SceneBackdrop from "../components/SceneBackdrop";
import { useFogControls } from "../components/useFogControls";

interface ComponentProps {
  radius: number;
  lightPos: [number, number, number];
  rayCount: number;
}

function HandTrackingDriver() {
  useHandTracking({ modelType: 'LITE', mirror: true });
  return null;
}

function EntryOverlay() {
  const { started, setStarted } = GlobalState();

  if (started) return null;

  const handleEnter = async () => {
    const ctx = THREE.AudioContext.getContext() as AudioContext;
    if (ctx.state !== 'running') {
      await ctx.resume();
    }
    setStarted(true);
  };
  
  if (started) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.85)",
        cursor: "pointer",
      }}
      onClick={() => { void handleEnter(); }}
    >
      <div style={{ textAlign: "center", color: "#fff" }}>
        <p style={{ fontSize: 14, opacity: 0.6, margin: "0 0 16px" }}>
          Click anywhere to start
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const fog = useFogControls();

  const props: ComponentProps = {
    radius: 7.5,
    lightPos: [120, 120, 0],
    rayCount: 6,
  };

  return (
    <>
      <LevaWrapper initialHidden={true} />
      <EntryOverlay />
      <AI/>

      <Canvas
        shadows
        camera={{
          fov: 45,
          near: 0.1,
          far: 200,
          position: [0, 0, 5],
        }}
        gl={(canvas) => {
          const renderer = new WebGPURenderer({
            ...canvas as any,
            powerPreference: "high-performance",
            antialias: true,
            alpha: false,
          });
          if (window.location.pathname.includes("debug")) {
            renderer.inspector = new Inspector();
          }

          return renderer.init().then(() => renderer);
        }}
        dpr={[1, 2]}
        performance={{ min: 0.5, max: 1 }}
      >
        {fog.enabled ? (
          <fogExp2 attach="fog" args={[fog.color, fog.density]} />
        ) : null}

        <HandTrackingDriver />
        <color attach="background" args={['#000000']} />
        <AdaptiveDpr pixelated />
        <CameraRotator />
        <Effects />
        <CanvasCapture />
        <Character />
        <Light radius={props.radius} lightPos={props.lightPos} />
        <Boids radius={props.radius} count={8192} />
        <HandMarker />
        <BGM />

        <SceneBackdrop />
      </Canvas>

      <HandDebugCanvas />
    </>
  );
}
