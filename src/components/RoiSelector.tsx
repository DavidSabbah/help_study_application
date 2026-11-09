import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Image,
  Text,
  StyleSheet,
  PanResponder,
  LayoutChangeEvent,
  TouchableOpacity
} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { CapturedPhoto, RoiBox } from '../types';

interface RoiSelectorProps {
  photo: CapturedPhoto;
  rois: RoiBox[];
  onAddRoi: (roi: RoiBox) => void;
  onRemoveRoi: (id: string) => void;
  onDrawingChange?: (isDrawing: boolean) => void;
  onClean?: () => void;
  cleanBusy?: boolean;
  cleaned?: boolean;
}

interface DraftBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;

export const RoiSelector: React.FC<RoiSelectorProps> = ({
  photo,
  rois,
  onAddRoi,
  onRemoveRoi,
  onDrawingChange,
  onClean,
  cleanBusy = false,
  cleaned = false
}) => {
  const [containerWidth, setContainerWidth] = useState<number>(320);
  const [draftBox, setDraftBox] = useState<DraftBox | null>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0
  });
  const [scale, setScale] = useState<number>(1);
  const [tx, setTx] = useState<number>(0);
  const [ty, setTy] = useState<number>(0);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const layoutRef = useRef<{ width: number; height: number }>({ width: 320, height: 400 });
  const scaleRef = useRef<number>(1);
  const txRef = useRef<number>(0);
  const tyRef = useRef<number>(0);
  const gestureRef = useRef<{
    mode: 'none' | 'draw' | 'pinch';
    startScale: number;
    startTx: number;
    startTy: number;
    startDist: number;
    startMidX: number;
    startMidY: number;
  }>({
    mode: 'none',
    startScale: 1,
    startTx: 0,
    startTy: 0,
    startDist: 1,
    startMidX: 0,
    startMidY: 0
  });
  const photoRef = useRef<CapturedPhoto>(photo);
  photoRef.current = photo;
  const onAddRoiRef = useRef(onAddRoi);
  onAddRoiRef.current = onAddRoi;
  const onDrawingChangeRef = useRef(onDrawingChange);
  onDrawingChangeRef.current = onDrawingChange;

  const aspect = photo.height / Math.max(1, photo.width);
  const displayHeight = Math.min(480, Math.round(containerWidth * aspect));
  const displayWidth = Math.round(displayHeight / aspect);

  const clamp = (val: number, min: number, max: number) =>
    Math.max(min, Math.min(max, val));

  const applyView = (nextScale: number, nextTx: number, nextTy: number) => {
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

  const stageToImage = (stageX: number, stageY: number) => {
    const { width, height } = layoutRef.current;
    const cx = width / 2;
    const cy = height / 2;
    const s = Math.max(0.01, scaleRef.current);
    return {
      x: clamp(cx + (stageX - cx - txRef.current) / s, 0, width),
      y: clamp(cy + (stageY - cy - tyRef.current) / s, 0, height)
    };
  };

  useEffect(() => {
    scaleRef.current = 1;
    txRef.current = 0;
    tyRef.current = 0;
    setScale(1);
    setTx(0);
    setTy(0);
    setDraftBox(null);
  }, [photo.uri]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt) => {
        onDrawingChangeRef.current?.(true);
        const touches = evt.nativeEvent.touches;
        const g = gestureRef.current;
        if (touches.length >= 2) {
          g.mode = 'pinch';
          g.startScale = scaleRef.current;
          g.startTx = txRef.current;
          g.startTy = tyRef.current;
          const dx = touches[0].locationX - touches[1].locationX;
          const dy = touches[0].locationY - touches[1].locationY;
          g.startDist = Math.max(1, Math.hypot(dx, dy));
          g.startMidX = (touches[0].locationX + touches[1].locationX) / 2;
          g.startMidY = (touches[0].locationY + touches[1].locationY) / 2;
          setDraftBox(null);
          return;
        }
        g.mode = 'draw';
        const point = stageToImage(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
        startPosRef.current = point;
        setDraftBox({ x: point.x, y: point.y, w: 0, h: 0 });
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        const g = gestureRef.current;
        if (touches.length >= 2) {
          const dx = touches[0].locationX - touches[1].locationX;
          const dy = touches[0].locationY - touches[1].locationY;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const midX = (touches[0].locationX + touches[1].locationX) / 2;
          const midY = (touches[0].locationY + touches[1].locationY) / 2;
          const { width, height } = layoutRef.current;
          const cx = width / 2;
          const cy = height / 2;
          if (g.mode !== 'pinch') {
            g.mode = 'pinch';
            g.startScale = scaleRef.current;
            g.startTx = txRef.current;
            g.startTy = tyRef.current;
            g.startDist = dist;
            g.startMidX = midX;
            g.startMidY = midY;
            setDraftBox(null);
          }
          const nextScale = g.startScale * (dist / g.startDist);
          const contentX = (g.startMidX - cx - g.startTx) / g.startScale;
          const contentY = (g.startMidY - cy - g.startTy) / g.startScale;
          applyView(
            nextScale,
            midX - cx - contentX * nextScale,
            midY - cy - contentY * nextScale
          );
          return;
        }
        if (g.mode === 'pinch') return;
        const point = stageToImage(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
        const sx = startPosRef.current.x;
        const sy = startPosRef.current.y;
        setDraftBox({
          x: Math.min(sx, point.x),
          y: Math.min(sy, point.y),
          w: Math.abs(point.x - sx),
          h: Math.abs(point.y - sy)
        });
      },
      onPanResponderTerminate: () => {
        gestureRef.current.mode = 'none';
        onDrawingChangeRef.current?.(false);
        setDraftBox(null);
      },
      onPanResponderRelease: async (evt) => {
        onDrawingChangeRef.current?.(false);
        const wasPinch = gestureRef.current.mode === 'pinch';
        gestureRef.current.mode = 'none';
        if (wasPinch) {
          setDraftBox(null);
          return;
        }
        const { width, height } = layoutRef.current;
        const point = stageToImage(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
        const cx = point.x;
        const cy = point.y;
        const sx = startPosRef.current.x;
        const sy = startPosRef.current.y;

        const boxX = Math.min(sx, cx);
        const boxY = Math.min(sy, cy);
        const boxW = Math.abs(cx - sx);
        const boxH = Math.abs(cy - sy);

        setDraftBox(null);

        if (boxW < 18 || boxH < 18 || width <= 0 || height <= 0) {
          return;
        }

        const normX = clamp(boxX / width, 0, 1);
        const normY = clamp(boxY / height, 0, 1);
        const normW = clamp(boxW / width, 0.02, 1 - normX);
        const normH = clamp(boxH / height, 0.02, 1 - normY);

        const currentPhoto = photoRef.current;
        try {
          const originX = Math.round(normX * currentPhoto.width);
          const originY = Math.round(normY * currentPhoto.height);
          const cropWidth = Math.max(10, Math.round(normW * currentPhoto.width));
          const cropHeight = Math.max(10, Math.round(normH * currentPhoto.height));
          const safeCropW = Math.min(cropWidth, currentPhoto.width - originX);
          const safeCropH = Math.min(cropHeight, currentPhoto.height - originY);

          const actions: ImageManipulator.Action[] = [
            {
              crop: {
                originX,
                originY,
                width: safeCropW,
                height: safeCropH
              }
            }
          ];
          if (safeCropW > 2200) {
            actions.push({ resize: { width: 2200 } });
          }

          const cropped = await ImageManipulator.manipulateAsync(
            currentPhoto.uri,
            actions,
            { compress: 0.94, format: ImageManipulator.SaveFormat.JPEG, base64: true }
          );

          onAddRoiRef.current({
            id: `roi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            normX,
            normY,
            normW,
            normH,
            croppedUri: cropped.uri,
            base64: cropped.base64
          });
        } catch {
          // Fallback if manipulation fails
          onAddRoiRef.current({
            id: `roi-${Date.now()}`,
            normX,
            normY,
            normW,
            normH,
            croppedUri: currentPhoto.uri
          });
        }
      }
    })
  ).current;

  const handleOuterLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setContainerWidth(w);
  };

  const handleImageWrapperLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    const height = e.nativeEvent.layout.height;
    layoutRef.current = { width, height };
    setStageSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height }
    );
  };

  const viewW = stageSize.width || displayWidth;
  const viewH = stageSize.height || displayHeight;
  const mapPoint = (x: number, y: number) => {
    const cx = viewW / 2;
    const cy = viewH / 2;
    return {
      x: cx + tx + (x - cx) * scale,
      y: cy + ty + (y - cy) * scale
    };
  };

  return (
    <View onLayout={handleOuterLayout} style={styles.wrapper}>
      <View style={[styles.imageStage, { width: displayWidth, height: displayHeight }]}>
        <View
          pointerEvents="none"
          onLayout={handleImageWrapperLayout}
          style={[
            styles.zoomLayer,
            { transform: [{ translateX: tx }, { translateY: ty }, { scale }] }
          ]}
        >
          <Image
            source={{ uri: photo.uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
          />

          {draftBox && draftBox.w > 4 && draftBox.h > 4 && (
            <View
              style={[
                styles.draftRect,
                {
                  left: draftBox.x,
                  top: draftBox.y,
                  width: draftBox.w,
                  height: draftBox.h
                }
              ]}
            />
          )}

          {rois.map((r) => (
            <View
              key={r.id}
              style={[
                styles.roiRect,
                {
                  left: r.normX * viewW,
                  top: r.normY * viewH,
                  width: r.normW * viewW,
                  height: r.normH * viewH
                }
              ]}
            />
          ))}
        </View>

        <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} />

        {rois.map((r, idx) => {
          const left = r.normX * viewW;
          const top = r.normY * viewH;
          const corner = mapPoint(left + r.normW * viewW, top);
          const labelAt = mapPoint(left, top);
          return (
            <View key={`chrome-${r.id}`} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              <View
                pointerEvents="none"
                style={[styles.roiTag, { left: labelAt.x, top: Math.max(2, labelAt.y - 18) }]}
              >
                <Text style={styles.roiTagText}>#{idx + 1}</Text>
              </View>
              <TouchableOpacity
                onPress={() => onRemoveRoi(r.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={[
                  styles.roiCloseBtn,
                  { left: corner.x - 18, top: Math.max(2, corner.y - 10) }
                ]}
              >
                <Text style={styles.roiCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        {onClean && (
          <TouchableOpacity
            onPress={onClean}
            disabled={cleanBusy}
            style={[styles.cleanBtn, cleaned && styles.cleanBtnRevert, cleanBusy && styles.cleanBtnBusy]}
          >
            <Text style={styles.cleanBtnText}>
              {cleanBusy ? '…' : cleaned ? 'Original' : 'Clean'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    width: '100%'
  },
  imageStage: {
    backgroundColor: '#090d16',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative'
  },
  zoomLayer: {
    ...StyleSheet.absoluteFillObject
  },
  roiRect: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: '#6366f1',
    backgroundColor: 'rgba(99, 102, 241, 0.16)'
  },
  roiTag: {
    position: 'absolute',
    backgroundColor: '#6366f1',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  roiTagText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700'
  },
  roiCloseBtn: {
    position: 'absolute',
    backgroundColor: '#ef4444',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#ffffff'
  },
  roiCloseBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 13
  },
  draftRect: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#38bdf8',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(56, 189, 248, 0.2)'
  },
  cleanBtn: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.92)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  cleanBtnRevert: {
    backgroundColor: 'rgba(245, 158, 11, 0.94)'
  },
  cleanBtnBusy: {
    opacity: 0.6
  },
  cleanBtnText: {
    color: '#042f2e',
    fontSize: 12,
    fontWeight: '800'
  }
});

