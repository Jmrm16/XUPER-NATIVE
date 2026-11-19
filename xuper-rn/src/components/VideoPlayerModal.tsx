import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  NativeModules,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Video, {
  SelectedTrackType,
  TextTrackType,
  ViewType,
  type OnLoadData,
  type OnProgressData,
  type VideoRef,
} from 'react-native-video';
import {
  ArrowLeft,
  Captions,
  ChevronLeft,
  ChevronRight,
  ListVideo,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  SkipForward,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Episode, EpgChannelEntry, LiveChannel, MediaItem, ResolvedStream } from '../services/types';
import { saveWatchProgress } from '../services/firebaseClient';

const { XuperNative } = NativeModules as {
  XuperNative: {
    setLandscape(landscape: boolean): void;
  };
};

interface VideoPlayerModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  stream: ResolvedStream | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  isLive?: boolean;
  initialPosition?: number;
  media?: MediaItem | null;
  currentEpisode?: Episode | null;
  episodes?: Episode[];
  seasonNumber?: number;
  onSelectEpisode?: (ep: Episode) => void;
  onSwitchTrack?: (trackIndex: number) => void;
  liveChannels?: LiveChannel[];
  currentChannel?: LiveChannel | null;
  epgMap?: Record<string, EpgChannelEntry>;
  onSelectChannel?: (ch: LiveChannel) => void;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  visible,
  onClose,
  title,
  subtitle,
  stream,
  loading,
  error,
  onRetry,
  isLive = false,
  initialPosition = 0,
  media,
  currentEpisode,
  episodes = [],
  seasonNumber,
  onSelectEpisode,
  onSwitchTrack,
  liveChannels = [],
  currentChannel,
  epgMap = {},
  onSelectChannel,
}) => {
  const insets = useSafeAreaInsets();
  const videoRef = useRef<VideoRef>(null);

  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [osdVisible, setOsdVisible] = useState(true);
  const [currentTime, setCurrentTime] = useState(initialPosition);
  const [duration, setDuration] = useState(stream?.duration || 0);
  const [resizeMode, setResizeMode] = useState<'contain' | 'cover'>('contain');
  const [selectedSubIdx, setSelectedSubIdx] = useState<number>(-1);
  const [selectedTrackIdx, setSelectedTrackIdx] = useState<number>(0);
  const [activeSheet, setActiveSheet] = useState<'none' | 'settings' | 'drawer'>('none');
  const [playerErr, setPlayerErr] = useState<string | null>(null);
  const [fallbackMode, setFallbackMode] = useState(false);

  const seekBarWidth = useRef(1);
  const lastSavedAt = useRef(0);
  const didInitialSeek = useRef(false);
  const osdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleHideOsd = useCallback(() => {
    if (osdTimer.current) clearTimeout(osdTimer.current);
    osdTimer.current = setTimeout(() => {
      if (!paused && activeSheet === 'none') {
        setOsdVisible(false);
      }
    }, 4000);
  }, [paused, activeSheet]);

  useEffect(() => {
    if (visible) {
      XuperNative?.setLandscape?.(true);
      setOsdVisible(true);
      setPaused(false);
      setPlayerErr(null);
      didInitialSeek.current = false;
      scheduleHideOsd();
    } else {
      XuperNative?.setLandscape?.(false);
      setActiveSheet('none');
    }
    return () => {
      if (osdTimer.current) clearTimeout(osdTimer.current);
      if (visible) XuperNative?.setLandscape?.(false);
    };
  }, [visible, scheduleHideOsd]);

  useEffect(() => {
    setBuffering(true);
    setPlayerErr(null);
    setFallbackMode(false);
    didInitialSeek.current = false;
    setCurrentTime(initialPosition || 0);
    setDuration(stream?.duration || 0);
  }, [stream?.proxyUrl, stream?.streamUrl, initialPosition]);

  const persistProgress = useCallback(
    (timeSec: number, durSec: number) => {
      if (isLive || !media || durSec <= 10 || timeSec < 3) return;
      const pct = Math.min(100, Math.round((timeSec / durSec) * 100));
      saveWatchProgress({
        mediaId: media.id,
        title: media.title,
        poster: media.poster,
        backdrop: media.backdrop,
        type: media.type,
        contentType: media.contentType,
        currentTime: timeSec,
        duration: durSec,
        progressPercent: pct,
        episodeId: currentEpisode?.id,
        episodeNumber: currentEpisode?.number,
        episodeTitle: currentEpisode?.title,
        seasonNumber,
        updatedAt: Date.now(),
      }).catch(() => {});
    },
    [isLive, media, currentEpisode, seasonNumber],
  );

  const handleClose = useCallback(() => {
    persistProgress(currentTime, duration);
    XuperNative?.setLandscape?.(false);
    onClose();
  }, [persistProgress, currentTime, duration, onClose]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, handleClose]);

  const handleLoad = (data: OnLoadData) => {
    setBuffering(false);
    const dur = data.duration > 0 ? data.duration : stream?.duration || 0;
    if (dur > 0) setDuration(dur);
    if (!isLive && initialPosition > 5 && !didInitialSeek.current) {
      didInitialSeek.current = true;
      videoRef.current?.seek(initialPosition);
    }
  };

  const handleProgress = (data: OnProgressData) => {
    if (buffering) setBuffering(false);
    setCurrentTime(data.currentTime);
    const dur = duration || data.seekableDuration || stream?.duration || 0;
    if (dur > 0 && dur !== duration) setDuration(dur);
    const now = Date.now();
    if (now - lastSavedAt.current > 5000) {
      lastSavedAt.current = now;
      persistProgress(data.currentTime, dur);
    }
  };

  const handleSeekBy = (delta: number) => {
    if (isLive) return;
    const target = Math.max(0, Math.min(duration || 99999, currentTime + delta));
    videoRef.current?.seek(target);
    setCurrentTime(target);
    scheduleHideOsd();
  };

  const handleNextEpisode = () => {
    if (!currentEpisode || !episodes.length || !onSelectEpisode) return;
    const idx = episodes.findIndex((e) => e.id === currentEpisode.id);
    if (idx >= 0 && idx + 1 < episodes.length) {
      persistProgress(currentTime, duration);
      onSelectEpisode(episodes[idx + 1]);
    }
  };

  const handleStepChannel = (dir: -1 | 1) => {
    if (!currentChannel || !liveChannels.length || !onSelectChannel) return;
    const idx = liveChannels.findIndex((c) => c.id === currentChannel.id);
    if (idx >= 0) {
      const nextIdx = (idx + dir + liveChannels.length) % liveChannels.length;
      onSelectChannel(liveChannels[nextIdx]);
    }
  };

  const preferDirect = isLive || stream?.format === 'mp4';
  const usingDirect = preferDirect ? !fallbackMode : fallbackMode;
  const playUri = usingDirect
    ? stream?.streamUrl || stream?.proxyUrl || ''
    : stream?.proxyUrl || stream?.streamUrl || '';
  const playHeaders = usingDirect ? stream?.headers : undefined;
  const playType = isLive
    ? 'm3u8'
    : stream?.format === 'mp4'
      ? 'mp4'
      : !usingDirect
        ? 'm3u8'
        : undefined;
  const textTracks = (stream?.subtitles || []).map((s, idx) => ({
    title: s.name || `Sub ${idx + 1}`,
    language: ((s.lang || 'es').slice(0, 2) || 'es') as any,
    type: TextTrackType.SUBRIP,
    uri: s.proxyUrl || s.url,
  }));

  const selectedTextTrack =
    selectedSubIdx >= 0 && selectedSubIdx < textTracks.length
      ? { type: SelectedTrackType.INDEX, value: selectedSubIdx }
      : { type: SelectedTrackType.DISABLED };

  const hasNextEp =
    !isLive &&
    Boolean(currentEpisode && episodes.length > 0 && episodes.findIndex((e) => e.id === currentEpisode.id) < episodes.length - 1);

  const progressPct = duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;

  if (!visible) return null;

  return (
    <View style={styles.modalOverlay}>
      <StatusBar hidden />
      <View style={styles.root}>
        {playUri ? (
          <Video
            ref={videoRef}
            source={{
              uri: playUri,
              headers: playHeaders,
              type: playType,
              textTracks: textTracks.length ? textTracks : undefined,
            }}
            style={styles.videoFill}
            viewType={ViewType.TEXTURE}
            resizeMode={resizeMode}
            paused={paused}
            selectedTextTrack={selectedTextTrack}
            onLoad={handleLoad}
            onReadyForDisplay={() => setBuffering(false)}
            onProgress={handleProgress}
            onBuffer={(e) => setBuffering(e.isBuffering)}
            onEnd={() => {
              persistProgress(duration, duration);
              if (hasNextEp) handleNextEpisode();
            }}
            onError={(e) => {
              if (!fallbackMode && stream?.proxyUrl && stream?.streamUrl && stream.proxyUrl !== stream.streamUrl) {
                setFallbackMode(true);
                setBuffering(true);
                return;
              }
              setBuffering(false);
              setPlayerErr(
                e?.error?.errorString ||
                  e?.error?.errorCode ||
                  'Error al reproducir el stream',
              );
            }}
            progressUpdateInterval={1000}
            playInBackground={false}
          />
        ) : null}

        {/* Touch surface */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (activeSheet !== 'none') {
              setActiveSheet('none');
              return;
            }
            const next = !osdVisible;
            setOsdVisible(next);
            if (next) scheduleHideOsd();
          }}
        />

        {/* Loading / Buffering */}
        {(loading || (buffering && !error && !playerErr)) && (
          <View style={styles.centerOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#E50914" />
            <Text style={styles.loadingText}>
              {loading ? 'Conectando al servidor…' : 'Cargando video…'}
            </Text>
          </View>
        )}

        {/* Error */}
        {(error || playerErr) && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>No se pudo reproducir</Text>
            <Text style={styles.errorSub}>{error || playerErr}</Text>
            <View style={styles.errorActions}>
              {onRetry && (
                <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
                  <Text style={styles.retryBtnText}>Reintentar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.closeErrBtn} onPress={handleClose}>
                <Text style={styles.closeErrText}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* OSD Controls */}
        {osdVisible && !error && !playerErr && (
          <View
            style={[
              styles.osdContainer,
              { paddingLeft: Math.max(16, insets.left), paddingRight: Math.max(16, insets.right) },
            ]}
            pointerEvents="box-none"
          >
            {/* Top Bar */}
            <View style={styles.topBar}>
              <TouchableOpacity style={styles.iconBtn} onPress={handleClose}>
                <ArrowLeft color="#FFF" size={22} />
              </TouchableOpacity>
              <View style={styles.titleBlock}>
                <View style={styles.titleRow}>
                  {isLive && (
                    <View style={styles.liveBadge}>
                      <Text style={styles.liveBadgeText}>● EN VIVO</Text>
                    </View>
                  )}
                  <Text style={styles.playerTitle} numberOfLines={1}>
                    {title}
                  </Text>
                </View>
                {subtitle ? (
                  <Text style={styles.playerSubtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>

              <View style={styles.topActions}>
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => setResizeMode((m) => (m === 'contain' ? 'cover' : 'contain'))}
                >
                  {resizeMode === 'contain' ? (
                    <Maximize2 color="#FFF" size={19} />
                  ) : (
                    <Minimize2 color="#FFF" size={19} />
                  )}
                </TouchableOpacity>

                {!isLive && (
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => setActiveSheet((s) => (s === 'settings' ? 'none' : 'settings'))}
                  >
                    <Settings color="#FFF" size={19} />
                  </TouchableOpacity>
                )}

                {((!isLive && episodes.length > 0) || (isLive && liveChannels.length > 0)) && (
                  <TouchableOpacity
                    style={styles.pillBtn}
                    onPress={() => setActiveSheet((s) => (s === 'drawer' ? 'none' : 'drawer'))}
                  >
                    <ListVideo color="#FFF" size={17} />
                    <Text style={styles.pillBtnText}>
                      {isLive ? `Canales (${liveChannels.length})` : `Episodios (${episodes.length})`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Center Play/Seek */}
            <View style={styles.centerControls} pointerEvents="box-none">
              {isLive ? (
                <TouchableOpacity style={styles.seekBtn} onPress={() => handleStepChannel(-1)}>
                  <ChevronLeft color="#FFF" size={28} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.seekBtn} onPress={() => handleSeekBy(-10)}>
                  <RotateCcw color="#FFF" size={26} />
                  <Text style={styles.seekLabel}>10</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.playBtn}
                onPress={() => {
                  setPaused((p) => !p);
                  scheduleHideOsd();
                }}
              >
                {paused ? <Play color="#FFF" size={32} fill="#FFF" /> : <Pause color="#FFF" size={32} fill="#FFF" />}
              </TouchableOpacity>

              {isLive ? (
                <TouchableOpacity style={styles.seekBtn} onPress={() => handleStepChannel(1)}>
                  <ChevronRight color="#FFF" size={28} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.seekBtn} onPress={() => handleSeekBy(10)}>
                  <RotateCw color="#FFF" size={26} />
                  <Text style={styles.seekLabel}>10</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Bottom Bar */}
            <View style={styles.bottomBar}>
              {!isLive ? (
                <>
                  <View style={styles.seekRow}>
                    <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
                    <View
                      style={styles.seekTrackWrap}
                      onLayout={(e) => {
                        seekBarWidth.current = Math.max(1, e.nativeEvent.layout.width);
                      }}
                      onStartShouldSetResponder={() => true}
                      onResponderGrant={(e) => {
                        if (duration <= 0) return;
                        const ratio = Math.max(
                          0,
                          Math.min(1, e.nativeEvent.locationX / seekBarWidth.current),
                        );
                        const t = ratio * duration;
                        videoRef.current?.seek(t);
                        setCurrentTime(t);
                      }}
                    >
                      <View style={styles.seekTrackBg}>
                        <View style={[styles.seekTrackFill, { width: `${progressPct}%` }]} />
                      </View>
                      <View style={[styles.seekThumb, { left: `${progressPct}%` }]} />
                    </View>
                    <Text style={styles.timeText}>{formatTime(duration)}</Text>
                  </View>

                  <View style={styles.bottomMetaRow}>
                    <Text style={styles.trackBadgeText}>
                      {stream?.quality || 'HD'} · {stream?.audio || 'Latino'}
                    </Text>
                    {hasNextEp && (
                      <TouchableOpacity style={styles.nextEpBtn} onPress={handleNextEpisode}>
                        <SkipForward color="#FFF" size={15} />
                        <Text style={styles.nextEpText}>Siguiente episodio</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              ) : (
                <View style={styles.bottomMetaRow}>
                  <Text style={styles.trackBadgeText}>
                    {currentChannel?.quality || 'HD'} · Reproducción nativa ExoPlayer
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Settings Sheet (Quality & Subtitles) */}
        {activeSheet === 'settings' && (
          <View style={styles.sideSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Audio, Calidad y Subtítulos</Text>
              <TouchableOpacity onPress={() => setActiveSheet('none')}>
                <X color="#FFF" size={20} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetScroll}>
              {stream?.allTracks && stream.allTracks.length > 0 && (
                <>
                  <Text style={styles.sheetSection}>Pistas disponibles</Text>
                  {stream.allTracks.map((t, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={[
                        styles.sheetItem,
                        selectedTrackIdx === idx && styles.sheetItemActive,
                      ]}
                      onPress={() => {
                        setSelectedTrackIdx(idx);
                        setActiveSheet('none');
                        onSwitchTrack?.(idx);
                      }}
                    >
                      <Text style={styles.sheetItemText}>
                        {t.quality} · {t.audio} ({t.format})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}

              <Text style={styles.sheetSection}>
                <Captions color="#9CA3AF" size={14} /> Subtítulos
              </Text>
              <TouchableOpacity
                style={[styles.sheetItem, selectedSubIdx === -1 && styles.sheetItemActive]}
                onPress={() => {
                  setSelectedSubIdx(-1);
                  setActiveSheet('none');
                }}
              >
                <Text style={styles.sheetItemText}>Desactivados</Text>
              </TouchableOpacity>
              {(stream?.subtitles || []).map((s, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.sheetItem, selectedSubIdx === idx && styles.sheetItemActive]}
                  onPress={() => {
                    setSelectedSubIdx(idx);
                    setActiveSheet('none');
                  }}
                >
                  <Text style={styles.sheetItemText}>{s.name || s.lang || `Subtítulo ${idx + 1}`}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Drawer Sheet (Episodes or Live Channels) */}
        {activeSheet === 'drawer' && (
          <View style={styles.sideSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{isLive ? 'Canales en Vivo' : 'Episodios'}</Text>
              <TouchableOpacity onPress={() => setActiveSheet('none')}>
                <X color="#FFF" size={20} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetScroll}>
              {isLive
                ? liveChannels.map((ch) => {
                    const active = currentChannel?.id === ch.id;
                    const epg = epgMap[ch.id];
                    return (
                      <TouchableOpacity
                        key={ch.id}
                        style={[styles.sheetItem, active && styles.sheetItemActive]}
                        onPress={() => {
                          setActiveSheet('none');
                          onSelectChannel?.(ch);
                        }}
                      >
                        <Text style={styles.sheetItemText} numberOfLines={1}>
                          {ch.number}. {ch.name}
                        </Text>
                        {epg?.now ? (
                          <Text style={styles.sheetItemSub} numberOfLines={1}>
                            Ahora: {epg.now.title}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })
                : episodes.map((ep) => {
                    const active = currentEpisode?.id === ep.id;
                    return (
                      <TouchableOpacity
                        key={ep.id}
                        style={[styles.sheetItem, active && styles.sheetItemActive]}
                        onPress={() => {
                          setActiveSheet('none');
                          onSelectEpisode?.(ep);
                        }}
                      >
                        <Text style={styles.sheetItemText} numberOfLines={1}>
                          E{ep.number} · {ep.title}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    elevation: 30,
    backgroundColor: '#000',
  },
  videoFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  root: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#D1D5DB',
    marginTop: 10,
    fontSize: 13,
    fontWeight: '500',
  },
  errorBox: {
    backgroundColor: 'rgba(20, 20, 30, 0.94)',
    padding: 22,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(229, 9, 20, 0.45)',
    alignItems: 'center',
    maxWidth: 340,
  },
  errorTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  errorSub: {
    color: '#9CA3AF',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 10,
  },
  retryBtn: {
    backgroundColor: '#E50914',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 13,
  },
  closeErrBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  closeErrText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 13,
  },
  osdContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.38)',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(20,20,30,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveBadge: {
    backgroundColor: '#E50914',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  liveBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
  },
  playerTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  playerSubtitle: {
    color: '#34D399',
    fontSize: 12,
    marginTop: 2,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(20,20,30,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  pillBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  centerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 44,
  },
  playBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(229, 9, 20, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(20,20,30,0.68)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekLabel: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
    position: 'absolute',
    bottom: 6,
  },
  bottomBar: {
    gap: 6,
  },
  seekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timeText: {
    color: '#E5E7EB',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 46,
    textAlign: 'center',
  },
  seekTrackWrap: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  seekTrackBg: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  seekTrackFill: {
    height: '100%',
    backgroundColor: '#E50914',
  },
  seekThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFF',
    marginLeft: -7,
  },
  bottomMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trackBadgeText: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  nextEpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  nextEpText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  sideSheet: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 310,
    backgroundColor: '#12121A',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.1)',
    padding: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  sheetScroll: {
    flex: 1,
  },
  sheetSection: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 6,
  },
  sheetItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  sheetItemActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.22)',
    borderWidth: 1,
    borderColor: '#E50914',
  },
  sheetItemText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  sheetItemSub: {
    color: '#34D399',
    fontSize: 11,
    marginTop: 2,
  },
});
