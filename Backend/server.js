const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

if (!fs.existsSync('uploads')){
    fs.mkdirSync('uploads');
}
const upload = multer({ dest: 'uploads/' }); 

// In-Memory (RAM)
let users = []; 
const files = [];

// --- ROUTES ---

// see who is currently registered
app.get('/api/users', (req, res) => {
    // returns an array of usernames: ["bob", "jeff"]
    res.status(200).json(users.map(u => u.username)); 
});

// 1. Upload User Public Key 
app.post('/api/keys', (req, res) => {
    const { username, publicKey } = req.body;
    
    // If user exists, update their key. Otherwise, add them.
    const existingIndex = users.findIndex(u => u.username === username);
    if (existingIndex > -1) {
        users[existingIndex].publicKey = publicKey;
    } else {
        users.push({ username, publicKey });
    }
    
    console.log(`Key saved for user: ${username}`);
    res.status(201).json({ message: "Key saved successfully!" });
});

// 2. Get a User's Public Key
app.get('/api/keys/:username', (req, res) => {
    const user = users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: "User not found" });
    
    res.status(200).json({ publicKey: user.publicKey });
});

// 3. Upload Encrypted File
app.post('/api/files/share', upload.single('encryptedFile'), (req, res) => {
    const { recipient } = req.body; 
    
    const newFile = {
        fileId: req.file.filename,
        originalName: req.file.originalname,
        recipient: recipient
    };
    files.push(newFile);

    console.log(`File saved for: ${recipient}`);
    res.status(201).json({ message: "File uploaded!", fileId: newFile.fileId });
});

// 4. Get a user's Inbox (files sent to them)
app.get('/api/files/inbox/:username', (req, res) => {
    const userFiles = files.filter(f => f.recipient === req.params.username);
    res.status(200).json(userFiles);
});

// 5. Download the raw encrypted file
const path = require('path');
app.get('/api/files/download/:fileId', (req, res) => {
    const fileRecord = files.find(f => f.fileId === req.params.fileId);
    if (!fileRecord) return res.status(404).json({ error: "File not found" });
    
    const filePath = path.join(__dirname, 'uploads', fileRecord.fileId);
    res.sendFile(filePath);
});

app.listen(PORT, () => {
    console.log(`Backend is ALIVE on http://localhost:${PORT}`);
});