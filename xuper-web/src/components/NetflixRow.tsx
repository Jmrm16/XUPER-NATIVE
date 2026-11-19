import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import { ChevronDown, ChevronLeft, ChevronRight, Check, Heart, Play, Plus, Volume2, VolumeX, X, Info } from 'lucide-react';
import { MediaItem, Channel } from '../services/api';
import { WatchProgressItem, formatPlaybackTime } from '../lib/firebase';

interface NetflixRowProps {
  heading: string;
  items: MediaItem[];
  isChannelRow?: boolean;
  channels?: Channel[];
  isTop10?: boolean;
  progressMap?: Record<string, WatchProgressItem>;
  onRemoveProgress?: (e: React.MouseEvent, item: MediaItem) => void;
  onResumeItem?: (item: MediaItem, progress: WatchProgressItem) => void;
  onPlayDirect?: (item: MediaItem) => void;
  onResolvePreview?: (item: MediaItem) => Promise<{ url: string; startAt?: number } | null>;
  isFavorite?: (id: string) => boolean;
  onToggleFavorite?: (e: React.MouseEvent, item: MediaItem) => void;
  onToggleFavoriteChannel?: (e: React.MouseEvent, channel: Channel) => void;
  onSelectMedia: (item: MediaItem) => void;
  onSelectChannel?: (channel: Channel) => void;
  onViewAll?: () => void;
}

export const NetflixRow: React.FC<NetflixRowProps> = ({
  heading,
  items,
  isChannelRow = false,
  channels = [],
  isTop10 = false,
  progressMap,
  onRemoveProgress,
  onResumeItem,
  onPlayDirect,
  onResolvePreview,
  isFavorite,
  onToggleFavorite,
  onToggleFavoriteChannel,
  onSelectMedia,
  onSelectChannel,
  onViewAll,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [edges, setEdges] = useState({ start: true, end: false, overflow: false });
  const [hoverPreview, setHoverPreview] = useState<{
    item: MediaItem;
    rect: { top: number; left: number; width: number; height: number };
    prog?: WatchProgressItem;
  } | null>(null);
  const [previewShown, setPreviewShown] = useState(false);
  const [previewVideo, setPreviewVideo] = useState<{ url: string; startAt: number } | null>(null);
  const [previewVideoReady, setPreviewVideoReady] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewHlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const v = previewVideoRef.current;
    if (previewHlsRef.current) {
      previewHlsRef.current.destroy();
      previewHlsRef.current = null;
    }
    if (!v || !previewVideo?.url) return;
    if (previewVideo.url.includes('.m3u8') && Hls.isSupported()) {
      const hls = new Hls({ startPosition: previewVideo.startAt || 65, maxBufferLength: 12 });
      hls.loadSource(previewVideo.url);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        v.muted = previewMuted;
        v.play().catch(() => {
          v.muted = true;
          setPreviewMuted(true);
          v.play().catch(() => {});
        });
      });
      previewHlsRef.current = hls;
    } else {
      v.src = previewVideo.url;
    }
    return () => {
      if (previewHlsRef.current) {
        previewHlsRef.current.destroy();
        previewHlsRef.current = null;
      }
    };
  }, [previewVideo]);

  useEffect(() => {
    if (!hoverPreview) {
      setPreviewShown(false);
      setPreviewVideo(null);
      setPreviewVideoReady(false);
      return;
    }
    const id = requestAnimationFrame(() => setPreviewShown(true));
    let cancelled = false;
    const item = hoverPreview.item;
    const loadTimer = setTimeout(() => {
      if (!onResolvePreview) return;
      onResolvePreview(item)
        .then((res) => {
          if (!cancelled && res?.url) {
            setPreviewVideo({ url: res.url, startAt: res.startAt ?? 65 });
          }
        })
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      clearTimeout(loadTimer);
    };
  }, [hoverPreview, onResolvePreview]);

  useEffect(() => {
    const closePreview = () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      setHoverPreview(null);
    };
    window.addEventListener('scroll', closePreview, { passive: true });
    return () => {
      window.removeEventListener('scroll', closePreview);
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const totalCount = isChannelRow ? channels.length : items.length;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () => {
      const atStart = track.scrollLeft <= 5;
      const atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 5;
      const canScroll = track.scrollWidth > track.clientWidth + 5;
      setEdges((previous) =>
        previous.start === atStart && previous.end === atEnd && previous.overflow === canScroll
          ? previous
          : { start: atStart, end: atEnd, overflow: canScroll }
      );
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(track);
    track.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      track.removeEventListener('scroll', update);
    };
  }, [totalCount]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  if (totalCount === 0) return null;

  const animateTo = (track: HTMLDivElement, target: number) => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    const start = track.scrollLeft;
    const distance = target - start;
    if (Math.abs(distance) < 2) {
      track.classList.remove('is-animating');
      return;
    }

    // Disable CSS scroll-snap & native smooth scroll during JS rAF interpolation
    // so the browser does not fight or cancel each frame.
    track.classList.add('is-animating');

    const duration = 520;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      track.scrollLeft = Math.round(start + distance * eased);
      if (elapsed < 1) {
        animationFrameRef.current = requestAnimationFrame(tick);
      } else {
        track.scrollLeft = Math.round(target);
        track.classList.remove('is-animating');
        animationFrameRef.current = null;
      }
    };
    animationFrameRef.current = requestAnimationFrame(tick);
  };

  const move = (direction: number) => {
    const track = trackRef.current;
    if (!track) return;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const atStart = track.scrollLeft <= 5;
    const atEnd = track.scrollLeft >= maxScroll - 5;

    // Snap step to exact card width + gap so the animation lands cleanly
    const firstCard = track.querySelector<HTMLElement>('.media-card');
    const gapPx = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || '10') || 10;
    const cardStep = firstCard ? firstCard.getBoundingClientRect().width + gapPx : 0;
    const visibleCards = cardStep > 0 ? Math.max(1, Math.floor(track.clientWidth / cardStep)) : 0;
    const scrollAmount = cardStep > 0 ? visibleCards * cardStep : track.clientWidth * 0.85;

    // Netflix-style continuous rails: never leave either arrow at a dead end.
    if (direction > 0 && atEnd) {
      animateTo(track, 0);
      return;
    }
    if (direction < 0 && atStart) {
      animateTo(track, maxScroll);
      return;
    }
    animateTo(track, Math.max(0, Math.min(maxScroll, track.scrollLeft + direction * scrollAmount)));
  };

  return (
    <section className="media-row" aria-label={heading}>
      <div className="media-row-header">
        <div className="flex items-center gap-3">
          <h2 className="media-row-title">{heading}</h2>
          {onViewAll && (
            <button
              onClick={onViewAll}
              className="text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer flex items-center gap-0.5 ml-2 font-medium"
            >
              <span>Explorar todos</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="row-controls" style={{ display: edges.overflow ? 'flex' : 'none' }}>
          <button
            type="button"
            className="row-arrow"
            disabled={!edges.overflow}
            aria-label={edges.start ? `Ir al final de ${heading}` : `Anterior en ${heading}`}
            onClick={() => move(-1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="row-arrow"
            disabled={!edges.overflow}
            aria-label={edges.end ? `Volver al inicio de ${heading}` : `Siguiente en ${heading}`}
            onClick={() => move(1)}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div ref={trackRef} className="media-track" tabIndex={0}>
        {isChannelRow
          ? channels.map((channel, idx) => {
              const fav = isFavorite ? isFavorite(channel.id || channel.channelCode || '') : false;
              return (
                <div
                  key={`${channel.id || channel.channelCode || channel.name}-${idx}`}
                  className="media-card group cursor-pointer"
                  onClick={() => onSelectChannel && onSelectChannel(channel)}
                >
                  <div className="media-card-art flex flex-col items-center justify-center p-4 bg-[#1f1f1f] relative overflow-hidden">
                    <span className="card-netflix">M</span>
                    <span className="absolute top-2 right-2 text-[9px] font-bold text-red-500 bg-red-950/70 border border-red-800/60 px-1.5 py-0.5 rounded">
                      ● VIVO
                    </span>

                    {channel.logo ? (
                      <img
                        src={channel.logo}
                        alt={channel.name}
                        className="h-12 w-auto max-w-[80%] object-contain drop-shadow transition-transform group-hover:scale-105"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-white">
                        <Play className="w-6 h-6 fill-current" />
                      </div>
                    )}

                    {onToggleFavoriteChannel && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavoriteChannel(e, channel);
                        }}
                        className={`absolute bottom-2 right-2 p-1.5 rounded-full transition-colors ${
                          fav
                            ? 'text-pink-500 bg-pink-950/80'
                            : 'text-zinc-400 hover:text-white bg-black/60 hover:bg-zinc-800'
                        }`}
                        title={fav ? 'Quitar de Mi lista' : 'Añadir a Mi lista'}
                      >
                        <Heart className={`w-3.5 h-3.5 ${fav ? 'fill-current' : ''}`} />
                      </button>
                    )}
                  </div>
                  <span className="media-card-title">{channel.name}</span>
                  <span className="media-card-info">
                    {channel.category || 'Televisión en Vivo'}
                  </span>
                </div>
              );
            })
          : items.map((item, idx) => {
              const fav = isFavorite ? isFavorite(item.id) : false;
              const artworkUrl = item.poster || item.landscape || item.backdrop;
              const prog = progressMap ? progressMap[item.id] : undefined;
              const progressPct = prog
                ? Math.min(100, Math.max(4, prog.progressPercent || 0))
                : 0;
              const progressLabel = prog
                ? prog.episodeNumber
                  ? `T${prog.seasonNumber || 1}:E${prog.episodeNumber} • ${formatPlaybackTime(prog.currentTime)}`
                  : prog.duration > 0
                  ? `${formatPlaybackTime(prog.currentTime)} / ${formatPlaybackTime(prog.duration)}`
                  : `${formatPlaybackTime(prog.currentTime)}`
                : '';

              return (
                <div
                  key={`${item.id || item.title || 'media'}-${idx}`}
                  className="media-card group cursor-pointer"
                  onMouseEnter={(e) => {
                    const el = e.currentTarget;
                    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                    hoverTimerRef.current = setTimeout(() => {
                      const r = el.getBoundingClientRect();
                      setHoverPreview({
                        item,
                        prog,
                        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
                      });
                    }, 360);
                  }}
                  onMouseLeave={() => {
                    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                  }}
                  onClick={() => {
                    setHoverPreview(null);
                    if (prog && onResumeItem) {
                      onResumeItem(item, prog);
                    } else {
                      onSelectMedia(item);
                    }
                  }}
                >
                  <div className="media-card-art is-poster relative">
                    <img
                      src={artworkUrl}
                      alt={item.title}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform group-hover:brightness-105"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        const fallback = item.landscape || item.backdrop;
                        if (fallback && img.src !== fallback && !img.dataset.retried) {
                          img.dataset.retried = '1';
                          img.src = fallback;
                          return;
                        }
                        img.src =
                          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="600"%3E%3Crect width="100%25" height="100%25" fill="%23242424"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle" fill="%23e50914" font-family="Arial" font-size="28" font-weight="bold"%3EMAICAOFLIX%3C/text%3E%3C/svg%3E';
                      }}
                    />

                    {/* Iconic Maicaoflix "M" mark */}
                    <span className="card-netflix">M</span>

                    {/* Top 10 Red Badge for Trending */}
                    {isTop10 && idx < 10 && (
                      <span className="card-top10">
                        TOP
                        <br />
                        {idx + 1}
                      </span>
                    )}

                    {/* Top-right quick actions (Remove from history + Favorite) */}
                    {(onRemoveProgress || onToggleFavorite) && (
                      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                        {prog && onRemoveProgress && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveProgress(e, item);
                            }}
                            className="p-1.5 rounded-full bg-black/70 text-zinc-300 hover:text-white hover:bg-red-600/90 transition-colors cursor-pointer"
                            title="Quitar de Continuar viendo"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onToggleFavorite && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleFavorite(e, item);
                            }}
                            className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                              fav
                                ? 'text-pink-500 bg-black/70'
                                : 'text-zinc-400 hover:text-white bg-black/60 hover:bg-zinc-800'
                            }`}
                            title={fav ? 'Quitar de Mi lista' : 'Añadir a Mi lista'}
                          >
                            <Heart className={`w-3.5 h-3.5 ${fav ? 'fill-current' : ''}`} />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Floating play badge & detail info button on hover */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <div className="w-10 h-10 rounded-full bg-white/95 text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </div>
                      {prog && onResumeItem && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectMedia(item);
                          }}
                          className="w-8 h-8 rounded-full bg-zinc-900/90 border border-white/25 text-white flex items-center justify-center shadow-lg hover:bg-zinc-800 transition-colors cursor-pointer"
                          title="Ver detalles y episodios"
                        >
                          <Info className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Watch Progress Badge + Red Progress Bar */}
                    {prog && prog.currentTime > 3 && (
                      <>
                        <span className="absolute bottom-2.5 left-1.5 z-10 px-1.5 py-0.5 rounded bg-black/85 border border-white/10 text-[10px] font-bold text-white shadow">
                          {progressLabel}
                        </span>
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-800/95 z-10 overflow-hidden">
                          <div
                            className="h-full bg-red-600 transition-all duration-300"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>

                  <span className="media-card-title">{item.title}</span>
                  <span className="media-card-info">
                    {item.score && (
                      <span className="text-emerald-400 font-bold">
                        {item.score}
                      </span>
                    )}
                    <span>{item.year && item.year !== '—' ? item.year : ''}</span>
                    <span>
                      {item.genres && item.genres.length > 0
                        ? item.genres.slice(0, 2).join(' · ')
                        : item.kind || ''}
                    </span>
                  </span>
                </div>
              );
            })}
      </div>

      {hoverPreview &&
        typeof document !== 'undefined' &&
        createPortal(
          (() => {
            const { item, rect, prog } = hoverPreview;
            const previewW = 304;
            const centerX = rect.left + rect.width / 2;
            const left = Math.max(16, Math.min(window.innerWidth - previewW - 16, centerX - previewW / 2));
            const top = Math.max(72, Math.min(window.innerHeight - 320, rect.top - 26));
            const fav = isFavorite ? isFavorite(item.id) : false;
            const previewImg = item.backdrop || item.landscape || item.poster;

            return (
              <div
                onMouseLeave={() => setHoverPreview(null)}
                onClick={() => {
                  setHoverPreview(null);
                  onSelectMedia(item);
                }}
                style={{ top, left, width: previewW }}
                className={`fixed z-[90] rounded-lg bg-[#181818] border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.9)] overflow-hidden cursor-pointer transition-all duration-200 ease-out origin-center ${
                  previewShown ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-90 translate-y-2'
                }`}
              >
                <div className="relative w-full aspect-video bg-zinc-900 overflow-hidden">
                  <img
                    src={previewImg}
                    alt={item.title}
                    className={`w-full h-full object-cover scale-105 transition-all duration-500 ease-out ${
                      previewVideoReady ? 'opacity-0' : 'opacity-100'
                    }`}
                  />
                  {previewVideo && (
                    <video
                      ref={previewVideoRef}
                      autoPlay
                      playsInline
                      muted={previewMuted}
                      loop
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        if (!previewVideo.url.includes('.m3u8') && previewVideo.startAt > 0 && Number.isFinite(v.duration) && v.duration > previewVideo.startAt + 10) {
                          v.currentTime = previewVideo.startAt;
                        }
                        v.play().catch(() => {
                          v.muted = true;
                          setPreviewMuted(true);
                          v.play().catch(() => {});
                        });
                      }}
                      onCanPlay={() => setPreviewVideoReady(true)}
                      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
                        previewVideoReady ? 'opacity-100' : 'opacity-0'
                      }`}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-black/25 pointer-events-none" />
                  <div className="absolute top-2.5 left-3 flex items-center gap-1.5 pointer-events-none">
                    <span className="text-red-600 font-black text-base drop-shadow">M</span>
                    <span className="text-[10px] font-bold tracking-[2px] text-zinc-200 uppercase drop-shadow">
                      {item.type === 'teleplay' || item.type === 'series' ? 'Serie' : 'Película'}
                    </span>
                  </div>
                  <span className="absolute top-2.5 right-2.5 px-1.5 py-0.5 rounded bg-black/70 border border-white/15 text-[10px] font-semibold text-zinc-200 pointer-events-none">
                    {item.kind || 'HD'}
                  </span>
                  {previewVideo && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = !previewMuted;
                        setPreviewMuted(next);
                        if (previewVideoRef.current) previewVideoRef.current.muted = next;
                      }}
                      className="absolute bottom-2.5 right-2.5 z-10 w-8 h-8 rounded-full bg-black/70 border border-white/25 text-white hover:bg-black/90 flex items-center justify-center transition-colors cursor-pointer"
                      title={previewMuted ? 'Activar audio' : 'Silenciar'}
                    >
                      {previewMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  )}
                  <div className="absolute bottom-2 left-3 right-12 pointer-events-none">
                    <p className="text-sm font-extrabold text-white truncate drop-shadow">{item.title}</p>
                  </div>
                </div>

                <div className="p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setHoverPreview(null);
                          if (prog && onResumeItem) onResumeItem(item, prog);
                          else if (onPlayDirect) onPlayDirect(item);
                          else onSelectMedia(item);
                        }}
                        className="w-9 h-9 rounded-full bg-white text-black hover:bg-zinc-200 flex items-center justify-center transition-colors cursor-pointer shadow"
                        title="Reproducir"
                      >
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      </button>
                      {onToggleFavorite && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(e, item);
                          }}
                          className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
                            fav
                              ? 'border-white bg-white/15 text-white'
                              : 'border-zinc-500 text-zinc-200 hover:border-white hover:text-white'
                          }`}
                          title={fav ? 'Quitar de Mi lista' : 'Añadir a Mi lista'}
                        >
                          {fav ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHoverPreview(null);
                        onSelectMedia(item);
                      }}
                      className="w-9 h-9 rounded-full border border-zinc-500 text-zinc-200 hover:border-white hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                      title="Más información y episodios"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-zinc-300">
                    <span className="text-emerald-400 font-bold">98% para ti</span>
                    {item.year && item.year !== '—' && <span>{item.year}</span>}
                    <span className="border border-zinc-600 px-1 rounded text-[10px]">+16</span>
                    {item.duration && <span>{item.duration}</span>}
                  </div>

                  {item.synopsis && (
                    <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                      {item.synopsis}
                    </p>
                  )}

                  {item.genres && item.genres.length > 0 && (
                    <p className="text-[11px] text-zinc-200 font-medium truncate">
                      {item.genres.slice(0, 3).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            );
          })(),
          document.body
        )}
    </section>
  );
};

export default NetflixRow;
