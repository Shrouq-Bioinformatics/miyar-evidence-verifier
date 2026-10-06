export const SCENE_DURATIONS = {
  problem: 6430,
  gaps: 6500,
  intro: 3220,
  input: 4770,
  claim: 2860,
  evidence: 3060,
  relationship: 3290,
  workflow: 13500,
  outcomes: 10440,
  interface: 12310,
  specialist: 5360,
  closing: 7150,
} as const;

export type FilmSceneKey = keyof typeof SCENE_DURATIONS;

type CaptionCue = {
  start: number;
  end: number;
  text: string;
};

export const CAPTIONS: Record<FilmSceneKey, CaptionCue[]> = {
  problem: [
    {
      start: 0,
      end: 6430,
      text: 'في المحتوى الإسلامي، وجود مرجع لا يعني بالضرورة أن الدليل يثبت الادعاء نفسه.',
    },
  ],
  gaps: [
    { start: 0, end: 2470, text: 'فقد تكون الإحالة غير دقيقة،' },
    {
      start: 2470,
      end: 4950,
      text: 'أو يكون الدليل مرتبطًا بالموضوع لكنه غير كافٍ،',
    },
    {
      start: 4950,
      end: 6500,
      text: 'أو يكون نطاق المصدر أضيق من الكلام المنشور.',
    },
  ],
  intro: [
    {
      start: 0,
      end: 3220,
      text: 'لهذا طورنا مِعيار، منصة لضمان جودة المحتوى الإسلامي قبل النشر.',
    },
  ],
  input: [
    { start: 0, end: 1540, text: 'يبدأ مِعيار من المحتوى الموجود...' },
    { start: 1540, end: 4770, text: 'فيحلله إلى ادعاءات قابلة للتحقق' },
  ],
  claim: [
    { start: 360, end: 2460, text: 'ثم يوجه كل ادعاء إلى المصدر المناسب' },
  ],
  evidence: [
    { start: 0, end: 3060, text: 'ويسترجع الدليل والموضع المرتبط به' },
  ],
  relationship: [
    { start: 0, end: 3290, text: 'ثم يقيم علاقة الدليل بالادعاء.' },
  ],
  workflow: [
    {
      start: 0,
      end: 2510,
      text: 'يوظف مِعيار الذكاء الاصطناعي في فهم المحتوى،',
    },
    { start: 2870, end: 5080, text: 'واستخراج الادعاءات،' },
    { start: 5380, end: 8280, text: 'وتحديد المجال المناسب،' },
    { start: 8700, end: 9980, text: 'وتوجيه البحث،' },
    { start: 10350, end: 11830, text: 'وتوضيح نتيجة التحقق،' },
    { start: 12210, end: 13500, text: 'بلغة عربية واضحة.' },
  ],
  outcomes: [
    { start: 0, end: 2980, text: 'والنتيجة ليست مجرد إجابة؛' },
    { start: 3340, end: 3940, text: 'بل خريطة للدليل،' },
    { start: 4210, end: 5320, text: 'وفجوة لما لم يثبت،' },
    { start: 5690, end: 6740, text: 'وكشف لتعارض الإحالة،' },
    { start: 7030, end: 8580, text: 'مع إحالة للمراجعة البشرية' },
    { start: 8580, end: 10140, text: 'عند الحاجة.' },
  ],
  interface: [
    { start: 0, end: 2190, text: 'من خلال واجهة واحدة،' },
    { start: 2550, end: 3940, text: 'يلصق المستخدم النص' },
    { start: 4310, end: 6920, text: 'ويضغط تحقق،' },
    {
      start: 7260,
      end: 11950,
      text: 'ليظهر أمامه كل ادعاء وحالته والمصدر والموضع وسبب النتيجة.',
    },
  ],
  specialist: [
    { start: 0, end: 2160, text: 'مِعيار لا يستبدل المختص،' },
    {
      start: 2160,
      end: 3937,
      text: 'لكنه يجعل التحقق خطوة واضحة وقابلة للتتبع',
    },
    { start: 4213, end: 4998, text: 'قبل النشر.' },
  ],
  closing: [
    { start: 0, end: 1840, text: 'مِعيار…' },
    { start: 2221, end: 3779, text: 'التحقق خطوة قبل النشر،' },
    { start: 3961, end: 6727, text: 'لا بعد انتشار المحتوى.' },
  ],
};

export function filmAsset(relativePath: string): string {
  return `${import.meta.env.BASE_URL}assets/${relativePath}`;
}
