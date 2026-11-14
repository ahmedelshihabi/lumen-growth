import { DICTS, type DictKey } from '../i18n/dict';

export type MsgVars = Record<string, string | number>;

/** A translatable sentence: a dictionary key plus the values to fill in. Rendered by t() in the UI. */
export interface Msg {
  key: DictKey;
  vars: MsgVars;
}

export const msg = (key: DictKey, vars: MsgVars = {}): Msg => ({ key, vars });

/** English rendering, kept on rule outputs as plain strings for logs, exports and tests. */
export function renderEn(m: Msg): string {
  let s: string = DICTS.en[m.key];
  for (const [k, v] of Object.entries(m.vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
