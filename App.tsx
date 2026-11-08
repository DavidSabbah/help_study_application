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
  StatusBar as RNStatusBar
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import { Asset } from 'expo-asset';

import {
  CapturedPhoto,
  LlmLink,
  OcrLanguageCode,
  PromptPresetKey,
  RoiBox
} from './src/types';
import {
  AVAILABLE_OCR_LANGUAGES,
  DEFAULT_LLM_LINKS,
  loadSavedLinks,
  loadSelectedOcrLangs,
  saveLinks,
  saveSelectedOcrLangs
} from './src/storage/settingsStorage';
import { RoiSelector } from './src/components/RoiSelector';
import {
  PreprocessStats,
  TesseractOcrBridge,
  TesseractOcrBridgeHandle
} from './src/components/TesseractOcrBridge';
import { SettingsModal } from './src/components/SettingsModal';
import { LlmPopupModal } from './src/components/LlmPopupModal';

const PRESETS: { key: PromptPresetKey; label: string }[] = [
  { key: 'philosophy_explain', label: '🏛️ Explain Passage & Concepts' },
  { key: 'notebook_lesson', label: '📓 Explain Using My Lesson Notebook' },
  { key: 'argument_breakdown', label: '⚖️ Thesis & Argument Structure' },
  { key: 'exercise_help', label: '✍️ Help Solve Exercise' },
  { key: 'raw_only', label: '📋 Raw OCR Text Only' }
];

export default function App() {
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [originalPhoto, setOriginalPhoto] = useState<CapturedPhoto | null>(null);
  const [isPhotoCleaned, setIsPhotoCleaned] = useState<boolean>(false);
  const [enhancingPhoto, setEnhancingPhoto] = useState<boolean>(false);
  const [preprocessEnabled, setPreprocessEnabled] = useState<boolean>(true);
  const [processedPreviews, setProcessedPreviews] = useState<string[]>([]);
  const [preprocessStats, setPreprocessStats] = useState<PreprocessStats[]>([]);
  const [rois, setRois] = useState<RoiBox[]>([]);
  const [isDrawingRoi, setIsDrawingRoi] = useState<boolean>(false);
  const [ocrRunning, setOcrRunning] = useState<boolean>(false);
  const [ocrStatus, setOcrStatus] = useState<string>('');
  const [ocrPercent, setOcrPercent] = useState<number>(0);
  const [ocrText, setOcrText] = useState<string>('');
  const [selectedPreset, setSelectedPreset] =
    useState<PromptPresetKey>('philosophy_explain');
  const [customQuestion, setCustomQuestion] = useState<string>('');

  // Per-page OCR language selection & Settings state
  const [selectedLangs, setSelectedLangs] = useState<OcrLanguageCode[]>([
    'fra'
  ]);
  const [links, setLinks] = useState<LlmLink[]>(DEFAULT_LLM_LINKS);
  const [settingsVisible, setSettingsVisible] = useState<boolean>(false);
  const [llmPopupVisible, setLlmPopupVisible] = useState<boolean>(false);

  const ocrBridgeRef = useRef<TesseractOcrBridgeHandle>(null);

  useEffect(() => {
    (async () => {
      const [loadedLinks, loadedLangs] = await Promise.all([
        loadSavedLinks(),
        loadSelectedOcrLangs()
      ]);
      setLinks(loadedLinks);
      setSelectedLangs(loadedLangs);
    })();
  }, []);

  const resetPhotoState = (nextPhoto: CapturedPhoto | null) => {
    setPhoto(nextPhoto);
    setOriginalPhoto(nextPhoto);
    setIsPhotoCleaned(false);
    setRois([]);
    setOcrText('');
    setProcessedPreviews([]);
    setPreprocessStats([]);
    setOcrStatus('');
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

  const handleRotatePhoto = async () => {
    if (!photo) return;
    try {
      const rotated = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ rotate: 90 }],
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
        '✨ Cleaning book page (removing shadows, deskewing & straightening lines)...'
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
        ? `Cleaning shadows, deskewing & starting OCR (${selectedLangs.join('+')})...`
        : `Starting local OCR (${selectedLangs.join('+')})...`
    );
    ocrBridgeRef.current?.recognizeRois(rois, selectedLangs, shouldPreprocess);
  };

  // 3. Build Prompt & Open LLM Popup
  const buildFinalPrompt = (): string => {
    const cleanOcr = ocrText.trim();
    const cleanQ = customQuestion.trim();

    if (selectedPreset === 'raw_only') {
      return cleanQ ? `${cleanOcr}\n\nQuestion: ${cleanQ}` : cleanOcr;
    }

    const instructions: Record<PromptPresetKey, string> = {
      philosophy_explain:
        `I am studying philosophy and there is a passage/excerpt I do not fully understand.\n` +
        `Please:\n` +
        `1. Explain the main idea of this passage in clear, simple terms.\n` +
        `2. Define the key philosophical concepts and terms used.\n` +
        `3. Give a concrete example or analogy to make it intuitive.`,
      notebook_lesson:
        `Using the lesson documents and sources in my notebook, please explain the following excerpt I just scanned from my study material.\n` +
        `Connect it directly to the concepts, authors, and arguments covered in our lesson:`,
      argument_breakdown:
        `Please analyze the philosophical argument in this excerpt:\n` +
        `1. Identify the author's main thesis / conclusion.\n` +
        `2. List the explicit and implicit premises step by step.\n` +
        `3. Point out any key distinctions or potential objections.`,
      exercise_help:
        `I am working on this study exercise / question.\n` +
        `Please guide me step by step on how to approach and answer it, highlighting the relevant philosophical concepts and arguments:`,
      raw_only: ''
    };

    let prompt = `${instructions[selectedPreset]}\n\n"""\n${cleanOcr}\n"""`;
    if (cleanQ) {
      prompt += `\n\nMy specific question: ${cleanQ}`;
    }
    return prompt;
  };

  const handleOpenLlmPopup = async () => {
    const prompt = buildFinalPrompt();
    await Clipboard.setStringAsync(prompt);
    setLlmPopupVisible(true);
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
            '(No text detected — try drawing a tighter ROI box or selecting the page language above.)'
          );
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
            style={styles.settingsBtn}
          >
            <Text style={styles.settingsBtnText}>⚙️ Settings</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        scrollEnabled={!isDrawingRoi}
      >
        {/* STEP 1: Capture & ROI Selection */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>1. Photo & ROI Selection</Text>
            {photo && (
              <TouchableOpacity
                onPress={() => resetPhotoState(null)}
                style={styles.smallHeaderBtn}
              >
                <Text style={styles.smallHeaderBtnText}>🔄 New Photo</Text>
              </TouchableOpacity>
            )}
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

              <View style={{ marginTop: 10, gap: 8 }}>
                <TouchableOpacity
                  onPress={() => handleLoadRealBookPage(1)}
                  style={styles.samplePageBtn}
                >
                  <Text style={styles.samplePageBtnText}>
                    📖 Test Real Book Photo #1 (Sideways + Thumb Shadow + Curve)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleLoadRealBookPage(2)}
                  style={styles.samplePageBtn}
                >
                  <Text style={styles.samplePageBtnText}>
                    📖 Test Real Book Photo #2 (Curved Spine + Shadow + Bleed)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleLoadSamplePage}
                  style={[
                    styles.samplePageBtn,
                    {
                      backgroundColor: 'rgba(148, 163, 184, 0.1)',
                      borderColor: '#334155'
                    }
                  ]}
                >
                  <Text
                    style={[styles.samplePageBtnText, { color: '#cbd5e1' }]}
                  >
                    ✨ Load Clean Sample Page
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View>
              <View style={styles.toolbar}>
                <TouchableOpacity
                  onPress={handleCleanBookPage}
                  disabled={enhancingPhoto || ocrRunning}
                  style={[
                    styles.toolBtn,
                    isPhotoCleaned
                      ? styles.toolBtnRevert
                      : styles.toolBtnHighlight
                  ]}
                >
                  <Text
                    style={[
                      styles.toolBtnText,
                      !isPhotoCleaned && styles.toolBtnHighlightText
                    ]}
                  >
                    {enhancingPhoto
                      ? '⏳ Cleaning...'
                      : isPhotoCleaned
                        ? '↩ Original Photo'
                        : '✨ Clean Book Page'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleRotatePhoto}
                  style={styles.toolBtn}
                >
                  <Text style={styles.toolBtnText}>↻ Rotate</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSelectFullPage}
                  style={styles.toolBtn}
                >
                  <Text style={styles.toolBtnText}>⬜ Full Page</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setRois((prev) => prev.slice(0, -1))}
                  style={styles.toolBtn}
                >
                  <Text style={styles.toolBtnText}>↩ Undo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setRois([])}
                  style={styles.toolBtn}
                >
                  <Text style={styles.toolBtnText}>🗑️ Clear</Text>
                </TouchableOpacity>
              </View>

              <RoiSelector
                photo={photo}
                rois={rois}
                onAddRoi={(roi) => setRois((prev) => [...prev, roi])}
                onRemoveRoi={(id) =>
                  setRois((prev) => prev.filter((item) => item.id !== id))
                }
                onDrawingChange={setIsDrawingRoi}
              />

              {/* Pre-OCR Book Image Processing Toggle */}
              <TouchableOpacity
                onPress={() => setPreprocessEnabled((prev) => !prev)}
                style={[
                  styles.preprocessBanner,
                  preprocessEnabled && styles.preprocessBannerActive
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.preprocessTitle}>
                    {preprocessEnabled
                      ? '✨ Pre-OCR Book Processing: ON'
                      : '⚪ Pre-OCR Book Processing: OFF'}
                  </Text>
                  <Text style={styles.preprocessSub}>
                    Shadow & illumination normalization • Deskew tilt • Flatten curved book lines • Sauvola contrast
                  </Text>
                </View>
                <View
                  style={[
                    styles.preprocessBadge,
                    preprocessEnabled && styles.preprocessBadgeActive
                  ]}
                >
                  <Text style={styles.preprocessBadgeText}>
                    {preprocessEnabled ? 'ACTIVE' : 'OFF'}
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Per-page OCR Language Selector */}
              <Text style={styles.fieldLabel}>
                Page OCR Language(s) ({selectedLangs.join('+')})
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
              >
                {AVAILABLE_OCR_LANGUAGES.map((lang) => {
                  const active = selectedLangs.includes(lang.code);
                  return (
                    <TouchableOpacity
                      key={lang.code}
                      onPress={() => togglePageLang(lang.code)}
                      style={[
                        styles.presetChip,
                        active && styles.presetChipActive
                      ]}
                    >
                      <Text
                        style={[
                          styles.presetChipText,
                          active && styles.presetChipTextActive
                        ]}
                      >
                        {lang.flag} {lang.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <TouchableOpacity
                onPress={handleRunOcr}
                disabled={rois.length === 0 || ocrRunning || enhancingPhoto}
                style={[
                  styles.primaryActionBtn,
                  (rois.length === 0 || ocrRunning || enhancingPhoto) &&
                    styles.btnDisabled
                ]}
              >
                <Text style={styles.primaryActionBtnText}>
                  {ocrRunning
                    ? `⏳ Running OCR (${ocrPercent}%)...`
                    : `🔍 Run Local OCR (${selectedLangs.join('+')}) on ${rois.length} ROI(s)`}
                </Text>
              </TouchableOpacity>

              {ocrStatus.length > 0 && (
                <View style={styles.ocrStatusCard}>
                  <Text style={styles.ocrStatusText}>{ocrStatus}</Text>
                </View>
              )}

              {processedPreviews.length > 0 && (
                <View style={styles.previewBox}>
                  <Text style={styles.previewBoxTitle}>
                    🧼 Preprocessed ROI(s) Sent to OCR (Shadow-Free & Straightened)
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.previewScroll}
                  >
                    {processedPreviews.map((dataUrl, idx) => {
                      const st = preprocessStats[idx];
                      return (
                        <View key={`prev-${idx}`} style={styles.previewItem}>
                          <Image
                            source={{ uri: dataUrl }}
                            style={styles.previewImg}
                            resizeMode="contain"
                          />
                          {st && (
                            <Text style={styles.previewMeta}>
                              #{idx + 1} • Skew {st.skewAngle >= 0 ? '+' : ''}
                              {st.skewAngle}° • Curve {st.curveShiftPx}px
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
            </View>
          )}
        </View>

        {/* STEP 2: Review Extracted OCR Text & Prompt */}
        {(ocrText.length > 0 || rois.length > 0) && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              2. Study Prompt & Extracted Text
            </Text>

            <Text style={styles.fieldLabel}>Philosophy / Study Mode</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
            >
              {PRESETS.map((p) => {
                const active = selectedPreset === p.key;
                return (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => setSelectedPreset(p.key)}
                    style={[styles.presetChip, active && styles.presetChipActive]}
                  >
                    <Text
                      style={[
                        styles.presetChipText,
                        active && styles.presetChipTextActive
                      ]}
                    >
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.fieldLabel}>Optional Specific Question</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. What does Kant mean by categorical imperative here?"
              placeholderTextColor="#64748b"
              value={customQuestion}
              onChangeText={setCustomQuestion}
            />

            <Text style={styles.fieldLabel}>Extracted ROI Text (Editable)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              multiline
              placeholder="Run Local OCR above or type/paste text here..."
              placeholderTextColor="#64748b"
              value={ocrText}
              onChangeText={setOcrText}
            />

            <TouchableOpacity
              onPress={handleOpenLlmPopup}
              style={styles.successActionBtn}
            >
              <Text style={styles.primaryActionBtnText}>
                🚀 Copy to Clipboard & Choose LLM / Notebook...
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* STEP 3: Popup to Choose LLM / NotebookLM */}
      <LlmPopupModal
        visible={llmPopupVisible}
        onClose={() => setLlmPopupVisible(false)}
        links={links}
        promptText={buildFinalPrompt()}
        onOpenSettings={() => {
          setLlmPopupVisible(false);
          setSettingsVisible(true);
        }}
      />

      {/* Settings Modal (Links) */}
      <SettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        links={links}
        onChangeLinks={handleUpdateLinks}
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
  samplePageBtn: {
    marginTop: 10,
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center'
  },
  samplePageBtnText: {
    color: '#38bdf8',
    fontWeight: '700',
    fontSize: 13
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10
  },
  toolBtn: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
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
  toolBtnText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600'
  },
  toolBtnHighlightText: {
    color: '#6ee7b7',
    fontWeight: '700'
  },
  preprocessBanner: {
    marginTop: 12,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10
  },
  preprocessBannerActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.45)'
  },
  preprocessTitle: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700'
  },
  preprocessSub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2
  },
  preprocessBadge: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155'
  },
  preprocessBadgeActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981'
  },
  preprocessBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800'
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
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 8
  },
  previewScroll: {
    gap: 10
  },
  previewItem: {
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  previewImg: {
    width: 200,
    height: 110,
    backgroundColor: '#ffffff',
    borderRadius: 4
  },
  previewMeta: {
    color: '#94a3b8',
    fontSize: 10,
    marginTop: 4,
    fontWeight: '600'
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
  }
});

