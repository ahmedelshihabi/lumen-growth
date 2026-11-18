import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, PageHeader, cx } from '../components/ui';
import { primaryBtn } from '../components/Gates';
import { supabase } from '../lib/supabase';
import { Link } from '../lib/router';
import { useSession } from '../state/SessionContext';
import { useApp } from '../state/AppContext';
import { useI18n } from '../i18n';
import { DICTS, type DictKey } from '../i18n/dict';
import {
  CREATE_OBJECTIVES,
  CTA_TYPES,
  GENDERS,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_TARGETING_ITEMS,
  MAX_CAROUSEL_CARDS,
  CONVERSION_EVENTS,
  DEFAULT_URL_TAGS,
  MESSAGE_APPS,
  PLATFORMS,
  defaultEvent,
  isMessages,
  usesPixel,
  minDailyBudget,
  validateCreateAdInput,
  type TargetingItem,
  type GeoLocation,
  type MessageApp,
  type ConversionEvent,
  type Platform,
  type TargetingOption,
  type CreateAdInput,
  type CreateObjective,
  type CtaType,
  type Gender,
} from '../../supabase/functions/_shared/meta-create.ts';

interface AccountOption {
  id: string; // act_...
  name: string;
  currency: string;
}
interface PageOption {
  id: string;
  name: string;
  instagram?: { id: string; username: string | null } | null;
}

interface AudienceOption {
  id: string;
  name: string;
  subtype: string | null;
  sizeLower: number | null;
  sizeUpper: number | null;
}

interface GeoOption {
  key: string;
  name: string;
  type: 'city' | 'region';
  region: string | null;
  country: string | null;
}

/** Demo mode: offline samples so the new sections can be tried without Meta. */
const DEMO_AUDIENCES: AudienceOption[] = [
  { id: '230000000000001', name: 'Website visitors 30d', subtype: 'WEBSITE', sizeLower: 52000, sizeUpper: 61000 },
  { id: '230000000000002', name: 'Purchasers 180d', subtype: 'WEBSITE', sizeLower: 8100, sizeUpper: 9500 },
  { id: '230000000000003', name: 'Lookalike (EG, 1%) - Purchasers', subtype: 'LOOKALIKE', sizeLower: 880000, sizeUpper: 1000000 },
];
const DEMO_GEO: GeoOption[] = [
  { key: '1522000', name: 'Cairo', type: 'city', region: 'Cairo Governorate', country: 'EG' },
  { key: '1522001', name: 'Giza', type: 'city', region: 'Giza Governorate', country: 'EG' },
  { key: '1522002', name: 'Alexandria', type: 'city', region: 'Alexandria Governorate', country: 'EG' },
  { key: '1522003', name: 'Mansoura', type: 'city', region: 'Dakahlia Governorate', country: 'EG' },
  { key: '3400', name: 'Cairo Governorate', type: 'region', region: null, country: 'EG' },
  { key: '2880000', name: 'Riyadh', type: 'city', region: 'Riyadh Region', country: 'SA' },
  { key: '2880001', name: 'Jeddah', type: 'city', region: 'Makkah Region', country: 'SA' },
  { key: '2890000', name: 'Dubai', type: 'city', region: 'Dubai', country: 'AE' },
];
const RADII = [0, 10, 15, 25, 40, 60, 80];

/** Sub-section with a heading; a div (not a label) so it can hold several controls. */
function Block({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="sm:col-span-2">
      <div className="mb-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">{title}</div>
      {hint && <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      {children}
    </div>
  );
}

const chip = (on: boolean) =>
  cx(
    'rounded-full border px-3 py-1 text-xs font-medium',
    on ? 'border-brand-600 bg-brand-600 text-white' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
  );
interface PixelOption {
  id: string;
  name: string;
}
interface CreateResult {
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  ads_manager_url: string;
}

/** Countries offered as quick picks (Egypt + GCC + nearby markets). */
const COUNTRIES = ['EG', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO', 'IQ', 'LB', 'MA', 'US', 'GB'];

const UNIT_KEYS = ['currencyUnit.EGP', 'currencyUnit.SAR', 'currencyUnit.AED', 'currencyUnit.KWD', 'currencyUnit.QAR', 'currencyUnit.USD'];
const DEMO_PAGES: PageOption[] = [{ id: '100000000000001', name: 'Lumen Store' }];
const DEMO_PIXELS: PixelOption[] = [{ id: '200000000000001', name: 'Lumen Store Pixel' }];

/** Demo mode: a small offline catalogue so the targeting picker can be tried without Meta. */
const DEMO_TARGETING: TargetingOption[] = (
  [
    ['6003397425735', 'Headphones', 'interests', ['Interests', 'Technology', 'Consumer electronics'], 180e6],
    ['6003252179711', 'Smartphones', 'interests', ['Interests', 'Technology', 'Consumer electronics'], 900e6],
    ['6003012317397', 'Consumer electronics', 'interests', ['Interests', 'Technology'], 1.1e9],
    ['6003107902433', 'Online shopping', 'interests', ['Interests', 'Shopping and fashion', 'Shopping'], 1.3e9],
    ['6003384248805', 'Fitness and wellness', 'interests', ['Interests', 'Fitness and wellness'], 700e6],
    ['6003940339466', 'Running', 'interests', ['Interests', 'Sports and outdoors', 'Sports'], 300e6],
    ['6003349442621', 'Gaming', 'interests', ['Interests', 'Entertainment', 'Games'], 1.2e9],
    ['6003020834693', 'Music', 'interests', ['Interests', 'Entertainment'], 1.9e9],
    ['6071631541183', 'Engaged Shoppers', 'behaviors', ['Behaviors', 'Purchase behavior'], 900e6],
    ['6003808923172', 'Technology early adopters', 'behaviors', ['Behaviors', 'Digital activities'], 120e6],
    ['6002714898572', 'Small business owners', 'behaviors', ['Behaviors', 'Digital activities'], 100e6],
    ['6017476616183', 'Recently moved', 'life_events', ['Demographics', 'Life events'], 40e6],
    ['6002714398172', 'Newly engaged (6 months)', 'life_events', ['Demographics', 'Life events'], 20e6],
  ] as const
).map(([id, name, type, path, size]) => ({ id, name, type, path: [...path], sizeLower: size * 0.85, sizeUpper: size }));

const compactNum = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
function audienceSize(o: TargetingOption): string {
  if (o.sizeLower == null || o.sizeUpper == null) return '';
  return `${compactNum.format(o.sizeLower)}–${compactNum.format(o.sizeUpper)}`;
}
const typeLabelKey = (type: TargetingOption['type']): DictKey =>
  type === 'interests' || type === 'behaviors' || type === 'life_events' ? `createAd.targetType.${type}` : 'createAd.targetType.demographics';

const input =
  'h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

const errKey = (code: string): DictKey | null => {
  const k = `createAd.err.${code}`;
  return k in DICTS.en ? (k as DictKey) : null;
};

/** Reads the JSON body of a failed functions.invoke() call ({ error, message, errors? }). */
async function invokeError(error: unknown): Promise<{ code: string; message: string; errors?: string[] }> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const b = (await ctx.json()) as { error?: string; message?: string; errors?: string[] };
      return { code: b.error ?? 'unknown', message: b.message ?? '', errors: b.errors };
    } catch {
      /* fall through */
    }
  }
  return { code: 'unknown', message: error instanceof Error ? error.message : String(error) };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function Field({ label, hint, children, full }: { label: ReactNode; hint?: ReactNode; children: ReactNode; full?: boolean }) {
  return (
    <label className={cx('block', full && 'sm:col-span-2')}>
      <span className="mb-1 block text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </label>
  );
}

export default function CreateAd() {
  const { t, lang } = useI18n();
  const { mode, workspace, role } = useSession();
  const app = useApp();
  const live = mode === 'live' && !!supabase;

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const [pixels, setPixels] = useState<PixelOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<CreateAdInput>({
    adAccountId: '',
    pageId: '',
    objective: 'OUTCOME_TRAFFIC',
    pixelId: '',
    campaignName: '',
    dailyBudget: 0,
    countries: ['EG'],
    detailedTargeting: [],
    ageMin: 18,
    ageMax: 65,
    gender: 'all',
    url: 'https://',
    primaryText: '',
    headline: '',
    description: '',
    cta: 'LEARN_MORE',
    messageApp: 'WHATSAPP',
    locations: [],
    customAudiences: [],
    excludedAudiences: [],
    advantageAudience: false,
    format: 'single',
    cards: [{ headline: '' }, { headline: '' }],
    urlTags: DEFAULT_URL_TAGS,
  });
  const [audiences, setAudiences] = useState<AudienceOption[] | null>(null);
  const [geoQuery, setGeoQuery] = useState('');
  const [geoResults, setGeoResults] = useState<GeoOption[] | null>(null);
  const [cardImages, setCardImages] = useState<(File | null)[]>([null, null]);
  const [useUtm, setUseUtm] = useState(true);
  const [useInstagram, setUseInstagram] = useState(true);
  const [manualPlacements, setManualPlacements] = useState(false);
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [budgetText, setBudgetText] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [demoDone, setDemoDone] = useState(false);

  const set = <K extends keyof CreateAdInput>(k: K, v: CreateAdInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Ad accounts: demo -> sample Meta accounts; live -> the workspace's Meta accounts.
  useEffect(() => {
    if (!live) {
      const rows = (app.data?.accounts ?? []).filter((a) => a.channel === 'meta').map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
      setAccounts(rows);
      setPages(DEMO_PAGES);
      return;
    }
    if (!workspace) return;
    void supabase!
      .from('ad_accounts')
      .select('meta_account_id, name, currency, selected')
      .eq('workspace_id', workspace.id)
      .order('selected', { ascending: false })
      .order('name')
      .then(({ data, error }) => {
        if (error) setLoadError(error.message);
        setAccounts(((data as { meta_account_id: string; name: string; currency: string }[] | null) ?? []).map((r) => ({ id: r.meta_account_id, name: r.name, currency: r.currency })));
      });
  }, [live, workspace, app.data, t]);

  // Pages the chosen ad account can advertise with (business-owned Pages included).
  useEffect(() => {
    if (!live || !workspace || !form.adAccountId) return;
    let alive = true;
    setPages(null);
    void supabase!.functions
      .invoke('meta-create-ad', { body: { action: 'pages', workspace_id: workspace.id, ad_account_id: form.adAccountId } })
      .then(async ({ data, error }) => {
        if (!alive) return;
        if (error) {
          const e = await invokeError(error);
          setLoadError(errKey(e.code) ? t(errKey(e.code)!) : e.message);
          setPages([]);
        } else {
          const list = (data as { pages: PageOption[] }).pages;
          setPages(list);
          setForm((f) => (list.some((p) => p.id === f.pageId) ? f : { ...f, pageId: list[0]?.id ?? '' }));
        }
      });
    return () => {
      alive = false;
    };
  }, [live, workspace, form.adAccountId, t]);

  // Detailed targeting: search as you type, and related suggestions for what is picked.
  const [targetQuery, setTargetQuery] = useState('');
  const [targetResults, setTargetResults] = useState<TargetingOption[] | null>(null);
  const [targetSuggestions, setTargetSuggestions] = useState<TargetingOption[]>([]);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [targetLoading, setTargetLoading] = useState(false);
  const picked = form.detailedTargeting ?? [];
  const isPicked = (o: TargetingItem) => picked.some((p) => p.id === o.id && p.type === o.type);
  const addTarget = (o: TargetingItem) => {
    if (isPicked(o) || picked.length >= MAX_TARGETING_ITEMS) return;
    set('detailedTargeting', [...picked, { id: o.id, name: o.name, type: o.type }]);
  };
  const removeTarget = (o: TargetingItem) =>
    set('detailedTargeting', picked.filter((p) => !(p.id === o.id && p.type === o.type)));

  useEffect(() => {
    const q = targetQuery.trim();
    if (q.length < 2) {
      setTargetResults(null);
      setTargetLoading(false);
      setTargetError(null);
      return;
    }
    if (!live) {
      const ql = q.toLowerCase();
      setTargetResults(DEMO_TARGETING.filter((o) => o.name.toLowerCase().includes(ql) || o.path.join(' ').toLowerCase().includes(ql)));
      return;
    }
    if (!workspace || !form.adAccountId) return;
    let alive = true;
    setTargetLoading(true);
    const timer = window.setTimeout(() => {
      void supabase!.functions
        .invoke('meta-create-ad', { body: { action: 'targeting_search', workspace_id: workspace.id, ad_account_id: form.adAccountId, q, locale: lang } })
        .then(async ({ data, error }) => {
          if (!alive) return;
          setTargetLoading(false);
          if (error) {
            const e = await invokeError(error);
            setTargetError(errKey(e.code) ? t(errKey(e.code)!) : e.message);
            setTargetResults([]);
          } else {
            setTargetError(null);
            setTargetResults((data as { options: TargetingOption[] }).options);
          }
        });
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [targetQuery, live, workspace, form.adAccountId, lang, t]);

  const pickedKey = picked.map((p) => `${p.type}:${p.id}`).join(',');
  useEffect(() => {
    if (!picked.length) {
      setTargetSuggestions([]);
      return;
    }
    if (!live) {
      setTargetSuggestions(DEMO_TARGETING.filter((o) => !isPicked(o)).slice(0, 8));
      return;
    }
    if (!workspace || !form.adAccountId) return;
    let alive = true;
    void supabase!.functions
      .invoke('meta-create-ad', {
        body: { action: 'targeting_suggestions', workspace_id: workspace.id, ad_account_id: form.adAccountId, items: picked, locale: lang },
      })
      .then(({ data, error }) => {
        if (alive) setTargetSuggestions(error ? [] : (data as { options: TargetingOption[] }).options.slice(0, 12));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey, live, workspace, form.adAccountId, lang]);

  // Custom & lookalike audiences of the chosen ad account.
  useEffect(() => {
    setAudiences(null);
    if (!live) {
      setAudiences(DEMO_AUDIENCES);
      return;
    }
    if (!workspace || !form.adAccountId) return;
    let alive = true;
    void supabase!.functions
      .invoke('meta-create-ad', { body: { action: 'audiences', workspace_id: workspace.id, ad_account_id: form.adAccountId } })
      .then(({ data, error }) => alive && setAudiences(error ? [] : (data as { audiences: AudienceOption[] }).audiences));
    return () => {
      alive = false;
    };
  }, [live, workspace, form.adAccountId]);

  // City / region search.
  useEffect(() => {
    const q = geoQuery.trim();
    if (q.length < 2) {
      setGeoResults(null);
      return;
    }
    if (!live) {
      const ql = q.toLowerCase();
      setGeoResults(DEMO_GEO.filter((g) => g.name.toLowerCase().includes(ql) || (g.region ?? '').toLowerCase().includes(ql)));
      return;
    }
    if (!workspace || !form.adAccountId) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void supabase!.functions
        .invoke('meta-create-ad', { body: { action: 'geo_search', workspace_id: workspace.id, ad_account_id: form.adAccountId, q, locale: lang } })
        .then(({ data, error }) => alive && setGeoResults(error ? [] : (data as { locations: GeoOption[] }).locations));
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [geoQuery, live, workspace, form.adAccountId, lang]);

  const locs = form.locations ?? [];
  const addLocation = (g: GeoOption) => {
    if (locs.some((l) => l.key === g.key && l.type === g.type)) return;
    set('locations', [...locs, { key: g.key, name: g.name, type: g.type, radiusKm: g.type === 'city' ? 0 : undefined }]);
    setGeoQuery('');
  };
  const setRadius = (l: GeoLocation, radiusKm: number) => set('locations', locs.map((x) => (x.key === l.key && x.type === l.type ? { ...x, radiusKm } : x)));
  const removeLocation = (l: GeoLocation) => set('locations', locs.filter((x) => !(x.key === l.key && x.type === l.type)));
  /** Audience chip cycles: not used -> include -> exclude -> not used. */
  const audienceState = (id: string) => (form.customAudiences?.includes(id) ? 'in' : form.excludedAudiences?.includes(id) ? 'out' : 'off');
  const cycleAudience = (id: string) => {
    const st = audienceState(id);
    const inc = (form.customAudiences ?? []).filter((x) => x !== id);
    const exc = (form.excludedAudiences ?? []).filter((x) => x !== id);
    setForm((f) => ({ ...f, customAudiences: st === 'off' ? [...inc, id] : inc, excludedAudiences: st === 'in' ? [...exc, id] : exc }));
  };
  const cards = form.cards ?? [];
  const setCard = (n: number, patch: Partial<NonNullable<CreateAdInput['cards']>[number]>) => set('cards', cards.map((c, i) => (i === n ? { ...c, ...patch } : c)));

  // Default the account and page once loaded.
  useEffect(() => {
    if (!form.adAccountId && accounts[0]) set('adAccountId', accounts[0].id);
  }, [accounts, form.adAccountId]);
  useEffect(() => {
    if (!form.pageId && pages?.[0]) set('pageId', pages[0].id);
  }, [pages, form.pageId]);

  // Pixels for the chosen account (only needed for sales).
  useEffect(() => {
    setPixels(null);
    if (!usesPixel(form) || !form.adAccountId) return;
    if (!live) {
      setPixels(DEMO_PIXELS);
      return;
    }
    void supabase!.functions
      .invoke('meta-create-ad', { body: { action: 'pixels', workspace_id: workspace?.id, ad_account_id: form.adAccountId } })
      .then(async ({ data, error }) => {
        if (error) {
          const e = await invokeError(error);
          setLoadError(errKey(e.code) ? t(errKey(e.code)!) : e.message);
          setPixels([]);
        } else setPixels((data as { pixels: PixelOption[] }).pixels);
      });
  }, [live, workspace, form.objective, form.adAccountId, t]);
  useEffect(() => {
    if (pixels && pixels[0] && !pixels.some((p) => p.id === form.pixelId)) set('pixelId', pixels[0].id);
  }, [pixels, form.pixelId]);

  useEffect(() => {
    if (!image) {
      setImageUrl(null);
      return;
    }
    const u = URL.createObjectURL(image);
    setImageUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [image]);

  const account = accounts.find((a) => a.id === form.adAccountId);
  const currency = account?.currency ?? 'USD';
  const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  const page = pages?.find((p) => p.id === form.pageId);
  // What is actually sent: fields that don't apply to the chosen objective/format are dropped.
  const cleaned = useMemo<CreateAdInput>(() => {
    const msgs = isMessages(form);
    const toIso = (v: string) => (v ? new Date(v).toISOString() : undefined);
    return {
      ...form,
      url: msgs ? '' : form.url,
      pixelId: usesPixel(form) ? form.pixelId : undefined,
      conversionEvent: usesPixel(form) ? (form.conversionEvent ?? defaultEvent(form)) : undefined,
      messageApp: msgs ? form.messageApp : undefined,
      locations: form.locations?.length ? form.locations : undefined,
      customAudiences: form.customAudiences?.length ? form.customAudiences : undefined,
      excludedAudiences: form.excludedAudiences?.length ? form.excludedAudiences : undefined,
      platforms: manualPlacements ? form.platforms ?? [] : undefined,
      instagramUserId: useInstagram && page?.instagram?.id ? page.instagram.id : undefined,
      urlTags: useUtm && !msgs && form.urlTags ? form.urlTags : undefined,
      startTime: toIso(startLocal),
      endTime: toIso(endLocal),
      cards: form.format === 'carousel' ? form.cards : undefined,
    };
  }, [form, manualPlacements, useInstagram, page, useUtm, startLocal, endLocal]);
  const errors = useMemo(() => {
    const e: string[] = validateCreateAdInput(cleaned, currency);
    if (cleaned.format === 'carousel' && cardImages.slice(0, cleaned.cards?.length ?? 0).some((f) => !f)) e.push('cards_images_missing');
    return e;
  }, [cleaned, currency, cardImages]);
  const countryName = useMemo(() => {
    try {
      const dn = new Intl.DisplayNames([lang], { type: 'region' });
      return (c: string) => dn.of(c) ?? c;
    } catch {
      return (c: string) => c;
    }
  }, [lang]);

  const pickImage = (f: File | undefined) => {
    setImageError(null);
    if (!f) return setImage(null);
    if (!IMAGE_TYPES.includes(f.type)) return setImageError(t('createAd.err.image_type_invalid'));
    if (f.size > MAX_IMAGE_BYTES) return setImageError(t('createAd.err.image_too_large'));
    setImage(f);
  };

  const toggleCountry = (c: string) =>
    set('countries', form.countries.includes(c) ? form.countries.filter((x) => x !== c) : [...form.countries, c]);

  const reset = () => {
    setResult(null);
    setDemoDone(false);
    setServerError(null);
    setShowErrors(false);
    setForm((f) => ({ ...f, campaignName: '', primaryText: '', headline: '', description: '' }));
    setImage(null);
  };

  const submit = async () => {
    setShowErrors(true);
    setServerError(null);
    setDemoDone(false);
    if (errors.length) return;
    if (!live) {
      setDemoDone(true);
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { action: 'create', workspace_id: workspace?.id, input: cleaned };
      if (cleaned.format === 'carousel') {
        const files = cardImages.slice(0, cleaned.cards?.length ?? 0) as File[];
        body.images = await Promise.all(files.map(async (f) => ({ base64: await fileToBase64(f), filename: f.name, content_type: f.type })));
      } else if (image) body.image = { base64: await fileToBase64(image), filename: image.name, content_type: image.type };
      const { data, error } = await supabase!.functions.invoke('meta-create-ad', { body });
      if (error) {
        const e = await invokeError(error);
        if (e.errors?.length) setServerError(e.errors.map((c) => (errKey(c) ? t(errKey(c)!) : c)).join(' '));
        else setServerError(errKey(e.code) ? t(errKey(e.code)!) : e.message || e.code);
      } else setResult(data as CreateResult);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const shownErrors = showErrors ? errors : [];

  if (result) {
    return (
      <>
        <PageHeader title={t('createAd.title')} />
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">{t('createAd.successTitle')}</h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            {t('createAd.successBody', { campaign: result.campaign_id, adset: result.adset_id, ad: result.ad_id })}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a href={result.ads_manager_url} target="_blank" rel="noreferrer" className={primaryBtn}>
              {t('createAd.openAdsManager')}
            </a>
            <button onClick={reset} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
              {t('createAd.createAnother')}
            </button>
          </div>
        </Card>
      </>
    );
  }

  if (live && role !== 'owner' && role !== 'admin') {
    return (
      <>
        <PageHeader title={t('createAd.title')} />
        <Card className="p-6 text-sm">{t('createAd.ownerOnly')}</Card>
      </>
    );
  }

  if (live && accounts.length === 0 && !loadError) {
    return (
      <>
        <PageHeader title={t('createAd.title')} subtitle={t('createAd.subtitle')} />
        <Card className="p-6 text-sm">
          <p>{t('createAd.noAccounts')}</p>
          <Link href="/app/connect" className={`${primaryBtn} mt-4`}>
            {t('createAd.goConnect')}
          </Link>
        </Card>
      </>
    );
  }

  const fieldErr = (codes: string[]) => {
    const hit = shownErrors.find((e) => codes.includes(e));
    return hit ? <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{t(`createAd.err.${hit}` as DictKey)}</span> : null;
  };

  return (
    <>
      <PageHeader title={t('createAd.title')} subtitle={t('createAd.subtitle')} />

      <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
        {t('createAd.pausedNote', { unit: t(UNIT_KEYS.includes(`currencyUnit.${account?.currency ?? 'EGP'}` as DictKey) ? (`currencyUnit.${account?.currency ?? 'EGP'}` as DictKey) : 'currencyUnit.other') })}
      </div>
      {loadError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {loadError}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title={t('createAd.section.setup')}>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label={t('createAd.account')}>
                <select className={input} value={form.adAccountId} onChange={(e) => set('adAccountId', e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id} dir="auto">
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </select>
                {fieldErr(['ad_account_required'])}
              </Field>
              <Field label={t('createAd.page')} hint={t('createAd.pageHint')}>
                {pages === null ? (
                  <div className="flex h-10 items-center text-sm text-zinc-500">{t('createAd.loadingPages')}</div>
                ) : pages.length === 0 ? (
                  <div className="flex h-10 items-center text-sm text-zinc-500">{t('createAd.noPages')}</div>
                ) : (
                  <select className={input} value={form.pageId} onChange={(e) => set('pageId', e.target.value)}>
                    {pages.map((p) => (
                      <option key={p.id} value={p.id} dir="auto">
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                {fieldErr(['page_required'])}
              </Field>
              <Field label={t('createAd.objective')}>
                <select className={input} value={form.objective} onChange={(e) => set('objective', e.target.value as CreateObjective)}>
                  {CREATE_OBJECTIVES.map((o) => (
                    <option key={o} value={o} dir="auto">
                      {t(`createAd.objective.${o}`)}
                    </option>
                  ))}
                </select>
              </Field>
              {isMessages(form) && (
                <Field label={t('createAd.messageApp')} hint={t('createAd.messageAppHint')}>
                  <select className={input} value={form.messageApp} onChange={(e) => set('messageApp', e.target.value as MessageApp)}>
                    {MESSAGE_APPS.map((m) => (
                      <option key={m} value={m}>
                        {t(`createAd.app.${m}` as DictKey)}
                      </option>
                    ))}
                  </select>
                  {fieldErr(['message_app_required'])}
                </Field>
              )}
              {usesPixel(form) && (
                <Field label={t('createAd.event')} hint={t('createAd.eventHint')}>
                  <select
                    className={input}
                    value={form.conversionEvent ?? defaultEvent(form)}
                    onChange={(e) => set('conversionEvent', e.target.value as ConversionEvent)}
                  >
                    {CONVERSION_EVENTS.map((ev) => (
                      <option key={ev} value={ev}>
                        {t(`createAd.ev.${ev}` as DictKey)}
                      </option>
                    ))}
                  </select>
                  {fieldErr(['event_invalid'])}
                </Field>
              )}
              {usesPixel(form) && (
                <Field label={t('createAd.pixel')} hint={t('createAd.pixelHint')}>
                  {pixels === null ? (
                    <div className="flex h-10 items-center text-sm text-zinc-500">{t('common.loading')}</div>
                  ) : pixels.length === 0 ? (
                    <div className="flex h-10 items-center text-sm text-zinc-500">{t('createAd.noPixels')}</div>
                  ) : (
                    <select className={input} value={form.pixelId} onChange={(e) => set('pixelId', e.target.value)}>
                      {pixels.map((p) => (
                        <option key={p.id} value={p.id} dir="auto">
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {fieldErr(['pixel_required'])}
                </Field>
              )}
              <Field label={t('createAd.campaignName')} full>
                <input className={input} dir="auto" value={form.campaignName} onChange={(e) => set('campaignName', e.target.value)} />
                {fieldErr(['name_required'])}
              </Field>
            </div>
          </Card>

          <Card title={t('createAd.section.budget')}>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label={t('createAd.dailyBudget', { currency })} hint={t('createAd.minBudget', { amount: money(minDailyBudget(currency)) })}>
                <input
                  className={input}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  dir="ltr"
                  value={budgetText}
                  onChange={(e) => {
                    setBudgetText(e.target.value);
                    set('dailyBudget', Number(e.target.value) || 0);
                  }}
                />
                {fieldErr(['budget_invalid', 'budget_too_low'])}
              </Field>
              <Field label={t('createAd.gender')}>
                <select className={input} value={form.gender} onChange={(e) => set('gender', e.target.value as Gender)}>
                  {GENDERS.map((g) => (
                    <option key={g} value={g} dir="auto">
                      {t(`createAd.gender.${g}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('createAd.ageMin')}>
                <input className={input} type="number" min={18} max={65} dir="ltr" value={form.ageMin} onChange={(e) => set('ageMin', Math.round(Number(e.target.value)))} />
              </Field>
              <Field label={t('createAd.ageMax')}>
                <input
                  className={input}
                  type="number"
                  min={18}
                  max={65}
                  dir="ltr"
                  value={form.advantageAudience ? 65 : form.ageMax}
                  disabled={!!form.advantageAudience}
                  title={form.advantageAudience ? t('createAd.advantageAgeNote') : undefined}
                  onChange={(e) => set('ageMax', Math.round(Number(e.target.value)))}
                />
                {fieldErr(['age_invalid'])}
              </Field>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('createAd.countries')}</span>
                <div className="flex flex-wrap gap-2">
                  {COUNTRIES.map((c) => {
                    const on = form.countries.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleCountry(c)}
                        className={cx(
                          'rounded-full border px-3 py-1 text-xs font-medium',
                          on
                            ? 'border-brand-600 bg-brand-600 text-white'
                            : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
                        )}
                      >
                        {countryName(c)}
                      </button>
                    );
                  })}
                </div>
                {fieldErr(['countries_required', 'country_invalid'])}
                {locs.length > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t('createAd.countriesIgnored')}</p>}
              </div>
              <Block title={t('createAd.locations')} hint={t('createAd.locationsHint')}>
                {locs.length > 0 && (
                  <ul className="mb-2 space-y-1.5">
                    {locs.map((l) => (
                      <li key={`${l.type}:${l.key}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700">
                        <span className="min-w-0 flex-1 truncate">
                          <bdi>{l.name}</bdi> <span className="text-xs text-zinc-500">· {t(l.type === 'city' ? 'createAd.geo.city' : 'createAd.geo.region')}</span>
                        </span>
                        {l.type === 'city' && (
                          <select className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900" value={l.radiusKm ?? 0} onChange={(e) => setRadius(l, Number(e.target.value))}>
                            {RADII.map((km) => (
                              <option key={km} value={km}>
                                {km === 0 ? t('createAd.radiusCity') : t('createAd.radiusKm', { n: km })}
                              </option>
                            ))}
                          </select>
                        )}
                        <button type="button" onClick={() => removeLocation(l)} aria-label={t('createAd.targetRemove', { name: l.name })} className="px-1 text-zinc-500 hover:text-red-600">
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <input type="search" className={input} value={geoQuery} onChange={(e) => setGeoQuery(e.target.value)} placeholder={t('createAd.locationsPlaceholder')} />
                {geoResults !== null && (
                  <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                    {geoResults.length === 0 ? (
                      <div className="px-3 py-2.5 text-sm text-zinc-500">{t('createAd.targetingNone')}</div>
                    ) : (
                      geoResults.map((g) => (
                        <button
                          key={`${g.type}:${g.key}`}
                          type="button"
                          onClick={() => addLocation(g)}
                          className="block w-full border-b border-zinc-100 px-3 py-2 text-start text-sm last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                        >
                          <bdi>{g.name}</bdi>
                          <span className="ms-2 text-xs text-zinc-500">
                            {t(g.type === 'city' ? 'createAd.geo.city' : 'createAd.geo.region')}
                            {g.region ? ` · ${g.region}` : ''}
                            {g.country ? ` · ${g.country}` : ''}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
                {fieldErr(['locations_invalid'])}
              </Block>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('createAd.targeting')}</span>
                <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">{t('createAd.targetingHint')}</p>
                {picked.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {picked.map((p) => (
                      <span
                        key={`${p.type}:${p.id}`}
                        className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 py-1 pe-1.5 ps-3 text-xs font-medium text-white"
                      >
                        <span dir="auto">{p.name}</span>
                        <span className="opacity-75">· {t(typeLabelKey(p.type))}</span>
                        <button
                          type="button"
                          onClick={() => removeTarget(p)}
                          aria-label={t('createAd.targetRemove', { name: p.name })}
                          className="grid h-5 w-5 place-items-center rounded-full hover:bg-white/20"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  type="search"
                  className={input}
                  value={targetQuery}
                  onChange={(e) => setTargetQuery(e.target.value)}
                  placeholder={t('createAd.targetingPlaceholder')}
                  disabled={picked.length >= MAX_TARGETING_ITEMS}
                />
                {targetLoading && targetResults === null && (
                  <div className="mt-1 px-1 text-xs text-zinc-500">{t('common.loading')}</div>
                )}
                {targetError && <div className="mt-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{targetError}</div>}
                {targetResults !== null && !targetError && (
                  <div className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                    {targetResults.length === 0 ? (
                      <div className="px-3 py-2.5 text-sm text-zinc-500">{t('createAd.targetingNone')}</div>
                    ) : (
                      targetResults.map((o) => {
                        const on = isPicked(o);
                        return (
                          <button
                            key={`${o.type}:${o.id}`}
                            type="button"
                            disabled={on}
                            onClick={() => addTarget(o)}
                            className="flex w-full items-start gap-3 border-b border-zinc-100 px-3 py-2 text-start last:border-0 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium" dir="auto">
                                {on ? '✓ ' : ''}
                                {o.name}
                              </span>
                              <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400" dir="auto">
                                {t(typeLabelKey(o.type))}
                                {o.path.slice(1, -1).length ? ` · ${o.path.slice(1, -1).join(' › ')}` : ''}
                              </span>
                            </span>
                            {audienceSize(o) && (
                              <span className="shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400" dir="ltr">
                                {audienceSize(o)}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
                {targetSuggestions.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">{t('createAd.targetingSuggested')}</div>
                    <div className="flex flex-wrap gap-2">
                      {targetSuggestions.map((o) => (
                        <button
                          key={`${o.type}:${o.id}`}
                          type="button"
                          onClick={() => addTarget(o)}
                          className="rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:border-brand-600 hover:text-brand-700 dark:border-zinc-600 dark:text-zinc-200"
                        >
                          + <span dir="auto">{o.name}</span>
                          {audienceSize(o) && <span className="mx-1.5 text-zinc-400" dir="ltr">{audienceSize(o)}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {fieldErr(['targeting_invalid'])}
              </div>
              <Block title={t('createAd.audiences')} hint={t('createAd.audiencesHint')}>
                {audiences === null ? (
                  <div className="text-sm text-zinc-500">{t('common.loading')}</div>
                ) : audiences.length === 0 ? (
                  <div className="text-sm text-zinc-500">{t('createAd.noAudiences')}</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {audiences.map((a) => {
                      const st = audienceState(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => cycleAudience(a.id)}
                          className={cx(
                            'rounded-full border px-3 py-1 text-xs font-medium',
                            st === 'in' && 'border-brand-600 bg-brand-600 text-white',
                            st === 'out' && 'border-red-600 bg-red-600 text-white line-through decoration-white/60',
                            st === 'off' && 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
                          )}
                        >
                          {st === 'in' ? '+ ' : st === 'out' ? '− ' : ''}
                          <bdi>{a.name}</bdi>
                          {a.subtype === 'LOOKALIKE' && <span className="ms-1 opacity-75">· LAL</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {fieldErr(['audiences_invalid'])}
              </Block>
              <Block title={t('createAd.advantageAudience')} hint={t('createAd.advantageAudienceHint')}>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!form.advantageAudience} onChange={(e) => set('advantageAudience', e.target.checked)} className="h-4 w-4 accent-brand-600" />
                  {t('createAd.advantageAudienceOn')}
                </label>
              </Block>
              <Block title={t('createAd.placements')} hint={t('createAd.placementsHint')}>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={chip(!manualPlacements)} aria-pressed={!manualPlacements} onClick={() => setManualPlacements(false)}>
                    {t('createAd.placementsAuto')}
                  </button>
                  <button
                    type="button"
                    className={chip(manualPlacements)}
                    aria-pressed={manualPlacements}
                    onClick={() => {
                      setManualPlacements(true);
                      if (!form.platforms?.length) set('platforms', ['facebook', 'instagram']);
                    }}
                  >
                    {t('createAd.placementsManual')}
                  </button>
                </div>
                {manualPlacements && (
                  <div className="mt-2 flex flex-wrap gap-3">
                    {PLATFORMS.map((pl) => {
                      const on = !!form.platforms?.includes(pl);
                      return (
                        <label key={pl} className="inline-flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-brand-600"
                            checked={on}
                            onChange={() => set('platforms', on ? (form.platforms ?? []).filter((x) => x !== pl) : [...(form.platforms ?? []), pl as Platform])}
                          />
                          {t(`createAd.pl.${pl}` as DictKey)}
                        </label>
                      );
                    })}
                  </div>
                )}
                {fieldErr(['platforms_invalid'])}
              </Block>
              <Field label={<>{t('createAd.start')} <span className="font-normal text-zinc-500">{t('createAd.optional')}</span></>} hint={t('createAd.startHint')}>
                <input type="datetime-local" dir="ltr" className={input} value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
              </Field>
              <Field label={<>{t('createAd.end')} <span className="font-normal text-zinc-500">{t('createAd.optional')}</span></>} hint={t('createAd.endHint')}>
                <input type="datetime-local" dir="ltr" className={input} value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
                {fieldErr(['schedule_invalid'])}
              </Field>
            </div>
          </Card>

          <Card title={t('createAd.section.creative')}>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Block title={t('createAd.format')}>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={chip(form.format !== 'carousel')} aria-pressed={form.format !== 'carousel'} onClick={() => set('format', 'single')}>
                    {t('createAd.formatSingle')}
                  </button>
                  <button type="button" className={chip(form.format === 'carousel')} aria-pressed={form.format === 'carousel'} onClick={() => set('format', 'carousel')}>
                    {t('createAd.formatCarousel')}
                  </button>
                  <span className="self-center text-xs text-zinc-500 dark:text-zinc-400">{t('createAd.videoSoon')}</span>
                </div>
              </Block>
              {isMessages(form) ? (
                <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900 sm:col-span-2 dark:bg-brand-500/10 dark:text-brand-100">
                  {t('createAd.messagesNoUrl', { app: t(`createAd.app.${form.messageApp ?? 'WHATSAPP'}` as DictKey) })}
                </p>
              ) : (
                <Field label={t('createAd.url')} full>
                  <input className={input} type="url" dir="ltr" value={form.url} onChange={(e) => set('url', e.target.value)} />
                  {fieldErr(['url_invalid'])}
                </Field>
              )}
              <Field label={t('createAd.primaryText')} full>
                <textarea
                  dir="auto"
                  rows={3}
                  className={`${input} h-auto py-2`}
                  value={form.primaryText}
                  onChange={(e) => set('primaryText', e.target.value)}
                />
                {fieldErr(['primary_text_required'])}
              </Field>
              <Field label={t('createAd.headline')}>
                <input className={input} dir="auto" value={form.headline} onChange={(e) => set('headline', e.target.value)} />
                {fieldErr(['headline_required'])}
              </Field>
              <Field label={<>{t('createAd.description')} <span className="font-normal text-zinc-500">{t('createAd.optional')}</span></>}>
                <input className={input} dir="auto" value={form.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
              {!isMessages(form) && (
                <Field label={t('createAd.cta')}>
                  <select className={input} value={form.cta} onChange={(e) => set('cta', e.target.value as CtaType)}>
                    {CTA_TYPES.map((c) => (
                      <option key={c} value={c} dir="auto">
                        {t(`createAd.cta.${c}`)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {form.format !== 'carousel' && (
              <Field label={<>{t('createAd.image')} <span className="font-normal text-zinc-500">{t('createAd.optional')}</span></>} hint={t('createAd.imageHint')}>
                {/* Native file inputs always show the browser's own language ("Choose File"); use a localized label instead. */}
                <div className="flex items-center gap-3">
                  {imageUrl && <img src={imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-zinc-200 dark:ring-zinc-700" />}
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 focus-within:ring-2 focus-within:ring-brand-500/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700">
                    <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => pickImage(e.target.files?.[0])} />
                    {image ? t('createAd.imageChange') : t('createAd.imageChoose')}
                  </label>
                  <span className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400" dir="auto">
                    {image ? image.name : t('createAd.imageNone')}
                  </span>
                  {image && (
                    <button type="button" onClick={() => pickImage(undefined)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                      {t('createAd.imageRemove')}
                    </button>
                  )}
                </div>
                {imageError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{imageError}</span>}
              </Field>
              )}
              {form.format === 'carousel' && (
                <Block title={t('createAd.cards', { n: cards.length })} hint={t('createAd.cardsHint')}>
                  <ol className="space-y-3">
                    {cards.map((c, n) => {
                      const f = cardImages[n] ?? null;
                      return (
                        <li key={n} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                            <span>{t('createAd.card', { n: n + 1 })}</span>
                            {cards.length > 2 && (
                              <button
                                type="button"
                                className="text-red-600 hover:underline dark:text-red-400"
                                onClick={() => {
                                  set('cards', cards.filter((_, i) => i !== n));
                                  setCardImages((imgs) => imgs.filter((_, i) => i !== n));
                                }}
                              >
                                {t('createAd.removeCard')}
                              </button>
                            )}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                            <label className="flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-center text-[11px] text-zinc-500 hover:border-brand-500 dark:border-zinc-600 dark:bg-zinc-800">
                              <input
                                type="file"
                                accept="image/jpeg,image/png"
                                className="sr-only"
                                onChange={(e) => {
                                  const file = e.target.files?.[0] ?? null;
                                  if (file && (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES)) return setImageError(t('createAd.err.image_type_invalid'));
                                  setImageError(null);
                                  setCardImages((imgs) => {
                                    const next = [...imgs];
                                    next[n] = file;
                                    return next;
                                  });
                                }}
                              />
                              {f ? <img src={URL.createObjectURL(f)} alt="" className="h-full w-full object-cover" /> : t('createAd.imageChoose')}
                            </label>
                            <div className="grid gap-2">
                              <input className={input} dir="auto" placeholder={t('createAd.headline')} value={c.headline} onChange={(e) => setCard(n, { headline: e.target.value })} />
                              <input className={input} dir="auto" placeholder={`${t('createAd.description')} ${t('createAd.optional')}`} value={c.description ?? ''} onChange={(e) => setCard(n, { description: e.target.value })} />
                              {!isMessages(form) && (
                                <input className={input} dir="ltr" type="url" placeholder={t('createAd.cardUrl')} value={c.url ?? ''} onChange={(e) => setCard(n, { url: e.target.value })} />
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  {cards.length < MAX_CAROUSEL_CARDS && (
                    <button
                      type="button"
                      onClick={() => {
                        set('cards', [...cards, { headline: '' }]);
                        setCardImages((imgs) => [...imgs, null]);
                      }}
                      className="mt-2 rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs font-medium hover:border-brand-500 dark:border-zinc-600"
                    >
                      + {t('createAd.addCard')}
                    </button>
                  )}
                  {imageError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{imageError}</span>}
                  {fieldErr(['cards_invalid', 'cards_images_missing'])}
                </Block>
              )}
              {page?.instagram && (
                <Block title={t('createAd.instagram')}>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={useInstagram} onChange={(e) => setUseInstagram(e.target.checked)} />
                    {t('createAd.instagramUse', { name: page.instagram.username ? `@${page.instagram.username}` : page.instagram.id })}
                  </label>
                </Block>
              )}
              {!isMessages(form) && (
                <Block title={t('createAd.utm')} hint={t('createAd.utmHint')}>
                  <label className="mb-2 inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={useUtm} onChange={(e) => setUseUtm(e.target.checked)} />
                    {t('createAd.utmOn')}
                  </label>
                  {useUtm && <input className={input} dir="ltr" value={form.urlTags ?? ''} onChange={(e) => set('urlTags', e.target.value)} />}
                  {fieldErr(['url_tags_invalid'])}
                </Block>
              )}
              {fieldErr(['text_too_long', 'cta_invalid', 'objective_invalid', 'gender_invalid'])}
            </div>
          </Card>

          {serverError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {serverError}
            </div>
          )}
          {demoDone && (
            <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {t('createAd.demoDone')}
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={submit} disabled={busy} className={cx(primaryBtn, busy && 'opacity-60')}>
              {busy ? t('createAd.submitting') : t('createAd.submit')}
            </button>
          </div>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card title={t('createAd.preview')}>
            <div className="p-4">
              <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-2 px-3 py-2">
                  <div className="h-8 w-8 rounded-full bg-brand-600/20" />
                  <div className="text-sm font-semibold">{pages?.find((p) => p.id === form.pageId)?.name ?? t('createAd.page')}</div>
                </div>
                <p dir="auto" className="whitespace-pre-line px-3 pb-2 text-sm">
                  {form.primaryText || t('createAd.primaryText')}
                </p>
                <div className="aspect-square bg-zinc-100 dark:bg-zinc-800">
                  {imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="flex items-center justify-between gap-2 bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
                  <div className="min-w-0">
                    <div dir="ltr" className="truncate text-[11px] uppercase text-zinc-500">
                      {(() => {
                        try {
                          return new URL(form.url).hostname;
                        } catch {
                          return '';
                        }
                      })()}
                    </div>
                    <div dir="auto" className="truncate text-sm font-semibold">
                      {form.headline || t('createAd.headline')}
                    </div>
                    {form.description && (
                      <div dir="auto" className="truncate text-xs text-zinc-500">
                        {form.description}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 rounded-md bg-zinc-200 px-2.5 py-1.5 text-xs font-semibold dark:bg-zinc-700">{isMessages(form) ? t(`createAd.ctaMsg.${form.messageApp ?? 'WHATSAPP'}` as DictKey) : t(`createAd.cta.${form.cta}`)}</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
