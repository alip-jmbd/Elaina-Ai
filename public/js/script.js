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
    const historyList = document.getElementById('history-list');
    const groundingToggleBtn = document.getElementById('grounding-toggle-btn');
    const customConfirm = document.getElementById('custom-confirm');
    const confirmMsg = document.getElementById('confirm-msg');
    const confirmOkBtn = document.getElementById('confirm-ok-btn');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

    let currentChatId = null;
    let chats = {};
    let attachedFiles = [];
    let confirmCallback = null;
    let userHasScrolledUp = false;

    document.getElementById('system-instruction').value = "Kamu adalah Elaina, seorang gadis yang ceria dan baik hati. Gunakan bahasa yang positif dan menyenangkan. Kamu suka memakai emoji ceria seperti ✨, 😊, 🌸, atau 💖 untuk membuat percakapan lebih hidup, tapi tetap terdengar natural dan tidak berlebihan.";
    moment.tz.setDefault("Asia/Jakarta");

    const escapeHtml = (unsafe) => {
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    };
    
    const manualMarkdownParser = (text) => {
        if (!text) return '';
        const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
        
        const codeBlocks = [];
        let tempText = text.replace(codeBlockRegex, (match, lang, code) => {
            const placeholder = `%%CODE_BLOCK_${codeBlocks.length}%%`;
            codeBlocks.push({ placeholder, lang: lang || 'plaintext', code });
            return placeholder;
        });

        let html = escapeHtml(tempText)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/^\s*([*]|-)\s(.*)/gm, '<ul><li>$2</li></ul>')
            .replace(/^\s*(\d+)\.\s(.*)/gm, '<ol><li>$2</li></ol>')
            .replace(/<\/ul>\s*<ul>/g, '')
            .replace(/<\/ol>\s*<ol>/g, '')
            .replace(/\n/g, '<br>');

        codeBlocks.forEach(block => {
            const language = block.lang.toLowerCase();
            const cleanCode = block.code;
            const highlightedCode = hljs.getLanguage(language) ? hljs.highlight(cleanCode, { language }).value : escapeHtml(cleanCode);
            const isRunnable = ['html', 'svg'].includes(language);
            
            let buttonsHtml = `<button class="code-action-btn copy-btn" title="Copy"><img src="/svg/copy.svg" alt="Copy"></button><button class="code-action-btn download-btn" title="Download"><img src="/svg/download.svg" alt="Download"></button>`;
            if (isRunnable) {
                buttonsHtml = `<button class="code-action-btn play-btn" title="Preview"><img src="/svg/play.svg" alt="Play"></button>` + buttonsHtml;
            }

            const blockHtml = `<div class="code-block-wrapper"><div class="code-block-header"><span class="language-name">${language}</span><div class="code-buttons">${buttonsHtml}</div></div><pre><code class="hljs ${language}">${highlightedCode}</code></pre><div class="code-preview"><iframe sandbox="allow-scripts" srcdoc="${escapeHtml(cleanCode)}"></iframe></div><div class="full-code-content" style="display: none;">${escapeHtml(cleanCode)}</div></div>`;
            html = html.replace(block.placeholder, blockHtml);
        });

        return html;
    };


    const getSettings = () => ({
        model: document.getElementById('model-select').value,
        systemInstruction: document.getElementById('system-instruction').value,
        grounding: groundingCheckbox.checked
    });
    
    const toggleThinkingIndicator = (show) => {
        const existing = document.querySelector('.loader-wrapper');
        if (existing) {
            existing.classList.add('fade-out');
            setTimeout(() => existing.remove(), 300);
        }
        if (show) {
            const indicator = document.createElement('div');
            indicator.className = 'loader-wrapper';
            indicator.innerHTML = `<span class="loader-letter">T</span><span class="loader-letter">h</span><span class="loader-letter">i</span><span class="loader-letter">n</span><span class="loader-letter">k</span><span class="loader-letter">i</span><span class="loader-letter">n</span><span class="loader-letter">g</span><span class="loader-letter">.</span><span class="loader-letter">.</span><div class="loader"></div>`;
            chatContainer.appendChild(indicator);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    };

    const smoothRevealEffect = (textDiv, fullText, onComplete) => {
        const chunks = fullText.split(/(\n\s*\n|```[\s\S]*?```)/g).filter(Boolean);
        let i = 0;
        textDiv.innerHTML = '';
        
        function processNextChunk() {
            if (i >= chunks.length) {
                if (onComplete) onComplete();
                return;
            }

            const chunk = chunks[i];
            const isCodeBlock = chunk.startsWith('```');
            const div = document.createElement('div');

            div.innerHTML = manualMarkdownParser(chunk);
            if (!isCodeBlock) {
                div.className = 'reveal-chunk';
                setTimeout(() => div.classList.add('is-visible'), 10);
            }

            textDiv.appendChild(div);
            
            if (!userHasScrolledUp) {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
            
            i++;
            setTimeout(processNextChunk, isCodeBlock ? 10 : 200);
        }
        processNextChunk();
    };

    const addMessageToUI = (sender, data, isPlaceholder = false) => {
        const welcomeContainer = document.getElementById('welcome-container');
        if (welcomeContainer) welcomeContainer.remove();

        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${sender}`;
        
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message';
        
        messageElement.innerHTML = renderPreviewsInChat(data.files);
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        if (!isPlaceholder) {
            textDiv.innerHTML = manualMarkdownParser(String(data.text || ''));
        }
        messageElement.appendChild(textDiv);
        
        const timestamp = document.createElement('div');
        timestamp.className = 'timestamp';
        timestamp.textContent = moment().format('HH:mm');
        
        messageWrapper.appendChild(messageElement);
        messageWrapper.appendChild(timestamp);
        chatContainer.appendChild(messageWrapper);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return { messageWrapper, textDiv };
    };

    const sendMessage = async (messageText) => {
        userHasScrolledUp = false;
        const isSuggestion = typeof messageText === 'string';
        const userMessage = isSuggestion ? messageText : messageInput.value.trim();

        if (!userMessage && attachedFiles.length === 0) return;
        
        let messageForApi = userMessage;
        
        const filesForUi = [...attachedFiles];
        const filesForApi = [];
        
        for (const file of attachedFiles) {
            if (file.content) {
                messageForApi += `\n\n[Membaca file terlampir: ${file.name}]\n\`\`\`\n${file.content}\n\`\`\``;
            } else {
                filesForApi.push(file);
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
            
            toggleThinkingIndicator(false);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Server error.');

            const { messageWrapper, textDiv } = addMessageToUI('ai', { text: '' }, true);
            
            smoothRevealEffect(textDiv, data.text, () => {
                if (data.groundingMetadata && data.groundingMetadata.groundingChunks && data.groundingMetadata.groundingChunks.length > 0) {
                    const sourcesDiv = document.createElement('div');
                    sourcesDiv.className = 'sources-container';
                    let sourcesHtml = '<strong>Sources:</strong><ol>';
                    const uniqueSources = new Map();
                    data.groundingMetadata.groundingChunks.forEach(chunk => {
                        if (chunk.web && chunk.web.uri && !uniqueSources.has(chunk.web.uri)) {
                            uniqueSources.set(chunk.web.uri, chunk.web.title || chunk.web.uri);
                        }
                    });

                    if (uniqueSources.size > 0) {
                        uniqueSources.forEach((title, uri) => {
                            sourcesHtml += `<li><a href="${uri}" target="_blank">${escapeHtml(title || uri)}</a></li>`;
                        });
                        sourcesHtml += '</ol>';
                        sourcesDiv.innerHTML = sourcesHtml;
                        messageWrapper.querySelector('.chat-message').appendChild(sourcesDiv);
                    }
                }
            });

            currentHistory.push({ role: 'model', parts: [{ text: data.text }] });

        } catch (error) {
            toggleThinkingIndicator(false);
            addMessageToUI('ai', { text: `Waduh, ada yang salah nih! Gagal mengirim pesan: ${error.message}` });
        } finally {
            saveChats();
            loadHistoryList();
        }
    };
    
    const getIconForMimeType = (mimeType = '', fileName = '') => {
        const extension = fileName.split('.').pop().toLowerCase();
        if (mimeType.startsWith('audio/')) return 'file-audio.svg';
        if (mimeType.startsWith('video/')) return 'file-video.svg';
        if (mimeType.startsWith('image/')) return 'file-image.svg';
        return 'file-text.svg';
    };

    const renderPreviewsInChat = (files) => {
        if (!files || files.length === 0) return '';
        let html = '<div class="message-files">';
        files.forEach(file => {
            const isMedia = file.mimeType.startsWith('image/') || file.mimeType.startsWith('video/');
            let previewContent = '';
            if (file.mimeType.startsWith('image/') && file.data) {
                previewContent = `<img src="${file.data}" class="preview-icon" alt="${file.name}">`;
            } else {
                const icon = getIconForMimeType(file.mimeType, file.name);
                previewContent = `<img src="/svg/${icon}" class="preview-icon" alt="file icon">`;
            }
            html += `<div class="message-file-item" ${isMedia ? `data-type="${file.mimeType}" data-src="${file.data}"` : ''}>${previewContent}<span class="preview-name">${file.name}</span></div>`;
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
            const isTextFile = file.type.startsWith('text/') || 
                               !file.type ||
                               ['application/json', 'application/javascript', 'application/xml', 'application/x-sh'].includes(file.type) ||
                               /\.(md|txt|js|css|html|json|xml|sh|py|java|c|cpp|cs|rb|go|rs|php|ts|ejs)$/i.test(file.name);

            reader.onload = (e) => {
                if (isTextFile) {
                    attachedFiles.push({ data: null, content: e.target.result, mimeType: file.type || 'text/plain', name: file.name });
                } else {
                    attachedFiles.push({ data: e.target.result, content: null, mimeType: file.type || 'application/octet-stream', name: file.name });
                }
                renderFilePreviews();
            };

            if (isTextFile) {
                reader.readAsText(file);
            } else {
                reader.readAsDataURL(file);
            }
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
            previewItem.innerHTML = `${mediaHtml}<div class="preview-name">${file.name}</div><button class="remove-file-btn" data-index="${index}">&times;</button>`;
            filePreviewContainer.appendChild(previewItem);
        });
    };

    const startNewChat = () => {
        currentChatId = null;
        chatContainer.innerHTML = `<div id="welcome-container"><img src="/img/elaina-logo.png" alt="Elaina Logo" class="welcome-logo"><div id="prompt-suggestions"><div class="suggestion-item">Definisi Elaina</div><div class="suggestion-item">Author Majo no tabi</div><div class="suggestion-item">Kecantikan Elaina</div><div class="suggestion-item">When yah s2 Majo Tabi</div></div></div>`;
        loadHistoryList();
    };
    
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

    chatContainer.addEventListener('scroll', () => {
        if (chatContainer.scrollTop + chatContainer.clientHeight < chatContainer.scrollHeight - 20) {
            userHasScrolledUp = true;
        } else {
            userHasScrolledUp = false;
        }
    });
    sendBtn.addEventListener('click', () => sendMessage());
    messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files));
    historyBtn.addEventListener('click', () => toggleSidebar(historySidebar));
    settingsBtn.addEventListener('click', () => toggleSidebar(settingsSidebar));
    overlay.addEventListener('click', () => { closeAllSidebars(); });
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
        const copyBtn = e.target.closest('.copy-btn');
        if (copyBtn) {
            const code = copyBtn.closest('.code-block-wrapper').querySelector('.full-code-content').textContent;
            navigator.clipboard.writeText(code);
        }
        
        const downloadBtn = e.target.closest('.download-btn');
        if (downloadBtn) {
            const code = downloadBtn.closest('.code-block-wrapper').querySelector('.full-code-content').textContent;
            const lang = downloadBtn.closest('.code-block-header').querySelector('.language-name').textContent.toLowerCase();
            const extensionMap = { 'javascript': 'js', 'python': 'py', 'html': 'html', 'css': 'css', 'shell': 'sh' };
            const extension = extensionMap[lang] || lang || 'txt';
            const blob = new Blob([code], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `code.${extension}`; a.click(); URL.revokeObjectURL(a.href);
        }

        const playBtn = e.target.closest('.play-btn');
        if (playBtn) {
            const wrapper = playBtn.closest('.code-block-wrapper');
            const isActive = wrapper.classList.toggle('preview-active');
            const icon = playBtn.querySelector('img');
            icon.src = isActive ? '/svg/x.svg' : '/svg/play.svg';
        }
    });

    loadChats();
    if (Object.keys(chats).length > 0) {
        loadChat(Object.keys(chats).reverse());
    } else {
        startNewChat();
    }
    syncGroundingButton();
});
