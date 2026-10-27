-- chat_application migration v3: group chats, date of birth.
-- Run once, in order, on a database that already has the release 2 columns (pin / archive / reply /
-- forward / edits / scheduled messages). Every change is additive: new nullable columns, two foreign
-- keys and a backfill. Nothing is dropped or renamed, so the running v2 server keeps working.

-- ---------------------------------------------------------------- users_lst_t
-- date of birth, asked at sign-up and editable in the profile. null for accounts created before
ALTER TABLE `users_lst_t`
  ADD COLUMN `date_of_birth` DATE NULL COMMENT 'asked at sign-up; private to the user' AFTER `mobile_no`;

-- ---------------------------------------------------------------- conversations_lst_t
-- a group's description, next to its shared name (title)
ALTER TABLE `conversations_lst_t`
  ADD COLUMN `description` VARCHAR(500) NULL COMMENT 'group description; null for one-to-one' AFTER `title`;

-- ---------------------------------------------------------------- conversation_members_t
-- the newest message THIS member can see: their chat-list preview and order. a member who left a
-- group, or who blocked a sender, must not see later messages there even as a preview
ALTER TABLE `conversation_members_t`
  ADD COLUMN `last_message_id` BIGINT UNSIGNED NULL COMMENT 'newest message this member can see; their list preview and order' AFTER `last_read_message_id`,
  ADD KEY `fk_member_last_message_idx` (`last_message_id`),
  ADD CONSTRAINT `fk_member_last_message` FOREIGN KEY (`last_message_id`) REFERENCES `messages_lst_t` (`message_id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- ---------------------------------------------------------------- messages_lst_t
-- group notices are SYSTEM messages: the sender is who did it, the target who it happened to, so
-- the app can word them for the reader ("You added Noah", "Maya added you")
ALTER TABLE `messages_lst_t`
  ADD COLUMN `system_event` VARCHAR(30) NULL COMMENT 'SYSTEM notices: GROUP_CREATED | MEMBER_ADDED | MEMBER_REMOVED | MEMBER_LEFT | ADMIN_MADE | ADMIN_DISMISSED | ADMIN_ASSIGNED | NAME_CHANGED | DESCRIPTION_CHANGED' AFTER `message_type_id`,
  ADD COLUMN `system_target_user_id` BIGINT UNSIGNED NULL COMMENT 'SYSTEM notices: the member the notice is about' AFTER `system_event`,
  ADD KEY `fk_msg_system_target_idx` (`system_target_user_id`),
  ADD CONSTRAINT `fk_msg_system_target` FOREIGN KEY (`system_target_user_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------- message_receipts_t
-- a member who leaves (or is removed) before seeing a message is no longer waited for, so the
-- sender's ticks can still turn blue. the receipt itself stays: it is what lets them read it later
ALTER TABLE `message_receipts_t`
  ADD COLUMN `excluded_at` DATETIME(3) NULL COMMENT 'set when the recipient left the group before seeing it; ticks stop waiting for them' AFTER `seen_at`;

-- ---------------------------------------------------------------- backfill
-- every existing conversation is one-to-one, where both members see every message
UPDATE `conversation_members_t` m
  JOIN `conversations_lst_t` c ON c.`conversation_id` = m.`conversation_id`
  SET m.`last_message_id` = c.`last_message_id`
  WHERE m.`last_message_id` IS NULL AND c.`last_message_id` IS NOT NULL;
