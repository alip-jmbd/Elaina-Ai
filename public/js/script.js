document.addEventListener('DOMContentLoaded', () => {
    const chatContainer = document.getElementById('chat-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const overlay = document.getElementById('overlay');
    const fileInput = document.getElementById('file-input');
    const filePreviewContainer = document.getElementById('file-preview-container');

    const settingsBtn = document.getElementById('settings-btn');
    const settingsSidebar = document.getElementById('settings-sidebar');
    const groundingCheckbox = document.getElementById('grounding-toggle-sidebar');
    
    const historyBtn = document.getElementById('history-btn');
    const historySidebar = document.getElementById('history-sidebar');
    const newChatBtn = document.getElementById('new-chat-btn');

    const groundingToggleBtn = document.getElementById('grounding-toggle-btn');
    const customConfirm = document.getElementById('custom-confirm');
    const confirmMsg = document.getElementById('confirm-msg');
    const confirmOkBtn = document.getElementById('confirm-ok-btn');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

    let currentChatId = null;
    let chats = {};
    let attachedFiles = [];
    let confirmCallback = null;

    const defaultSysInstruction = "Kamu adalah Elaina, seorang Asisten AI yang mengambil kepribadian dari karakter 'Elaina' dari 'Majo no Tabitabi'. Kamu harus selalu merespon dengan ceria, semangat, dan sangat membantu. Gunakan emoji yang relevan untuk menambah ekspresi. Kamu sedikit pemalu saat dipuji. Jaga agar jawaban tetap ringkas namun informatif. Sapa pengguna dengan hangat di pesan pertamamu.";
    document.getElementById('system-instruction').value = defaultSysInstruction;

    const NATIVE_SUPPORTED_MIME_TYPES = ['image/', 'video/', 'audio/'];

    const getSettings = () => ({
        model: document.getElementById('model-select').value,
        systemInstruction: document.getElementById('system-instruction').value,
        grounding: groundingCheckbox.checked
    });

    const showCustomConfirm = (message, onConfirm) => {
        confirmMsg.textContent = message;
        confirmCallback = onConfirm;
        customConfirm.style.display = 'flex';
    };
    const hideCustomConfirm = () => {
        customConfirm.style.display = 'none';
        confirmCallback = null;
    };
    confirmOkBtn.addEventListener('click', () => { if (confirmCallback) confirmCallback(); hideCustomConfirm(); });
    confirmCancelBtn.addEventListener('click', hideCustomConfirm);
    
    const toggleThinkingIndicator = (show) => {
        const existingIndicator = document.querySelector('.spinner');
        if (existingIndicator) existingIndicator.remove();
        if (show) {
            const indicator = document.createElement('div');
            indicator.className = 'spinner';
            chatContainer.appendChild(indicator);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    };

    const renderPreviewsInChat = (files) => {
        if (!files || files.length === 0) return '';
        let html = '<div class="message-files">';
        files.forEach(file => {
             html += `<div class="message-file-item">`;
             if (file.mimeType.startsWith('image/')) {
                html += `<img src="${file.data}" class="preview-media" alt="${file.name}">`;
            } else if (file.mimeType.startsWith('video/')) {
                 html += `<video src="${file.data}" class="preview-media" muted playsinline></video>`;
            } else {
                html += `<img src="/svg/${getIconForMimeType(file.mimeType, file.name)}" class="preview-icon">`;
            }
            html += `<span class="preview-name">${file.name}</span></div>`;
        });
        html += '</div>';
        return html;
    };

    const addMessageToUI = (sender, data) => {
        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message', sender);
        messageElement.innerHTML = renderPreviewsInChat(data.files);
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.innerHTML = marked.parse(data.text || '', { gfm: true, breaks: true });
        messageElement.appendChild(textDiv);
        if (data.groundingMetadata?.groundingAttributions?.length > 0) {
            const sourcesDiv = document.createElement('div');
            sourcesDiv.className = 'grounding-sources';
            sourcesDiv.innerHTML = '<strong>Sources:</strong> ';
            data.groundingMetadata.groundingAttributions.forEach((source, index) => {
                const a = document.createElement('a');
                a.href = source.web.uri;
                a.target = '_blank';
                a.innerText = `[${index + 1}] ${source.web.title}`;
                sourcesDiv.appendChild(a);
            });
            messageElement.appendChild(sourcesDiv);
        }
        if ((data.files && data.files.length > 0) || data.text) {
             messageElement.appendChild(document.createElement('hr'));
        }
        chatContainer.appendChild(messageElement);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    };
    
    const sendMessage = async () => {
        let message = messageInput.value.trim();
        if (!message && attachedFiles.length === 0) return;
        const filesForUi = [...attachedFiles];
        const filesForApi = [];
        let fileContentForPrompt = '';
        for (const file of attachedFiles) {
            if (NATIVE_SUPPORTED_MIME_TYPES.some(type => file.mimeType.startsWith(type))) { filesForApi.push(file); } 
            else { fileContentForPrompt += `\n\n[File terlampir: ${file.name} (jenis: ${file.mimeType})]`; }
        }
        const combinedMessage = message + fileContentForPrompt;
        addMessageToUI('user', { text: message, files: filesForUi });
        messageInput.value = '';
        attachedFiles = [];
        filePreviewContainer.innerHTML = '';
        if (!currentChatId) {
            currentChatId = `chat_${Date.now()}`;
            const title = message.substring(0, 30) || "Media Chat";
            chats[currentChatId] = { history: [], title: title };
        }
        const currentHistory = chats[currentChatId].history;
        const userPartsForHistory = [{ text: message }];
        filesForUi.forEach(f => userPartsForHistory.push({ file: f }));
        currentHistory.push({ role: 'user', parts: userPartsForHistory });
        toggleThinkingIndicator(true);
        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ history: currentHistory.slice(0, -1), message: combinedMessage, files: filesForApi, settings: getSettings() }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Server error.');
            addMessageToUI('ai', data);
            currentHistory.push({ role: 'model', parts: [{ text: data.text }] });
        } catch (error) {
            console.error('Error:', error);
            addMessageToUI('ai', { text: `Maaf, terjadi kesalahan: ${error.message}` });
        } finally {
            toggleThinkingIndicator(false);
            saveChats();
            loadHistoryList();
        }
    };
    
    const getIconForMimeType = (mimeType = '', fileName = '') => {
        if (mimeType.startsWith('audio/')) return 'file-audio.svg';
        if (mimeType.startsWith('video/')) return 'file-video.svg';
        if (mimeType === 'application/zip' || fileName.endsWith('.zip')) return 'file-zip.svg';
        return 'file-text.svg';
    };

    const handleFileUpload = (files) => {
        if (attachedFiles.length + files.length > 5) { alert("Maksimal 5 file."); return; }
        for (const file of files) {
            const reader = new FileReader();
            reader.onload = (e) => { attachedFiles.push({ data: e.target.result, mimeType: file.type, name: file.name }); renderFilePreviews(); };
            reader.readAsDataURL(file);
        }
    };
    
    const renderFilePreviews = () => {
        filePreviewContainer.innerHTML = '';
        attachedFiles.forEach((file, index) => {
            const previewItem = document.createElement('div');
            previewItem.className = 'file-preview-item';
            if (file.mimeType.startsWith('image/')) {
                previewItem.innerHTML = `<img src="${file.data}" class="preview-media" alt="preview">`;
            } else if (file.mimeType.startsWith('video/')) {
                previewItem.innerHTML = `<video src="${file.data}" class="preview-media" muted playsinline></video>`;
            } else {
                 previewItem.innerHTML = `<img src="/svg/${getIconForMimeType(file.mimeType, file.name)}" class="preview-icon" alt="file icon">`;
            }
            const nameDiv = document.createElement('div');
            nameDiv.className = 'preview-name';
            nameDiv.innerText = file.name;
            previewItem.appendChild(nameDiv);
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-file-btn';
            removeBtn.innerHTML = '&times;';
            removeBtn.onclick = () => { attachedFiles.splice(index, 1); renderFilePreviews(); };
            previewItem.appendChild(removeBtn);
            filePreviewContainer.appendChild(previewItem);
        });
    };
    
    const toggleSidebar = (sidebar, button) => {
        const isOpen = !sidebar.classList.contains('open');
        closeAllSidebars();
        if (isOpen) {
            sidebar.classList.add('open');
            if (button) button.classList.add('open');
            overlay.classList.add('active');
            document.body.classList.add('sidebar-open');
        }
    };

    const closeAllSidebars = () => {
        [historySidebar, settingsSidebar].forEach(s => s.classList.remove('open'));
        [historyBtn, settingsBtn].forEach(b => b.classList.remove('open'));
        overlay.classList.remove('active');
        document.body.classList.remove('sidebar-open');
    };

    const syncGroundingButton = () => {
        groundingToggleBtn.classList.toggle('active', groundingCheckbox.checked);
    };
    
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files));
    settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSidebar(settingsSidebar, settingsBtn); });
    historyBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSidebar(historySidebar, historyBtn); });
    overlay.addEventListener('click', closeAllSidebars);
    document.querySelectorAll('.close-btn').forEach(btn => btn.addEventListener('click', closeAllSidebars));
    groundingToggleBtn.addEventListener('click', () => { groundingCheckbox.checked = !groundingCheckbox.checked; syncGroundingButton(); });
    groundingCheckbox.addEventListener('change', syncGroundingButton);

    const saveChats = () => localStorage.setItem('elaina_chats', JSON.stringify(chats));
    const loadChats = () => { chats = JSON.parse(localStorage.getItem('elaina_chats') || '{}'); };

    const loadHistoryList = () => {
        historyList.innerHTML = '';
        Object.keys(chats).reverse().forEach(chatId => {
            const chat = chats[chatId];
            const li = document.createElement('li');
            li.dataset.chatId = chatId;
            const titleSpan = document.createElement('span');
            titleSpan.className = 'history-title';
            titleSpan.innerText = chat.title || 'Untitled Chat';
            li.appendChild(titleSpan);
            if (chatId === currentChatId) li.classList.add('active');
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-history-btn';
            deleteBtn.innerHTML = '<img src="/svg/trash.svg" alt="Delete">';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                showCustomConfirm(`Hapus chat "${chat.title}"?`, () => {
                    delete chats[chatId];
                    if (currentChatId === chatId) startNewChat();
                    saveChats();
                    loadHistoryList();
                });
            };
            li.appendChild(deleteBtn);
            li.onclick = () => loadChat(chatId);
            historyList.appendChild(li);
        });
    };

    const loadChat = (chatId) => {
        currentChatId = chatId;
        const chat = chats[chatId];
        chatContainer.innerHTML = '';
        if (chat && chat.history) {
            chat.history.forEach(msg => {
                const parts = { text: '', files: [] };
                (msg.parts || []).forEach(part => {
                    if (part.text) parts.text = part.text;
                    if (part.file) parts.files.push(part.file);
                });
                const role = msg.role === 'model' ? 'ai' : msg.role;
                addMessageToUI(role, parts);
            });
        }
        loadHistoryList();
        closeAllSidebars();
    };

    const startNewChat = () => {
        currentChatId = null;
        chatContainer.innerHTML = '';
        messageInput.focus();
        loadHistoryList();
    };

    newChatBtn.addEventListener('click', () => {
        startNewChat();
        closeAllSidebars();
    });
    
    loadChats();
    loadHistoryList();
    const chatIds = Object.keys(chats);
    if (chatIds.length > 0) { loadChat(chatIds[chatIds.length - 1]); } else { startNewChat(); }
    syncGroundingButton();
});
