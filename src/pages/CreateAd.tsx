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
  minDailyBudget,
  validateCreateAdInput,
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
}
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

const DEMO_PAGES: PageOption[] = [{ id: '100000000000001', name: 'Lumen Store' }];
const DEMO_PIXELS: PixelOption[] = [{ id: '200000000000001', name: 'Lumen Store Pixel' }];

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
    ageMin: 18,
    ageMax: 65,
    gender: 'all',
    url: 'https://',
    primaryText: '',
    headline: '',
    description: '',
    cta: 'LEARN_MORE',
  });
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
    void supabase!.functions.invoke('meta-create-ad', { body: { action: 'pages', workspace_id: workspace.id } }).then(async ({ data, error }) => {
      if (error) {
        const e = await invokeError(error);
        setLoadError(errKey(e.code) ? t(errKey(e.code)!) : e.message);
        setPages([]);
      } else setPages((data as { pages: PageOption[] }).pages);
    });
  }, [live, workspace, app.data, t]);

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
    if (form.objective !== 'OUTCOME_SALES' || !form.adAccountId) return;
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
  const errors = useMemo(() => validateCreateAdInput(form, currency), [form, currency]);
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
      const body: Record<string, unknown> = { action: 'create', workspace_id: workspace?.id, input: { ...form, pixelId: form.objective === 'OUTCOME_SALES' ? form.pixelId : undefined } };
      if (image) body.image = { base64: await fileToBase64(image), filename: image.name, content_type: image.type };
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

  if (live && role !== 'owner') {
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
        {t('createAd.pausedNote')}
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
                    <option key={a.id} value={a.id}>
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
                      <option key={p.id} value={p.id}>
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
                    <option key={o} value={o}>
                      {t(`createAd.objective.${o}`)}
                    </option>
                  ))}
                </select>
              </Field>
              {form.objective === 'OUTCOME_SALES' && (
                <Field label={t('createAd.pixel')} hint={t('createAd.pixelHint')}>
                  {pixels === null ? (
                    <div className="flex h-10 items-center text-sm text-zinc-500">{t('common.loading')}</div>
                  ) : pixels.length === 0 ? (
                    <div className="flex h-10 items-center text-sm text-zinc-500">{t('createAd.noPixels')}</div>
                  ) : (
                    <select className={input} value={form.pixelId} onChange={(e) => set('pixelId', e.target.value)}>
                      {pixels.map((p) => (
                        <option key={p.id} value={p.id}>
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
                    <option key={g} value={g}>
                      {t(`createAd.gender.${g}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('createAd.ageMin')}>
                <input className={input} type="number" min={18} max={65} dir="ltr" value={form.ageMin} onChange={(e) => set('ageMin', Math.round(Number(e.target.value)))} />
              </Field>
              <Field label={t('createAd.ageMax')}>
                <input className={input} type="number" min={18} max={65} dir="ltr" value={form.ageMax} onChange={(e) => set('ageMax', Math.round(Number(e.target.value)))} />
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
              </div>
            </div>
          </Card>

          <Card title={t('createAd.section.creative')}>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label={t('createAd.url')} full>
                <input className={input} type="url" dir="ltr" value={form.url} onChange={(e) => set('url', e.target.value)} />
                {fieldErr(['url_invalid'])}
              </Field>
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
              <Field label={t('createAd.cta')}>
                <select className={input} value={form.cta} onChange={(e) => set('cta', e.target.value as CtaType)}>
                  {CTA_TYPES.map((c) => (
                    <option key={c} value={c}>
                      {t(`createAd.cta.${c}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={<>{t('createAd.image')} <span className="font-normal text-zinc-500">{t('createAd.optional')}</span></>} hint={t('createAd.imageHint')}>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) => pickImage(e.target.files?.[0])}
                  className="block w-full text-sm text-zinc-600 file:me-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium dark:text-zinc-300 dark:file:bg-zinc-800 dark:file:text-zinc-100"
                />
                {imageError && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{imageError}</span>}
              </Field>
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
                  <span className="shrink-0 rounded-md bg-zinc-200 px-2.5 py-1.5 text-xs font-semibold dark:bg-zinc-700">{t(`createAd.cta.${form.cta}`)}</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
