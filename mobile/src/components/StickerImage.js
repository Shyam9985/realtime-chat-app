import React from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../theme/ThemeContext';
import { useStickerUri } from '../services/stickers.service';

// one sticker, by id: a soft square while the image downloads, then the image (animated WebP plays)
export function StickerImage({ stickerId, size = 72, style, onPress, onLongPress, accessibilityLabel = 'Sticker', testID }) {
  const { theme } = useTheme();
  const uri = useStickerUri(stickerId);
  const box = { width: size, height: size };
  const body = uri
    ? <Image source={{ uri }} style={box} contentFit="contain" autoplay accessibilityIgnoresInvertColors accessibilityLabel={accessibilityLabel} />
    : <View style={[box, { borderRadius: 12, backgroundColor: theme.colors.surface, opacity: 0.6 }]} />;
  if (!onPress && !onLongPress) return <View style={style} testID={testID}>{body}</View>;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={300} accessibilityRole="button" accessibilityLabel={accessibilityLabel} testID={testID}
      style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }, style]}>
      {body}
    </Pressable>
  );
}
