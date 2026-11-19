import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Heart,
  Tv,
  Radio,
  Sparkles,
  AlertCircle,
  Loader2,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Channel, api } from '../services/api';

interface LiveTVInlinePlayerProps {
  channel: Channel | null;
  channelsList: Channel[];
  onSelectChannel: (channel: Channel) => void;
  onExpandFullscreen: (channel: Channel, currentUrl?: string) => void;
  isFav?: boolean;
  onToggleFav?: (channel: Channel) => void;
  isSuspended?: boolean; // When full-screen modal player is open
}

export const LiveTVInlinePlayer: React.FC<LiveTVInlinePlayerProps> = ({
  channel,
  channelsList,
  onSelectChannel,
  onExpandFullscreen,
  isFav = false,
  onToggleFav,
  isSuspended = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [resolvedUrl, setResolvedUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isControlsVisible, setIsControlsVisible] = useState<boolean>(false);
  const controlsTimeoutRef = useRef<number | null>(null);

  const [isMuted, setIsMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem('xuper_live_inline_muted') === 'true';
    } catch {
      return false;
    }
  });

  const [volume, setVolume] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('xuper_live_inline_vol');
      return saved !== null ? Number(saved) : 0.85;
    } catch {
      return 0.85;
    }
  });

  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  // Keep track of current channel index in the list
  const currentIndex = channelsList.findIndex(
    (c) =>
      (c.channelCode && c.channelCode === channel?.channelCode) ||
      (c.id && c.id === channel?.id) ||
      c.name === channel?.name
  );

  const handlePrevChannel = useCallback(() => {
    if (channelsList.length === 0) return;
    const prevIdx = currentIndex <= 0 ? channelsList.length - 1 : currentIndex - 1;
    onSelectChannel(channelsList[prevIdx]);
  }, [channelsList, currentIndex, onSelectChannel]);

  const handleNextChannel = useCallback(() => {
    if (channelsList.length === 0) return;
    const nextIdx = (currentIndex + 1) % channelsList.length;
    onSelectChannel(channelsList[nextIdx]);
  }, [channelsList, currentIndex, onSelectChannel]);

  // Resolve and play channel
  const loadChannelStream = useCallback(async (targetChannel: Channel) => {
    setIsLoading(true);
    setStreamError(null);

    // Clean up previous Hls instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const v = videoRef.current;
    if (v) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }

    try {
      const code = targetChannel.channelCode || targetChannel.id || '';
      const isPublicM3u = code.startsWith('public_m3u_');
      const res = await api.resolveLive(code, isPublicM3u ? undefined : targetChannel.streamUrl);

      if (!res || !res.url) {
        setStreamError('Señal no disponible temporalmente');
        setIsLoading(false);
        return;
      }

      setResolvedUrl(res.url);
    } catch (err) {
      console.error('Error resolving live stream for inline player:', err);
      setStreamError('Error al conectar con la señal en vivo');
      setIsLoading(false);
    }
  }, []);

  // When channel prop changes, load stream
  useEffect(() => {
    if (!channel) return;
    loadChannelStream(channel);
  }, [channel, loadChannelStream]);

  // Attach resolvedUrl to video with Hls
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !resolvedUrl) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (isSuspended) {
      v.pause();
      return;
    }

    const isHls = resolvedUrl.includes('.m3u8') || (!resolvedUrl.includes('.mp4') && !resolvedUrl.includes('.mkv'));

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 20,
        maxBufferLength: 10,
        maxMaxBufferLength: 15,
        liveSyncDurationCount: 3,
      });

      hls.loadSource(resolvedUrl);
      hls.attachMedia(v);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        v.volume = volume;
        v.muted = isMuted;
        v.play().then(() => {
          setIsPlaying(true);
        }).catch(() => {
          // If browser policy blocks autoplay with sound, mute and play
          v.muted = true;
          setIsMuted(true);
          v.play().then(() => setIsPlaying(true)).catch(() => {});
        });
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              setStreamError('Error en la transmisión HLS');
              setIsLoading(false);
              break;
          }
        }
      });

      hlsRef.current = hls;
    } else {
      v.src = resolvedUrl;
      v.volume = volume;
      v.muted = isMuted;
      v.play().then(() => {
        setIsPlaying(true);
        setIsLoading(false);
      }).catch(() => {
        v.muted = true;
        setIsMuted(true);
        v.play().then(() => {
          setIsPlaying(true);
          setIsLoading(false);
        }).catch(() => {
          setIsLoading(false);
        });
      });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [resolvedUrl, isSuspended]);

  // Handle suspended state when full-screen modal opens
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isSuspended) {
      v.pause();
      setIsPlaying(false);
    } else if (resolvedUrl && !streamError) {
      v.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [isSuspended, resolvedUrl, streamError]);

  // Volume & Mute sync
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = isMuted;
    try {
      localStorage.setItem('xuper_live_inline_vol', String(volume));
      localStorage.setItem('xuper_live_inline_muted', String(isMuted));
    } catch {}
  }, [volume, isMuted]);

  const handleTogglePlay = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const handleToggleMute = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
      if (!nextMuted && volume === 0) {
        setVolume(0.5);
      }
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    if (val > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const handleReload = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (channel) {
      loadChannelStream(channel);
    }
  };

  const handleExpand = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (channel) {
      onExpandFullscreen(channel, resolvedUrl);
    }
  };

  const handleMouseMove = () => {
    setIsControlsVisible(true);
    if (controlsTimeoutRef.current) {
      window.clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = window.setTimeout(() => {
      setIsControlsVisible(false);
    }, 3200);
  };

  // If no channel is passed, render a sleek ready placeholder
  if (!channel) {
    return (
      <div className="w-full bg-[#141416] border border-zinc-800 rounded-2xl p-8 text-center mb-6 shadow-xl">
        <Tv className="w-10 h-10 text-red-500 mx-auto mb-3 animate-pulse" />
        <h3 className="text-lg font-bold text-white">Sintonizador de Televisión en Vivo</h3>
        <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto">
          Selecciona cualquier canal de la lista abajo para sintonizarlo al instante en esta pantalla.
        </p>
      </div>
    );
  }

  const epgProgressVal =
    typeof channel.epgProgress === 'number' && channel.epgProgress > 0
      ? Math.min(100, Math.max(5, channel.epgProgress))
      : 50;

  return (
    <section
      aria-label="Reproductor de Televisión en Vivo Integrado"
      className="w-full bg-[#111113] border border-zinc-800/90 rounded-2xl overflow-hidden shadow-2xl relative mb-6 transition-all duration-300"
    >
      {/* Top Banner Header with Status and Controls */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#17171a] border-b border-zinc-800/80 text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-600/20 border border-red-500/40 text-red-400 font-bold uppercase tracking-wider text-[10px]">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            <span>EN PANTALLA</span>
          </span>
          <span className="text-zinc-400 font-medium truncate">
            {currentIndex >= 0 ? `Canal ${currentIndex + 1} de ${channelsList.length}` : 'En Vivo'}
          </span>
          <span className="hidden sm:inline-block text-zinc-600">•</span>
          <span className="hidden sm:inline-block font-semibold text-zinc-200 truncate">
            {channel.name}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleExpand}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md transition-all hover:scale-105 cursor-pointer"
            title="Expandir a Pantalla Completa"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pantalla Grande</span>
          </button>

          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded-lg bg-zinc-800/70 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title={isCollapsed ? 'Desplegar reproductor' : 'Plegar reproductor'}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Body (Collapsible) */}
      {!isCollapsed && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
          {/* VIDEO PLAYER SCREEN (Left / Main Stage) */}
          <div
            className="lg:col-span-7 xl:col-span-8 relative aspect-video bg-black flex items-center justify-center overflow-hidden group select-none"
            onMouseMove={handleMouseMove}
            onDoubleClick={handleExpand}
          >
            <video
              ref={videoRef}
              className="w-full h-full object-contain cursor-pointer"
              playsInline
              onClick={handleTogglePlay}
            />

            {/* Loading Buffering Indicator */}
            {isLoading && (
              <div className="absolute inset-0 z-20 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-4 text-center pointer-events-none">
                {channel.logo ? (
                  <img
                    src={channel.logo}
                    alt={channel.name}
                    className="h-12 w-auto max-w-[120px] object-contain drop-shadow animate-pulse"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Tv className="w-10 h-10 text-red-500 animate-pulse" />
                )}
                <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                  <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                  <span>Sintonizando {channel.name}...</span>
                </div>
              </div>
            )}

            {/* Error Overlay with Retry */}
            {streamError && !isLoading && (
              <div className="absolute inset-0 z-20 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-4 text-center">
                <AlertCircle className="w-10 h-10 text-amber-500" />
                <p className="text-xs text-zinc-300 max-w-sm">{streamError}</p>
                <button
                  type="button"
                  onClick={handleReload}
                  className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-bold text-white transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reintentar señal</span>
                </button>
              </div>
            )}

            {/* Floating Unmute Alert if browser muted audio */}
            {isMuted && isPlaying && !isLoading && !streamError && (
              <button
                type="button"
                onClick={handleToggleMute}
                className="absolute top-3 left-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/85 hover:bg-black text-white border border-red-500/50 text-xs font-bold backdrop-blur-md shadow-xl transition-all hover:scale-105 cursor-pointer animate-bounce"
              >
                <VolumeX className="w-4 h-4 text-red-500" />
                <span>Activar Sonido</span>
              </button>
            )}

            {/* Direct Zapping Arrow Buttons Overlaid on Left and Right */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePrevChannel();
              }}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-9 h-12 rounded-lg bg-black/60 hover:bg-black/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border border-white/10 hover:border-red-500/60 cursor-pointer shadow-lg"
              title="Canal anterior"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNextChannel();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-9 h-12 rounded-lg bg-black/60 hover:bg-black/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border border-white/10 hover:border-red-500/60 cursor-pointer shadow-lg"
              title="Canal siguiente"
            >
              <ChevronRight className="w-5 h-5" />
            </button>

            {/* Overlaid Bottom Video Controls Bar */}
            <div
              className={`absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-3 pt-8 flex items-center justify-between gap-3 transition-opacity duration-200 ${
                isControlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                  title={isPlaying ? 'Pausar' : 'Reproducir'}
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                </button>

                <button
                  type="button"
                  onClick={handleToggleMute}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                  title={isMuted ? 'Activar sonido' : 'Silenciar'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-red-500" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>

                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 sm:w-20 accent-red-600 h-1 bg-zinc-700 rounded-lg cursor-pointer"
                  title={`Volumen: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
                />

                <button
                  type="button"
                  onClick={handleReload}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                  title="Recargar señal"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-zinc-400 bg-black/60 px-2 py-0.5 rounded border border-white/10">
                  DIRECTO • FHD
                </span>
                <button
                  type="button"
                  onClick={handleExpand}
                  className="p-1.5 rounded-full bg-red-600 hover:bg-red-500 text-white shadow transition-all hover:scale-105 cursor-pointer"
                  title="Ver en Pantalla Completa"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT SIDE: CHANNEL INFO & QUICK ZAPPING DASHBOARD */}
          <div className="lg:col-span-5 xl:col-span-4 p-5 sm:p-6 flex flex-col justify-between bg-gradient-to-b from-[#18181b] via-[#121214] to-[#0c0c0e] border-t lg:border-t-0 lg:border-l border-zinc-800/80 space-y-4">
            {/* Channel Logo and Identity */}
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-16 h-12 rounded-xl bg-zinc-900 border border-zinc-800 p-1 flex items-center justify-center shrink-0 overflow-hidden shadow-inner">
                    {channel.logo ? (
                      <img
                        src={channel.logo}
                        alt={channel.name}
                        className="max-h-full max-w-full object-contain"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Tv className="w-6 h-6 text-zinc-500" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white tracking-tight leading-tight line-clamp-1">
                      {channel.name}
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold text-red-500 bg-red-950/70 border border-red-800/60 px-1.5 py-0.2 rounded">
                        ● EN VIVO
                      </span>
                      {channel.category && (
                        <span className="text-[11px] text-zinc-400 font-medium">
                          {channel.category.split(';')[0]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {onToggleFav && (
                  <button
                    type="button"
                    onClick={() => onToggleFav(channel)}
                    className={`p-2 rounded-full border transition-colors cursor-pointer ${
                      isFav
                        ? 'bg-pink-950/80 border-pink-700/80 text-pink-500'
                        : 'bg-zinc-800/70 border-zinc-700/60 text-zinc-400 hover:text-white'
                    }`}
                    title={isFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  >
                    <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                  </button>
                )}
              </div>

              {/* Electronic Programme Guide (EPG) */}
              <div className="bg-black/50 rounded-xl p-3.5 border border-zinc-800/80 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400 font-semibold flex items-center gap-1.5 text-[11px]">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    TRANSMITIENDO AHORA:
                  </span>
                  {channel.epgTime && (
                    <span className="font-mono text-[11px] text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                      {channel.epgTime}
                    </span>
                  )}
                </div>

                <div className="text-sm font-bold text-white line-clamp-2 leading-snug">
                  {channel.epgTitle || 'Programación en vivo'}
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-red-600 to-amber-500 rounded-full transition-all duration-300"
                    style={{ width: `${epgProgressVal}%` }}
                  />
                </div>

                {channel.epgNext && (
                  <div className="text-[11px] text-zinc-400 flex items-center gap-1 pt-1 border-t border-zinc-800/60 truncate">
                    <span className="text-zinc-500 font-bold shrink-0">Luego:</span>
                    <span className="text-zinc-300 truncate">{channel.epgNext}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="space-y-2 pt-2 border-t border-zinc-800/70">
              {/* PRIMARY FULLSCREEN EXPAND BUTTON */}
              <button
                type="button"
                onClick={handleExpand}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold text-xs sm:text-sm shadow-lg shadow-red-700/30 flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                <Maximize2 className="w-4 h-4" />
                <span>Ver en Pantalla Completa</span>
              </button>

              {/* PREV / NEXT CHANNEL ZAPPING BUTTONS */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handlePrevChannel}
                  disabled={channelsList.length <= 1}
                  className="py-2 px-3 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 border border-zinc-700/60 transition-colors cursor-pointer disabled:opacity-40"
                  title="Canal anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Canal Anterior</span>
                </button>
                <button
                  type="button"
                  onClick={handleNextChannel}
                  disabled={channelsList.length <= 1}
                  className="py-2 px-3 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 border border-zinc-700/60 transition-colors cursor-pointer disabled:opacity-40"
                  title="Canal siguiente"
                >
                  <span>Canal Siguiente</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[11px] text-zinc-500 text-center pt-1">
                Toca cualquier canal abajo para cambiar de sintonía en esta pantalla.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
