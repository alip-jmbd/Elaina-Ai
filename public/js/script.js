document.addEventListener('DOMContentLoaded', () => {
    // --- Element Selectors ---
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
    const historyList = document.getElementById('history-list');
    const groundingToggleBtn = document.getElementById('grounding-toggle-btn');
    const customConfirm = document.getElementById('custom-confirm');
    const confirmMsg = document.getElementById('confirm-msg');
    const confirmOkBtn = document.getElementById('confirm-ok-btn');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
    const mediaPreviewModal = document.getElementById('media-preview-modal');
    const mediaModalContent = document.getElementById('media-modal-content');
    const codeModal = document.getElementById('code-modal');
    const codeModalContent = document.getElementById('code-modal-content');

    // --- State Variables ---
    let currentChatId = null;
    let chats = {};
    let attachedFiles = [];
    let confirmCallback = null;

    // --- Initial Setup ---
    document.getElementById('system-instruction').value = "Watashi wa Elaina, si penyihir jenius yang siap membantumu! ✨ Tanyakan apa saja, aku akan menjawabnya dengan semangat! 🪄 Tapi jangan puji aku terus ya, nanti aku malu... >.<";
    moment.tz.setDefault("Asia/Jakarta"); 

    const renderer = new marked.Renderer();
    renderer.code = (code, language) => {
        const validLanguage = hljs.getLanguage(language) ? language : 'plaintext';
        const highlightedCode = hljs.highlight(code, { language: validLanguage }).value;
        const isLong = code.split('\n').length > 15;
        return `<div class="code-block-wrapper ${isLong ? 'collapsible' : ''}"><div class="code-block-header"><span class="language-name">${validLanguage}</span><div class="code-buttons"><button class="code-action-btn copy-btn"><img src="/svg/copy.svg" alt="Copy"></button><button class="code-action-btn download-btn"><img src="/svg/download.svg" alt="Download"></button></div></div><pre><code class="hljs ${validLanguage}">${highlightedCode}</code></pre>${isLong ? '<div class="fade-overlay"><span>Show more</span></div>' : ''}<div class="full-code-content" style="display: none;">${code}</div></div>`;
    };
    marked.setOptions({ renderer });
    
    // --- Core Functions ---
    const getSettings = () => ({
        model: document.getElementById('model-select').value,
        systemInstruction: document.getElementById('system-instruction').value,
        grounding: groundingCheckbox.checked
    });
    
    const toggleThinkingIndicator = (show) => {
        const existing = document.querySelector('.spinner-wrapper');
        if (existing) existing.remove();
        if (show) {
            const indicator = document.createElement('div');
            indicator.className = 'spinner-wrapper';
            indicator.innerHTML = `<div class="spinner"></div><div class="spinner-text">Thinking...</div>`;
            chatContainer.appendChild(indicator);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    };

    const addMessageToUI = (sender, data) => {
        const welcomeContainer = document.getElementById('welcome-container');
        if (welcomeContainer) welcomeContainer.remove();

        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${sender}`;
        
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message';
        
        messageElement.innerHTML = renderPreviewsInChat(data.files);
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.innerHTML = marked.parse(data.text || '', { gfm: true, breaks: true });
        messageElement.appendChild(textDiv);
        
        const sourceUrls = data.text.match(/\[Source \d+\]: (https?:\/\/[^\s]+)/g);
        if (sourceUrls) {
            const sourcesDiv = document.createElement('blockquote');
            let sourcesHtml = '<strong>Sumber Informasi:</strong><br>';
            sourceUrls.forEach(url => {
                 const urlPart = url.split(': ')[1];
                 sourcesHtml += `<a href="${urlPart}" target="_blank">${urlPart}</a><br>`;
            });
            sourcesDiv.innerHTML = sourcesHtml;
            messageElement.appendChild(sourcesDiv);
            textDiv.innerHTML = textDiv.innerHTML.replace(/\[Source \d+\]: https?:\/\/[^\s]+/g, '');
        }

        const timestamp = document.createElement('div');
        timestamp.className = 'timestamp';
        timestamp.textContent = moment().format('HH:mm');
        
        messageWrapper.appendChild(messageElement);
        messageWrapper.appendChild(timestamp);
        chatContainer.appendChild(messageWrapper);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    };

    const sendMessage = async (messageText) => {
        const isSuggestion = typeof messageText === 'string';
        const userMessage = isSuggestion ? messageText : messageInput.value.trim();

        if (!userMessage && attachedFiles.length === 0) return;
        
        let messageForApi = userMessage;
        if (groundingCheckbox.checked && userMessage) {
            messageForApi += "\n\n(mohon sertakan URL sumbernya dalam format markdown `[Source 1]: URL`)";
        }

        const filesForUi = [...attachedFiles];
        const filesForApi = [];
        for (const file of attachedFiles) {
            if (['image/', 'video/', 'audio/'].some(type => file.mimeType.startsWith(type))) {
                filesForApi.push(file);
            } else {
                messageForApi += `\n\n[File terlampir: ${file.name}]`;
            }
        }
        
        addMessageToUI('user', { text: userMessage, files: filesForUi });
        if (!isSuggestion) messageInput.value = '';
        attachedFiles = [];
        filePreviewContainer.innerHTML = '';

        if (!currentChatId) {
            currentChatId = `chat_${Date.now()}`;
            chats[currentChatId] = { history: [], title: userMessage.substring(0, 30) || "Media Chat" };
        }
        
        const currentHistory = chats[currentChatId].history;
        currentHistory.push({ role: 'user', parts: [{ text: userMessage }, ...filesForUi.map(f => ({ file: f }))] });
        
        toggleThinkingIndicator(true);
        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    history: currentHistory.slice(0, -1),
                    message: messageForApi,
                    files: filesForApi,
                    settings: getSettings()
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Server error.');
            addMessageToUI('ai', data);
            currentHistory.push({ role: 'model', parts: [{ text: data.text }] });
        } catch (error) {
            addMessageToUI('ai', { text: `Waduh, ada sihir yang salah nih! 🪄 Gagal mengirim pesan: ${error.message}` });
        } finally {
            toggleThinkingIndicator(false);
            saveChats();
            loadHistoryList();
        }
    };
    
    const getIconForMimeType = (mimeType = '', fileName = '') => {
        const extension = fileName.split('.').pop().toLowerCase();
        if (mimeType.startsWith('audio/')) return 'file-audio.svg';
        if (mimeType.startsWith('video/')) return 'file-video.svg';
        if (mimeType.startsWith('image/')) return 'file-image.svg';
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension) || mimeType.includes('zip')) return 'file-zip.svg';
        return 'file-text.svg';
    };

    const renderPreviewsInChat = (files) => {
        if (!files || files.length === 0) return '';
        let html = '<div class="message-files">';
        files.forEach(file => {
            const icon = getIconForMimeType(file.mimeType, file.name);
            const isMedia = file.mimeType.startsWith('image/') || file.mimeType.startsWith('video/');
            html += `<div class="message-file-item" ${isMedia ? `data-type="${file.mimeType}" data-src="${file.data}"` : ''}>
                        <img src="/svg/${icon}" class="preview-icon">
                        <span class="preview-name">${file.name}</span>
                     </div>`;
        });
        html += '</div>';
        return html;
    };

    const handleFileUpload = (files) => {
        if (attachedFiles.length + files.length > 5) {
            alert("Maksimal 5 file.");
            return;
        }
        for (const file of files) {
            const reader = new FileReader();
            reader.onload = (e) => {
                attachedFiles.push({ data: e.target.result, mimeType: file.type, name: file.name });
                renderFilePreviews();
            };
            reader.readAsDataURL(file);
        }
    };

    const renderFilePreviews = () => {
        filePreviewContainer.innerHTML = '';
        attachedFiles.forEach((file, index) => {
            const previewItem = document.createElement('div');
            previewItem.className = 'file-preview-item';
            let mediaHtml = '';
            if (file.mimeType.startsWith('image/')) {
                mediaHtml = `<img src="${file.data}" class="preview-media" alt="preview">`;
            } else if (file.mimeType.startsWith('video/')) {
                mediaHtml = `<video src="${file.data}" class="preview-media" muted playsinline></video>`;
            } else {
                mediaHtml = `<img src="/svg/${getIconForMimeType(file.mimeType, file.name)}" class="preview-icon" alt="file icon">`;
            }
            previewItem.innerHTML = `${mediaHtml}
                                    <div class="preview-name">${file.name}</div>
                                    <button class="remove-file-btn" data-index="${index}">&times;</button>`;
            filePreviewContainer.appendChild(previewItem);
        });
    };

    const startNewChat = () => {
        currentChatId = null;
        chatContainer.innerHTML = `
            <div id="welcome-container">
                <img src="/img/elaina-logo.png" alt="Elaina Logo" class="welcome-logo">
                <div id="prompt-suggestions">
                    <div class="suggestion-item">Definisi Elaina</div>
                    <div class="suggestion-item">Author Majo no tabi</div>
                    <div class="suggestion-item">Kecantikan Elaina</div>
                    <div class="suggestion-item">When yah s2 Majo Tabi</div>
                </div>
            </div>`;
        loadHistoryList();
    };
    
    // --- Modals, Sidebars, History ---
    const showModal = (modal) => modal.style.display = 'flex';
    const closeModal = (modal) => modal.style.display = 'none';
    const showCustomConfirm = (message, onConfirm, okText = 'Hapus', cancelText = 'Batal') => {
        confirmMsg.textContent = message;
        confirmOkBtn.textContent = okText;
        confirmCancelBtn.textContent = cancelText;
        confirmCallback = onConfirm;
        showModal(customConfirm);
    };
    const toggleSidebar = (sidebar) => {
        const isOpen = !sidebar.classList.contains('open');
        closeAllSidebars();
        if (isOpen) { sidebar.classList.add('open'); overlay.classList.add('active'); }
    };
    const closeAllSidebars = () => {
        document.querySelectorAll('.sidebar.open').forEach(s => s.classList.remove('open'));
        overlay.classList.remove('active');
    };
    const syncGroundingButton = () => {
        groundingToggleBtn.classList.toggle('active', groundingCheckbox.checked);
    };
    const saveChats = () => localStorage.setItem('elaina_chats', JSON.stringify(chats));
    const loadChats = () => chats = JSON.parse(localStorage.getItem('elaina_chats') || '{}');
    const loadHistoryList = () => {
        historyList.innerHTML = '';
        Object.keys(chats).reverse().forEach(chatId => {
            const li = document.createElement('li');
            li.dataset.chatId = chatId;
            li.className = (chatId === currentChatId) ? 'active' : '';
            li.innerHTML = `<span class="history-title">${chats[chatId].title || 'Untitled'}</span><button class="delete-history-btn"><img src="/svg/trash.svg"></button>`;
            historyList.appendChild(li);
        });
    };
    const loadChat = (chatId) => {
        currentChatId = chatId;
        chatContainer.innerHTML = '';
        (chats[chatId]?.history || []).forEach(msg => {
            const role = msg.role === 'model' ? 'ai' : msg.role;
            const textPart = msg.parts.find(p => p.text)?.text || '';
            const fileParts = msg.parts.filter(p => p.file).map(p => p.file);
            addMessageToUI(role, { text: textPart, files: fileParts });
        });
        loadHistoryList();
        closeAllSidebars();
    };

    // --- Event Listeners ---
    sendBtn.addEventListener('click', () => sendMessage());
    messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files));
    historyBtn.addEventListener('click', () => toggleSidebar(historySidebar));
    settingsBtn.addEventListener('click', () => toggleSidebar(settingsSidebar));
    overlay.addEventListener('click', () => { closeAllSidebars(); closeModal(mediaPreviewModal); closeModal(codeModal); });
    document.querySelectorAll('.close-btn').forEach(btn => btn.addEventListener('click', closeAllSidebars));
    document.querySelectorAll('.close-modal-btn').forEach(btn => btn.addEventListener('click', () => { closeModal(mediaPreviewModal); closeModal(codeModal); }));
    newChatBtn.addEventListener('click', () => { startNewChat(); closeAllSidebars(); });
    confirmOkBtn.addEventListener('click', () => { if (confirmCallback) confirmCallback(); closeModal(customConfirm); });
    confirmCancelBtn.addEventListener('click', () => closeModal(customConfirm));
    groundingToggleBtn.addEventListener('click', () => { groundingCheckbox.checked = !groundingCheckbox.checked; syncGroundingButton(); });
    groundingCheckbox.addEventListener('change', syncGroundingButton);
    filePreviewContainer.addEventListener('click', (e) => {
        if (e.target.closest('.remove-file-btn')) {
            attachedFiles.splice(parseInt(e.target.closest('.remove-file-btn').dataset.index), 1);
            renderFilePreviews();
        }
    });
    historyList.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (!li) return;
        if (e.target.closest('.delete-history-btn')) {
            showCustomConfirm(`Hapus chat "${chats[li.dataset.chatId].title}"?`, () => {
                delete chats[li.dataset.chatId];
                if (currentChatId === li.dataset.chatId) startNewChat();
                saveChats(); loadHistoryList();
            });
        } else {
            loadChat(li.dataset.chatId);
        }
    });
    chatContainer.addEventListener('click', (e) => {
        const fileItem = e.target.closest('.message-file-item[data-type]');
        if (fileItem) {
            const type = fileItem.dataset.type, src = fileItem.dataset.src;
            if (type.startsWith('image/')) {
                mediaModalContent.innerHTML = `<img src="${src}">`; showModal(mediaPreviewModal);
            } else if (type.startsWith('video/')) {
                mediaModalContent.innerHTML = `<video src="${src}" controls autoplay></video>`; showModal(mediaPreviewModal);
            }
        }
        const suggestion = e.target.closest('.suggestion-item');
        if (suggestion) sendMessage(suggestion.textContent);
        if (e.target.closest('.copy-btn')) {
            const code = e.target.closest('.code-block-wrapper').querySelector('.full-code-content').textContent;
            navigator.clipboard.writeText(code);
        }
        if (e.target.closest('.download-btn')) {
            const code = e.target.closest('.code-block-wrapper').querySelector('.full-code-content').textContent;
            const lang = e.target.closest('.code-block-header').querySelector('.language-name').textContent;
            const blob = new Blob([code], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `code.${lang}`; a.click(); URL.revokeObjectURL(a.href);
        }
        if (e.target.closest('.fade-overlay')) {
            const codeWrapper = e.target.closest('.code-block-wrapper');
            const lang = codeWrapper.querySelector('.language-name').textContent;
            const code = codeWrapper.querySelector('.full-code-content').textContent;
            codeModalContent.innerHTML = `<div class="code-block-header"><span>${lang}</span></div><pre><code class="hljs ${lang}">${hljs.highlight(code, { language: lang }).value}</code></pre>`;
            showModal(codeModal);
        }
    });

    // --- Initialization ---
    loadChats();
    if (Object.keys(chats).length > 0) {
        loadChat(Object.keys(chats).reverse()[0]);
    } else {
        startNewChat();
    }
    syncGroundingButton(); // DIPERBAIKI: Memanggil fungsi ini saat load
});
