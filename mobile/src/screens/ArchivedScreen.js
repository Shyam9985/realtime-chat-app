import React from 'react';
import { ChatListView } from './ConversationsScreen';

// archived chats: the same list, showing only what this user archived; long press to unarchive
export default function ArchivedScreen({ navigation }) {
  return <ChatListView navigation={navigation} archived />;
}
