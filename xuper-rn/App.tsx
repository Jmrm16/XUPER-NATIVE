import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Clock,
  Film,
  Heart,
  Home,
  LogOut,
  Play,
  Radio,
  RefreshCw,
  Search,
  Tv,
  User,
  X,
} from 'lucide-react-native';
import type {
  AuthUser,
  Episode,
  EpgChannelEntry,
  LiveCategory,
  LiveChannel,
  MediaItem,
  ResolvedStream,
  WatchProgressItem,
} from './src/services/types';
import {
  getHome,
  getLiveCategories,
  getLiveChannels,
  getSeedStats,
  refreshSeedsFromCloud,
  resolveLive,
  resolveVod,
  searchCatalog,
} from './src/services/magisClient';
import {
  getEpgForChannels,
  getEpgOffsetMinutes,
  setEpgOffsetMinutes,
} from './src/services/epgClient';
import {
  checkEmailVerified,
  getFavorites,
  getWatchHistory,
  loadStoredUser,
  resendVerificationEmail,
  sendPasswordReset,
  signInWithEmail,
  signOutUser,
  signUpWithEmail,
  toggleFavorite,
} from './src/services/firebaseClient';
import { DetailScreen } from './src/components/DetailScreen';
import { VideoPlayerModal } from './src/components/VideoPlayerModal';

type TabKey = 'home' | 'movies' | 'series' | 'live' | 'profile';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_CARD_W = Math.floor((SCREEN_WIDTH - 48) / 3);

function AppContent() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('home');
  const [seriesSubTab, setSeriesSubTab] = useState<'series' | 'anime' | 'kids'>('series');

  // Catalog state
  const [featured, setFeatured] = useState<MediaItem[]>([]);
  const [movies, setMovies] = useState<MediaItem[]>([]);
  const [seriesList, setSeriesList] = useState<MediaItem[]>([]);
  const [animeList, setAnimeList] = useState<MediaItem[]>([]);
  const [kidsList, setKidsList] = useState<MediaItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Live TV state
  const [liveCats, setLiveCats] = useState<LiveCategory[]>([]);
  const [selectedLiveCat, setSelectedLiveCat] = useState<string>('');
  const [liveChannels, setLiveChannels] = useState<LiveChannel[]>([]);
  const [liveFilter, setLiveFilter] = useState('');
  const [loadingLive, setLoadingLive] = useState(false);
  const [epgMap, setEpgMap] = useState<Record<string, EpgChannelEntry>>({});
  const [epgCountry, setEpgCountry] = useState<'auto' | 'MX1' | 'CO1' | 'AR1' | 'ES1'>('auto');
  const [epgOffset, setEpgOffset] = useState(0);
  const [adultUnlocked, setAdultUnlocked] = useState(false);

  // User, Favorites & History
  const [user, setUser] = useState<AuthUser | null>(null);
  const [history, setHistory] = useState<WatchProgressItem[]>([]);
  const [favorites, setFavorites] = useState<MediaItem[]>([]);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authBusy, setAuthBusy] = useState(false);
  const [seedInfo, setSeedInfo] = useState(getSeedStats());

  // Search Modal
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [searching, setSearching] = useState(false);

  // Detail & Player state
  const [detailMedia, setDetailMedia] = useState<MediaItem | null>(null);
  const [playerVisible, setPlayerVisible] = useState(false);
  const [playerStream, setPlayerStream] = useState<ResolvedStream | null>(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerIsLive, setPlayerIsLive] = useState(false);
  const [playerTitle, setPlayerTitle] = useState('');
  const [playerSubtitle, setPlayerSubtitle] = useState('');
  const [playerInitialPos, setPlayerInitialPos] = useState(0);
  const [playingMedia, setPlayingMedia] = useState<MediaItem | null>(null);
  const [playingEpisode, setPlayingEpisode] = useState<Episode | null>(null);
  const [playingEpisodes, setPlayingEpisodes] = useState<Episode[]>([]);
  const [playingSeason, setPlayingSeason] = useState<number>(1);
  const [playingChannel, setPlayingChannel] = useState<LiveChannel | null>(null);

  const favIdSet = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  const loadUserData = useCallback(async () => {
    const [u, hist, favs, off] = await Promise.all([
      loadStoredUser(),
      getWatchHistory(),
      getFavorites(),
      getEpgOffsetMinutes(),
    ]);
    setUser(u);
    setHistory(hist);
    setFavorites(favs);
    setEpgOffset(off);
  }, []);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const results = await Promise.allSettled([
        getHome('featured', 1),
        getHome('movies', 1),
        getHome('series', 1),
        getHome('anime', 1),
        getHome('kids', 1),
      ]);
      const [featRes, movRes, serRes, aniRes, kidRes] = results;
      if (featRes.status === 'fulfilled') setFeatured(featRes.value.items);
      if (movRes.status === 'fulfilled') setMovies(movRes.value.items);
      if (serRes.status === 'fulfilled') setSeriesList(serRes.value.items);
      if (aniRes.status === 'fulfilled') setAnimeList(aniRes.value.items);
      if (kidRes.status === 'fulfilled') setKidsList(kidRes.value.items);

      const allFailed = results.every((r) => r.status === 'rejected');
      if (allFailed) {
        const firstErr = (results[0] as PromiseRejectedResult).reason;
        setCatalogError(firstErr?.message || 'Error conectando con el catálogo');
      }
      setSeedInfo(getSeedStats());
    } catch (e: any) {
      setCatalogError(e?.message || 'Error conectando con el catálogo');
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  const loadLiveSection = useCallback(
    async (catId?: string, countryOverride?: string) => {
      setLoadingLive(true);
      try {
        let cats = liveCats;
        if (!cats.length) {
          cats = await getLiveCategories();
          setLiveCats(cats);
        }
        const targetCat =
          catId ||
          selectedLiveCat ||
          cats.find((c) => !c.isAdult)?.id ||
          cats[0]?.id ||
          '76182';
        if (targetCat !== selectedLiveCat) {
          setSelectedLiveCat(targetCat);
        }
        const channels = await getLiveChannels(targetCat, 1, 250);
        setLiveChannels(channels);
        setSeedInfo(getSeedStats());
        getEpgForChannels(channels, countryOverride || epgCountry)
          .then(setEpgMap)
          .catch(() => {});
      } catch (e: any) {
        Alert.alert('TV en Vivo', e?.message || 'No se pudieron cargar los canales');
      } finally {
        setLoadingLive(false);
      }
    },
    [liveCats, selectedLiveCat, epgCountry],
  );

  useEffect(() => {
    loadUserData();
    loadCatalog();
  }, [loadUserData, loadCatalog]);

  useEffect(() => {
    if (tab === 'live' && liveChannels.length === 0 && !loadingLive) {
      loadLiveSection();
    }
  }, [tab, liveChannels.length, loadingLive, loadLiveSection]);

  useEffect(() => {
    const currentLen = (seriesSubTab === 'series' ? seriesList : seriesSubTab === 'anime' ? animeList : kidsList).length;
    if (tab === 'series' && currentLen === 0 && !loadingCatalog) {
      getHome(seriesSubTab, 1)
        .then((res) => {
          if (seriesSubTab === 'series') setSeriesList(res.items);
          else if (seriesSubTab === 'anime') setAnimeList(res.items);
          else setKidsList(res.items);
        })
        .catch(() => {});
    }
  }, [tab, seriesSubTab, seriesList.length, animeList.length, kidsList.length, loadingCatalog]);

  const handleToggleFav = async (item: MediaItem) => {
    await toggleFavorite(item);
    const updated = await getFavorites();
    setFavorites(updated);
  };

  const startVodPlayback = async (
    media: MediaItem,
    episode?: Episode,
    episodes: Episode[] = [],
    seasonNum = 1,
    trackIndex = 0,
  ) => {
    setPlayerIsLive(false);
    setPlayingMedia(media);
    setPlayingEpisode(episode || null);
    setPlayingEpisodes(episodes);
    setPlayingSeason(seasonNum);
    setPlayingChannel(null);
    setPlayerTitle(media.title);
    setPlayerSubtitle(episode ? `T${seasonNum} · E${episode.number} ${episode.title}` : media.year || '');
    setPlayerError(null);
    setPlayerStream(null);
    setPlayerLoading(true);
    setPlayerVisible(true);

    const histMatch = history.find((h) => h.mediaId === media.id);
    const initialPos =
      histMatch && (!episode || histMatch.episodeId === episode.id) && histMatch.progressPercent < 95
        ? histMatch.currentTime
        : 0;
    setPlayerInitialPos(initialPos);

    try {
      const contentId = episode?.id || media.id;
      const seriesId = episode ? media.id : '';
      const resolved = await resolveVod(contentId, seriesId, trackIndex);
      setPlayerStream(resolved);
    } catch (e: any) {
      setPlayerError(e?.message || 'No se pudo obtener el enlace de video');
    } finally {
      setPlayerLoading(false);
    }
  };

  const startLivePlayback = async (ch: LiveChannel, force = false) => {
    const epg = epgMap[ch.id];
    setPlayerIsLive(true);
    setPlayingChannel(ch);
    setPlayingMedia(null);
    setPlayingEpisode(null);
    setPlayingEpisodes([]);
    setPlayerTitle(`${ch.number}. ${ch.name}`);
    setPlayerSubtitle(
      epg?.now ? `Ahora: ${epg.now.title} (${epg.now.startLabel} - ${epg.now.endLabel})` : 'En vivo',
    );
    setPlayerInitialPos(0);
    setPlayerError(null);
    setPlayerStream(null);
    setPlayerLoading(true);
    setPlayerVisible(true);

    try {
      const resolved = await resolveLive(ch.id, force);
      setPlayerStream(resolved);
    } catch (e: any) {
      setPlayerError(e?.message || 'Canal temporalmente no disponible');
    } finally {
      setPlayerLoading(false);
    }
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await searchCatalog(q, 1);
      setSearchResults(res.items);
    } catch (e: any) {
      Alert.alert('Búsqueda', e?.message || 'Error al buscar');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectLiveCategory = (cat: LiveCategory) => {
    if (cat.isAdult && !adultUnlocked) {
      Alert.alert(
        'Contenido +18',
        'Esta categoría es para adultos. ¿Deseas desbloquearla en esta sesión?',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Desbloquear',
            onPress: () => {
              setAdultUnlocked(true);
              setSelectedLiveCat(cat.id);
              loadLiveSection(cat.id);
            },
          },
        ],
      );
      return;
    }
    setSelectedLiveCat(cat.id);
    loadLiveSection(cat.id);
  };

  const filteredChannels = useMemo(() => {
    const q = liveFilter.trim().toLowerCase();
    if (!q) return liveChannels;
    return liveChannels.filter(
      (c) => c.name.toLowerCase().includes(q) || c.number.toLowerCase().includes(q),
    );
  }, [liveChannels, liveFilter]);

  const seriesGridData =
    seriesSubTab === 'series' ? seriesList : seriesSubTab === 'anime' ? animeList : kidsList;

  const renderPosterCard = (item: MediaItem, width = 114) => (
    <TouchableOpacity
      key={item.id}
      style={[styles.posterCard, { width }]}
      onPress={() => setDetailMedia(item)}
      activeOpacity={0.8}
    >
      <Image source={{ uri: item.poster }} style={[styles.posterImg, { height: width * 1.48 }]} />
      {item.quality ? (
        <View style={styles.qualityTag}>
          <Text style={styles.qualityTagText}>{item.quality}</Text>
        </View>
      ) : null}
      <Text style={styles.cardTitle} numberOfLines={1}>
        {item.title}
      </Text>
    </TouchableOpacity>
  );

  const heroItem = featured[0] || movies[0];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Text style={styles.brandText}>
            MAICAO<Text style={{ color: '#E50914' }}>FLIX</Text>
          </Text>
          <View style={[styles.statusDot, { backgroundColor: seedInfo.usable > 0 ? '#10B981' : '#EF4444' }]} />
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setSearchOpen(true)}>
            <Search color="#FFF" size={20} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => (tab === 'live' ? loadLiveSection() : loadCatalog())}
          >
            <RefreshCw color="#FFF" size={18} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content Area */}
      <View style={styles.content}>
        {tab === 'home' && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={loadingCatalog} onRefresh={loadCatalog} tintColor="#E50914" />}
          >
            {catalogError && !featured.length ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>Sin conexión al portal</Text>
                <Text style={styles.emptySub}>{catalogError}</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={loadCatalog}>
                  <Text style={styles.primaryBtnText}>Reintentar</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Hero Banner */}
            {heroItem && (
              <TouchableOpacity
                style={styles.heroCard}
                activeOpacity={0.9}
                onPress={() => setDetailMedia(heroItem)}
              >
                <Image
                  source={{ uri: heroItem.backdrop || heroItem.poster }}
                  style={styles.heroBg}
                  resizeMode="cover"
                />
                <View style={styles.heroGrad} />
                <View style={styles.heroInfo}>
                  <Text style={styles.heroBadge}>DESTACADO · {heroItem.quality || 'HD'}</Text>
                  <Text style={styles.heroTitle} numberOfLines={2}>
                    {heroItem.title}
                  </Text>
                  <View style={styles.heroActions}>
                    <TouchableOpacity
                      style={styles.heroPlayBtn}
                      onPress={() =>
                        heroItem.type === 'series' || heroItem.type === 'anime'
                          ? setDetailMedia(heroItem)
                          : startVodPlayback(heroItem)
                      }
                    >
                      <Play color="#FFF" size={16} fill="#FFF" />
                      <Text style={styles.heroPlayText}>Reproducir</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.heroInfoBtn}
                      onPress={() => setDetailMedia(heroItem)}
                    >
                      <Text style={styles.heroInfoText}>Detalles</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            )}

            {/* Continue Watching */}
            {history.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Continuar viendo</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {history.slice(0, 12).map((h) => (
                    <TouchableOpacity
                      key={h.mediaId}
                      style={styles.continueCard}
                      onPress={() =>
                        setDetailMedia({
                          id: h.mediaId,
                          title: h.title,
                          poster: h.poster,
                          backdrop: h.backdrop,
                          type: h.type,
                          contentType: h.contentType,
                        })
                      }
                    >
                      <Image source={{ uri: h.backdrop || h.poster }} style={styles.continueImg} />
                      <View style={styles.continueProgBg}>
                        <View style={[styles.continueProgFill, { width: `${h.progressPercent}%` }]} />
                      </View>
                      <Text style={styles.cardTitle} numberOfLines={1}>
                        {h.title}
                      </Text>
                      {h.episodeNumber ? (
                        <Text style={styles.cardSub}>Episodio {h.episodeNumber}</Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Rows */}
            {[
              { title: 'Películas populares', data: movies },
              { title: 'Series recomendadas', data: seriesList },
              { title: 'Animé', data: animeList },
              { title: 'Infantil y Familia', data: kidsList },
            ].map(
              (row) =>
                row.data.length > 0 && (
                  <View key={row.title} style={styles.section}>
                    <Text style={styles.sectionTitle}>{row.title}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                      {row.data.slice(0, 18).map((item) => renderPosterCard(item))}
                    </ScrollView>
                  </View>
                ),
            )}
            <View style={{ height: 24 }} />
          </ScrollView>
        )}

        {tab === 'movies' && (
          <FlatList
            data={movies}
            keyExtractor={(item) => item.id}
            numColumns={3}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridContent}
            refreshControl={<RefreshControl refreshing={loadingCatalog} onRefresh={loadCatalog} tintColor="#E50914" />}
            renderItem={({ item }) => renderPosterCard(item, GRID_CARD_W)}
          />
        )}

        {tab === 'series' && (
          <View style={{ flex: 1 }}>
            <View style={styles.subTabsRow}>
              {[
                { key: 'series' as const, label: 'Series' },
                { key: 'anime' as const, label: 'Animé' },
                { key: 'kids' as const, label: 'Infantil' },
              ].map((st) => (
                <TouchableOpacity
                  key={st.key}
                  style={[styles.subPill, seriesSubTab === st.key && styles.subPillActive]}
                  onPress={() => setSeriesSubTab(st.key)}
                >
                  <Text style={[styles.subPillText, seriesSubTab === st.key && styles.subPillTextActive]}>
                    {st.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <FlatList
              data={seriesGridData}
              keyExtractor={(item) => item.id}
              numColumns={3}
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={styles.gridContent}
              refreshControl={<RefreshControl refreshing={loadingCatalog} onRefresh={loadCatalog} tintColor="#E50914" />}
              renderItem={({ item }) => renderPosterCard(item, GRID_CARD_W)}
            />
          </View>
        )}

        {tab === 'live' && (
          <View style={{ flex: 1 }}>
            {/* Categories */}
            {liveCats.length > 0 && (
              <View style={styles.catBarWrap}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.catScroll}
                >
                  {liveCats.map((cat) => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.subPill, selectedLiveCat === cat.id && styles.subPillActive]}
                      onPress={() => handleSelectLiveCategory(cat)}
                    >
                      <Text style={[styles.subPillText, selectedLiveCat === cat.id && styles.subPillTextActive]}>
                        {cat.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Filter & EPG Calibration */}
            <View style={styles.liveTools}>
              <TextInput
                value={liveFilter}
                onChangeText={setLiveFilter}
                placeholder="Filtrar canal por nombre o número…"
                placeholderTextColor="#6B7280"
                style={styles.liveFilterInput}
              />
              <View style={styles.epgBarWrap}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.epgScrollContent}
                >
                  {(['auto', 'MX1', 'CO1', 'AR1', 'ES1'] as const).map((c) => (
                    <TouchableOpacity
                      key={c}
                      style={[styles.epgBtn, epgCountry === c && styles.epgBtnActive]}
                      onPress={() => {
                        setEpgCountry(c);
                        loadLiveSection(selectedLiveCat, c);
                      }}
                    >
                      <Text style={styles.epgBtnText}>{c === 'auto' ? 'Auto' : c.slice(0, 2)}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={styles.epgBtn}
                    onPress={async () => {
                      const next = epgOffset - 60;
                      await setEpgOffsetMinutes(next);
                      setEpgOffset(next);
                      getEpgForChannels(liveChannels, epgCountry).then(setEpgMap).catch(() => {});
                    }}
                  >
                    <Text style={styles.epgBtnText}>-1h</Text>
                  </TouchableOpacity>
                  <Text style={styles.epgOffsetLabel}>{epgOffset / 60}h</Text>
                  <TouchableOpacity
                    style={styles.epgBtn}
                    onPress={async () => {
                      const next = epgOffset + 60;
                      await setEpgOffsetMinutes(next);
                      setEpgOffset(next);
                      getEpgForChannels(liveChannels, epgCountry).then(setEpgMap).catch(() => {});
                    }}
                  >
                    <Text style={styles.epgBtnText}>+1h</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </View>

            {loadingLive ? (
              <ActivityIndicator color="#E50914" style={{ marginTop: 32 }} />
            ) : (
              <FlatList
                data={filteredChannels}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24, gap: 8 }}
                renderItem={({ item }) => {
                  const epg = epgMap[item.id];
                  return (
                    <TouchableOpacity
                      style={styles.channelCard}
                      onPress={() => startLivePlayback(item)}
                      activeOpacity={0.8}
                    >
                      {item.logo ? (
                        <Image source={{ uri: item.logo }} style={styles.channelLogo} resizeMode="contain" />
                      ) : (
                        <View style={[styles.channelLogo, { alignItems: 'center', justifyContent: 'center' }]}>
                          <Radio color="#9CA3AF" size={20} />
                        </View>
                      )}
                      <View style={styles.channelInfo}>
                        <Text style={styles.channelName} numberOfLines={1}>
                          {item.number}. {item.name}
                        </Text>
                        {epg?.now ? (
                          <>
                            <Text style={styles.channelEpgNow} numberOfLines={1}>
                              Ahora: {epg.now.title} ({epg.now.startLabel}-{epg.now.endLabel})
                            </Text>
                            <View style={styles.epgProgBg}>
                              <View style={[styles.epgProgFill, { width: `${epg.progressPct}%` }]} />
                            </View>
                            {epg.next ? (
                              <Text style={styles.channelEpgNext} numberOfLines={1}>
                                Luego: {epg.next.title}
                              </Text>
                            ) : null}
                          </>
                        ) : (
                          <Text style={styles.channelEpgNext}>En vivo · {item.quality || 'HD'}</Text>
                        )}
                      </View>
                      <Play color="#E50914" size={18} fill="#E50914" />
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        )}

        {tab === 'profile' && (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
            {/* Account Card */}
            <View style={styles.panelCard}>
              <Text style={styles.panelTitle}>Cuenta y Sincronización</Text>
              {user ? (
                <View style={{ gap: 10 }}>
                  <Text style={styles.userEmail}>
                    {user.displayName} ({user.email})
                  </Text>
                  <Text style={{ color: user.emailVerified ? '#34D399' : '#FBBF24', fontSize: 12 }}>
                    {user.emailVerified
                      ? 'Correo verificado · Sincronización en la nube activa'
                      : 'Verifica tu correo para activar respaldo en la nube'}
                  </Text>
                  {!user.emailVerified && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={async () => {
                          const u = await checkEmailVerified();
                          setUser(u);
                          if (u?.emailVerified) loadUserData();
                        }}
                      >
                        <Text style={styles.secondaryBtnText}>Ya verifiqué</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={() => resendVerificationEmail().then(() => Alert.alert('Enviado', 'Revisa tu correo'))}
                      >
                        <Text style={styles.secondaryBtnText}>Reenviar</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.logoutBtn}
                    onPress={async () => {
                      await signOutUser();
                      setUser(null);
                    }}
                  >
                    <LogOut color="#F87171" size={16} />
                    <Text style={{ color: '#F87171', fontWeight: '600' }}>Cerrar sesión</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {authMode === 'register' && (
                    <TextInput
                      value={authName}
                      onChangeText={setAuthName}
                      placeholder="Tu nombre"
                      placeholderTextColor="#6B7280"
                      style={styles.input}
                    />
                  )}
                  <TextInput
                    value={authEmail}
                    onChangeText={setAuthEmail}
                    placeholder="Correo electrónico"
                    placeholderTextColor="#6B7280"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    style={styles.input}
                  />
                  <TextInput
                    value={authPassword}
                    onChangeText={setAuthPassword}
                    placeholder="Contraseña"
                    placeholderTextColor="#6B7280"
                    secureTextEntry
                    style={styles.input}
                  />
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    disabled={authBusy}
                    onPress={async () => {
                      setAuthBusy(true);
                      try {
                        const u =
                          authMode === 'login'
                            ? await signInWithEmail(authEmail, authPassword)
                            : await signUpWithEmail(authEmail, authPassword, authName);
                        setUser(u);
                        loadUserData();
                      } catch (e: any) {
                        Alert.alert('Cuenta', e?.message || 'Error');
                      } finally {
                        setAuthBusy(false);
                      }
                    }}
                  >
                    <Text style={styles.primaryBtnText}>
                      {authBusy ? 'Cargando…' : authMode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
                    </Text>
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <TouchableOpacity onPress={() => setAuthMode((m) => (m === 'login' ? 'register' : 'login'))}>
                      <Text style={styles.linkText}>
                        {authMode === 'login' ? '¿No tienes cuenta? Regístrate' : 'Ya tengo cuenta'}
                      </Text>
                    </TouchableOpacity>
                    {authMode === 'login' && (
                      <TouchableOpacity
                        onPress={() =>
                          authEmail
                            ? sendPasswordReset(authEmail).then(() => Alert.alert('Enviado', 'Revisa tu correo'))
                            : Alert.alert('Correo', 'Escribe tu correo arriba')
                        }
                      >
                        <Text style={styles.linkText}>Olvidé mi clave</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}
            </View>

            {/* Favorites */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Heart color="#E50914" size={14} /> Mi Lista ({favorites.length})
              </Text>
              {favorites.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {favorites.map((item) => renderPosterCard(item))}
                </ScrollView>
              ) : (
                <Text style={styles.emptySub}>Aún no agregaste películas o series a favoritos.</Text>
              )}
            </View>

            {/* History */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Clock color="#9CA3AF" size={14} /> Historial ({history.length})
              </Text>
              {history.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  {history.slice(0, 15).map((h) =>
                    renderPosterCard({
                      id: h.mediaId,
                      title: h.title,
                      poster: h.poster,
                      backdrop: h.backdrop,
                      type: h.type,
                    }),
                  )}
                </ScrollView>
              ) : (
                <Text style={styles.emptySub}>Tu historial aparecerá aquí.</Text>
              )}
            </View>

            {/* Portal & Seeds Status */}
            <View style={styles.panelCard}>
              <Text style={styles.panelTitle}>Estado del Portal Nativo</Text>
              <Text style={styles.emptySub}>
                Semillas activas: {seedInfo.usable}/{seedInfo.total} · Host: {seedInfo.host}
              </Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={async () => {
                  await refreshSeedsFromCloud();
                  setSeedInfo(getSeedStats());
                  Alert.alert('Semillas', 'Pool actualizado desde la nube');
                }}
              >
                <Text style={styles.secondaryBtnText}>Actualizar semillas</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>

      {/* Bottom Tab Bar */}
      <View style={[styles.tabBar, { paddingBottom: Math.max(8, insets.bottom) }]}>
        {[
          { key: 'home' as const, label: 'Inicio', Icon: Home },
          { key: 'movies' as const, label: 'Películas', Icon: Film },
          { key: 'series' as const, label: 'Series', Icon: Tv },
          { key: 'live' as const, label: 'En Vivo', Icon: Radio },
          { key: 'profile' as const, label: 'Mi Espacio', Icon: User },
        ].map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <TouchableOpacity key={key} style={styles.tabItem} onPress={() => setTab(key)}>
              <Icon color={active ? '#E50914' : '#9CA3AF'} size={20} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Search Modal */}
      <Modal visible={searchOpen} animationType="slide" onRequestClose={() => setSearchOpen(false)}>
        <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.searchBar}>
            <Search color="#9CA3AF" size={18} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              placeholder="Buscar películas, series, anime…"
              placeholderTextColor="#6B7280"
              returnKeyType="search"
              autoFocus
              style={styles.searchInput}
            />
            <TouchableOpacity onPress={() => setSearchOpen(false)}>
              <X color="#FFF" size={22} />
            </TouchableOpacity>
          </View>
          {searching ? (
            <ActivityIndicator color="#E50914" style={{ marginTop: 32 }} />
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              numColumns={3}
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={styles.gridContent}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={{ width: GRID_CARD_W, marginBottom: 12 }}
                  onPress={() => {
                    setSearchOpen(false);
                    setDetailMedia(item);
                  }}
                >
                  <Image
                    source={{ uri: item.poster }}
                    style={[styles.posterImg, { height: GRID_CARD_W * 1.48 }]}
                  />
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>

      {/* Detail Screen */}
      <DetailScreen
        visible={Boolean(detailMedia)}
        media={detailMedia}
        isFavorite={detailMedia ? favIdSet.has(detailMedia.id) : false}
        onToggleFavorite={handleToggleFav}
        onClose={() => setDetailMedia(null)}
        onPlay={(item, ep, eps, sNum) => {
          setDetailMedia(null);
          startVodPlayback(item, ep, eps || [], sNum || 1);
        }}
      />

      {/* Native ExoPlayer Modal */}
      <VideoPlayerModal
        visible={playerVisible}
        onClose={() => {
          setPlayerVisible(false);
          loadUserData();
        }}
        title={playerTitle}
        subtitle={playerSubtitle}
        stream={playerStream}
        loading={playerLoading}
        error={playerError}
        onRetry={() => {
          if (playerIsLive && playingChannel) startLivePlayback(playingChannel, true);
          else if (playingMedia)
            startVodPlayback(playingMedia, playingEpisode || undefined, playingEpisodes, playingSeason);
        }}
        isLive={playerIsLive}
        initialPosition={playerInitialPos}
        media={playingMedia}
        currentEpisode={playingEpisode}
        episodes={playingEpisodes}
        seasonNumber={playingSeason}
        onSelectEpisode={(ep) => {
          if (playingMedia) startVodPlayback(playingMedia, ep, playingEpisodes, playingSeason);
        }}
        onSwitchTrack={(idx) => {
          if (playingMedia) {
            startVodPlayback(playingMedia, playingEpisode || undefined, playingEpisodes, playingSeason, idx);
          }
        }}
        liveChannels={liveChannels}
        currentChannel={playingChannel}
        epgMap={epgMap}
        onSelectChannel={(ch) => startLivePlayback(ch)}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0F' },
  header: {
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { color: '#FFF', fontSize: 19, fontWeight: '900', letterSpacing: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#14141E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1 },
  heroCard: {
    margin: 14,
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#14141E',
    justifyContent: 'flex-end',
  },
  heroBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  heroGrad: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,10,15,0.48)' },
  heroInfo: { padding: 16, gap: 6 },
  heroBadge: { color: '#F87171', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  heroTitle: { color: '#FFF', fontSize: 20, fontWeight: '800' },
  heroActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  heroPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E50914',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  heroPlayText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  heroInfoBtn: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  heroInfoText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  section: { marginTop: 14, gap: 10 },
  sectionTitle: { color: '#FFF', fontSize: 16, fontWeight: '700', paddingHorizontal: 14 },
  hScroll: { paddingHorizontal: 14, gap: 10 },
  posterCard: { gap: 5 },
  posterImg: { width: '100%', borderRadius: 10, backgroundColor: '#14141E' },
  qualityTag: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  qualityTagText: { color: '#FFF', fontSize: 9, fontWeight: '700' },
  cardTitle: { color: '#E5E7EB', fontSize: 12, fontWeight: '600' },
  cardSub: { color: '#9CA3AF', fontSize: 10.5 },
  continueCard: { width: 156, gap: 5 },
  continueImg: { width: '100%', height: 92, borderRadius: 10, backgroundColor: '#14141E' },
  continueProgBg: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  continueProgFill: { height: '100%', backgroundColor: '#E50914' },
  gridContent: { padding: 14, gap: 12 },
  gridRow: { gap: 10 },
  subTabsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 10 },
  catBarWrap: { height: 52, flexShrink: 0, justifyContent: 'center' },
  catScroll: { paddingHorizontal: 14, alignItems: 'center', gap: 8 },
  subPill: {
    paddingHorizontal: 14,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: '#14141E',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  subPillActive: { backgroundColor: '#E50914', borderColor: '#E50914' },
  subPillText: { color: '#9CA3AF', fontSize: 13, fontWeight: '600' },
  subPillTextActive: { color: '#FFF' },
  liveTools: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10, gap: 8, flexShrink: 0 },
  liveFilterInput: {
    backgroundColor: '#14141E',
    color: '#FFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 0,
    height: 42,
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  epgBarWrap: { height: 38, flexShrink: 0, justifyContent: 'center' },
  epgScrollContent: { gap: 8, alignItems: 'center' },
  epgBtn: {
    backgroundColor: '#14141E',
    paddingHorizontal: 12,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  epgBtnActive: { backgroundColor: '#E50914', borderColor: '#E50914' },
  epgBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  epgOffsetLabel: { color: '#D1D5DB', fontSize: 12, fontWeight: '700', paddingHorizontal: 4 },
  channelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#14141E',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  channelLogo: { width: 46, height: 46, borderRadius: 8, backgroundColor: '#0A0A0F' },
  channelInfo: { flex: 1, gap: 3 },
  channelName: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  channelEpgNow: { color: '#34D399', fontSize: 11.5, fontWeight: '600' },
  channelEpgNext: { color: '#9CA3AF', fontSize: 11 },
  epgProgBg: { height: 3, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2 },
  epgProgFill: { height: '100%', backgroundColor: '#10B981' },
  panelCard: {
    backgroundColor: '#14141E',
    borderRadius: 14,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  panelTitle: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  userEmail: { color: '#E5E7EB', fontSize: 13.5, fontWeight: '600' },
  input: {
    backgroundColor: '#0A0A0F',
    color: '#FFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  primaryBtn: {
    backgroundColor: '#E50914',
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  secondaryBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#FFF', fontWeight: '600', fontSize: 12.5 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  linkText: { color: '#9CA3AF', fontSize: 12.5 },
  emptyBox: { padding: 24, alignItems: 'center', gap: 10 },
  emptyTitle: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  emptySub: { color: '#9CA3AF', fontSize: 12.5, paddingHorizontal: 14 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#101018',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 8,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabLabel: { color: '#9CA3AF', fontSize: 10.5, fontWeight: '600' },
  tabLabelActive: { color: '#E50914' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    height: 54,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  searchInput: { flex: 1, color: '#FFF', fontSize: 15 },
});
