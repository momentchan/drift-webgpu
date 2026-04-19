import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import GlobalState from './GlobalState';

interface SoundData {
  file: string;
  volume: number;
  delay: number;
  signal: boolean;
}

interface BgmRef {
  audio: THREE.Audio;
  data: SoundData;
}

export default function BGM() {
  const { camera } = useThree();
  const bgmRefs = useRef<BgmRef[]>([]);
  const { started, noted } = GlobalState();
  const listener = useRef(new THREE.AudioListener()).current;
  const notedRef = useRef(noted);
  notedRef.current = noted;

  const soundData: SoundData[] = [
    { file: 'audio/three-sparrows.mp3', volume: 0.1, delay: 0, signal: false },
    { file: 'audio/noise.mp3', volume: 0.15, delay: 0, signal: false },
    { file: 'audio/narrative.m4a', volume: 0.02, delay: 3, signal: true },
  ];

  useEffect(() => {
    camera.add(listener);
  }, [camera, listener]);

  useEffect(() => {
    if (!started) return;

    soundData.forEach((data) => {
      const audio = new THREE.Audio(listener);
      const audioLoader = new THREE.AudioLoader();
      audioLoader.load(data.file, (buffer) => {
        audio.setBuffer(buffer);
        audio.setLoop(true);
        audio.setVolume(data.volume);
        // Signal tracks should stay silent while `noted` is on.
        if (data.signal && notedRef.current) return;
        audio.play(data.delay);
      });
      bgmRefs.current.push({ audio, data });
    });

    return () => {
      bgmRefs.current.forEach((bgm) => bgm.audio.stop());
      bgmRefs.current = [];
    };
  }, [started, listener]);

  // Mute/unmute signal-tagged tracks based on `noted`.
  useEffect(() => {
    if (!started) return;

    bgmRefs.current.forEach(({ audio, data }) => {
      if (!data.signal) return;
      if (!audio.buffer) return;

      if (noted) {
        if (audio.isPlaying) audio.pause();
      } else {
        if (!audio.isPlaying) audio.play();
      }
    });
  }, [noted, started]);

  return null;
}
