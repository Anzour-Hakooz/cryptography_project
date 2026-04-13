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
const signatureDetails = ref(null);

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
  // Even with simple textbook RSA, encrypting large files character-by-character
  // would create massive files, so keeping a limit is good practice.
  if (file && file.size > 190) {
    shareStatus.value = "Error: File is too large! Must be 190 bytes (characters) or less for textbook RSA.";
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

// --- TEXTBOOK RSA MATH FUNCTIONS ---

// 1. Modular Exponentiation: (base^exp) % mod
// Required because base^exp can be massive, so we square-and-multiply
const modPow = (base, exp, mod) => {
  let res = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) res = (res * base) % mod;
    base = (base * base) % mod;
    exp = exp / 2n;
  }
  return res;
};

// 2. Simple Prime Checker
// Checks mathematically using basic division if a number is prime
const isPrime = (num) => {
  for (let i = 2; i <= Math.sqrt(num); i++) {
    if (num % i === 0) return false;
  }
  return num > 1;
};

// 3. Simple Random Prime Generator
// Generates primes inside a range large enough to support up to 16-bit characters (65535)
// So our 'n' will be safely larger than any single text character!
const generatePrime = () => {
  while (true) {
    // Generate random number between 1000 and 5000
    let p = Math.floor(Math.random() * 4000) + 1000;
    if (isPrime(p)) return BigInt(p);
  }
};

// 4. Extended Euclidean Algorithm
// Determines the private key 'd' relative to 'e' and 'phi'
const modInverse = (e, phi) => {
  let old_r = e, r = phi;
  let old_s = 1n, s = 0n;

  while (r > 0n) {
    let quotient = old_r / r;

    let temp_r = r;
    r = old_r - quotient * r;
    old_r = temp_r;

    let temp_s = s;
    s = old_s - quotient * s;
    old_s = temp_s;
  }
  if (old_s < 0n) old_s += phi;
  return old_s;
};

// Step 1: Register
const generateAndRegister = async () => {
  try {
    registerStatus.value = 'Generating textbook keys...';

    // MATH: Generate p and q (Small primes between 1000 and 5000)
    const p = generatePrime();
    const q = generatePrime();

    // MATH: Calculate n (modulus) and phi (Euler's totient)
    const n = p * q;
    const phi = (p - 1n) * (q - 1n);

    // MATH: Define e (public exponent) and calculate d (private key exponent)
    const e = 65537n;
    const d = modInverse(e, phi);

    // Grouping keys
    const publicKey = JSON.stringify({ e: e.toString(), n: n.toString() });
    const privateKey = JSON.stringify({ d: d.toString(), n: n.toString() });

    // Save private key safely
    localStorage.setItem(`privateKey_${myUsername.value}`, privateKey);

    // Send public key to the central server
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
    console.error(error);
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

    // Get friend's public key
    const res = await fetch(`http://localhost:3000/api/keys/${recipientUsername.value}`);
    if (!res.ok) throw new Error("User not found");

    const { publicKey: recipientKeyText } = await res.json();
    const recipientKeyObj = JSON.parse(recipientKeyText);

    const e = BigInt(recipientKeyObj.e);
    const n = BigInt(recipientKeyObj.n);

    shareStatus.value = 'Encrypting text character by character...';

    // 1. Read the text file directly!
    const text = await fileToShare.value.text();

    // 2. Encrypt each individual character
    // Example: "Hi" -> 'H' is 72 -> c = 72^e mod n -> "14493"
    const encryptedArray = Array.from(text).map(char => {
      // Map character to its Unicode numerical value
      const m = BigInt(char.charCodeAt(0));
      // Encrypt
      const c = modPow(m, e, n);
      return c.toString();
    });

    // 3. Combine into a comma-separated string (e.g. "14493,5534,4432")
    const encryptedString = encryptedArray.join(',');

    // MATH: Create Digital Signature
    // Fetch Alice's private key to sign the message
    const myPrivateKeyText = localStorage.getItem(`privateKey_${myUsername.value}`);
    const myPrivateKeyObj = JSON.parse(myPrivateKeyText);
    const myD = BigInt(myPrivateKeyObj.d);
    const myN = BigInt(myPrivateKeyObj.n);

    // Sum up the string characters to act as a basic educational 'hash'
    let hash = 0n;
    for (let i = 0; i < text.length; i++) {
      hash += BigInt(text.charCodeAt(i));
    }
    // Sign the hash! (S = hash^d mod n)
    const signature = modPow(hash, myD, myN);

    shareStatus.value = 'Uploading...';

    const formData = new FormData();
    formData.append('recipient', recipientUsername.value);
    formData.append('sender', myUsername.value);
    formData.append('signature', signature.toString());

    // Send the numbers representation as the downloaded blob
    const fileBlob = new Blob([encryptedString]);
    formData.append('encryptedFile', fileBlob, fileToShare.value.name);

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
    downloadStatus.value = `Downloading ${fileRecord.originalName}...`;

    // 1. Fetch the raw encrypted text file (which contains "14493,5534,4432")
    const fileRes = await fetch(`http://localhost:3000/api/files/download/${fileRecord.fileId}`);
    const encryptedString = await fileRes.text();

    // 2. Get my local private key
    const privateKeyText = localStorage.getItem(`privateKey_${myUsername.value}`);
    if (!privateKeyText) throw new Error("Private key missing");

    const myPrivateKeyObj = JSON.parse(privateKeyText);
    const d = BigInt(myPrivateKeyObj.d);
    const n = BigInt(myPrivateKeyObj.n);

    downloadStatus.value = 'Decrypting numbers back into letters...';

    // 3. Break string apart and decrypt character by character!
    const numberStrings = encryptedString.split(',');

    const decryptedArray = numberStrings.map(cText => {
      if (!cText) return "";

      const c = BigInt(cText);
      // Decrypt numerical value
      const m = modPow(c, d, n);
      // Convert back to character format
      return String.fromCharCode(Number(m));
    });

    // 4. Join back into readable text
    const decryptedText = decryptedArray.join('');

    // VERIFY SIGNATURE:
    downloadStatus.value = 'Verifying digital signature...';
    try {
      // 1. Fetch Alice's public key
      const senderRes = await fetch(`http://localhost:3000/api/keys/${fileRecord.sender}`);
      const { publicKey: senderKeyText } = await senderRes.json();
      const senderKeyObj = JSON.parse(senderKeyText);
      const senderE = BigInt(senderKeyObj.e);
      const senderN = BigInt(senderKeyObj.n);

      // 2. Hash our newly decrypted text
      let calculatedHash = 0n;
      for (let i = 0; i < decryptedText.length; i++) {
        calculatedHash += BigInt(decryptedText.charCodeAt(i));
      }

      // 3. Reverse Alice's signature using her public key (Hash = S^e mod n)
      const providedSignature = BigInt(fileRecord.signature);
      const originalHash = modPow(providedSignature, senderE, senderN);

      // 4. Compare!
      const isValid = (calculatedHash === originalHash && providedSignature !== 0n);

      signatureDetails.value = {
        sender: fileRecord.sender,
        signature: providedSignature.toString(),
        e: senderE.toString(),
        n: senderN.toString(),
        calculatedHash: calculatedHash.toString(),
        originalHash: originalHash.toString(),
        isValid: isValid
      };

      if (isValid) {
        downloadStatus.value = `Success! Valid Signature verified from ${fileRecord.sender}!`;
      } else {
        downloadStatus.value = `WARNING: Invalid Signature! File may be tampered with.`;
      }
    } catch (err) {
      downloadStatus.value = `File decrypted, but could not verify signature.`;
      signatureDetails.value = null;
    }

    // Prompt user to download result
    const blob = new Blob([decryptedText]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
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
          <span>📄 <strong>{{ file.originalName }}</strong> <small>(from: {{ file.sender }})</small></span>
          <button @click="downloadAndDecrypt(file)" class="download-btn">
            Decrypt & Download
          </button>
        </div>
      </div>

      <p class="status-msg warning-text">{{ downloadStatus }}</p>
    </div>

    <!-- Signature Verification Panel -->
    <div v-if="signatureDetails" class="step-card verification-panel"
      :class="signatureDetails.isValid ? 'valid-panel' : 'invalid-panel'">
      <h3>Mathematical Signature Verification</h3>
      <p><strong>Sender:</strong> {{ signatureDetails.sender }}</p>

      <div class="code-block text-break">
        <strong>Attached Raw Signature:</strong> <br />
        {{ signatureDetails.signature }}
      </div>

      <p><strong>Step 1: Hash Decrypted Text</strong><br />
        We sum up the numerical characters of the newly decrypted file. <br />
        <span class="math-text">Expected Hash = {{ signatureDetails.calculatedHash }}</span>
      </p>

      <p><strong>Step 2: Reverse Signature using Public Key</strong><br />
        We use the sender's public keys against their signature: <em>Hash = Signature<sup>e</sup> (mod n)</em> <br />
        <span class="math-text">e = {{ signatureDetails.e }}</span><br />
        <span class="math-text">n = {{ signatureDetails.n }}</span><br />
        <span class="math-text">Calculated Hash = {{ signatureDetails.originalHash }}</span>
      </p>

      <div class="result-banner" :class="signatureDetails.isValid ? 'success-text' : 'warning-text'">
        <strong v-if="signatureDetails.isValid">
          ✅ MATCH! Signature is mathematically valid.
        </strong>
        <strong v-else>
          ❌ MISMATCH! File was altered or tampered with.
        </strong>
      </div>
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

.code-block {
  background: #f7fafc;
  padding: 10px;
  border-radius: 6px;
  border: 1px dashed #cbd5e0;
  font-family: monospace;
  font-size: 0.9rem;
  margin: 10px 0;
  overflow-wrap: break-word;
}

.math-text {
  font-family: monospace;
  font-weight: bold;
  color: #2b6cb0;
  display: block;
  margin-top: 4px;
}

.result-banner {
  margin-top: 15px;
  padding: 10px;
  border-radius: 6px;
  background: #f0fff4;
  text-align: center;
  font-size: 1.05rem;
}

.result-banner.warning-text {
  background: #fff5f5;
  color: #c53030 !important;
}

.verification-panel.valid-panel {
  border: 2px solid #68d391;
}

.verification-panel.invalid-panel {
  border: 2px solid #fc8181;
}

.text-break {
  word-break: break-all;
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