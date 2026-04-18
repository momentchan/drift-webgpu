import { useControls } from 'leva';

export function useFogControls() {
  return useControls(
    'Scene.Fog',
    {
      enabled: { value: true, label: 'Enable Fog' },
      color: { value: '#000000', label: 'Fog Color' },
      density: { value: 0.11, min: 0, max: 0.3, step: 0.001 },
    },
    { collapsed: true },
  );
}
