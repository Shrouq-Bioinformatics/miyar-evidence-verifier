// Optional scene metadata for Replit workspace integrations. When the
// workspace's scene controls are enabled for this project, a viewer's click on
// a scene segment scopes their next chat request to that scene's source file.
// Fill one entry per SCENE_DURATIONS key in VideoTemplate.tsx only when a
// skill reference asks for it; otherwise leave the map empty. Scenes missing
// from the map still play and can be jumped to.
//
// Example:
//   export const SCENE_DETAILS: Record<string, SceneDetails> = {
//     open: { title: 'Intro', filePath: 'src/components/video/video_scenes/Scene1.tsx' },
//   };

export interface SceneDetails {
  title: string;
  filePath: string;
}

export const SCENE_DETAILS: Record<string, SceneDetails> = {
  problem: { title: 'Reference is not proof', filePath: 'src/components/video/FilmScenes.tsx' },
  gaps: { title: 'Real verification gaps', filePath: 'src/components/video/FilmScenes.tsx' },
  intro: { title: 'MIYAR introduction', filePath: 'src/components/video/FilmScenes.tsx' },
  input: { title: 'Live verification input', filePath: 'src/components/video/FilmScenes.tsx' },
  claim: { title: 'Claim extraction result', filePath: 'src/components/video/FilmScenes.tsx' },
  evidence: { title: 'Source and locator', filePath: 'src/components/video/FilmScenes.tsx' },
  relationship: { title: 'Evidence relation', filePath: 'src/components/video/FilmScenes.tsx' },
  workflow: { title: 'Verification workflow', filePath: 'src/components/video/FilmScenes.tsx' },
  outcomes: { title: 'Actual result states', filePath: 'src/components/video/FilmScenes.tsx' },
  interface: { title: 'One traceable interface', filePath: 'src/components/video/FilmScenes.tsx' },
  specialist: { title: 'Human expertise', filePath: 'src/components/video/FilmScenes.tsx' },
  closing: { title: 'Final lockup', filePath: 'src/components/video/FilmScenes.tsx' },
};
