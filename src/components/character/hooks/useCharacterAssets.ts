import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as THREE from 'three/webgpu';
import { Fn, oneMinus, texture, uv } from 'three/tsl';
import { BODY_MESH_NAMES, BODY_TEXTURE_PATHS, DETAIL_TEXTURE_PATHS, MODEL_PATHS } from '../config';
import { useKTX2Texture } from '@core';

const configureTextures = (textures: any) => {
  if (textures.map) textures.map.colorSpace = THREE.SRGBColorSpace;
  if (textures.normalMap) textures.normalMap.colorSpace = THREE.NoColorSpace; 
  if (textures.aoMap) textures.aoMap.colorSpace = THREE.NoColorSpace;
  if (textures.metalnessMap) textures.metalnessMap.colorSpace = THREE.NoColorSpace;
  
  ['map', 'metalnessMap', 'aoMap', 'normalMap'].forEach(key => {
    if (textures[key]) textures[key].flipY = false;
  });
  return textures;
};

export function useCharacterAssets() {
  const [meshData] = useGLTF(MODEL_PATHS);

  const mesh = meshData.scene;

  const bodyTex = configureTextures(useKTX2Texture(BODY_TEXTURE_PATHS))
  const detailTex = configureTextures(useKTX2Texture(DETAIL_TEXTURE_PATHS));

  const { scene, animations, helmets } = useMemo((): { scene: THREE.Object3D | null; animations: THREE.AnimationClip[]; helmets: THREE.Mesh[] } => {
    
    if (!mesh || !bodyTex.map || !detailTex.map) return { scene: null, animations: [], helmets: [] };

    const clonedScene = SkeletonUtils.clone(mesh as any);

    // --- Material Setup ---
    const bodyMat = new THREE.MeshStandardNodeMaterial({
      map: bodyTex.map,
      aoMap: bodyTex.aoMap,
      normalMap: bodyTex.normalMap,
      metalnessMap: bodyTex.metalnessMap,
      metalness: 1,
    });
    bodyMat.roughnessNode = Fn(() => oneMinus(texture(bodyTex.metalnessMap, uv())))();

    const detailMat = new THREE.MeshStandardNodeMaterial({
      map: detailTex.map,
      aoMap: detailTex.aoMap,
      normalMap: detailTex.normalMap,
      metalnessMap: detailTex.metalnessMap,
      metalness: 1,
    })

    detailMat.roughnessNode = Fn(() => oneMinus(texture(detailTex.metalnessMap, uv())))();

    // Assign materials based on mesh names and store all helmet references
    const helmets: THREE.Mesh[] = [];

    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.frustumCulled = false;

        if (BODY_MESH_NAMES.includes(child.name)) {
          child.material = bodyMat;
        } else if (child.name.includes('Helmet')) {
          child.material = detailMat;
          child.visible = true;
          helmets.push(child);
        } else if (!child.name.includes('Person')) {
          child.material = detailMat;
        } else {
          // child.visible = false;
        }
      }
    });

    return { scene: clonedScene, animations: meshData.animations, helmets };
  }, [
    mesh,
    bodyTex,
    detailTex,
  ]);

  return { scene, animations, helmets };
}
