const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const apiKeys = (process.env.GEMINI_API_KEYS || '').split(',').filter(key => key);
let currentApiKeyIndex = 0;

const getNextApiKey = () => {
    if (apiKeys.length === 0) {
        throw new Error("Tidak ada GEMINI_API_KEYS yang ditemukan di file .env");
    }
    const key = apiKeys[currentApiKeyIndex];
    currentApiKeyIndex = (currentApiKeyIndex + 1) % apiKeys.length;
    return key;
};

app.get('/', (req, res) => {
    res.render('index');
});

app.post('/chat', async (req, res) => {
    let apiKey;
    try {
        apiKey = getNextApiKey();
        const genAI = new GoogleGenerativeAI(apiKey);
        const { history, message, settings, files: bodyFiles } = req.body;

        const transformedHistory = (history || []).map(entry => {
            return {
                ...entry,
                parts: entry.parts.map(part => {
                    if (part.file && part.file.data && !part.text) {
                        return {
                            inlineData: {
                                mimeType: part.file.mimeType,
                                data: part.file.data.split(',')[1]
                            }
                        };
                    }
                    return part;
                }).filter(Boolean)
            };
        });

        const model = genAI.getGenerativeModel({
            model: settings.model || "gemini-2.0-flash",
            systemInstruction: settings.systemInstruction,
        });

        const chat = model.startChat({
            history: transformedHistory,
            generationConfig: {
                maxOutputTokens: 8192,
            },
        });

        const parts = [{ text: message }];
        if (bodyFiles && Array.isArray(bodyFiles)) {
            bodyFiles.forEach(file => {
                parts.push({
                    inlineData: {
                        mimeType: file.mimeType,
                        data: file.data.split(',')[1]
                    }
                });
            });
        }
        
        const tools = settings.grounding ? [{ "googleSearch": {} }] : [];
        const result = await chat.sendMessage(parts, { tools });
        const response = result.response;
        
        const responseText = response.text();
        const groundingMetadata = response.groundingMetadata;

        res.json({ text: responseText, groundingMetadata });

    } catch (error) {
        console.error(`Error with API key ending in ...${apiKey ? apiKey.slice(-4) : 'N/A'}:`, error.message);
        if (error.message.includes('429')) {
             res.status(429).json({ error: 'Terlalu banyak permintaan, coba lagi sesaat. Sistem akan mencoba kunci API lain secara otomatis.' });
        } else {
             res.status(500).json({ error: error.message });
        }
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    if (apiKeys.length > 0) {
        console.log(`Successfully loaded ${apiKeys.length} API keys.`);
    } else {
        console.error("WARNING: No API keys loaded. Please check your .env file.");
    }
});
