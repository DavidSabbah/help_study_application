import React, { useRef, useState } from 'react';
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
}

interface DraftBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const RoiSelector: React.FC<RoiSelectorProps> = ({
  photo,
  rois,
  onAddRoi,
  onRemoveRoi,
  onDrawingChange
}) => {
  const [containerWidth, setContainerWidth] = useState<number>(320);
  const [draftBox, setDraftBox] = useState<DraftBox | null>(null);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const layoutRef = useRef<{ width: number; height: number }>({ width: 320, height: 400 });
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

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt) => {
        onDrawingChangeRef.current?.(true);
        const { locationX, locationY } = evt.nativeEvent;
        const { width, height } = layoutRef.current;
        const sx = clamp(locationX, 0, width);
        const sy = clamp(locationY, 0, height);
        startPosRef.current = { x: sx, y: sy };
        setDraftBox({ x: sx, y: sy, w: 0, h: 0 });
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const { width, height } = layoutRef.current;
        const cx = clamp(locationX, 0, width);
        const cy = clamp(locationY, 0, height);
        const sx = startPosRef.current.x;
        const sy = startPosRef.current.y;

        setDraftBox({
          x: Math.min(sx, cx),
          y: Math.min(sy, cy),
          w: Math.abs(cx - sx),
          h: Math.abs(cy - sy)
        });
      },
      onPanResponderTerminate: () => {
        onDrawingChangeRef.current?.(false);
        setDraftBox(null);
      },
      onPanResponderRelease: async (evt) => {
        onDrawingChangeRef.current?.(false);
        const { locationX, locationY } = evt.nativeEvent;
        const { width, height } = layoutRef.current;
        const cx = clamp(locationX, 0, width);
        const cy = clamp(locationY, 0, height);
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
    layoutRef.current = {
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height
    };
  };

  return (
    <View onLayout={handleOuterLayout} style={styles.wrapper}>
      <View
        style={[styles.imageStage, { width: displayWidth, height: displayHeight }]}
        onLayout={handleImageWrapperLayout}
      >
        <Image
          source={{ uri: photo.uri }}
          style={{ width: displayWidth, height: displayHeight }}
          resizeMode="contain"
        />

        {/* Touch surface for drawing ROI boxes */}
        <View
          style={StyleSheet.absoluteFill}
          {...panResponder.panHandlers}
        />

        {/* Render active finger drag rectangle */}
        {draftBox && draftBox.w > 4 && draftBox.h > 4 && (
          <View
            pointerEvents="none"
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

        {/* Render existing ROI boxes with on-image delete button */}
        {rois.map((r, idx) => {
          const left = r.normX * displayWidth;
          const top = r.normY * displayHeight;
          const width = r.normW * displayWidth;
          const height = r.normH * displayHeight;
          const badgeInside = top < 24;

          return (
            <View
              key={r.id}
              pointerEvents="box-none"
              style={[
                styles.roiRect,
                {
                  left,
                  top,
                  width,
                  height
                }
              ]}
            >
              <View
                pointerEvents="box-none"
                style={[
                  styles.roiHeaderBar,
                  badgeInside ? { top: 2 } : { top: -24 }
                ]}
              >
                <View pointerEvents="none" style={styles.roiTag}>
                  <Text style={styles.roiTagText}>#{idx + 1}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => onRemoveRoi(r.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.roiCloseBtn}
                >
                  <Text style={styles.roiCloseBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.hintBanner}>
        <Text style={styles.hintText}>
          👆 Drag your finger over the photo to draw ROI boxes around text or exercises
        </Text>
        <Text style={styles.countText}>{rois.length} ROI(s)</Text>
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
    borderWidth: 1,
    borderColor: '#334155',
    position: 'relative'
  },
  roiRect: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: '#6366f1',
    backgroundColor: 'rgba(99, 102, 241, 0.16)'
  },
  roiHeaderBar: {
    position: 'absolute',
    left: -2,
    right: -2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  roiTag: {
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
  hintBanner: {
    marginTop: 10,
    width: '100%',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  hintText: {
    color: '#bae6fd',
    fontSize: 12,
    flex: 1,
    marginRight: 8
  },
  countText: {
    color: '#38bdf8',
    fontWeight: '700',
    fontSize: 12
  }
});

