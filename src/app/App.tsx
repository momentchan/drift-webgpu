import { AdaptiveDpr, CameraControls } from "@react-three/drei";
import { CanvasCapture } from "@core";
import { LevaWrapper } from "@core";
import { Canvas } from "@react-three/fiber";
import { WebGPURenderer } from "three/webgpu";
// import { useState } from "react";
import Stage from "../components/Stage";
import Light from "../components/Light";
import Boids from "../components/Boids";
import HandDebug from "../components/HandDebug";
import { useHandTracking } from "../components/useHandTracking";
import Effects from "../components/Effects";
import { Character } from "../components/character/Character";
import { Inspector } from "three/addons/inspector/Inspector.js";
import { useControls } from "leva";

interface ComponentProps {
  radius: number;
  lightPos: [number, number, number];
  rayCount: number;
}

function HandTrackingDriver() {
  useHandTracking({ modelType: 'LITE', mirror: true });
  return null;
}

export default function App() {

  const props: ComponentProps = {
    radius: 7.5,
    lightPos: [120, 120, 0],
    rayCount: 6,
  };

  return (
    <>
      <LevaWrapper />

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
          renderer.inspector = new Inspector();

          return renderer.init().then(() => renderer);
        }}
        dpr={[1, 2]}
        performance={{ min: 0.5, max: 1 }}
      >
        <HandTrackingDriver />
        {/* <fogExp2 attach="fog" args={[fog.color, fog.density]} /> */}
        <color attach="background" args={['#000000']} />
        <AdaptiveDpr pixelated />
        <CameraControls makeDefault />
        <Effects />
        <CanvasCapture />
        <Character />
        <Light radius={props.radius} lightPos={props.lightPos} />
        <Boids radius={props.radius} count={8192} />
        <HandDebug />
      </Canvas>
    </>
  );
}
