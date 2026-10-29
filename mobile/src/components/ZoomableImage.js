import React, { useMemo, useRef } from 'react';
import { Animated, Image, PanResponder, View } from 'react-native';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 280;

const distance = (touches) => Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);

/*
 * A photo you can zoom: pinch with two fingers (1x to 4x), drag with one finger while zoomed (kept
 * inside the photo's edges), double-tap to zoom in on that spot or back out. Built on PanResponder, so
 * it needs no extra native library. Pinching below 1x springs back.
 */
export default function ZoomableImage({ uri, style, testID }) {
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const s = useRef({ scale: 1, x: 0, y: 0, w: 0, h: 0, pinchFrom: 0, scaleFrom: 1, xFrom: 0, yFrom: 0, dxFrom: 0, dyFrom: 0, touches: 0, lastTap: 0 }).current;

  // keeps the zoomed photo covering its frame: no empty space can be dragged into view
  const clamp = (x, y, k) => {
    const maxX = (s.w * (k - 1)) / 2;
    const maxY = (s.h * (k - 1)) / 2;
    return [Math.max(-maxX, Math.min(maxX, x)), Math.max(-maxY, Math.min(maxY, y))];
  };
  const animateTo = (k, x, y) => {
    s.scale = k; s.x = x; s.y = y;
    Animated.parallel([
      Animated.spring(scale, { toValue: k, useNativeDriver: true, bounciness: 4 }),
      Animated.spring(tx, { toValue: x, useNativeDriver: true, bounciness: 4 }),
      Animated.spring(ty, { toValue: y, useNativeDriver: true, bounciness: 4 }),
    ]).start();
  };
  // a new finger count starts a new baseline, so going from two fingers to one does not jump
  const baseline = (touches, g) => {
    s.touches = touches.length;
    s.scaleFrom = s.scale; s.xFrom = s.x; s.yFrom = s.y; s.dxFrom = g.dx; s.dyFrom = g.dy;
    s.pinchFrom = touches.length === 2 ? distance(touches) : 0;
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e, g) => {
      baseline(e.nativeEvent.touches, g);
      if (e.nativeEvent.touches.length !== 1) return;
      const now = Date.now();
      if (now - s.lastTap < DOUBLE_TAP_MS) {
        s.lastTap = 0;
        if (s.scale > 1) animateTo(1, 0, 0);
        else {
          // zoom in on the tapped spot: move it towards the centre
          const { locationX, locationY } = e.nativeEvent;
          const [x, y] = clamp((s.w / 2 - locationX) * (DOUBLE_TAP_SCALE - 1), (s.h / 2 - locationY) * (DOUBLE_TAP_SCALE - 1), DOUBLE_TAP_SCALE);
          animateTo(DOUBLE_TAP_SCALE, x, y);
        }
      } else s.lastTap = now;
    },
    onPanResponderMove: (e, g) => {
      const touches = e.nativeEvent.touches;
      if (touches.length !== s.touches) baseline(touches, g);
      if (touches.length >= 2 && s.pinchFrom) {
        const k = Math.max(0.8, Math.min(MAX_SCALE, (s.scaleFrom * distance(touches)) / s.pinchFrom));
        const [x, y] = clamp(s.xFrom, s.yFrom, Math.max(1, k));
        s.scale = k; s.x = x; s.y = y;
        scale.setValue(k); tx.setValue(x); ty.setValue(y);
      } else if (touches.length === 1 && s.scale > 1) {
        const [x, y] = clamp(s.xFrom + g.dx - s.dxFrom, s.yFrom + g.dy - s.dyFrom, s.scale);
        s.x = x; s.y = y;
        tx.setValue(x); ty.setValue(y);
      }
    },
    onPanResponderRelease: () => {
      s.touches = 0;
      if (s.scale < 1) animateTo(1, 0, 0);
    },
  }), []);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[{ overflow: 'hidden' }, style]} onLayout={(e) => { s.w = e.nativeEvent.layout.width; s.h = e.nativeEvent.layout.height; }}
      {...responder.panHandlers} accessibilityHint="Pinch or double-tap to zoom" testID={testID}>
      <Animated.View style={{ flex: 1, transform: [{ translateX: tx }, { translateY: ty }, { scale }] }}>
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
      </Animated.View>
    </View>
  );
}
