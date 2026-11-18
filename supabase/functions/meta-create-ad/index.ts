// POST { action, workspace_id?, ... } with the user's JWT. Creates Meta ads from the
// "Create ad" page. Everything is created PAUSED; the advertiser turns it on in Ads Manager.
//
// Actions:
//   { action: 'pages', ad_account_id }                   -> { pages: [{id, name, picture}] }
//   { action: 'pixels', ad_account_id }                  -> { pixels: [{id, name}] }
//   { action: 'targeting_search', ad_account_id, q }     -> { options: TargetingOption[] }
//   { action: 'targeting_suggestions', ad_account_id, items: [{id, type}] } -> { options }
//   { action: 'create', input: CreateAdInput, image? }   -> { campaign_id, adset_id, creative_id, ad_id, ads_manager_url }
//      image = { base64, filename, content_type } (jpg/png, <= 8MB)
//
// Only the workspace owner may create ads, on an active plan that includes `create_ads`,
// and only on ad accounts that belong to the workspace. While the Meta app is in
// Development mode this works for people with a role on the app (admins/developers/testers).
import { HttpError, adminClient, json, loadSubscription, readJson, requireEditor, requireUser, resolveWorkspace, serve } from '../_shared/http.ts';
import { graphDelete, graphGet, graphGetAll, graphPost } from '../_shared/graph.ts';
import { META_CREATE_SCOPES } from '../_shared/meta.ts';
import { isSubscriptionActive } from '../_shared/period.ts';
import {
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  adsManagerUrl,
  base64Bytes,
  buildAdPayload,
  buildAdSetPayload,
  buildCampaignPayload,
  buildCreativePayload,
  normalizeTargetingRows,
  rankTargetingOptions,
  toFormFields,
  validateCreateAdInput,
  type CreateAdInput,
} from '../_shared/meta-create.ts';

interface Body {
  action?: 'pages' | 'pixels' | 'create' | 'targeting_search' | 'targeting_suggestions' | 'audiences' | 'geo_search';
  q?: string;
  locale?: string;
  items?: { id: string; type: string }[];
  workspace_id?: string;
  ad_account_id?: string;
  input?: CreateAdInput;
  image?: { base64?: string; filename?: string; content_type?: string };
  /** Carousel: one image per card, in card order. */
  images?: { base64?: string; filename?: string; content_type?: string }[];
}

serve(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  const admin = adminClient();
  const user = await requireUser(req, admin);
  const body = await readJson<Body>(req);

  const { workspaceId, role } = await resolveWorkspace(admin, user.id, body.workspace_id);
  // Owner or admin (viewers are read-only).
  requireEditor(role);

  const sub = await loadSubscription(admin, workspaceId);
  if (!sub || !isSubscriptionActive(sub.status, sub.current_period_end ? new Date(sub.current_period_end) : null, new Date())) {
    throw new HttpError(402, 'subscription_inactive');
  }
  if (!sub.plans.features.includes('create_ads')) throw new HttpError(403, 'feature_not_in_plan');

  const { data: conn, error: connErr } = await admin
    .from('meta_connections')
    .select('access_token, scopes')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (connErr) throw connErr;
  if (!conn) throw new HttpError(400, 'meta_not_connected');
  const scopes = (conn.scopes as string[] | null) ?? [];
  // Connections made before ads_management was requested must log in to Meta again.
  if (!META_CREATE_SCOPES.every((s) => scopes.includes(s))) throw new HttpError(403, 'meta_reconnect_required');
  const token = conn.access_token as string;

  const loadAccount = async (actId: string | undefined) => {
    if (!actId) throw new HttpError(400, 'ad_account_required');
    const { data, error } = await admin
      .from('ad_accounts')
      .select('meta_account_id, currency')
      .eq('workspace_id', workspaceId)
      .eq('meta_account_id', actId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(403, 'ad_account_not_in_workspace');
    return data as { meta_account_id: string; currency: string };
  };

  if (body.action === 'pages') {
    // Pages this ad account may advertise with. Business-owned Pages (the usual case for a
    // store) only show up here, not in /me/accounts, which lists Pages the person has a
    // personal role on. Fall back to /me/accounts if the account endpoint returns nothing.
    type GraphPage = {
      id: string;
      name: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: { id: string; username?: string };
    };
    // VERIFY: Page field instagram_business_account{id,username} (needs instagram_basic for username).
    const params = { fields: 'id,name,picture{url},instagram_business_account{id,username}', limit: '100' };
    let pages: GraphPage[] = [];
    if (body.ad_account_id) {
      const acc = await loadAccount(body.ad_account_id);
      // VERIFY: /{act_id}/promote_pages returns the Pages the ad account can promote.
      pages = await graphGetAll<GraphPage>(`${acc.meta_account_id}/promote_pages`, params, token, 5).catch(() => []);
    }
    if (!pages.length) {
      // VERIFY: /me/accounts lists Pages the user has a task on; picture{url} field shape.
      pages = await graphGetAll<GraphPage>('me/accounts', params, token, 5);
    }
    const seen = new Set<string>();
    return json({
      pages: pages
        .filter((p) => !seen.has(p.id) && seen.add(p.id))
        .map((p) => ({
          id: p.id,
          name: p.name,
          picture: p.picture?.data?.url ?? null,
          instagram: p.instagram_business_account ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null } : null,
        })),
    });
  }

  if (body.action === 'pixels') {
    const acc = await loadAccount(body.ad_account_id);
    const pixels = await graphGetAll<{ id: string; name: string }>(`${acc.meta_account_id}/adspixels`, { fields: 'id,name', limit: '100' }, token, 5);
    return json({ pixels });
  }

  if (body.action === 'targeting_search') {
    // Interests first: /search?type=adinterest is Meta's precise interest search (what Ads
    // Manager's "Detailed targeting" box uses). /{act}/targetingsearch adds behaviours and
    // demographics but matches loosely, so its rows go after the interests.
    const acc = await loadAccount(body.ad_account_id);
    const q = (body.q ?? '').trim().slice(0, 100);
    if (q.length < 2) return json({ options: [] });
    const locale = body.locale === 'ar' ? 'ar_AR' : 'en_US';
    const [interests, broad] = await Promise.all([
      // VERIFY: GET /search?type=adinterest&q= returns {id, name, path, audience_size_*} (no `type`).
      graphGet<{ data?: Record<string, unknown>[] }>('search', { type: 'adinterest', q, limit: '25', locale }, token)
        .then((r) => (r.data ?? []).map((row) => ({ ...row, type: 'interests' })))
        .catch(() => []),
      // VERIFY: GET /{act_id}/targetingsearch?q= returns interests, behaviours and demographics.
      graphGet<{ data?: unknown[] }>(`${acc.meta_account_id}/targetingsearch`, { q, limit: '40', locale }, token)
        .then((r) => r.data ?? [])
        .catch(() => []),
    ]);
    const precise = normalizeTargetingRows(interests as never[]);
    const all = normalizeTargetingRows([...interests, ...broad] as never[]); // dedupes broad rows already in `precise`
    return json({ options: rankTargetingOptions(all, precise.length) });
  }

  if (body.action === 'targeting_suggestions') {
    // Related interests/behaviours for what the user already picked ("people also target").
    const acc = await loadAccount(body.ad_account_id);
    const picked = (body.items ?? []).filter((t) => t && /^\d+$/.test(String(t.id))).slice(0, 20);
    if (!picked.length) return json({ options: [] });
    // VERIFY: GET /{act_id}/targetingsuggestions?targeting_list=[{type,id}].
    const res = await graphGet<{ data?: unknown[] }>(
      `${acc.meta_account_id}/targetingsuggestions`,
      {
        targeting_list: JSON.stringify(picked.map((t) => ({ type: t.type, id: String(t.id) }))),
        limit: '30',
        locale: body.locale === 'ar' ? 'ar_AR' : 'en_US',
      },
      token,
    );
    const pickedKeys = new Set(picked.map((t) => `${t.type}:${t.id}`));
    return json({ options: normalizeTargetingRows((res.data ?? []) as never[]).filter((o) => !pickedKeys.has(`${o.type}:${o.id}`)) });
  }

  if (body.action === 'audiences') {
    // Custom and lookalike audiences of the ad account (include / exclude in the form).
    const acc = await loadAccount(body.ad_account_id);
    // VERIFY: /{act}/customaudiences fields subtype and approximate_count_lower_bound/upper_bound.
    const rows = await graphGetAll<{ id: string; name: string; subtype?: string; approximate_count_lower_bound?: number; approximate_count_upper_bound?: number }>(
      `${acc.meta_account_id}/customaudiences`,
      { fields: 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound', limit: '200' },
      token,
      5,
    );
    return json({
      audiences: rows.map((a) => ({
        id: a.id,
        name: a.name,
        subtype: a.subtype ?? null,
        sizeLower: a.approximate_count_lower_bound ?? null,
        sizeUpper: a.approximate_count_upper_bound ?? null,
      })),
    });
  }

  if (body.action === 'geo_search') {
    // Cities and regions (e.g. Cairo, Giza, Alexandria) for location targeting.
    await loadAccount(body.ad_account_id);
    const q = (body.q ?? '').trim().slice(0, 100);
    if (q.length < 2) return json({ locations: [] });
    // VERIFY: GET /search?type=adgeolocation&location_types=["city","region"] returns key, name, type,
    // region and country_code.
    const res = await graphGet<{ data?: { key: string; name: string; type: string; region?: string; country_code?: string; country_name?: string }[] }>(
      'search',
      { type: 'adgeolocation', q, location_types: JSON.stringify(['city', 'region']), limit: '20', locale: body.locale === 'ar' ? 'ar_AR' : 'en_US' },
      token,
    );
    return json({
      locations: (res.data ?? [])
        .filter((l) => l.type === 'city' || l.type === 'region')
        .map((l) => ({ key: String(l.key), name: l.name, type: l.type, region: l.region ?? null, country: l.country_code ?? null })),
    });
  }

  if (body.action !== 'create') throw new HttpError(400, 'unknown_action');
  const input = body.input;
  if (!input) throw new HttpError(400, 'missing_input');
  const acc = await loadAccount(input.adAccountId);
  const errors = validateCreateAdInput(input, acc.currency);
  if (errors.length) return json({ error: 'invalid_input', errors }, 400);

  const act = acc.meta_account_id;

  // 1) Image uploads -> hashes (one for a single ad, one per card for a carousel)
  const uploads = input.format === 'carousel' ? body.images ?? [] : body.image?.base64 ? [body.image] : [];
  if (input.format === 'carousel' && uploads.length !== (input.cards?.length ?? 0)) throw new HttpError(400, 'cards_images_mismatch');
  const imageHashes: string[] = [];
  for (const img of uploads) {
    if (!img?.base64) throw new HttpError(400, 'image_required');
    const b64 = img.base64.replace(/^data:[^,]+,/, '');
    if (!IMAGE_TYPES.includes(img.content_type ?? '')) throw new HttpError(400, 'image_type_invalid');
    if (base64Bytes(b64) > MAX_IMAGE_BYTES) throw new HttpError(413, 'image_too_large');
    // VERIFY: POST /{act}/adimages with `bytes` (base64) returns { images: { <name>: { hash, url } } }.
    const up = await graphPost<{ images?: Record<string, { hash?: string }> }>(
      `${act}/adimages`,
      { bytes: b64, name: (img.filename ?? 'lumen-ad').slice(0, 100) },
      token,
    );
    const hash = Object.values(up.images ?? {})[0]?.hash;
    if (!hash) throw new HttpError(502, 'meta_api_error', 'Meta API: image upload returned no hash');
    imageHashes.push(hash);
  }

  // 2) campaign -> ad set -> creative -> ad. Roll back what was created if a later step fails.
  const created: { campaign?: string; adset?: string; creative?: string } = {};
  try {
    const campaign = await graphPost<{ id: string }>(`${act}/campaigns`, toFormFields(buildCampaignPayload(input)), token);
    created.campaign = campaign.id;
    const adset = await graphPost<{ id: string }>(`${act}/adsets`, toFormFields(buildAdSetPayload(input, campaign.id, acc.currency)), token);
    created.adset = adset.id;
    const creative = await graphPost<{ id: string }>(`${act}/adcreatives`, toFormFields(buildCreativePayload(input, imageHashes)), token);
    created.creative = creative.id;
    const ad = await graphPost<{ id: string }>(`${act}/ads`, toFormFields(buildAdPayload(input, adset.id, creative.id)), token);

    return json({
      campaign_id: campaign.id,
      adset_id: adset.id,
      creative_id: creative.id,
      ad_id: ad.id,
      status: 'PAUSED',
      ads_manager_url: adsManagerUrl(act, campaign.id),
    });
  } catch (e) {
    // Deleting the campaign also removes its ad sets/ads; the creative is separate.
    const cleanup = [created.creative, created.campaign].filter((id): id is string => !!id);
    for (const id of cleanup) {
      try {
        await graphDelete(id, token);
      } catch (err) {
        console.error('rollback failed for', id, err);
      }
    }
    throw e;
  }
});
