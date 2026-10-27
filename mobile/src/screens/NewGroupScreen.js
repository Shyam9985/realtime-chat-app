import React, { useState } from 'react';
import { useTheme } from '../theme/ThemeContext';
import { Screen, Fab } from '../components/ui';
import PeoplePicker from '../components/PeoplePicker';
import { GROUP_MAX_MEMBERS } from '../utils/chatFormat';

// new group, step 1: pick the people (the next step names the group)
export default function NewGroupScreen({ navigation }) {
  const { theme } = useTheme();
  const [selected, setSelected] = useState([]);
  return (
    <Screen background={theme.colors.background}>
      <PeoplePicker selected={selected} onChange={setSelected} max={GROUP_MAX_MEMBERS - 1} />
      {selected.length ? <Fab icon="arrow-forward" onPress={() => navigation.navigate('NewGroupDetails', { members: selected })} accessibilityLabel="Next: name the group" /> : null}
    </Screen>
  );
}
