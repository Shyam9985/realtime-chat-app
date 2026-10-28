import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { birthDateLabel, fromDateValue, toDateValue } from '../utils/chatFormat';

/*
 * A date picked from the phone's calendar, looking like the other form
 * fields. value / onChange use 'YYYY-MM-DD' text, the day as the phone shows it, so no time zone can
 * move it. Used for the date of birth; `initial` is where the calendar opens when there is no value yet.
 */
export default function DateField({ label, value, onChange, error, placeholder = 'Choose a date', maximumDate, minimumDate, initial, testID }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [iosOpen, setIosOpen] = useState(false);
  const current = fromDateValue(value) || initial || new Date();

  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current, mode: 'date', maximumDate, minimumDate,
        onChange: (event, date) => { if (event.type === 'set' && date) onChange(toDateValue(date)); },
      });
    } else {
      setIosOpen((o) => !o);
    }
  };

  const box = { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, backgroundColor: c.inputBackground, borderWidth: 1, borderColor: error ? c.danger : c.border, borderRadius: theme.radius.md, paddingHorizontal: theme.space.md };

  return (
    <View style={{ marginBottom: theme.space.lg }}>
      {label ? <Text style={{ fontSize: theme.font.sm, fontWeight: '600', color: c.textMuted, marginBottom: theme.space.xs }}>{label}</Text> : null}
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${label || 'Date'}: ${value ? birthDateLabel(value) : 'not chosen'}`} testID={testID}
        style={({ pressed }) => [box, { paddingVertical: 12, opacity: pressed ? 0.85 : 1 }]}>
        <Ionicons name="calendar-outline" size={18} color={c.textMuted} />
        <Text style={{ flex: 1, fontSize: theme.font.md, color: value ? c.text : c.placeholder }}>{value ? birthDateLabel(value) : placeholder}</Text>
        <Ionicons name="chevron-down" size={16} color={c.textMuted} />
      </Pressable>
      {Platform.OS === 'ios' && iosOpen ? (
        <DateTimePicker value={current} mode="date" display="spinner" maximumDate={maximumDate} minimumDate={minimumDate}
          onChange={(_, date) => { if (date) onChange(toDateValue(date)); }} />
      ) : null}
      {error ? <Text style={{ color: c.danger, fontSize: theme.font.xs, marginTop: theme.space.xs }}>{error}</Text> : null}
    </View>
  );
}
