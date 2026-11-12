import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Image,
  Text,
  StyleSheet,
  PanResponder,
  LayoutChangeEvent,
  TouchableOpacity,
  Alert
} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { CapturedPhoto, RoiBox } from '../types';
import { debugError } from '../debug/debugLog';

interface RoiSelectorProps {
  photo: CapturedPhoto;
  rois: RoiBox[];
  onAddRoi: (roi: RoiBox) => void;
  onChangeRoi: (id: string, patch: Partial<RoiBox>) => void;
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

interface NormGeom {
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  rotation: number;
}

type HandleKind = 'move' | 'rotate' | 'nw' | 'ne' | 'sw' | 'se';

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const MIN_BOX = 28;
const CORNERS: { kind: HandleKind; sx: number; sy: number }[] = [
  { kind: 'nw', sx: -1, sy: -1 },
  { kind: 'ne', sx: 1, sy: -1 },
  { kind: 'sw', sx: -1, sy: 1 },
  { kind: 'se', sx: 1, sy: 1 }
];

const clamp = (val: number, min: number, max: number) =>
  Math.max(min, Math.min(max, val));

const normAngle = (deg: number) => {
  const wrapped = (((deg + 180) % 360) + 360) % 360 - 180;
  return Math.abs(wrapped) < 0.05 ? 0 : wrapped;
};

const rotateLocal = (lx: number, ly: number, deg: number) => {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: lx * c - ly * s, y: lx * s + ly * c };
};

const worldToLocal = (
  px: number,
  py: number,
  cx: number,
  cy: number,
  deg: number
) => {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const dx = px - cx;
  const dy = py - cy;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
};

const boxOf = (roi: RoiBox, viewW: number, viewH: number) => {
  const w = roi.normW * viewW;
  const h = roi.normH * viewH;
  return {
    w,
    h,
    cx: (roi.normX + roi.normW / 2) * viewW,
    cy: (roi.normY + roi.normH / 2) * viewH,
    rot: roi.rotation || 0
  };
};

const fitBox = (
  cx: number,
  cy: number,
  w: number,
  h: number,
  rot: number,
  viewW: number,
  viewH: number
) => {
  let ww = clamp(w, MIN_BOX, Math.max(MIN_BOX, viewW));
  let hh = clamp(h, MIN_BOX, Math.max(MIN_BOX, viewH));
  const span = (bw: number, bh: number) => {
    const corners = [
      [-bw / 2, -bh / 2],
      [bw / 2, -bh / 2],
      [bw / 2, bh / 2],
      [-bw / 2, bh / 2]
    ].map(([lx, ly]) => rotateLocal(lx, ly, rot));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys)
    };
  };
  let bounds = span(ww, hh);
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  const fit = Math.min(1, viewW / Math.max(1, bw), viewH / Math.max(1, bh));
  ww *= fit;
  hh *= fit;
  bounds = span(ww, hh);
  const minCx = -bounds.minX;
  const maxCx = viewW - bounds.maxX;
  const minCy = -bounds.minY;
  const maxCy = viewH - bounds.maxY;
  return {
    cx: minCx <= maxCx ? clamp(cx, minCx, maxCx) : viewW / 2,
    cy: minCy <= maxCy ? clamp(cy, minCy, maxCy) : viewH / 2,
    w: ww,
    h: hh
  };
};

const toNorm = (
  cx: number,
  cy: number,
  w: number,
  h: number,
  rotation: number,
  viewW: number,
  viewH: number
): NormGeom => {
  const fitted = fitBox(cx, cy, w, h, rotation, viewW, viewH);
  const normW = fitted.w / viewW;
  const normH = fitted.h / viewH;
  return {
    normX: fitted.cx / viewW - normW / 2,
    normY: fitted.cy / viewH - normH / 2,
    normW,
    normH,
    rotation: normAngle(rotation)
  };
};

async function renderRoiCrop(
  photo: CapturedPhoto,
  geom: NormGeom
): Promise<{ uri: string; base64?: string } | null> {
  const imageW = photo.width;
  const imageH = photo.height;
  const boxW = Math.max(8, geom.normW * imageW);
  const boxH = Math.max(8, geom.normH * imageH);
  const cx = (geom.normX + geom.normW / 2) * imageW;
  const cy = (geom.normY + geom.normH / 2) * imageH;
  const rotation = geom.rotation || 0;
  const corners = [
    [-boxW / 2, -boxH / 2],
    [boxW / 2, -boxH / 2],
    [boxW / 2, boxH / 2],
    [-boxW / 2, boxH / 2]
  ].map(([lx, ly]) => {
    const point = rotateLocal(lx, ly, rotation);
    return { x: cx + point.x, y: cy + point.y };
  });
  const minX = clamp(Math.floor(Math.min(...corners.map((c) => c.x))), 0, imageW - 1);
  const minY = clamp(Math.floor(Math.min(...corners.map((c) => c.y))), 0, imageH - 1);
  const maxX = clamp(Math.ceil(Math.max(...corners.map((c) => c.x))), minX + 1, imageW);
  const maxY = clamp(Math.ceil(Math.max(...corners.map((c) => c.y))), minY + 1, imageH);
  const cropW = maxX - minX;
  const cropH = maxY - minY;
  const upright = Math.abs(rotation) < 0.8;
  const crop = { originX: minX, originY: minY, width: cropW, height: cropH };

  if (upright) {
    const actions: ImageManipulator.Action[] = [{ crop }];
    if (cropW > 2200) actions.push({ resize: { width: 2200 } });
    const cropped = await ImageManipulator.manipulateAsync(photo.uri, actions, {
      compress: 0.94,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true
    });
    return { uri: cropped.uri, base64: cropped.base64 };
  }

  const turned = await ImageManipulator.manipulateAsync(
    photo.uri,
    [{ crop }, { rotate: -rotation }],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
  );
  const angle = (-rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const offX = cx - (minX + cropW / 2);
  const offY = cy - (minY + cropH / 2);
  const roiCx = turned.width / 2 + (offX * cos - offY * sin);
  const roiCy = turned.height / 2 + (offX * sin + offY * cos);
  let originX = clamp(Math.round(roiCx - boxW / 2), 0, Math.max(0, turned.width - 1));
  let originY = clamp(Math.round(roiCy - boxH / 2), 0, Math.max(0, turned.height - 1));
  const width = clamp(Math.round(boxW), 1, turned.width - originX);
  const height = clamp(Math.round(boxH), 1, turned.height - originY);
  const finalActions: ImageManipulator.Action[] = [
    { crop: { originX, originY, width, height } }
  ];
  if (width > 2200) finalActions.push({ resize: { width: 2200 } });
  const finalCrop = await ImageManipulator.manipulateAsync(turned.uri, finalActions, {
    compress: 0.94,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true
  });
  return { uri: finalCrop.uri, base64: finalCrop.base64 };
}

export const RoiSelector: React.FC<RoiSelectorProps> = ({
  photo,
  rois,
  onAddRoi,
  onChangeRoi,
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const layoutRef = useRef<{ width: number; height: number }>({ width: 320, height: 400 });
  const scaleRef = useRef<number>(1);
  const txRef = useRef<number>(0);
  const tyRef = useRef<number>(0);
  const roisRef = useRef(rois);
  roisRef.current = rois;
  const selectedIdRef = useRef<string | null>(null);
  const photoRef = useRef(photo);
  photoRef.current = photo;
  const onAddRoiRef = useRef(onAddRoi);
  onAddRoiRef.current = onAddRoi;
  const onChangeRoiRef = useRef(onChangeRoi);
  onChangeRoiRef.current = onChangeRoi;
  const onDrawingChangeRef = useRef(onDrawingChange);
  onDrawingChangeRef.current = onDrawingChange;
  const liveEditRef = useRef<(NormGeom & { id: string }) | null>(null);
  const gestureRef = useRef<{
    mode: 'none' | 'draw' | 'pinch' | 'move' | 'resize' | 'rotate';
    token: number;
    dirty: boolean;
    roiId: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    cx: number;
    cy: number;
    w: number;
    h: number;
    rot: number;
    grabDx: number;
    grabDy: number;
    startRot: number;
    startPointer: number;
    startScale: number;
    startTx: number;
    startTy: number;
    startDist: number;
    startMidX: number;
    startMidY: number;
  }>({
    mode: 'none',
    token: 0,
    dirty: false,
    roiId: '',
    sx: 1,
    sy: 1,
    ox: 0,
    oy: 0,
    cx: 0,
    cy: 0,
    w: 0,
    h: 0,
    rot: 0,
    grabDx: 0,
    grabDy: 0,
    startRot: 0,
    startPointer: 0,
    startScale: 1,
    startTx: 0,
    startTy: 0,
    startDist: 1,
    startMidX: 0,
    startMidY: 0
  });

  const aspect = photo.height / Math.max(1, photo.width);
  const displayHeight = Math.min(480, Math.round(containerWidth * aspect));
  const displayWidth = Math.round(displayHeight / aspect);

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
      x: cx + (stageX - cx - txRef.current) / s,
      y: cy + (stageY - cy - tyRef.current) / s
    };
  };

  const commitGeom = (
    id: string,
    cx: number,
    cy: number,
    w: number,
    h: number,
    rotation: number
  ) => {
    const { width, height } = layoutRef.current;
    if (width <= 0 || height <= 0) return;
    const geom = toNorm(cx, cy, w, h, rotation, width, height);
    liveEditRef.current = { id, ...geom };
    gestureRef.current.dirty = true;
    onChangeRoiRef.current(id, geom);
  };

  const finishEdit = async (token: number) => {
    if (gestureRef.current.token !== token) return;
    const live = liveEditRef.current;
    const dirty = gestureRef.current.dirty;
    gestureRef.current.mode = 'none';
    gestureRef.current.dirty = false;
    const stillCurrent = () => gestureRef.current.token === token;
    if (!dirty || !live) {
      if (stillCurrent()) onDrawingChangeRef.current?.(false);
      return;
    }
    try {
      const cropped = await renderRoiCrop(photoRef.current, live);
      if (!cropped || !stillCurrent()) return;
      onChangeRoiRef.current(live.id, {
        croppedUri: cropped.uri,
        base64: cropped.base64
      });
    } catch (err) {
      if (!stillCurrent()) return;
      Alert.alert(
        'Region update failed',
        err instanceof Error ? err.message : 'Could not recrop the region.'
      );
    } finally {
      if (stillCurrent()) onDrawingChangeRef.current?.(false);
    }
  };

  useEffect(() => {
    scaleRef.current = 1;
    txRef.current = 0;
    tyRef.current = 0;
    setScale(1);
    setTx(0);
    setTy(0);
    setDraftBox(null);
    selectedIdRef.current = null;
    setSelectedId(null);
  }, [photo.uri]);

  useEffect(() => {
    if (rois.length === 0) {
      if (selectedIdRef.current !== null) {
        selectedIdRef.current = null;
        setSelectedId(null);
      }
      return;
    }
    if (!rois.some((roi) => roi.id === selectedIdRef.current)) {
      const next = rois[rois.length - 1].id;
      selectedIdRef.current = next;
      setSelectedId(next);
    }
  }, [rois]);

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
        g.token += 1;
        g.dirty = false;
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
        const point = stageToImage(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
        const { width, height } = layoutRef.current;
        const reach = 22 / Math.max(0.2, scaleRef.current);
        const selected = roisRef.current.find((roi) => roi.id === selectedIdRef.current);
        if (selected && width > 0) {
          const box = boxOf(selected, width, height);
          const local = worldToLocal(point.x, point.y, box.cx, box.cy, box.rot);
          const rotateY = -box.h / 2 - 18 / Math.max(0.2, scaleRef.current);
          if (Math.hypot(local.x, local.y - rotateY) <= reach) {
            g.mode = 'rotate';
            g.roiId = selected.id;
            g.cx = box.cx;
            g.cy = box.cy;
            g.w = box.w;
            g.h = box.h;
            g.startRot = box.rot;
            g.startPointer = Math.atan2(point.y - box.cy, point.x - box.cx);
            return;
          }
          for (const corner of CORNERS) {
            const hx = (corner.sx * box.w) / 2;
            const hy = (corner.sy * box.h) / 2;
            if (Math.hypot(local.x - hx, local.y - hy) <= reach) {
              g.mode = 'resize';
              g.roiId = selected.id;
              g.sx = corner.sx;
              g.sy = corner.sy;
              g.rot = box.rot;
              const opposite = rotateLocal((-corner.sx * box.w) / 2, (-corner.sy * box.h) / 2, box.rot);
              g.ox = box.cx + opposite.x;
              g.oy = box.cy + opposite.y;
              return;
            }
          }
        }
        const hit = [...roisRef.current].reverse().find((roi) => {
          const box = boxOf(roi, width, height);
          const local = worldToLocal(point.x, point.y, box.cx, box.cy, box.rot);
          return Math.abs(local.x) <= box.w / 2 && Math.abs(local.y) <= box.h / 2;
        });
        if (hit && width > 0) {
          const box = boxOf(hit, width, height);
          g.mode = 'move';
          g.roiId = hit.id;
          g.cx = box.cx;
          g.cy = box.cy;
          g.w = box.w;
          g.h = box.h;
          g.rot = box.rot;
          g.grabDx = point.x - box.cx;
          g.grabDy = point.y - box.cy;
          selectedIdRef.current = hit.id;
          setSelectedId(hit.id);
          return;
        }
        g.mode = 'draw';
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
        if (g.mode === 'move') {
          commitGeom(g.roiId, point.x - g.grabDx, point.y - g.grabDy, g.w, g.h, g.rot);
          return;
        }
        if (g.mode === 'rotate') {
          const pointer = Math.atan2(point.y - g.cy, point.x - g.cx);
          const next = g.startRot + ((pointer - g.startPointer) * 180) / Math.PI;
          commitGeom(g.roiId, g.cx, g.cy, g.w, g.h, next);
          return;
        }
        if (g.mode === 'resize') {
          const local = worldToLocal(point.x, point.y, g.ox, g.oy, g.rot);
          const newW = Math.max(MIN_BOX, local.x * g.sx);
          const newH = Math.max(MIN_BOX, local.y * g.sy);
          const mid = rotateLocal((g.sx * newW) / 2, (g.sy * newH) / 2, g.rot);
          commitGeom(g.roiId, g.ox + mid.x, g.oy + mid.y, newW, newH, g.rot);
          return;
        }
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
        setDraftBox(null);
        void finishEdit(gestureRef.current.token);
      },
      onPanResponderRelease: async (evt) => {
        const g = gestureRef.current;
        const token = g.token;
        if (g.mode === 'pinch' || g.mode === 'move' || g.mode === 'resize' || g.mode === 'rotate') {
          setDraftBox(null);
          await finishEdit(token);
          return;
        }
        g.mode = 'none';
        const { width, height } = layoutRef.current;
        const point = stageToImage(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
        const sx = startPosRef.current.x;
        const sy = startPosRef.current.y;
        const boxX = Math.min(sx, point.x);
        const boxY = Math.min(sy, point.y);
        const boxW = Math.abs(point.x - sx);
        const boxH = Math.abs(point.y - sy);
        setDraftBox(null);
        if (boxW < 18 || boxH < 18 || width <= 0 || height <= 0) {
          onDrawingChangeRef.current?.(false);
          return;
        }

        const geom = toNorm(boxX + boxW / 2, boxY + boxH / 2, boxW, boxH, 0, width, height);
        const currentPhoto = photoRef.current;
        const id = `roi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        try {
          const cropped = await renderRoiCrop(currentPhoto, geom);
          onAddRoiRef.current({
            id,
            ...geom,
            croppedUri: cropped?.uri || currentPhoto.uri,
            base64: cropped?.base64
          });
        } catch (err) {
          void debugError('photo', err, 'crop failed');
          onAddRoiRef.current({
            id,
            ...geom,
            croppedUri: currentPhoto.uri
          });
        } finally {
          if (gestureRef.current.token === token) onDrawingChangeRef.current?.(false);
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
  const mapLocal = (cx: number, cy: number, lx: number, ly: number, rot: number) => {
    const point = rotateLocal(lx, ly, rot);
    return mapPoint(cx + point.x, cy + point.y);
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

          {rois.map((roi) => {
            const left = roi.normX * viewW;
            const top = roi.normY * viewH;
            const selected = roi.id === selectedId;
            return (
              <View
                key={roi.id}
                style={[
                  styles.roiRect,
                  selected && styles.roiRectSelected,
                  {
                    left,
                    top,
                    width: roi.normW * viewW,
                    height: roi.normH * viewH,
                    transform: [{ rotate: `${roi.rotation || 0}deg` }]
                  }
                ]}
              />
            );
          })}
        </View>

        <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} />

        {rois.map((roi, idx) => {
          const box = boxOf(roi, viewW, viewH);
          const labelAt = mapLocal(box.cx, box.cy, -box.w / 2, -box.h / 2, box.rot);
          const selected = roi.id === selectedId;
          return (
            <View key={`chrome-${roi.id}`} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              <View
                pointerEvents="box-none"
                style={[styles.roiTag, { left: labelAt.x, top: Math.max(2, labelAt.y - 28) }]}
              >
                <View pointerEvents="none">
                  <Text style={styles.roiTagText}>#{idx + 1}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => onRemoveRoi(roi.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
                  style={styles.roiCloseBtn}
                >
                  <Text style={styles.roiCloseBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
              {selected && (
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  {CORNERS.map((cornerHandle) => {
                    const at = mapLocal(
                      box.cx,
                      box.cy,
                      (cornerHandle.sx * box.w) / 2,
                      (cornerHandle.sy * box.h) / 2,
                      box.rot
                    );
                    return (
                      <View
                        key={cornerHandle.kind}
                        style={[styles.resizeHandle, { left: at.x - 7, top: at.y - 7 }]}
                      />
                    );
                  })}
                  {(() => {
                    const gap = 18 / Math.max(0.2, scale);
                    const at = mapLocal(box.cx, box.cy, 0, -box.h / 2 - gap, box.rot);
                    return (
                      <View style={[styles.rotateHandle, { left: at.x - 13, top: at.y - 13 }]}>
                        <Text style={styles.rotateHandleText}>↻</Text>
                      </View>
                    );
                  })()}
                </View>
              )}
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
  roiRectSelected: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.16)'
  },
  roiTag: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingLeft: 6,
    paddingRight: 2,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4
  },
  roiTagText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700'
  },
  roiCloseBtn: {
    backgroundColor: '#ef4444',
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center'
  },
  roiCloseBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 13
  },
  resizeHandle: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#38bdf8'
  },
  rotateHandle: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0f172a',
    borderWidth: 2,
    borderColor: '#38bdf8',
    alignItems: 'center',
    justifyContent: 'center'
  },
  rotateHandleText: {
    color: '#7dd3fc',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 16
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
