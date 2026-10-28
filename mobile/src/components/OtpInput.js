import React, { useEffect, useRef } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

/*
 * Six single-digit boxes. Typing moves forward, backspace moves back, and a pasted or autofilled
 * code spreads across the boxes. value is the joined string the parent keeps.
 */
export default function OtpInput({ value = '', onChange, length = 6, disabled = false, autoFocus = true, label = 'Verification code' }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const refs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || '');

  useEffect(() => { if (autoFocus) setTimeout(() => refs.current[0]?.focus(), 50); }, [autoFocus]);

  const commit = (next) => onChange(next.join('').slice(0, length));

  const onChangeText = (i, text) => {
    const clean = text.replace(/\D/g, '');
    const next = [...digits];
    if (!clean) { next[i] = ''; commit(next); return; }
    clean.split('').slice(0, length - i).forEach((d, k) => { next[i + k] = d; });
    commit(next);
    refs.current[Math.min(i + clean.length, length - 1)]?.focus();
  };

  const onKeyPress = (i, e) => {
    if (e.nativeEvent.key !== 'Backspace') return;
    const next = [...digits];
    if (next[i]) { next[i] = ''; commit(next); return; }
    if (i > 0) { next[i - 1] = ''; commit(next); refs.current[i - 1]?.focus(); }
  };

  return (
    <View style={{ marginBottom: theme.space.lg }}>
      {label ? <Text style={{ fontSize: theme.font.sm, fontWeight: '600', color: c.textMuted, marginBottom: theme.space.sm }}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.sm }}>
        {digits.map((d, i) => (
          <TextInput
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            value={d}
            onChangeText={(t) => onChangeText(i, t)}
            onKeyPress={(e) => onKeyPress(i, e)}
            onFocus={() => refs.current[i]?.setNativeProps?.({ selection: { start: 0, end: 1 } })}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={length}
            editable={!disabled}
            textContentType={i === 0 ? 'oneTimeCode' : 'none'}
            autoComplete={i === 0 ? 'sms-otp' : 'off'}
            accessibilityLabel={`Digit ${i + 1} of ${length}`}
            testID={`otp-${i}`}
            style={[{
              flex: 1, height: 56, borderRadius: theme.radius.md, borderWidth: 1, borderColor: d ? c.accent : c.border,
              backgroundColor: c.inputBackground, textAlign: 'center', fontSize: 24, fontWeight: '600', color: c.text,
              opacity: disabled ? 0.6 : 1,
            }]}
          />
        ))}
      </View>
    </View>
  );
}
