import { AdaptiveDpr, CameraControls } from "@react-three/drei";
import BasicMesh from "../components/BasicMesh";
import { CanvasCapture } from "@core";
import { LevaWrapper } from "@core";
import { Canvas } from "@react-three/fiber";
import { WebGPURenderer } from "three/webgpu";
import { useState } from "react";

export default function App() {
  const [frameloop, setFrameloop] = useState("never");

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
            stencil: false,
            shadowMap: true,
            preserveDrawingBuffer: true,
          });
          return renderer.init().then(() => renderer);
        }}
        dpr={[1, 2]}
        performance={{ min: 0.5, max: 1 }}
      >
        <AdaptiveDpr pixelated />
        <CameraControls makeDefault />
        <BasicMesh />
        <CanvasCapture />
      </Canvas>
    </>
  );
}
