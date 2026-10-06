import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { useSceneTimer } from '@/lib/video';

import {
  CAPTIONS,
  filmAsset,
  type FilmSceneKey,
} from './filmData';

interface FilmSceneProps {
  sceneKey: FilmSceneKey;
}

function CaptionTrack({ sceneKey }: FilmSceneProps): ReactElement {
  const cues = CAPTIONS[sceneKey];
  const [caption, setCaption] = useState(
    () => cues.find((cue) => cue.start === 0)?.text ?? '',
  );
  const events = useMemo(
    () =>
      cues.flatMap((cue) => [
        { time: cue.start, callback: () => setCaption(cue.text) },
        { time: cue.end, callback: () => setCaption('') },
      ]),
    [cues],
  );

  useSceneTimer(events);

  return (
    <div className="caption-band" dir="rtl" aria-live="off">
      <AnimatePresence mode="wait">
        {caption && (
          <motion.p
            key={`${sceneKey}-${caption}`}
            className="film-caption"
            initial={{ opacity: 0, y: 9 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {caption}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilmStage({
  sceneKey,
  className,
  children,
}: FilmSceneProps & {
  className: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className={`film-stage ${className}`} dir="rtl">
      <div className="film-screen">{children}</div>
      <CaptionTrack sceneKey={sceneKey} />
    </section>
  );
}

function ScreenImage({
  file,
  alt,
  className = '',
  position = 'center',
}: {
  file: string;
  alt: string;
  className?: string;
  position?: string;
}): ReactElement {
  return (
    <img
      className={`screen-capture ${className}`}
      src={filmAsset(`screens/${file}`)}
      alt={alt}
      style={{ objectPosition: position }}
      draggable={false}
    />
  );
}

function ProblemScene(): ReactElement {
  const [focus, setFocus] = useState<'claim' | 'reference' | 'gap'>('claim');
  const events = useMemo(
    () => [
      { time: 1450, callback: () => setFocus('reference' as const) },
      { time: 3400, callback: () => setFocus('gap' as const) },
    ],
    [],
  );
  useSceneTimer(events);

  return (
    <FilmStage sceneKey="problem" className="scene-problem">
      <div className="problem-board">
        <motion.article
          className={`problem-card focus-${focus}`}
          initial={{ opacity: 0, x: 28, y: 6 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          transition={{ duration: 0.58, ease: [0.2, 0.75, 0.2, 1] }}
        >
          <div className="problem-label">الادعاء</div>
          <p className="problem-claim">
            حديث «إنما الأعمال بالنيات» رواه البخاري برقم 999999.
          </p>
          <div className="reference-row">
            <span className="reference-label">المرجع</span>
            <span>رواه البخاري برقم 999999</span>
          </div>
          <div className="gap-rule" aria-hidden="true">
            <span />
          </div>
          <motion.div
            className="not-proof"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: focus === 'gap' ? 1 : 0, y: focus === 'gap' ? 0 : 8 }}
            transition={{ duration: 0.3 }}
          >
            وجود المرجع ≠ إثبات الادعاء
          </motion.div>
        </motion.article>
      </div>
    </FilmStage>
  );
}

const GAP_IMAGES = [
  { file: 'mismatch.jpg', alt: 'نتيجة فعلية: تعارض في الإحالة' },
  { file: 'insufficient.jpg', alt: 'نتيجة فعلية: الدليل غير كافٍ' },
  { file: 'insufficient.jpg', alt: 'تفصيل النطاق في نتيجة فعلية: الدليل غير كافٍ' },
] as const;

function GapsScene(): ReactElement {
  const [frame, setFrame] = useState(0);
  const events = useMemo(
    () => [
      { time: 2470, callback: () => setFrame(1) },
      { time: 4950, callback: () => setFrame(2) },
    ],
    [],
  );
  useSceneTimer(events);

  return (
    <FilmStage sceneKey="gaps" className="scene-gaps">
      <AnimatePresence mode="wait">
        <motion.div
          key={frame}
          className={`capture-wrap gap-capture gap-capture-${frame}`}
          initial={{ opacity: 0, scale: 1.015 }}
          animate={{ opacity: 1, scale: frame === 2 ? 1.045 : 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: 'easeOut' }}
        >
          <ScreenImage file={GAP_IMAGES[frame].file} alt={GAP_IMAGES[frame].alt} />
          {frame === 2 && <div className="scope-focus" aria-hidden="true" />}
        </motion.div>
      </AnimatePresence>
    </FilmStage>
  );
}

function IntroScene(): ReactElement {
  const [showHome, setShowHome] = useState(false);
  const events = useMemo(
    () => [{ time: 520, callback: () => setShowHome(true) }],
    [],
  );
  useSceneTimer(events);

  return (
    <FilmStage sceneKey="intro" className="scene-intro">
      <AnimatePresence mode="wait">
        {showHome ? (
          <motion.div
            key="home"
            className="capture-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32 }}
          >
            <ScreenImage file="home-live.jpg" alt="الصفحة الرئيسية الفعلية لمِعيار" />
          </motion.div>
        ) : (
          <motion.div
            key="logo"
            className="intro-logo"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.06 }}
            transition={{ duration: 0.38, ease: 'easeOut' }}
          >
            <img src={filmAsset('miyar-logo.png')} alt="شعار مِعيار" />
          </motion.div>
        )}
      </AnimatePresence>
    </FilmStage>
  );
}

function InputScene(): ReactElement {
  const [phase, setPhase] = useState<'typing' | 'loading' | 'result'>('typing');
  const events = useMemo(
    () => [{ time: 2700, callback: () => setPhase('result' as const) }],
    [],
  );
  useSceneTimer(events);

  return (
    <FilmStage sceneKey="input" className="scene-input">
      <AnimatePresence mode="wait">
        {phase === 'typing' ? (
          <motion.video
            key="typing"
            className="screen-capture"
            src={filmAsset('screens/verification-flow.mp4')}
            poster={filmAsset('screens/verify-empty-live.jpg')}
            autoPlay
            muted
            playsInline
            preload="auto"
            onEnded={() => setPhase('loading')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          />
        ) : phase === 'loading' ? (
          <motion.img
            key="loading"
            className="screen-capture"
            src={filmAsset('screens/loading-real.jpg')}
            alt="حالة التحميل الفعلية في مِعيار"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          />
        ) : (
          <motion.div
            key="result"
            className="capture-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
          >
            <ScreenImage
              file="supported-main.jpg"
              alt="نتيجة التحقق الفعلية لآية سورة النحل"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </FilmStage>
  );
}

function ClaimScene(): ReactElement {
  return (
    <FilmStage sceneKey="claim" className="scene-claim">
      <ScreenImage
        file="supported-main.jpg"
        alt="الادعاء وحالته في نتيجة مِعيار الفعلية"
      />
      <motion.div
        className="claim-focus"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        aria-hidden="true"
      />
    </FilmStage>
  );
}

function EvidenceScene(): ReactElement {
  return (
    <FilmStage sceneKey="evidence" className="scene-evidence">
      <ScreenImage
        file="supported-evidence.jpg"
        alt="الدليل والموضع الفعليان في نتيجة مِعيار"
      />
      <motion.aside
        className="source-callout"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, delay: 0.12 }}
        dir="rtl"
      >
        <span>المصدر كما ورد في نتيجة مِعيار</span>
        <strong>القرآن الكريم — Tanzil</strong>
      </motion.aside>
      <div className="locator-focus" aria-hidden="true" />
    </FilmStage>
  );
}

function RelationshipScene(): ReactElement {
  return (
    <FilmStage sceneKey="relationship" className="scene-relationship">
      <ScreenImage
        file="supported-main.jpg"
        alt="الادعاء والدليل والحالة الفعلية في مِعيار"
      />
      <svg
        className="relation-line"
        viewBox="0 0 1920 900"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M 292 390 L 340 390 M 292 390 L 292 645 L 340 645" />
        <path d="M 292 390 L 292 500 L 340 500" className="relation-branch" />
      </svg>
    </FilmStage>
  );
}

const WORKFLOW_STEPS = [
  { label: 'المحتوى', file: 'supported-main.jpg', focus: 'focus-content' },
  { label: 'الادعاء', file: 'supported-main.jpg', focus: 'focus-claim' },
  { label: 'المجال', file: 'supported-main.jpg', focus: 'focus-domain' },
  { label: 'المصدر والدليل', file: 'supported-evidence.jpg', focus: 'focus-source' },
  { label: 'الحالة', file: 'supported-main.jpg', focus: 'focus-status' },
] as const;

function WorkflowScene(): ReactElement {
  const [step, setStep] = useState(0);
  const events = useMemo(
    () => [
      { time: 2870, callback: () => setStep(1) },
      { time: 5380, callback: () => setStep(2) },
      { time: 8700, callback: () => setStep(3) },
      { time: 10350, callback: () => setStep(4) },
    ],
    [],
  );
  useSceneTimer(events);
  const current = WORKFLOW_STEPS[step];

  return (
    <FilmStage sceneKey="workflow" className="scene-workflow">
      <ScreenImage
        file={current.file}
        alt={`واجهة مِعيار الفعلية: ${current.label}`}
        className="workflow-image"
      />
      <motion.div
        key={current.focus}
        className={`workflow-focus ${current.focus}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
        aria-hidden="true"
      />
      <motion.div
        key={current.label}
        className="workflow-chip"
        initial={{ opacity: 0, y: 7 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        dir="rtl"
      >
        {current.label}
      </motion.div>
    </FilmStage>
  );
}

function OutcomesScene(): ReactElement {
  const [frame, setFrame] = useState(0);
  const frames = [
    { file: 'supported-main.jpg', alt: 'نتيجة فعلية: موثق', focus: 'outcome-supported' },
    {
      file: 'insufficient.jpg',
      alt: 'نتيجة فعلية: الدليل غير كافٍ',
      focus: 'outcome-insufficient',
    },
    {
      file: 'mismatch.jpg',
      alt: 'نتيجة فعلية: تعارض في الإحالة',
      focus: 'outcome-mismatch',
    },
    {
      file: 'supported-main.jpg',
      alt: 'ملخص فعلي مع صفر في المراجعة البشرية',
      focus: 'outcome-review-zero',
    },
  ] as const;
  const events = useMemo(
    () => [
      { time: 4210, callback: () => setFrame(1) },
      { time: 5690, callback: () => setFrame(2) },
      { time: 7030, callback: () => setFrame(3) },
    ],
    [],
  );
  useSceneTimer(events);
  const current = frames[frame];

  return (
    <FilmStage sceneKey="outcomes" className="scene-outcomes">
      <AnimatePresence mode="wait">
        <motion.div
          key={frame}
          className="capture-wrap"
          initial={{ opacity: 0, scale: 1.01 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.26 }}
        >
          <ScreenImage file={current.file} alt={current.alt} />
        </motion.div>
      </AnimatePresence>
      <div className={`outcome-focus ${current.focus}`} aria-hidden="true" />
    </FilmStage>
  );
}

function InterfaceScene(): ReactElement {
  const [showHistory, setShowHistory] = useState(false);
  const [focus, setFocus] = useState(-1);
  const events = useMemo(
    () => [
      { time: 1930, callback: () => setShowHistory(true) },
      { time: 3530, callback: () => setShowHistory(false) },
      { time: 7260, callback: () => setFocus(0) },
      { time: 8600, callback: () => setFocus(1) },
      { time: 9600, callback: () => setFocus(2) },
      { time: 10300, callback: () => setFocus(3) },
      { time: 11000, callback: () => setFocus(4) },
    ],
    [],
  );
  useSceneTimer(events);
  const focusClass = [
    'walkthrough-claim',
    'walkthrough-status',
    'walkthrough-source',
    'walkthrough-locator',
    'walkthrough-reason',
  ][focus];

  return (
    <FilmStage sceneKey="interface" className="scene-interface">
      <AnimatePresence mode="wait">
        {showHistory ? (
          <motion.div
            key="history"
            className="capture-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <ScreenImage file="history-live.jpg" alt="سجل مِعيار الفعلي بعد الاختبارات" />
          </motion.div>
        ) : (
          <motion.div
            key="result"
            className="capture-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <ScreenImage
              file="supported-main.jpg"
              alt="نتيجة التحقق الكاملة والفعلية في مِعيار"
            />
          </motion.div>
        )}
      </AnimatePresence>
      {focusClass && !showHistory && (
        <motion.div
          key={focusClass}
          className={`walkthrough-focus ${focusClass}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          aria-hidden="true"
        />
      )}
    </FilmStage>
  );
}

function SpecialistScene(): ReactElement {
  return (
    <FilmStage sceneKey="specialist" className="scene-specialist">
      <ScreenImage
        file="supported-main.jpg"
        alt="نتيجة فعلية قابلة للتتبع داخل مِعيار"
      />
      <svg
        className="relation-line specialist-line"
        viewBox="0 0 1920 900"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M 284 392 L 342 392 M 284 392 L 284 645 L 342 645" />
      </svg>
    </FilmStage>
  );
}

function ClosingScene(): ReactElement {
  return (
    <FilmStage sceneKey="closing" className="scene-closing">
      <motion.div
        className="closing-lockup"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
        dir="rtl"
      >
        <img src={filmAsset('miyar-logo.png')} alt="مِعيار" draggable={false} />
        <p className="closing-line">التحقق خطوة قبل النشر</p>
        <p className="closing-subline">لا بعد انتشار المحتوى</p>
      </motion.div>
    </FilmStage>
  );
}

const SCENE_COMPONENTS: Record<FilmSceneKey, () => ReactElement> = {
  problem: ProblemScene,
  gaps: GapsScene,
  intro: IntroScene,
  input: InputScene,
  claim: ClaimScene,
  evidence: EvidenceScene,
  relationship: RelationshipScene,
  workflow: WorkflowScene,
  outcomes: OutcomesScene,
  interface: InterfaceScene,
  specialist: SpecialistScene,
  closing: ClosingScene,
};

export function FilmScene({ sceneKey }: FilmSceneProps): ReactElement {
  const Scene = SCENE_COMPONENTS[sceneKey];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        className="film-scene"
        key={sceneKey}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: sceneKey === 'closing' ? 0.4 : 0.22 }}
      >
        <Scene />
      </motion.div>
    </AnimatePresence>
  );
}

