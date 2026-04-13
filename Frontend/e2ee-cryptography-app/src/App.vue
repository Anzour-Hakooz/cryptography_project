<script setup>
import { ref, onMounted } from 'vue';

// state
const myUsername = ref('');
const registerStatus = ref('');
const registeredUsers = ref([]);

const recipientUsername = ref('');
const fileToShare = ref(null);
const shareStatus = ref('');

const myInbox = ref([]);
const downloadStatus = ref('');

// get active users from backend
const fetchActiveUsers = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/users');
    if (res.ok) {
      registeredUsers.value = await res.json();
    }
  } catch (error) {
    console.error("error fetching users");
  }
};

// file picker
const handleFileChange = (event) => {
  const file = event.target.files[0];

  // strict limit because pure RSA can only encrypt small payloads
  if (file && file.size > 190) {
    shareStatus.value = "Error: File is too large! Must be 190 bytes (characters) or less for pure RSA.";
    event.target.value = ''; // clear the input
    fileToShare.value = null;
    return;
  }

  fileToShare.value = file;
  shareStatus.value = "";
};

onMounted(() => {
  fetchActiveUsers();
});

// Step 1: Register
const generateAndRegister = async () => {
  try {
    registerStatus.value = 'Generating keys...';

    // generate standard RSA key pair
    const keyPair = await window.crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["encrypt", "decrypt"]
    );

    // export to jwk format
    const publicKey = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKey = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);

    // save private key locally
    localStorage.setItem(`privateKey_${myUsername.value}`, JSON.stringify(privateKey));

    // send public key to the server
    const response = await fetch('http://localhost:3000/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: myUsername.value, publicKey })
    });

    if (response.ok) {
      registerStatus.value = `Success! Registered as ${myUsername.value}.`;
      await fetchActiveUsers();
    }
  } catch (error) {
    registerStatus.value = 'Error generating keys.';
  }
};

// Step 2: Encrypt & Share
const encryptAndShare = async () => {
  if (!fileToShare.value || !recipientUsername.value) {
    shareStatus.value = "Please select a file and a recipient.";
    return;
  }

  try {
    shareStatus.value = 'Fetching recipient public key...';

    // get friend's public key
    const res = await fetch(`http://localhost:3000/api/keys/${recipientUsername.value}`);
    if (!res.ok) throw new Error("User not found");

    const { publicKey: recipientKeyText } = await res.json();

    // jwk = JSON Web Key
    // convert jwk string back to crypto key
    const recipientPublicKey = await window.crypto.subtle.importKey(
      "jwk", recipientKeyText, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"]
    );

    shareStatus.value = 'Encrypting file directly with RSA...';

    // convert file to array buffer (raw bytes) so we can do math on it
    const fileBuffer = await fileToShare.value.arrayBuffer();

    // encrypt the file buffering using their RSA public key directly
    const encryptedFile = await window.crypto.subtle.encrypt(
      { name: "RSA-OAEP" }, recipientPublicKey, fileBuffer
    );

    shareStatus.value = 'Uploading...';
    // basically creates a 'temporary & invisible' HTML form to upload the file
    const formData = new FormData();
    formData.append('recipient', recipientUsername.value);

    // create a blob from the encrypted file
    const fileBlob = new Blob([encryptedFile]);

    // append the blob to the form data
    formData.append('encryptedFile', fileBlob, fileToShare.value.name);

    // send to post request to the api
    const uploadRes = await fetch('http://localhost:3000/api/files/share', {
      method: 'POST', body: formData
    });

    if (uploadRes.ok) {
      shareStatus.value = 'Success!';
    } else {
      shareStatus.value = 'Upload failed.';
    }
  } catch (error) {
    console.error(error);
    shareStatus.value = 'Encryption error.';
  }
};

// Step 3: Check Inbox
const checkInbox = async () => {
  // username from Step 1
  if (!myUsername.value) return;
  try {
    const res = await fetch(`http://localhost:3000/api/files/inbox/${myUsername.value}`);
    if (res.ok) {
      myInbox.value = await res.json();
    }
  } catch (error) {
    console.error("error fetching inbox");
  }
};

// Decrypt helper
const downloadAndDecrypt = async (fileRecord) => {
  try {
    downloadStatus.value = `Downloading ${fileRecord}...`;

    // fetch the raw encrypted file
    const fileRes = await fetch(`http://localhost:3000/api/files/download/${fileRecord.fileId}`);
    // bundles the packets to form the decrypted file
    const encryptedBlob = await fileRes.blob();
    // convert blob to array buffer (raw bytes)
    const encryptedFile = await encryptedBlob.arrayBuffer();

    // get my local private key
    const privateKeyText = localStorage.getItem(`privateKey_${myUsername.value}`);
    if (!privateKeyText) throw new Error("Private key missing");

    downloadStatus.value = 'Decrypting file directly with RSA...';

    // importing and parsing the key (formatting the key to be used by the crypto api)
    const myPrivateKey = await window.crypto.subtle.importKey(
      "jwk", JSON.parse(privateKeyText), { name: "RSA-OAEP", hash: "SHA-256" }, true, ["decrypt"]
    );

    // directly decrypt the file itself using the user's RSA private key
    const decryptedFile = await window.crypto.subtle.decrypt(
      { name: "RSA-OAEP" }, myPrivateKey, encryptedFile
    );

    // prompt download in browser window
    // re-bundles the bytes into a file
    const blob = new Blob([decryptedFile]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // formating the file name to be downloaded
    a.download = `decrypted_${fileRecord.originalName}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    downloadStatus.value = 'Success!';

  } catch (error) {
    console.error(error);
    downloadStatus.value = 'Decryption failed.';
  }
};
</script>

<template>
  <main class="app-container">

    <div class="status-panel">
      <strong>Server Status:</strong>
      <span v-if="registeredUsers.length === 0">No users registered right now.</span>
      <span v-else>Users online: <strong>{{ registeredUsers.join(', ') }}</strong></span>
    </div>

    <!-- Step 1 -->
    <div class="step-card">
      <h3>Step 1: Register Yourself (or a friend)</h3>
      <div class="input-group">
        <input v-model="myUsername" placeholder="e.g., bob" class="input-field flex-grow" />
        <button @click="generateAndRegister" :disabled="!myUsername" class="action-btn">Register</button>
      </div>
      <p class="status-msg success-text">{{ registerStatus }}</p>
    </div>

    <!-- Step 2 -->
    <div class="step-card">
      <h3>Step 2: Send an Encrypted File</h3>
      <p class="hint-text">Since we map math directly to files using pure RSA, select a very tiny
        .txt file (max 190 characters).</p>
      <div class="input-column">
        <input v-model="recipientUsername" placeholder="Recipient (must be online above)" class="input-field" />
        <input type="file" accept=".txt" @change="handleFileChange" class="input-field file-input" />
        <button @click="encryptAndShare" class="action-btn cursor-pointer">Encrypt & Send</button>
      </div>
      <p class="status-msg info-text">{{ shareStatus }}</p>
    </div>

    <!-- Step 3 -->
    <div class="step-card">
      <div class="flex-between">
        <h3>Step 3: Your Inbox</h3>
        <button @click="checkInbox" :disabled="!myUsername" class="refresh-btn">Refresh Inbox</button>
      </div>

      <div v-if="myInbox.length === 0" class="empty-state">
        No files waiting for you. (Make sure you register your username first!)
      </div>

      <div v-else class="inbox-list">
        <div v-for="file in myInbox" :key="file.fileId" class="inbox-item">
          <span>📄 <strong>{{ file.originalName }}</strong></span>
          <button @click="downloadAndDecrypt(file)" class="download-btn">
            Decrypt & Download
          </button>
        </div>
      </div>

      <p class="status-msg warning-text">{{ downloadStatus }}</p>
    </div>

  </main>
</template>

<style scoped>
.app-container {
  max-width: 550px;
  margin: 50px auto;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #2d3748;
}

h3 {
  margin-top: 0;
  margin-bottom: 15px;
  color: #1a202c;
  font-weight: 600;
  font-size: 1.25rem;
}

.status-panel {
  background: #ebf8ff;
  border: 1px solid #bee3f8;
  color: #2b6cb0;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 24px;
  font-size: 0.95rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
}

.step-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  padding: 24px;
  border-radius: 12px;
  margin-bottom: 24px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.04);
}

.input-group {
  display: flex;
  gap: 12px;
}

.input-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.input-field {
  padding: 10px 12px;
  border: 1px solid #cbd5e0;
  border-radius: 6px;
  font-size: 0.95rem;
  transition: all 0.2s;
}

.input-field:focus {
  outline: none;
  border-color: #4299e1;
  box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.2);
}

.file-input {
  background: #f7fafc;
  padding: 8px;
}

.flex-grow {
  flex-grow: 1;
}

.action-btn {
  padding: 10px 16px;
  background: #4299e1;
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.action-btn:hover:not(:disabled) {
  background: #3182ce;
}

.action-btn:disabled {
  background: #a0aec0;
  cursor: not-allowed;
}

.cursor-pointer {
  cursor: pointer;
}

.refresh-btn {
  padding: 6px 12px;
  background: #edf2f7;
  color: #4a5568;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: #e2e8f0;
}

.status-msg {
  font-size: 0.9em;
  margin-top: 12px;
  margin-bottom: 0;
  font-weight: 500;
}

.success-text {
  color: #38a169;
}

.info-text {
  color: #3182ce;
}

.warning-text {
  color: #dd6b20;
}

.hint-text {
  font-size: 0.85rem;
  color: #718096;
  margin-top: -8px;
  margin-bottom: 16px;
  line-height: 1.4;
}

.flex-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.flex-between h3 {
  margin-bottom: 0;
}

.empty-state {
  color: #a0aec0;
  font-style: italic;
  font-size: 0.95rem;
  text-align: center;
  padding: 20px;
  background: #f7fafc;
  border-radius: 8px;
  border: 1px dashed #e2e8f0;
}

.inbox-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.inbox-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #ffffff;
  padding: 12px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
}

.download-btn {
  padding: 8px 14px;
  cursor: pointer;
  background: #2d3748;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-weight: 500;
  font-size: 0.85rem;
  transition: background 0.2s;
}

.download-btn:hover {
  background: #1a202c;
}
</style>