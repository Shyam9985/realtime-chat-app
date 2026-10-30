-- chat_application schema (v1 plus the v2, v3 and v4 additions). generated from the schema definition in gen_schema.py;
-- for a NEW database. migration scripts for an existing database are kept only until every database has run them.
-- every table carries is_active / created_at / updated_at with defaults.
-- run as chatapp_admin:
--   mysql -u chatapp_admin -p chat_application < documents/database/schema-v1.sql

SET NAMES utf8mb4;
USE `chat_application`;

-- ---------------------------------------------------------------- users_lst_t
CREATE TABLE IF NOT EXISTS `users_lst_t` (
  `user_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_nm` VARCHAR(255) NOT NULL COMMENT 'login id, the email at signup',
  `email` VARCHAR(255) NOT NULL,
  `first_nm` VARCHAR(100) NOT NULL,
  `last_nm` VARCHAR(100) NULL,
  `mobile_no` VARCHAR(15) NULL,
  `date_of_birth` DATE NULL COMMENT 'asked at sign-up; private to the user',
  `password_hash` VARCHAR(255) NOT NULL,
  `password_salt` VARCHAR(255) NULL,
  `profile_photo_url` VARCHAR(500) NULL,
  `last_login` DATETIME NULL,
  `last_seen_at` DATETIME(3) NULL COMMENT 'when the app last closed its live connection (''last seen'')',
  `is_locked` TINYINT(1) NOT NULL DEFAULT 0,
  `login_attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until` DATETIME NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uq_users_user_nm` (`user_nm`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_name` (`first_nm`, `last_nm`),
  KEY `idx_users_mobile` (`mobile_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='accounts; user_nm holds the login id (the email)';

-- ---------------------------------------------------------------- conversations_type_master_t
CREATE TABLE IF NOT EXISTS `conversations_type_master_t` (
  `conversation_type_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type_code` VARCHAR(20) NOT NULL,
  `type_name` VARCHAR(50) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`conversation_type_id`),
  UNIQUE KEY `uq_conv_type_code` (`type_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='ONE_TO_ONE | GROUP';

-- ---------------------------------------------------------------- message_type_master_t
CREATE TABLE IF NOT EXISTS `message_type_master_t` (
  `message_type_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type_code` VARCHAR(20) NOT NULL,
  `type_name` VARCHAR(50) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`message_type_id`),
  UNIQUE KEY `uq_msg_type_code` (`type_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='TEXT | EMOJI | IMAGE | VIDEO | AUDIO | FILE | SYSTEM';

-- ---------------------------------------------------------------- conversations_lst_t
CREATE TABLE IF NOT EXISTS `conversations_lst_t` (
  `conversation_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_type_id` INT UNSIGNED NOT NULL,
  `title` VARCHAR(100) NULL COMMENT 'group name; null for one-to-one',
  `description` VARCHAR(500) NULL COMMENT 'group description; null for one-to-one',
  `photo_url` VARCHAR(255) NULL COMMENT 'group photo: the stored path of the compressed JPEG (uploaded_files_lst_t, entity GROUP_PHOTO); null for one-to-one',
  `created_by` BIGINT UNSIGNED NOT NULL,
  `user_pair_key` VARCHAR(41) NULL COMMENT '''lowUserId:highUserId'' for ONE_TO_ONE, null for groups',
  `last_message_id` BIGINT UNSIGNED NULL COMMENT 'denormalised for the conversation list',
  `last_message_at` DATETIME(3) NULL,
  `current_key_version` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = no chat key yet; new messages must use this version',
  `needs_new_key` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = members changed: the next sender''s app makes a new version',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`conversation_id`),
  UNIQUE KEY `uq_conv_user_pair` (`user_pair_key`),
  KEY `idx_conv_last_message_at` (`last_message_at`),
  KEY `fk_conv_type_idx` (`conversation_type_id`),
  KEY `fk_conv_created_by_idx` (`created_by`),
  KEY `fk_conv_last_message_idx` (`last_message_id`),
  CONSTRAINT `fk_conv_type` FOREIGN KEY (`conversation_type_id`) REFERENCES `conversations_type_master_t` (`conversation_type_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_conv_created_by` FOREIGN KEY (`created_by`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='one row per chat; user_pair_key makes a one-to-one chat unique per pair';

-- ---------------------------------------------------------------- conversation_members_t
CREATE TABLE IF NOT EXISTS `conversation_members_t` (
  `conversation_member_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `member_role` VARCHAR(20) NOT NULL DEFAULT 'MEMBER' COMMENT 'MEMBER | ADMIN (groups)',
  `last_read_message_id` BIGINT UNSIGNED NULL,
  `last_message_id` BIGINT UNSIGNED NULL COMMENT 'newest message this member can see; their list preview and order',
  `is_pinned` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = pinned to the top of this member''s chat list',
  `pinned_at` DATETIME(3) NULL COMMENT 'when pinned; orders pinned chats',
  `is_archived` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = shown in this member''s archive instead of the list',
  `archived_at` DATETIME(3) NULL,
  `custom_title` VARCHAR(100) NULL COMMENT 'the name this member sees; one-to-one: the other person''s name at creation, renamable',
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `left_at` DATETIME NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`conversation_member_id`),
  UNIQUE KEY `uq_member_conv_user` (`conversation_id`, `user_id`),
  KEY `idx_member_user` (`user_id`),
  KEY `idx_member_user_list` (`user_id`, `is_archived`, `is_pinned`, `pinned_at`),
  KEY `fk_member_last_read_idx` (`last_read_message_id`),
  KEY `fk_member_last_message_idx` (`last_message_id`),
  CONSTRAINT `fk_member_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `conversations_lst_t` (`conversation_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_member_user` FOREIGN KEY (`user_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='who is in a conversation; last_read_message_id drives unread counts';

-- ---------------------------------------------------------------- user_blocks_t
CREATE TABLE IF NOT EXISTS `user_blocks_t` (
  `block_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `blocker_id` BIGINT UNSIGNED NOT NULL,
  `blocked_id` BIGINT UNSIGNED NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`block_id`),
  UNIQUE KEY `uq_block_pair` (`blocker_id`, `blocked_id`),
  KEY `idx_block_blocked` (`blocked_id`),
  CONSTRAINT `fk_block_blocker` FOREIGN KEY (`blocker_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_block_blocked` FOREIGN KEY (`blocked_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `chk_block_not_self` CHECK (blocker_id <> blocked_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='blocker -> blocked; unblock sets is_active = 0';

-- ---------------------------------------------------------------- uploaded_files_lst_t
CREATE TABLE IF NOT EXISTS `uploaded_files_lst_t` (
  `file_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `original_nm` VARCHAR(255) NOT NULL,
  `stored_nm` VARCHAR(255) NOT NULL,
  `file_path` VARCHAR(500) NOT NULL,
  `extension` VARCHAR(20) NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `size_bytes` BIGINT UNSIGNED NOT NULL,
  `checksum_sha256` CHAR(64) NULL,
  `entity_type` VARCHAR(50) NULL COMMENT 'e.g. USER_PROFILE, MESSAGE',
  `entity_id` VARCHAR(64) NULL,
  `uploaded_by` BIGINT UNSIGNED NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`file_id`),
  UNIQUE KEY `uq_files_stored_nm` (`stored_nm`),
  KEY `idx_files_entity` (`entity_type`, `entity_id`, `is_active`),
  KEY `fk_files_uploaded_by_idx` (`uploaded_by`),
  CONSTRAINT `fk_files_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='files saved by the upload endpoint';

-- ---------------------------------------------------------------- user_sessions_t
CREATE TABLE IF NOT EXISTS `user_sessions_t` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(128) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `login_timestamp` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_activity_timestamp` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  `destroyed_at` DATETIME NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sessions_session_id` (`session_id`),
  KEY `idx_sessions_user` (`user_id`, `is_active`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='application sessions issued at login';

-- ---------------------------------------------------------------- user_login_history_t
CREATE TABLE IF NOT EXISTS `user_login_history_t` (
  `login_history_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `login_timestamp` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip_address` VARCHAR(45) NULL,
  `device_info` VARCHAR(1000) NULL,
  `remarks` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`login_history_id`),
  KEY `idx_login_hist_user` (`user_id`, `login_timestamp`),
  CONSTRAINT `fk_login_hist_user` FOREIGN KEY (`user_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='one row per login attempt that reached a session';

-- ---------------------------------------------------------------- sessions
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` VARCHAR(128) NOT NULL,
  `expires` INT UNSIGNED NOT NULL,
  `data` MEDIUMTEXT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='express-mysql-session store (library owned column names)';

-- ---------------------------------------------------------------- email_audit_logs_t
CREATE TABLE IF NOT EXISTS `email_audit_logs_t` (
  `email_audit_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `recipient_email` VARCHAR(255) NOT NULL,
  `email_subject` VARCHAR(255) NULL,
  `email_body` TEXT NULL,
  `email_status` VARCHAR(20) NOT NULL COMMENT 'SUCCESS | FAILED',
  `message_id` VARCHAR(255) NULL COMMENT 'smtp message id',
  `response_data` TEXT NULL,
  `expires_at` DATETIME NULL,
  `verify_key` VARCHAR(255) NULL COMMENT 'hashed otp',
  `is_used` TINYINT(1) NULL COMMENT 'null until consumed',
  `used_by` VARCHAR(255) NULL,
  `used_for` VARCHAR(50) NULL COMMENT 'forgot-password | reset-password',
  `create_user` VARCHAR(255) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`email_audit_id`),
  KEY `idx_email_audit_lookup` (`recipient_email`, `used_for`, `email_audit_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='every outgoing mail; otp rows carry verify_key and expiry';

-- ---------------------------------------------------------------- audit_logs_t
CREATE TABLE IF NOT EXISTS `audit_logs_t` (
  `audit_log_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id` CHAR(36) NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `action` VARCHAR(50) NOT NULL,
  `module` VARCHAR(50) NULL,
  `entity_type` VARCHAR(50) NULL,
  `entity_id` VARCHAR(64) NULL,
  `status` VARCHAR(20) NULL COMMENT 'SUCCESS | FAILED',
  `status_key` VARCHAR(50) NULL,
  `description` VARCHAR(1000) NULL,
  `old_values` JSON NULL,
  `new_values` JSON NULL,
  `error_message` TEXT NULL,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(500) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`audit_log_id`),
  KEY `idx_audit_user_time` (`user_id`, `created_at`),
  KEY `idx_audit_request` (`request_id`),
  CONSTRAINT `fk_audit_user` FOREIGN KEY (`user_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='one row per audited business action';

-- ---------------------------------------------------------------- user_devices_t
CREATE TABLE IF NOT EXISTS `user_devices_t` (
  `device_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'who is signed in on that phone',
  `push_token` VARCHAR(512) NOT NULL COMMENT 'the phone''s firebase cloud messaging token',
  `platform` VARCHAR(20) NOT NULL DEFAULT 'android' COMMENT 'android | ios',
  `last_registered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'the app sends the token at every start and sign-in',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`device_id`),
  UNIQUE KEY `uq_device_push_token` (`push_token`),
  KEY `idx_device_user` (`user_id`, `is_active`),
  CONSTRAINT `fk_device_user` FOREIGN KEY (`user_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='phones that receive push notifications';

-- ---------------------------------------------------------------- app_releases_t
CREATE TABLE IF NOT EXISTS `app_releases_t` (
  `release_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `version` VARCHAR(20) NOT NULL COMMENT 'what users see, semver: 1.1.0',
  `version_code` INT UNSIGNED NOT NULL COMMENT 'what the app compares: major*10000 + minor*100 + patch',
  `apk_url` VARCHAR(500) NOT NULL COMMENT 'where the APK is downloaded from (github releases)',
  `notes` TEXT NULL COMMENT 'what''s new, shown in the update dialog',
  `is_mandatory` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = older builds must update before using the app',
  `released_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`release_id`),
  UNIQUE KEY `uq_release_version` (`version`),
  UNIQUE KEY `uq_release_version_code` (`version_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='published app versions; the app compares its build with the newest';

-- ---------------------------------------------------------------- user_keys_t
CREATE TABLE IF NOT EXISTS `user_keys_t` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `key_version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'raised by "start fresh": a new padlock and key',
  `public_key` VARCHAR(64) NOT NULL COMMENT 'X25519 public key, base64 (the padlock)',
  `pw_locked_private_key` VARCHAR(255) NOT NULL COMMENT 'private key locked with a key made from the password (scrypt), base64',
  `pw_kdf_salt` VARCHAR(64) NOT NULL COMMENT 'random salt for that scrypt, base64',
  `pw_kdf_params` VARCHAR(100) NOT NULL COMMENT 'scrypt settings used, e.g. N=32768,r=8,p=1',
  `pw_backup_valid` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = password reset by email without the key at hand: the app must re-lock it',
  `rc_locked_private_key` VARCHAR(255) NOT NULL COMMENT 'private key locked with the recovery code, base64',
  `rc_kdf_salt` VARCHAR(64) NOT NULL COMMENT 'random salt for the recovery code, base64',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_ukey_user` FOREIGN KEY (`user_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='end-to-end encryption: padlocks and locked private-key backups';

-- ---------------------------------------------------------------- conversation_keys_t
CREATE TABLE IF NOT EXISTS `conversation_keys_t` (
  `conversation_key_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_id` BIGINT UNSIGNED NOT NULL,
  `key_version` INT UNSIGNED NOT NULL COMMENT '1, 2, ... ; messages say which version encrypted them',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'the member this copy is locked for',
  `user_key_version` INT UNSIGNED NOT NULL COMMENT 'which of the member''s padlocks locked it (user_keys_t.key_version)',
  `locked_key` VARCHAR(255) NOT NULL COMMENT 'the chat key sealed with the member''s padlock, base64',
  `created_by` BIGINT UNSIGNED NOT NULL COMMENT 'whose app made and locked it',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`conversation_key_id`),
  UNIQUE KEY `uq_ckey_conv_version_user` (`conversation_id`, `key_version`, `user_id`),
  KEY `idx_ckey_user` (`user_id`, `conversation_id`),
  KEY `fk_ckey_created_by_idx` (`created_by`),
  CONSTRAINT `fk_ckey_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `conversations_lst_t` (`conversation_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_ckey_user` FOREIGN KEY (`user_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_ckey_created_by` FOREIGN KEY (`created_by`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='end-to-end encryption: each member''s locked copy of each chat key version';

-- ---------------------------------------------------------------- messages_lst_t
CREATE TABLE IF NOT EXISTS `messages_lst_t` (
  `message_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_id` BIGINT UNSIGNED NOT NULL,
  `sender_id` BIGINT UNSIGNED NOT NULL,
  `message_type_id` INT UNSIGNED NOT NULL DEFAULT 1,
  `system_event` VARCHAR(30) NULL COMMENT 'SYSTEM notices: GROUP_CREATED | MEMBER_ADDED | MEMBER_REMOVED | MEMBER_LEFT | ADMIN_MADE | ADMIN_DISMISSED | ADMIN_ASSIGNED | NAME_CHANGED | DESCRIPTION_CHANGED | PHOTO_CHANGED | PHOTO_REMOVED',
  `system_target_user_id` BIGINT UNSIGNED NULL COMMENT 'SYSTEM notices: the member the notice is about',
  `content` TEXT NULL COMMENT 'enc_format 1: ciphertext, base64 (nonce + encrypted text + tag); enc_format 0: plain (SYSTEM notices)',
  `key_version` INT UNSIGNED NULL COMMENT 'the chat key version that encrypted it; null for SYSTEM notices',
  `enc_format` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '0 = plain text (SYSTEM notices), 1 = XChaCha20-Poly1305 v1',
  `attachment_file_id` BIGINT UNSIGNED NULL COMMENT 'uploaded_files_lst_t.file_id for image / file messages',
  `reply_to_message_id` BIGINT UNSIGNED NULL COMMENT 'the message this one quotes (swipe to reply)',
  `forwarded_from_message_id` BIGINT UNSIGNED NULL COMMENT 'the message this one is a forwarded copy of',
  `client_message_id` CHAR(36) NULL COMMENT 'uuid from the sender; makes a socket retry idempotent',
  `is_edited` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = content changed after sending; history in message_edits_t',
  `edited_at` DATETIME(3) NULL COMMENT 'time of the latest edit',
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `deleted_at` DATETIME(3) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`message_id`),
  UNIQUE KEY `uq_msg_sender_client` (`sender_id`, `client_message_id`),
  KEY `idx_msg_conv_created` (`conversation_id`, `created_at`, `message_id`),
  KEY `fk_msg_type_idx` (`message_type_id`),
  KEY `fk_msg_attachment_idx` (`attachment_file_id`),
  KEY `fk_msg_reply_to_idx` (`reply_to_message_id`),
  KEY `fk_msg_forwarded_from_idx` (`forwarded_from_message_id`),
  KEY `fk_msg_system_target_idx` (`system_target_user_id`),
  CONSTRAINT `fk_msg_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `conversations_lst_t` (`conversation_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_msg_sender` FOREIGN KEY (`sender_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_msg_type` FOREIGN KEY (`message_type_id`) REFERENCES `message_type_master_t` (`message_type_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_msg_attachment` FOREIGN KEY (`attachment_file_id`) REFERENCES `uploaded_files_lst_t` (`file_id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `fk_msg_reply_to` FOREIGN KEY (`reply_to_message_id`) REFERENCES `messages_lst_t` (`message_id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `fk_msg_forwarded_from` FOREIGN KEY (`forwarded_from_message_id`) REFERENCES `messages_lst_t` (`message_id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `fk_msg_system_target` FOREIGN KEY (`system_target_user_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='messages; soft delete via is_deleted within the 15 minute window';

-- ---------------------------------------------------------------- message_edits_t
CREATE TABLE IF NOT EXISTS `message_edits_t` (
  `message_edit_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `message_id` BIGINT UNSIGNED NOT NULL,
  `old_content` TEXT NULL COMMENT 'the text before this edit, encrypted like messages_lst_t.content',
  `key_version` INT UNSIGNED NULL COMMENT 'the chat key version that encrypted old_content',
  `enc_format` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1 = XChaCha20-Poly1305 v1',
  `edited_by` BIGINT UNSIGNED NOT NULL COMMENT 'always the sender; kept for audits',
  `edited_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`message_edit_id`),
  KEY `idx_edit_message` (`message_id`, `edited_at`),
  KEY `fk_edit_user_idx` (`edited_by`),
  CONSTRAINT `fk_edit_message` FOREIGN KEY (`message_id`) REFERENCES `messages_lst_t` (`message_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_edit_user` FOREIGN KEY (`edited_by`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='previous versions of edited messages';

-- ---------------------------------------------------------------- scheduled_messages_t
CREATE TABLE IF NOT EXISTS `scheduled_messages_t` (
  `scheduled_message_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_id` BIGINT UNSIGNED NOT NULL,
  `sender_id` BIGINT UNSIGNED NOT NULL,
  `content` TEXT NOT NULL COMMENT 'encrypted like messages_lst_t.content; sent as is at send_at',
  `key_version` INT UNSIGNED NOT NULL COMMENT 'the chat key version that encrypted it',
  `enc_format` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1 = XChaCha20-Poly1305 v1',
  `reply_to_message_id` BIGINT UNSIGNED NULL,
  `send_at` DATETIME(3) NOT NULL COMMENT 'date and time to send, server time',
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING | SENDING | SENT | CANCELLED | FAILED',
  `sent_message_id` BIGINT UNSIGNED NULL COMMENT 'the message created when it was sent',
  `failure_reason` VARCHAR(255) NULL COMMENT 'e.g. blocked by the recipient',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`scheduled_message_id`),
  KEY `idx_sched_due` (`status`, `send_at`),
  KEY `idx_sched_conv_sender` (`conversation_id`, `sender_id`, `status`),
  KEY `fk_sched_sender_idx` (`sender_id`),
  KEY `fk_sched_sent_msg_idx` (`sent_message_id`),
  KEY `fk_sched_reply_idx` (`reply_to_message_id`),
  CONSTRAINT `fk_sched_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `conversations_lst_t` (`conversation_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_sched_sender` FOREIGN KEY (`sender_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_sched_sent_msg` FOREIGN KEY (`sent_message_id`) REFERENCES `messages_lst_t` (`message_id`) ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT `fk_sched_reply` FOREIGN KEY (`reply_to_message_id`) REFERENCES `messages_lst_t` (`message_id`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='messages scheduled for a later date and time';

-- ---------------------------------------------------------------- message_receipts_t
CREATE TABLE IF NOT EXISTS `message_receipts_t` (
  `message_receipt_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `message_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'the recipient',
  `delivered_at` DATETIME(3) NULL,
  `seen_at` DATETIME(3) NULL,
  `excluded_at` DATETIME(3) NULL COMMENT 'set when the recipient left the group before seeing it; ticks stop waiting for them',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = active, 0 = soft deleted',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`message_receipt_id`),
  UNIQUE KEY `uq_receipt_msg_user` (`message_id`, `user_id`),
  KEY `idx_receipt_user_seen` (`user_id`, `seen_at`),
  CONSTRAINT `fk_receipt_message` FOREIGN KEY (`message_id`) REFERENCES `messages_lst_t` (`message_id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `fk_receipt_user` FOREIGN KEY (`user_id`) REFERENCES `users_lst_t` (`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='one row per recipient per message (groups have many)';

-- ---------------------------------------------------------------- circular foreign keys (messages <-> conversations)
SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations_lst_t' AND CONSTRAINT_NAME = 'fk_conv_last_message');
SET @ddl := IF(@fk_exists = 0, 'ALTER TABLE `conversations_lst_t` ADD CONSTRAINT `fk_conv_last_message` FOREIGN KEY (`last_message_id`) REFERENCES `messages_lst_t` (`message_id`) ON DELETE SET NULL ON UPDATE NO ACTION', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'conversation_members_t' AND CONSTRAINT_NAME = 'fk_member_last_read');
SET @ddl := IF(@fk_exists = 0, 'ALTER TABLE `conversation_members_t` ADD CONSTRAINT `fk_member_last_read` FOREIGN KEY (`last_read_message_id`) REFERENCES `messages_lst_t` (`message_id`) ON DELETE SET NULL ON UPDATE NO ACTION', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @fk_exists := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'conversation_members_t' AND CONSTRAINT_NAME = 'fk_member_last_message');
SET @ddl := IF(@fk_exists = 0, 'ALTER TABLE `conversation_members_t` ADD CONSTRAINT `fk_member_last_message` FOREIGN KEY (`last_message_id`) REFERENCES `messages_lst_t` (`message_id`) ON DELETE SET NULL ON UPDATE NO ACTION', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------- seed data (masters)
INSERT INTO `conversations_type_master_t` (`conversation_type_id`, `type_code`, `type_name`) VALUES
  (1, 'ONE_TO_ONE', 'One to one'),
  (2, 'GROUP', 'Group')
ON DUPLICATE KEY UPDATE `type_name` = VALUES(`type_name`);

INSERT INTO `message_type_master_t` (`message_type_id`, `type_code`, `type_name`) VALUES
  (1, 'TEXT', 'Text'),
  (2, 'EMOJI', 'Emoji'),
  (3, 'IMAGE', 'Image'),
  (4, 'VIDEO', 'Video'),
  (5, 'AUDIO', 'Audio'),
  (6, 'FILE', 'File'),
  (7, 'SYSTEM', 'System notice')
ON DUPLICATE KEY UPDATE `type_name` = VALUES(`type_name`);
