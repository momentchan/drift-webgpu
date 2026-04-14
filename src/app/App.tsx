import { AdaptiveDpr, CameraControls, Hud, OrthographicCamera } from "@react-three/drei";
import { CanvasCapture } from "@core";
import { LevaWrapper } from "@core";
import { Canvas } from "@react-three/fiber";
import { WebGPURenderer } from "three/webgpu";
import { useEffect, useState } from "react";
import Stage from "../components/Stage";
import Light from "../components/Light";
import Boids from "../components/Boids";
import HandDebug from "../components/HandDebug";
import { initHandTracking } from "@core/interaction/tracker";


interface ComponentProps {
  radius: number;
  lightPos: [number, number, number];
  rayCount: number;
}


export default function App() {
  const [frameloop, setFrameloop] = useState("never");

  const props: ComponentProps = {
    radius: 10,
    lightPos: [100, 100, 0],
    rayCount: 6,
  };

  useEffect(() => {
    initHandTracking();
  }, []);


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
            ...canvas,
            powerPreference: "high-performance",
            antialias: true,
            alpha: false,
          });
          return renderer.init().then(() => renderer);
        }}
        dpr={[1, 2]}
        performance={{ min: 0.5, max: 1 }}
      >
        <AdaptiveDpr pixelated />
        <CameraControls makeDefault />
        <CanvasCapture />
        <Stage />
        <Light radius={props.radius} lightPos={props.lightPos} />
        <Boids radius={props.radius} count={10000} />

        <Hud>
          <OrthographicCamera makeDefault position={[0, 0, 10]} />
          <HandDebug />
        </Hud>
      </Canvas>
    </>
  );
}
