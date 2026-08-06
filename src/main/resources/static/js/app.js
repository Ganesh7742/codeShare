// App State
let role = 'host'; // default
let roomId = '';
let username = '';
let socket = null;
let editor = null;
let isLocalChange = false;
let presenterDecorations = [];

// DOM Elements
const landingScreen = document.getElementById('landing-screen');
const workspaceScreen = document.getElementById('workspace-screen');
const tabPresenter = document.getElementById('tab-presenter');
const tabViewer = document.getElementById('tab-viewer');
const roomIdGroup = document.getElementById('room-id-group');
const usernameInput = document.getElementById('username-input');
const roomIdInput = document.getElementById('room-id-input');
const actionBtn = document.getElementById('action-btn');
const roomIdDisplay = document.getElementById('room-id-display');
const copyRoomBtn = document.getElementById('copy-room-btn');
const statusBadge = document.getElementById('status-badge');
const userCountDisplay = document.getElementById('user-count-display');
const editorStatus = document.getElementById('editor-status');
const cursorPosDisplay = document.getElementById('cursor-pos-display');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const reactionsContainer = document.getElementById('reactions-container');
const exitBtn = document.getElementById('exit-btn');

// Init icons
lucide.createIcons();

// Parse Query Parameters (for invite links) and check localStorage
window.addEventListener('DOMContentLoaded', () => {
    // Pre-fill fields from local storage if available
    const savedUsername = localStorage.getItem('sharethecode_username');
    const savedRoomId = localStorage.getItem('sharethecode_roomid');
    
    if (savedUsername) usernameInput.value = savedUsername;
    
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        toggleTab('viewer');
        roomIdInput.value = roomParam;
        showToast('Invite link detected! Enter your name to join.', 'info');
    } else if (savedRoomId) {
        roomIdInput.value = savedRoomId;
    }
});

// Tab Interactions
tabPresenter.addEventListener('click', () => toggleTab('host'));
tabViewer.addEventListener('click', () => toggleTab('viewer'));

function toggleTab(selectedRole) {
    role = selectedRole;
    const roomLabel = document.getElementById('room-id-label');
    if (role === 'host') {
        tabPresenter.classList.add('active');
        tabViewer.classList.remove('active');
        if (roomLabel) roomLabel.textContent = 'Room Code (To Create)';
        actionBtn.querySelector('span').textContent = 'Start Broadcasting';
    } else {
        tabViewer.classList.add('active');
        tabPresenter.classList.remove('active');
        if (roomLabel) roomLabel.textContent = 'Room Code (To Join)';
        actionBtn.querySelector('span').textContent = 'Join Room Workspace';
    }
}

// Action Button Press
actionBtn.addEventListener('click', () => {
    username = usernameInput.value.trim();
    if (!username) {
        showToast('Please enter your name.', 'warning');
        usernameInput.focus();
        return;
    }

    roomId = roomIdInput.value.trim().toLowerCase();
    if (!roomId) {
        showToast('Please enter a Room Code.', 'warning');
        roomIdInput.focus();
        return;
    }

    // Save inputs to localStorage
    localStorage.setItem('sharethecode_username', username);
    localStorage.setItem('sharethecode_roomid', roomId);

    initializeWorkspace();
});

// Copy Room Link
copyRoomBtn.addEventListener('click', () => {
    const inviteLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(inviteLink).then(() => {
        showToast('Invite link copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Failed to copy invite link.', 'danger');
    });
});

// Exit Workspace
exitBtn.addEventListener('click', () => {
    if (socket) socket.close();
    location.reload();
});

// Toast Manager
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'warning') iconName = 'alert-triangle';
    if (type === 'danger') iconName = 'alert-circle';

    toast.innerHTML = `
        <i data-lucide="${iconName}"></i>
        <span>${message}</span>
    `;
    container.appendChild(toast);
    lucide.createIcons({ attrs: { class: 'toast-icon' } });

    // Slide in
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Connect WebSocket and initialize Monaco Editor
function initializeWorkspace() {
    // Show Workspace
    landingScreen.classList.remove('active');
    setTimeout(() => {
        workspaceScreen.classList.add('active');
        // Initial setup for displays
        roomIdDisplay.textContent = roomId;
        
        // Update presenter/viewer state
        if (role === 'host') {
            statusBadge.className = 'status-badge presenter';
            statusBadge.querySelector('.text').textContent = 'Broadcasting';
            editorStatus.className = 'editor-status active';
            editorStatus.innerHTML = '<i data-lucide="user-check"></i> Presenting';
        } else {
            statusBadge.className = 'status-badge viewer';
            statusBadge.querySelector('.text').textContent = 'Watching Live';
            editorStatus.className = 'editor-status active';
            editorStatus.innerHTML = '<i data-lucide="tv"></i> Presenter Online';
        }
        lucide.createIcons();

        // Load Monaco and connect socket when fully ready
        loadMonacoEditor(() => {
            connectWebSocket();
        });
    }, 300);
}

function loadMonacoEditor(callback) {
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs' } });
    require(['vs/editor/editor.main'], function () {
        const theme = 'vs-dark';
        
        // Check local storage for autosaved code for this room if host
        let initialCode = '// Loading code from presenter...';
        if (role === 'host') {
            const savedCode = localStorage.getItem(`sharethecode_autosave_${roomId}`);
            initialCode = savedCode ? savedCode : '// Welcome to ShareTheCode!\n// Share your room link with others to start broadcasting live.';
        }
        
        editor = monaco.editor.create(document.getElementById('editor-container'), {
            value: initialCode,
            language: 'javascript',
            theme: theme,
            readOnly: role === 'viewer',
            automaticLayout: true,
            fontSize: 14,
            fontFamily: "'Fira Code', monospace",
            minimap: { enabled: true },
            cursorBlinking: 'blink',
            scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8
            }
        });

        // Register Presenter Event Listeners
        if (role === 'host') {
            editor.onDidChangeModelContent(() => {
                if (isLocalChange) return;
                const currentCode = editor.getValue();
                
                // Autosave to local storage
                localStorage.setItem(`sharethecode_autosave_${roomId}`, currentCode);
                
                sendSocketMessage({
                    type: 'CODE_UPDATE',
                    code: currentCode
                });
            });

            editor.onDidChangeCursorPosition((e) => {
                const selection = editor.getSelection();
                sendSocketMessage({
                    type: 'CURSOR_UPDATE',
                    position: {
                        positionLineNumber: e.position.lineNumber,
                        positionColumn: e.position.column,
                        selectionStartLineNumber: selection.selectionStartLineNumber,
                        selectionStartColumn: selection.selectionStartColumn
                    }
                });
                updateCursorDisplay(e.position.lineNumber, e.position.column);
            });
        }

        if (callback) callback();
    });
}

function updateCursorDisplay(ln, col) {
    cursorPosDisplay.textContent = `Ln ${ln}, Col ${col}`;
}

// WebSocket connection
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    let host = window.location.host;
    
    // Redirect connections to Spring Boot port 8080 if loaded via other dev servers (like Live Server 5500)
    if (host.includes(':5500') || host.includes(':5501') || host.includes(':3000')) {
        host = 'localhost:8080';
    }
    
    const wsUrl = `${protocol}${host}/ws`;
    
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        showToast('Connected to room server!', 'success');
        sendSocketMessage({
            type: 'JOIN',
            roomId: roomId,
            role: role,
            username: username
        });
        
        // If host, immediately sync the local code (autosaved or edited) with the server on connection open
        if (role === 'host') {
            const savedCode = localStorage.getItem(`sharethecode_autosave_${roomId}`);
            if (savedCode) {
                sendSocketMessage({
                    type: 'CODE_UPDATE',
                    code: savedCode
                });
            }
        }
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleIncomingMessage(data);
        } catch (e) {
            console.error('Error parsing socket message:', e);
        }
    };

    socket.onclose = () => {
        showToast('Connection to server lost. Reconnecting...', 'danger');
        statusBadge.className = 'status-badge offline';
        statusBadge.querySelector('.text').textContent = 'Offline';
        editorStatus.className = 'editor-status offline';
        editorStatus.innerHTML = '<i data-lucide="wifi-off"></i> Disconnected';
        lucide.createIcons();
        
        setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = () => {
        showToast('WebSocket connection error.', 'danger');
    };
}

function sendSocketMessage(payload) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    }
}

// Handle Incoming Web Socket Signaling
function handleIncomingMessage(data) {
    switch (data.type) {
        case 'JOIN_ACK':
            if (data.code !== undefined) {
                isLocalChange = true;
                editor.setValue(data.code);
                isLocalChange = false;
            }
            break;

        case 'ROOM_STATE':
            if (editor) {
                isLocalChange = true;
                editor.setValue(data.code);
                isLocalChange = false;
            }
            
            if (data.hasPresenter) {
                editorStatus.className = 'editor-status active';
                editorStatus.innerHTML = '<i data-lucide="tv"></i> Presenter Online';
            } else {
                editorStatus.className = 'editor-status offline';
                editorStatus.innerHTML = '<i data-lucide="alert-circle"></i> Presenter Offline';
                showToast('Presenter is not in the room yet.', 'warning');
            }
            lucide.createIcons();
            break;

        case 'USERS_LIST':
            renderActiveMembers(data.users);
            break;

        case 'CODE_UPDATE':
            if (editor && role === 'viewer') {
                isLocalChange = true;
                const position = editor.getPosition();
                const selections = editor.getSelections();
                
                editor.setValue(data.code);
                
                if (position) editor.setPosition(position);
                if (selections) editor.setSelections(selections);
                isLocalChange = false;
            }
            break;

        case 'CURSOR_UPDATE':
            if (editor && role === 'viewer' && data.position) {
                const pos = data.position;
                const newDecorations = [];
                
                // Presenter Selection
                if (pos.selectionStartLineNumber !== pos.positionLineNumber || pos.selectionStartColumn !== pos.positionColumn) {
                    newDecorations.push({
                        range: new monaco.Range(
                            pos.selectionStartLineNumber,
                            pos.selectionStartColumn,
                            pos.positionLineNumber,
                            pos.positionColumn
                        ),
                        options: {
                            className: 'presenter-selection',
                            hoverMessage: { value: 'Presenter Selection' }
                        }
                    });
                }
                
                // Presenter Cursor
                newDecorations.push({
                    range: new monaco.Range(
                        pos.positionLineNumber,
                        pos.positionColumn,
                        pos.positionLineNumber,
                        pos.positionColumn
                    ),
                    options: {
                        className: 'presenter-cursor',
                        renderOptions: {
                            before: {
                                contentStyle: 'border-left: 2px solid var(--color-accent); height: 100%; position: absolute; margin-left: -1px;'
                            }
                        }
                    }
                });

                presenterDecorations = editor.deltaDecorations(presenterDecorations, newDecorations);
                updateCursorDisplay(pos.positionLineNumber, pos.positionColumn);
            }
            break;

        case 'CHAT':
            renderChatMessage(data);
            break;

        case 'REACTION':
            renderFloatingReaction(data.reaction);
            break;

        case 'PRESENTER_OFFLINE':
            if (role === 'viewer') {
                editorStatus.className = 'editor-status offline';
                editorStatus.innerHTML = '<i data-lucide="alert-circle"></i> Presenter Offline';
                lucide.createIcons();
                showToast('Presenter went offline.', 'warning');
                // Remove presenter decorations
                if (editor) {
                    presenterDecorations = editor.deltaDecorations(presenterDecorations, []);
                }
            }
            break;

        case 'PRESENTER_ONLINE':
            if (role === 'viewer') {
                editorStatus.className = 'editor-status active';
                editorStatus.innerHTML = '<i data-lucide="tv"></i> Presenter Online';
                lucide.createIcons();
                showToast('Presenter came online.', 'success');
            }
            break;
    }
}

// Render active members in sidebar
function renderActiveMembers(users) {
    const membersList = document.getElementById('members-list');
    const userCountSidebar = document.getElementById('user-count-sidebar');
    const userCountDisplay = document.getElementById('user-count-display');
    
    if (userCountSidebar) userCountSidebar.textContent = users.length;
    if (userCountDisplay) userCountDisplay.textContent = users.length;
    
    if (!membersList) return;
    membersList.innerHTML = '';
    
    users.forEach(u => {
        const item = document.createElement('div');
        const isHost = u.role === 'host';
        item.className = `member-item ${isHost ? 'host-member' : 'viewer-member'}`;
        
        let icon = isHost ? 'tv' : 'user';
        
        item.innerHTML = `
            <i data-lucide="${icon}"></i>
            <span>${escapeHtml(u.username)}</span>
            <span class="member-role">${isHost ? 'Presenter' : 'Viewer'}</span>
        `;
        membersList.appendChild(item);
    });
    
    lucide.createIcons();
}

// Live Chat Handlers
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (!msg) return;

    sendSocketMessage({
        type: 'CHAT',
        message: msg
    });

    chatInput.value = '';
});

function renderChatMessage(data) {
    const isSelf = data.username === username;
    const msgElement = document.createElement('div');
    msgElement.className = `chat-msg ${isSelf ? 'self' : 'other'} ${data.role === 'host' ? 'presenter-msg' : ''}`;

    msgElement.innerHTML = `
        <div class="msg-user">
            <span>${data.username}</span>
            <span class="msg-role-tag">${data.role === 'host' ? 'Presenter' : 'Viewer'}</span>
        </div>
        <div class="msg-text">${escapeHtml(data.message)}</div>
    `;

    chatMessages.appendChild(msgElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Floating Emoji reactions
const reactionButtons = document.querySelectorAll('.reaction-btn');
reactionButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const emoji = btn.getAttribute('data-reaction');
        sendSocketMessage({
            type: 'REACTION',
            reaction: emoji
        });
    });
});

function renderFloatingReaction(emoji) {
    const floatEmoji = document.createElement('span');
    floatEmoji.className = 'floating-emoji';
    floatEmoji.textContent = emoji;

    // Randomize initial horizontal position and drift
    const startX = Math.floor(Math.random() * 80) + 10; // 10% to 90%
    const driftX = (Math.random() * 40 - 20) + 'px'; // -20px to 20px

    floatEmoji.style.left = startX + '%';
    floatEmoji.style.setProperty('--drift-x', driftX);

    reactionsContainer.appendChild(floatEmoji);

    // Clean up
    floatEmoji.addEventListener('animationend', () => {
        floatEmoji.remove();
    });
}
