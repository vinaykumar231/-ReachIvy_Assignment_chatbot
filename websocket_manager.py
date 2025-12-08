import asyncio
import logging
from typing import Dict, Optional
from fastapi import WebSocket
import uuid

logger = logging.getLogger(__name__)

class WebSocketManager:
    """Manage WebSocket connections and session state"""
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.counselors: Dict[str, any] = {}  
        
    def generate_session_id(self) -> str:
        """Generate unique session ID"""
        return str(uuid.uuid4())[:8]
    
    async def connect(self, websocket: WebSocket, session_id: str):
        """Accept WebSocket connection and store it"""
        self.active_connections[session_id] = websocket
        logger.info(f" Session {session_id} connected")
    
    def connect_counselor(self, websocket: WebSocket, session_id: str, counselor):
        """Connect WebSocket and store counselor instance"""
        self.active_connections[session_id] = websocket
        self.counselors[session_id] = counselor
        logger.info(f" Session {session_id} connected with counselor")
    
    def disconnect(self, session_id: str):
        """Remove WebSocket connection"""
        if session_id in self.active_connections:
            del self.active_connections[session_id]
        if session_id in self.counselors:
            del self.counselors[session_id]
        logger.info(f" Session {session_id} disconnected")
    
    def get_counselor(self, session_id: str):
        """Get counselor instance for session"""
        return self.counselors.get(session_id)
    
    async def send_message(self, session_id: str, message: dict):
        """Send message to specific session"""
        if session_id in self.active_connections:
            try:
                await self.active_connections[session_id].send_json(message)
            except Exception as e:
                logger.error(f"Error sending message to session {session_id}: {e}")
                self.disconnect(session_id)
    
    async def broadcast(self, message: dict, exclude_session: str = None):
        """Broadcast message to all connected sessions"""
        for session_id in list(self.active_connections.keys()):
            if session_id != exclude_session:
                await self.send_message(session_id, message)


manager = WebSocketManager()