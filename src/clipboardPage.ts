import { NativeModules, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import { RoiBox } from './types';

export type PagePaste = 'together' | 'image-first';

type RichClipboardNative = {
  setImageThenText: (images: string[], text: string) => Promise<boolean>;
  shareImageThenText: (images: string[], text: string) => Promise<boolean>;
};

function richClipboard(): RichClipboardNative | null {
  const native = NativeModules.RichClipboard as RichClipboardNative | undefined;
  if (Platform.OS !== 'android' || !native?.setImageThenText) return null;
  return native;
}

function stripBase64(value: string): string {
  const clean = value.includes(',') ? value.split(',')[1] : value;
  return clean.replace(/\s/g, '');
}

export async function loadRoiImages(rois: RoiBox[]): Promise<string[]> {
  const images: string[] = [];
  for (const roi of rois) {
    if (roi.base64) {
      const clean = stripBase64(roi.base64);
      if (clean) images.push(clean);
      continue;
    }
    const uri = roi.croppedUri;
    if (!uri) continue;
    if (uri.startsWith('data:')) {
      const clean = stripBase64(uri);
      if (clean) images.push(clean);
      continue;
    }
    const file = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64
    });
    if (file) images.push(file);
  }
  return images;
}

/**
 * Puts the cropped page on the clipboard, then the prompt.
 * A rebuilt Android app stores both in one clip. Otherwise the image
 * is copied alone, and the prompt is copied by the next tap.
 */
export async function copyImageThenText(
  images: string[],
  text: string,
  stitch: (images: string[]) => Promise<string>
): Promise<PagePaste> {
  if (images.length === 0) {
    throw new Error('No cropped image to copy.');
  }
  const native = richClipboard();
  if (native) {
    try {
      await native.setImageThenText(images, text);
      return 'together';
    } catch {
      // The binary may be older than this JS. Fall through to the image.
    }
  }
  let one = images[0];
  if (images.length > 1) {
    try {
      one = await stitch(images);
    } catch {
      one = images[0];
    }
  }
  await Clipboard.setImageAsync(one);
  return 'image-first';
}

/** Shares the cropped page and the prompt. Returns false when the binary cannot. */
export async function shareImageWithText(
  images: string[],
  text: string
): Promise<boolean> {
  const native = richClipboard();
  if (!native?.shareImageThenText || images.length === 0) return false;
  await native.shareImageThenText(images, text);
  return true;
}
