import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EpgChannelEntry, LiveChannel } from './types';

const { XuperNative } = NativeModules as {
  XuperNative: {
    fetchEpgForChannels(urlStr: string, channelsJson: string, offsetMinutes: number): Promise<string>;
  };
};

const EPG_SOURCES: Record<string, string> = {
  MX1: 'https://epgshare01.online/epgshare01/epg_ripper_MX1.xml.gz',
  CO1: 'https://epgshare01.online/epgshare01/epg_ripper_CO1.xml.gz',
  AR1: 'https://epgshare01.online/epgshare01/epg_ripper_AR1.xml.gz',
  ES1: 'https://epgshare01.online/epgshare01/epg_ripper_ES1.xml.gz',
};

const STORAGE_OFFSET_KEY = '@xuper/epg_offset_min_v1';
let cachedOffsetMinutes: number | null = null;

export async function getEpgOffsetMinutes(): Promise<number> {
  if (cachedOffsetMinutes !== null) return cachedOffsetMinutes;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_OFFSET_KEY);
    cachedOffsetMinutes = raw ? Number(raw) || 0 : 0;
  } catch {
    cachedOffsetMinutes = 0;
  }
  return cachedOffsetMinutes;
}

export async function setEpgOffsetMinutes(minutes: number): Promise<void> {
  cachedOffsetMinutes = Math.max(-720, Math.min(720, Math.round(minutes)));
  await AsyncStorage.setItem(STORAGE_OFFSET_KEY, String(cachedOffsetMinutes));
}

export async function getEpgForChannels(
  channels: LiveChannel[],
  country = 'auto',
): Promise<Record<string, EpgChannelEntry>> {
  if (!channels.length) return {};
  const targetCountry = country === 'auto' ? 'MX1' : EPG_SOURCES[country] ? country : 'MX1';
  const url = EPG_SOURCES[targetCountry];
  const offsetMin = await getEpgOffsetMinutes();
  try {
    const req = channels.map((c) => ({ id: c.id, name: c.name }));
    const rawJson = await XuperNative.fetchEpgForChannels(url, JSON.stringify(req), offsetMin);
    if (!rawJson) return {};
    const parsed = JSON.parse(rawJson);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
