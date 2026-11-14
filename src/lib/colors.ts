import type { Channel } from '../data/types';
import type { Theme } from '../state/AppContext';

/**
 * Chart palette (validated categorical slots, stepped separately for each
 * theme). Channels always keep the same colour, whatever the filter.
 */
const PALETTE = {
  light: {
    meta: '#2a78d6',
    google: '#eb6834',
    tiktok: '#1baf7a',
    revenue: '#6250d6',
    spend: '#9a9a96',
    grid: '#e7e5e4',
    axis: '#78716c',
    surface: '#ffffff',
  },
  dark: {
    meta: '#3987e5',
    google: '#d95926',
    tiktok: '#199e70',
    revenue: '#9085e9',
    spend: '#8b8b86',
    grid: '#2e2e2c',
    axis: '#a8a29e',
    surface: '#18181b',
  },
} as const;

export function chartColors(theme: Theme) {
  return PALETTE[theme];
}

export function channelColor(theme: Theme, c: Channel): string {
  return PALETTE[theme][c];
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  meta: 'Meta',
  google: 'Google',
  tiktok: 'TikTok',
};
