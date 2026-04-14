import { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, AnimationAction } from 'three';
import { useAnimations } from '@react-three/drei';
import { CharacterProps } from './config';
import { useCharacterAssets } from './hooks/useCharacterAssets';

export const Character = ({ position = [0, 0, 0], scale = 1, visible = true }: CharacterProps) => {
  const groupRef = useRef<Group>(null);
  const { scene, animations } = useCharacterAssets();

  // Bind animations to the group ref
  const { actions, names } = useAnimations(animations, groupRef);

  // Track initial render to prevent the Rest Pose glitch
  const isInitialRender = useRef(true);

  // Start with index 0 (e.g., 'Drift')
  const [index, setIndex] = useState(0); 
  const [blendRate, setBlendRate] = useState(0);

  const transT = 3;

  function easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  function applyEasedFade(action: AnimationAction, duration: number, fadeIn: boolean = true, isInitial: boolean = false): void {
    // If it is the first play, skip fading and set weight to 1 immediately
    if (isInitial) {
      action.setEffectiveWeight(1);
      action.play();
      // Instantly set the correct blendRate based on the starting index
      setBlendRate(index === 0 ? 0 : 1);
      return;
    }

    action.setEffectiveWeight(fadeIn ? 0 : 1);

    let startTime = performance.now();

    const interval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const normalizedTime = Math.min(elapsed / (duration * 1000), 1); 

      // Update blend rate for rotation/other effects
      const currentBlendRate = index === 0 ? 1 - Math.min(elapsed / (transT * 1000), 1) : Math.min(elapsed / (transT * 1000), 1);
      setBlendRate(currentBlendRate);

      const easedTime = easeInOutQuad(normalizedTime); 
      const weight = fadeIn ? easedTime : 1 - easedTime;

      action.setEffectiveWeight(weight);

      if (normalizedTime === 1) {
        if (!fadeIn) action.stop(); 
        clearInterval(interval);
      }
    }, 10);

    action.play();
  }

  useEffect(() => {
    if (names.length === 0) return;
    
    const safeIndex = index % names.length;
    const action = actions[names[safeIndex]];
    
    if (!action) return;

    // Check if this is the very first time we are running this effect
    const isFirst = isInitialRender.current;
    if (isFirst) {
      isInitialRender.current = false;
    }

    // Fade in current animation (skip fade if it is the first render)
    applyEasedFade(action, transT, true, isFirst); 

    // Fade out previous animation on cleanup
    return () => {
      // Do not try to fade out if it was the initial render being cleaned up (e.g., StrictMode)
      if (!isFirst) {
        applyEasedFade(action, transT, false); 
      }
    };
  }, [index, actions, names]);

  useFrame((_, delta) => {
    if (groupRef.current) {
      // Apply the rotation effect based on blendRate
      groupRef.current.rotation.x += delta * blendRate * 0.5;
    }
  });

  if (!scene) return null;

  return (
    <group 
      ref={groupRef} 
      position={position} 
      scale={scale} 
      visible={visible} 
      dispose={null}
      onClick={(e) => {
        e.stopPropagation(); // Prevent click events from bubbling up
        if ((blendRate === 0 || blendRate === 1) && names.length > 0) {
          setIndex((index + 1) % names.length);
        }
      }}
    >
      <primitive object={scene} />
    </group>
  );
};