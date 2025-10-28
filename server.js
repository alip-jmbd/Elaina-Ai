const express = require('express');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let apiKeys = [];
let currentKeyIndex = 0;

const GIST_ID = process.env.GIST_ID;
const GIST_FILENAME = process.env.GIST_FILENAME;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// HANYA MIME TYPE YANG DIDUKUNG LANGSUNG OLEH API GEMINI
const NATIVE_SUPPORTED_MIME_TYPES = [
    'image/png', 'image/jpeg', 'image/heic', 'image/heif', 'image/webp',
    'video/mp4', 'video/mpeg', 'video/mov', 'video/avi', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp',
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/flac',
];

const fetchApiKeys = async () => {
    if (!GIST_ID || !GIST_FILENAME) {
        console.error("GIST_ID atau GIST_FILENAME belum diatur di file .env");
        return useFallbackKeys();
    }
    try {
        const headers = GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {};
        const response = await axios.get(`https://api.github.com/gists/${GIST_ID}`, { headers });
        const fileContent = response.data.files[GIST_FILENAME];
        if (!fileContent) {
             throw new Error(`File dengan nama '${GIST_FILENAME}' tidak ditemukan di Gist.`);
        }
        const content = fileContent.content;
        const keysData = JSON.parse(content);
        apiKeys = keysData.keys;
        if (!apiKeys || apiKeys.length === 0) {
            throw new Error("Tidak ada API key yang valid ditemukan di Gist.");
        }
        console.log(`Berhasil mengambil ${apiKeys.length} API key dari Gist.`);
    } catch (error) {
        console.error(`Gagal mengambil API keys dari Gist: ${error.message}`);
        useFallbackKeys();
    }
};

const useFallbackKeys = () => {
    console.log("Menggunakan API key dari .env sebagai fallback.");
    const fallbackKeys = process.env.GEMINI_API_KEYS;
    if (fallbackKeys) {
        apiKeys = fallbackKeys.split(',').map(key => key.trim());
    }
    if (!apiKeys || apiKeys.length === 0) {
        console.error("Tidak ada API key fallback yang ditemukan. Aplikasi akan berhenti.");
        process.exit(1);
    }
     console.log(`Berhasil memuat ${apiKeys.length} API key dari fallback .env.`);
};

const getGenAI = () => {
    if (apiKeys.length === 0) {
        throw new Error("Daftar API key kosong.");
    }
    const apiKey = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    return new GoogleGenerativeAI(apiKey);
};

const fileToGenerativePart = (base64, mimeType) => ({
    inlineData: { data: base64.split(',')[1], mimeType }
});

app.post('/chat', async (req, res) => {
    if (apiKeys.length === 0) {
        return res.status(503).json({ error: 'Layanan tidak tersedia, API key tidak dikonfigurasi.' });
    }
    try {
        const genAI = getGenAI();
        const { history, message, files, settings } = req.body;

        const modelConfig = {
            model: settings.model || "gemini-2.0-flash",
        };
        if (settings.systemInstruction) {
            modelConfig.systemInstruction = { role: "model", parts: [{ text: settings.systemInstruction }] };
        }

        const model = genAI.getGenerativeModel(modelConfig);
        const tools = settings.grounding ? [{ googleSearch: {} }] : [];

        const validHistory = (history || []).map(msg => ({
            role: msg.role,
            parts: msg.parts.flatMap(part => {
                const result = [];
                if (part.text) result.push({ text: part.text });
                // Filter file di history agar hanya yang didukung yang diproses
                if (part.file && NATIVE_SUPPORTED_MIME_TYPES.includes(part.file.mimeType)) {
                    result.push(fileToGenerativePart(part.file.data, part.file.mimeType));
                }
                return result;
            })
        })).filter(msg => msg.parts.length > 0);

        const currentUserParts = [];
        if (message) {
            currentUserParts.push({ text: message });
        }
        // Filter file yang diupload agar HANYA yang didukung API yang dikirim sebagai file
        if (files && files.length > 0) {
            const supportedFiles = files.filter(file => NATIVE_SUPPORTED_MIME_TYPES.includes(file.mimeType));
            supportedFiles.forEach(file => {
                currentUserParts.push(fileToGenerativePart(file.data, file.mimeType));
            });
        }

        if (currentUserParts.length === 0) {
            return res.status(400).json({ error: 'Pesan atau file yang diunggah tidak valid/didukung.' });
        }

        const contents = [...validHistory, { role: "user", parts: currentUserParts }];
        
        const result = await model.generateContent({ contents, tools });
        const response = result.response;
        
        res.json({
            text: response.text(),
            groundingMetadata: response.candidates[0]?.groundingMetadata || null
        });

    } catch (error) {
        console.error('Error saat memanggil Gemini API:', error);
        res.status(500).json({ error: `Terjadi kesalahan saat memproses permintaanmu.` });
    }
});

app.get('/', (req, res) => {
    res.render('index');
});

app.listen(port, async () => {
    await fetchApiKeys();
    console.log(`Server Elaina Chan berjalan di http://localhost:${port}`);
});

module.exports = app;
