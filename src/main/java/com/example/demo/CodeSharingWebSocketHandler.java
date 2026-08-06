package com.example.demo;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class CodeSharingWebSocketHandler extends TextWebSocketHandler {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<String, Room> rooms = new ConcurrentHashMap<>();

    private static class Room {
        private final String roomId;
        private WebSocketSession presenterSession;
        private final Set<WebSocketSession> viewerSessions = ConcurrentHashMap.newKeySet();
        private String code = "// Welcome to ShareTheCode!\n// Share your room link with others to start broadcasting live.";

        public Room(String roomId) {
            this.roomId = roomId;
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        try {
            JsonNode jsonNode = objectMapper.readTree(message.getPayload());
            if (!jsonNode.has("type")) return;

            String type = jsonNode.get("type").asText();
            
            // Get session attributes
            String roomId = (String) session.getAttributes().get("roomId");
            String role = (String) session.getAttributes().get("role");
            String username = (String) session.getAttributes().get("username");

            if ("JOIN".equals(type)) {
                handleJoin(session, jsonNode);
                return;
            }

            if (roomId == null) return;
            Room room = rooms.get(roomId);
            if (room == null) return;

            switch (type) {
                case "CODE_UPDATE":
                    if ("host".equalsIgnoreCase(role)) {
                        String code = jsonNode.get("code").asText();
                        room.code = code;
                        broadcastToViewers(room, Map.of(
                            "type", "CODE_UPDATE",
                            "code", code
                        ));
                    }
                    break;

                case "CURSOR_UPDATE":
                    if ("host".equalsIgnoreCase(role)) {
                        JsonNode position = jsonNode.get("position");
                        broadcastToViewers(room, Map.of(
                            "type", "CURSOR_UPDATE",
                            "position", position
                        ));
                    }
                    break;

                case "CHAT":
                    String chatMsg = jsonNode.get("message").asText();
                    broadcastToAll(room, Map.of(
                        "type", "CHAT",
                        "username", username != null ? username : "Anonymous",
                        "message", chatMsg,
                        "role", role != null ? role : "viewer"
                    ));
                    break;

                case "REACTION":
                    String reaction = jsonNode.get("reaction").asText();
                    broadcastToAll(room, Map.of(
                        "type", "REACTION",
                        "reaction", reaction,
                        "username", username != null ? username : "Anonymous"
                    ));
                    break;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void handleJoin(WebSocketSession session, JsonNode jsonNode) {
        String roomId = jsonNode.get("roomId").asText();
        String role = jsonNode.get("role").asText();
        String username = jsonNode.has("username") ? jsonNode.get("username").asText() : "Anonymous";

        session.getAttributes().put("roomId", roomId);
        session.getAttributes().put("role", role);
        session.getAttributes().put("username", username);

        Room room = rooms.computeIfAbsent(roomId, Room::new);

        if ("host".equalsIgnoreCase(role)) {
            if (room.presenterSession != null && room.presenterSession.isOpen() && !room.presenterSession.getId().equals(session.getId())) {
                try {
                    room.presenterSession.close();
                } catch (IOException e) {
                    // Ignore
                }
            }
            room.presenterSession = session;
            broadcastToViewers(room, Map.of("type", "PRESENTER_ONLINE"));
            sendJson(session, Map.of(
                "type", "JOIN_ACK",
                "role", "host",
                "code", room.code
            ));
        } else {
            room.viewerSessions.add(session);
            sendJson(session, Map.of(
                "type", "ROOM_STATE",
                "code", room.code,
                "hasPresenter", room.presenterSession != null && room.presenterSession.isOpen()
            ));
        }

        broadcastUsersList(room);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String roomId = (String) session.getAttributes().get("roomId");
        String role = (String) session.getAttributes().get("role");

        if (roomId != null) {
            Room room = rooms.get(roomId);
            if (room != null) {
                if ("host".equalsIgnoreCase(role)) {
                    room.presenterSession = null;
                    broadcastToViewers(room, Map.of("type", "PRESENTER_OFFLINE"));
                } else {
                    room.viewerSessions.remove(session);
                }

                broadcastUsersList(room);

                if (room.presenterSession == null && room.viewerSessions.isEmpty()) {
                    rooms.remove(roomId);
                }
            }
        }
    }

    private void broadcastUsersList(Room room) {
        List<Map<String, String>> users = new ArrayList<>();
        if (room.presenterSession != null && room.presenterSession.isOpen()) {
            String name = (String) room.presenterSession.getAttributes().get("username");
            users.add(Map.of("username", name != null ? name : "Host", "role", "host"));
        }
        for (WebSocketSession viewer : room.viewerSessions) {
            if (viewer.isOpen()) {
                String name = (String) viewer.getAttributes().get("username");
                users.add(Map.of("username", name != null ? name : "Viewer", "role", "viewer"));
            }
        }
        broadcastToAll(room, Map.of(
            "type", "USERS_LIST",
            "users", users
        ));
    }

    private void broadcastToAll(Room room, Object payload) {
        if (room.presenterSession != null) {
            sendJson(room.presenterSession, payload);
        }
        for (WebSocketSession viewer : room.viewerSessions) {
            sendJson(viewer, payload);
        }
    }

    private void broadcastToViewers(Room room, Object payload) {
        for (WebSocketSession viewer : room.viewerSessions) {
            sendJson(viewer, payload);
        }
    }

    private void sendJson(WebSocketSession session, Object payload) {
        if (session != null && session.isOpen()) {
            try {
                String json = objectMapper.writeValueAsString(payload);
                synchronized (session) {
                    session.sendMessage(new TextMessage(json));
                }
            } catch (Exception e) {
                // Ignore or log
            }
        }
    }
}
