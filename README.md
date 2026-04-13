# Simplified E2EE File Sharing App

A simple, educational end-to-end encrypted (E2EE) file-sharing application designed to demonstrate the fundamentals of public-key cryptography.

To keep the concepts clear and easy to understand for academic review, this project intentionally uses **Pure RSA-OAEP** encryption. Due to the mathematical constraints of encrypting data directly with an RSA public key, the application enforces a strict **190-byte limitation** on uploaded files.

## Architecture Overview

The application is split into two parts:

### Frontend

- Entirely contained within `App.vue` for simplicity and ease of review.
- Built using Vue 3
- All cryptographic operations (Key Generation, Encryption, Decryption) are performed _locally_ in the user's browser using the native **Web Crypto API**.
- User's generated Private Key is stored securely within their browser's `localStorage`.

### Backend

- A simplistic Node/Express server acting as an intermediary (Key Server and Encrypted File Storage).
- Uses in-memory storage (RAM) for user public keys and file records.

## How it Works

1. **Registration:** You type a username locally. Your browser generates an RSA-OAEP Key Pair. It saves the Private Key to your `localStorage` and sends the Public Key to the API
2. **Encryption & Sending:** You select a recipient and a tiny file (<= 190 characters). Your browser fetches the recipient's Public Key from the server, directly encrypts the raw bytes of the file with RSA, and uploads the _encrypted txt file_ to the server.
3. **Decryption:** The recipient checks their inbox, clicks download, and the server sends the encrypted file to their browser. The recipient's browser uses their locally stored Private Key to decrypt the file back into plain text, prompting a local file save to disk.

## How to Run

### 1. Start the Backend

#### Before proceeding make sure you have NodeJS installed (add to path is ticked in the installation)

Open a terminal and navigate to the `Backend` directory:

```bash
cd Backend
npm install
npm run start
```

### 2. Start the Frontend

```bash
cd Frontend/e2ee-cryptography-app
npm install
npm run dev
```

Navigate to http://localhost:1420/ in your browser.

### 3. Build as a Desktop App with Tauri

Since this project has Tauri pre-configured, you can build it into a native desktop executable.

**Prerequisites:** You must have the [Tauri System Dependencies](https://tauri.app/v1/guides/getting-started/prerequisites) installed (e.g., Rust toolchain and Visual Studio C++ Build Tools on Windows).

To build the final production desktop executable:

```bash
cd "Frontend/e2ee-cryptography-app"
npm run tauri build
```

Once the build is complete, you will find your compiled executable in `Frontend/e2ee-cryptography-app/src-tauri/target/release/`.
