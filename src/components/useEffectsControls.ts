import { useMemo } from 'react';
import { useControls } from 'leva';

export function useEffectsControls() {
  const smaaParams = useControls('Effects.SMAA', {
    enabled: { value: false, label: 'Enable SMAA' },
  }, { collapsed: true });

  const bloomParams = useControls('Effects.Bloom', {
    enabled: { value: true, label: 'Enable Bloom' },
    threshold: { value: 0.35, min: 0, max: 1, step: 0.01 },
    strength: { value: 0.3, min: 0, max: 3, step: 0.01 },
    radius: { value: 0.5, min: 0, max: 1, step: 0.01 },
  }, { collapsed: true });

  const toneMappingParams = useControls('Effects.Tone Mapping', {
    enabled: { value: true, label: 'Enable Tone Mapping' },
    exposure: { value: 1.1, min: 0.1, max: 2, step: 0.01 },
  }, { collapsed: true });

  const dofParamsTPS = useControls('Effects.DoF.TPS', {
    enabled: { value: true, label: 'Enable Depth of Field' },
    autofocus: { value: true, label: 'Auto Focus Character' },
    focusDistance: { value: 1.3, min: 0, max: 100, step: 0.1, render: (get) => !get('Effects.DoF.TPS.autofocus') },
    focalLength: { value: 25.0, min: 0.01, max: 100, step: 0.1 },
    bokehScale: { value: 5, min: 0.0, max: 10.0, step: 0.1 },
  }, { collapsed: true });


  const dof = useMemo(() => {
    return {
      enabled: dofParamsTPS.enabled,
      autofocus: dofParamsTPS.autofocus,
      focusDistance: dofParamsTPS.focusDistance,
      focalLength: dofParamsTPS.focalLength,
      bokehScale: dofParamsTPS.bokehScale,
    }
  }, [dofParamsTPS]);

  return {
    smaa: smaaParams.enabled,
    bloom: {
      enabled: bloomParams.enabled,
      threshold: bloomParams.threshold,
      strength: bloomParams.strength,
      radius: bloomParams.radius,
    },
    toneMapping: {
      enabled: toneMappingParams.enabled,
      exposure: toneMappingParams.exposure,
    },
    dof,
  };
}
