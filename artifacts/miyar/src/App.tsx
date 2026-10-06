import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ArrowLeft, ArrowUpLeft, FileCheck2, LoaderCircle, Trash2 } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';
import miyarLogo from '@assets/0_image-10-1_1791311050480.png';

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
type HistoryRecord = {
  id: string;
  originalContent: string;
  createdAt: string;
  resultSummary: string;
  counts: VerificationResponse['counts'];
  claims: Claim[];
};
const HISTORY_KEY = 'miyar_verification_history';
const HISTORY_LIMIT = 30;

function readHistory(): HistoryRecord[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is HistoryRecord => {
      if (!isRecord(value) || typeof value.id !== 'string' ||
        typeof value.originalContent !== 'string' || typeof value.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(value.createdAt)) ||
        typeof value.resultSummary !== 'string' || !Array.isArray(value.claims) ||
        !value.claims.every(validClaim) || !isRecord(value.counts)) return false;
      const counts = value.counts;
      return ['supported', 'insufficient', 'mismatch', 'needsReview'].every((key) =>
        typeof counts[key] === 'number' && Number.isFinite(counts[key]));
    }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}
function saveHistoryRecord(result: VerificationResponse) {
  try {
    const next: HistoryRecord[] = [{
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      originalContent: result.originalContent,
      createdAt: new Date().toISOString(),
      resultSummary: result.summary,
      counts: result.counts,
      claims: result.claims,
    }, ...readHistory()].slice(0, HISTORY_LIMIT);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // History is optional; keep successful verification independent from storage.
  }
}

const STATUS: Record<ClaimStatus, { label: string; color: string; bg: string }> = {
  supported: { label: 'موثق', color: '#286b4d', bg: '#e9f1eb' },
  insufficient: { label: 'الدليل غير كافٍ', color: '#946526', bg: '#f5eddf' },
  mismatch: { label: 'تعارض في الإحالة', color: '#a44338', bg: '#f5e9e6' },
  needs_review: { label: 'يحتاج مراجعة بشرية', color: '#536c78', bg: '#e9eff0' },
};

type SourceFamily = {
  title: string;
  domain: string;
  available: boolean;
};

const sourceFamilies: SourceFamily[] = [
  { title: 'القرآن الكريم — Tanzil', domain: 'القرآن', available: true },
  { title: 'المختصر في تفسير القرآن الكريم', domain: 'التفسير', available: true },
  { title: 'صحيح البخاري وصحيح مسلم', domain: 'الحديث', available: true },
  { title: 'كتاب السنة لعبدالله بن أحمد بن حنبل', domain: 'العقيدة', available: false },
  { title: 'مختصر القدوري', domain: 'الفقه', available: false },
  { title: 'السيرة النبوية لابن هشام', domain: 'السيرة', available: true },
  { title: 'بينات', domain: 'الشبهات', available: false },
  { title: 'قاموس المحتوى الإسلامي — الجمهرة', domain: 'المصطلحات', available: false },
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
          <img className="brand-logo" src={miyarLogo} alt="" aria-hidden="true" />
          <span className="brand-name">مِعيار</span>
        </Link>
        <nav className="nav-links" aria-label="التنقل الرئيسي">
          <Link href="/" aria-current={current === '/' ? 'page' : undefined}>الرئيسية</Link>
          <Link href="/verify" aria-current={current === '/verify' ? 'page' : undefined} className={current === '/verify' ? 'nav-cta' : ''}>تحقق من محتوى</Link>
          <Link href="/history" aria-current={current === '/history' ? 'page' : undefined}>السجل</Link>
          <Link href="/sources" aria-current={current === '/sources' ? 'page' : undefined}>المصادر</Link>
        </nav>
      </div>
    </header>
  );
}

function Shell({ children, current }: { children: ReactNode; current: string }) {
  return <div className="site-shell"><Header current={current} />{children}</div>;
}

function Home() {
  return (
    <Shell current="/">
      <main>
        <section className="wrap home-hero">
          <div className="home-copy-wrap">
            <h1 className="home-title">مِعيار</h1>
            <h2 className="hero-subtitle">منصة للتحقق من المحتوى الإسلامي ومراجعة أدلته قبل النشر.</h2>
            <div className="hero-actions">
              <Link href="/verify" className="button-primary">تحقق من محتوى <ArrowLeft size={16} strokeWidth={1.8} /></Link>
              <Link href="/sources" className="text-link">المصادر</Link>
            </div>
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
      saveHistoryRecord(payload);
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
          <h1>تحقق من محتوى</h1>
          <p>ألصق النص المراد التحقق منه، وسيعرض مِعيار الادعاءات والنتائج والأدلة المرتبطة بها.</p>
        </section>
        <div className="verify-layout">
          <form className="input-panel" onSubmit={submit}>
            <div className="input-heading">
              <h2>المحتوى</h2>
            </div>
            <textarea
              className="content-input"
              dir="auto"
              value={content}
              maxLength={12000}
              onChange={(event) => setContent(event.target.value)}
              placeholder="ألصق المحتوى هنا"
              aria-label="المحتوى"
              data-testid="input-content"
            />
            <div className="input-footer">
              <button className="submit-button" type="submit" disabled={!content.trim() || loading} data-testid="button-verify">
                {loading ? <><LoaderCircle className="animate-spin" size={17} /> جارٍ التحقق...</> : <>تحقق <ArrowLeft size={16} /></>}
              </button>
            </div>
            {error && <div className="error-box" role="alert" data-testid="error-verification">{error}</div>}
          </form>
        </div>
        {result && (
          <ResultView result={result} refElement={resultsRef} />
        )}
      </main>
    </Shell>
  );
}

function Count({ status, count }: { status: ClaimStatus; count: number }) {
  const meta = STATUS[status];
  return <span className="count-pill" style={{ '--status-color': meta.color } as CSSProperties}><span className="count-dot" />{meta.label}<strong>{count.toLocaleString('ar')}</strong></span>;
}

function publicResultText(text: string): string {
  return text
    .replace(/HadithWeb/gi, 'المصدر')
    .replace(/حديث ويب/g, 'المصدر')
    .replace(/QuranEnc/gi, 'مصدر التفسير')
    .replace(/Tanzil/gi, 'المصحف');
}

function publicSourceTitle(title: string): string {
  if (/quranenc/i.test(title)) return 'المختصر في تفسير القرآن الكريم';
  if (/tanzil/i.test(title)) return 'القرآن الكريم';
  if (/hadithweb|حديث ويب/i.test(title)) {
    return title.split(/\s+[—–-]\s+/)[0].trim() || 'المصدر';
  }
  return title;
}

function ResultView({ result, refElement }: { result: VerificationResponse; refElement?: RefObject<HTMLElement | null> }) {
  return (
    <section className="results" ref={refElement} aria-live="polite" data-testid="results-verification">
      <div className="results-header">
        <div><h2>نتيجة التحقق</h2></div>
        <span className="results-mark"><FileCheck2 size={14} style={{ verticalAlign: 'middle', marginLeft: 6 }} /> اكتمل التحقق</span>
      </div>
      <div className="summary-box"><strong>الخلاصة</strong><p>{publicResultText(result.summary)}</p></div>
      <div className="counts" aria-label="ملخص عدد الادعاءات">
        <Count status="supported" count={result.counts.supported} />
        <Count status="insufficient" count={result.counts.insufficient} />
        <Count status="mismatch" count={result.counts.mismatch} />
        <Count status="needs_review" count={result.counts.needsReview} />
      </div>
      <h3 className="claims-title">الادعاءات ({result.claims.length.toLocaleString('ar')})</h3>
      {result.claims.map((claim, index) => {
        const meta = STATUS[claim.status];
        return (
          <article className="claim-card" key={`${claim.id}-${index}`} style={{ '--status-color': meta.color, '--status-bg': meta.bg } as CSSProperties} data-testid={`claim-result-${claim.id}`}>
            <div className="claim-main">
              <div className="claim-top"><span className="claim-domain">الادعاء { (index + 1).toLocaleString('ar') } · {claim.domain}</span><span className="status-tag">{meta.label}</span></div>
              <p className="claim-text">{claim.text}</p>
              <p className="claim-reason">{publicResultText(claim.reason)}</p>
            </div>
            <div className="evidence-list">
              <strong className="evidence-section-label">الأدلة والمراجع</strong>
              {claim.evidence.length ? claim.evidence.map((evidence, evidenceIndex) => (
                <div className="evidence" key={`${claim.id}-${evidenceIndex}`}>
                  <div className="evidence-head"><strong>{publicSourceTitle(evidence.sourceTitle)}</strong><span className="evidence-locator">{publicResultText(evidence.locator)}</span></div>
                  <p>{evidence.excerpt}</p>
                  {evidence.url && <a href={evidence.url} target="_blank" rel="noreferrer">فتح المصدر <ArrowUpLeft size={12} style={{ verticalAlign: 'middle' }} /></a>}
                </div>
              )) : <div className="no-evidence">لا تتوفر أدلة مرتبطة بهذا الادعاء.</div>}
            </div>
          </article>
        );
      })}
      <section className="original-content" aria-label="المحتوى">
        <h3>المحتوى</h3>
        <p dir="auto">{result.originalContent}</p>
      </section>
    </section>
  );
}

function SourcesPage() {
  return (
    <Shell current="/sources">
      <main className="wrap">
        <section className="page-head">
          <h1>المصادر</h1>
        </section>
        <section className="source-grid" aria-label="المصادر">
          {sourceFamilies.map((source, index) => (
            <article className="source-item" key={source.title} data-testid={`source-family-${index + 1}`}>
              <h2>{source.title}</h2>
              <p><strong>المجال</strong> {source.domain}</p>
              <span className={`source-scope-label ${source.available ? 'source-online' : 'source-pending'}`}>{source.available ? 'متاح' : 'قيد الربط'}</span>
            </article>
          ))}
        </section>
      </main>
    </Shell>
  );
}

function HistoryPage() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [opened, setOpened] = useState<HistoryRecord | null>(null);
  useEffect(() => {
    const saved = readHistory();
    setRecords(saved);
    try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(saved)); } catch { /* History remains optional. */ }
  }, []);
  function persist(next: HistoryRecord[]) {
    setRecords(next);
    setOpened((current) => current && next.some((record) => record.id === current.id) ? current : null);
    try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* Keep the page usable when storage is unavailable. */ }
  }
  function clearHistory() {
    if (!records.length || !window.confirm('هل تريد مسح جميع السجلات؟')) return;
    persist([]);
  }
  const result = opened ? {
    status: 'COMPLETE' as const,
    originalContent: opened.originalContent,
    summary: opened.resultSummary,
    counts: opened.counts,
    claims: opened.claims,
  } : null;
  return (
    <Shell current="/history">
      <main className="wrap">
        <section className="page-head history-head">
          <div className="history-head-actions">
            <div><h1>السجل</h1><p className="history-note">يظهر هذا السجل على هذا الجهاز فقط.</p></div>
            <button className="button-quiet" type="button" disabled={records.length === 0} onClick={clearHistory} data-testid="button-clear-history"><Trash2 size={14} /> مسح السجل</button>
          </div>
        </section>
        {records.length ? (
          <section className="history-list" aria-label="عمليات التحقق السابقة">
            {records.map((record) => (
              <article className="history-card" key={record.id} data-testid={`history-record-${record.id}`}>
                <div>
                  <h2>{record.originalContent.trim().slice(0, 95)}{record.originalContent.trim().length > 95 ? '…' : ''}</h2>
                  <div className="history-date">{new Intl.DateTimeFormat('ar', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(record.createdAt))}</div>
                  <p className="history-summary">{publicResultText(record.resultSummary)}</p>
                  <div className="history-counts">
                    <span className="history-count">موثق: {record.counts.supported.toLocaleString('ar')}</span>
                    <span className="history-count">غير كافٍ: {record.counts.insufficient.toLocaleString('ar')}</span>
                    <span className="history-count">تعارض: {record.counts.mismatch.toLocaleString('ar')}</span>
                    <span className="history-count">للمراجعة: {record.counts.needsReview.toLocaleString('ar')}</span>
                  </div>
                </div>
                <div className="history-actions">
                  <button className="button-primary" type="button" onClick={() => { setOpened(record); window.setTimeout(() => document.getElementById('saved-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }} data-testid={`button-open-history-${record.id}`}>عرض النتيجة</button>
                  <button className="delete-button" type="button" onClick={() => persist(records.filter((item) => item.id !== record.id))} data-testid={`button-delete-history-${record.id}`}>حذف</button>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <section className="empty-state"><p>لا توجد عمليات تحقق سابقة.</p><Link href="/verify" className="button-primary">ابدأ التحقق <ArrowLeft size={15} /></Link></section>
        )}
        {result && <div id="saved-result" className="history-results"><ResultView result={result} /></div>}
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
        <Route path="/history" component={HistoryPage} />
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
