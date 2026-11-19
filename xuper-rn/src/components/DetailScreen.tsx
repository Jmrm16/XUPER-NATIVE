import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ArrowLeft, Heart, Play, Star } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Episode, EpisodeProgressEntry, MediaDetail, MediaItem } from '../services/types';
import { getDetail } from '../services/magisClient';
import { getSeriesEpisodeProgress } from '../services/firebaseClient';

interface DetailScreenProps {
  visible: boolean;
  media: MediaItem | null;
  isFavorite: boolean;
  onToggleFavorite: (item: MediaItem) => void;
  onClose: () => void;
  onPlay: (item: MediaItem, episode?: Episode, episodes?: Episode[], seasonNum?: number) => void;
}

export const DetailScreen: React.FC<DetailScreenProps> = ({
  visible,
  media,
  isFavorite,
  onToggleFavorite,
  onClose,
  onPlay,
}) => {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [seasonIds, setSeasonIds] = useState<Array<{ id: string; number: number }>>([]);
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(1);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [epProgress, setEpProgress] = useState<Record<string, EpisodeProgressEntry>>({});
  const [loading, setLoading] = useState(false);
  const [loadingEps, setLoadingEps] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  const fetchDetailData = React.useCallback(async () => {
    if (!media) return;
    setLoading(true);
    setDetailErr(null);
    try {
      const [d, prog] = await Promise.all([
        getDetail(media.id),
        getSeriesEpisodeProgress(media.id).catch(() => ({})),
      ]);
      setDetail(d);
      setEpisodes(d.episodes || []);
      const sList = (d.seasons || [])
        .filter((s) => s.id)
        .map((s) => ({ id: s.id as string, number: s.number }));
      setSeasonIds(sList);
      setSelectedSeasonNum(sList[0]?.number || 1);
      setEpProgress(prog);
    } catch (e: any) {
      setDetailErr(e?.message || 'No se pudo cargar el detalle');
    } finally {
      setLoading(false);
    }
  }, [media]);

  useEffect(() => {
    if (!visible || !media) {
      setDetail(null);
      setEpisodes([]);
      setSeasonIds([]);
      setDetailErr(null);
      return;
    }
    fetchDetailData();
  }, [visible, media?.id, fetchDetailData]);

  const handleSelectSeason = async (s: { id: string; number: number }) => {
    setSelectedSeasonNum(s.number);
    setLoadingEps(true);
    try {
      const d = await getDetail(s.id);
      setEpisodes(d.episodes || []);
    } catch {
      // keep existing
    } finally {
      setLoadingEps(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible || !media) return null;
  const display = detail || media;
  const isSeries = display.type === 'series' || display.type === 'anime' || episodes.length > 0;

  return (
    <View style={[styles.modalOverlay, { paddingBottom: insets.bottom }]}>
      <View style={styles.root}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Hero Backdrop */}
          <View style={styles.heroWrap}>
            {display.backdrop || display.poster ? (
              <Image
                source={{ uri: display.backdrop || display.poster }}
                style={styles.heroImg}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.heroImg, { backgroundColor: '#161622' }]} />
            )}
            <View style={styles.heroOverlay} />

            <TouchableOpacity
              style={[styles.backBtn, { top: Math.max(14, insets.top + 8) }]}
              onPress={onClose}
            >
              <ArrowLeft color="#FFF" size={22} />
            </TouchableOpacity>
          </View>

          {/* Header Metadata */}
          <View style={styles.body}>
            <View style={styles.metaRow}>
              {display.poster ? (
                <Image source={{ uri: display.poster }} style={styles.poster} resizeMode="cover" />
              ) : null}
              <View style={styles.metaText}>
                <Text style={styles.title}>{display.title}</Text>
                <View style={styles.badgesRow}>
                  {display.year ? <Text style={styles.badge}>{display.year}</Text> : null}
                  {display.quality ? (
                    <Text style={[styles.badge, styles.badgeRed]}>{display.quality}</Text>
                  ) : null}
                  {display.rating ? (
                    <View style={styles.ratingWrap}>
                      <Star color="#FBBF24" size={13} fill="#FBBF24" />
                      <Text style={styles.ratingText}>{display.rating}</Text>
                    </View>
                  ) : null}
                </View>
                {display.genres && display.genres.length > 0 ? (
                  <Text style={styles.genres} numberOfLines={2}>
                    {display.genres.slice(0, 4).join(' · ')}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Primary Actions */}
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.playPrimaryBtn}
                onPress={() => {
                  if (isSeries && episodes.length > 0) {
                    onPlay(media, episodes[0], episodes, selectedSeasonNum);
                  } else {
                    onPlay(media);
                  }
                }}
              >
                <Play color="#FFF" size={18} fill="#FFF" />
                <Text style={styles.playPrimaryText}>
                  {isSeries && episodes.length > 0 ? 'Ver Episodio 1' : 'Reproducir'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.favBtn} onPress={() => onToggleFavorite(media)}>
                <Heart
                  color={isFavorite ? '#E50914' : '#FFF'}
                  fill={isFavorite ? '#E50914' : 'transparent'}
                  size={20}
                />
              </TouchableOpacity>
            </View>

            {/* Synopsis */}
            {loading ? (
              <ActivityIndicator color="#E50914" style={{ marginVertical: 20 }} />
            ) : detailErr ? (
              <View style={{ alignItems: 'center', marginVertical: 16, gap: 8 }}>
                <Text style={{ color: '#F87171', fontSize: 13 }}>{detailErr}</Text>
                <TouchableOpacity
                  style={{ backgroundColor: '#E50914', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 }}
                  onPress={fetchDetailData}
                >
                  <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 13 }}>Reintentar</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {(detail?.synopsis || display.description) ? (
                  <Text style={styles.synopsis}>{detail?.synopsis || display.description}</Text>
                ) : null}

                {detail?.cast && detail.cast.length > 0 ? (
                  <Text style={styles.cast}>
                    <Text style={{ color: '#FFF', fontWeight: '600' }}>Reparto: </Text>
                    {detail.cast.slice(0, 6).join(', ')}
                  </Text>
                ) : null}
              </>
            )}

            {/* Seasons & Episodes */}
            {seasonIds.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.seasonsScroll}
                contentContainerStyle={{ gap: 8 }}
              >
                {seasonIds.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[
                      styles.seasonPill,
                      selectedSeasonNum === s.number && styles.seasonPillActive,
                    ]}
                    onPress={() => handleSelectSeason(s)}
                  >
                    <Text
                      style={[
                        styles.seasonText,
                        selectedSeasonNum === s.number && styles.seasonTextActive,
                      ]}
                    >
                      Temporada {s.number}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {loadingEps ? (
              <ActivityIndicator color="#E50914" style={{ marginVertical: 16 }} />
            ) : (
              episodes.length > 0 && (
                <View style={styles.epsSection}>
                  <Text style={styles.epsHeading}>Episodios ({episodes.length})</Text>
                  {episodes.map((ep) => {
                    const prog = epProgress[ep.id.replace(/[.#$\[\]/]/g, '_')];
                    const pct = prog?.progressPercent || 0;
                    return (
                      <TouchableOpacity
                        key={ep.id}
                        style={styles.epCard}
                        onPress={() => onPlay(media, ep, episodes, selectedSeasonNum)}
                      >
                        <View style={styles.epThumbWrap}>
                          {ep.thumbnail || display.poster ? (
                            <Image
                              source={{ uri: ep.thumbnail || display.poster }}
                              style={styles.epThumb}
                              resizeMode="cover"
                            />
                          ) : null}
                          <View style={styles.epPlayBadge}>
                            <Play color="#FFF" size={14} fill="#FFF" />
                          </View>
                          {pct > 0 && (
                            <View style={styles.epProgressBg}>
                              <View style={[styles.epProgressFill, { width: `${pct}%` }]} />
                            </View>
                          )}
                        </View>
                        <View style={styles.epInfo}>
                          <Text style={styles.epTitle} numberOfLines={2}>
                            {ep.number}. {ep.title}
                          </Text>
                          {ep.duration ? (
                            <Text style={styles.epDur}>{ep.duration}</Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )
            )}
          </View>
        </ScrollView>
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
    zIndex: 900,
    elevation: 20,
    backgroundColor: '#0A0A0F',
  },
  root: {
    flex: 1,
    backgroundColor: '#0A0A0F',
  },
  heroWrap: {
    height: 240,
    width: '100%',
    position: 'relative',
  },
  heroImg: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,10,15,0.45)',
  },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 16,
    marginTop: -44,
    paddingBottom: 32,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-end',
  },
  poster: {
    width: 96,
    height: 142,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: '#14141E',
  },
  metaText: {
    flex: 1,
    gap: 6,
    paddingBottom: 4,
  },
  title: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '800',
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    color: '#D1D5DB',
    backgroundColor: '#1B1B29',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    fontSize: 11,
    fontWeight: '700',
  },
  badgeRed: {
    backgroundColor: 'rgba(229,9,20,0.2)',
    color: '#F87171',
  },
  ratingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    color: '#FBBF24',
    fontSize: 12,
    fontWeight: '700',
  },
  genres: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  playPrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#E50914',
    height: 46,
    borderRadius: 12,
  },
  playPrimaryText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  favBtn: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#14141E',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  synopsis: {
    color: '#D1D5DB',
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: 16,
  },
  cast: {
    color: '#9CA3AF',
    fontSize: 12.5,
    marginTop: 10,
  },
  seasonsScroll: {
    marginTop: 18,
  },
  seasonPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#14141E',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  seasonPillActive: {
    backgroundColor: '#E50914',
    borderColor: '#E50914',
  },
  seasonText: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
  },
  seasonTextActive: {
    color: '#FFF',
  },
  epsSection: {
    marginTop: 18,
    gap: 10,
  },
  epsHeading: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  epCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#14141E',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  epThumbWrap: {
    width: 112,
    height: 64,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1F1F2E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  epThumb: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  epPlayBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  epProgressBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  epProgressFill: {
    height: '100%',
    backgroundColor: '#E50914',
  },
  epInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  epTitle: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  epDur: {
    color: '#9CA3AF',
    fontSize: 11.5,
  },
});
