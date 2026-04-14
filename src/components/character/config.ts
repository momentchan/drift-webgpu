// ============================================================================
// Constants
// ============================================================================

// Character mesh name constants
export const BODY_MESH_NAMES: readonly string[] = [
  'Astronaut_Suit_Body_Detail_01_Mesh',
  'Astronaut_Suit_Body_Mesh',
  'Astronaut_Suit_Shoes_Mesh',
];


export const BODY_TEXTURE_PATHS = {
  map: 'textures/Body/Astronaut_Suit_Body_Albedo.ktx2',
  metalnessMap: 'textures/Body/Astronaut_Suit_Body_Metallic.ktx2',
  aoMap: 'textures/Body/Astronaut_Suit_Body_Ao.ktx2',
  normalMap: 'textures/Body/Astronaut_Suit_Body_Normals.ktx2',
};

export const DETAIL_TEXTURE_PATHS = {
  map: 'textures/Details/Astronaut_Suit_Details_Albedo.ktx2',
  metalnessMap: 'textures/Details/Astronaut_Suit_Details_Metallic.ktx2',
  aoMap: 'textures/Details/Astronaut_Suit_Details_Ao.ktx2',
  normalMap: 'textures/Details/Astronaut_Suit_Details_Normals.ktx2',
};

export const MODEL_PATHS = [
  '/models/Astronaut.glb',
];

// ============================================================================
// Types
// ============================================================================

export interface CharacterProps {
  position?: [number, number, number];
  scale?: number;
  visible?: boolean;
}