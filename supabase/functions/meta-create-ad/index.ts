// POST { action, workspace_id?, ... } with the user's JWT. Creates Meta ads from the
// "Create ad" page. Everything is created PAUSED; the advertiser turns it on in Ads Manager.
//
// Actions:
//   { action: 'pages' }                                  -> { pages: [{id, name, picture}] }
//   { action: 'pixels', ad_account_id }                  -> { pixels: [{id, name}] }
//   { action: 'create', input: CreateAdInput, image? }   -> { campaign_id, adset_id, creative_id, ad_id, ads_manager_url }
//      image = { base64, filename, content_type } (jpg/png, <= 8MB)
//
// Only the workspace owner may create ads, on an active plan that includes `create_ads`,
// and only on ad accounts that belong to the workspace. While the Meta app is in
// Development mode this works for people with a role on the app (admins/developers/testers).
import { HttpError, adminClient, json, loadSubscription, readJson, requireUser, resolveWorkspace, serve } from '../_shared/http.ts';
import { graphDelete, graphGetAll, graphPost } from '../_shared/graph.ts';
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
  toFormFields,
  validateCreateAdInput,
  type CreateAdInput,
} from '../_shared/meta-create.ts';

interface Body {
  action?: 'pages' | 'pixels' | 'create';
  workspace_id?: string;
  ad_account_id?: string;
  input?: CreateAdInput;
  image?: { base64?: string; filename?: string; content_type?: string };
}

serve(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  const admin = adminClient();
  const user = await requireUser(req, admin);
  const body = await readJson<Body>(req);

  const { workspaceId, role } = await resolveWorkspace(admin, user.id, body.workspace_id);
  if (role !== 'owner') throw new HttpError(403, 'owner_only', 'Only the workspace owner can create ads.');

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
    // VERIFY: /me/accounts lists Pages the user has a task on; picture{url} field shape.
    const pages = await graphGetAll<{ id: string; name: string; picture?: { data?: { url?: string } } }>(
      'me/accounts',
      { fields: 'id,name,picture{url}', limit: '100' },
      token,
      5,
    );
    return json({ pages: pages.map((p) => ({ id: p.id, name: p.name, picture: p.picture?.data?.url ?? null })) });
  }

  if (body.action === 'pixels') {
    const acc = await loadAccount(body.ad_account_id);
    const pixels = await graphGetAll<{ id: string; name: string }>(`${acc.meta_account_id}/adspixels`, { fields: 'id,name', limit: '100' }, token, 5);
    return json({ pixels });
  }

  if (body.action !== 'create') throw new HttpError(400, 'unknown_action');
  const input = body.input;
  if (!input) throw new HttpError(400, 'missing_input');
  const acc = await loadAccount(input.adAccountId);
  const errors = validateCreateAdInput(input, acc.currency);
  if (errors.length) return json({ error: 'invalid_input', errors }, 400);

  const act = acc.meta_account_id;

  // 1) Optional image upload -> hash
  let imageHash: string | undefined;
  if (body.image?.base64) {
    const b64 = body.image.base64.replace(/^data:[^,]+,/, '');
    if (!IMAGE_TYPES.includes(body.image.content_type ?? '')) throw new HttpError(400, 'image_type_invalid');
    if (base64Bytes(b64) > MAX_IMAGE_BYTES) throw new HttpError(413, 'image_too_large');
    // VERIFY: POST /{act}/adimages with `bytes` (base64) returns { images: { <name>: { hash, url } } }.
    const up = await graphPost<{ images?: Record<string, { hash?: string }> }>(
      `${act}/adimages`,
      { bytes: b64, name: (body.image.filename ?? 'lumen-ad').slice(0, 100) },
      token,
    );
    imageHash = Object.values(up.images ?? {})[0]?.hash;
    if (!imageHash) throw new HttpError(502, 'meta_api_error', 'Meta API: image upload returned no hash');
  }

  // 2) campaign -> ad set -> creative -> ad. Roll back what was created if a later step fails.
  const created: { campaign?: string; adset?: string; creative?: string } = {};
  try {
    const campaign = await graphPost<{ id: string }>(`${act}/campaigns`, toFormFields(buildCampaignPayload(input)), token);
    created.campaign = campaign.id;
    const adset = await graphPost<{ id: string }>(`${act}/adsets`, toFormFields(buildAdSetPayload(input, campaign.id, acc.currency)), token);
    created.adset = adset.id;
    const creative = await graphPost<{ id: string }>(`${act}/adcreatives`, toFormFields(buildCreativePayload(input, imageHash)), token);
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
