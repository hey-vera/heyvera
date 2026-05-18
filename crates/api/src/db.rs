use std::path::Path;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Serialize;
use uuid::Uuid;

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Conversation {
    pub id: String,
    pub user_id: String,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ConversationWithMessages {
    #[serde(flatten)]
    pub conversation: Conversation,
    pub messages: Vec<Message>,
}

#[derive(Debug, Serialize)]
pub struct ConversationSummary {
    pub id: String,
    pub title: Option<String>,
    pub updated_at: String,
    pub message_count: i64,
    pub last_message_preview: Option<String>,
}

impl Database {
    pub fn open(path: &Path) -> Self {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(path).expect("failed to open database");

        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;"
        ).expect("failed to set pragmas");

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                provider TEXT,
                model TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_conversations_user
                ON conversations(user_id, updated_at DESC);

            CREATE INDEX IF NOT EXISTS idx_messages_conversation
                ON messages(conversation_id, created_at ASC);"
        ).expect("failed to create tables");

        Self { conn: Mutex::new(conn) }
    }

    pub fn create_conversation(&self, user_id: &str, title: Option<&str>) -> Conversation {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, user_id, title, now, now],
        ).expect("failed to insert conversation");

        Conversation { id, user_id: user_id.to_string(), title: title.map(String::from), created_at: now.clone(), updated_at: now }
    }

    pub fn list_conversations(&self, user_id: &str) -> Vec<ConversationSummary> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.title, c.updated_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as msg_count,
                    (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_msg
             FROM conversations c
             WHERE c.user_id = ?1
             ORDER BY c.updated_at DESC"
        ).unwrap();

        stmt.query_map(params![user_id], |row| {
            let preview: Option<String> = row.get(4)?;
            Ok(ConversationSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
                message_count: row.get(3)?,
                last_message_preview: preview.map(|s| if s.len() > 100 { format!("{}...", &s[..97]) } else { s }),
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_conversation(&self, conversation_id: &str, user_id: &str) -> Option<ConversationWithMessages> {
        let conn = self.conn.lock().unwrap();

        let conversation = conn.query_row(
            "SELECT id, user_id, title, created_at, updated_at FROM conversations WHERE id = ?1 AND user_id = ?2",
            params![conversation_id, user_id],
            |row| Ok(Conversation {
                id: row.get(0)?,
                user_id: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            }),
        ).ok()?;

        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, provider, model, created_at
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC"
        ).unwrap();

        let messages = stmt.query_map(params![conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                provider: row.get(4)?,
                model: row.get(5)?,
                created_at: row.get(6)?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect();

        Some(ConversationWithMessages { conversation, messages })
    }

    pub fn delete_conversation(&self, conversation_id: &str, user_id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute(
            "DELETE FROM conversations WHERE id = ?1 AND user_id = ?2",
            params![conversation_id, user_id],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn update_conversation_title(&self, conversation_id: &str, user_id: &str, title: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3 AND user_id = ?4",
            params![title, now, conversation_id, user_id],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn add_message(
        &self,
        conversation_id: &str,
        role: &str,
        content: &str,
        provider: Option<&str>,
        model: Option<&str>,
    ) -> Message {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, provider, model, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, conversation_id, role, content, provider, model, now],
        ).expect("failed to insert message");

        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now, conversation_id],
        ).ok();

        Message {
            id,
            conversation_id: conversation_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            provider: provider.map(String::from),
            model: model.map(String::from),
            created_at: now,
        }
    }
}
