import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  Image,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
  StatusBar as RNStatusBar
} from 'react-native';
import { WebView } from 'react-native-webview';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import { Asset } from 'expo-asset';

import {
  CapturedPhoto,
  LlmLink,
  OcrLanguageCode,
  RoiBox
} from './src/types';
import {
  AVAILABLE_OCR_LANGUAGES,
  DEFAULT_LLM_LINKS,
  loadPreprocessEnabled,
  loadResponseLang,
  loadSavedLinks,
  loadSelectedOcrLangs,
  saveLinks,
  savePreprocessEnabled,
  saveResponseLang,
  saveSelectedOcrLangs
} from './src/storage/settingsStorage';
import { RoiSelector } from './src/components/RoiSelector';
import {
  PreprocessStats,
  TesseractOcrBridge,
  TesseractOcrBridgeHandle
} from './src/components/TesseractOcrBridge';
import { SettingsModal } from './src/components/SettingsModal';
import { ComboBox } from './src/components/ComboBox';
import { ZoomableImageModal, ZoomSlide } from './src/components/ZoomableImageModal';
import {
  STUDY_TASKS,
  StudyTaskKey,
  buildTaskPrompt,
  isRtlLanguage,
  taskSentence
} from './src/llmPrompts';

function withHttp(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function ensureGalleryFile(uri: string): Promise<string> {
  const bare = uri.split('?')[0];
  if (bare.startsWith('file://') && /\.(jpe?g|png|webp|gif|heic)$/i.test(bare)) {
    return uri;
  }
  const isPng = uri.startsWith('data:image/png');
  const dest = `${FileSystem.cacheDirectory || ''}debug-save-${Date.now()}.${isPng ? 'png' : 'jpg'}`;
  if (uri.startsWith('data:')) {
    const base64 = uri.includes(',') ? uri.split(',')[1] : uri;
    await FileSystem.writeAsStringAsync(dest, base64, {
      encoding: FileSystem.EncodingType.Base64
    });
    return dest;
  }
  const local = await ImageManipulator.manipulateAsync(uri, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG
  });
  return local.uri;
}

export default function App() {
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [originalPhoto, setOriginalPhoto] = useState<CapturedPhoto | null>(null);
  const [isPhotoCleaned, setIsPhotoCleaned] = useState<boolean>(false);
  const [enhancingPhoto, setEnhancingPhoto] = useState<boolean>(false);
  const [preprocessEnabled, setPreprocessEnabled] = useState<boolean>(true);
  const [responseLang, setResponseLang] = useState<OcrLanguageCode>('fra');
  const [savingImage, setSavingImage] = useState<boolean>(false);
  const [processedPreviews, setProcessedPreviews] = useState<string[]>([]);
  const [preprocessStats, setPreprocessStats] = useState<PreprocessStats[]>([]);
  const [rois, setRois] = useState<RoiBox[]>([]);
  const [phase, setPhase] = useState<'capture' | 'prompt' | 'browser'>('capture');
  const [isDrawingRoi, setIsDrawingRoi] = useState<boolean>(false);
  const [ocrRunning, setOcrRunning] = useState<boolean>(false);
  const [ocrStatus, setOcrStatus] = useState<string>('');
  const [ocrPercent, setOcrPercent] = useState<number>(0);
  const [ocrText, setOcrText] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<StudyTaskKey>('explain_lines');
  const [taskText, setTaskText] = useState<string>(
    taskSentence('fra', 'explain_lines')
  );
  const [taskCustom, setTaskCustom] = useState<boolean>(false);
  const [selectedLinkId, setSelectedLinkId] = useState<string>(DEFAULT_LLM_LINKS[0].id);
  const [browser, setBrowser] = useState<{
    url: string;
    title: string;
    returnTo: 'prompt' | 'settings';
    copied: boolean;
  } | null>(null);
  const [screenUnderBrowser, setScreenUnderBrowser] = useState<'capture' | 'prompt'>(
    'prompt'
  );

  // Per-page OCR language selection & Settings state
  const [selectedLangs, setSelectedLangs] = useState<OcrLanguageCode[]>([
    'fra'
  ]);
  const [links, setLinks] = useState<LlmLink[]>(DEFAULT_LLM_LINKS);
  const [settingsVisible, setSettingsVisible] = useState<boolean>(false);
  const [zoomSlides, setZoomSlides] = useState<ZoomSlide[] | null>(null);
  const [zoomTitle, setZoomTitle] = useState<string>('Image');
  const [zoomIndex, setZoomIndex] = useState<number>(0);

  const ocrBridgeRef = useRef<TesseractOcrBridgeHandle>(null);
  const scrollRef = useRef<ScrollView>(null);

  const showPhase = (next: 'capture' | 'prompt' | 'browser') => {
    setPhase(next);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  };

  useEffect(() => {
    (async () => {
      const [loadedLinks, loadedLangs, loadedPreprocess, loadedResponse] =
        await Promise.all([
          loadSavedLinks(),
          loadSelectedOcrLangs(),
          loadPreprocessEnabled(),
          loadResponseLang()
        ]);
      setLinks(loadedLinks);
      setSelectedLangs(loadedLangs);
      setPreprocessEnabled(loadedPreprocess);
      setResponseLang(loadedResponse);
      setSelectedLinkId((current) =>
        loadedLinks.some((link) => link.id === current)
          ? current
          : loadedLinks[0]?.id || ''
      );
    })();
  }, []);

  useEffect(() => {
    if (taskCustom) return;
    setTaskText(taskSentence(responseLang, selectedTask));
  }, [responseLang, selectedTask, taskCustom]);

  const resetPhotoState = (nextPhoto: CapturedPhoto | null) => {
    setPhoto(nextPhoto);
    setOriginalPhoto(nextPhoto);
    setIsPhotoCleaned(false);
    setRois([]);
    setOcrText('');
    setProcessedPreviews([]);
    setPreprocessStats([]);
    setOcrStatus('');
    showPhase('capture');
  };

  const togglePageLang = (code: OcrLanguageCode) => {
    setSelectedLangs((prev) => {
      let next: OcrLanguageCode[];
      if (prev.includes(code)) {
        if (prev.length <= 1) return prev;
        next = prev.filter((c) => c !== code);
      } else {
        next = [...prev, code];
      }
      saveSelectedOcrLangs(next);
      return next;
    });
  };

  const handleUpdateLinks = async (nextLinks: LlmLink[]) => {
    setLinks(nextLinks);
    await saveLinks(nextLinks);
  };

  const handleSetPreprocess = (enabled: boolean) => {
    setPreprocessEnabled(enabled);
    savePreprocessEnabled(enabled);
  };

  const handleSetResponseLang = (code: OcrLanguageCode) => {
    setResponseLang(code);
    saveResponseLang(code);
  };

  // 1. Capture from Phone Camera or Gallery
  const handleTakePhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Camera Permission Required',
          'Please allow camera access to take pictures of your study pages.'
        );
        return;
      }

      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        cameraType: ImagePicker.CameraType.back,
        quality: 1
      });

      if (!res.canceled && res.assets && res.assets[0]) {
        const asset = res.assets[0];
        resetPhotoState({
          uri: asset.uri,
          width: asset.width || 1000,
          height: asset.height || 1300
        });
      }
    } catch (err) {
      Alert.alert(
        'Camera Error',
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  const handlePickGallery = async () => {
    try {
      try {
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      } catch {
        // Ignore permission check failure on Android Photo Picker
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1
      });

      if (!res.canceled && res.assets && res.assets[0]) {
        const asset = res.assets[0];
        resetPhotoState({
          uri: asset.uri,
          width: asset.width || 1000,
          height: asset.height || 1300
        });
      }
    } catch (err) {
      Alert.alert(
        'Gallery Error',
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  const handleLoadSamplePage = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sampleAsset = Asset.fromModule(
        require('./assets/sample-philosophy-page.png')
      );
      await sampleAsset.downloadAsync();
      const uri = sampleAsset.localUri || sampleAsset.uri;
      resetPhotoState({
        uri,
        width: sampleAsset.width || 900,
        height: sampleAsset.height || 1150
      });
    } catch (err) {
      Alert.alert(
        'Could not load sample image',
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  const handleLoadRealBookPage = async (which: 1 | 2) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bookAsset = Asset.fromModule(
        which === 1
          ? require('./assets/real-book-page-1.jpg')
          : require('./assets/real-book-page-2.jpg')
      );
      await bookAsset.downloadAsync();
      const uri = bookAsset.localUri || bookAsset.uri;
      resetPhotoState({
        uri,
        width: bookAsset.width || (which === 1 ? 2000 : 1500),
        height: bookAsset.height || (which === 1 ? 1500 : 2000)
      });
    } catch (err) {
      Alert.alert(
        'Could not load real book image',
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  const handleRotatePhoto = async (degrees: 90 | -90) => {
    if (!photo) return;
    try {
      const rotated = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ rotate: degrees }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
      );
      const next = {
        uri: rotated.uri,
        width: rotated.width,
        height: rotated.height
      };
      setPhoto(next);
      if (!isPhotoCleaned) {
        setOriginalPhoto(next);
      }
      setRois([]);
      setProcessedPreviews([]);
    } catch (err) {
      Alert.alert(
        'Rotate Failed',
        err instanceof Error ? err.message : 'Could not rotate image.'
      );
    }
  };

  const handleSaveDebugImage = async (uri?: string) => {
    const source = uri || photo?.uri;
    if (!source || savingImage) return;
    try {
      setSavingImage(true);
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        Alert.alert(
          'Gallery permission',
          'Allow StudyLens to save images so you can inspect them in your gallery.'
        );
        return;
      }
      const fileUri = await ensureGalleryFile(source);
      await MediaLibrary.saveToLibraryAsync(fileUri);
      setOcrStatus('💾 Image saved to your gallery.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const needsRebuild = /native module|ExpoMediaLibrary|Cannot find/i.test(
        message
      );
      Alert.alert(
        'Save failed',
        needsRebuild
          ? 'Gallery save needs a new Android build. Rebuild the app, then try again.'
          : message
      );
    } finally {
      setSavingImage(false);
    }
  };

  const handleCleanBookPage = async () => {
    if (!photo || enhancingPhoto || ocrRunning) return;
    if (isPhotoCleaned && originalPhoto) {
      setPhoto(originalPhoto);
      setIsPhotoCleaned(false);
      setRois([]);
      setProcessedPreviews([]);
      setOcrStatus('↩ Restored original camera photo.');
      return;
    }

    try {
      setEnhancingPhoto(true);
      setOcrStatus(
        '✨ Cleaning book page (lifting shadows, fixing contrast, straightening the page)...'
      );
      const actions: ImageManipulator.Action[] =
        photo.width > 2000 ? [{ resize: { width: 2000 } }] : [];
      const manip = await ImageManipulator.manipulateAsync(
        photo.uri,
        actions,
        { compress: 0.94, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!manip.base64) {
        throw new Error('Could not extract base64 from photo.');
      }
      ocrBridgeRef.current?.enhanceImage(manip.base64);
    } catch (err) {
      setEnhancingPhoto(false);
      Alert.alert(
        'Book Clean Failed',
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  const handleSelectFullPage = async () => {
    if (!photo) return;
    try {
      const actions: ImageManipulator.Action[] =
        photo.width > 2200 ? [{ resize: { width: 2200 } }] : [];
      const full = await ImageManipulator.manipulateAsync(
        photo.uri,
        actions,
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      setRois([
        {
          id: `roi-full-${Date.now()}`,
          normX: 0,
          normY: 0,
          normW: 1,
          normH: 1,
          rotation: 0,
          croppedUri: full.uri,
          base64: full.base64
        }
      ]);
    } catch (err) {
      Alert.alert(
        'Full Page Selection Error',
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  // 2. Run Local Tesseract.js OCR on ROI Array
  const handleRunOcr = () => {
    if (rois.length === 0) return;
    setOcrRunning(true);
    setOcrPercent(5);
    setProcessedPreviews([]);
    setPreprocessStats([]);
    const shouldPreprocess = preprocessEnabled && !isPhotoCleaned;
    setOcrStatus(
      shouldPreprocess
        ? `Cleaning the page for OCR (${selectedLangs.join('+')})...`
        : `Starting local OCR (${selectedLangs.join('+')})...`
    );
    ocrBridgeRef.current?.recognizeRois(rois, selectedLangs, shouldPreprocess);
  };

  const pageLang = selectedLangs[0] || 'fra';
  const pageDirection = isRtlLanguage(pageLang) ? 'rtl' : 'ltr';
  const answerDirection = isRtlLanguage(responseLang) ? 'rtl' : 'ltr';
  const responseOption =
    AVAILABLE_OCR_LANGUAGES.find((lang) => lang.code === responseLang) ||
    AVAILABLE_OCR_LANGUAGES[1];

  const roiSourceUri = (roi: RoiBox | undefined): string | null => {
    if (!roi) return null;
    if (roi.base64) {
      return roi.base64.startsWith('data:')
        ? roi.base64
        : `data:image/jpeg;base64,${roi.base64}`;
    }
    return roi.croppedUri || null;
  };

  const openZoom = (title: string, slides: ZoomSlide[], index = 0) => {
    const usable = slides.filter((slide) => slide.uri.length > 0);
    if (usable.length === 0) return;
    setZoomTitle(title);
    setZoomSlides(usable);
    setZoomIndex(Math.max(0, Math.min(index, usable.length - 1)));
  };

  const openPreprocessLarge = (idx: number) => {
    const cleaned = processedPreviews[idx];
    if (!cleaned) return;
    const slides: ZoomSlide[] = [{ label: 'Cleaned for OCR', uri: cleaned }];
    const original = roiSourceUri(rois[idx]);
    if (original) slides.push({ label: 'Original crop', uri: original });
    const st = preprocessStats[idx];
    const size = st ? ` ${st.width}×${st.height}` : '';
    openZoom(`Preprocess #${idx + 1}${size}`, slides, 0);
  };

  const selectedLink =
    links.find((link) => link.id === selectedLinkId) || links[0];

  const openBrowser = (
    url: string,
    title: string,
    returnTo: 'prompt' | 'settings',
    copied: boolean
  ) => {
    if (phase === 'capture' || phase === 'prompt') {
      setScreenUnderBrowser(phase);
    }
    setBrowser({ url: withHttp(url), title, returnTo, copied });
    if (returnTo === 'settings') setSettingsVisible(false);
    showPhase('browser');
  };

  const backFromBrowser = () => {
    const reopenSettings = browser?.returnTo === 'settings';
    const dest = screenUnderBrowser;
    setBrowser(null);
    showPhase(dest);
    if (reopenSettings) setSettingsVisible(true);
  };

  const handleChooseTask = (id: string) => {
    const task = STUDY_TASKS.find((item) => item.key === id);
    if (!task) return;
    setSelectedTask(task.key);
    setTaskCustom(false);
    setTaskText(taskSentence(responseLang, task.key));
  };

  const handleExecute = async () => {
    if (!selectedLink) return;
    const prompt = buildTaskPrompt(taskText, responseLang, ocrText);
    await Clipboard.setStringAsync(prompt);
    openBrowser(selectedLink.url, selectedLink.title, 'prompt', true);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      {/* Hidden Tesseract.js OCR WebView Worker */}
      <TesseractOcrBridge
        ref={ocrBridgeRef}
        onProgress={(status, pct) => {
          setOcrStatus(status);
          setOcrPercent(pct);
        }}
        onComplete={(text, processedRois, stats) => {
          setOcrRunning(false);
          setOcrPercent(100);
          if (processedRois && processedRois.length > 0) {
            setProcessedPreviews(processedRois);
          }
          if (stats && stats.length > 0) {
            setPreprocessStats(stats);
          }
          const rotNote =
            stats && stats.length > 0 && stats[0].rot90
              ? ` • Rotated ${stats[0].rot90}°`
              : '';
          const statNote =
            stats && stats.length > 0
              ? `${rotNote} • Deskew ${stats[0].skewAngle >= 0 ? '+' : ''}${stats[0].skewAngle}° • Curve flat ${stats[0].curveShiftPx}px`
              : '';
          setOcrStatus(
            `✅ Local OCR complete (${selectedLangs.join('+')})${statNote}`
          );
          setOcrText(
            text ||
            '(No text detected — go back to the photo and draw a tighter region, or type the text here.)'
          );
          showPhase('prompt');
        }}
        onEnhanceComplete={async (base64, stats) => {
          try {
            const clean =
              base64.indexOf(',') !== -1 ? base64.split(',')[1] : base64;
            const fileUri = `${FileSystem.cacheDirectory || ''}cleaned_book_${Date.now()}.jpg`;
            await FileSystem.writeAsStringAsync(fileUri, clean, {
              encoding: FileSystem.EncodingType.Base64
            });
            setPhoto({
              uri: fileUri,
              width: stats.width || photo?.width || 1200,
              height: stats.height || photo?.height || 1600
            });
            setIsPhotoCleaned(true);
            setRois([]);
            setProcessedPreviews([]);
            const rotPart = stats.rot90 ? `Auto-rotated ${stats.rot90}° • ` : '';
            setOcrStatus(
              `✨ Book page cleaned: ${rotPart}Shadows removed • Deskewed ${stats.skewAngle >= 0 ? '+' : ''}${stats.skewAngle}° • Line curve flattened ${stats.curveShiftPx}px`
            );
          } catch (err) {
            setOcrStatus(
              `❌ Could not save cleaned page: ${err instanceof Error ? err.message : String(err)}`
            );
          } finally {
            setEnhancingPhoto(false);
          }
        }}
        onError={(err) => {
          setOcrRunning(false);
          setEnhancingPhoto(false);
          setOcrStatus(`❌ OCR Error: ${err}`);
        }}
      />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Text style={styles.brandEmoji}>📖</Text>
          <View>
            <Text style={styles.brandTitle}>StudyLens</Text>
            <Text style={styles.brandSubtitle}>
              Snap • ROI • Local OCR • Ask LLM
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => setSettingsVisible(true)}
            style={styles.langBadge}
          >
            <Text style={styles.langBadgeText}>
              Ask {responseOption.short}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setSettingsVisible(true)}
            style={styles.settingsBtn}
          >
            <Text style={styles.settingsBtnText}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {phase === 'browser' && browser ? (
        <View style={styles.browserPane}>
          <View style={styles.browserBar}>
            <TouchableOpacity onPress={backFromBrowser} style={styles.smallHeaderBtn}>
              <Text style={styles.smallHeaderBtnText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.browserTitle} numberOfLines={1}>
              {browser.title}
            </Text>
          </View>
          {browser.copied && (
            <Text style={styles.browserHint}>
              Prompt copied. Paste it into the page.
            </Text>
          )}
          <WebView
            source={{ uri: browser.url }}
            style={styles.webview}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            sharedCookiesEnabled
            cacheEnabled
            userAgent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
            setSupportMultipleWindows={false}
            startInLoadingState
            renderLoading={() => (
              <ActivityIndicator color="#818cf8" style={styles.browserSpinner} />
            )}
          />
        </View>
      ) : (
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        scrollEnabled={!isDrawingRoi}
      >
        {phase === 'capture' && (
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Photo</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={() => setSettingsVisible(true)}
                style={[
                  styles.smallHeaderBtn,
                  preprocessEnabled ? styles.cleanOnBtn : styles.cleanOffBtn
                ]}
              >
                <Text
                  style={[
                    styles.smallHeaderBtnText,
                    preprocessEnabled ? styles.cleanOnText : styles.cleanOffText
                  ]}
                >
                  {preprocessEnabled ? 'Clean ON' : 'Clean OFF'}
                </Text>
              </TouchableOpacity>
              {photo && (
                <TouchableOpacity
                  onPress={() => resetPhotoState(null)}
                  style={styles.smallHeaderBtn}
                >
                  <Text style={styles.smallHeaderBtnText}>New</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {!photo ? (
            <View>
              <View style={styles.captureGrid}>
                <TouchableOpacity
                  onPress={handleTakePhoto}
                  style={styles.captureBtnPrimary}
                >
                  <Text style={styles.captureEmoji}>📷</Text>
                  <Text style={styles.captureBtnLabel}>Take Picture</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handlePickGallery}
                  style={styles.captureBtnSecondary}
                >
                  <Text style={styles.captureEmoji}>🖼️</Text>
                  <Text style={styles.captureBtnLabel}>From Gallery</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.sampleRow}>
                <TouchableOpacity
                  onPress={() => handleLoadRealBookPage(1)}
                  style={styles.sampleChip}
                >
                  <Text style={styles.sampleChipText}>Book 1</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleLoadRealBookPage(2)}
                  style={styles.sampleChip}
                >
                  <Text style={styles.sampleChipText}>Book 2</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleLoadSamplePage}
                  style={[styles.sampleChip, styles.sampleChipMuted]}
                >
                  <Text style={[styles.sampleChipText, styles.sampleChipMutedText]}>
                    Sample
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View>
              <View style={styles.toolbar}>
                <TouchableOpacity
                  onPress={() => handleRotatePhoto(-90)}
                  style={styles.toolBtn}
                >
                  <Text style={styles.toolBtnText}>↺</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleRotatePhoto(90)}
                  style={styles.toolBtn}
                >
                  <Text style={styles.toolBtnText}>↻</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleSaveDebugImage()}
                  disabled={savingImage}
                  style={[styles.toolBtn, savingImage && styles.btnDisabled]}
                >
                  <Text style={styles.toolBtnText}>
                    {savingImage ? '…' : 'Save'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSelectFullPage}
                  style={styles.toolBtn}
                >
                  <Text style={styles.toolBtnText}>Full</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setRois((prev) => prev.slice(0, -1))}
                  style={styles.toolBtn}
                >
                  <Text style={styles.toolBtnText}>Undo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setRois([])}
                  style={styles.toolBtn}
                >
                  <Text style={styles.toolBtnText}>Clear</Text>
                </TouchableOpacity>
              </View>

              <RoiSelector
                photo={photo}
                rois={rois}
                onAddRoi={(roi) => setRois((prev) => [...prev, roi])}
                onChangeRoi={(id, patch) =>
                  setRois((prev) =>
                    prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
                  )
                }
                onRemoveRoi={(id) =>
                  setRois((prev) => prev.filter((item) => item.id !== id))
                }
                onDrawingChange={setIsDrawingRoi}
                onClean={handleCleanBookPage}
                cleanBusy={enhancingPhoto || ocrRunning}
                cleaned={isPhotoCleaned}
              />

              <View style={styles.flagRow}>
                {AVAILABLE_OCR_LANGUAGES.map((lang) => {
                  const active = selectedLangs.includes(lang.code);
                  return (
                    <TouchableOpacity
                      key={lang.code}
                      onPress={() => togglePageLang(lang.code)}
                      style={[styles.flagChip, active && styles.flagChipActive]}
                    >
                      <Text style={styles.flagChipText}>{lang.flag}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                onPress={handleRunOcr}
                disabled={
                  rois.length === 0 || ocrRunning || enhancingPhoto || isDrawingRoi
                }
                style={[
                  styles.primaryActionBtn,
                  (rois.length === 0 ||
                    ocrRunning ||
                    enhancingPhoto ||
                    isDrawingRoi) &&
                    styles.btnDisabled
                ]}
              >
                <Text style={styles.primaryActionBtnText}>
                  {ocrRunning
                    ? `⏳ Running OCR (${ocrPercent}%)...`
                    : `🔍 Run Local OCR (${selectedLangs.join('+')}) on ${rois.length} ROI(s)`}
                </Text>
              </TouchableOpacity>

              {ocrText.length > 0 && !ocrRunning && (
                <TouchableOpacity
                  onPress={() => showPhase('prompt')}
                  style={styles.openPromptBtn}
                >
                  <Text style={styles.openPromptText}>Open prompt</Text>
                </TouchableOpacity>
              )}

              {ocrStatus.length > 0 && (
                <View style={styles.ocrStatusCard}>
                  <Text style={styles.ocrStatusText}>{ocrStatus}</Text>
                </View>
              )}

              {processedPreviews.length > 0 && (
                <View style={styles.previewBox}>
                  <Text style={styles.previewBoxTitle}>
                    Preprocessed page sent to OCR. Tap a page to open it large and zoom.
                  </Text>
                  {processedPreviews.map((dataUrl, idx) => {
                    const st = preprocessStats[idx];
                    return (
                      <View key={`prev-${idx}`} style={styles.previewItem}>
                        <TouchableOpacity
                          onPress={() => openPreprocessLarge(idx)}
                          activeOpacity={0.85}
                        >
                          <Image
                            source={{ uri: dataUrl }}
                            style={styles.previewImg}
                            resizeMode="contain"
                          />
                        </TouchableOpacity>
                        <View style={styles.previewMetaRow}>
                          <Text style={styles.previewMeta}>
                            {st
                              ? `#${idx + 1} • ${st.width}×${st.height} • Skew ${st.skewAngle >= 0 ? '+' : ''}${st.skewAngle}° • Curve ${st.curveShiftPx}px`
                              : `#${idx + 1}`}
                          </Text>
                          <TouchableOpacity
                            onPress={() => handleSaveDebugImage(dataUrl)}
                            disabled={savingImage}
                            style={styles.previewSaveBtn}
                          >
                            <Text style={styles.toolBtnSaveText}>💾</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}
        </View>
        )}

        {phase === 'prompt' && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Prompt</Text>
              <TouchableOpacity
                onPress={() => showPhase('capture')}
                style={styles.smallHeaderBtn}
              >
                <Text style={styles.smallHeaderBtnText}>Back</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Task</Text>
            <ComboBox
              value={selectedTask}
              options={STUDY_TASKS.map((task) => ({
                id: task.key,
                label: task.label
              }))}
              onChange={handleChooseTask}
            />
            <TextInput
              style={[
                styles.input,
                styles.taskInput,
                answerDirection === 'rtl' && styles.inputRtl
              ]}
              multiline
              placeholder="Write the task"
              placeholderTextColor="#64748b"
              value={taskText}
              onChangeText={(value) => {
                setTaskText(value);
                setTaskCustom(true);
              }}
              textAlign={answerDirection === 'rtl' ? 'right' : 'left'}
            />

            <Text style={styles.fieldLabel}>Answer in</Text>
            <View style={styles.flagRow}>
              {AVAILABLE_OCR_LANGUAGES.map((lang) => {
                const active = lang.code === responseLang;
                return (
                  <TouchableOpacity
                    key={lang.code}
                    onPress={() => handleSetResponseLang(lang.code)}
                    style={[styles.flagChip, active && styles.flagChipActive]}
                  >
                    <Text style={styles.flagChipText}>{lang.flag}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Open in</Text>
            <ComboBox
              value={selectedLink?.id || ''}
              options={links.map((link) => ({
                id: link.id,
                label: `${link.icon} ${link.title}`
              }))}
              onChange={setSelectedLinkId}
              placeholder="Choose a page"
            />

            <TouchableOpacity
              onPress={handleExecute}
              disabled={!selectedLink}
              style={[styles.successActionBtn, !selectedLink && styles.btnDisabled]}
            >
              <Text style={styles.primaryActionBtnText}>Execute</Text>
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Extracted text</Text>
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                styles.textAreaTall,
                pageDirection === 'rtl' && styles.inputRtl
              ]}
              multiline
              placeholder="Text from the page"
              placeholderTextColor="#64748b"
              value={ocrText}
              onChangeText={setOcrText}
              textAlign={pageDirection === 'rtl' ? 'right' : 'left'}
            />
          </View>
        )}
      </ScrollView>
      )}

      <ZoomableImageModal
        visible={zoomSlides !== null}
        title={zoomTitle}
        slides={zoomSlides || []}
        initialIndex={zoomIndex}
        onClose={() => setZoomSlides(null)}
      />

      {/* Settings Modal (Links) */}
      <SettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        links={links}
        onChangeLinks={handleUpdateLinks}
        preprocessEnabled={preprocessEnabled}
        onChangePreprocess={handleSetPreprocess}
        onOpenLink={(link) => openBrowser(link.url, link.title, 'settings', false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingTop: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 32) + 16 : 16,
    paddingBottom: Platform.OS === 'android' ? 16 : 0
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  brandEmoji: {
    fontSize: 24
  },
  brandTitle: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '700'
  },
  brandSubtitle: {
    color: '#94a3b8',
    fontSize: 11
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  langBadge: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8
  },
  langBadgeText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600'
  },
  settingsBtn: {
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
    borderWidth: 1,
    borderColor: '#6366f1',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8
  },
  settingsBtnText: {
    color: '#e0e7ff',
    fontSize: 12,
    fontWeight: '700'
  },
  scroll: {
    flex: 1
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 48
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155'
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  cardTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700'
  },
  smallHeaderBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8
  },
  smallHeaderBtnText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '600'
  },
  captureGrid: {
    flexDirection: 'row',
    gap: 10
  },
  captureBtnPrimary: {
    flex: 1,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderWidth: 1.5,
    borderColor: '#6366f1',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center'
  },
  captureBtnSecondary: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderWidth: 1.5,
    borderColor: '#334155',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center'
  },
  captureEmoji: {
    fontSize: 28,
    marginBottom: 6
  },
  captureBtnLabel: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 14
  },
  sampleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8
  },
  sampleChip: {
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8
  },
  sampleChipMuted: {
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    borderColor: '#334155'
  },
  sampleChipText: {
    color: '#7dd3fc',
    fontWeight: '700',
    fontSize: 11
  },
  sampleChipMutedText: {
    color: '#cbd5e1'
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  cleanOnBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderWidth: 1,
    borderColor: '#10b981'
  },
  cleanOffBtn: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155'
  },
  cleanOnText: {
    color: '#6ee7b7'
  },
  cleanOffText: {
    color: '#94a3b8'
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 4,
    marginBottom: 8
  },
  toolBtn: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 2,
    paddingVertical: 6,
    borderRadius: 8
  },
  toolBtnHighlight: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderColor: '#10b981'
  },
  toolBtnRevert: {
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    borderColor: '#f59e0b'
  },
  toolBtnSave: {
    borderColor: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.12)'
  },
  toolBtnSaveText: {
    color: '#fcd34d',
    fontSize: 12,
    fontWeight: '700'
  },
  toolBtnText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600'
  },
  toolBtnHighlightText: {
    color: '#6ee7b7',
    fontWeight: '700'
  },
  inputRtl: {
    writingDirection: 'rtl'
  },
  previewBox: {
    marginTop: 10,
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  previewBoxTitle: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8
  },
  previewItem: {
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 8
  },
  previewImg: {
    width: '100%',
    height: 320,
    backgroundColor: '#ffffff',
    borderRadius: 4
  },
  previewMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4
  },
  previewMeta: {
    flex: 1,
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600'
  },
  previewSaveBtn: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: '#f59e0b',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6
  },
  primaryActionBtn: {
    marginTop: 14,
    backgroundColor: '#6366f1',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center'
  },
  successActionBtn: {
    marginTop: 14,
    backgroundColor: '#10b981',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center'
  },
  btnDisabled: {
    opacity: 0.45
  },
  primaryActionBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700'
  },
  ocrStatusCard: {
    marginTop: 10,
    backgroundColor: '#0f172a',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  ocrStatusText: {
    color: '#94a3b8',
    fontSize: 12
  },
  fieldLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6
  },
  chipsRow: {
    gap: 8,
    paddingVertical: 2
  },
  flagRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 3,
    marginTop: 8
  },
  flagChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 4
  },
  flagChipActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.28)',
    borderColor: '#6366f1'
  },
  flagChipText: {
    fontSize: 15
  },
  presetChip: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999
  },
  presetChipActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.22)',
    borderColor: '#6366f1'
  },
  presetChipText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600'
  },
  presetChipTextActive: {
    color: '#e0e7ff'
  },
  input: {
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13
  },
  textArea: {
    minHeight: 110,
    textAlignVertical: 'top'
  },
  textAreaTall: {
    minHeight: 160
  },
  taskInput: {
    minHeight: 72,
    textAlignVertical: 'top',
    marginTop: 8
  },
  browserPane: {
    flex: 1
  },
  browserBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8
  },
  browserTitle: {
    flex: 1,
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700'
  },
  browserHint: {
    color: '#a5b4fc',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 6
  },
  browserSpinner: {
    marginTop: 24
  },
  webview: {
    flex: 1,
    backgroundColor: '#ffffff'
  },
  openPromptBtn: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 6
  },
  openPromptText: {
    color: '#a5b4fc',
    fontSize: 13,
    fontWeight: '700'
  }
});

