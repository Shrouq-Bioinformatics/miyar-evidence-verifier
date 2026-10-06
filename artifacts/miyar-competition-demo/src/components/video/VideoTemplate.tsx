import { useEffect, useRef } from 'react';
import {
  VideoCanvas,
  type VideoAspectRatio,
  useVideoPlayer,
  useVideoAudio,
} from '@/lib/video';

import { FilmScene } from './FilmScenes';
import { filmAsset, SCENE_DURATIONS, type FilmSceneKey } from './filmData';

const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';

function VoiceoverTrack() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const { muted, paused } = useVideoAudio();

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = muted;
    void audio.play().catch((error: unknown) => {
      console.error('[MIYAR video] Voiceover playback could not start.', error);
    });
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = muted;
    if (paused) {
      audio.pause();
      return;
    }
    void audio.play().catch((error: unknown) => {
      console.error('[MIYAR video] Voiceover playback could not resume.', error);
    });
  }, [muted, paused]);

  return (
    <audio
      ref={audioRef}
      className="voiceover-track"
      src={filmAsset('voiceover.mp3')}
      autoPlay
      preload="auto"
      aria-label="التعليق الصوتي العربي الأصلي"
    />
  );
}

export default function VideoTemplate() {
  const { currentSceneKey } = useVideoPlayer({
    durations: SCENE_DURATIONS,
    loop: false,
  });

  return (
    <VideoCanvas
      aspectRatio={VIDEO_ASPECT_RATIO}
      className="miyar-film"
      style={{ backgroundColor: 'var(--color-bg-light)' }}
    >
      <VoiceoverTrack />
      <FilmScene sceneKey={currentSceneKey as FilmSceneKey} />
    </VideoCanvas>
  );
}
