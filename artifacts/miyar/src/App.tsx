import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ArrowLeft, ArrowUpLeft, FileCheck2, LoaderCircle } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';

type ClaimStatus = 'supported' | 'insufficient' | 'mismatch' | 'needs_review';
type Evidence = {
  sourceTitle: string;
  locator: string;
  excerpt: string;
  url: string | null;
};
type Claim = {
  id: string;
  text: string;
  status: ClaimStatus;
  reason: string;
  domain: string;
  evidence: Evidence[];
};
type VerificationResponse = {
  status: 'COMPLETE';
  originalContent: string;
  summary: string;
  claims: Claim[];
  counts: {
    supported: number;
    insufficient: number;
    mismatch: number;
    needsReview: number;
  };
};

const STATUS: Record<ClaimStatus, { label: string; color: string; bg: string }> = {
  supported: { label: 'موثق', color: '#286b4d', bg: '#e9f1eb' },
  insufficient: { label: 'الدليل غير كافٍ', color: '#946526', bg: '#f5eddf' },
  mismatch: { label: 'تعارض في الإحالة', color: '#a44338', bg: '#f5e9e6' },
  needs_review: { label: 'يحتاج مراجعة بشرية', color: '#536c78', bg: '#e9eff0' },
};

type SourceFamily = {
  title: string;
  source: string;
  available: boolean;
  statusLabel?: string;
  href: string | null;
  scope: string;
  limit: string;
};

const sourceFamilies: SourceFamily[] = [
  { title: 'القرآن الكريم', source: 'نص Tanzil العربي — محلي', available: true, href: 'https://tanzil.net', scope: 'نص الآيات وأرقام السور والآيات.', limit: 'لا يثبت التفسير أو تنزيل الآية على واقعة بعينها بمجرد ورود النص.' },
  { title: 'التفسير', source: 'QuranEnc — المختصر في تفسير القرآن الكريم', available: true, statusLabel: 'متصل خارجيًا', href: 'https://quranenc.com/ar/browse/arabic_mokhtasar', scope: 'التفسير الموجز المرتبط بآية قرآنية محددة.', limit: 'هذا ليس جامع البيان للطبري؛ وشرح آية بعينها لا يثبت تلقائيًا ادعاءً أوسع.' },
  { title: 'الحديث', source: 'جامع خادم الحرمين الشريفين للسنة النبوية المطهرة', available: false, href: 'https://sunna.alifta.gov.sa', scope: 'نص الحديث وتخريجه وحكمه حيث يتوفر.', limit: 'وجود الرواية لا يكفي وحده للحكم بصحتها؛ العزو والحكم متعلقان بالمصدر المحدد.' },
  { title: 'العقيدة', source: 'كتاب السنة لعبدالله بن أحمد بن حنبل', available: false, href: null, scope: 'النصوص والتقريرات في أبواب الاعتقاد.', limit: 'تختلف المصطلحات والمناهج؛ يجب نسبة القول إلى مصدره وسياقه.' },
  { title: 'الفقه', source: 'مختصر القدوري — الفقه الحنفي', available: false, href: null, scope: 'الأقوال الفقهية المنقولة ومظانها.', limit: 'لا يُفهم النقل على أنه قول متفق عليه؛ قد تتعدد المذاهب والروايات.' },
  { title: 'السيرة', source: 'سيرة ابن هشام', available: false, href: null, scope: 'الأخبار والوقائع كما أوردتها المصادر.', limit: 'إيراد الخبر تاريخيًا لا يعني تصحيحه أو ثبوت جميع تفاصيله.' },
  { title: 'الشبهات', source: 'منصة بينات للرد على الشبهات', available: false, href: null, scope: 'الردود المنشورة على الشبهات المحددة.', limit: 'ينبغي عرض الشبهة والجواب في سياقهما وعدم تعميمهما على مسائل أخرى.' },
  { title: 'المصطلحات', source: 'قاموس المحتوى الإسلامي — الجمهرة', available: false, href: null, scope: 'التعريفات والمصطلحات الواردة في المحتوى الإسلامي.', limit: 'التعريف لا يحسم وحده الخلاف في الاستعمال أو الحكم.' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validEvidence(value: unknown): value is Evidence {
  return isRecord(value) &&
    typeof value.sourceTitle === 'string' &&
    typeof value.locator === 'string' &&
    typeof value.excerpt === 'string' &&
    (typeof value.url === 'string' || value.url === null);
}
function validClaim(value: unknown): value is Claim {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    typeof value.reason === 'string' &&
    typeof value.domain === 'string' &&
    ['supported', 'insufficient', 'mismatch', 'needs_review'].includes(String(value.status)) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(validEvidence);
}
function validResponse(value: unknown): value is VerificationResponse {
  if (!isRecord(value) || value.status !== 'COMPLETE' ||
    typeof value.originalContent !== 'string' ||
    typeof value.summary !== 'string' ||
    !Array.isArray(value.claims) ||
    !value.claims.every(validClaim)) return false;
  const counts = value.counts;
  if (!isRecord(counts)) return false;
  return ['supported', 'insufficient', 'mismatch', 'needsReview'].every(
    (key) => typeof counts[key] === 'number' && Number.isFinite(counts[key]),
  );
}

function Header({ current }: { current: string }) {
  return (
    <header className="topbar">
      <div className="nav-inner">
        <Link href="/" className="brand" aria-label="مِعيار — الصفحة الرئيسية">
          <span className="brand-mark"><span>م</span></span>
          <span><span className="brand-name">مِعيار</span><span className="brand-caption">تحقّق من النص قبل نشره</span></span>
        </Link>
        <nav className="nav-links" aria-label="التنقل الرئيسي">
          <Link href="/" aria-current={current === '/' ? 'page' : undefined}>الرئيسية</Link>
          <Link href="/verify" aria-current={current === '/verify' ? 'page' : undefined} className={current === '/verify' ? 'nav-cta' : ''}>تحقق من محتوى</Link>
          <Link href="/sources" aria-current={current === '/sources' ? 'page' : undefined}>المصادر</Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <span>مِعيار — أداة مساعدة للتحقق من النقول الإسلامية</span>
        <span>مِعيار أداة مساعدة للتحقق من الأدلة والإحالات، ولا يستبدل المختص عند الحاجة إلى حكم شرعي شخصي أو مراجعة علمية متخصصة.</span>
      </div>
    </footer>
  );
}

function Shell({ children, current }: { children: ReactNode; current: string }) {
  return <div className="site-shell"><Header current={current} />{children}<Footer /></div>;
}

function Home() {
  return (
    <Shell current="/">
      <main>
        <section className="wrap home-hero">
          <div className="home-copy-wrap">
            <div className="eyebrow">للمحرر الذي يراجع قبل أن ينشر</div>
            <h1 className="home-title">مِعيار</h1>
            <h2 className="hero-subtitle">منصة لضمان جودة المحتوى الإسلامي قبل النشر</h2>
            <p className="hero-copy">يحلل مِعيار المحتوى إلى ادعاءات قابلة للتحقق، ثم يربط كل ادعاء بالمصدر والدليل المناسب، ويوضح ما تدعمه المصادر وما يحتاج إلى مزيد من التحقق أو المراجعة.</p>
            <div className="hero-actions">
              <Link href="/verify" className="button-primary">تحقق من محتوى <ArrowLeft size={16} strokeWidth={1.8} /></Link>
              <Link href="/sources" className="text-link">استعرض المصادر</Link>
            </div>
            <p className="hero-note">لا حساب. لا حفظ للنصوص. تحقّق مباشر في الصفحة.</p>
          </div>
          <div className="hero-visual" aria-label="شعار مِعيار">
            <span className="orbit-label orbit-top">الدليل قبل الاستنتاج</span>
            <span className="orbit-label orbit-bottom">كل ادعاء على حدة</span>
            <div className="seal">
              <div className="seal-mark"><span>م</span></div>
              <span className="seal-label">ميزان النقول</span>
              <span className="seal-word">مِعيار</span>
            </div>
          </div>
        </section>

        <section className="principles">
          <div className="wrap">
            <div className="principles-head">
              <h2>تحقق محدد، لا فتوى ولا إعادة صياغة</h2>
              <p>الدليل أولًا، مع توضيح حدود كل نتيجة.</p>
            </div>
            <div className="principle-list">
              <article className="principle"><span className="principle-num">01 / خريطة الدليل</span><h3>ربط الادعاء بمصدره</h3><p>تربط كل ادعاء بالمصدر والموضع والدليل المرتبط به.</p></article>
              <article className="principle"><span className="principle-num">02 / فجوة الدليل</span><h3>بيان ما لا يكفي</h3><p>توضح متى لا تكفي الأدلة المتاحة لإثبات الادعاء.</p></article>
              <article className="principle"><span className="principle-num">03 / تعارض الإحالة</span><h3>كشف تعارض الإحالة</h3><p>تكشف الحالات التي لا تطابق فيها الإحالة أو الرقم الادعاء المذكور.</p></article>
              <article className="principle"><span className="principle-num">04 / حالة الدليل</span><h3>حالة واضحة للدليل</h3><p>تميّز بين ما تؤيده المصادر وما يحتاج إلى مزيد من التحقق أو المراجعة.</p></article>
            </div>
            <p className="principles-highlight">لا يكفي وجود مرجع؛ المهم أن يثبت المرجع الادعاء نفسه.</p>
          </div>
        </section>

        <section className="wrap home-method">
          <div className="section-intro">
            <div><div className="eyebrow">طريقة العمل</div><h2>من النص إلى نتيجة مفهومة</h2></div>
            <p>مِعيار أداة للمراجعة الأولية تساعد الناشر على فحص النقول قبل اعتمادها.</p>
          </div>
          <div className="steps">
            <article className="step"><span className="step-num">الخطوة ١</span><h3>ألصق النص</h3><p>أرسل المقطع كما هو، حتى يبقى الأصل محفوظاً كما وصل.</p></article>
            <article className="step"><span className="step-num">الخطوة ٢</span><h3>راجع الادعاءات</h3><p>تظهر نتيجة منفصلة لكل ادعاء، مع بيان سببها ومجالها.</p></article>
            <article className="step"><span className="step-num">الخطوة ٣</span><h3>افحص الإحالة</h3><p>اقرأ الدليل في سياقه، وراجع أهل الاختصاص عند الحاجة.</p></article>
          </div>
        </section>
        <section className="home-bottom">
          <div className="wrap bottom-inner">
            <div><h2>ابدأ من النص الذي بين يديك.</h2><p>مِعيار لا يكتب المحتوى بدل المستخدم؛ بل يتحقق مما سيُنشر.</p></div>
            <Link href="/verify" className="button-primary">تحقق من محتوى <ArrowLeft size={16} /></Link>
          </div>
        </section>
      </main>
    </Shell>
  );
}

function VerifyPage() {
  const [content, setContent] = useState('');
  const [result, setResult] = useState<VerificationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const resultsRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (result) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const original = content;
    if (!original.trim() || loading) return;
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/verify/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: original }),
      });
      if (!response.ok) {
        if (response.status >= 500) throw new Error('تعذّر الوصول إلى خدمة التحقق الآن. حاول مرة أخرى بعد قليل.');
        throw new Error('لم يكتمل التحقق من النص. راجع المدخل وحاول مجدداً.');
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('وصلت استجابة غير مكتملة. حاول التحقق مرة أخرى.');
      }
      if (!validResponse(payload)) throw new Error('تعذّر قراءة نتيجة التحقق. حاول مرة أخرى.');
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الاتصال بخدمة التحقق. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell current="/verify">
      <main className="wrap">
        <section className="page-head">
          <div className="eyebrow">تحقق مباشر، بلا حفظ</div>
          <h1>تحقق من محتوى</h1>
          <p>ألصق النص الذي تريد مراجعته، وسيحلله مِعيار إلى ادعاءات ويتحقق من الأدلة والمراجع المرتبطة بها.</p>
        </section>
        <div className="verify-layout">
          <form className="input-panel" onSubmit={submit}>
            <div className="input-heading">
              <h2>النص المراد التحقق منه</h2>
              <span>{content.length.toLocaleString('ar')} / ١٢٬٠٠٠ حرف</span>
            </div>
            <textarea
              className="content-input"
              dir="auto"
              value={content}
              maxLength={12000}
              onChange={(event) => setContent(event.target.value)}
              placeholder="ألصق هنا المحتوى الإسلامي المراد التحقق منه..."
              aria-label="النص المراد التحقق منه"
              data-testid="input-content"
            />
            <div className="input-footer">
              <span className="input-help">يُرسل النص إلى OpenAI للتحليل؛ ولا يحتفظ مِعيار بسجل أو تاريخ للطلبات.</span>
              <button className="submit-button" type="submit" disabled={!content.trim() || loading} data-testid="button-verify">
                {loading ? <><LoaderCircle className="animate-spin" size={17} /> جارٍ تحليل المحتوى والتحقق من الأدلة...</> : <>تحقق <ArrowLeft size={16} /></>}
              </button>
            </div>
            {error && <div className="error-box" role="alert" data-testid="error-verification">{error}</div>}
          </form>
          <aside className="verify-aside">
            <div className="side-note"><h3>كيف تقرأ النتيجة؟</h3><p>كل نتيجة تخص ادعاءً بعينه. افحص السبب والإحالة معاً، ولا تعمم حكماً على بقية النص.</p></div>
            <ul className="limits-list">
              <li>لا يصدر مِعيار فتوى أو حكماً شرعياً.</li>
              <li>عدم كفاية الدليل لا يعني ثبوت خلاف الادعاء.</li>
              <li>الإحالة لا تغني عن مراجعة المصدر في سياقه.</li>
            </ul>
          </aside>
        </div>
        {result && (
          <section className="results" ref={resultsRef} aria-live="polite" data-testid="results-verification">
            <div className="results-header">
              <div><h2>ملخص التحقق</h2><p>نتيجة آلية للمراجعة الأولية، وليست فتوى شرعية.</p></div>
              <span className="results-mark"><FileCheck2 size={14} style={{ verticalAlign: 'middle', marginLeft: 6 }} /> اكتمل فحص النص</span>
            </div>
            <div className="summary-box"><strong>خلاصة الفحص</strong><p>{result.summary}</p></div>
            <div className="counts" aria-label="ملخص عدد الادعاءات">
              <Count status="supported" count={result.counts.supported} />
              <Count status="insufficient" count={result.counts.insufficient} />
              <Count status="mismatch" count={result.counts.mismatch} />
              <Count status="needs_review" count={result.counts.needsReview} />
            </div>
            <h3 className="claims-title">نتيجة كل ادعاء ({result.claims.length.toLocaleString('ar')})</h3>
            {result.claims.map((claim, index) => {
              const meta = STATUS[claim.status];
              return (
                <article className="claim-card" key={claim.id} style={{ '--status-color': meta.color, '--status-bg': meta.bg } as CSSProperties} data-testid={`claim-result-${claim.id}`}>
                  <div className="claim-main">
                    <div className="claim-top"><span className="claim-domain">الادعاء { (index + 1).toLocaleString('ar') } · {claim.domain}</span><span className="status-tag"><span className="status-caption">الحالة:</span> {meta.label}</span></div>
                    <p className="claim-text">{claim.text}</p>
                    <p className="claim-reason"><strong>سبب النتيجة:</strong> {claim.reason}</p>
                  </div>
                  <div className="evidence-list">
                    {claim.evidence.length ? claim.evidence.map((evidence, evidenceIndex) => (
                      <div className="evidence" key={`${claim.id}-${evidenceIndex}`}>
                        <div className="evidence-head"><strong>المصدر: {evidence.sourceTitle}</strong><span className="evidence-locator">الموضع: {evidence.locator}</span></div>
                        <p><strong>الدليل:</strong> {evidence.excerpt}</p>
                        {evidence.url && <a href={evidence.url} target="_blank" rel="noreferrer">فتح المصدر <ArrowUpLeft size={12} style={{ verticalAlign: 'middle' }} /></a>}
                      </div>
                    )) : <div className="no-evidence">لم يجد مِعيار دليلًا كافيًا للتحقق من هذا الادعاء ضمن المصادر المتاحة.</div>}
                  </div>
                </article>
              );
            })}
            <section className="original-content" aria-label="المحتوى محل التحقق">
              <h3>المحتوى محل التحقق</h3>
              <p dir="auto">{result.originalContent}</p>
            </section>
          </section>
        )}
      </main>
    </Shell>
  );
}

function Count({ status, count }: { status: ClaimStatus; count: number }) {
  const meta = STATUS[status];
  return <span className="count-pill" style={{ '--status-color': meta.color } as CSSProperties}><span className="count-dot" />{meta.label}<strong>{count.toLocaleString('ar')}</strong></span>;
}

function SourcesPage() {
  return (
    <Shell current="/sources">
      <main className="wrap">
        <section className="page-head">
          <div className="eyebrow">المراجع وحدود الاستدلال</div>
          <h1>ما الذي يمكن للمصدر أن يثبته؟</h1>
          <p>يعرض مِعيار نطاق المصدر وحدود استخدامه. نص Tanzil المحلي وتفسير QuranEnc موصولان؛ وتبقى بقية المصادر قيد الربط كما هي.</p>
        </section>
        <section className="source-intro">
          <p>تظهر حالة كل مصدر بوضوح؛ لا تُعرض المصادر قيد الربط على أنها أدلة مستخدمة في نتيجة التحقق.</p>
          <span className="source-index">٠٨ / عائلات المصادر</span>
        </section>
        <section className="source-grid" aria-label="عائلات المصادر وحدودها">
          {sourceFamilies.map((source, index) => (
            <article className="source-item" key={source.title} data-testid={`source-family-${index + 1}`}>
              <div className="source-item-top"><span className="source-num">{String(index + 1).padStart(2, '0')}</span><span className={`source-scope-label ${source.available ? 'source-online' : 'source-pending'}`}>{source.available ? (source.statusLabel ?? 'متصل محليًا') : 'قيد الربط في النسخة الحالية'}</span></div>
              <h2>{source.title}</h2>
              <p><strong>المصدر:</strong> {source.source}</p>
              <p><strong>نطاق الاستخدام:</strong> {source.scope}</p>
              <p><strong>حدود المصدر:</strong> {source.limit}</p>
              {source.href && <a className="source-link" href={source.href} target="_blank" rel="noreferrer">فتح المصدر <ArrowUpLeft size={12} style={{ verticalAlign: 'middle' }} /></a>}
            </article>
          ))}
        </section>
        <aside className="sources-caveat">
          <span className="caveat-symbol">!</span>
          <div><h3>الإحالة ليست حكماً نهائياً</h3><p>وجود نص في مصدر ما لا يثبت تلقائياً صحة نسبته أو صحة كل تفسير واستنتاج مبني عليه. عند اختلاف الروايات أو الأقوال، يلزم الرجوع إلى المصدر كاملاً وسياقه، واستشارة أهل الاختصاص.</p></div>
        </aside>
      </main>
    </Shell>
  );
}

function Router() {
  const [location] = useLocation();
  return (
    <ErrorBoundary resetKey={location}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/verify" component={VerifyPage} />
        <Route path="/sources" component={SourcesPage} />
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

function App() {
  return <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter>;
}

export default App;
