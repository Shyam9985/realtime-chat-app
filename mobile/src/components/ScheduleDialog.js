import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { Dialog } from './ui';
import { timeOf, dayLabel } from '../utils/chatFormat';

const MIN_LEAD_MS = 60 * 1000;

// a sensible first suggestion: the next full hour, at least ten minutes away
const nextSlot = () => {
  const d = new Date(Date.now() + 10 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
};

const at = (dayOffset, hours) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(hours, 0, 0, 0); return d; };

/*
 * Pick the date and time a message goes out. Quick picks for the common cases, then the phone's own
 * date and time pickers (a datetime field on the web). The chosen moment is the phone's local time;
 * it is sent to the server as an ISO timestamp, so it means the same instant everywhere.
 */
export default function ScheduleDialog({ visible, initial, title = 'Schedule message', confirmLabel = 'Schedule', onConfirm, onClose }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [when, setWhen] = useState(initial || nextSlot());
  const [iosMode, setIosMode] = useState(null);   // 'date' | 'time' while the inline iOS picker is open
  useEffect(() => { if (visible) { setWhen(initial ? new Date(initial) : nextSlot()); setIosMode(null); } }, [visible, initial]);

  const tooSoon = when.getTime() - Date.now() < MIN_LEAD_MS;

  const pick = (mode) => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: when, mode, is24Hour: true, minimumDate: new Date(),
        onChange: (event, date) => { if (event.type === 'set' && date) setWhen(date); },
      });
    } else {
      setIosMode(mode);
    }
  };

  const quick = [
    { label: 'In 1 hour', date: () => new Date(Date.now() + 60 * 60 * 1000) },
    { label: 'Tonight, 8 PM', date: () => at(new Date().getHours() >= 19 ? 1 : 0, 20) },
    { label: 'Tomorrow, 9 AM', date: () => at(1, 9) },
  ];

  const Chip = ({ label, onPress, icon, testID }) => (
    <Pressable onPress={onPress} accessibilityRole="button" testID={testID}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: pressed ? c.surfaceAlt : 'transparent' })}>
      {icon ? <Ionicons name={icon} size={16} color={c.accent} /> : null}
      <Text style={{ color: c.text, fontSize: theme.font.sm, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );

  return (
    <Dialog visible={visible} icon="time-outline" title={title} onClose={onClose}
      actions={[{ label: 'Cancel' }, { label: confirmLabel, style: 'primary', testID: 'schedule-confirm', onPress: () => onConfirm(when) }]}>
      <View style={{ marginTop: theme.space.md, gap: theme.space.md }} testID="schedule-dialog">
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: c.text, fontSize: theme.font.lg, fontWeight: '700' }} testID="schedule-when">{dayLabel(when)}, {timeOf(when)}</Text>
          {tooSoon ? <Text style={{ color: c.danger, fontSize: theme.font.sm, marginTop: 4 }}>Choose a time at least a minute from now.</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {quick.map((q) => <Chip key={q.label} label={q.label} onPress={() => setWhen(q.date())} testID={`schedule-quick-${q.label}`} />)}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
          <Chip label="Date" icon="calendar-outline" onPress={() => pick('date')} testID="schedule-pick-date" />
          <Chip label="Time" icon="time-outline" onPress={() => pick('time')} testID="schedule-pick-time" />
        </View>
        {Platform.OS === 'ios' && iosMode ? (
          <DateTimePicker value={when} mode={iosMode} display="spinner" minimumDate={new Date()}
            onChange={(_, date) => { if (date) setWhen(date); }} />
        ) : null}
      </View>
    </Dialog>
  );
}
