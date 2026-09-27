import os
import sqlite3
import json
from datetime import datetime

class DatabaseManager:
    def __init__(self, db_path=None):
        if db_path is None:
            db_path = os.path.abspath(
                os.path.join(os.path.dirname(__file__), '..', 'instance', 'coconut_disease.db')
            )
        self.db_path = db_path
        self.init_database()

    def _ensure_database_directory(self):
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
    
    def init_database(self):
        """Initialize database with required tables"""
        self._ensure_database_directory()
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Users table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Detections table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS detections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                image_path TEXT NOT NULL,
                disease_name TEXT NOT NULL,
                confidence REAL NOT NULL,
                heatmap_path TEXT,
                treatment TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        
        # Settings table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Insert default settings
        default_settings = [
            ('model_version', '1.0'),
            ('last_training_date', datetime.now().isoformat()),
            ('disease_classes', json.dumps(['Bud_Rot', 'Healthy', 'Leaf_Blight', 'Root_Wilt', 'Stem_Bleeding']))
        ]
        
        for key, value in default_settings:
            cursor.execute(
                'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
                (key, value)
            )
        
        conn.commit()
        conn.close()
    
    def execute_query(self, query, params=None):
        """Execute a query and return results"""
        self._ensure_database_directory()
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        if params:
            cursor.execute(query, params)
        else:
            cursor.execute(query)
        
        results = cursor.fetchall()
        conn.commit()
        conn.close()
        
        return results
    
    def execute_update(self, query, params=None):
        """Execute an update query"""
        self._ensure_database_directory()
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        if params:
            cursor.execute(query, params)
        else:
            cursor.execute(query)
        
        conn.commit()
        row_id = cursor.lastrowid
        conn.close()
        
        return row_id
    
    def get_user(self, user_id):
        """Get user by ID"""
        query = "SELECT * FROM users WHERE id = ?"
        results = self.execute_query(query, (user_id,))
        if results:
            return self._row_to_dict(results[0], ['id', 'username', 'email', 'password_hash', 'is_admin', 'created_at'])
        return None
    
    def get_user_by_username(self, username):
        """Get user by username"""
        query = "SELECT * FROM users WHERE username = ?"
        results = self.execute_query(query, (username,))
        if results:
            return self._row_to_dict(results[0], ['id', 'username', 'email', 'password_hash', 'is_admin', 'created_at'])
        return None
    
    def create_user(self, username, email, password_hash, is_admin=0):
        """Create a new user"""
        query = "INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?)"
        return self.execute_update(query, (username, email, password_hash, is_admin))
    
    def save_detection(self, user_id, image_path, disease_name, confidence, heatmap_path=None, treatment=None):
        """Save a detection record"""
        query = """
            INSERT INTO detections (user_id, image_path, disease_name, confidence, heatmap_path, treatment)
            VALUES (?, ?, ?, ?, ?, ?)
        """
        return self.execute_update(query, (user_id, image_path, disease_name, confidence, heatmap_path, treatment))
    
    def get_user_detections(self, user_id, limit=None, offset=None):
        """Get all detections for a user"""
        query = "SELECT * FROM detections WHERE user_id = ? ORDER BY created_at DESC"
        if limit:
            query += f" LIMIT {limit}"
        if offset:
            query += f" OFFSET {offset}"
        
        results = self.execute_query(query, (user_id,))
        return [self._row_to_dict(row, ['id', 'user_id', 'image_path', 'disease_name', 'confidence', 'heatmap_path', 'treatment', 'created_at']) for row in results]
    
    def get_all_detections(self, limit=None, offset=None):
        """Get all detections (for admin)"""
        query = "SELECT * FROM detections ORDER BY created_at DESC"
        if limit:
            query += f" LIMIT {limit}"
        if offset:
            query += f" OFFSET {offset}"
        
        results = self.execute_query(query)
        return [self._row_to_dict(row, ['id', 'user_id', 'image_path', 'disease_name', 'confidence', 'heatmap_path', 'treatment', 'created_at']) for row in results]
    
    def get_disease_statistics(self):
        """Get disease distribution statistics"""
        query = """
            SELECT disease_name, COUNT(*) as count 
            FROM detections 
            GROUP BY disease_name 
            ORDER BY count DESC
        """
        results = self.execute_query(query)
        return {row[0]: row[1] for row in results}
    
    def get_setting(self, key):
        """Get a setting value"""
        query = "SELECT value FROM settings WHERE key = ?"
        results = self.execute_query(query, (key,))
        if results:
            return results[0][0]
        return None
    
    def update_setting(self, key, value):
        """Update a setting value"""
        query = "UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?"
        return self.execute_update(query, (value, key))
    
    def _row_to_dict(self, row, columns):
        """Convert a database row to a dictionary"""
        return {columns[i]: row[i] for i in range(len(columns))}