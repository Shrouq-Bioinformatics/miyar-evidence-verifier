import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity as ActivityIcon,
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  Download,
  FileCheck2,
  FileSearch,
  Filter,
  Gauge,
  Globe2,
  History,
  Info,
  Languages,
  LayoutDashboard,
  Library,
  Menu,
  Plus,
  Printer,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
  UsersRound,
  BellRing,
  LockKeyhole,
  BookMarked,
  FileText,
  X,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const miyarLogoPath = `${basePath}/miyar-logo.png`;
const miyarSidebarLogoPath = `${basePath}/miyar-logo-transparent.png`;
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${miyarLogoPath}`,
  },
  variables: {
    colorPrimary: '#2f6f62',
    colorForeground: '#172a26',
    colorMutedForeground: '#66736f',
    colorBackground: '#fbfaf6',
    colorInput: '#ffffff',
    colorInputForeground: '#172a26',
    colorNeutral: '#d9dfd9',
    fontFamily: 'Inter, Arial, sans-serif',
    borderRadius: '0.75rem',
  },
};

type CaseStatus = 'supported' | 'needs_review' | 'insufficient';
type Tone = 'success' | 'warning' | 'neutral';
type ViewName = 'dashboard' | 'check' | 'reviews' | 'sources' | 'analytics' | 'settings';

type RetrievedEvidence = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: string;
  sourceName?: string;
  sourceVersion?: string;
  surahNumber?: number;
  surahName?: string;
  ayahNumber?: number;
  reference: string;
  excerpt?: string;
  tafsirText?: string;
  url: string;
  edition: string;
  retrievedAt: string;
  score?: number;
  sourceDomain?: string;
  sourceProvider?: string;
  pageTitle?: string;
  summary?: string;
  sourceSubtype?: string;
  sourceMetadataStatus?: 'verified' | 'unavailable';
  resolutionNumber?: string;
  sessionDate?: string;
  topic?: string;
};

type AuditEntry = {
  id: string;
  action: string;
  actorUserId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type CaseReview = {
  id: string;
  caseId: string;
  reviewerUserId: string;
  status: CaseStatus;
  reviewerNote: string;
  createdAt: string;
};

type EvidenceCase = {
  id: string;
  claim: string;
  context: string;
  language: string;
  status: CaseStatus;
  confidence: number;
  evidenceLevel: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  sources: string[];
  reviewerNote?: string;
  summary?: string;
  recommendedAction?: string;
  sourceNotes?: string[];
  evidence?: RetrievedEvidence[];
  analysisMode?: 'ai' | 'local';
  modeNote?: string;
  isSample?: boolean;
  languageMismatch?: boolean;
};

type Workspace = { id: string; name: string; role: 'owner' | 'reviewer' | 'member'; isPersonal: boolean };
type SubmittedEvidence = { id: string; title: string; reference: string; excerpt: string; edition?: string; url?: string; status: 'pending' | 'accepted' | 'rejected'; submittedBy: string; reviewedBy?: string; reviewerNote?: string };
const roleLabel = { owner: 'مالك المساحة', reviewer: 'مراجع مخوّل', member: 'عضو' };
const canReview = (workspace?: Workspace) => workspace?.role === 'owner' || workspace?.role === 'reviewer';
const caseStatus = (item: EvidenceCase): CaseStatus => item.status === 'insufficient' ? 'insufficient' : item.reviewedBy ? item.status : 'needs_review';
const needsHumanDecision = (item: EvidenceCase) => !item.reviewedBy;

function requestErrorMessage(status?: number) {
  const language = document.documentElement.lang === 'en' || document.documentElement.lang === 'fr'
    ? document.documentElement.lang
    : 'ar';
  const messages = {
    ar: {
      network: 'تعذر الاتصال. تحقق من اتصالك وحاول مجددًا.',
      session: 'انتهت جلسة الدخول. سجّل الدخول مجددًا.',
      access: 'لا تملك صلاحية تنفيذ هذا الإجراء.',
      missing: 'العنصر المطلوب غير متاح.',
      service: 'تعذر إكمال الطلب الآن. حاول مجددًا لاحقًا.',
      request: 'تعذر إكمال الطلب. تحقق من المعلومات وحاول مجددًا.',
    },
    en: {
      network: 'Could not connect. Check your connection and try again.',
      session: 'Your sign-in session has expired. Sign in again.',
      access: 'You do not have permission to do this.',
      missing: 'The requested item is unavailable.',
      service: 'Could not complete the request. Try again later.',
      request: 'Could not complete the request. Check the information and try again.',
    },
    fr: {
      network: 'Connexion impossible. Vérifiez votre connexion et réessayez.',
      session: 'Votre session a expiré. Veuillez vous reconnecter.',
      access: 'Vous n’avez pas l’autorisation d’effectuer cette action.',
      missing: 'L’élément demandé est indisponible.',
      service: 'La demande n’a pas pu aboutir. Réessayez plus tard.',
      request: 'La demande n’a pas pu aboutir. Vérifiez les informations et réessayez.',
    },
  }[language];
  if (status === undefined) return messages.network;
  if (status === 401) return messages.session;
  if (status === 403) return messages.access;
  if (status === 404) return messages.missing;
  if (status >= 500) return messages.service;
  return messages.request;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'include', ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  } catch {
    throw new Error(requestErrorMessage());
  }
  const payload = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(requestErrorMessage(response.status));
  return payload;
}
const workspaceQuery = (workspaceId: string) => `workspaceId=${encodeURIComponent(workspaceId)}`;

type AppLanguage = 'ar' | 'en' | 'fr';
type SettingsSection = 'account' | 'language' | 'workspaces' | 'notifications' | 'privacy' | 'sources' | 'policies' | 'about';

const shellCopy: Record<AppLanguage, {
  nav: Record<string, string>;
  workspace: string;
  workspacePlaceholder: string;
  workArea: string;
  safety: string;
  signOut: string;
  menuOpen: string;
  menuClose: string;
  search: string;
  reviews: string;
  reviewsDescription: string;
  openReviews: string;
  newCheck: string;
}> = {
  ar: {
    nav: { Overview: 'لوحة القيادة', Check: 'تدقيق جديد', Reviews: 'قائمة المراجعة', Sources: 'مكتبة المصادر', Analytics: 'التحليلات', Settings: 'الإعدادات' },
    workspace: 'المساحة الحالية', workspacePlaceholder: 'اختر مساحة', workArea: 'مساحة العمل',
    safety: 'راجِع الدليل قبل اتخاذ القرار.', signOut: 'تسجيل الخروج', menuOpen: 'فتح القائمة', menuClose: 'إغلاق القائمة',
    search: 'بحث في فهارس المصادر', reviews: 'قائمة المراجعة', reviewsDescription: 'حالات تنتظر قرار المراجعة.', openReviews: 'فتح قائمة المراجعة', newCheck: 'مراجعة جديدة',
  },
  en: {
    nav: { Overview: 'Overview', Check: 'New check', Reviews: 'Review queue', Sources: 'Source library', Analytics: 'Analytics', Settings: 'Settings' },
    workspace: 'Current workspace', workspacePlaceholder: 'Choose a workspace', workArea: 'Workspace',
    safety: 'Review the evidence before deciding.', signOut: 'Sign out', menuOpen: 'Open navigation', menuClose: 'Close navigation',
    search: 'Search source indexes', reviews: 'Review queue', reviewsDescription: 'Cases waiting for review.', openReviews: 'Open review queue', newCheck: 'New review',
  },
  fr: {
    nav: { Overview: 'Vue d’ensemble', Check: 'Nouvelle vérification', Reviews: 'File de revue', Sources: 'Bibliothèque des sources', Analytics: 'Analyses', Settings: 'Paramètres' },
    workspace: 'Espace actuel', workspacePlaceholder: 'Choisir un espace', workArea: 'Espace de travail',
    safety: 'Examinez les preuves avant de décider.', signOut: 'Se déconnecter', menuOpen: 'Ouvrir la navigation', menuClose: 'Fermer la navigation',
    search: 'Rechercher dans les index', reviews: 'File de revue', reviewsDescription: 'Dossiers en attente de revue.', openReviews: 'Ouvrir la file de revue', newCheck: 'Nouvelle revue',
  },
};

type EvidenceSource = {
  id: string;
  title: string;
  authority: string;
  type: string;
  language: string;
  coverage: string;
  reviewedAt?: string;
  url: string;
  accent: string;
  description: string;
};

type Activity = {
  id: string;
  text: string;
  time: string;
  tone: Tone;
};

const sourceSeed: EvidenceSource[] = [
  { id: 'quran', title: 'نص القرآن الكريم', authority: 'Tanzil Project', type: 'نص قرآني', language: 'العربية', coverage: 'النص الكامل', url: 'https://tanzil.net/', accent: 'gold', description: 'نص القرآن الكريم من مشروع تنزيل. راجع النص والإحالة في المصدر الأصلي.' },
  { id: 'bukhari', title: 'صحيح البخاري', authority: 'فهرس عام', type: 'حديث', language: 'العربية', coverage: 'مقتطف تجريبي محلي محدود', url: 'https://sunnah.com/bukhari', accent: 'teal', description: 'تغطية مِعيار المحلية مقتطف تجريبي محدود؛ يفتح الرابط فهرسًا عامًا للبحث في الكتاب.' },
  { id: 'muslim', title: 'صحيح مسلم', authority: 'فهرس عام', type: 'حديث', language: 'العربية', coverage: 'مقتطف تجريبي محلي محدود', url: 'https://sunnah.com/muslim', accent: 'blue', description: 'تغطية مِعيار المحلية مقتطف تجريبي محدود؛ يفتح الرابط فهرسًا عامًا للبحث في الكتاب.' },
  { id: 'bin-baz', title: 'فهرس فتاوى ابن باز', authority: 'فهرس خارجي', type: 'فتوى', language: 'العربية', coverage: 'العبادات والمعاملات', url: 'https://binbaz.org.sa/fatwas', accent: 'rose', description: 'مادة فتوائية مؤرشفة؛ لا تُستخدم وحدها للحكم على النوازل الحديثة.' },
  { id: 'altafsir', title: 'موسوعة التفسير', authority: 'فهرس خارجي', type: 'تفسير', language: 'العربية', coverage: 'السور والآيات', url: 'https://tafsir.app/', accent: 'violet', description: 'فهرس للمقارنة والبحث؛ يلزم تسجيل الإحالة المحددة عند الاستدلال.' },
  { id: 'fiqh-academy', title: 'مجمع الفقه الإسلامي الدولي', authority: 'فهرس مؤسسي', type: 'قرار فقهي', language: 'العربية', coverage: 'قضايا معاصرة مختارة', url: 'https://iifa-aifi.org/ar', accent: 'green', description: 'بوابة عامة للقرارات المؤسسية، مع ضرورة المراجعة البشرية للقرار ذي الصلة.' },
];

const navItems: { href: string; label: string; short: string; icon: typeof LayoutDashboard }[] = [
  { href: '/', label: 'لوحة القيادة', short: 'Overview', icon: LayoutDashboard },
  { href: '/check', label: 'تدقيق جديد', short: 'Check', icon: FileSearch },
  { href: '/reviews', label: 'قائمة المراجعة', short: 'Reviews', icon: ClipboardCheck },
  { href: '/sources', label: 'مكتبة المصادر', short: 'Sources', icon: Library },
  { href: '/analytics', label: 'التحليلات', short: 'Analytics', icon: Gauge },
  { href: '/settings', label: 'الإعدادات', short: 'Settings', icon: Settings },
];

const statusLabel: Record<CaseStatus, string> = {
  supported: 'مدعوم',
  needs_review: 'يحتاج مراجعة',
  insufficient: 'أدلة غير كافية',
};

const statusClass: Record<CaseStatus, string> = {
  supported: 'status-supported',
  needs_review: 'status-review',
  insufficient: 'status-insufficient',
};

function formatCaseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'وقت غير مسجل' : new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatResultSummary(summary: string) {
  return summary
    .replace(/^\s*ملخص أولي من النموذج[:：]?\s*/u, '')
    .replace(/\s*هذا فرز أولي مساعد للمراجعة:\s*وجود الدليل أو ملخص المصدر لا يغني عن مراجعة اللفظ والسياق بواسطة مختص\.?/gu, '')
    .replace(/\s*لم يعثر مِعيار على دليل كافٍ ضمن المصادر المتاحة حاليًا\.\s*لا تعني هذه النتيجة أن المقولة صحيحة أو خاطئة، وقد تتطلب مراجعة مصادر إضافية أو مختص\.?/gu, '')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
}

function stripMarkdownSyntax(value: string) {
  return value
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/gu, '$1')
    .replace(/```[^\n]*\n?/gu, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, '$1')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/gu, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]*/gmu, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gmu, '')
    .replace(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/gmu, '')
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gmu, '')
    .replace(/[*_~`]/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\s*\n\s*/gu, ' ')
    .trim();
}

function formatEvidenceSummary(summary: string, title: string) {
  const plainSummary = stripMarkdownSyntax(summary);
  const plainTitle = stripMarkdownSyntax(title).replace(/[،:؛.!؟]+$/u, '').trim();
  const topic = plainTitle
    .replace(/^(?:قرار|حكم|فتوى|بيان|مسألة|موضوع|قضية)(?:\s+(?:بشأن|حول|في))?\s+/u, '')
    .trim();

  if (!plainTitle || !topic) return plainSummary;

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const repeatedTitleLead = new RegExp(
    `^(?:${escapeRegExp(plainTitle)}|(?:مسألة|المسألة|موضوع|الموضوع|قضية|القضية)\\s+${escapeRegExp(topic)}|${escapeRegExp(topic)})(?=$|[\\s:،؛—-])[\\s:،؛—-]*`,
    'u',
  );

  return plainSummary.replace(repeatedTitleLead, '').trim();
}

function AppShell({ children, currentPath, workspaces, workspace, onSelect, language }: { children: ReactNode; currentPath: string; workspaces: Workspace[]; workspace?: Workspace; onSelect: (id: string) => void; language: AppLanguage }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const activePath = currentPath || location;
  const copy = shellCopy[language];

  return (
    <div className="app-shell" dir={language === 'ar' ? 'rtl' : 'ltr'} data-language={language}>
      {mobileOpen && <button className="mobile-overlay" aria-label={copy.menuClose} data-testid="button-close-mobile-nav" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`} data-testid="sidebar-navigation">
        <div className="brand-lockup">
          <img className="sidebar-brand-logo" src={miyarSidebarLogoPath} alt="شعار مِعيار" />
          <div className="brand-sub">مساحة لمراجعة الأدلة</div>
        </div>
        <label className="workspace-picker" htmlFor="workspace-select">{copy.workspace}
          <select id="workspace-select" aria-label={copy.workspace} data-testid="select-workspace" value={workspace?.id ?? ''} onChange={(event) => { onSelect(event.target.value); setMobileOpen(false); }}>
            {!workspaces.length && <option value="">{copy.workspacePlaceholder}</option>}
            {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <div className="side-label">{copy.workArea}</div>
        <nav className="nav-stack" aria-label="التنقل الرئيسي">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === '/' ? activePath === '/' : activePath.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${isActive ? 'active' : ''}`}
                data-testid={`link-nav-${item.short.toLowerCase()}`}
                onClick={() => setMobileOpen(false)}
              >
                <Icon />
                <span>{copy.nav[item.short] ?? item.label}</span>
              </Link>
            );
          })}
        </nav>
         <div className="sidebar-bottom">
           <p className="safety-footer">{copy.safety}</p>
           <button className="profile-row" type="button" onClick={() => signOut({ redirectUrl: basePath || '/' })}>
            <div className="avatar">م</div>
              <div className="profile-copy"><strong>{user?.fullName || user?.primaryEmailAddress?.emailAddress || (language === 'ar' ? 'مستخدم مساحة العمل' : language === 'fr' ? 'Membre de l’espace' : 'Workspace member')}</strong><span>{copy.signOut}</span></div>
            <ChevronLeft size={15} color="currentColor" />
           </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-context">
             <button className="icon-button mobile-menu" aria-label={copy.menuOpen} data-testid="button-open-mobile-nav" onClick={() => setMobileOpen(true)}><Menu size={18} /></button>
             <small>{new Intl.DateTimeFormat(language === 'ar' ? 'ar' : language === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'full' }).format(new Date())}</small>
          </div>
          <div className="topbar-actions">
             <Link href="/sources" className="icon-button" aria-label={copy.search} data-testid="link-global-search"><Search size={17} /></Link>
             <div style={{ position: 'relative' }}>
                 <button className="icon-button" aria-label={copy.reviews} data-testid="button-notifications" onClick={() => setNotificationsOpen((value) => !value)}><ClipboardCheck size={17} /></button>
                {notificationsOpen && <div className="notification-popover card" data-testid="popover-notifications"><h4>{copy.reviews}</h4><p>{copy.reviewsDescription}</p><Link href="/reviews" className="text-link" onClick={() => setNotificationsOpen(false)}>{copy.openReviews}</Link></div>}
             </div>
             <Link href="/check" className="button button-primary" data-testid="link-topbar-new-check"><Plus size={16} /> {copy.newCheck}</Link>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function StatusPill({ status }: { status: CaseStatus }) {
  return <span className={`status-pill ${statusClass[status]}`} data-testid={`status-pill-${status}`}><span>•</span>{statusLabel[status]}</span>;
}

function externalSourceName(item: RetrievedEvidence) {
  if (item.sourceSubtype === 'collective_fiqh_resolution') return 'مجمع الفقه الإسلامي الدولي';
  const domain = item.sourceDomain?.toLowerCase().replace(/^www\./, '') ?? '';
  if (domain === 'dorar.net' || domain.endsWith('.dorar.net')) return 'الموسوعة الحديثية';
  if (domain === 'binbaz.org.sa' || domain.endsWith('.binbaz.org.sa')) return 'موقع الشيخ ابن باز';
  if (domain === 'alifta.gov.sa' || domain.endsWith('.alifta.gov.sa')) return 'الرئاسة العامة للبحوث العلمية والإفتاء';
  if (domain === 'binothaimeen.net' || domain.endsWith('.binothaimeen.net')) return 'موقع الشيخ محمد بن صالح العثيمين';
  return item.sourceName && !item.sourceName.includes('.') ? item.sourceName : 'مصدر خارجي';
}

function EvidenceCard({ item }: { item: RetrievedEvidence }) {
  const isIifaResolution = item.sourceSubtype === 'collective_fiqh_resolution';
  const link = item.url ? (
    <a href={item.url} target="_blank" rel="noreferrer" className="text-link" data-testid={`link-evidence-source-${item.id}`}>
      فتح المصدر الأصلي <ArrowUpRight size={12} />
    </a>
  ) : null;

  if (item.sourceType === 'quran') {
    return <article className="evidence-snippet evidence-quran" key={item.id} data-testid={`card-evidence-${item.id}`}>
      <div className="evidence-snippet-head"><span className="evidence-kind">نص قرآني</span>{link}</div>
      <h4>{item.reference}</h4>
      {item.excerpt && <p className="quran-text">{item.excerpt}</p>}
      <small>{item.sourceName || item.sourceTitle || 'القرآن الكريم'}</small>
    </article>;
  }

  if (item.sourceType === 'tafsir') {
    return <article className="evidence-snippet evidence-tafsir" key={item.id} data-testid={`card-evidence-${item.id}`}>
      <div className="evidence-snippet-head"><span className="evidence-kind">تفسير</span>{link}</div>
      <h4>{item.edition || item.sourceTitle}</h4>
      <p>{item.surahName ? `سورة ${item.surahName} (${item.surahNumber})، الآية ${item.ayahNumber}` : item.reference}</p>
      {(item.tafsirText || item.excerpt) && <p className="tafsir-explanation">{item.tafsirText || item.excerpt}</p>}
      <small>المصدر: {item.sourceName || 'QuranEnc'}</small>
    </article>;
  }

  if (item.sourceType === 'external_web') {
    const sourceName = externalSourceName(item);
    const safeReference = /^(?:https?:\/\/|www\.|[a-z\d-]+(?:\.[a-z\d-]+)+(?=\/|$))/i.test(item.reference.trim())
      ? sourceName
      : item.reference;
    const pageTitle = item.pageTitle
      || (isIifaResolution
        ? item.topic || (item.resolutionNumber ? `قرار رقم ${item.resolutionNumber}` : sourceName)
        : safeReference);
    const relevanceSummary = item.summary ? formatEvidenceSummary(item.summary, pageTitle) : '';
    return <article className={`evidence-snippet evidence-external${isIifaResolution ? ' evidence-collective-fiqh' : ''}`} key={item.id} data-testid={`card-evidence-${item.id}`}>
      <div className="evidence-snippet-head">
        <span className="evidence-kind">{isIifaResolution ? 'قرار فقهي جماعي' : 'مصدر خارجي'}</span>
        {link}
      </div>
      <h4>{pageTitle}</h4>
      <p className="evidence-source-name">{sourceName}</p>
      {isIifaResolution && item.resolutionNumber && <small>رقم القرار: {item.resolutionNumber}</small>}
      {isIifaResolution && item.sessionDate && <small> · الدورة والتاريخ: {item.sessionDate}</small>}
      {relevanceSummary && <p className="evidence-explanation">{relevanceSummary}</p>}
    </article>;
  }

  const sourceType = item.sourceType === 'hadith' || item.sourceType === 'حديث'
    ? 'حديث'
    : item.sourceName || item.sourceTitle || 'مصدر';
  return <article className="evidence-snippet evidence-hadith" key={item.id} data-testid={`card-evidence-${item.id}`}>
    <div className="evidence-snippet-head"><span className="evidence-kind">{sourceType}</span>{link}</div>
    <h4>{item.reference}</h4>
    {item.excerpt && <p>{item.excerpt}</p>}
    <small>{[item.sourceName, item.sourceTitle, item.edition].filter(Boolean).join(' · ')}</small>
  </article>;
}

function Dashboard({ cases, activities, activityError, refreshActivities, go }: { cases: EvidenceCase[]; activities: Activity[]; activityError: string; refreshActivities: () => Promise<void>; go: (path: string) => void }) {
  const actualCases = cases;
  const pending = cases.filter(needsHumanDecision).length;
  const supported = cases.filter((item) => caseStatus(item) === 'supported').length;
  return <div className="content">
     <PageHeading eyebrow="نظرة عامة" title="مساحة المراجعة" description="راجع الادعاء ومصادره قبل النشر." action={<button className="button button-primary" data-testid="button-dashboard-new-check" onClick={() => go('/check')}><Plus size={16} /> مراجعة جديدة</button>} />
    <section className="dashboard-grid">
      <div className="hero-card">
         <div className="hero-kicker"><Sparkles size={14} /> مراجعة قبل النشر</div>
         <h3>تتبّع الادعاء<br />وراجع دليله قبل نشره.</h3>
         <p>أرسل النص كما ورد، ثم راجع الإحالات والمقتطفات ذات الصلة.</p>
         <button className="button button-accent hero-button" data-testid="button-hero-start-check" onClick={() => go('/check')}>ابدأ المراجعة <ArrowLeft size={15} /></button>
      </div>
      <div className="stat-column">
        <div className="card stat-card"><div className="stat-icon"><FileCheck2 size={16} /></div><strong data-testid="text-stat-total">{actualCases.length}</strong><span>حالات محفوظة</span></div>
        <div className="card stat-card"><div className="stat-icon"><CheckCircle2 size={16} /></div><strong data-testid="text-stat-supported">{supported}</strong><span>مدعومة بالمصدر</span></div>
        <div className="card stat-card"><div className="stat-icon"><ClipboardCheck size={16} /></div><strong data-testid="text-stat-pending">{pending}</strong><span>تنتظر مراجعة بشرية</span></div>
         <div className="card stat-card"><div className="stat-icon"><ShieldCheck size={16} /></div><strong data-testid="text-stat-confidence">{cases.filter((item) => caseStatus(item) === 'insufficient').length}</strong><span>حالات بأدلة غير كافية</span></div>
      </div>
    </section>
    <section className="section-grid">
      <div className="card panel">
        <div className="panel-heading"><div><h3>آخر الفحوصات</h3><span>تتبع الأدلة قبل اعتماد النتيجة</span></div><button className="text-link" data-testid="button-view-all-cases" onClick={() => go('/check')}>عرض سجل الفحص <ArrowLeft size={12} /></button></div>
        <div className="case-list">
           {cases.length ? cases.slice(0, 4).map((item) => <button className="case-row" key={item.id} data-testid={`button-case-row-${item.id}`} onClick={() => go(`/check/${encodeURIComponent(item.id)}`)}><span className={`case-dot dot-${caseStatus(item) === 'needs_review' ? 'review' : caseStatus(item)}`} /><span style={{ textAlign: 'right', minWidth: 0 }}><strong>{item.claim}</strong><small>{item.context} · {formatCaseDate(item.createdAt)}</small></span><StatusPill status={caseStatus(item)} /></button>) : <div className="empty-state"><h3>لا توجد حالات محفوظة</h3><p>ابدأ بمراجعة مطالبة لإضافتها إلى هذه المساحة.</p></div>}
        </div>
      </div>
      <div className="card panel">
        <div className="panel-heading"><div><h3>آخر النشاط</h3><span>أحدث التغييرات في المساحة</span></div><ActivityIcon size={17} color="hsl(var(--muted-foreground))" /></div>
         <div className="timeline">{activityError ? <div className="empty-state"><p role="alert">{activityError}</p><button className="button button-outline" onClick={() => void refreshActivities()}>إعادة تحميل النشاط</button></div> : activities.length ? activities.slice(0, 4).map((item) => <div className="timeline-item" key={item.id}><div className="timeline-mark">{item.tone === 'success' ? <Check size={14} /> : item.tone === 'warning' ? <AlertCircle size={14} /> : <History size={14} />}</div><div><p>{item.text}</p><time>{formatCaseDate(item.time)}</time></div></div>) : <div className="empty-state"><p>لا توجد تغييرات مسجلة بعد.</p></div>}</div>
      </div>
    </section>
  </div>;
}

function CheckPage({ cases, selectedId, go, workspace, refreshCases, notify }: { cases: EvidenceCase[]; selectedId?: string; go: (path: string) => void; workspace: Workspace; refreshCases: () => Promise<void>; notify: (message: string) => void }) {
  const [claim, setClaim] = useState('');
  const [context, setContext] = useState('محتوى دعوي');
  const [language, setLanguage] = useState('العربية');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<EvidenceCase | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [evidenceItems, setEvidenceItems] = useState<SubmittedEvidence[]>([]);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const verificationRequest = useRef<{ input: string; requestId: string } | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState('');
  const [evidenceForm, setEvidenceForm] = useState({ title: '', reference: '', excerpt: '', edition: '', url: '' });
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [reviewingEvidence, setReviewingEvidence] = useState<{ id: string; status: 'accepted' | 'rejected' } | null>(null);
  const [evidenceNote, setEvidenceNote] = useState('');
  const [evidenceError, setEvidenceError] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!selectedId) { setResult(null); return; }
    setResult(cases.find((item) => item.id === selectedId) ?? null);
  }, [selectedId, cases]);

  const loadDetails = async (id: string) => {
    setDetailLoading(true); setDetailError('');
    try {
      const evidencePayload = await api<{ evidence: SubmittedEvidence[] }>(`/api/cases/${encodeURIComponent(id)}/evidence?${workspaceQuery(workspace.id)}`);
      setEvidenceItems(evidencePayload.evidence ?? []);
    } catch (cause) { setDetailError(cause instanceof Error ? cause.message : 'تعذر تحميل تفاصيل الحالة.'); }
    finally { setDetailLoading(false); }
    try {
      const auditPayload = await api<{ audit: AuditEntry[] }>(`/api/cases/${encodeURIComponent(id)}/audit?${workspaceQuery(workspace.id)}`);
      setAuditEntries(auditPayload.audit ?? []);
    } catch { setAuditEntries([]); }
  };
  useEffect(() => { setAuditEntries([]); setEvidenceItems([]); if (selectedId) void loadDetails(selectedId); }, [selectedId, workspace.id]);

  const submitEvidence = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId) return;
    setEvidenceBusy(true); setEvidenceError('');
    try {
      await api(`/api/cases/${encodeURIComponent(selectedId)}/evidence`, { method: 'POST', body: JSON.stringify({ ...evidenceForm, workspaceId: workspace.id }) });
      setEvidenceForm({ title: '', reference: '', excerpt: '', edition: '', url: '' });
      await loadDetails(selectedId);
      notify('أُرسل المقتطف للمراجعة.');
    } catch (cause) { setEvidenceError(cause instanceof Error ? cause.message : 'تعذر إرسال المقتطف.'); }
    finally { setEvidenceBusy(false); }
  };
  const decideEvidence = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId || !reviewingEvidence || !evidenceNote.trim()) return;
    setEvidenceBusy(true); setEvidenceError('');
    try {
      await api(`/api/cases/${encodeURIComponent(selectedId)}/evidence/${encodeURIComponent(reviewingEvidence.id)}`, { method: 'PATCH', body: JSON.stringify({ workspaceId: workspace.id, status: reviewingEvidence.status, reviewerNote: evidenceNote.trim() }) });
      setReviewingEvidence(null); setEvidenceNote('');
      await loadDetails(selectedId);
      notify('حُفظت مراجعة المقتطف.');
      try { await refreshCases(); } catch { notify('حُفظت مراجعة المقتطف، لكن تعذر تحديث القائمة.'); }
    } catch (cause) { setEvidenceError(cause instanceof Error ? cause.message : 'تعذر حفظ مراجعة المقتطف.'); }
    finally { setEvidenceBusy(false); }
  };

  const reviewedCitations = async (id: string) => {
    const response = await api<{ evidence: SubmittedEvidence[] }>(`/api/cases/${encodeURIComponent(id)}/evidence?${workspaceQuery(workspace.id)}`);
    return (response.evidence ?? []).filter((entry) => entry.status === 'accepted');
  };
  const exportCase = async (item: EvidenceCase) => {
    if (!selectedId || reportBusy) return;
    setReportBusy(true); setReportError('');
    try {
      const acceptedEvidence = await reviewedCitations(selectedId);
      const payload = { id: item.id, claim: item.claim, context: item.context, language: item.language, status: caseStatus(item), createdAt: item.createdAt, reviewedBy: item.reviewedBy ?? null, reviewedAt: item.reviewedAt ?? null, reviewerNote: item.reviewedBy ? item.reviewerNote ?? null : null, preliminaryAnalysis: { summary: item.summary ?? null, evidenceLevel: item.evidenceLevel, confidence: item.confidence ?? null }, acceptedEvidence };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'miyar-case.json'; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('تم تنزيل الحالة مع المقتطفات المقبولة فقط.');
    } catch (cause) { setReportError(cause instanceof Error ? cause.message : 'تعذر تحميل المقتطفات المقبولة للتنزيل.'); }
    finally { setReportBusy(false); }
  };

  const printCase = async (item: EvidenceCase) => {
    if (!selectedId || reportBusy) return;
    setReportError('');
    const report = window.open('', '_blank');
    if (!report) { setReportError('تعذر فتح نافذة الطباعة. فعّل النوافذ المنبثقة ثم أعد المحاولة.'); return; }
    report.opener = null;
    setReportBusy(true);
    try {
      const acceptedEvidence = await reviewedCitations(selectedId);
      const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] || character);
      const citationsHtml = acceptedEvidence.length ? acceptedEvidence.map((entry) => {
        let safeUrl = '';
        try { if (entry.url && /^https?:$/.test(new URL(entry.url).protocol)) safeUrl = `<br><a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">فتح المصدر</a>`; } catch { /* Invalid citation URL is omitted. */ }
        return `<div class="evidence"><strong>${escapeHtml(entry.title)}</strong> — ${escapeHtml(entry.reference)}${entry.edition ? `، ${escapeHtml(entry.edition)}` : ''}<br>${escapeHtml(entry.excerpt)}${safeUrl}</div>`;
      }).join('') : '<p>لا توجد مقتطفات مقبولة بعد.</p>';
      report.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير مِعيار</title><style>body{font-family:sans-serif;max-width:760px;margin:40px auto;line-height:1.8;color:#172a26}h1{border-bottom:2px solid #b8954b;padding-bottom:12px}dt{font-weight:bold;margin-top:14px}dd{margin:0}.note{background:#f4f1e9;padding:12px;border-right:4px solid #b8954b}.evidence{background:#f7faf8;padding:12px;margin:14px 0;border-right:4px solid #2e6b5d;white-space:pre-wrap}.muted{color:#66736f;font-size:13px}@media print{button{display:none}}</style></head><body><h1>تقرير حالة من مِعيار</h1><dl><dt>المطالبة</dt><dd>${escapeHtml(item.claim)}</dd><dt>السياق</dt><dd>${escapeHtml(item.context)}</dd><dt>الحالة</dt><dd>${escapeHtml(statusLabel[caseStatus(item)])}</dd><dt>مستوى الدليل الأولي</dt><dd>${escapeHtml(item.evidenceLevel)}</dd><dt>ملخص النتيجة</dt><dd>${escapeHtml(item.summary || 'لا يوجد ملخص محفوظ.')}</dd>${item.reviewedBy ? `<dt>ملاحظة المراجع</dt><dd>${escapeHtml(item.reviewerNote || 'لا توجد ملاحظة ظاهرة.')}</dd>` : ''}</dl><h2>المقتطفات المقبولة في المراجعة</h2>${citationsHtml}<p class="note">نتيجة أولية مبنية على الأدلة المسترجعة، وليست حكمًا شرعيًا نهائيًا.</p><button onclick="window.print()">طباعة</button></body></html>`);
      report.document.close();
    } catch (cause) { report.close(); setReportError(cause instanceof Error ? cause.message : 'تعذر تحميل المقتطفات المقبولة للطباعة.'); }
    finally { setReportBusy(false); }
  };

  const runAnalysis = async (event: FormEvent) => {
    event.preventDefault();
    if (!claim.trim()) { setError('أدخل الادعاء أولًا.'); return; }
    const input = JSON.stringify({ claim, context, language, workspaceId: workspace.id });
    if (verificationRequest.current?.input !== input) verificationRequest.current = { input, requestId: crypto.randomUUID() };
    const requestId = verificationRequest.current.requestId;
    setError('');
    setIsAnalyzing(true);
    let saved: EvidenceCase;
    try {
      const response = await api<{ case: EvidenceCase }>('/api/verify', {
        method: 'POST',
        body: JSON.stringify({ claim, context, language, workspaceId: workspace.id, requestId }),
      });
      if (!response.case?.id) throw new Error('تعذر إكمال المراجعة. تحقق من قائمة الحالات قبل إعادة المحاولة.');
      saved = response.case;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إكمال المراجعة. تحقق من قائمة الحالات قبل إعادة المحاولة.');
      setIsAnalyzing(false);
      return;
    }
    verificationRequest.current = null;
    setResult({ ...saved, sources: saved.sources ?? [], sourceNotes: saved.sourceNotes ?? [], evidence: saved.evidence ?? [] });
    go(`/check/${encodeURIComponent(saved.id)}`);
    notify('حُفظت النتيجة الأولية.');
    try { await refreshCases(); }
    catch { notify('حُفظت النتيجة، لكن تعذّر تحديث قائمة الحالات. أعد تحميل القائمة.'); }
    finally { setIsAnalyzing(false); }
  };

  const displayedSummary = result?.summary ? formatResultSummary(result.summary) : '';

  return <div className="content">
    <PageHeading eyebrow="مراجعة" title="مراجعة ادعاء" description="أدخل النص كما وصل، من دون إعادة صياغة." />
    <div className={`check-layout${!isAnalyzing && result ? ' result-ready' : ''}`}>
      <form className="card form-panel" onSubmit={runAnalysis} data-testid="form-new-check">
        <div className="form-title"><div className="form-title-mark"><FileSearch size={18} /></div><div><h3>بيانات الادعاء</h3><p>أدخل النص كما ورد لتسهيل مراجعة الإحالات.</p></div></div>
        <div className="field"><label htmlFor="claim">المطالبة <span>مطلوب</span></label><textarea id="claim" data-testid="input-claim" value={claim} onChange={(event) => setClaim(event.target.value)} placeholder="مثال: ورد في صحيح البخاري أن الأعمال بالنيات." />{error && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 7 }} data-testid="text-check-error"><AlertCircle size={12} style={{ verticalAlign: 'middle', marginLeft: 4 }} />{error}</div>}</div>
        <div className="two-fields">
          <div className="field"><label htmlFor="context">السياق</label><select id="context" data-testid="select-context" value={context} onChange={(event) => setContext(event.target.value)}><option>محتوى دعوي</option><option>مادة تربوية</option><option>سؤال معاصر</option><option>منشور اجتماعي</option><option>بحث أكاديمي</option></select></div>
          <div className="field"><label htmlFor="language">لغة الادعاء</label><select id="language" data-testid="select-language" value={language} onChange={(event) => setLanguage(event.target.value)}><option>العربية</option><option>English</option><option>Français</option></select></div>
        </div>
         <button className="button button-primary" type="submit" disabled={isAnalyzing} data-testid="button-run-analysis" style={{ width: '100%' }}>{isAnalyzing ? 'جارٍ إعداد المراجعة...' : error ? 'إعادة المحاولة' : <><Sparkles size={15} /> بدء المراجعة</>}</button>
      </form>
      <div className={`card analysis-panel${!isAnalyzing && !result ? ' analysis-panel-empty' : ''}`} data-testid="panel-analysis-result">
        {isAnalyzing && <div className="analysis-loading" data-testid="state-analysis-loading"><div className="skeleton" style={{ width: '31%' }} /><div className="skeleton large" /><div className="skeleton" style={{ width: '75%' }} /><div className="skeleton" style={{ width: '55%' }} /><div className="skeleton" style={{ marginTop: 22 }} /><div className="skeleton" style={{ width: '86%' }} /></div>}
           {!isAnalyzing && !result && <div className="analysis-empty"><div><div className="empty-mark"><FileCheck2 size={24} /></div>{selectedId ? <><h3>لم نعثر على هذه الحالة في المساحة</h3><p>تحقق من المساحة المختارة أو افتح الحالة من السجل.</p></> : <p className="analysis-empty-copy">ستظهر الأدلة والنتيجة هنا بعد التدقيق</p>}</div></div>}
        {!isAnalyzing && result && <div className="analysis-result">
          <section className="result-section result-claim">
            <span className="result-section-label">المطالبة</span>
            <p>{result.claim}</p>
              {result.languageMismatch && <p className="language-mismatch" role="status">تختلف لغة النص عن الاختيار؛ راجع الإحالات للتأكد من ملاءمتها.</p>}
          </section>
          <section className="result-section result-outcome">
            <div className="result-section-heading">
              <h3>النتيجة الأولية</h3>
              <StatusPill status={caseStatus(result)} />
            </div>
            <p className="result-safety-note">نتيجة أولية مبنية على الأدلة المسترجعة، وليست حكمًا شرعيًا نهائيًا.</p>
            {displayedSummary && <p className="result-summary"><strong>الخلاصة الأولية</strong>{displayedSummary}</p>}
            {result.reviewedBy && result.reviewerNote && <p className="reviewer-note"><strong>ملاحظة المراجع</strong>{result.reviewerNote}</p>}
          </section>
          <section className="result-section result-evidence">
            <div className="result-section-heading"><h3>الأدلة والمصادر</h3></div>
            {result.evidence?.length ? (
              <div className="evidence-snippet-list">
                {result.evidence.map((item) => <EvidenceCard key={item.id} item={item} />)}
              </div>
            ) : (
              <p className="no-evidence-message">لا توجد أدلة مرتبطة بهذه المطالبة ضمن المصادر المتاحة.</p>
            )}
          </section>
             {selectedId && <section className="audit-panel"><div className="panel-heading"><h3>مقتطفات مقدمة للمراجعة</h3><span>{evidenceItems.length} مقتطف</span></div>
               {detailLoading && <div className="skeleton" />}
               {detailError && <div className="inline-error" role="alert">{detailError} <button className="text-link" onClick={() => void loadDetails(selectedId)} data-testid="button-retry-details">إعادة المحاولة</button></div>}
               {!detailLoading && !detailError && (evidenceItems.length ? evidenceItems.map((entry) => <div className="evidence-entry" key={entry.id}><h4>{entry.title}</h4><small>{entry.reference}{entry.edition ? ` · ${entry.edition}` : ''} · {entry.status === 'accepted' ? 'مقبول' : entry.status === 'rejected' ? 'مرفوض' : 'بانتظار المراجعة'}</small><p>{entry.excerpt}</p>{entry.url && <a href={entry.url} target="_blank" rel="noreferrer" data-testid={`link-evidence-${entry.id}`}>فتح الرابط المرجعي <ArrowUpRight size={12} /></a>}<small style={{ display: 'block' }}>{entry.reviewedBy ? 'قُدّم ورُوجع داخل المساحة' : 'قُدّم داخل المساحة'}</small>{entry.reviewerNote && <p>ملاحظة المراجع: {entry.reviewerNote}</p>}{entry.status === 'pending' && canReview(workspace) && <div className="review-actions"><button className="button button-primary" onClick={() => { setReviewingEvidence({ id: entry.id, status: 'accepted' }); setEvidenceNote(''); }} data-testid={`button-accept-evidence-${entry.id}`}>قبول المقتطف</button><button className="button button-danger" onClick={() => { setReviewingEvidence({ id: entry.id, status: 'rejected' }); setEvidenceNote(''); }} data-testid={`button-reject-evidence-${entry.id}`}>رفض المقتطف</button></div>}</div>) : <p className="audit-empty">لم تُقدّم مقتطفات لهذه الحالة بعد.</p>)}
               {reviewingEvidence && <form className="action-form" onSubmit={decideEvidence}><h4>{reviewingEvidence.status === 'accepted' ? 'قبول المقتطف' : 'رفض المقتطف'}</h4><div className="field"><label htmlFor="evidence-review-note">سبب القرار</label><textarea id="evidence-review-note" value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} required data-testid="input-evidence-review-note" /></div><div className="review-actions"><button className="button button-primary" disabled={evidenceBusy || !evidenceNote.trim()} data-testid="button-confirm-evidence-review">حفظ القرار</button><button type="button" className="button button-outline" onClick={() => setReviewingEvidence(null)}>إلغاء</button></div></form>}
               <form className="action-form" onSubmit={submitEvidence}><h4>إرسال مقتطف للمراجعة</h4><div className="field"><label htmlFor="evidence-title">عنوان المصدر</label><input id="evidence-title" required value={evidenceForm.title} onChange={(e) => setEvidenceForm({ ...evidenceForm, title: e.target.value })} data-testid="input-evidence-title" /></div><div className="field"><label htmlFor="evidence-reference">الإحالة المحددة</label><input id="evidence-reference" required value={evidenceForm.reference} onChange={(e) => setEvidenceForm({ ...evidenceForm, reference: e.target.value })} data-testid="input-evidence-reference" /></div><div className="field"><label htmlFor="evidence-excerpt">نص المقتطف</label><textarea id="evidence-excerpt" required value={evidenceForm.excerpt} onChange={(e) => setEvidenceForm({ ...evidenceForm, excerpt: e.target.value })} data-testid="input-evidence-excerpt" /></div><div className="two-fields"><div className="field"><label htmlFor="evidence-edition">الطبعة (اختياري)</label><input id="evidence-edition" value={evidenceForm.edition} onChange={(e) => setEvidenceForm({ ...evidenceForm, edition: e.target.value })} /></div><div className="field"><label htmlFor="evidence-url">رابط المصدر (اختياري)</label><input id="evidence-url" type="url" value={evidenceForm.url} onChange={(e) => setEvidenceForm({ ...evidenceForm, url: e.target.value })} /></div></div><button className="button button-primary" disabled={evidenceBusy} data-testid="button-submit-evidence">إرسال للمراجعة</button></form>
               {evidenceError && <p className="inline-error" role="alert">{evidenceError}</p>}
             </section>}
              {selectedId && <div className="audit-panel"><div className="panel-heading" style={{ marginBottom: 7 }}><h3 style={{ fontSize: 13 }}>سجل التغييرات</h3></div>{auditEntries.length ? <div className="audit-list">{auditEntries.map((entry) => <div className="audit-row" key={entry.id}><span className="audit-dot" /><div><strong>{entry.action === 'case_created' ? 'إنشاء الحالة' : entry.action === 'case_decision_changed' ? 'تغيير قرار المراجعة' : entry.action === 'evidence_submitted' ? 'تقديم مقتطف' : entry.action === 'evidence_reviewed' ? 'مراجعة مقتطف' : 'تحديث'}</strong><small>{formatCaseDate(entry.createdAt)}</small></div></div>)}</div> : <p className="audit-empty">لا توجد تغييرات مسجلة.</p>}</div>}
            {selectedId && <div className="review-actions" style={{ marginTop: 16 }}><button className="button button-outline" disabled={reportBusy} data-testid="button-export-case" onClick={() => void exportCase(result)}><Download size={14} /> تنزيل ملف الحالة</button><button className="button button-outline" disabled={reportBusy} data-testid="button-print-case" onClick={() => void printCase(result)}><Printer size={14} /> طباعة التقرير</button></div>}
           {reportError && <p className="inline-error" role="alert">{reportError}</p>}
          <section className="result-section result-next-step">
            <span className="result-section-label">الخطوة التالية</span>
            <p>{caseStatus(result) === 'supported'
              ? 'راجع الإحالات والمقتطفات الأصلية قبل استخدام النتيجة.'
              : caseStatus(result) === 'insufficient'
                ? 'ابحث عن مصدر أو مقتطف محدد، واطلب مراجعة إضافية قبل الاعتماد.'
                : 'راجع النص والسياق والمصادر، ثم سجّل قرارًا بشريًا مسببًا.'}</p>
          </section>
        </div>}
       </div>
    </div>
  </div>;
}

function ReviewsPage({ cases, reviews, reviewsError, workspace, onDecision, go }: { cases: EvidenceCase[]; reviews: CaseReview[]; reviewsError: string; workspace: Workspace; onDecision: (id: string, status: CaseStatus, note: string) => Promise<void>; go: (path: string) => void }) {
  const [filter, setFilter] = useState<'pending' | 'all' | 'resolved'>('pending');
   const [decision, setDecision] = useState<{ id: string; status: CaseStatus } | null>(null);
   const [note, setNote] = useState('');
   const [busy, setBusy] = useState(false);
   const [error, setError] = useState('');
    const reviewCases = cases.filter((item) => filter === 'pending' ? needsHumanDecision(item) : filter === 'resolved' ? !needsHumanDecision(item) : true);
   const submitDecision = async (event: FormEvent) => { event.preventDefault(); if (!decision || !note.trim()) return; setBusy(true); setError(''); try {
     if (decision.status === 'supported') {
       const { evidence } = await api<{ evidence: SubmittedEvidence[] }>(`/api/cases/${encodeURIComponent(decision.id)}/evidence?${workspaceQuery(workspace.id)}`);
       if (!evidence?.some((item) => item.status === 'accepted')) throw new Error('يلزم قبول مقتطف واحد على الأقل قبل اعتماد الحالة. افتح الحالة لمراجعة المقتطفات.');
     }
     await onDecision(decision.id, decision.status, note.trim()); setDecision(null); setNote('');
   } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر حفظ القرار.'); } finally { setBusy(false); } };
    return <div className="content"><PageHeading eyebrow="المراجعة" title="قائمة المراجعة" description="راجع الأدلة وسجّل قرارًا يوضح أسبابه." />
     {!canReview(workspace) && <div className="notice notice-warn" style={{ marginBottom: 16 }}><Info size={16} /><div><strong>صلاحية عرض فقط</strong><p>يمكنك الاطلاع وتقديم مقتطفات، لكن إصدار القرار متاح لمالك المساحة والمراجع المخوّل فقط.</p></div></div>}
     <div className="card panel"><div className="filter-row"><Filter size={15} color="hsl(var(--muted-foreground))" /><button className={`filter-button ${filter === 'pending' ? 'active' : ''}`} data-testid="button-filter-pending" onClick={() => setFilter('pending')}>بانتظار القرار <b>{cases.filter(needsHumanDecision).length}</b></button><button className={`filter-button ${filter === 'all' ? 'active' : ''}`} data-testid="button-filter-all" onClick={() => setFilter('all')}>كل الحالات</button><button className={`filter-button ${filter === 'resolved' ? 'active' : ''}`} data-testid="button-filter-resolved" onClick={() => setFilter('resolved')}>تمت مراجعتها</button></div>
         {reviewsError && <div className="notice notice-danger" role="alert" style={{ marginTop: 14 }}><AlertCircle size={16} /><div><strong>تعذر تحميل سجل المراجعات</strong><p>{reviewsError}</p></div></div>}
          {reviewCases.length ? <div className="review-list">{reviewCases.map((item) => { const history = reviews.filter((review) => review.caseId === item.id); const latestReview = history[0]; return <div className="card review-card" key={item.id} data-testid={`card-review-${item.id}`}><span className={`case-dot dot-${caseStatus(item) === 'needs_review' ? 'review' : caseStatus(item)}`} /><div className="review-copy"><strong>{item.claim}</strong><p>{latestReview ? `${statusLabel[latestReview.status]} · ${latestReview.reviewerNote}` : item.reviewedBy ? item.reviewerNote || 'قرار محفوظ دون ملاحظة ظاهرة.' : 'بانتظار مراجعة الحالة.'}</p><div className="review-meta"><span className="tag">{item.context}</span><span className="tag">{formatCaseDate(item.createdAt)}</span>{history.length > 0 && <span className="tag" data-testid={`text-review-history-${item.id}`}>{history.length} {history.length === 1 ? 'قرار مراجعة محفوظ' : 'قرارات مراجعة محفوظة'}</span>}</div></div><div className="review-actions"><button className="button button-outline" data-testid={`button-open-review-${item.id}`} onClick={() => go(`/check/${encodeURIComponent(item.id)}`)}>فتح الحالة والأدلة</button>{needsHumanDecision(item) && canReview(workspace) ? <><button className="button button-primary" data-testid={`button-approve-${item.id}`} onClick={() => { setDecision({ id: item.id, status: 'supported' }); setNote(''); }}><Check size={14} /> اعتماد</button><button className="button button-review" data-testid={`button-reject-${item.id}`} onClick={() => { setDecision({ id: item.id, status: 'insufficient' }); setNote(''); }}><X size={14} /> يحتاج مراجعة إضافية</button></> : <StatusPill status={caseStatus(item)} />}</div></div>; })}</div> : <div className="empty-state" data-testid="empty-review-queue"><div className="empty-mark"><CheckCircle2 size={24} /></div><h3>لا توجد حالات في هذا العرض</h3><p>ستظهر هنا الحالات المحفوظة في المساحة المختارة.</p><button className="button button-primary" data-testid="button-empty-start-check" onClick={() => go('/check')}><Plus size={15} /> مراجعة جديدة</button></div>}</div>
      {decision && <form className="card action-form" onSubmit={submitDecision}><h4>{decision.status === 'supported' ? 'اعتماد الحالة' : 'تحتاج إلى مراجعة إضافية'}</h4><p>راجع المقتطفات المقبولة، ثم اكتب سبب القرار.</p><div className="field"><label htmlFor="decision-note">ملاحظة المراجع</label><textarea id="decision-note" value={note} onChange={(event) => setNote(event.target.value)} required data-testid="input-decision-note" /></div>{error && <p className="inline-error" role="alert">{error}</p>}<div className="review-actions"><button type="submit" className="button button-primary" disabled={busy || !note.trim()} data-testid="button-confirm-decision">{busy ? 'جارٍ الحفظ...' : 'حفظ القرار'}</button><button type="button" className="button button-outline" onClick={() => setDecision(null)}>إلغاء</button></div></form>}
    </div>
}

function SourcesPage({ sources, savedIds, savedSourcesLoading, savedSourceBusyId, savedSourcesError, refreshSavedSources, toggleSaved }: { sources: EvidenceSource[]; savedIds: string[]; savedSourcesLoading: boolean; savedSourceBusyId: string | null; savedSourcesError: string; refreshSavedSources: () => Promise<void>; toggleSaved: (id: string) => Promise<void> }) {
  const [search, setSearch] = useState('');
  const filtered = sources.filter((source) => `${source.title} ${source.type} ${source.coverage}`.includes(search));
     return <div className="content"><PageHeading eyebrow="المصادر" title="فهارس المصادر" description="روابط مرجعية للبحث؛ تحقّق من النص والسياق في المصدر الأصلي. المصادر المحفوظة مشتركة داخل مساحة العمل." />
    <div className="card panel" style={{ marginBottom: 18 }}><div className="field" style={{ margin: 0, position: 'relative' }}><Search size={15} style={{ position: 'absolute', right: 12, top: 13, color: 'hsl(var(--muted-foreground))' }} /><input id="main-search" data-testid="input-source-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم المصدر أو نوعه..." style={{ paddingRight: 38 }} /></div></div>
      {savedSourcesLoading && <div className="loading-panel" role="status"><div className="skeleton" /></div>}
      {savedSourcesError && <div className="notice notice-danger" role="alert" style={{ marginBottom: 16 }}><AlertCircle size={16} /><div><strong>تعذر تحديث المصادر المحفوظة</strong><p>{savedSourcesError}</p><button className="button button-outline" onClick={() => void refreshSavedSources()}>إعادة المحاولة</button></div></div>}
      {filtered.length ? <div className="library-grid">{filtered.map((source) => <div className="card library-card" key={source.id} data-testid={`card-source-${source.id}`}><div className="source-accent" style={{ background: `hsl(var(--${source.accent === 'gold' ? 'accent' : 'primary'}))` }} /><div className="library-card-body"><span className="authority">{source.authority}</span><h3>{source.title}</h3><p>{source.description}</p><div className="library-footer"><span>{source.type} · {source.language}</span><button className={`mini-button ${savedIds.includes(source.id) ? 'saved-source' : ''}`} data-testid={`button-save-source-${source.id}`} aria-label={savedIds.includes(source.id) ? `إزالة ${source.title}` : `حفظ ${source.title}`} disabled={savedSourcesLoading || savedSourceBusyId === source.id} onClick={() => void toggleSaved(source.id)}><Star size={15} fill={savedIds.includes(source.id) ? 'currentColor' : 'none'} /></button></div><div className="library-footer" style={{ marginTop: 9 }}><span>تغطية: {source.coverage}</span><a href={source.url} target="_blank" rel="noreferrer" data-testid={`link-source-catalog-${source.id}`}>فتح الفهرس العام</a></div></div></div>)}</div> : <div className="empty-state"><div className="empty-mark"><Search size={22} /></div><h3>لم نعثر على مصدر</h3><p>ابحث باسم المرجع أو نوعه.</p><button className="button button-quiet" data-testid="button-clear-source-search" onClick={() => setSearch('')}>مسح البحث</button></div>}
  </div>;
}

function AnalyticsPage({ cases }: { cases: EvidenceCase[] }) {
   const actualCases = cases;
   const supported = actualCases.filter((item) => caseStatus(item) === 'supported').length;
   const pending = actualCases.filter(needsHumanDecision).length;
  const percentage = (count: number) => actualCases.length ? `${Math.round((count / actualCases.length) * 100)}%` : '—';
  return <div className="content"><PageHeading eyebrow="إحصاءات" title="الإحصاءات" description="ملخص مباشر للحالات المحفوظة." action={<button className="button button-quiet" data-testid="button-refresh-analytics" onClick={() => window.location.reload()}><RefreshCcw size={15} /> تحديث</button>} />
     <div className="analytics-grid"><div className="card analytic-card"><span>فحوصات محفوظة</span><strong data-testid="text-analytics-total">{actualCases.length}</strong><small>في المساحة الحالية فقط</small></div><div className="card analytic-card"><span>حالات بدليل مقبول وقرار دعم</span><strong>{percentage(supported)}</strong><small>اعتماد الحالة يتطلب مقتطفًا مقبولًا</small></div><div className="card analytic-card"><span>بانتظار مراجعة</span><strong>{percentage(pending)}</strong><small>لم يصدر قرار بشري بعد</small></div><div className="card analytic-card"><span>قرارات دعم بشرية</span><strong>{supported}</strong><small>لا تعني اعتمادًا علميًا</small></div></div>
      <div className="card panel"><div className="panel-heading"><div><h3>توزيع الحالات</h3><span>حسب القرار الحالي</span></div><Gauge size={15} color="hsl(var(--muted-foreground))" /></div><div className="legend-list"><div className="legend-item"><i style={{ background: 'hsl(var(--primary))' }} />قرار دعم <b>{supported}</b></div><div className="legend-item"><i style={{ background: 'hsl(var(--accent))' }} />تحتاج مراجعة <b>{pending}</b></div><div className="legend-item"><i style={{ background: 'hsl(var(--destructive))' }} />غير كافية <b>{actualCases.filter((item) => caseStatus(item) === 'insufficient').length}</b></div></div></div>
  </div>;
}

const settingSections: { key: SettingsSection; icon: typeof Settings; tone: string; title: Record<AppLanguage, string>; description: Record<AppLanguage, string> }[] = [
  { key: 'account', icon: UserRound, tone: 'teal', title: { ar: 'الحساب', en: 'Account', fr: 'Compte' }, description: { ar: 'الاسم والبريد وإدارة حسابك الآمنة.', en: 'Your name, email, and secure account management.', fr: 'Votre nom, votre e-mail et la gestion sécurisée du compte.' } },
  { key: 'language', icon: Languages, tone: 'gold', title: { ar: 'اللغة والمظهر', en: 'Language & appearance', fr: 'Langue et apparence' }, description: { ar: 'اختر لغة الواجهة. تُحفظ على هذا الجهاز فقط.', en: 'Choose the interface language. Saved on this device only.', fr: 'Choisissez la langue de l’interface. Enregistré sur cet appareil uniquement.' } },
  { key: 'workspaces', icon: UsersRound, tone: 'blue', title: { ar: 'مساحات العمل', en: 'Workspaces', fr: 'Espaces de travail' }, description: { ar: 'أنشئ مساحة، انضم برمز، وأدر أعضاء فريقك.', en: 'Create a space, join by code, and manage your team.', fr: 'Créez un espace, rejoignez-le par code et gérez votre équipe.' } },
  { key: 'notifications', icon: BellRing, tone: 'rose', title: { ar: 'الإشعارات', en: 'Notifications', fr: 'Notifications' }, description: { ar: 'الإشعارات غير متاحة للتخصيص حاليًا.', en: 'Notifications cannot be changed right now.', fr: 'Les notifications ne peuvent pas être modifiées pour le moment.' } },
  { key: 'privacy', icon: LockKeyhole, tone: 'green', title: { ar: 'الخصوصية والأمان', en: 'Privacy & security', fr: 'Confidentialité et sécurité' }, description: { ar: 'إعدادات الحساب وطرق تسجيل الدخول.', en: 'Account and sign-in settings.', fr: 'Paramètres du compte et de connexion.' } },
  { key: 'sources', icon: BookMarked, tone: 'violet', title: { ar: 'المصادر والمنهجية', en: 'Sources & methodology', fr: 'Sources et méthodologie' }, description: { ar: 'أنواع المصادر وحدود الفرز الأولي والمراجعة البشرية.', en: 'Source types, preliminary triage, and human review.', fr: 'Types de sources, triage préliminaire et revue humaine.' } },
  { key: 'policies', icon: FileText, tone: 'slate', title: { ar: 'الشروط والسياسات', en: 'Terms & policies', fr: 'Conditions et politiques' }, description: { ar: 'معلومات للقراءة عن استخدام مِعيار ومصادره.', en: 'Read-only information about Miyar and its sources.', fr: 'Informations en lecture seule sur Miyar et ses sources.' } },
  { key: 'about', icon: Info, tone: 'teal', title: { ar: 'عن مِعيار', en: 'About Miyar', fr: 'À propos de Miyar' }, description: { ar: 'ما الذي يفعله مِعيار وكيف يمكنك التواصل معنا.', en: 'What Miyar does and how to reach the team.', fr: 'Ce que fait Miyar et comment joindre l’équipe.' } },
];

function SettingsPage({ workspaces, workspace, reload, onSelect, language, section, go }: { workspaces: Workspace[]; workspace: Workspace; reload: () => Promise<void>; onSelect: (id: string) => void; language: AppLanguage; section?: SettingsSection; go: (path: string) => void }) {
  const { user } = useUser();
  const { openUserProfile, signOut } = useClerk();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [role, setRole] = useState<'member' | 'reviewer'>('member');
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [members, setMembers] = useState<{ userId: string; role: Workspace['role'] }[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isArabic = language === 'ar';
  const roleName = (value: Workspace['role']) => language === 'ar'
    ? roleLabel[value]
    : language === 'fr'
      ? ({ owner: 'Propriétaire', reviewer: 'Relecteur autorisé', member: 'Membre' }[value])
      : ({ owner: 'Owner', reviewer: 'Authorized reviewer', member: 'Member' }[value]);
  const loadMembers = async () => {
    setMemberLoading(true); setMemberError('');
    try { const payload = await api<{ members: { userId: string; role: Workspace['role'] }[] }>(`/api/workspaces/${encodeURIComponent(workspace.id)}/members`); setMembers(payload.members ?? []); }
    catch (cause) { setMemberError(cause instanceof Error ? cause.message : (isArabic ? 'تعذر تحميل الأعضاء.' : language === 'fr' ? 'Impossible de charger les membres.' : 'Unable to load members.')); }
    finally { setMemberLoading(false); }
  };
  useEffect(() => { if (section !== 'workspaces') return; setMembers([]); void loadMembers(); }, [workspace.id, section]);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const payload = await api<{ workspace: Workspace }>('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: name.trim() }) }); await reload(); onSelect(payload.workspace.id); setName(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : (isArabic ? 'تعذر إنشاء المساحة.' : language === 'fr' ? 'Impossible de créer l’espace.' : 'Unable to create the workspace.')); }
    finally { setBusy(false); }
  };
  const join = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const payload = await api<{ workspace: Workspace }>('/api/workspaces/join', { method: 'POST', body: JSON.stringify({ code: code.trim() }) }); await reload(); onSelect(payload.workspace.id); setCode(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : (isArabic ? 'تعذر الانضمام.' : language === 'fr' ? 'Impossible de rejoindre l’espace.' : 'Unable to join the workspace.')); }
    finally { setBusy(false); }
  };
  const createInvite = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setInvite(null);
    try { setInvite(await api<{ code: string; expiresAt: string }>(`/api/workspaces/${encodeURIComponent(workspace.id)}/invites`, { method: 'POST', body: JSON.stringify({ role }) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : (isArabic ? 'تعذر إنشاء الدعوة.' : language === 'fr' ? 'Impossible de créer l’invitation.' : 'Unable to create the invitation.')); }
    finally { setBusy(false); }
  };
  const back = <button className="button button-quiet settings-back" type="button" onClick={() => go('/settings')} data-testid="button-settings-back"><ArrowLeft size={15} /> {isArabic ? 'العودة إلى الإعدادات' : language === 'fr' ? 'Retour aux paramètres' : 'Back to settings'}</button>;
  if (!section) {
    return <div className="content settings-overview">
      <PageHeading eyebrow={isArabic ? 'مركز التحكم' : language === 'fr' ? 'Centre de contrôle' : 'Control centre'} title={isArabic ? 'الإعدادات' : language === 'fr' ? 'Paramètres' : 'Settings'} description={isArabic ? 'إعدادات الحساب واللغة ومساحات العمل، في مكان واضح.' : language === 'fr' ? 'Compte, langue et espaces de travail, réunis au même endroit.' : 'Account, language, and workspace controls in one clear place.'} />
       <div className="settings-intro card"><ShieldCheck size={21} /><div><strong>{isArabic ? 'إدارة مساحة العمل' : language === 'fr' ? 'Gérer votre espace de travail' : 'Manage your workspace'}</strong><p>{isArabic ? 'الحساب واللغة ومساحات العمل والمراجع، في مكان واحد.' : language === 'fr' ? 'Compte, langue, espaces de travail et références au même endroit.' : 'Account, language, workspaces, and references in one place.'}</p></div></div>
      <div className="settings-card-grid">{settingSections.map(({ key, icon: Icon, tone, title, description }) => <button className="settings-card card" key={key} type="button" onClick={() => go(`/settings/${key}`)} data-testid={`card-settings-${key}`}><span className={`settings-card-icon ${tone}`}><Icon size={18} /></span><span className="settings-card-copy"><strong>{title[language]}</strong><small>{description[language]}</small></span><ChevronLeft size={17} className="settings-card-arrow" /></button>)}</div>
    </div>;
  }
  const sectionMeta = settingSections.find((item) => item.key === section);
  const title = sectionMeta?.title[language] ?? '';
  const renderAccount = () => <div className="settings-detail-stack"><div className="card settings-profile-card"><div className="profile-large">{(user?.firstName?.[0] || user?.fullName?.[0] || 'م').toUpperCase()}</div><div><span className="eyebrow">{isArabic ? 'الحساب الحالي' : language === 'fr' ? 'Compte actuel' : 'Current account'}</span><h3 data-testid="text-account-name">{user?.fullName || (isArabic ? 'مستخدم مساحة العمل' : language === 'fr' ? 'Membre de l’espace' : 'Workspace member')}</h3><p data-testid="text-account-email">{user?.primaryEmailAddress?.emailAddress || '—'}</p></div></div><div className="card settings-panel"><div className="setting-row"><div><strong>{isArabic ? 'إدارة الحساب والأمان' : language === 'fr' ? 'Gérer le compte et la sécurité' : 'Manage account and security'}</strong><p>{isArabic ? 'يفتح هذا الزر ملف الحساب داخل مِعيار لإدارة بياناتك وطرق الدخول.' : language === 'fr' ? 'Ce bouton ouvre le profil intégré à Miyar pour gérer vos données et vos méthodes de connexion.' : 'This opens the in-app profile to manage your details and sign-in methods.'}</p></div><div className="settings-account-actions"><button className="button button-primary" type="button" onClick={() => void openUserProfile()} data-testid="button-open-account-profile">{isArabic ? 'فتح إدارة الحساب' : language === 'fr' ? 'Gérer le compte' : 'Manage account'}</button><button className="button button-danger" type="button" onClick={() => void signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out">{isArabic ? 'تسجيل الخروج' : language === 'fr' ? 'Se déconnecter' : 'Sign out'}</button></div></div></div></div>;
  const selectLanguage = (item: AppLanguage) => {
    try {
      if (user?.id) localStorage.setItem(`miyar-language:${user.id}`, item);
    } catch { /* local preference is optional */ }
    document.documentElement.lang = item;
    document.documentElement.dir = item === 'ar' ? 'rtl' : 'ltr';
    window.dispatchEvent(new CustomEvent('miyar-language-change', { detail: item }));
  };
  const languageScope = (item: AppLanguage) => item === 'ar'
    ? (isArabic ? 'مساحة العمل' : language === 'fr' ? 'Tout l’espace' : 'Full workspace')
    : (isArabic ? 'القائمة والإعدادات فقط' : language === 'fr' ? 'Navigation et paramètres uniquement' : 'Navigation and Settings only');
  const renderLanguage = () => (
    <div className="settings-detail-stack">
      <div className="card settings-panel">
        <h3>{isArabic ? 'لغة الواجهة' : language === 'fr' ? 'Langue de l’interface' : 'Interface language'}</h3>
        <p className="settings-muted">{isArabic ? 'العربية متاحة في مساحة العمل كلها. تظهر الإنجليزية والفرنسية في القائمة والإعدادات فقط.' : language === 'fr' ? 'L’arabe est disponible dans tout l’espace. L’anglais et le français s’appliquent uniquement à la navigation et aux paramètres.' : 'Arabic is available throughout the workspace. English and French apply to navigation and Settings only.'}</p>
        <div className="language-options">
          {(['ar', 'en', 'fr'] as AppLanguage[]).map((item) => (
            <button
              className={`language-option ${language === item ? 'selected' : ''}`}
              type="button"
              key={item}
              aria-pressed={language === item}
              onClick={() => selectLanguage(item)}
              data-testid={`button-language-${item}`}
            >
              <strong>{item === 'ar' ? 'العربية' : item === 'en' ? 'English' : 'Français'}</strong>
              <span>{languageScope(item)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="card settings-panel">
        <Languages size={16} />
        <div>
          <h3>{isArabic ? 'لغة الادعاء المُرسل' : language === 'fr' ? 'Langue de l’affirmation' : 'Submitted claim language'}</h3>
          <p>{isArabic ? 'تُختار لغة الادعاء لكل مراجعة على حدة. يقارن مِعيار الاختيار بلغة النص ويعدّل البحث عند اختلافهما؛ وهذا مستقل عن لغة الواجهة.' : language === 'fr' ? 'La langue de l’affirmation se choisit pour chaque revue. Miyar la compare au texte et ajuste la recherche en cas de différence ; ce choix est distinct de la langue de l’interface.' : 'Choose the claim language for each review. Miyar checks it against the text and adjusts the search when they differ; this is separate from the interface language.'}</p>
        </div>
      </div>
    </div>
  );
  const renderWorkspaces = () => <div className="settings-detail-stack"><div className="workspace-grid"><form className="card workspace-form" onSubmit={create}><h3>{isArabic ? 'إنشاء مساحة فريق' : language === 'fr' ? 'Créer un espace d’équipe' : 'Create a team workspace'}</h3><div className="field"><label htmlFor="workspace-name">{isArabic ? 'اسم المساحة' : language === 'fr' ? 'Nom de l’espace' : 'Workspace name'}</label><input id="workspace-name" required value={name} onChange={(e) => setName(e.target.value)} data-testid="input-workspace-name" /></div><button className="button button-primary" disabled={busy || !name.trim()} data-testid="button-create-workspace">{isArabic ? 'إنشاء مساحة' : language === 'fr' ? 'Créer l’espace' : 'Create workspace'}</button></form><form className="card workspace-form" onSubmit={join}><h3>{isArabic ? 'الانضمام إلى مساحة' : language === 'fr' ? 'Rejoindre un espace' : 'Join a workspace'}</h3><div className="field"><label htmlFor="join-code">{isArabic ? 'رمز الدعوة' : language === 'fr' ? 'Code d’invitation' : 'Invitation code'}</label><input id="join-code" required value={code} onChange={(e) => setCode(e.target.value)} data-testid="input-join-code" /></div><button className="button button-outline" disabled={busy || !code.trim()} data-testid="button-join-workspace">{isArabic ? 'انضمام' : language === 'fr' ? 'Rejoindre' : 'Join'}</button></form></div>{error && <p className="inline-error" role="alert" data-testid="status-workspace-error">{error}</p>}<div className="card settings-panel"><div className="panel-heading"><div><h3 data-testid="text-current-workspace">{isArabic ? 'المساحة الحالية: ' : language === 'fr' ? 'Espace actuel : ' : 'Current workspace: '}{workspace.name}</h3><span>{workspace.isPersonal ? (isArabic ? 'شخصية · لا تُعرض للفريق' : language === 'fr' ? 'Personnel · non partagé avec l’équipe' : 'Personal · not shared with the team') : roleName(workspace.role)}</span></div><span className="tag">{workspaces.length} {isArabic ? 'مساحات' : language === 'fr' ? 'espaces' : 'workspaces'}</span></div>{workspace.role === 'owner' && !workspace.isPersonal && <form className="action-form" onSubmit={createInvite}><h4>{isArabic ? 'دعوة عضو' : language === 'fr' ? 'Inviter un membre' : 'Invite a member'}</h4><div className="field"><label htmlFor="invite-role">{isArabic ? 'صلاحية المدعو' : language === 'fr' ? 'Rôle invité' : 'Invitee role'}</label><select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'reviewer')} data-testid="select-invite-role"><option value="member">{isArabic ? 'عضو · يقدم الأدلة' : language === 'fr' ? 'Membre · fournit des preuves' : 'Member · submits evidence'}</option><option value="reviewer">{isArabic ? 'مراجع مخوّل · يقرر' : language === 'fr' ? 'Relecteur · prend les décisions' : 'Reviewer · makes decisions'}</option></select></div><button className="button button-primary" disabled={busy} data-testid="button-create-invite">{isArabic ? 'إنشاء رمز دعوة' : language === 'fr' ? 'Créer un code' : 'Create invite code'}</button>{invite && <div className="inline-success" role="status" data-testid="text-invite-code"><strong>{isArabic ? 'رمز الدعوة: ' : language === 'fr' ? 'Code : ' : 'Invite code: '}<span dir="ltr">{invite.code}</span></strong><br />{isArabic ? 'تنتهي صلاحية الدعوة: ' : language === 'fr' ? 'Expiration : ' : 'Expires: '}{formatCaseDate(invite.expiresAt)}<br />{isArabic ? 'شارك الرمز مع الشخص المقصود عبر قناة آمنة.' : language === 'fr' ? 'Partagez-le avec la personne concernée par un canal sûr.' : 'Share the code with the intended person through a safe channel.'}</div>}</form>}{!workspace.isPersonal && workspace.role !== 'owner' && <p className="settings-muted">{isArabic ? 'الدعوات متاحة لمالك المساحة فقط.' : language === 'fr' ? 'Seul le propriétaire peut inviter des membres.' : 'Only the workspace owner can invite members.'}</p>}<div className="setting-row"><div><strong>{isArabic ? 'الأعضاء' : language === 'fr' ? 'Membres' : 'Members'}</strong><p>{isArabic ? 'الدور يحدد الصلاحية داخل المساحة، وليس مؤهلًا علميًا.' : language === 'fr' ? 'Le rôle définit les permissions dans l’espace, pas une qualification religieuse.' : 'A role defines permissions in the workspace, not religious qualification.'}</p></div><button className="button button-outline" type="button" onClick={() => void loadMembers()} data-testid="button-refresh-members">{isArabic ? 'تحديث' : language === 'fr' ? 'Actualiser' : 'Refresh'}</button></div>{memberLoading ? <div className="skeleton" role="status" data-testid="status-members-loading" /> : memberError ? <div className="inline-error" role="alert" data-testid="status-members-error">{memberError} <button className="text-link" type="button" onClick={() => void loadMembers()} data-testid="button-retry-members">{isArabic ? 'إعادة المحاولة' : language === 'fr' ? 'Réessayer' : 'Retry'}</button></div> : members.length ? members.map((member, index) => <div className="setting-row" key={`${member.userId}-${index}`} data-testid={`row-workspace-member-${index}`}><div><strong>{isArabic ? `عضو في المساحة ${index + 1}` : language === 'fr' ? `Membre de l’espace ${index + 1}` : `Workspace member ${index + 1}`}</strong></div><span className="tag">{roleName(member.role)}</span></div>) : <p className="settings-muted" data-testid="text-members-empty">{isArabic ? 'لا يظهر أعضاء في هذه المساحة.' : language === 'fr' ? 'Aucun membre à afficher dans cet espace.' : 'No members are visible in this workspace.'}</p>}</div></div>;
  const renderNotifications = () => (
    <div className="card settings-panel settings-unavailable">
      <BellRing size={22} />
      <div>
        <h3>{isArabic ? 'الإشعارات غير متاحة حاليًا' : language === 'fr' ? 'Notifications indisponibles pour le moment' : 'Notifications are unavailable right now'}</h3>
        <p>{isArabic ? 'لا توجد تفضيلات إشعارات قابلة للتغيير.' : language === 'fr' ? 'Aucune préférence de notification ne peut être modifiée.' : 'Notification preferences cannot be changed.'}</p>
        <span className="tag">{isArabic ? 'غير متاح حاليًا' : language === 'fr' ? 'Indisponible' : 'Unavailable'}</span>
      </div>
    </div>
  );
  const renderPrivacy = () => <div className="settings-detail-stack"><div className="card settings-panel"><div className="section-icon"><LockKeyhole size={20} /></div><h3>{isArabic ? 'إدارة الحساب والأمان' : language === 'fr' ? 'Compte et sécurité' : 'Account and security'}</h3><p>{isArabic ? 'تُدار إعدادات الدخول والأمان من خلال ملف الحساب.' : language === 'fr' ? 'Les paramètres de connexion et de sécurité se gèrent depuis le profil du compte.' : 'Sign-in and security settings are managed through your account profile.'}</p><button className="button button-primary" type="button" onClick={() => void openUserProfile()} data-testid="button-open-security-profile">{isArabic ? 'فتح ملف الحساب' : language === 'fr' ? 'Ouvrir le profil' : 'Open account profile'}</button></div></div>;
  const renderSources = () => <div className="settings-detail-stack"><div className="card settings-panel"><h3>{isArabic ? 'أنواع المصادر الحالية' : language === 'fr' ? 'Types de sources actuels' : 'Current source types'}</h3><div className="source-type-list">{(isArabic ? ['القرآن', 'الحديث', 'التفسير', 'الفتاوى', 'قرارات الفقه الجماعية', 'مصادر خارجية معتمدة'] : language === 'fr' ? ['Coran', 'Hadith', 'Tafsir', 'Fatwas', 'Résolutions collectives de fiqh', 'Sources externes approuvées'] : ['Quran', 'Hadith', 'Tafsir', 'Fatwas', 'Collective fiqh resolutions', 'Approved external sources']).map((item) => <span className="tag" key={item} data-testid={`tag-source-type-${item}`}>{item}</span>)}</div></div><div className="notice notice-warn"><Info size={16} /><div><strong>{isArabic ? 'تحقّق من الإحالة في المصدر الأصلي' : language === 'fr' ? 'Vérifiez la référence dans la source originale' : 'Check the citation in the original source'}</strong><p>{isArabic ? 'قارن النص والسياق قبل الاستشهاد، وراجع أي مقتطف معروض.' : language === 'fr' ? 'Comparez le texte et son contexte avant de citer, et vérifiez tout extrait affiché.' : 'Compare the text and context before citing, and check any excerpt shown.'}</p></div></div></div>;
  const policyDocuments = [
    {
      id: 'policy-terms',
      testId: 'terms',
      title: { ar: 'شروط الاستخدام', en: 'Terms of Use', fr: 'Conditions d’utilisation' },
      text: {
        ar: 'مِعيار مساحة لمراجعة الأدلة والمحتوى. النتائج أولية وتستلزم مراجعة بشرية. تبقى مسؤولية قرارات النشر والاستخدام عليك. لا ترسل عمدًا بيانات غير مشروعة أو بيانات شخصية شديدة الحساسية.',
        en: 'Miyar is a workspace for evidence and content review. Results are preliminary and require human review. You remain responsible for publication and use decisions. Do not intentionally submit unlawful or highly sensitive personal data.',
        fr: 'Miyar est un espace d’examen des preuves et des contenus. Les résultats sont préliminaires et doivent être examinés par une personne. Vous restez responsable de vos décisions de publication et d’utilisation. Ne soumettez pas intentionnellement de données illicites ou personnelles hautement sensibles.',
      },
    },
    {
      id: 'policy-privacy',
      testId: 'privacy',
      title: { ar: 'سياسة الخصوصية', en: 'Privacy Policy', fr: 'Politique de confidentialité' },
      text: {
        ar: 'تُدار المصادقة عبر Clerk. قد تُحفظ بيانات المساحات والحالات والمراجعات في قاعدة بيانات التطبيق (PostgreSQL). عند طلب المراجعة، قد تُعالج المطالبة والسياق المرسل بواسطة خدمات الذكاء الاصطناعي المستخدمة في مِعيار. وعند البحث في المصادر الخارجية، قد يُرسل استعلام مشتق من المطالبة إلى خدمات البحث أو الذكاء الاصطناعي التي تنفذ البحث.',
        en: 'Sign-in is handled by Clerk. Workspace, case, and review data may be stored in Miyar’s application database (PostgreSQL). When you request a review, the submitted claim and context may be processed by the AI services used by Miyar. When external sources are searched, a query derived from the claim may be sent to the search or AI services that perform the search.',
        fr: 'La connexion est gérée par Clerk. Les données des espaces, des dossiers et des revues peuvent être stockées dans la base de données de Miyar (PostgreSQL). Lorsque vous demandez une revue, l’affirmation et le contexte soumis peuvent être traités par les services d’IA utilisés par Miyar. La recherche de sources externes peut transmettre une requête dérivée de l’affirmation aux services de recherche ou d’IA concernés.',
      },
    },
    {
      id: 'policy-attribution',
      testId: 'attribution',
      title: { ar: 'سياسة المصادر والإسناد', en: 'Source / Attribution Policy', fr: 'Politique des sources et de l’attribution' },
      text: {
        ar: 'مصادر مِعيار الحالية:\n• نص القرآن الكريم: مشروع تنزيل (Tanzil Project).\n• التفسير: QuranEnc — المختصر في تفسير القرآن الكريم.\n• نطاقات الاسترجاع الخارجي المعتمدة: dorar.net، binbaz.org.sa، alifta.gov.sa، binothaimeen.net، iifa-aifi.org.\nتغطية مِعيار المحلية من صحيحي البخاري ومسلم مقتطفات تجريبية محدودة، وليست الكتابين كاملين. ولا يعني ظهور نتيجة من مصدر معتمد ثبوت صحة الادعاء. يحافظ مِعيار على بيانات الإحالة ويربط بالمصدر الأصلي عند توفره.',
        en: 'Current Miyar sources:\n• Quran text: Tanzil Project.\n• Tafsir: QuranEnc — Al-Mukhtasar fi Tafsir al-Qur’an al-Karim (المختصر في تفسير القرآن الكريم).\n• Approved external retrieval domains: dorar.net, binbaz.org.sa, alifta.gov.sa, binothaimeen.net, and iifa-aifi.org.\nMiyar’s local coverage of Sahih al-Bukhari and Sahih Muslim consists of limited demo excerpts, not the full collections. A result from an approved source does not by itself establish that a claim is correct. Miyar preserves citation provenance and links to the original source where available.',
        fr: 'Sources actuelles de Miyar :\n• Texte coranique : Tanzil Project.\n• Tafsir : QuranEnc — Al-Mukhtasar fi Tafsir al-Qur’an al-Karim (المختصر في تفسير القرآن الكريم).\n• Domaines approuvés pour la recherche externe : dorar.net, binbaz.org.sa, alifta.gov.sa, binothaimeen.net et iifa-aifi.org.\nLa couverture locale de Sahih al-Bukhari et Sahih Muslim se limite à des extraits de démonstration ; les recueils complets ne sont pas inclus. Un résultat provenant d’une source approuvée ne suffit pas à établir la véracité d’une affirmation. Miyar conserve la provenance des références et renvoie à la source originale lorsque le lien est disponible.',
      },
    },
    {
      id: 'policy-disclaimer',
      testId: 'disclaimer',
      title: { ar: 'إخلاء المسؤولية', en: 'Disclaimer', fr: 'Avertissement' },
      text: {
        ar: 'مِعيار لا يصدر فتاوى ولا يحل محل مراجعة أهل العلم المؤهلين.',
        en: 'Miyar does not issue fatwas or replace review by qualified scholars.',
        fr: 'Miyar ne rend pas de fatwas et ne remplace pas l’examen par des personnes qualifiées en sciences islamiques.',
      },
    },
  ];
  const renderPolicies = () => (
    <div className="settings-detail-stack">
      <div className="notice notice-info" role="note">
        <Info size={16} />
        <div>
          <strong>{isArabic ? 'ملخصات معلوماتية' : language === 'fr' ? 'Résumés informatifs' : 'Informational summaries'}</strong>
          <p>{isArabic ? 'هذه ملخصات للقراءة وليست نصوصًا قانونية كاملة أو استشارة قانونية.' : language === 'fr' ? 'Ces résumés sont fournis à titre informatif ; ils ne constituent ni des textes juridiques complets ni un conseil juridique.' : 'These summaries are informational, not complete legal documents or legal advice.'}</p>
        </div>
      </div>
      <nav className="card settings-panel policy-links" aria-label={isArabic ? 'روابط السياسات' : language === 'fr' ? 'Liens des politiques' : 'Policy links'}>
        {policyDocuments.map((policy) => (
          <a href={`#${policy.id}`} key={policy.id} data-testid={`link-policy-${policy.testId}`}>{policy.title[language]}</a>
        ))}
      </nav>
      {policyDocuments.map((policy) => (
        <article className="card settings-panel policy-reading" id={policy.id} key={policy.id} aria-labelledby={`${policy.id}-title`}>
          <h3 id={`${policy.id}-title`}>{policy.title[language]}</h3>
          <p>{policy.text[language]}</p>
        </article>
      ))}
    </div>
  );
  const renderAbout = () => <div className="settings-detail-stack"><div className="card settings-about"><span className="about-mark">م</span><div><h3>مِعيار · Miyar</h3><p>{isArabic ? 'مساحة عربية أولًا لفرز الادعاءات الإسلامية، وتتبع مصادرها، وإبقاء القرار ضمن مراجعة بشرية.' : language === 'fr' ? 'Un espace Arabic-first pour trier les affirmations islamiques, tracer leurs sources et garder la décision dans une revue humaine.' : 'An Arabic-first workspace for triaging Islamic claims, tracing their sources, and keeping decisions within human review.'}</p><p>{isArabic ? 'مِعيار ليس خدمة فتوى؛ هو أداة تنظيم ومراجعة للأفراد والفرق.' : language === 'fr' ? 'Miyar n’est pas un service de fatwa ; c’est un outil d’organisation et de revue pour les personnes et les équipes.' : 'Miyar is not a fatwa service; it is an organization and review tool for individuals and teams.'}</p></div></div><div className="card settings-panel"><h3>{isArabic ? 'الدعم والتواصل' : language === 'fr' ? 'Assistance et contact' : 'Support & contact'}</h3><p>{isArabic ? 'سيظهر هنا عنوان التواصل الرسمي عند اعتماده. لا تستخدم هذه الصفحة لإرسال أسرار أو بيانات حساسة.' : language === 'fr' ? 'Le canal officiel apparaîtra ici lorsqu’il sera validé. N’envoyez pas de secrets ni de données sensibles sur cette page.' : 'The official contact channel will appear here once approved. Do not send secrets or sensitive data on this page.'}</p><span className="support-placeholder" data-testid="text-support-placeholder">{isArabic ? 'قناة الدعم: ستُعلن لاحقًا' : language === 'fr' ? 'Support : sera annoncé ultérieurement' : 'Support channel: to be announced'}</span></div></div>;
  const renderAboutPublic = () => <div className="settings-detail-stack"><div className="card settings-about"><img className="about-logo" src={miyarSidebarLogoPath} alt="" /><div><h3>مِعيار · Miyar</h3><p>{isArabic ? 'مساحة للأفراد والفرق لمراجعة الادعاءات الإسلامية وتتبع مصادرها.' : language === 'fr' ? 'Un espace pour les personnes et les équipes afin d’examiner les affirmations islamiques et d’en tracer les sources.' : 'A workspace for individuals and teams to review Islamic claims and trace their sources.'}</p></div></div></div>;
  const body = section === 'account' ? renderAccount() : section === 'language' ? renderLanguage() : section === 'workspaces' ? renderWorkspaces() : section === 'notifications' ? renderNotifications() : section === 'privacy' ? renderPrivacy() : section === 'sources' ? renderSources() : section === 'policies' ? renderPolicies() : section === 'about' ? renderAboutPublic() : renderAbout();
  return <div className="content settings-detail"><div className="settings-detail-header">{back}<PageHeading eyebrow={isArabic ? 'الإعدادات' : language === 'fr' ? 'Paramètres' : 'Settings'} title={title} description={sectionMeta?.description[language] ?? ''} /></div>{body}</div>;
}

function AppContent() {
  const [location, setLocation] = useLocation();
  const { user } = useUser();
  const [language, setLanguage] = useState<AppLanguage>('ar');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const membershipRef = useRef<Workspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState('');
  const [cases, setCases] = useState<EvidenceCase[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesError, setCasesError] = useState('');
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [savedSourcesLoading, setSavedSourcesLoading] = useState(false);
  const [savedSourceBusyId, setSavedSourceBusyId] = useState<string | null>(null);
  const [savedSourcesError, setSavedSourcesError] = useState('');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityError, setActivityError] = useState('');
  const [reviews, setReviews] = useState<CaseReview[]>([]);
  const [reviewsError, setReviewsError] = useState('');
  const [toast, setToast] = useState('');
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const activeWorkspaceIdRef = useRef(workspaceId);
  activeWorkspaceIdRef.current = workspaceId;
  const preferenceKey = user?.id ? `miyar-workspace:${user.id}` : '';
  useEffect(() => {
    let saved: AppLanguage = 'ar';
    if (user?.id) {
      try {
        const value = localStorage.getItem(`miyar-language:${user.id}`);
        if (value === 'ar' || value === 'en' || value === 'fr') saved = value;
      } catch { /* local preference is optional */ }
    }
    setLanguage(saved);
  }, [user?.id]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);
  useEffect(() => {
    const handleLanguageChange = (event: Event) => {
      const next = (event as CustomEvent<AppLanguage>).detail;
      if (next === 'ar' || next === 'en' || next === 'fr') setLanguage(next);
    };
    window.addEventListener('miyar-language-change', handleLanguageChange);
    return () => window.removeEventListener('miyar-language-change', handleLanguageChange);
  }, []);
  const selectWorkspace = (id: string) => {
    if (!membershipRef.current.some((item) => item.id === id)) return;
    if (location.startsWith('/check/')) setLocation('/check');
    setWorkspaceId(id);
    if (preferenceKey) { try { localStorage.setItem(preferenceKey, id); } catch { /* The preference is optional. */ } }
  };
  const reloadWorkspaces = async () => {
    setWorkspacesLoading(true); setWorkspaceError('');
    try {
      const payload = await api<{ workspaces: Workspace[] }>('/api/workspaces');
      const list = payload.workspaces ?? [];
      membershipRef.current = list;
      setWorkspaces(list);
      let preferred = '';
      if (preferenceKey) { try { preferred = localStorage.getItem(preferenceKey) || ''; } catch { /* Fall back to personal space. */ } }
      setWorkspaceId((current) => list.some((item) => item.id === current) ? current : list.some((item) => item.id === preferred) ? preferred : list.find((item) => item.isPersonal)?.id ?? list[0]?.id ?? '');
    } catch (cause) { setWorkspaceError(cause instanceof Error ? cause.message : 'تعذر تحميل المساحات.'); }
    finally { setWorkspacesLoading(false); }
  };
  useEffect(() => {
    membershipRef.current = [];
    setWorkspaces([]); setWorkspaceId(''); setCases([]); setWorkspacesLoading(true);
    if (user?.id) void reloadWorkspaces();
  }, [user?.id]);
  const refreshCases = async () => {
    if (!workspaceId) return;
    setCasesLoading(true); setCasesError('');
    try {
      const payload = await api<{ cases: EvidenceCase[] }>(`/api/cases?${workspaceQuery(workspaceId)}`);
      setCases((payload.cases ?? []).map((item) => ({ ...item, sources: item.sources ?? [], evidence: item.evidence ?? [] })));
    } catch (cause) { setCasesError(cause instanceof Error ? cause.message : 'تعذر تحميل الحالات.'); throw cause; }
    finally { setCasesLoading(false); }
  };
  const refreshActivities = async () => {
    if (!workspaceId) return;
    const requestedWorkspaceId = workspaceId;
    setActivityError('');
    try {
      const payload = await api<{ activities: Activity[] }>(`/api/activity?${workspaceQuery(requestedWorkspaceId)}`);
      if (activeWorkspaceIdRef.current === requestedWorkspaceId) setActivities(payload.activities ?? []);
    } catch (cause) {
      if (activeWorkspaceIdRef.current === requestedWorkspaceId) setActivityError(cause instanceof Error ? cause.message : 'تعذر تحميل سجل النشاط.');
    }
  };
  const refreshReviews = async () => {
    if (!workspaceId) return;
    const requestedWorkspaceId = workspaceId;
    setReviewsError('');
    try {
      const payload = await api<{ reviews: CaseReview[] }>(`/api/reviews?${workspaceQuery(requestedWorkspaceId)}`);
      if (activeWorkspaceIdRef.current === requestedWorkspaceId) setReviews(payload.reviews ?? []);
    } catch (cause) {
      if (activeWorkspaceIdRef.current === requestedWorkspaceId) setReviewsError(cause instanceof Error ? cause.message : 'تعذر تحميل سجل المراجعات.');
    }
  };
  const refreshSavedSources = async () => {
    if (!workspaceId) return;
    const requestedWorkspaceId = workspaceId;
    setSavedSourcesLoading(true); setSavedSourcesError('');
    try {
      const payload = await api<{ sources: { sourceId: string }[] }>(`/api/sources/saved?${workspaceQuery(requestedWorkspaceId)}`);
      if (activeWorkspaceIdRef.current === requestedWorkspaceId) setSavedIds((payload.sources ?? []).map((item) => item.sourceId));
    } catch (cause) {
      if (activeWorkspaceIdRef.current === requestedWorkspaceId) setSavedSourcesError(cause instanceof Error ? cause.message : 'تعذر تحميل المصادر المحفوظة.');
    } finally {
      if (activeWorkspaceIdRef.current === requestedWorkspaceId) setSavedSourcesLoading(false);
    }
  };
  const refreshWorkspaceHistory = async () => {
    await Promise.all([refreshActivities(), refreshReviews(), refreshSavedSources()]);
  };
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setCases([]); setCasesError(''); setCasesLoading(true);
    void api<{ cases: EvidenceCase[] }>(`/api/cases?${workspaceQuery(workspaceId)}`).then((payload) => {
      if (active) setCases((payload.cases ?? []).map((item) => ({ ...item, sources: item.sources ?? [], evidence: item.evidence ?? [] })));
    }).catch((cause) => { if (active) setCasesError(cause instanceof Error ? cause.message : 'تعذر تحميل الحالات.'); }).finally(() => { if (active) setCasesLoading(false); });
    return () => { active = false; };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    setActivities([]); setReviews([]); setSavedIds([]);
    void refreshWorkspaceHistory();
    const interval = window.setInterval(() => { void refreshWorkspaceHistory(); }, 60_000);
    return () => window.clearInterval(interval);
  }, [workspaceId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const notify = (message: string) => setToast(message);
  const go = (path: string) => setLocation(path);
  const onDecision = async (id: string, status: CaseStatus, reviewerNote: string) => {
    if (!workspace || !canReview(workspace)) throw new Error('ليست لديك صلاحية اتخاذ القرار.');
    await api(`/api/cases/${encodeURIComponent(id)}/decision`, { method: 'PATCH', body: JSON.stringify({ workspaceId: workspace.id, status, reviewerNote }) });
    notify('حُفظ قرار المراجعة.');
    try {
      await refreshCases();
    } catch {
      notify('حُفظ القرار، لكن تعذر تحديث قائمة الحالات.');
    }
    await refreshWorkspaceHistory();
  };
  const toggleSaved = async (id: string) => {
    if (!workspace) return;
    const wasSaved = savedIds.includes(id);
    setSavedSourceBusyId(id);
    try {
      if (wasSaved) {
        await api(`/api/sources/saved/${encodeURIComponent(id)}?${workspaceQuery(workspace.id)}`, { method: 'DELETE' });
      } else {
        await api('/api/sources/saved', { method: 'POST', body: JSON.stringify({ workspaceId: workspace.id, sourceId: id }) });
      }
      await refreshSavedSources();
      notify(wasSaved ? 'أزيل المصدر من مساحة العمل.' : 'حُفظ المصدر في مساحة العمل.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'تعذر حفظ المصدر.';
      setSavedSourcesError(message);
      notify(message);
    } finally {
      setSavedSourceBusyId(null);
    }
  };
  const view: ViewName = location === '/check' ? 'check' : location === '/reviews' ? 'reviews' : location === '/sources' ? 'sources' : location === '/analytics' ? 'analytics' : location === '/settings' || location.startsWith('/settings/') ? 'settings' : 'dashboard';
  const selectedId = location.startsWith('/check/') ? decodeURIComponent(location.slice('/check/'.length)) : undefined;
  const resolvedView: ViewName = selectedId ? 'check' : view;
  const settingsSectionPath = location.startsWith('/settings/') ? location.slice('/settings/'.length).split('/')[0] : '';
  const settingsSection = settingSections.some((item) => item.key === settingsSectionPath) ? settingsSectionPath as SettingsSection : undefined;
  return <AppShell currentPath={location} workspaces={workspaces} workspace={workspace} onSelect={selectWorkspace} language={language}>
    {workspacesLoading ? <div className="content loading-panel" role="status"><div className="skeleton large" /><div className="skeleton" /></div> : workspaceError ? <div className="content"><div className="notice notice-danger" role="alert"><AlertCircle size={17} /><div><strong>تعذر تحميل مساحات العمل</strong><p>{workspaceError}</p><button className="button button-outline" onClick={() => void reloadWorkspaces()} data-testid="button-retry-workspaces">إعادة المحاولة</button></div></div></div> : !workspace ? <div className="content empty-state"><h3>لا توجد مساحة متاحة</h3><p>أعد تحميل المساحات أو تواصل مع مسؤول الحساب.</p><button className="button button-outline" onClick={() => void reloadWorkspaces()}>إعادة المحاولة</button></div> : <>
    {casesLoading && resolvedView !== 'settings' && resolvedView !== 'sources' && <div className="content loading-panel" role="status"><div className="skeleton large" /><div className="skeleton" /><div className="skeleton" /></div>}
    {!casesLoading && casesError && resolvedView !== 'settings' && resolvedView !== 'sources' && <div className="content"><div className="notice notice-danger" role="alert"><AlertCircle size={17} /><div><strong>تعذر تحديث حالات المساحة</strong><p>{casesError} قد تكون الحالة قد حُفظت بالفعل؛ تحقق من القائمة قبل إعادة إرسال أي نتيجة.</p><button className="button button-outline" onClick={() => void refreshCases().catch(() => undefined)} data-testid="button-retry-cases">إعادة تحميل الحالات</button></div></div></div>}
    {((!casesLoading && !casesError) || resolvedView === 'settings' || resolvedView === 'sources') && <>
    {resolvedView === 'dashboard' && <Dashboard cases={cases} activities={activities} activityError={activityError} refreshActivities={refreshActivities} go={go} />}
    {resolvedView === 'check' && <CheckPage key={workspace.id} cases={cases} selectedId={selectedId} go={go} workspace={workspace} refreshCases={refreshCases} notify={notify} />}
    {resolvedView === 'reviews' && <ReviewsPage cases={cases} reviews={reviews} reviewsError={reviewsError} workspace={workspace} onDecision={onDecision} go={go} />}
    {resolvedView === 'sources' && <SourcesPage sources={sourceSeed} savedIds={savedIds} savedSourcesLoading={savedSourcesLoading} savedSourceBusyId={savedSourceBusyId} savedSourcesError={savedSourcesError} refreshSavedSources={refreshSavedSources} toggleSaved={toggleSaved} />}
    {resolvedView === 'analytics' && <AnalyticsPage cases={cases} />}
    {resolvedView === 'settings' && <SettingsPage workspaces={workspaces} workspace={workspace} reload={reloadWorkspaces} onSelect={selectWorkspace} language={language} section={settingsSection} go={go} />}
    </>}
    </>}
    {toast && <div className="toast" role="status" data-testid="toast-message">{toast}</div>}
  </AppShell>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function SignedOutLanding() {
  return <div className="auth-landing" dir="rtl">
    <div className="auth-landing-card">
      <img className="auth-wordmark" src={miyarLogoPath} alt="شعار مِعيار" />
      <div className="eyebrow">مساحة لمراجعة الأدلة</div>
       <h1>راجع الادعاء ومصادره قبل نشره.</h1>
       <p>مساحة لتنظيم الادعاءات والأدلة ومراجعات الفريق.</p>
      <div className="auth-landing-actions">
        <Link className="button button-primary" href="/sign-in">تسجيل الدخول</Link>
        <Link className="button button-secondary" href="/sign-up">إنشاء حساب</Link>
      </div>
    </div>
  </div>;
}

function SignInPage() {
  return <div className="auth-page" dir="rtl">
    <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
  </div>;
}

function SignUpPage() {
  return <div className="auth-page" dir="rtl">
    <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
  </div>;
}

function WorkspaceRoutes() {
  return <Show when="signed-in" fallback={<SignedOutLanding />}>
    <RoutedErrorBoundary><AppContent /></RoutedErrorBoundary>
  </Show>;
}

function ClerkApp() {
  const [, setLocation] = useLocation();
  const stripBase = (path: string) => basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Switch>
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route component={WorkspaceRoutes} />
        </Switch>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </ClerkProvider>;
}

function App() {
  if (!clerkPubKey) {
    throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in the environment.');
  }
  return <WouterRouter base={basePath}><ClerkApp /></WouterRouter>;
}

export default App;
