import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Image,
  Text,
  TouchableOpacity,
  PanResponder,
  StyleSheet,
  LayoutChangeEvent
} from 'react-native';

export interface ZoomSlide {
  label: string;
  uri: string;
}

interface ZoomableImageModalProps {
  visible: boolean;
  title: string;
  slides: ZoomSlide[];
  initialIndex?: number;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;

export const ZoomableImageModal: React.FC<ZoomableImageModalProps> = ({
  visible,
  title,
  slides,
  initialIndex = 0,
  onClose
}) => {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const layoutRef = useRef({ width: 1, height: 1, pageX: 0, pageY: 0 });
  const stageRef = useRef<View>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const gestureRef = useRef({
    mode: 'none' as 'none' | 'pan' | 'pinch',
    startScale: 1,
    startTx: 0,
    startTy: 0,
    startDist: 1,
    startMidX: 0,
    startMidY: 0,
    panX: 0,
    panY: 0,
    moved: 0
  });
  const lastTapRef = useRef(0);

  const apply = (nextScale: number, nextTx: number, nextTy: number) => {
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
    const { width, height } = layoutRef.current;
    const maxX = ((s - 1) * width) / 2;
    const maxY = ((s - 1) * height) / 2;
    const x = s <= 1 ? 0 : Math.max(-maxX, Math.min(maxX, nextTx));
    const y = s <= 1 ? 0 : Math.max(-maxY, Math.min(maxY, nextTy));
    scaleRef.current = s;
    txRef.current = x;
    tyRef.current = y;
    setScale(s);
    setTx(x);
    setTy(y);
  };

  const resetView = () => apply(1, 0, 0);

  useEffect(() => {
    if (!visible) return;
    const safe = Math.max(0, Math.min(initialIndex, Math.max(0, slides.length - 1)));
    setIndex(safe);
    apply(1, 0, 0);
  }, [visible, initialIndex, slides.length]);

  const selectSlide = (next: number) => {
    setIndex(next);
    apply(1, 0, 0);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        const g = gestureRef.current;
        g.mode = 'none';
        g.moved = 0;
        g.startScale = scaleRef.current;
        g.startTx = txRef.current;
        g.startTy = tyRef.current;
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          g.mode = 'pinch';
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          g.startDist = Math.max(1, Math.hypot(dx, dy));
            g.startMidX =
              (touches[0].pageX + touches[1].pageX) / 2 - layoutRef.current.pageX;
            g.startMidY =
              (touches[0].pageY + touches[1].pageY) / 2 - layoutRef.current.pageY;
        } else if (touches.length === 1) {
          g.mode = 'pan';
          g.panX = touches[0].pageX;
          g.panY = touches[0].pageY;
        }
      },
      onPanResponderMove: (evt) => {
        const g = gestureRef.current;
        const touches = evt.nativeEvent.touches;
        const { width, height } = layoutRef.current;
        const cx = width / 2;
        const cy = height / 2;

        if (touches.length >= 2) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const midX =
            (touches[0].pageX + touches[1].pageX) / 2 - layoutRef.current.pageX;
          const midY =
            (touches[0].pageY + touches[1].pageY) / 2 - layoutRef.current.pageY;
          if (g.mode !== 'pinch') {
            g.mode = 'pinch';
            g.startScale = scaleRef.current;
            g.startTx = txRef.current;
            g.startTy = tyRef.current;
            g.startDist = dist;
            g.startMidX = midX;
            g.startMidY = midY;
          }
          const nextScale = g.startScale * (dist / g.startDist);
          const contentX = (g.startMidX - cx - g.startTx) / g.startScale;
          const contentY = (g.startMidY - cy - g.startTy) / g.startScale;
          const nextTx = midX - cx - contentX * nextScale;
          const nextTy = midY - cy - contentY * nextScale;
          g.moved = 40;
          apply(nextScale, nextTx, nextTy);
          return;
        }

        if (touches.length === 1) {
          if (g.mode !== 'pan') {
            g.mode = 'pan';
            g.startTx = txRef.current;
            g.startTy = tyRef.current;
            g.panX = touches[0].pageX;
            g.panY = touches[0].pageY;
          }
          const movedX = touches[0].pageX - g.panX;
          const movedY = touches[0].pageY - g.panY;
          g.moved = Math.max(g.moved, Math.hypot(movedX, movedY));
          if (scaleRef.current > 1) {
            apply(scaleRef.current, g.startTx + movedX, g.startTy + movedY);
          }
        }
      },
      onPanResponderRelease: () => {
        const g = gestureRef.current;
        if (g.moved < 12 && g.mode !== 'pinch') {
          const now = Date.now();
          if (now - lastTapRef.current < 280) {
            if (scaleRef.current > 1.05) apply(1, 0, 0);
            else apply(3, 0, 0);
            lastTapRef.current = 0;
          } else {
            lastTapRef.current = now;
          }
        }
        g.mode = 'none';
      }
    })
  ).current;

  const rememberStage = () => {
    stageRef.current?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      layoutRef.current = { width, height, pageX: x, pageY: y };
      setStageSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height }
      );
    });
  };

  const onStageLayout = (e: LayoutChangeEvent) => {
    layoutRef.current = {
      ...layoutRef.current,
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height
    };
    rememberStage();
  };

  const slide = slides[index];
  if (!visible || !slide) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>
              {slide.label} · {Math.round(scale * 100)}%
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>

        {slides.length > 1 && (
          <View style={styles.chips}>
            {slides.map((item, i) => {
              const active = i === index;
              return (
                <TouchableOpacity
                  key={`${item.label}-${i}`}
                  onPress={() => selectSlide(i)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View
          ref={stageRef}
          style={styles.stage}
          onLayout={onStageLayout}
          {...panResponder.panHandlers}
        >
          <Image
            source={{ uri: slide.uri }}
            style={{
              width: stageSize.width || '100%',
              height: stageSize.height || '100%',
              transform: [{ translateX: tx }, { translateY: ty }, { scale }]
            }}
            resizeMode="contain"
          />
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            onPress={() => apply(scaleRef.current / 1.5, txRef.current, tyRef.current)}
            style={styles.zoomBtn}
          >
            <Text style={styles.zoomBtnText}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={resetView} style={styles.zoomBtn}>
            <Text style={styles.zoomBtnText}>Fit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => apply(scaleRef.current * 1.5, txRef.current, tyRef.current)}
            style={styles.zoomBtn}
          >
            <Text style={styles.zoomBtnText}>+</Text>
          </TouchableOpacity>
          <Text style={styles.hint}>Pinch or double-tap, then drag</Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#020617',
    paddingTop: 36
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 12
  },
  title: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700'
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2
  },
  closeBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  closeText: {
    color: '#e2e8f0',
    fontWeight: '700'
  },
  chips: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8
  },
  chip: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  chipActive: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1'
  },
  chipText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700'
  },
  chipTextActive: {
    color: '#ffffff'
  },
  stage: {
    flex: 1,
    backgroundColor: '#0f172a',
    overflow: 'hidden'
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  zoomBtn: {
    minWidth: 48,
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  zoomBtnText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800'
  },
  hint: {
    flex: 1,
    color: '#94a3b8',
    fontSize: 12
  }
});
