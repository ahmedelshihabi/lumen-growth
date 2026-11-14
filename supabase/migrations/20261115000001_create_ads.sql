-- "Create ad" page: new plan feature `create_ads` on Growth and Agency (and therefore the Growth trial).
-- Safe to run more than once.
update public.plans
   set features = array_append(features, 'create_ads')
 where tier in ('growth', 'agency')
   and not ('create_ads' = any (features));

comment on column public.plans.features is
  'Feature keys the UI gates on: overview, campaigns, pacing, alerts, creatives, recommendations, create_ads, priority_support';
