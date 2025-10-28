const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const path = require('path');
const { Octokit } = require('@octokit/rest');
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

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const gistId = process.env.GIST_ID;
const gistFilename = process.env.GIST_FILENAME;

const readFromGist = async () => {
    try {
        const gist = await octokit.gists.get({ gist_id: gistId });
        const content = gist.data.files[gistFilename]?.content;
        return content ? JSON.parse(content) : {};
    } catch (error) {
        console.error("Error reading from Gist:", error);
        return {};
    }
};

const writeToGist = async (data) => {
    try {
        await octokit.gists.update({
            gist_id: gistId,
            files: {
                [gistFilename]: {
                    content: JSON.stringify(data, null, 2),
                },
            },
        });
    } catch (error) {
        console.error("Error writing to Gist:", error);
    }
};

app.get('/', (req, res) => {
    res.render('index');
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 25 * 1024 * 1024 } });

const fileToGenerativePart = (file) => {
    return {
        inlineData: {
            data: file.buffer.toString("base64"),
            mimeType: file.mimetype,
        },
    };
};

app.post('/chat', upload.array('files', 5), async (req, res) => {
    try {
        const apiKey = getNextApiKey();
        const genAI = new GoogleGenerativeAI(apiKey);

        const { history, message, settings } = req.body;
        const model = genAI.getGenerativeModel({
            model: settings.model || "gemini-1.5-flash",
            systemInstruction: settings.systemInstruction,
        });

        const chat = model.startChat({
            history: history || [],
            generationConfig: {
                maxOutputTokens: 2048,
            },
        });

        const parts = [{ text: message }];
        if (req.body.files && Array.isArray(req.body.files)) {
            req.body.files.forEach(file => {
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
        console.error('Error during chat processing:', error);
        res.status(500).json({ error: error.message });
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
