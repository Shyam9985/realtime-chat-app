import React, { useEffect, useState } from 'react';
import { useTheme } from '../theme/ThemeContext';
import { useToast } from '../contexts/MessageContext';
import * as chatApi from '../services/chat.service';
import { Screen, Fab, PeopleListSkeleton } from '../components/ui';
import PeoplePicker from '../components/PeoplePicker';
import { GROUP_MAX_MEMBERS, fullName } from '../utils/chatFormat';

// add people to a group (admins). people already in it are shown as such and cannot be picked
export default function AddMembersScreen({ route, navigation }) {
  const { conversationId } = route.params;
  const { theme } = useTheme();
  const toast = useToast();
  const [group, setGroup] = useState(null);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    chatApi.getGroup(conversationId).then(setGroup).catch((e) => { toast.error(e?.error || e?.message || 'Could not load the group.'); navigation.goBack(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const add = async () => {
    setSaving(true);
    try {
      const result = await chatApi.addGroupMembers(conversationId, selected.map((u) => u.user_id));
      const added = result.added_user_ids.length;
      const skipped = selected.filter((u) => result.skipped_user_ids.includes(u.user_id));
      if (skipped.length) toast.warning(`Added ${added}. Couldn’t add ${skipped.map(fullName).join(', ')}.`);
      else toast.success(`Added ${added} ${added === 1 ? 'person' : 'people'}.`);
      navigation.goBack();
    } catch (e) {
      toast.error(e?.error || e?.message || 'Could not add them.');
    } finally {
      setSaving(false);
    }
  };

  if (!group) return <Screen><PeopleListSkeleton /></Screen>;
  const room = (group.max_members || GROUP_MAX_MEMBERS) - group.members.length;
  return (
    <Screen background={theme.colors.background}>
      <PeoplePicker selected={selected} onChange={setSelected} excludeIds={group.members.map((m) => m.user_id)} max={room} />
      {selected.length && !saving ? <Fab icon="checkmark" onPress={add} accessibilityLabel={`Add ${selected.length} to the group`} /> : null}
    </Screen>
  );
}
