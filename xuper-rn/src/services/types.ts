export interface MediaItem {
  id: string;
  title: string;
  poster: string;
  backdrop?: string;
  rating?: string;
  year?: string;
  quality?: string;
  category?: string;
  type: 'movie' | 'series' | 'anime' | 'kids';
  genres?: string[];
  description?: string;
  contentType?: number;
}

export interface Episode {
  id: string;
  number: number;
  title: string;
  thumbnail?: string;
  duration?: string;
  season?: number;
  contentId?: string;
  episodeId?: string;
  raw?: unknown;
}

export interface Season {
  id?: string;
  number: number;
  name: string;
  episodes: Episode[];
}

export interface MediaDetail extends MediaItem {
  synopsis?: string;
  cast?: string[];
  director?: string;
  duration?: string;
  trailer?: string;
  seasons?: Season[];
  episodes?: Episode[];
}

export interface LiveChannel {
  id: string;
  number: string;
  name: string;
  logo: string;
  category: string;
  categoryId?: string;
  currentProgram?: string;
  streamUrl?: string;
  quality?: string;
  isAdult?: boolean;
}

export interface LiveCategory {
  id: string;
  name: string;
  count: number;
  isAdult?: boolean;
}

export interface EpgProgram {
  title: string;
  startMs: number;
  endMs: number;
  desc?: string;
  category?: string;
  startLabel?: string;
  endLabel?: string;
}

export interface EpgChannelEntry {
  channelId: string;
  displayName: string;
  now: EpgProgram | null;
  next: EpgProgram | null;
  progressPct: number;
}

export interface SubtitleTrack {
  lang?: string;
  name: string;
  url: string;
  proxyUrl?: string;
}

export interface TrackInfo {
  quality?: string;
  audio?: string;
  audioLang?: string;
  format?: string;
  bitrate?: string;
  duration?: number;
  url?: string;
  proxyUrl?: string;
  headers?: Record<string, string>;
  backups?: string[];
  qualityIdx?: number;
  audioIdx?: number;
}

export interface ResolvedStream {
  streamUrl: string;
  proxyUrl?: string;
  headers?: Record<string, string>;
  backups?: string[];
  format?: string;
  quality?: string;
  audio?: string;
  duration?: number;
  subtitles?: SubtitleTrack[];
  availableQualities?: string[];
  availableAudios?: string[];
  allTracks?: TrackInfo[];
}

export interface WatchProgressItem {
  mediaId: string;
  title: string;
  poster: string;
  backdrop?: string;
  type: 'movie' | 'series' | 'anime' | 'kids';
  contentType?: number;
  currentTime: number;
  duration: number;
  progressPercent: number;
  episodeId?: string;
  episodeNumber?: number;
  episodeTitle?: string;
  seasonNumber?: number;
  updatedAt: number;
}

export interface EpisodeProgressEntry {
  currentTime: number;
  duration: number;
  progressPercent: number;
  completed?: boolean;
  updatedAt: number;
}

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface SeedInfo {
  portalUrl: string;
  portalKind?: string;
  score?: number;
}
