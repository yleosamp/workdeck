import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { config } from "./config.js";

const migrations = [
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    handle VARCHAR(30) NOT NULL UNIQUE,
    display_name VARCHAR(80) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    bio VARCHAR(280) NOT NULL DEFAULT '',
    avatar_color CHAR(7) NOT NULL DEFAULT '#72e3a2',
    avatar_url MEDIUMTEXT NULL,
    banner_url MEDIUMTEXT NULL,
    profile_visibility ENUM('public','friends','private') NOT NULL DEFAULT 'public',
    presence_visibility ENUM('public','friends','private') NOT NULL DEFAULT 'public',
    last_seen_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    refresh_token_hash CHAR(64) NOT NULL UNIQUE,
    device_name VARCHAR(120) NOT NULL DEFAULT 'Workdeck Desktop',
    expires_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_used_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_sessions_user (user_id),
    INDEX idx_sessions_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS friend_requests (
    id CHAR(36) PRIMARY KEY,
    sender_id CHAR(36) NOT NULL,
    receiver_id CHAR(36) NOT NULL,
    status ENUM('pending','accepted','rejected','canceled') NOT NULL DEFAULT 'pending',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    responded_at DATETIME(3) NULL,
    CONSTRAINT fk_friend_request_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_friend_request_receiver FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_friend_request_pair (sender_id, receiver_id),
    INDEX idx_friend_requests_receiver_status (receiver_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS friendships (
    user_low_id CHAR(36) NOT NULL,
    user_high_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_low_id, user_high_id),
    CONSTRAINT fk_friendships_low FOREIGN KEY (user_low_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_friendships_high FOREIGN KEY (user_high_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS blocks (
    blocker_id CHAR(36) NOT NULL,
    blocked_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT fk_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS presence (
    user_id CHAR(36) PRIMARY KEY,
    status ENUM('online','away','offline') NOT NULL DEFAULT 'offline',
    current_app_id VARCHAR(80) NULL,
    current_app_name VARCHAR(120) NULL,
    session_started_at DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_presence_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS messages (
    id CHAR(36) PRIMARY KEY,
    sender_id CHAR(36) NOT NULL,
    recipient_id CHAR(36) NOT NULL,
    body TEXT NULL,
    message_type ENUM('text','file') NOT NULL DEFAULT 'text',
    file_metadata JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    delivered_at DATETIME(3) NULL,
    read_at DATETIME(3) NULL,
    CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_messages_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_messages_conversation_sender (sender_id, recipient_id, created_at),
    INDEX idx_messages_conversation_recipient (recipient_id, sender_id, created_at),
    INDEX idx_messages_unread (recipient_id, read_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS activity_daily (
    user_id CHAR(36) NOT NULL,
    activity_date DATE NOT NULL,
    app_id VARCHAR(80) NOT NULL,
    app_name VARCHAR(120) NOT NULL,
    seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, activity_date, app_id),
    CONSTRAINT fk_activity_daily_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_activity_daily_profile (user_id, activity_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS activity_totals (
    user_id CHAR(36) NOT NULL,
    app_id VARCHAR(80) NOT NULL,
    app_name VARCHAR(120) NOT NULL,
    total_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_opened_at DATETIME(3) NULL,
    PRIMARY KEY (user_id, app_id),
    CONSTRAINT fk_activity_totals_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS communities (
    id CHAR(36) PRIMARY KEY,
    owner_id CHAR(36) NOT NULL,
    name VARCHAR(80) NOT NULL,
    description VARCHAR(240) NOT NULL DEFAULT '',
    icon_color CHAR(7) NOT NULL DEFAULT '#72e3a2',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_communities_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS community_members (
    community_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    role ENUM('owner','member') NOT NULL DEFAULT 'member',
    joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (community_id,user_id),
    CONSTRAINT fk_community_members_community FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_community_members_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS community_channels (
    id CHAR(36) PRIMARY KEY,
    community_id CHAR(36) NOT NULL,
    name VARCHAR(80) NOT NULL,
    kind ENUM('text','voice') NOT NULL,
    position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_community_channels_community FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
    INDEX idx_community_channels_order (community_id,kind,position)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS community_messages (
    id CHAR(36) PRIMARY KEY,
    channel_id CHAR(36) NOT NULL,
    sender_id CHAR(36) NOT NULL,
    body TEXT NULL,
    message_type ENUM('text','file') NOT NULL DEFAULT 'text',
    file_metadata JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_community_messages_channel FOREIGN KEY (channel_id) REFERENCES community_channels(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_community_messages_channel (channel_id,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS community_invites (
    id CHAR(36) PRIMARY KEY,
    community_id CHAR(36) NOT NULL,
    code VARCHAR(40) NOT NULL UNIQUE,
    created_by CHAR(36) NOT NULL,
    target_user_id CHAR(36) NULL,
    expires_at DATETIME(3) NULL,
    max_uses INT UNSIGNED NULL,
    uses INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_community_invites_community FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_invites_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_community_invites_target FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_community_invites_target (target_user_id,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

export async function initializeDatabase(): Promise<Pool> {
  const admin = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    charset: "utf8mb4"
  });
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${config.mysql.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  const pool = mysql.createPool({
    ...config.mysql,
    charset: "utf8mb4",
    connectionLimit: 12,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: "Z",
    dateStrings: true
  });
  for (const migration of migrations) await pool.query(migration);
  const [avatarColumns] = await pool.query<Array<{ Field: string }> & RowDataPacket[]>("SHOW COLUMNS FROM users LIKE 'avatar_url'");
  let upgradedExistingProfiles = false;
  if (!avatarColumns.length) {
    await pool.query("ALTER TABLE users ADD COLUMN avatar_url MEDIUMTEXT NULL AFTER avatar_color");
    upgradedExistingProfiles = true;
  }
  const [bannerColumns] = await pool.query<Array<{ Field: string }> & RowDataPacket[]>("SHOW COLUMNS FROM users LIKE 'banner_url'");
  if (!bannerColumns.length) {
    await pool.query("ALTER TABLE users ADD COLUMN banner_url MEDIUMTEXT NULL AFTER avatar_url");
    upgradedExistingProfiles = true;
  }
  await pool.query("ALTER TABLE users MODIFY presence_visibility ENUM('public','friends','private') NOT NULL DEFAULT 'public'");
  if (upgradedExistingProfiles) await pool.query("UPDATE users SET presence_visibility='public' WHERE presence_visibility='friends'");
  const [communityMessageType] = await pool.query<Array<{ Field: string }> & RowDataPacket[]>("SHOW COLUMNS FROM community_messages LIKE 'message_type'");
  await pool.query("ALTER TABLE community_messages MODIFY body TEXT NULL");
  if (!communityMessageType.length) await pool.query("ALTER TABLE community_messages ADD COLUMN message_type ENUM('text','file') NOT NULL DEFAULT 'text' AFTER body");
  const [communityFileMetadata] = await pool.query<Array<{ Field: string }> & RowDataPacket[]>("SHOW COLUMNS FROM community_messages LIKE 'file_metadata'");
  if (!communityFileMetadata.length) await pool.query("ALTER TABLE community_messages ADD COLUMN file_metadata JSON NULL AFTER message_type");
  return pool;
}
